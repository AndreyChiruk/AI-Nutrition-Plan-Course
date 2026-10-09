/**
 * Пересчёт денормализованных итогов планов (`total_*`) по фактическим дням.
 *
 * Зачем: `meal_plans.total_calories` (и protein/fat/carbs) записываются при
 * сохранении плана и больше не обновляются. Если состав дней менялся
 * (конструктор, повторное сохранение, миграции перекусов), значения расходились
 * с суммой дней — на реальных данных до 5568 ккал. Из-за этого:
 *   - скачанный JSON плана был внутренне противоречив;
 *   - статистика «план vs факт» считала неверную калорийность плана.
 *
 * Запуск:
 *   npm run recalc:plan-totals            # применить
 *   npm run recalc:plan-totals -- --dry-run
 */
import { Sequelize } from 'sequelize';

function createSequelize(): Sequelize {
  return new Sequelize(
    process.env.POSTGRES_DB ?? process.env.DB_DATABASE ?? 'course',
    process.env.POSTGRES_USER ?? process.env.DB_USERNAME ?? 'course',
    process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD ?? 'course',
    {
      host: process.env.POSTGRES_HOST ?? process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
      dialect: 'postgres',
      logging: false,
    },
  );
}

type Snapshot = { name?: string; calories?: number; protein?: number; fat?: number; carbs?: number };

type DayRow = {
  mealPlanId: string;
  breakfast: Snapshot | null;
  lunch: Snapshot | null;
  dinner: Snapshot | null;
  snacks: Snapshot[] | null;
  extra_snacks: Snapshot[] | null;
};

type PlanRow = {
  id: string;
  name: string;
  total_calories: number;
  total_protein: number;
  total_fat: number;
  total_carbs: number;
};

/** Складывает КБЖУ всех слотов дня, включая все перекусы без дублей. */
function dayTotals(day: DayRow) {
  let calories = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;

  const add = (s: Snapshot | null | undefined) => {
    if (!s || typeof s !== 'object') return;
    calories += Number(s.calories) || 0;
    protein += Number(s.protein) || 0;
    fat += Number(s.fat) || 0;
    carbs += Number(s.carbs) || 0;
  };

  add(day.breakfast);
  add(day.lunch);
  add(day.dinner);

  const seen = new Set<string>();
  for (const snack of [...(day.snacks ?? []), ...(day.extra_snacks ?? [])]) {
    const key = `${String(snack?.name ?? '')}|${Number(snack?.calories) || 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    add(snack);
  }

  return { calories, protein, fat, carbs };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sequelize = createSequelize();

  console.log(`\nПересчёт итогов планов${dryRun ? ' (DRY-RUN)' : ''}\n`);

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error(`Не удалось подключиться к БД: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const [plans] = await sequelize.query(
      'SELECT id, name, total_calories, total_protein, total_fat, total_carbs FROM meal_plans',
    );
    const [days] = await sequelize.query(
      `SELECT "mealPlanId", breakfast, lunch, dinner, snacks, extra_snacks
       FROM meal_plan_days`,
    );

    const daysByPlan = new Map<string, DayRow[]>();
    for (const d of days as DayRow[]) {
      const list = daysByPlan.get(d.mealPlanId) ?? [];
      list.push(d);
      daysByPlan.set(d.mealPlanId, list);
    }

    const updates: Array<{
      id: string;
      name: string;
      before: number;
      after: number;
      protein: number;
      fat: number;
      carbs: number;
    }> = [];

    for (const p of plans as PlanRow[]) {
      const planDays = daysByPlan.get(p.id) ?? [];
      if (planDays.length === 0) continue;

      let calories = 0;
      let protein = 0;
      let fat = 0;
      let carbs = 0;
      for (const d of planDays) {
        const t = dayTotals(d);
        calories += t.calories;
        protein += t.protein;
        fat += t.fat;
        carbs += t.carbs;
      }

      const after = Math.round(calories);
      const before = Math.round(Number(p.total_calories) || 0);
      if (Math.abs(after - before) <= 1) continue;

      updates.push({
        id: p.id,
        name: p.name,
        before,
        after,
        protein: Math.round(protein * 10) / 10,
        fat: Math.round(fat * 10) / 10,
        carbs: Math.round(carbs * 10) / 10,
      });
    }

    console.log(`  планов всего:        ${(plans as PlanRow[]).length}`);
    console.log(`  с расхождением:      ${updates.length}`);

    if (updates.length > 0) {
      const worst = [...updates]
        .sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))
        .slice(0, 6);
      console.log('\n  Наибольшие расхождения:');
      for (const u of worst) {
        console.log(
          `    ${String(u.before).padStart(7)} -> ${String(u.after).padStart(6)} ккал   ${u.name.slice(0, 40)}`,
        );
      }

      if (!dryRun) {
        await sequelize.transaction(async (t) => {
          for (const u of updates) {
            await sequelize.query(
              `UPDATE meal_plans
               SET total_calories = :calories,
                   total_protein  = :protein,
                   total_fat      = :fat,
                   total_carbs    = :carbs
               WHERE id = :id`,
              {
                replacements: {
                  calories: u.after,
                  protein: u.protein,
                  fat: u.fat,
                  carbs: u.carbs,
                  id: u.id,
                },
                transaction: t,
              },
            );
          }
        });
        console.log(`\n  Обновлено планов: ${updates.length}.`);
      } else {
        console.log('\n  Запустите без --dry-run, чтобы применить изменения.');
      }
    } else {
      console.log('\n  Итоги уже согласованы с содержимым дней.');
    }
    console.log('');
  } finally {
    await sequelize.close();
  }
}

void main();
