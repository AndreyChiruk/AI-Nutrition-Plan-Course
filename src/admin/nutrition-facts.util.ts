/**
 * Пищевая ценность ингредиентов на 100 г (или на единицу) и расчёт КБЖУ блюда.
 *
 * Зачем: раньше калорийность блюда считалась как `сумма всех граммов × 1.2`,
 * а белки/жиры/углеводы — как фиксированные доли от этих калорий (22/28/50 %).
 * Из-за этого вода, соль и специи учитывались наравне с мясом, а в каталоге
 * появлялись блюда по 2343 и 5394 ккал на «порцию» (средняя была 1115 ккал).
 *
 * Теперь КБЖУ считается по справочнику на 100 г, а несъедобные/нулевые
 * компоненты (вода, соль, специи, разрыхлитель) исключаются из суммы.
 */

export type Nutrition = {
  /** ккал на 100 г */
  kcal: number;
  /** белки, г на 100 г */
  protein: number;
  /** жиры, г на 100 г */
  fat: number;
  /** углеводы, г на 100 г */
  carbs: number;
};

/** Категория ингредиента для выбора значения по умолчанию. */
type Entry = Nutrition & { /** Регулярка для сопоставления названия. */ re: RegExp };

/**
 * Справочник. Порядок важен: более специфичные правила идут раньше общих
 * («масло оливковое» до «масло», «сыр» до «молоко»).
 * Значения — усреднённые справочные данные на 100 г продукта.
 */
