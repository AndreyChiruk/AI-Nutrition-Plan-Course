import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Sequelize } from 'sequelize';

export async function ensureUserLastActiveSchema(sequelize: Sequelize | null | undefined): Promise<void> {
  if (!sequelize) return;
  const sqlPath = join(process.cwd(), 'database', 'migrations', '006_user_last_active.sql');
  if (!existsSync(sqlPath)) return;
  await sequelize.query(readFileSync(sqlPath, 'utf8'));
}
