import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Sequelize } from 'sequelize';

export async function ensureBodyAnalysisWeightSchema(sequelize: Sequelize | null | undefined): Promise<void> {
  if (!sequelize) return;
  const sqlPath = join(process.cwd(), 'database', 'migrations', '007_body_analysis_weight_bmi.sql');
  if (!existsSync(sqlPath)) return;
  await sequelize.query(readFileSync(sqlPath, 'utf8'));
}
