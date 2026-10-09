/**
 * Нормализация порций и пересчёт КБЖУ каталога.
 *
 * ─── В чём была проблема ────────────────────────────────────────────────
 *
 * Импорт из TheMealDB сохранял состав так, как он пришёл из источника:
 * меры указаны НА ВСЁ БЛЮДО (обычно 4 порции). Например, «Адана кебаб»:
 * 420 г состава — это 4 порции по ~105 г.
 *
 * При этом поле `servings` выставлялось в 4 у ВСЕХ блюд без разбора,
 * а КБЖУ делились на 4. В результате для блюд, где 420 г — это уже
 * одна порция, получалось двойное деление:
 *
 *     «Адана кебаб»:  состав 420 г
 *       расчёт на порцию:  211 ккал
 *       в БД:              147 ккал   ← занижено
 *
 * Проверка показала: с составом согласовано лишь 8 из 709 блюд,
 * остальные занижены на 20–40 %. План питания строится от этих чисел,
 * поэтому при цели 2200 ккал пользователь получал ~1500 ккал.
 *
 * ─── Как исправляется ───────────────────────────────────────────────────
 *
 * 1. Состав считается «на всё блюдо» — это соответствует источнику.
 * 2. Общая масса делится на число порций так, чтобы ОДНА порция весила
 *    около `TARGET_PORTION_GRAMS` (350 г). Пользователь не будет есть
 *    порцию в 1–3 кг, поэтому такие блюда разбиваются на большее число
 *    порций, а не остаются «на всю кастрюлю».
 * 3. Граммовки ингредиентов НЕ меняются: они по-прежнему описывают всё
 *    блюдо, а `servings` показывает, на сколько порций его делить.
 *    Это сохраняет пропорции рецепта и не ломает список покупок.
 * 4. Исправляются явные ошибки разбора мер: специи и соль с массой
 *    больше 20 г — это следствие подстановки значения по умолчанию
 *    (`DEFAULT_PIECE_GRAMS = 60`), такие значения приводятся к разумным.
 *
 * Запуск:
 *   npm run normalize:portions            # применить
 *   npm run normalize:portions -- --dry-run
 */
import { Sequelize } from 'sequelize';
import { computeDishNutrition } from '../admin/nutrition-facts.util';

/** Желаемая масса одной порции, граммы. */
const TARGET_PORTION_GRAMS = 350;

/** Границы: меньше — мельчить нет смысла, больше — пользователь не съест. */
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 8;

/**
 * Разумные пределы для одной порции.
 *
 * Верхняя граница 900 ккал: даже сытный ужин редко превышает это значение,
 * а порция в 1200–1500 ккал означает, что блюдо неверно разделено.
 * Нижняя граница 80 ккал: меньше — это уже не самостоятельный приём пищи,
 * а добавка (и такие блюда лучше разделить на большее число порций).
 */
const MAX_PORTION_KCAL = 900;
const MIN_PORTION_KCAL = 80;

/**
 * Минимальная масса одной порции.
 *
 * Масса 300–400 г подходит для супов и рагу, но для плотных блюд
 * (запеканки, бургеры) порция в 450–500 г слишком велика. Поэтому
 * число порций подбирается не только по массе, но и по калорийности.
 */
const MIN_PORTION_GRAMS = 150;

/**
 * Порог абсурдности состава.
 *
 * Если даже при максимальном дроблении (MAX_SERVINGS порций) масса одной
 * порции превышает это значение, данные источника безнадёжно испорчены.
 * Пример: «Хлеб Хобз эл Дар» — 6274 г, то есть 784 г даже на 8 порций.
 *
 * Порог считается от ЦЕЛЕВОЙ порции с запасом вдвое: 350 × 2 = 700 г.
 * Больше этого — уже не порция, а ошибка разбора мер.
 */
const ABSURD_PORTION_GRAMS = 700;

/** Специи и добавки: их масса не может быть большой. */
const SEASONING_RE = /(соль|перец|специи|приправ|лавров|сода|разрыхлител|дрожжи|ванил|корица|куркума|паприка|орегано|базилик|тимьян|розмарин)/i;
const MAX_SEASONING_GRAMS = 15;

