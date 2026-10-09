/**
 * Дозаполнение служебных полей каталога: match_keywords, dietary_tags, allergens.
 *
 * Зачем: при импорте из TheMealDB эти поля не заполнялись (в `persistRecipe`
 * передавался пустой `allergens: []`, а `dietaryTags`/`matchKeywords` вообще
 * не передавались). В результате:
 *   - `match_keywords` пусто у ВСЕХ 669 блюд → поиск по ингредиентам,
 *     подбор по предпочтениям и дедупликация работают вслепую;
 *   - `allergens` пусто у 125 блюд → фильтр аллергенов по карточке товара
 *     не срабатывает (остаётся только эвристика по составу);
 *   - `dietary_tags` пусто у 89 блюд → диетические фильтры пропускают
 *     неподходящие блюда.
 *
 * Все значения вычисляются по составу блюда, а не «на глаз».
 *
 * Запуск:
 *   npm run backfill:catalog-tags            # применить
 *   npm run backfill:catalog-tags -- --dry-run
 */
import { Sequelize } from 'sequelize';
import { collectIngredientMatchRoots } from '../meal-plan/ingredient-match.util';
import {
  normalizeCatalogAllergenList,
  normalizeCatalogDietaryTagList,
} from '../meal-plan/catalog-ai-normalize';
import { ALLERGEN_INGREDIENTS } from '../meal-plan/slovari';
import { DIET_FORBIDDEN_INGREDIENTS } from '../meal-plan/slovari';
import { containsDietKey } from '../meal-plan/dietary-rules';

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

type Detail = { name?: string; grams?: number | null; amount?: number | null };
type Row = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  ingredients: Detail[] | null;
  ingredients_detailed: Detail[] | null;
  allergens: string[] | null;
  dietary_tags: string[] | null;
  match_keywords: unknown;
};

/** Приводит строку к нижнему регистру без «ё». */
const norm = (s: unknown) => String(s ?? '').toLowerCase().replace(/ё/g, 'е').trim();

/**
 * Определяет аллергены блюда по названиям ингредиентов.
 * Использует словарь ALLERGEN_INGREDIENTS (корни слов).
 */
function detectAllergens(ingredientNames: string[]): string[] {
  const hay = ingredientNames.map(norm).join(' | ');
  if (!hay) return [];
  const found = new Set<string>();
  for (const [allergen, roots] of Object.entries(ALLERGEN_INGREDIENTS)) {
    for (const root of roots ?? []) {
      const r = norm(root);
      if (r.length >= 3 && hay.includes(r)) {
        found.add(norm(allergen));
        break;
      }
    }
  }
  return normalizeCatalogAllergenList([...found]);
}

/**
 * Определяет диетические теги по составу и КБЖУ.
 */