const TABLE: Entry[] = [
  // --- Вода и «нулевые» компоненты: не дают калорий ---
  { re: /^(вода|бульон|лед|лёд)(?![а-яё])/i, kcal: 0, protein: 0, fat: 0, carbs: 0 },
  { re: /\b(water|broth|stock|ice)\b/iu, kcal: 0, protein: 0, fat: 0, carbs: 0 },

  // --- Бульоны: почти не дают калорий, важнее мясных правил ниже ---
  { re: /(бульон|broth|stock)(?![а-яё])/i, kcal: 10, protein: 1, fat: 0.2, carbs: 0.5 },

  // --- Вода, соль, лёд: строго нулевая калорийность ---
  // Проверяются ПЕРЕД специями: раньше «Соль» попадала в правило специй
  // и давала 30 ккал, хотя соль калорий не содержит вовсе.
  { re: /((?<![а-яё])(вода|соль|лед|лёд)(?![а-яё])|(^|[^а-я])(water|salt|ice)([^а-я]|$))/i, kcal: 0, protein: 0, fat: 0, carbs: 0 },

  // --- Специи, соль, сода, разрыхлитель: пренебрежимо ---
  {
    re: /((?<![а-яё])соль(?![а-яё])|перец(?!\s*слад)|паприка|куркума|корица|специи|приправ|лавров|орегано|базилик|тимьян|розмарин|петрушка|укроп|кинза|мята|ванил|сода|разрыхлител|дрожжи|имбир|мускат|кардамон|гвоздик|шафран|хмели|карри-порошок|порошок чили|сушен|зелень)/i,
    kcal: 30,
    protein: 1,
    fat: 0.5,
    carbs: 5,
  },
  { re: /(^|[^а-я])(salt|pepper(?!\s*mint)|spice|seasoning|herb|parsley|dill|basil|oregano|thyme|cinnamon|vanilla|baking powder|baking soda|yeast)([^а-я]|$)/i, kcal: 30, protein: 1, fat: 0.5, carbs: 5 },

  // --- Жиры и масла (910 ккал) ---
  // Порядок важен: сначала конкретные виды масла, затем общее «масло».
  // Названия в каталоге встречаются в обоих порядках («оливковое масло»,
  // «масло оливковое экстра вирджин»), поэтому проверяем оба.
  { re: /(оливков[а-яё]*\s+масл|масл[а-яё]*\s+оливков|olive oil)/i, kcal: 884, protein: 0, fat: 100, carbs: 0 },
  { re: /(растительн[а-яё]*\s+масл|масл[а-яё]*\s+растительн|подсолнечн[а-яё]*\s+масл|кунжутн[а-яё]*\s+масл|рапсов[а-яё]*\s+масл|vegetable oil|sunflower oil|sesame oil|canola oil)/i, kcal: 884, protein: 0, fat: 100, carbs: 0 },
  { re: /(сливочн[а-яё]*\s+масл|масл[а-яё]*\s+сливочн|топлен[а-яё]*\s+масл|butter|margarine|маргарин|ghee)/i, kcal: 717, protein: 0.9, fat: 81, carbs: 0.1 },
  { re: /(кокосов[а-яё]*\s+масл|coconut oil)/i, kcal: 890, protein: 0, fat: 100, carbs: 0 },
  { re: /(масл|oil)(?![а-яё])/i, kcal: 884, protein: 0, fat: 100, carbs: 0 },
  { re: /(майонез|mayonnaise)/i, kcal: 680, protein: 1, fat: 75, carbs: 2 },
  { re: /(сметан|sour cream|creme fraiche|crème fraîche)/i, kcal: 210, protein: 2.8, fat: 20, carbs: 3.2 },
  { re: /(сливк|cream(?!\s*of)|heavy cream)/i, kcal: 340, protein: 2.5, fat: 36, carbs: 3 },

  // --- Сахар и сладости ---
  { re: /(сахар|sugar|мёд|мед(?![а-яё])|honey|сироп|syrup|патока|molasses|сгущён|condensed milk|джем|варенье|jam|повидло|какао-порошок|cocoa powder)/i, kcal: 380, protein: 1, fat: 3, carbs: 92 },

  // --- Крупы и макароны (сухой вес) ---
  { re: /(рис|rice)/i, kcal: 350, protein: 7, fat: 1, carbs: 78 },
  { re: /(греч|buckwheat)/i, kcal: 340, protein: 13, fat: 3.4, carbs: 72 },
  { re: /(овсян|oat|овсян[а-яё]* хлоп|oatmeal)/i, kcal: 370, protein: 13, fat: 7, carbs: 62 },
  { re: /(макарон| pasta|спагетти|spaghetti|лапша|noodle|пенне|penne|фарфалле|farfalle|ригатони|rigatoni|тортеллини|tortellini)/i, kcal: 350, protein: 12, fat: 1.5, carbs: 72 },
  { re: /(мука|flour)/i, kcal: 340, protein: 10, fat: 1.5, carbs: 72 },
  { re: /(булгур|bulgur|кускус|couscous|перловк|полба|quinoa|киноа)/i, kcal: 340, protein: 12, fat: 2, carbs: 70 },
  { re: /(хлеб|bread|батон|baguette|булочк|bun|лаваш|pita|тортиль|tortilla|сухар|crouton)/i, kcal: 265, protein: 9, fat: 3, carbs: 49 },
  { re: /(крахмал|starch|панировк|breadcrumb)/i, kcal: 340, protein: 1, fat: 0.5, carbs: 83 },

  { re: /(сырник|syrniki|творожн(ая|ый) (запекан|олад))/i, kcal: 220, protein: 14, fat: 10, carbs: 20 },
  // Шоколад должен проверяться ДО молока: «молочный шоколад»
  // иначе распознаётся как молоко (60 ккал вместо 540).
  { re: /(шоколад|chocolate)/i, kcal: 540, protein: 6, fat: 35, carbs: 52 },
  // --- Мясо, птица, рыба ---
  // ВАЖНО: правило яиц должно стоять ВЫШЕ правила курицы, иначе
  // «Яйцо куриное» распознаётся как куриная грудка (165 ккал, Б31).
  { re: /(яйц|яиц|egg|яичн)/i, kcal: 155, protein: 13, fat: 11, carbs: 1.1 },
  // «куриное» без «яйц» — это мясо; сочетание «яйцо куриное» перехвачено выше.
  { re: /(куриц|курин|куриная|куриные|chicken|кура(?![а-яё]))/i, kcal: 165, protein: 31, fat: 3.6, carbs: 0 },
  { re: /(индейк|turkey)/i, kcal: 150, protein: 29, fat: 3, carbs: 0 },
  { re: /(говядин|говяж|beef|телятин|veal)/i, kcal: 250, protein: 26, fat: 15, carbs: 0 },
  { re: /(свинин|свиная|pork|бекон|bacon|ветчин|ham|колбас|sausage|салями|salami)/i, kcal: 300, protein: 18, fat: 25, carbs: 1 },
  { re: /(баранин|lamb|ягнен|козлятин|goat meat)/i, kcal: 250, protein: 25, fat: 16, carbs: 0 },
  { re: /(утк|duck|гус(ь|я|и|ей)|goose)/i, kcal: 330, protein: 19, fat: 28, carbs: 0 },
  { re: /(фарш|mince|minced)/i, kcal: 250, protein: 20, fat: 18, carbs: 0 },
  { re: /(рыб|fish|лосос|salmon|треск|cod|тунец|tuna|скумбр|mackerel|сельд|herring|минтай|хек|камбал|палтус|форель|trout|сардин|sardine|анчоус|anchovy|горбуш|семг|tilapia|тилапия)/i, kcal: 190, protein: 21, fat: 11, carbs: 0 },
  { re: /(кревет|shrimp|prawn|миди|mussel|кальмар|squid|осьминог|octopus|краб|crab|лобстер|lobster|морепродукт|seafood)/i, kcal: 110, protein: 20, fat: 2, carbs: 1 },
  { re: /(икра|caviar|roe)/i, kcal: 250, protein: 25, fat: 16, carbs: 2 },

  // --- Яйца и молочное ---
  { re: /(сыр|cheese|пармезан|parmesan|моцарелл|mozzarella|чеддер|cheddar|фета|feta|рикотт|ricotta|брынз|творожн[а-яё]* сыр)/i, kcal: 350, protein: 24, fat: 27, carbs: 2 },
  { re: /(творог|cottage cheese|quark|рикотт|ricotta)/i, kcal: 160, protein: 17, fat: 9, carbs: 3 },
  { re: /(йогурт|yogurt|yoghurt|кефир|kefir|ряженк|простокваш|айран)/i, kcal: 65, protein: 5, fat: 2.5, carbs: 5 },
  { re: /(молок|milk)/i, kcal: 60, protein: 3.2, fat: 3.2, carbs: 4.8 },
  { re: /(тофу| tofu|tempeh|темпе|соев[а-яё]* творог)/i, kcal: 145, protein: 16, fat: 9, carbs: 3 },

  // --- Бобовые и орехи ---
  { re: /(фасол|bean|боб(?![а-яё])|горох|pea(?![а-яё])|чечевиц|lentil|нут|chickpea|garbanzo)/i, kcal: 330, protein: 23, fat: 2, carbs: 57 },
  { re: /(орех|nut|миндал|almond|фундук|hazelnut|кешью|cashew|грецк|walnut|фисташк|pistachio|арахис|peanut)/i, kcal: 600, protein: 20, fat: 54, carbs: 13 },
  { re: /(семечк|seed|кунжут|sesame|семена)/i, kcal: 570, protein: 20, fat: 48, carbs: 18 },
  { re: /(кокос|coconut)/i, kcal: 350, protein: 3.5, fat: 33, carbs: 15 },

  // --- Овощи и фрукты ---
  { re: /(картофел|картошк|potato)/i, kcal: 80, protein: 2, fat: 0.2, carbs: 17 },
  { re: /(помидор|томат|tomato)/i, kcal: 20, protein: 1, fat: 0.2, carbs: 4 },
  { re: /(огурец|огурц|cucumber)/i, kcal: 15, protein: 0.7, fat: 0.1, carbs: 3.6 },
  { re: /(лук|onion|чеснок|garlic|шалот|shallot|порей|leek)/i, kcal: 40, protein: 1.4, fat: 0.2, carbs: 9 },
  { re: /(морков|carrot)/i, kcal: 40, protein: 1, fat: 0.2, carbs: 9 },
  { re: /(капуст|cabbage|брокколи|broccoli|цветн|cauliflower|брюссель|brussels)/i, kcal: 30, protein: 2, fat: 0.3, carbs: 5 },
  { re: /(баклажан|eggplant|aubergine|кабачок|цукини|zucchini|тыкв|pumpkin|squash)/i, kcal: 25, protein: 1, fat: 0.2, carbs: 5 },
  { re: /(шпинат|spinach|салат|lettuce|руккол|arugula|зелен|greens|сельдерей|celery|спарж|asparagus|фенхел|fennel|артишок|artichoke)/i, kcal: 20, protein: 1.5, fat: 0.2, carbs: 3 },
  { re: /(гриб|mushroom|шампиньон|вешенк)/i, kcal: 25, protein: 3, fat: 0.3, carbs: 3 },
  { re: /(свекл|beet|реп[ау](?![а-яё])|turnip|редьк|radish|редис)/i, kcal: 35, protein: 1.2, fat: 0.2, carbs: 8 },
  { re: /(кукуруз|corn|маис)/i, kcal: 90, protein: 3.3, fat: 1.2, carbs: 19 },
  { re: /(банан|banana|plantain)/i, kcal: 89, protein: 1.1, fat: 0.3, carbs: 23 },
  { re: /(яблок|apple|груш|pear|персик|peach|абрикос|apricot|слив|plum|вишн|cherry|черешн|виноград|grape|апельсин|orange|мандарин|mandarin|лимон|lemon|лайм|lime|ягод|berr|клубник|strawberr|малин|raspberr|черник|blueberr|смородин|currant|арбуз|watermelon|дын|melon|манго|mango|ананас|pineapple|авокадо|avocado|киви|kiwi|инжир|fig|финик|date|изюм|raisin|чернослив|prune|кураг)/i, kcal: 55, protein: 0.7, fat: 0.3, carbs: 13 },

  // --- Соусы и прочее ---
  { re: /(соев[а-яё]* соус|soy sauce|уксус|vinegar|горчиц|mustard|кетчуп|ketchup|томатн[а-яё]* паст|tomato paste|ткемали|аджик|хрен|васаби|fish sauce|рыбн[а-яё]* соус)/i, kcal: 80, protein: 3, fat: 1, carbs: 12 },
  { re: /(дрожж|yeast)/i, kcal: 100, protein: 12, fat: 2, carbs: 10 },
];

