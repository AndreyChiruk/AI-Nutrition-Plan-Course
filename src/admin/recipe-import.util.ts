import { randomUUID } from 'crypto';

export type ParsedMeasure = {
  amount: number;
  unit: string;
  grams: number;
  originalString: string;
};

const FRACTION_MAP: Record<string, number> = {
  '1/2': 0.5,
  '1/3': 1 / 3,
  '2/3': 2 / 3,
  '1/4': 0.25,
  '3/4': 0.75,
  '1/8': 0.125,
};

const UNIT_ALIASES: Record<string, string> = {
  g: 'г',
  gram: 'г',
  grams: 'г',
  gr: 'г',
  kg: 'кг',
  ml: 'мл',
  l: 'л',
  litre: 'л',
  liter: 'л',
  cup: 'чашка',
  cups: 'чашка',
  tbsp: 'ст.л.',
  tablespoon: 'ст.л.',
  tablespoons: 'ст.л.',
  tsp: 'ч.л.',
  teaspoon: 'ч.л.',
  teaspoons: 'ч.л.',
  pinch: 'щепотка',
  clove: 'шт',
  cloves: 'шт',
  slice: 'шт',
  slices: 'шт',
  can: 'шт',
  cans: 'шт',
  piece: 'шт',
  pieces: 'шт',
};

const UNIT_TO_GRAMS: Record<string, number> = {
  г: 1,
  кг: 1000,
  мл: 1,
  л: 1000,
  чашка: 240,
  'ст.л.': 15,
  'ч.л.': 5,
  щепотка: 0.5,
};

/**
 * Средний вес одной штуки по виду продукта, г.
 *
 * Раньше для всех «шт» использовалось фиксированное значение 50 г. Из-за этого
 * «600 шт» яиц превращались в 30 кг, и блюдо получало 47 877 ккал. Вес штуки
 * сильно зависит от продукта: яйцо ≈ 55 г, зубчик чеснока ≈ 5 г,
 * головка лука ≈ 75 г.
 */
const PIECE_WEIGHT_RULES: Array<{ re: RegExp; grams: number }> = [
  { re: /яйц|яйцо|яиц|egg/i, grams: 55 },
  { re: /чеснок|garlic|зубчик|clove/i, grams: 5 },
  { re: /лук|onion|шалот|shallot|порей|leek/i, grams: 75 },
  { re: /картоф|potato|картошк/i, grams: 150 },
  { re: /помидор|томат|tomato/i, grams: 120 },
  { re: /огур|огурц|cucumber/i, grams: 100 },
  { re: /морков|carrot/i, grams: 80 },
  { re: /перец|pepper/i, grams: 120 },
  { re: /кабачок|цукини|zucchini|баклажан|eggplant/i, grams: 200 },
  { re: /капуст|cabbage|брокколи|broccoli|цветн|cauliflower/i, grams: 400 },
  { re: /банан|banana/i, grams: 120 },
  { re: /яблок|apple|груш|pear|апельсин|orange|персик|peach/i, grams: 180 },
  { re: /лимон|lemon|лайм|lime/i, grams: 100 },
  { re: /авокадо|avocado/i, grams: 200 },
  { re: /куриц|курин|chicken|бедро|бедра|грудка|breast|ножк/i, grams: 200 },
  { re: /стейк|steak|филе|fillet/i, grams: 200 },
  { re: /хлеб|bread|булочк|bun|батон|baguette|лаваш|pita|тортиль|tortilla/i, grams: 60 },
  { re: /сыр|cheese|ломтик|slice/i, grams: 25 },
  { re: /колбас|sausage|сосиск|ветчин|ham|бекон|bacon/i, grams: 40 },
  { re: /рыб|fish|лосос|salmon|треск|cod|тунец|tuna|сельд|herring/i, grams: 150 },
  { re: /кревет|shrimp|prawn|миди|mussel|кальмар|squid|гребеш|scallop/i, grams: 15 },
  { re: /гриб|mushroom|шампиньон/i, grams: 25 },
  { re: /орех|nut|миндал|almond|фундук|кешью|cashew|грецк|walnut|фисташк|pistachio/i, grams: 5 },
];

/** Вес одной штуки по умолчанию, если продукт не распознан. */
const DEFAULT_PIECE_GRAMS = 60;

/** Разумный предел массы ингредиента в одном рецепте, г (защита от мусора). */
const MAX_INGREDIENT_GRAMS = 5000;

