
export const CATALOG_ALLERGEN_VALUES = [
  'лактоза',
  'глютен',
  'арахис',
  'орехи',
  'морепродукты',
  'яйца',
  'соя',
  'рыба',
  // Добавлены как распространённые аллергены (14 основных по стандарту ЕС).
  'кунжут',
  'горчица',
  'сельдерей',
] as const;
export type CatalogAllergenValue = (typeof CATALOG_ALLERGEN_VALUES)[number];

export const CATALOG_DIETARY_TAG_VALUES = [
  'vegetarian',
  'vegan',
  'lactose-free',
  'gluten-free',
  'keto',
  'paleo',
  'low-carb',
  'high-protein',
] as const;
export type CatalogDietaryTagValue = (typeof CATALOG_DIETARY_TAG_VALUES)[number];

const ALLOW_ALLERG = new Set<string>(CATALOG_ALLERGEN_VALUES);
const ALLOW_DIET = new Set<string>(CATALOG_DIETARY_TAG_VALUES);

const ALLERGEN_ALIASES: Record<string, CatalogAllergenValue> = {
  lactose: 'лактоза',
  молоко: 'лактоза',
  milk: 'лактоза',
  gluten: 'глютен',
  wheat: 'глютен',
  peanut: 'арахис',
  peanuts: 'арахис',
  nuts: 'орехи',
  nut: 'орехи',
  seafood: 'морепродукты',
  shellfish: 'морепродукты',
  egg: 'яйца',
  eggs: 'яйца',
  soy: 'соя',
  soya: 'соя',
  fish: 'рыба',
  sesame: 'кунжут',
  tahini: 'кунжут',
  mustard: 'горчица',
  celery: 'сельдерей',
  celeriac: 'сельдерей',
};

const DIETARY_ALIASES: Record<string, CatalogDietaryTagValue> = {
  vegetarian: 'vegetarian',
  вегетарианство: 'vegetarian',
  vegan: 'vegan',
  веган: 'vegan',
  'lactose-free': 'lactose-free',
  lactosefree: 'lactose-free',
  безлактозная: 'lactose-free',
  'gluten-free': 'gluten-free',
  glutenfree: 'gluten-free',
  безглютеновая: 'gluten-free',
  keto: 'keto',
  кето: 'keto',
  paleo: 'paleo',
  палео: 'paleo',
  'low-carb': 'low-carb',
  lowcarb: 'low-carb',
  низкоуглеводная: 'low-carb',
  'high-protein': 'high-protein',
  highprotein: 'high-protein',
  высокобелковая: 'high-protein',
};

export function normalizeCatalogAllergenToken(raw: string): CatalogAllergenValue | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  const mapped = ALLERGEN_ALIASES[s] ?? (ALLOW_ALLERG.has(s) ? (s as CatalogAllergenValue) : null);
  return mapped ?? null;
}

export function normalizeCatalogAllergenList(values: unknown): CatalogAllergenValue[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<CatalogAllergenValue>();
  for (const raw of values) {
    const n = normalizeCatalogAllergenToken(String(raw));
    if (n) out.add(n);
  }
  return [...out];
}

/** Результат «расширяющей» нормализации: что распознали, а что сохранили как есть. */
export type AllergenNormalizationResult = {
  /** Значения из справочника (безопасны для фильтрации и сравнения). */
  recognized: CatalogAllergenValue[];
  /** Значения, которых нет в справочнике, но которые НЕЛЬЗЯ терять. */
  unrecognized: string[];
  /** Полный список для сохранения: распознанные + нераспознанные. */
  all: string[];
};

/**
 * «Расширяющая» нормализация аллергенов для ответов модели и пользовательских данных.
 *
 * `normalizeCatalogAllergenList` отбрасывает всё, чего нет в справочнике.
 * Для каталога это приемлемо, но для РАСПОЗНАВАНИЯ ЕДЫ — опасно: если модель
 * вернула «майонез» или «сыр», значение исчезало, `hasDetectedAllergensInDish`
 * становился false, и пользователь НЕ получал предупреждение об аллергене,
 * хотя вещество в блюде есть. Это ложная безопасность.
 *
 * Здесь неизвестные значения сохраняются: их можно показать пользователю
 * и записать в `meal_items.allergensFound` (тип varchar[] это позволяет).
 */
export function normalizeAllergensExpanding(values: unknown): AllergenNormalizationResult {
  if (!Array.isArray(values)) return { recognized: [], unrecognized: [], all: [] };

  const recognized = new Set<CatalogAllergenValue>();
  const unrecognized = new Set<string>();

  for (const raw of values) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const mapped = normalizeCatalogAllergenToken(text);
    if (mapped) {
      recognized.add(mapped);
      continue;
    }
    // Неизвестное значение сохраняем в исходном виде (ограничив длину),
    // чтобы не потерять потенциальный аллерген.
    const clean = text.toLowerCase().slice(0, 64);
    if (clean) unrecognized.add(clean);
  }

  return {
    recognized: [...recognized],
    unrecognized: [...unrecognized],
    all: [...recognized, ...unrecognized],
  };
}

export function normalizeCatalogDietaryTagToken(raw: string): CatalogDietaryTagValue | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!s) return null;
  const mapped = DIETARY_ALIASES[s] ?? (ALLOW_DIET.has(s) ? (s as CatalogDietaryTagValue) : null);
  return mapped ?? null;
}

export function normalizeCatalogDietaryTagList(values: unknown): CatalogDietaryTagValue[] {
  if (!Array.isArray(values)) return [];
  const out = new Set<CatalogDietaryTagValue>();
  for (const raw of values) {
    const n = normalizeCatalogDietaryTagToken(String(raw));
    if (n) out.add(n);
  }
  const arr = [...out];
  if (arr.includes('vegan') && !arr.includes('vegetarian')) arr.push('vegetarian');
  return arr;
}
