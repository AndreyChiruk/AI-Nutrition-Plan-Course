import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { CatalogBootstrapService } from '../database/catalog-bootstrap.service';
import { Product } from '../models/Product';
import { TrainingBlock } from '../models/TrainingBlock';
import { DishCatalogBuilderService } from './dish-catalog.builder.service';

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
    await this.seedDishes();
    await this.seedTrainingBlocks();
  }

  private async seedDishes() {
    const existingCount = await this.productModel.count();
    if (existingCount >= 80) {
      this.logger.log(`Каталог блюд: в БД уже ${existingCount} позиций — автодогрузка из ref_* отключена (порог 80).`);
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
