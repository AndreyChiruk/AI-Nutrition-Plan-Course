import { Product } from '../models/Product';
import {
  ALLERGEN_INGREDIENTS,
  ALLERGEN_SYNONYMS,
  DIET_FORBIDDEN_INGREDIENTS,
  DIET_SYNONYMS,
} from './slovari';

export type DietaryRestrictionKey =
  | 'vegetarian'
  | 'vegan'
  | 'lactose-free'
  | 'gluten-free'
  | 'keto'
  | 'paleo'
  | 'low-carb'
  | 'high-protein';

const n = (s: string) => s.toLowerCase();

const DIET_SYNONYMS_MAP = Object.fromEntries(
  Object.entries(DIET_SYNONYMS).map(([k, v]) => [n(String(k).trim()), n(String(v).trim())]),
) as Record<string, DietaryRestrictionKey>;

const DIET_FORBIDDEN_INGREDIENTS_MAP: Record<DietaryRestrictionKey, string[]> = {
  vegetarian: (DIET_FORBIDDEN_INGREDIENTS.vegetarian ?? []).map((x) => n(String(x))),
  vegan: (DIET_FORBIDDEN_INGREDIENTS.vegan ?? []).map((x) => n(String(x))),
  'lactose-free': (DIET_FORBIDDEN_INGREDIENTS['lactose-free'] ?? []).map((x) => n(String(x))),
  'gluten-free': (DIET_FORBIDDEN_INGREDIENTS['gluten-free'] ?? []).map((x) => n(String(x))),
  keto: (DIET_FORBIDDEN_INGREDIENTS.keto ?? []).map((x) => n(String(x))),
  paleo: (DIET_FORBIDDEN_INGREDIENTS.paleo ?? []).map((x) => n(String(x))),
  'low-carb': (DIET_FORBIDDEN_INGREDIENTS['low-carb'] ?? []).map((x) => n(String(x))),
  'high-protein': (DIET_FORBIDDEN_INGREDIENTS['high-protein'] ?? []).map((x) => n(String(x))),
};

export function normalizeDietaryRestrictionKeys(restrictions: string[]): DietaryRestrictionKey[] {
  const out: DietaryRestrictionKey[] = [];
  for (const raw of restrictions ?? []) {
    const key = DIET_SYNONYMS_MAP[n(String(raw).trim())];
    if (key && !out.includes(key)) out.push(key);
  }
  return out;
}

function dietTokens(key: DietaryRestrictionKey): string[] {
  return DIET_FORBIDDEN_INGREDIENTS_MAP[key] ?? [];
}

function detailedIngredientNames(p: Product): string[] {
  const detailed = (p as Product & { ingredientsDetailed?: Array<{ name?: string }> }).ingredientsDetailed;
  if (!Array.isArray(detailed)) return [];
  return detailed
    .map((x) => n(String(x?.name ?? '').trim()))
    .filter(Boolean);
}

function simpleIngredientNames(p: Product): string[] {
  const raw = (p as Product).ingredients;
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => n(String((x as { name?: string })?.name ?? '').trim())).filter(Boolean);
}

function allergenProbeStrings(p: Product): string[] {
  const raw = (p as Product).allergens;
  if (!Array.isArray(raw)) return [];
  return raw.map((a) => n(String(a ?? '').trim())).filter(Boolean);
}

export function dietProbeStrings(p: Product): string[] {
  const chunks: string[] = [];
  for (const x of detailedIngredientNames(p)) chunks.push(x);
  for (const x of simpleIngredientNames(p)) chunks.push(x);
  const title = n(String(p.name ?? '').trim());
  if (title) chunks.push(title);
  for (const x of allergenProbeStrings(p)) chunks.push(x);
  return chunks;
}

function hasDietProbeContent(p: Product): boolean {
  return dietProbeStrings(p).length > 0;
}

function detailedHits(p: Product, keys: string[]): boolean {
  const blobs = dietProbeStrings(p);
  return blobs.some((ing) => keys.some((k) => ing.includes(k)));
}

const KNOWN_DIETARY_TAG_KEYS = new Set<DietaryRestrictionKey>([
  'vegetarian',
  'vegan',
  'lactose-free',
  'gluten-free',
  'keto',
  'paleo',
  'low-carb',
  'high-protein',
]);

function normalizedProductDietaryTags(p: Product): Set<DietaryRestrictionKey> {
  const raw = p.dietaryTags ?? [];
  const out = new Set<DietaryRestrictionKey>();
  for (const x of raw) {
    const s = n(String(x).trim());
    if (!s) continue;
    const mapped = DIET_SYNONYMS_MAP[s];
    if (mapped) out.add(mapped);
    else if (KNOWN_DIETARY_TAG_KEYS.has(s as DietaryRestrictionKey)) out.add(s as DietaryRestrictionKey);
  }
  return out;
}

