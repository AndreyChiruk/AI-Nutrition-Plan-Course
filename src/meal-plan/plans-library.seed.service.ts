import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Product } from '../models/Product';
import { inferMealSlotFromDishName } from './dish-category-infer.util';
import { looksLikeMojibake, recoverIfMojibake } from '../common/text-recovery.util';

@Injectable()
export class PlansLibrarySeedService implements OnModuleInit {
  private readonly logger = new Logger(PlansLibrarySeedService.name);

  constructor(
    @InjectModel(Product) private readonly productModel: typeof Product,
  ) {}

  async onModuleInit() {
    await this.repairDamagedText();
    await this.reclassifyMisplacedDishes();
    await this.reportCategoryCoverage();
  }

  /**
   * Самовосстановление текста, повреждённого перекодированием UTF-8 ↔ CP866.
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
   * Диагностика покрытия категорий.
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
}
