import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CatalogBootstrapService } from '../database/catalog-bootstrap.service';
import { Product } from '../models/Product';
import { TrainingBlock } from '../models/TrainingBlock';
import { DishCatalogBuilderService } from './dish-catalog.builder.service';
import { inferMealSlotFromDishName } from './dish-category-infer.util';
import { looksLikeMojibake, recoverIfMojibake } from '../common/text-recovery.util';

@Injectable()
export class PlansLibrarySeedService implements OnModuleInit {
  private readonly logger = new Logger(PlansLibrarySeedService.name);

  constructor(
    @InjectModel(Product) private readonly productModel: typeof Product,
    @InjectModel(TrainingBlock) private readonly trainingBlockModel: typeof TrainingBlock,
    private readonly catalogBootstrap: CatalogBootstrapService,
    private readonly dishCatalogBuilder: DishCatalogBuilderService,
  ) {}

  async onModuleInit() {
    await this.catalogBootstrap.ensureReferenceCatalog();
    await this.repairDamagedText();
    await this.reclassifyMisplacedDishes();
    await this.seedDishes();
    await this.seedTrainingBlocks();
    await this.reportCategoryCoverage();
  }

  /**
   * Самовосстановление текста, повреждённого перекодированием UTF-8 ↔ CP866.
   *
   * Такой дефект возникает при переносе БД через дамп с неверной клиентской
   * кодировкой: вместо «Курица» в базе лежит «╨Ъ╤Г╤А╨╕╤Ж╨░». На повреждённых
   * названиях не работает ни классификация блюд, ни фильтры по аллергенам
   * и диетам, поэтому проверяем каталог при каждом старте.
   * Полное восстановление всех таблиц — `npm run repair:mojibake`.
   */
  private async repairDamagedText() {
    try {
      const foods = await this.productModel.findAll({
        attributes: ['id', 'name'],
      });
      const damaged = foods.filter((p) => looksLikeMojibake(String(p.name ?? '')));
      if (damaged.length === 0) return;

      this.logger.warn(
        `Обнаружено ${damaged.length} названий блюд с повреждённой кодировкой — восстанавливаю. ` +
          'Для полного восстановления всех таблиц запустите `npm run repair:mojibake`.',
      );
      let fixed = 0;
      for (const p of damaged) {
        const restored = recoverIfMojibake(String(p.name));
        if (restored && restored !== p.name) {
          await p.update({ name: restored } as never);
          fixed += 1;
        }
      }
      this.logger.log(`Восстановлено названий блюд: ${fixed}.`);
    } catch (e) {
      this.logger.warn(`Не удалось проверить кодировку каталога: ${String(e)}`);
    }
  }

  /**
   * Переклассификация блюд, у которых категория не соответствует названию.
   *
   * Из-за прежней логики импорта (всё непонятное → `dinner`) в каталоге
   * оказалось 406 ужинов и ни одного обеда, что ломало генерацию планов.
   * Идемпотентно: обновляет только расходящиеся строки.
   */
  private async reclassifyMisplacedDishes() {
    try {
      const foods = await this.productModel.findAll({
        attributes: ['id', 'name', 'category'],
      });
      let fixed = 0;
      for (const p of foods) {
        const inferred = inferMealSlotFromDishName(String(p.name ?? ''));
        if (inferred !== p.category) {
          await p.update({ category: inferred } as never);
          fixed += 1;
        }
      }
      if (fixed > 0) {
        this.logger.log(`Каталог блюд: переклассифицировано ${fixed} позиций по названию.`);
      }
    } catch (e) {
      this.logger.warn(`Не удалось переклассифицировать каталог: ${String(e)}`);
    }
  }

  /**
   * Диагностика покрытия категорий. Пустая категория = генератор планов
   * подставит заглушки «Блюдо (slot)» с фиксированными 300 ккал.
   */
  private async reportCategoryCoverage() {
    try {
      const rows = (await this.productModel.findAll({
        attributes: ['category'],
      })) as Array<{ category: string }>;
      const counts: Record<string, number> = { breakfast: 0, lunch: 0, dinner: 0, snack: 0 };
      for (const r of rows) {
        const c = String(r.category ?? '');
        if (c in counts) counts[c] += 1;
      }
      const thin = Object.entries(counts).filter(([, n]) => n < 10);
      if (thin.length > 0) {
        this.logger.warn(
          `Каталог блюд: мало позиций в категориях ${thin
            .map(([k, n]) => `${k}=${n}`)
            .join(', ')}. Планы для этих слотов будут содержать заглушки.`,
        );
      } else {
        this.logger.log(
          `Каталог блюд: покрытие категорий ${Object.entries(counts)
            .map(([k, n]) => `${k}=${n}`)
            .join(', ')}.`,
        );
      }
    } catch (e) {
      this.logger.warn(`Не удалось посчитать покрытие категорий: ${String(e)}`);
    }
  }

  private async seedDishes() {
    const existingCount = await this.productModel.count();
    if (existingCount >= 80) {
      this.logger.log(
        `Каталог блюд: в БД уже ${existingCount} позиций — автодогрузка из ref_* отключена (порог 80).`,
      );
      return;
    }

    const rows = await this.dishCatalogBuilder.buildProductSeedRows();
    const names = (await this.productModel.findAll({ attributes: ['name'] })).map(
      (r) => (r as { name: string }).name,
    );
    const have = new Set(names);
    const toAdd = rows.filter((d) => !have.has(d.name));
    if (toAdd.length === 0) {
      this.logger.log(`Каталог блюд: без изменений, в БД ${names.length} позиций.`);
      return;
    }
    const chunk = 250;
    for (let i = 0; i < toAdd.length; i += chunk) {
      const part = toAdd.slice(i, i + chunk);
      await this.productModel.bulkCreate(part as never[], { ignoreDuplicates: true });
    }
    this.logger.log(
      `Каталог блюд: догружено ${toAdd.length} новых блюд (в каталоге из кода сейчас ${rows.length} строк, разница с БД = новые/изменившиеся названия).`,
    );
  }

  private async seedTrainingBlocks() {
    if ((await this.trainingBlockModel.count()) >= 20) return;
    this.logger.warn(
      'training_blocks мало записей: ожидались данные из SQL. Проверьте database/migrations/001_reference_catalog.sql и вызов ensureReferenceCatalog().',
    );
  }
}