function tagSatisfiesRestriction(tags: Set<DietaryRestrictionKey>, userKey: DietaryRestrictionKey): boolean {
  switch (userKey) {
    case 'vegetarian':
      return tags.has('vegetarian') || tags.has('vegan');
    case 'vegan':
      return tags.has('vegan');
    case 'lactose-free':
      return tags.has('lactose-free') || tags.has('vegan');
    case 'gluten-free':
      return tags.has('gluten-free');
    case 'keto':
      return tags.has('keto');
    case 'paleo':
      return tags.has('paleo');
    case 'low-carb':
      return tags.has('low-carb') || tags.has('keto');
    case 'high-protein':
      return tags.has('high-protein');
    default:
      return true;
  }
}

export function productViolatesCatalogDietaryTags(p: Product, userKey: DietaryRestrictionKey): boolean {
  const tags = normalizedProductDietaryTags(p);
  if (tags.size === 0) return false;
  return !tagSatisfiesRestriction(tags, userKey);
}

export function productViolatesVegetarian(p: Product): boolean {
  if (!hasDietProbeContent(p)) return true;
  return detailedHits(p, dietTokens('vegetarian'));
}

export function productViolatesVegan(p: Product): boolean {
  if (!hasDietProbeContent(p)) return true;
  return detailedHits(p, dietTokens('vegan'));
}

export function productViolatesLactoseFree(p: Product): boolean {
  if (!hasDietProbeContent(p)) return true;
  return detailedHits(p, dietTokens('lactose-free'));
}

export function productViolatesGlutenFree(p: Product): boolean {
  if (!hasDietProbeContent(p)) return true;
  return detailedHits(p, dietTokens('gluten-free'));
}

export function productViolatesPaleo(p: Product): boolean {
  if (!hasDietProbeContent(p)) return true;
  return detailedHits(p, dietTokens('paleo'));
}

export function productTooCarbyForKetoSingleSlot(p: Product, dailyCarbBudget = 50): boolean {
  return Number(p.carbs) > dailyCarbBudget * 0.45;
}

export function productLowCarbFriendly(p: Product): boolean {
  return Number(p.carbs) < 35;
}

export function proteinShare(p: Product): number {
  const c = Math.max(1, Number(p.calories));
  return (Number(p.protein) * 4) / c;
}

export function productHighProteinOk(p: Product): boolean {
  return proteinShare(p) >= 0.28;
}

export function productLooksLikeAlcoholicSnack(p: Product): boolean {
  const sid = n(String((p as Product).sourceMealId ?? '').trim());
  if (sid.startsWith('cocktaildb:')) return true;

  const blobs = [...dietProbeStrings(p)];
  const desc = n(String((p as Product).description ?? '').trim());
  if (desc) blobs.push(desc);
  const cuis = n(String((p as Product).cuisine ?? '').trim());
  if (cuis === 'напитки') blobs.push(cuis);

  const tokenSplit = (b: string) => b.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
  const alcoholWords = new Set([
    'водка',
    'коньяк',
    'шампанское',
    'пиво',
    'сидр',
    'эль',
    'лагер',
    'портер',
    'ром',
    'джин',
    'виски',
    'бренди',
    'ликёр',
    'ликер',
    'текила',
    'абсент',
    'вермут',
    'граппа',
    'настойка',
    'глинтвейн',
    'алкоголь',
    'кагор',
    'херес',
    'портвейн',
    'мартини',
    'вино',
    'эпплджек',
    'wine',
    'champagne',
    'cognac',
    'vodka',
    'beer',
    'cider',
    'rum',
    'gin',
    'whiskey',
    'whisky',
    'brandy',
    'liqueur',
    'tequila',
    'prosecco',
    'sherry',
    'martini',
    'cocktail',
    'коктейль',
    'sake',
    'просекко',
    'игристое',
    'спиртное',
    'applejack',
    'stout',
    'porter',
    'pilsner',
    'ipa',
    'корона',
    'мохито',
    'маргарита',
    'дайкири',
    'сангрия',
    'aperol',
    'апероль',
    'Беллини',
    'bellini',
    'шот',
    'shot',
    'фizzes',
    'физз',
  ].map((x) => x.toLowerCase()));
  const phraseHints = [
    'шампан',
    'игрист',
    'алкогол',
    'спиртное',
    'портвейн',
    'белое вино',
    'красное вино',
    'сухое вино',
    'port wine',
    'коктейль',
    'лимонная корона',
    'lime corona',
    ' lemon corona',
    'corona extra',
    'джин-тоник',
    'gin tonic',
    'gin and tonic',
    'vodka tonic',
    'bloody mary',
    'бренди сауэр',
    'irish cream',
    'баилейс',
    'baileys',
    'крепость напитка',
    'spirits',
    'liquor',
    'hard cider',
  ];
  for (const raw of blobs) {
    const b = raw;
    if (/безалкоголь|mocktail|soft\s+drink|без\s+алкогол|non-alcoholic|non alcoholic/i.test(b)) continue;
    if (phraseHints.some((h) => b.includes(h))) return true;
    for (const t of tokenSplit(b)) {
      const tl = t.toLowerCase();
      if (alcoholWords.has(tl)) return true;
    }
  }
  return false;
}

