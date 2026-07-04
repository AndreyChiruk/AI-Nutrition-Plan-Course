
export const CATALOG_ALLERGEN_VALUES = [
  'лактоза',
  'глютен',
  'арахис',
  'орехи',
  'морепродукты',
  'яйца',
  'соя',
  'рыба',
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
