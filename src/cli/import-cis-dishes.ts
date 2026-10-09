/**
 * Импорт курируемых блюд СНГ-кухни в каталог.
 *
 * Отличие от прежних импортов (`recipe-import.util.ts`, TheMealDB):
 * данные НЕ тянутся из внешнего API, а берутся из составленного вручную
 * списка (`src/data/curated-cis-dishes.ts`).
 *
 * Ключевое требование — блюдо сразу должно полноценно работать во всех
 * разделах приложения, поэтому при импорте проставляются ВСЕ поля:
 *   - `calories/protein/fat/carbs` — вычисляются из состава по справочнику
 *     на 100 г, а не берутся готовыми (это исключает ошибки вида
 *     «Котлеты 1464 ккал», которые были при импорте из TheMealDB);
 *   - `ingredients` + `ingredientsDetailed` — состав, нужен для аллергенов
 *     и для подсказки «докупить в холодильник»;
 *   - `allergens` — определяются по составу через `ALLERGEN_INGREDIENTS`;
 *   - `dietary_tags` — веган/вегетарианское/без глютена и т. д.;
 *   - `match_keywords` — корни слов для поиска по предпочтениям;
 *   - `category` — сразу правильный слот (breakfast/lunch/dinner/snack),
 *     поэтому переклассификация не требуется;
 *   - `image_url` — остаётся пустым: интерфейс покажет локальную SVG-иконку
 *     по категории (см. `DishThumb`), внешняя зависимость не нужна.
 *
 * Запуск:
 *   npm run import:cis-dishes            # применить
 *   npm run import:cis-dishes -- --dry-run
 */
import { Sequelize } from 'sequelize';
import { CURATED_CIS_DISHES, type CuratedDish } from '../data/curated-cis-dishes';
import { computeDishNutrition, isNonMassIngredient, lookupNutrition } from '../admin/nutrition-facts.util';
import { ALLERGEN_INGREDIENTS } from '../meal-plan/slovari';
import { containsDietKey } from '../meal-plan/dietary-rules';
import { normalizeCatalogAllergenList } from '../meal-plan/catalog-ai-normalize';
import { collectIngredientMatchRoots } from '../meal-plan/ingredient-match.util';

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

/** Аллергены по составу блюда (те же правила, что в остальном приложении). */
function detectAllergens(names: string[]): string[] {
  const hay = names.join(' | ').toLowerCase();
  const found: string[] = [];
  for (const [allergen, roots] of Object.entries(ALLERGEN_INGREDIENTS)) {
    if ((roots ?? []).some((root) => containsDietKey(hay, root))) found.push(allergen);
  }
  return normalizeCatalogAllergenList(found);
}

/**
 * Диетические теги по составу.
 * Здесь намеренно ДУБЛИРУЕТСЯ логика `backfill-catalog-tags`, но не вызывается
 * сам скрипт: он работает по строкам БД, а импорт идёт из структуры.
 * После импорта рекомендуется всё равно прогнать `backfill:catalog-tags` —
 * он пересчитает теги единообразно для всего каталога.
 */