function checkViolationsDictOnly(p: Product, key: DietaryRestrictionKey): boolean {
  switch (key) {
    case 'vegetarian':
      return productViolatesVegetarian(p);
    case 'vegan':
      return productViolatesVegan(p);
    case 'lactose-free':
      return productViolatesLactoseFree(p);
    case 'gluten-free':
      return productViolatesGlutenFree(p);
    case 'paleo':
      return productViolatesPaleo(p);
    case 'keto':
      return productTooCarbyForKetoSingleSlot(p, 50);
    case 'low-carb':
      return !productLowCarbFriendly(p);
    case 'high-protein':
      return !productHighProteinOk(p);
    default:
      return false;
  }
}

function checkViolations(p: Product, key: DietaryRestrictionKey): boolean {
  return checkViolationsDictOnly(p, key) || productViolatesCatalogDietaryTags(p, key);
}

export function filterProductsByDietary(products: Product[], restrictions: string[]): Product[] {
  const keys = normalizeDietaryRestrictionKeys(restrictions);
  if (keys.length === 0) return products;
  return products.filter((p) => !keys.some((k) => checkViolations(p, k)));
}

export function getDietWarningsForProduct(p: Product, restrictions: string[]): string[] {
  const keys = normalizeDietaryRestrictionKeys(restrictions);
  const out: string[] = [];
  for (const k of keys) {
    if (checkViolations(p, k)) {
      out.push(labelDiet(k));
    }
  }
  return out;
}

function labelDiet(k: DietaryRestrictionKey): string {
  const map: Record<DietaryRestrictionKey, string> = {
    vegetarian: 'не вегетарианское',
    vegan: 'не веганское',
    'lactose-free': 'может содержать лактозу',
    'gluten-free': 'может содержать глютен',
    paleo: 'не палео',
    keto: 'много углеводов для кето',
    'low-carb': 'много углеводов для НУД',
    'high-protein': 'мало белка для высокобелковой диеты',
  };
  return map[k] ?? k;
}

const ALLERGEN_SYNONYMS_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ALLERGEN_SYNONYMS).map(([k, v]) => [n(String(k).trim()), n(String(v).trim())]),
);

const ALLERGEN_EXPANSION: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALLERGEN_INGREDIENTS).map(([k, arr]) => [
    n(String(k).trim()),
    Array.isArray(arr) ? arr.map((x) => n(String(x))) : [],
  ]),
);

function normalizedAllergenToken(raw: string): string {
  const x = n(String(raw).trim());
  return ALLERGEN_SYNONYMS_MAP[x] ?? x;
}

function allergenTokensMatch(catalogRaw: string, userRaw: string): boolean {
  const na = normalizedAllergenToken(catalogRaw);
  const nb = normalizedAllergenToken(userRaw);
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const expandA = ALLERGEN_EXPANSION[na] ?? [];
  const expandB = ALLERGEN_EXPANSION[nb] ?? [];
  if (expandA.some((ex) => nb.includes(ex) || ex.includes(nb))) return true;
  if (expandB.some((ex) => na.includes(ex) || ex.includes(na))) return true;
  return false;
}

export function catalogAllergenHitsUser(product: Product, userAllergenNames: Set<string>): boolean {
  const catalog = product.allergens ?? [];
  if (!catalog.length || userAllergenNames.size === 0) return false;
  for (const cat of catalog) {
    for (const userTag of userAllergenNames) {
      if (allergenTokensMatch(cat, userTag)) return true;
    }
  }
  return false;
}

export function productHasUserAllergen(product: Product, userAllergenNames: Set<string>): boolean {
  if (userAllergenNames.size === 0) return false;
  if (catalogAllergenHitsUser(product, userAllergenNames)) return true;

  const detailedNames = detailedIngredientNames(product);
  if (detailedNames.length === 0) return true;
  for (const userTag of userAllergenNames) {
    const raw = n(userTag);
    const key = ALLERGEN_SYNONYMS_MAP[raw] ?? raw;
    const expand = ALLERGEN_EXPANSION[key];
    if (detailedNames.some((ing) => ing.includes(key))) return true;
    if (!expand) continue;
    for (const ex of expand) {
      if (detailedNames.some((ing) => ing.includes(ex))) return true;
    }
  }
  return false;
}

export const CALORIE_BANDS: Record<'low' | 'medium' | 'high' | 'sport', readonly [number, number]> = {
  low: [1400, 1700],
  medium: [1800, 2200],
  high: [2300, 2800],
  sport: [2800, 3500],
};

export function dayCaloriesFromBand(
  band: keyof typeof CALORIE_BANDS,
  dayIndex: number,
): number {
  const [lo, hi] = CALORIE_BANDS[band] ?? CALORIE_BANDS.medium;
  const span = Math.max(1, hi - lo);
  const t = ((dayIndex * 7919 + 31) % 1000) / 1000;
  return Math.round(lo + t * span);
}