/** Значение по умолчанию, если ингредиент не распознан. */
const DEFAULT_NUTRITION: Nutrition = { kcal: 150, protein: 5, fat: 5, carbs: 15 };

/** Ингредиенты, которые не должны учитываться в массе блюда. */
const NON_MASS = /^(вода|бульон|лед|лёд|соль|перец|специи|приправ)/i;

export function lookupNutrition(name: string): Nutrition {
  const n = String(name ?? '').toLowerCase().replace(/ё/g, 'е').trim();
  if (!n) return DEFAULT_NUTRITION;
  for (const entry of TABLE) {
    if (entry.re.test(n)) {
      return { kcal: entry.kcal, protein: entry.protein, fat: entry.fat, carbs: entry.carbs };
    }
  }
  return DEFAULT_NUTRITION;
}

export function isNonMassIngredient(name: string): boolean {
  return NON_MASS.test(String(name ?? '').trim());
}

export type IngredientLike = {
  name: string;
  grams?: number | null;
  amount?: number | null;
};

export type ComputedNutrition = {
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Суммарная масса учитываемых ингредиентов, г. */
  totalGrams: number;
  /** Сколько ингредиентов не удалось распознать (использовано значение по умолчанию). */
  unrecognized: number;
};

/**
 * Считает КБЖУ блюда по составу.
 *
 * @param ingredients состав блюда с массой в граммах
 * @param servings число порций в рецепте (по умолчанию 1)
 */
export function computeDishNutrition(
  ingredients: IngredientLike[],
  servings = 1,
): ComputedNutrition {
  const divisor = servings > 0 ? servings : 1;
  let calories = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  let totalGrams = 0;
  let unrecognized = 0;

  for (const ing of ingredients ?? []) {
    const grams = Number(ing?.grams ?? ing?.amount ?? 0);
    if (!Number.isFinite(grams) || grams <= 0) continue;

    const name = String(ing?.name ?? '');
    // Вода/соль/специи не добавляют калорий, но и не должны раздувать массу.
    if (isNonMassIngredient(name)) continue;

    const per100 = lookupNutrition(name);
    if (per100 === DEFAULT_NUTRITION) unrecognized += 1;

    const k = grams / 100;
    calories += per100.kcal * k;
    protein += per100.protein * k;
    fat += per100.fat * k;
    carbs += per100.carbs * k;
    totalGrams += grams;
  }

  return {
    calories: Math.round(calories / divisor),
    protein: Math.round((protein / divisor) * 10) / 10,
    fat: Math.round((fat / divisor) * 10) / 10,
    carbs: Math.round((carbs / divisor) * 10) / 10,
    totalGrams: Math.round(totalGrams / divisor),
    unrecognized,
  };
}