function detectDietTags(
  names: string[],
  nutrition: { calories: number; carbs: number; protein: number },
): string[] {
  const hay = names.join(' | ').toLowerCase();
  const hasAny = (roots: string[]) => roots.some((r) => containsDietKey(hay, r));

  const forbiddenVeg = [
    'мяс', 'куриц', 'курин', 'говяд', 'говяж', 'свинин', 'свиная', 'баранин', 'индейк', 'утк', 'кролик',
    'рыб', 'лосос', 'треск', 'сельд', 'скумбр', 'сардин', 'кревет', 'кальмар', 'миди', 'краб',
    'бекон', 'ветчин', 'колбас', 'сосиск', 'фарш', 'хамон', 'салями', 'субпродукт', 'ливер',
    // Копчёности и грудинка — это мясо, хотя слово «мяс» в названии отсутствует.
    'грудинк', 'копчёност', 'копченост', 'шейк', 'окорок', 'карбонад', 'буженин', 'ростбиф',
    'желатин',
  ];
  const animalNonMeat = [
    'молок', 'сыр', 'творог', 'йогурт', 'кефир', 'сметан', 'сливк', 'масло сливочн', 'яйц', 'мёд', 'мед',
    // Кисломолочные напитки: ряженка, простокваша, айран, кумыс, тан.
    'ряженк', 'простокваш', 'айран', 'кумыс', 'тан(?![а-яё])', 'мацони', 'катык', 'брынз',
  ];
  const dairy = [
    'молок', 'сыр', 'творог', 'йогурт', 'кефир', 'сметан', 'сливк', 'масло сливочн', 'мороженое',
    'ряженк', 'простокваш', 'айран', 'кумыс', 'мацони', 'катык', 'брынз',
  ];
  const gluten = ['пшениц', 'мука', 'хлеб', 'батон', 'макарон', 'лапша', 'манн', 'ячмен', 'перлов', 'овсян', 'печенье', 'тесто', 'блин'];

  const tags: string[] = [];
  const hasMeat = hasAny(forbiddenVeg);
  const hasAnimal = hasAny(animalNonMeat);

  if (!hasMeat && !hasAnimal) tags.push('vegan');
  if (!hasMeat) tags.push('vegetarian');
  if (!hasAny(dairy)) tags.push('lactose-free');
  if (!hasAny(gluten)) tags.push('gluten-free');
  if (nutrition.carbs > 0 && nutrition.carbs <= 20) tags.push('low-carb');
  if (nutrition.carbs > 0 && nutrition.carbs <= 10) tags.push('keto');
  // Высокобелковое: белок даёт не менее 25 % калорийности
  // (1 г белка = 4 ккал).
  if (nutrition.calories > 0 && (nutrition.protein * 4) / nutrition.calories >= 0.25) {
    tags.push('high-protein');
  }

  return tags;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sequelize = createSequelize();

  console.log(`\nИмпорт блюд СНГ-кухни${dryRun ? ' (DRY-RUN)' : ''}`);
  console.log(`В списке: ${CURATED_CIS_DISHES.length} блюд\n`);

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error(`Нет связи с БД: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  const inserted: string[] = [];
  const skipped: string[] = [];
  const errors: Array<{ name: string; error: string }> = [];

  for (const dish of CURATED_CIS_DISHES) {
    try {
      // Проверяем дубли по названию (регистр не важен).
      const [existing] = await sequelize.query(
        'SELECT id FROM products WHERE lower(name) = lower(:name) LIMIT 1',
        { replacements: { name: dish.name } },
      );
      if ((existing as unknown[]).length > 0) {
        skipped.push(dish.name);
        continue;
      }

      const names = dish.ingredients.map((i) => i.name);
      const nutrition = computeDishNutrition(
        dish.ingredients.map((i) => ({ name: i.name, grams: i.grams })),
        dish.servings,
      );

      const allergens = detectAllergens(names);
      const dietTags = detectDietTags(names, {
        calories: nutrition.calories,
        carbs: nutrition.carbs,
        protein: nutrition.protein,
      });
      const keywords = collectIngredientMatchRoots(
        dish.ingredients.map((i) => ({ name: i.name })),
        [],
      ).slice(0, 60);

      if (!dryRun) {
        await sequelize.query(
          `INSERT INTO products
             (id, name, category, calories, protein, fat, carbs,
              allergens, dietary_tags, ingredients, ingredients_detailed, match_keywords,
              description, servings, cooking_time_min, cuisine, meal_types,
              is_from_api, "createdAt", "updatedAt")
           VALUES
             (gen_random_uuid(), :name, :category, :calories, :protein, :fat, :carbs,
              :allergens::text[], :dietTags::jsonb, :ingredients::jsonb, :detailed::jsonb, :keywords::jsonb,
              :description, :servings, :cookingTimeMin, :cuisine, :mealTypes::jsonb,
              false, NOW(), NOW())`,
          {
            replacements: {
              name: dish.name,
              category: dish.category,
              calories: nutrition.calories,
              protein: nutrition.protein,
              fat: nutrition.fat,
              carbs: nutrition.carbs,
              allergens: `{${allergens.map((a) => `"${a}"`).join(',')}}`,
              dietTags: JSON.stringify(dietTags),
              ingredients: JSON.stringify(dish.ingredients.map((i) => ({ name: i.name, grams: i.grams }))),
              detailed: JSON.stringify(
                dish.ingredients.map((i) => ({
                  name: i.name,
                  grams: i.grams,
                  amount: isNonMassIngredient(i.name) ? 1 : i.grams,
                  unit: isNonMassIngredient(i.name) ? 'шт' : 'г',
                })),
              ),
              keywords: JSON.stringify(keywords),
              description: dish.description,
              servings: dish.servings,
              cookingTimeMin: dish.cookingTimeMin,
              cuisine: dish.cuisine,
              mealTypes: JSON.stringify(dish.mealTypes),
            },
          },
        );
      }

      inserted.push(dish.name);
      const known = dish.ingredients.filter((i) => lookupNutrition(i.name).kcal > 0).length;

      console.log(
        `  ${dryRun ? '·' : '+'} ${dish.name.padEnd(42)} ` +
          `${String(nutrition.calories).padStart(4)} ккал · ` +
          `известных ингредиентов ${known}/${dish.ingredients.length} · ` +
          `теги: ${dietTags.join(', ') || '—'}`,
      );
    } catch (e) {
      errors.push({ name: dish.name, error: e instanceof Error ? e.message : String(e) });
    }
  }

  console.log('\n─────────────────────────────');
  console.log(`  добавлено:  ${inserted.length}`);
  console.log(`  пропущено:  ${skipped.length}${skipped.length ? ` (${skipped.slice(0, 3).join(', ')}…)` : ''}`);
  console.log(`  ошибок:     ${errors.length}`);
  for (const e of errors) console.log(`    ${e.name}: ${e.error.slice(0, 90)}`);

  if (dryRun) {
    console.log('\n  Запустите без --dry-run, чтобы применить изменения.');
  } else {
    console.log('\n  Рекомендуется выполнить: npm run backfill:catalog-tags');
    console.log('  (пересчитает аллергены и теги единообразно для всего каталога)');
  }
  console.log('');

  await sequelize.close();
}

void main();
