import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { RefDishModifier } from '../models/RefDishModifier';

@Injectable()
export class CatalogBootstrapService {
  private readonly logger = new Logger(CatalogBootstrapService.name);

  constructor(@InjectModel(RefDishModifier) private readonly refModifierModel: typeof RefDishModifier) {}

  async ensureReferenceCatalog(): Promise<void> {
    try {
      await this.refModifierModel.sequelize?.authenticate();
      const hasData = (await this.refModifierModel.count()) > 0;
      if (hasData) {
        return;
      }

      const sqlPath = join(process.cwd(), 'database', 'migrations', '001_reference_catalog.sql');
      if (!existsSync(sqlPath)) {
        this.logger.warn(`Файл справочника не найден: ${sqlPath}. Каталог блюд не будет заполнен автоматически.`);
        return;
      }

      const sql = readFileSync(sqlPath, 'utf8');
      await this.refModifierModel.sequelize?.query(sql);
      this.logger.log('Выполнен SQL справочника 001_reference_catalog.sql');
    } catch (e) {
      this.logger.error(
        `Не удалось применить справочник из SQL: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
}