type Ingredient = { name?: string; grams?: number; amount?: number; unit?: string };

function createSequelize(): Sequelize {
  return new Sequelize(
    process.env.POSTGRES_DB ?? 'course',
    process.env.POSTGRES_USER ?? 'course',
    process.env.POSTGRES_PASSWORD ?? 'course',
    {
      host: process.env.POSTGRES_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? 5432),
      dialect: 'postgres',
      logging: false,
    },
  );
}

/** Суммарная масса состава (без воды и соли — они не формируют порцию). */
function compositionMass(ingredients: Ingredient[]): number {
  const nonMass = /^(вода|бульон|лед|лёд|соль)/i;
  return ingredients.reduce((sum, i) => {
    const name = String(i?.name ?? '').trim();
    if (nonMass.test(name)) return sum;
    const g = Number(i?.grams ?? i?.amount ?? 0);
    return sum + (Number.isFinite(g) && g > 0 ? g : 0);
  }, 0);
}

/**
 * Подбирает число порций так, чтобы одна порция была разумной
 * и по массе (≈350 г), и по калорийности (80–900 ккал).
 *
 * Простого деления массы недостаточно: плотные блюда (бургеры, запеканки)
 * при массе 400–500 г дают 800–1000 ккал на порцию. Поэтому сначала
 * считаем порции по массе, затем увеличиваем их число, пока порция
 * не станет приемлемой по калорийности.
 */
function servingsFor(mass: number, totalKcal: number): number {
  if (mass <= 0) return 1;

  // 1. По массе.
  let servings = Math.min(MAX_SERVINGS, Math.max(MIN_SERVINGS, Math.round(mass / TARGET_PORTION_GRAMS)));

  // 2. Корректировка по калорийности: увеличиваем число порций,
  //    пока порция не станет меньше верхней границы.
  if (totalKcal > 0) {
    while (servings < MAX_SERVINGS && totalKcal / servings > MAX_PORTION_KCAL) {
      servings += 1;
    }
    // Слишком маленькая порция — значит, блюдо разделено чрезмерно.
    while (servings > MIN_SERVINGS && totalKcal / servings < MIN_PORTION_KCAL) {
      servings -= 1;
    }
  }

  // 3. Не допускаем слишком лёгких порций при большой массе, НО только
  //    если порция уже приемлема по калорийности.
  //
  //    Раньше этот шаг отменял корректировку по калориям: «Адана кебаб»
  //    весил 180 г и получал 1 порцию с 772 ккал, потому что 180/2 = 90 г
  //    меньше минимума. Но 772 ккал на порцию — это слишком много,
  //    поэтому приоритет отдаём калорийности.
  while (
    servings > MIN_SERVINGS &&
    mass / servings < MIN_PORTION_GRAMS &&
    totalKcal / (servings - 1) <= MAX_PORTION_KCAL
  ) {
    servings -= 1;
  }

  return servings;
}

