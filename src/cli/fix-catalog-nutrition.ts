/**
 * Исправление испорченных масс ингредиентов и пересчёт КБЖУ каталога.
 *
 * Два связанных дефекта:
 *
 * 1. Массы ингредиентов. При импорте из TheMealDB смешанные числа вида «1 ½»
 *    разбирались как «150», «2 ½» как «250»: в каталоге появились «150 шт» яиц
 *    (7.5 кг) и «250 шт» (12.5 кг). Блюдо получало десятки тысяч калорий.
 *
 * 2. КБЖУ. Калорийность считалась как «сумма всех граммов × 1.2», а белки,
 *    жиры и углеводы подставлялись фиксированными долями 22/28/50 % от неё.
 *
 * Скрипт:
 *   - приводит аномальные массы к разумным (по весу «штуки» для продукта);
 *   - пересчитывает КБЖУ по справочнику на 100 г;
 *   - сообщает о блюдах, которые не удалось исправить автоматически.
 *
 * Запуск:
 *   npm run fix:catalog-nutrition            # применить
 *   npm run fix:catalog-nutrition -- --dry-run
 */
import { Sequelize } from 'sequelize';
import { computeDishNutrition, IngredientLike } from '../admin/nutrition-facts.util';

/** Разумный предел массы одного ингредиента в рецепте, г. */
const MAX_INGREDIENT_GRAMS = 3000;

/**
 * На сколько порций рассчитаны меры в рецепте TheMealDB.
 * Меры там даны на всё блюдо целиком, поэтому КБЖУ делится на это число.
 */
const SERVINGS_PER_RECIPE = 4;

/** Разумная масса одной порции блюда, г. */
const MAX_PORTION_GRAMS = 1200;

/** Максимальная калорийность одной порции, ккал. */
const MAX_PORTION_KCAL = 3000;

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

type Detail = IngredientLike & {
  id?: string;
  unit?: string;
  originalString?: string;
  ingredientId?: string;
};

type Row = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  ingredients: Detail[] | null;
  ingredients_detailed: Detail[] | null;
};

/**
 * Средний вес одной штуки по названию продукта.
 * Дублирует правила recipe-import.util, но нужен здесь для независимого
 * восстановления уже сохранённых данных.
 */
