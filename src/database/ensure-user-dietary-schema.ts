import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Sequelize } from 'sequelize';

export async function ensureUserDietarySchema(sequelize: Sequelize | null | undefined): Promise<void> {
  if (!sequelize) return;
  const sqlPath = join(process.cwd(), 'database', 'migrations', '004_user_dietary.sql');
  if (!existsSync(sqlPath)) return;
  await sequelize.query(readFileSync(sqlPath, 'utf8'));
}