function detectDietaryTags(row: Row, ingredientNames: string[]): string[] {
  const hay = ingredientNames.map(norm).join(' | ');
  const tags: string[] = [];

  // Алкогольные напитки исключаем из диетических тегов: формально коктейль
  // может быть «веганским», но в плане питания он неуместен, а тег
  // пропустил бы его через диетические фильтры.
  const alcohol = /(водка|джин|ром\b|виски|виски|текила|абсент|вермут|ликер|ликёр|бренди|коньяк|кониак|шампан|просекко|вино|пиво|эль\b|лагер|сидр|саке|мартини|кампари|апероль|трипл сек|куантро|шартрез|бейлис|кассис|мараскино|амаретто|самбука|граппа|настойка|кальвадос|бурбон|скотч|джин-тоник|мохито|маргарита|дайкири|сангрия|коктейл)/;
  if (alcohol.test(hay)) return [];

  // Животные продукты → не вегетарианское.
  //
  // Проверка идёт по ОБЩЕМУ словарю DIET_FORBIDDEN_INGREDIENTS.
  // Раньше здесь были СВОИ регулярные выражения, дублирующие правила из
  // slovari.ts. Списки расходились: «мясо», «сардин», «донер», «фрикадел»
  // не покрывались, и «Капсалон» с составом «Мясо донер» получал
  // тег vegetarian. Теперь источник правил один.
  const containsAny = (haystack: string, roots: string[]): boolean =>
    roots.some((root) => containsDietKey(haystack, root));

  const vegetarianForbidden = DIET_FORBIDDEN_INGREDIENTS.vegetarian ?? [];
  const veganForbidden = DIET_FORBIDDEN_INGREDIENTS.vegan ?? [];

  const hasMeat = containsAny(hay, vegetarianForbidden);
  // Продукты животного происхождения, допустимые для вегетарианцев
  // (молоко, сыр, яйца). Желатин сюда НЕ входит: он в списке запрещённых,
  // так как делается из костей и хрящей.
  // Продукты животного происхождения, допустимые для вегетарианцев.
  //
  // ВАЖНО: проверка идёт по ОБЩЕМУ словарю, а не по локальному регулярному
  // выражению. Раньше здесь был собственный regex со словами «сыр», «молок»
  // и т. п., который не находил названия конкретных сыров: «Пармезан»
  // не содержит подстроку «сыр», поэтому «Риболлита» с пармезаном
  // не получала ни тега vegetarian, ни lactose-free.
  const animalNonMeatKeys = [
    'молок', 'сливк', 'сметан', 'кефир', 'йогурт', 'творог', 'сыр', 'лактоз', 'казеин',
    'сыворот', 'масло сливочн', 'сливочн', 'яйц', 'мёд', 'мед',
    'пармезан', 'моцарелл', 'фета', 'брынз', 'рикотт', 'маскарпоне', 'чеддер', 'гауда',
    'дорблю', 'камамбер', 'сулугуни', 'адыгейск',
    'ряженк', 'простокваш', 'айран', 'кумыс', 'мацони', 'катык',
    'milk', 'cream', 'cheese', 'yogurt', 'kefir', 'curd', 'butter', 'egg', 'honey',
    'parmesan', 'mozzarella', 'feta', 'ricotta', 'mascarpone', 'cheddar',
  ];
  const hasAnimal = containsAny(hay, animalNonMeatKeys);
  const dairy = containsAny(hay, [
    'молок', 'сливк', 'сметан', 'кефир', 'йогурт', 'творог', 'сыр', 'лактоз',
    'масло сливочн', 'сливочн', 'мороженое', 'сгущён', 'сгущен',
    'пармезан', 'моцарелл', 'фета', 'брынз', 'рикотт', 'маскарпоне', 'чеддер', 'гауда',
    'дорблю', 'камамбер', 'сулугуни', 'адыгейск',
    'ряженк', 'простокваш', 'айран', 'кумыс', 'мацони', 'катык',
    'milk', 'cream', 'cheese', 'yogurt', 'kefir', 'curd', 'butter',
    'parmesan', 'mozzarella', 'feta', 'ricotta', 'mascarpone', 'cheddar',
  ]);
  const gluten = /(пшениц|мука|хлеб|батон|булочк|макарон|паста|спагетти|лапша|вермишел|кускус|булгур|манк|ячмен|рожь|ржан|овсян|пиво|солод|панировк|тесто|печенье|торт|пирог|кекс|кекс|блин|оладь|вафл|крекер|сушк|багет|пита|тортиль)/;
  const highCarb = /(рис|картоф|картошк|мука|хлеб|сахар|мёд|мед\b|макарон|паста|банан|виноград|финик|изюм)/;

  // Веганство строже: помимо мяса исключаются молоко, яйца и мёд.
  if (!containsAny(hay, veganForbidden) && !hasAnimal) {
    tags.push('vegan');
  }
  if (!hasMeat) {
    tags.push('vegetarian');
  }
  if (!dairy && !hasMeat) {
    tags.push('lactose-free');
  }
  if (!gluten.test(hay)) {
    tags.push('gluten-free');
  }

  // Низкоуглеводная: мало углеводов на порцию.
  const carbs = Number(row.carbs ?? 0);
  if (carbs > 0 && carbs <= 20 && !highCarb.test(hay)) {
    tags.push('low-carb');
  }
  // Кето: очень мало углеводов и заметная доля жиров.
  if (carbs > 0 && carbs <= 12) {
    const fatKcal = Number(row.fat ?? 0) * 9;
    const kcal = Number(row.calories ?? 0) || 1;
    if (fatKcal / kcal >= 0.55) tags.push('keto');
  }
  // Высокобелковая: белок даёт ≥ 25 % калорий.
  const kcal = Number(row.calories ?? 0);
  if (kcal > 0 && (Number(row.protein ?? 0) * 4) / kcal >= 0.25) {
    tags.push('high-protein');
  }
  // Палео: без злаков, бобовых, молочного и сахара.
  const paleoForbidden = /(мука|хлеб|рис|макарон|паста|сахар|молок|сыр|творог|йогурт|боб|фасол|горох|чечевиц|нут|со[яи]|картоф|кукуруз|овсян)/;
  if (!paleoForbidden.test(hay) && !dairy) tags.push('paleo');

  return normalizeCatalogDietaryTagList(tags);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sequelize = createSequelize();

  console.log(`\nДозаполнение служебных полей каталога${dryRun ? ' (DRY-RUN)' : ''}\n`);

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error(`Не удалось подключиться к БД: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  try {
    const [raw] = await sequelize.query(
      `SELECT id, name, calories, protein, fat, carbs,
              ingredients, ingredients_detailed, allergens, dietary_tags, match_keywords
       FROM products ORDER BY name`,
    );
    const products = raw as Row[];

    type Update = {
      id: string;
      name: string;
      matchKeywords: string[];
      dietaryTags: string[];
      allergens: string[];
      changed: { keywords: boolean; diet: boolean; allergens: boolean };
    };
    const updates: Update[] = [];
    let noComposition = 0;

    for (const p of products) {
      const detailed = Array.isArray(p.ingredients_detailed) ? p.ingredients_detailed : [];
      const simple = Array.isArray(p.ingredients) ? p.ingredients : [];
      const composition = detailed.length > 0 ? detailed : simple;

      if (composition.length === 0) {
        noComposition += 1;
        continue;
      }

      const names = composition
        .map((i) => String(i?.name ?? '').trim())
        .filter(Boolean);

      // Корни слов для поиска/подбора по предпочтениям (включая уже
      // сохранённые ключевые слова, если они есть).
      const matchKeywords = collectIngredientMatchRoots(
        names.map((n) => ({ name: n })),
        p.match_keywords,
      )
        .filter((k) => k.length >= 3)
        .slice(0, 60);

      const dietaryTags = detectDietaryTags(p, names);

      // Аллергены: объединяем уже проставленные в карточке и вычисленные
      // по составу — ничего не теряем, только дополняем.
      const fromComposition = detectAllergens(names);
      const existing = Array.isArray(p.allergens) ? p.allergens : [];
      const allergens = normalizeCatalogAllergenList([...existing, ...fromComposition]);

      const currentKeywords = Array.isArray(p.match_keywords) ? p.match_keywords : [];
      const currentDiet = Array.isArray(p.dietary_tags) ? p.dietary_tags : [];

      // Диет-теги ПЕРЕСЧИТЫВАЕМ полностью: правила могли измениться
      // (например, мёд больше не считается веганским продуктом), а
      // «дополнение» оставило бы устаревшие теги на месте.
      const dietEqual =
        currentDiet.length === dietaryTags.length &&
        currentDiet.every((t) => dietaryTags.includes(String(t)));

      const changed = {
        keywords: currentKeywords.length === 0 && matchKeywords.length > 0,
        diet: !dietEqual,
        allergens: allergens.length > existing.length,
      };

      if (!changed.keywords && !changed.diet && !changed.allergens) continue;

      updates.push({ id: p.id, name: p.name, matchKeywords, dietaryTags, allergens, changed });
    }

    const addKeywords = updates.filter((u) => u.changed.keywords).length;
    const addDiet = updates.filter((u) => u.changed.diet).length;
    const addAllergens = updates.filter((u) => u.changed.allergens).length;

    console.log(`  блюд всего:                    ${products.length}`);
    console.log(`  без состава (пропущено):       ${noComposition}`);
    console.log(`  будет обновлено:               ${updates.length}`);
    console.log(`    • match_keywords дополнятся: ${addKeywords}`);
    console.log(`    • dietary_tags дополнятся:   ${addDiet}`);
    console.log(`    • allergens дополнятся:      ${addAllergens}`);

    if (updates.length > 0) {
      console.log('\n  Примеры:');
      for (const u of updates.slice(0, 5)) {
        console.log(`    ${u.name.slice(0, 38)}`);
        if (u.changed.keywords) {
          console.log(`      ключевые слова: ${u.matchKeywords.slice(0, 8).join(', ')}…`);
        }
        if (u.changed.diet) console.log(`      диета: ${u.dietaryTags.join(', ') || '—'}`);
        if (u.changed.allergens) console.log(`      аллергены: ${u.allergens.join(', ') || '—'}`);
      }
    }

    if (!dryRun && updates.length > 0) {
      await sequelize.transaction(async (t) => {
        for (const u of updates) {
          await sequelize.query(
            `UPDATE products
             SET match_keywords = :keywords::jsonb,
                 dietary_tags   = :diet::jsonb,
                 allergens      = :allergens
             WHERE id = :id`,
            {
              replacements: {
                keywords: JSON.stringify(u.matchKeywords),
                diet: JSON.stringify(u.dietaryTags),
                allergens: `{${u.allergens.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(',')}}`,
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
    } else {
      console.log('\n  Все поля уже заполнены — изменений не требуется.');
    }
    console.log('');
  } finally {
    await sequelize.close();
  }
}

void main();
