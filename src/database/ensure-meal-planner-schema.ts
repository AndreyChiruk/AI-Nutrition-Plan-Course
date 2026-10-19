import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { Sequelize } from 'sequelize';

const MEAL_PLANNER_MIGRATIONS = [
  '002_meal_planner_schema.sql',
  '003_meal_plan_days_jsonb.sql',
  '009_food_preferences_and_fridge.sql',
  '013_fridge_mass_units.sql',
  '015_fridge_ingredient_link.sql',
  '031_fridge_unit_variety.sql',
] as const;
export async function ensureMealPlannerSchema(sequelize: Sequelize | null | undefined): Promise<void> {
  if (!sequelize) return;
  for (const name of MEAL_PLANNER_MIGRATIONS) {
    const sqlPath = join(process.cwd(), 'database', 'migrations', name);
    if (!existsSync(sqlPath)) continue;
    await sequelize.query(readFileSync(sqlPath, 'utf8'));
  }
}
