import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Sequelize } from 'sequelize';

const PRODUCT_MIGRATIONS = [
  '000_products_schema.sql',
  '010_products_ingredients.sql',
  '011_products_image_url.sql',
  '012_products_match_keywords.sql',
  '014_recipes_api_upgrade.sql',
  '016_products_dietary_tags.sql',
] as const;

export async function ensureProductsSchema(sequelize: Sequelize | null | undefined): Promise<void> {
  if (!sequelize) return;
  for (const name of PRODUCT_MIGRATIONS) {
    const sqlPath = join(process.cwd(), 'database', 'migrations', name);
    if (!existsSync(sqlPath)) continue;
    await sequelize.query(readFileSync(sqlPath, 'utf8'));
  }
}