function pieceWeight(name: string): number {
  const n = String(name ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е');
  if (/яйц|egg/.test(n)) return 55;
  if (/чеснок|garlic|зубчик/.test(n)) return 5;
  if (/лук|onion|шалот|порей|leek/.test(n)) return 75;
  if (/картоф|potato/.test(n)) return 150;
  if (/помидор|томат|tomato/.test(n)) return 120;
  if (/огур|cucumber/.test(n)) return 100;
  if (/морков|carrot/.test(n)) return 80;
  if (/перец|pepper/.test(n)) return 120;
  if (/капуст|cabbage|брокколи|broccoli|цветн/.test(n)) return 400;
  if (/банан|banana|яблок|apple|груш|pear|апельсин|orange/.test(n)) return 150;
  if (/лимон|lemon|лайм|lime/.test(n)) return 100;
  if (/авокадо|avocado/.test(n)) return 200;
  if (/куриц|курин|chicken|грудка|бедро/.test(n)) return 200;
  if (/стейк|steak|филе|fillet|рыб|fish|лосос|salmon|треск|cod/.test(n)) return 150;
  if (/хлеб|bread|булочк|bun|батон|лаваш|тортиль/.test(n)) return 60;
  if (/сыр|cheese|ломтик|slice/.test(n)) return 25;
  if (/колбас|sausage|сосиск|ветчин|ham|бекон|bacon/.test(n)) return 40;
  if (/кревет|shrimp|миди|mussel|кальмар|squid/.test(n)) return 15;
  if (/гриб|mushroom|шампиньон/.test(n)) return 25;
  if (/орех|nut|миндал|almond|фундук|кешью|cashew|грецк|walnut/.test(n)) return 5;
  return 60;
}

/** Дробные единицы измерения, если они указаны явно. */
const UNIT_MULTIPLIER: Record<string, number> = {
  г: 1,
  мл: 1,
  кг: 1000,
  л: 1000,
  чашка: 240,
  'ст.л.': 15,
  'ч.л.': 5,
  щепотка: 0.5,
};

/**
 * Исправляет массу ингредиента.
 *
 * Случай 1: единица измерения известна (г/мл/кг) — берём значение как есть,
 *           но ограничиваем разумным пределом.
 * Случай 2: штуки — считаем массу как `количество × вес штуки`. Если количество
 *           неправдоподобно велико (150 «штук» яиц), значит исходная дробь
 *           «1 ½» была разобрана как «150»: делим на 100 и используем
 *           истинное количество.
 */
function repairIngredientWeight(item: Detail): { grams: number; reason?: string } {
  const grams = Number(item.grams ?? item.amount ?? 0);
  const unit = String(item.unit ?? '').trim();
  const name = String(item.name ?? '');

  if (!Number.isFinite(grams) || grams <= 0) {
    return { grams: pieceWeight(name), reason: 'нулевая масса' };
  }

  // Весовые единицы: ограничиваем только сверху.
  if (UNIT_MULTIPLIER[unit] !== undefined && unit !== 'шт') {
    if (grams > MAX_INGREDIENT_GRAMS) {
      return { grams: MAX_INGREDIENT_GRAMS, reason: `весовая мера ${unit} превышена` };
    }
    return { grams };
  }

  // Штуки: считаем по весу продукта.
  const perPiece = pieceWeight(name);
  const rawCount = Number(item.amount ?? 0) || Math.round(grams / perPiece) || 1;

  // «150 шт яиц» — это ошибка разбора «1 ½». Делим на 100.
  let count = rawCount;
  let reason: string | undefined;
  if (count >= 100) {
    const corrected = count / 100;
    // Оставляем деление, только если результат правдоподобен.
    if (corrected >= 0.5 && corrected <= 30) {
      count = corrected;
      reason = `количество ${rawCount} → ${corrected} (вероятно, «1 ½» разобрано как «150»)`;
    } else {
      count = Math.min(count, 30);
      reason = `количество ограничено до ${count}`;
    }
  }

  let result = count * perPiece;
  if (result > MAX_INGREDIENT_GRAMS) {
    result = MAX_INGREDIENT_GRAMS;
    reason = (reason ? reason + '; ' : '') + 'масса ограничена';
  }
  return { grams: Math.round(result * 10) / 10, reason };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sequelize = createSequelize();

  console.log(`\nИсправление каталога${dryRun ? ' (DRY-RUN)' : ''}\n`);

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error(`Не удалось подключиться к БД: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const [rawRows] = await sequelize.query(
      `SELECT id, name, calories, protein, fat, carbs, ingredients, ingredients_detailed
       FROM products ORDER BY name`,
    );
    const products = rawRows as Row[];

    type Update = {
      id: string;
      name: string;
      beforeKcal: number;
      afterKcal: number;
      calories: number;
      protein: number;
      fat: number;
      carbs: number;
      ingredients: Detail[] | null;
      ingredientsDetailed: Detail[] | null;
      notes: string[];
      skipped?: string;
    };

    const updates: Update[] = [];
    const skipped: Array<{ name: string; why: string }> = [];

    for (const p of products) {
      const detailed = Array.isArray(p.ingredients_detailed) ? p.ingredients_detailed : [];
      const simple = Array.isArray(p.ingredients) ? p.ingredients : [];
      const source = detailed.length > 0 ? detailed : simple;

      if (source.length === 0) {
        skipped.push({ name: p.name, why: 'нет состава' });
        continue;
      }

      const notes: string[] = [];
      const fixedDetailed = detailed.map((it) => {
        const r = repairIngredientWeight(it);
        if (r.reason) notes.push(`${it.name}: ${r.reason}`);
        return { ...it, grams: r.grams };
      });
      const fixedSimple = simple.map((it) => {
        const r = repairIngredientWeight(it);
        return { ...it, grams: r.grams };
      });

      const composition = (fixedDetailed.length > 0 ? fixedDetailed : fixedSimple) as IngredientLike[];

      // Меры в рецептах TheMealDB указаны на всё блюдо (обычно 4 порции),
      // поэтому сначала считаем КБЖУ на одну порцию, и только потом
      // проверяем правдоподобность.
      const perPortion = computeDishNutrition(composition, SERVINGS_PER_RECIPE);
      const total = computeDishNutrition(composition, 1);

      // Неправдоподобной считаем ОДНУ ПОРЦИЮ: 2000 г или 1500 ккал на порцию
      // означают, что массы ингредиентов всё ещё испорчены.
      // Масса порции у супов/рагу может быть большой (500–800 г) — это нормально.
      // Отбраковываем только калорийность, которая физически невозможна
      // для одной порции, и совсем уж невероятную массу.
      const absurdMass = perPortion.totalGrams > MAX_PORTION_GRAMS * 2;
      if (absurdMass || perPortion.calories > MAX_PORTION_KCAL) {
        skipped.push({
          name: p.name,
          why: `порция ${perPortion.totalGrams} г / ${perPortion.calories} ккал — превышает разумные пределы`,
        });
        continue;
      }

      const nutrition = perPortion;

      updates.push({
        id: p.id,
        name: p.name,
        beforeKcal: Number(p.calories),
        afterKcal: nutrition.calories,
        calories: nutrition.calories,
        protein: nutrition.protein,
        fat: nutrition.fat,
        carbs: nutrition.carbs,
        ingredients: fixedSimple.length > 0 ? (fixedSimple as Detail[]) : null,
        ingredientsDetailed: fixedDetailed.length > 0 ? (fixedDetailed as Detail[]) : null,
        notes,
      });
    }

    const beforeAvg =
      products.reduce((s, p) => s + Number(p.calories || 0), 0) / (products.length || 1);
    const afterAvg =
      updates.reduce((s, u) => s + u.afterKcal, 0) / (updates.length || 1);

    console.log(`  блюд всего:            ${products.length}`);
    console.log(`  будет исправлено:      ${updates.length}`);
    console.log(`  пропущено:             ${skipped.length}`);
    console.log(
      `\n  средняя калорийность:  ${beforeAvg.toFixed(0)} → ${afterAvg.toFixed(0)} ккал (по исправляемым)`,
    );

    const withNotes = updates.filter((u) => u.notes.length > 0);
    if (withNotes.length > 0) {
      console.log(`\n  Исправлено масс ингредиентов: в ${withNotes.length} блюдах. Примеры:`);
      for (const u of withNotes.slice(0, 6)) {
        console.log(`    ${u.name.slice(0, 40)}`);
        for (const n of u.notes.slice(0, 2)) console.log(`      • ${n}`);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n  Пропущены (требуют ручной проверки):`);
      for (const s of skipped.slice(0, 8)) {
        console.log(`    ${s.name.slice(0, 44)} — ${s.why}`);
      }
      if (skipped.length > 8) console.log(`    …и ещё ${skipped.length - 8}`);
    }

    if (!dryRun && updates.length > 0) {
      await sequelize.transaction(async (t) => {
        for (const u of updates) {
          await sequelize.query(
            // ВАЖНО: `servings` записывается вместе с КБЖУ.
            //
            // Раньше КБЖУ делились на SERVINGS_PER_RECIPE (4), а поле
            // `servings` оставалось равным 1. Получалась несогласованность:
            // в карточке «Оливье с колбасой» стояло 102 ккал при массе
            // состава 605 г — то есть данные на порцию были помечены как
            // данные на всё блюдо, и любой последующий пересчёт
            // (через computeDishNutrition с servings=1) давал 792 ккал.
            `UPDATE products
             SET calories = :calories, protein = :protein, fat = :fat, carbs = :carbs,
                 servings = :servings,
                 ingredients = COALESCE(:ingredients, ingredients),
                 ingredients_detailed = COALESCE(:detailed, ingredients_detailed)
             WHERE id = :id`,
            {
              replacements: {
                servings: SERVINGS_PER_RECIPE,
                calories: u.calories,
                protein: u.protein,
                fat: u.fat,
                carbs: u.carbs,
                ingredients: u.ingredients ? JSON.stringify(u.ingredients) : null,
                detailed: u.ingredientsDetailed ? JSON.stringify(u.ingredientsDetailed) : null,
                id: u.id,
              },
              transaction: t,
            },
          );
        }
      });
      console.log(`\n  Обновлено блюд: ${updates.length}.`);
    } else if (dryRun) {
      console.log('\n  Запустите без --dry-run, чтобы применить изменения.');
    }
    console.log('');
  } finally {
    await sequelize.close();
  }
}

void main();
