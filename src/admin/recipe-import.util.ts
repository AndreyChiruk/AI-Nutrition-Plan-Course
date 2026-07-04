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
  шт: 50,
};

export function parseMeasureToAmountUnit(rawMeasure: string | null | undefined): ParsedMeasure {
  const originalString = String(rawMeasure ?? '').trim();
  if (!originalString) return { amount: 1, unit: 'шт', grams: 50, originalString: '' };

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
  const grams = Math.max(0.5, Math.round((amount * (UNIT_TO_GRAMS[unit] ?? 50)) * 10) / 10);
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
  const parsed = parseMeasureToAmountUnit(measureRaw);
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
