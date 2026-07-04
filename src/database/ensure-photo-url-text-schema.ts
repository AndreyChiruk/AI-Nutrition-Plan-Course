import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Sequelize } from 'sequelize';

export async function ensurePhotoUrlTextSchema(sequelize: Sequelize | null | undefined): Promise<void> {
  if (!sequelize) return;
  const sqlPath = join(process.cwd(), 'database', 'migrations', '008_meals_body_photo_url_text.sql');
  if (!existsSync(sqlPath)) return;
  await sequelize.query(readFileSync(sqlPath, 'utf8'));
}