/** Приводит подозрительные массы специй к разумным. */
function fixSeasonings(ingredients: Ingredient[]): { list: Ingredient[]; fixes: string[] } {
  const fixes: string[] = [];
  const list = ingredients.map((ing) => {
    const name = String(ing?.name ?? '').trim();
    const grams = Number(ing?.grams ?? ing?.amount ?? 0);
    if (SEASONING_RE.test(name) && Number.isFinite(grams) && grams > MAX_SEASONING_GRAMS) {
      // Соль и специи измеряются щепотками и ложками: 60 г соли в рецепте —
      // это ошибка разбора меры, а не реальное количество.
      const fixed = name.toLowerCase().includes('соль') ? 5 : 3;
      fixes.push(`${name}: ${grams} → ${fixed} г`);
      return { ...ing, grams: fixed };
    }
    return ing;
  });
  return { list, fixes };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sequelize = createSequelize();

  console.log(`\nНормализация порций каталога${dryRun ? ' (DRY-RUN)' : ''}`);
  console.log(`Целевая масса порции: ${TARGET_PORTION_GRAMS} г\n`);

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error(`Нет связи с БД: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const [rows] = await sequelize.query(
    `SELECT id, name, calories, servings, ingredients, ingredients_detailed,
            source_meal_id, cuisine
     FROM products
     WHERE ingredients IS NOT NULL AND jsonb_array_length(ingredients) > 0`,
  );

  type Row = {
    id: string;
    name: string;
    calories: number;
    servings: number;
    ingredients: Ingredient[];
    ingredients_detailed: Ingredient[] | null;
    source_meal_id: string | null;
    cuisine: string | null;
  };

  const products = rows as Row[];
  const updates: Array<{
    id: string;
    name: string;
    oldServings: number;
    newServings: number;
    oldKcal: number;
    newKcal: number;
    oldMass: number;
    portionMass: number;
    seasoningFixes: string[];
    /** Итоговые КБЖУ на порцию — считаются один раз при разборе. */
    calories: number;
    protein: number;
    fat: number;
    carbs: number;
    ingredients: Ingredient[] | null;
  }> = [];
  const skipped: Array<{ name: string; why: string }> = [];
  /** Курируемые блюда — пропущены, граммовки уже на порцию. */
  const curated: string[] = [];

  for (const p of products) {
    const raw = Array.isArray(p.ingredients) ? p.ingredients : [];
    if (raw.length === 0) continue;

    // Курируемые блюда СНГ-кухни (см. `curated-cis-dishes.ts`) составлены
    // вручную, и граммовки в них указаны НА ОДНУ ПОРЦИЮ. Нормализация
    // к ним неприменима: она принимает состав за меры «на всё блюдо»
    // и делит калорийность ещё раз, задваивая значения.
    //
    // Признак — отсутствие `source_meal_id` (блюдо не из внешнего API)
    // при заполненной кухне.
    const isCurated = !p.source_meal_id && Boolean(p.cuisine);
    if (isCurated) {
      curated.push(p.name);
      continue;
    }

    const { list: fixed, fixes: seasoningFixes } = fixSeasonings(raw);
    const mass = compositionMass(fixed);
    if (mass <= 0) {
      skipped.push({ name: p.name, why: 'нулевая масса состава' });
      continue;
    }

    // Калорийность ВСЕГО блюда (servings = 1) нужна, чтобы подобрать
    // число порций не только по массе, но и по калорийности.
    const totalNutrition = computeDishNutrition(
      fixed.map((i) => ({ name: String(i.name ?? ''), grams: Number(i.grams ?? 0) })),
      1,
    );

    const newServings = servingsFor(mass, totalNutrition.calories);
    const portionMass = Math.round(mass / newServings);

    // КБЖУ на одну порцию: состав считается на всё блюдо.
    const nutrition = computeDishNutrition(
      fixed.map((i) => ({ name: String(i.name ?? ''), grams: Number(i.grams ?? 0) })),
      newServings,
    );

    // Отбраковываем физически невозможные порции.
    if (nutrition.calories > MAX_PORTION_KCAL) {
      skipped.push({
        name: p.name,
        why: `порция ${nutrition.calories} ккал при массе ${portionMass} г — превышает предел`,
      });
      // Помечаем блюдо как непригодное: оно не должно попадать в планы.
      if (!dryRun) {
        await sequelize.query(
          'UPDATE products SET is_published = false, unpublished_reason = :reason WHERE id = :id',
          {
            replacements: {
              id: p.id,
              reason: `Некорректная калорийность: ${nutrition.calories} ккал на порцию`,
            },
          },
        );
      }
      continue;
    }

    // Абсурдная масса порции даже при максимальном дроблении —
    // данные состава испорчены, блюдо снимаем с публикации.
    if (mass / MAX_SERVINGS > ABSURD_PORTION_GRAMS) {
      skipped.push({
        name: p.name,
        why: `масса состава ${Math.round(mass)} г — даже на ${MAX_SERVINGS} порций это ` +
          `${Math.round(mass / MAX_SERVINGS)} г на порцию`,
      });
      if (!dryRun) {
        await sequelize.query(
          'UPDATE products SET is_published = false, unpublished_reason = :reason WHERE id = :id',
          {
            replacements: {
              id: p.id,
              reason: `Испорченный состав: ${Math.round(mass)} г на всё блюдо`,
            },
          },
        );
      }
      continue;
    }

    const oldMass = compositionMass(raw);
    const oldServings = Number(p.servings) || 1;
    const oldPortionMass = Math.round(oldMass / oldServings);

    const changed =
      oldServings !== newServings ||
      Math.abs(Number(p.calories) - nutrition.calories) > 2 ||
      seasoningFixes.length > 0 ||
      Math.abs(oldPortionMass - portionMass) > 5;

    if (!changed) continue;

    updates.push({
      id: p.id,
      name: p.name,
      oldServings,
      newServings,
      oldKcal: Number(p.calories),
      newKcal: nutrition.calories,
      oldMass,
      portionMass,
      seasoningFixes,
      calories: nutrition.calories,
      protein: nutrition.protein,
      fat: nutrition.fat,
      carbs: nutrition.carbs,
      // Состав перезаписываем только если исправляли массы специй.
      ingredients: seasoningFixes.length > 0 ? fixed : null,
    });
  }

  // ─── Отчёт ───
  console.log(`  блюд всего:              ${products.length}`);
  console.log(`  требуют обновления:      ${updates.length}`);
  console.log(`  без изменений:           ${products.length - updates.length - skipped.length}`);
  console.log(`  пропущено:               ${skipped.length}`);
  console.log(`  курируемых (уже на порцию): ${curated.length}`);

  if (updates.length > 0) {
    const avgOld = updates.reduce((s, u) => s + u.oldKcal, 0) / updates.length;
    const avgNew = updates.reduce((s, u) => s + u.newKcal, 0) / updates.length;
    const avgPortion = updates.reduce((s, u) => s + u.portionMass, 0) / updates.length;
    console.log(`\n  средняя калорийность:    ${avgOld.toFixed(0)} → ${avgNew.toFixed(0)} ккал`);
    console.log(`  средняя масса порции:    ${avgPortion.toFixed(0)} г (цель ${TARGET_PORTION_GRAMS} г)`);

    console.log('\n  Примеры:');
    for (const u of updates.slice(0, 8)) {
      console.log(
        `    ${u.name.slice(0, 34).padEnd(36)} ` +
          `${String(u.oldKcal).padStart(4)} → ${String(u.newKcal).padStart(4)} ккал · ` +
          `порций ${u.oldServings}→${u.newServings} · порция ${u.portionMass} г`,
      );
    }

    const withSeasoning = updates.filter((u) => u.seasoningFixes.length > 0);
    if (withSeasoning.length > 0) {
      console.log(`\n  Исправлены массы специй: в ${withSeasoning.length} блюдах`);
      for (const u of withSeasoning.slice(0, 4)) {
        console.log(`    ${u.name.slice(0, 34)}: ${u.seasoningFixes.slice(0, 3).join('; ')}`);
      }
    }
  }

  if (skipped.length > 0) {
    console.log('\n  Пропущены:');
    for (const s of skipped.slice(0, 6)) console.log(`    ${s.name.slice(0, 38)} — ${s.why}`);
  }

  if (dryRun) {
    console.log('\n  Запустите без --dry-run, чтобы применить.\n');
    await sequelize.close();
    return;
  }

  if (updates.length > 0) {
    await sequelize.transaction(async (t) => {
      for (const u of updates) {
        await sequelize.query(
          `UPDATE products
           SET calories = :calories, protein = :protein, fat = :fat, carbs = :carbs,
               servings = :servings,
               ingredients = COALESCE(:ingredients, ingredients)
           WHERE id = :id`,
          {
            replacements: {
              id: u.id,
              servings: u.newServings,
              calories: u.calories,
              protein: u.protein,
              fat: u.fat,
              carbs: u.carbs,
              ingredients: u.ingredients ? JSON.stringify(u.ingredients) : null,
            },
            transaction: t,
          },
        );
      }
    });
    console.log(`\n  Обновлено блюд: ${updates.length}.\n`);
  } else {
    console.log('\n  Все блюда уже согласованы.\n');
  }

  await sequelize.close();
}

void main();