function pieceWeightFor(name: string): number {
  const n = String(name ?? '').toLowerCase().replace(/ё/g, 'е');
  for (const rule of PIECE_WEIGHT_RULES) {
    if (rule.re.test(n)) return rule.grams;
  }
  return DEFAULT_PIECE_GRAMS;
}

/**
 * Разбирает меру из рецепта («2 tbsp», «600 шт», «1/2 cup») в количество,
 * единицу и массу в граммах.
 *
 * @param rawMeasure строка меры из внешнего API
 * @param ingredientName название ингредиента — нужен для веса «штуки»
 *   (яйцо ≈ 55 г, зубчик чеснока ≈ 5 г, головка лука ≈ 75 г).
 *   Раньше для всех «шт» бралось 50 г, из-за чего «600 шт» яиц давали
 *   30 кг и блюдо на 47 877 ккал.
 */
export function parseMeasureToAmountUnit(
  rawMeasure: string | null | undefined,
  ingredientName = '',
): ParsedMeasure {
  const originalString = String(rawMeasure ?? '').trim();
  if (!originalString) {
    return { amount: 1, unit: 'шт', grams: pieceWeightFor(ingredientName), originalString: '' };
  }

  const normalized = originalString
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = normalized.split(' ');
  let amount = 0;
  let consumed = 0;
  for (const t of tokens) {
    if (/^\d+(\.\d+)?$/.test(t)) {
      amount += Number(t);
      consumed += 1;
      continue;
    }
    if (FRACTION_MAP[t] !== undefined) {
      amount += FRACTION_MAP[t];
      consumed += 1;
      continue;
    }
    break;
  }
  if (!Number.isFinite(amount) || amount <= 0) amount = 1;

  const unitRaw = tokens[consumed] ?? '';
  const unit = UNIT_ALIASES[unitRaw] ?? (unitRaw ? unitRaw : 'шт');

  // Масса: для весовых единиц — прямое умножение, для «штук» — по продукту.
  const perUnit = UNIT_TO_GRAMS[unit] ?? pieceWeightFor(ingredientName);
  const rawGrams = amount * perUnit;

  // Защита от мусора: 600 «штук» яиц, «чашка» соли и т.п. не должны
  // превращаться в десятки килограммов.
  const grams = Math.max(0.5, Math.min(MAX_INGREDIENT_GRAMS, Math.round(rawGrams * 10) / 10));
  return { amount, unit, grams, originalString };
}

export function inferIngredientCategoryRu(name: string): string {
  const n = String(name).toLowerCase();
  if (/кур|говя|свин|фарш|индей|бекон|ветчин|мяс/.test(n)) return 'Мясо';
  if (/рыб|лосос|тунец|треск|кревет|краб|мид|кальмар|омар/.test(n)) return 'Рыба и морепродукты';
  if (/молок|сыр|сливк|йогурт|творог|кефир|маскарпон/.test(n)) return 'Молочные продукты';
  if (/картоф|лук|морков|огур|помид|капуст|перец|чеснок|шпинат|салат/.test(n)) return 'Овощи';
  if (/рис|греч|макарон|лапш|овся|мук|круп|булгур|кускус/.test(n)) return 'Крупы и мучное';
  if (/соль|перец|паприк|куркум|корица|тмин|спец/.test(n)) return 'Специи';
  if (/масло|соус|майонез|кетчуп|уксус/.test(n)) return 'Соусы и масла';
  if (/сок|вода|чай|кофе|лимонад|сироп/.test(n)) return 'Напитки';
  return 'Прочее';
}

export function normalizeIngredientNameRu(name: string): string {
  const t = String(name ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export function makeIngredientDetail(
  ingredientNameRu: string,
  measureRaw: string | null | undefined,
  ingredientId?: string,
) {
  // Название ингредиента нужно для определения веса «штуки»:
  // яйцо ≈ 55 г, зубчик чеснока ≈ 5 г, головка лука ≈ 75 г.
  const parsed = parseMeasureToAmountUnit(measureRaw, ingredientNameRu);
  return {
    id: randomUUID(),
    name: normalizeIngredientNameRu(ingredientNameRu),
    amount: parsed.amount,
    unit: parsed.unit,
    grams: parsed.grams,
    originalString: parsed.originalString,
    ingredientId,
  };
}
