import { User } from '../models/User';
import { Allergen } from '../models/Allergen';
import { Product } from '../models/Product';
import { MealSlotSnapshot } from '../models/MealPlanDay';
import { ruHaystackMatchesKeyword, normalizeRuFoodText } from '../common/ingredient-name-match';
import { inferIngredientsFromDishTitle } from './ingredient-utils';
import { collectIngredientMatchRoots } from './ingredient-match.util';

export type MealSlotKey = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export const MAX_TEA_CUPS = 6;

export type SaveMealPlanDayDto = {
  dayNumber: number;
  breakfast: MealSlotSnapshot | null;
  lunch: MealSlotSnapshot | null;
  dinner: MealSlotSnapshot | null;
  snack: MealSlotSnapshot | null;
  extraSnacks?: MealSlotSnapshot[] | null;
};

export type PreferenceContext = {
  /** Отдельные фразы из профиля (без перекрёстного расширения) — для проверки «каждое любимое учтено». */
  baseLikes: string[];
  likes: string[];
  dislikes: string[];
  fridgeNames: string[];
  /**
   * Пищевые привычки из профиля (`users.food_habits`).
   * Раньше поле только сохранялось и отдавалось в API, но в планировании
   * не использовалось вовсе — «учтём ваши привычки» было фикцией.
   */
  habits: {
    /** Сколько чашек чая/кофе в день добавлять перекусом. */
    teaCupsPerDay: number;
    /** Число приёмов пищи в день (3 или 4), если задано. */
    mealsPerDay: number | null;
    /** Предпочитает ли пользователь домашнюю еду. */
    prefersHomeCooking: boolean;
  };
};

export function normalizeKeywordList(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => String(v).trim().toLowerCase())
    .filter(Boolean);
}

export function expandDislikeKeywords(keys: string[]): string[] {
  const s = new Set(keys);
  for (const x of keys) {
    if (/греч/i.test(x)) {
      s.add('греч');
      s.add('гречн');
    }
  }
  return [...s];
}

export function expandSingleLikeKeyword(key: string): string[] {
  const k = String(key ?? '')
    .trim()
    .toLowerCase();
  if (!k) return [];
  const s = new Set<string>([k]);
  if (ruHaystackMatchesKeyword(k, 'суп')) {
    s.add('борщ');
    s.add('уха');
    s.add('солян');
    s.add('похлеб');
    s.add('рамен');
    s.add('том ям');
  }
  return [...s];
}

export function expandLikeKeywords(keys: string[]): string[] {
  const s = new Set<string>();
  for (const key of keys) {
    for (const x of expandSingleLikeKeyword(key)) {
      s.add(x);
    }
  }
  return [...s];
}

/** Возраст в полных годах или null, если дата не задана. */
export function ageFromBirthDate(raw: unknown): number | null {
  if (!raw) return null;
  const d = new Date(String(raw));
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

/**
 * Снимок ограничений пользователя для сохранения в план.
 */
export function restrictionSnapshot(
  user: User & { allergens?: Array<Allergen | string> },
): Record<string, unknown> {
  const allergies = Array.isArray(user.allergens)
    ? [...user.allergens]
        .map((a) =>
          (typeof a === 'object' && a !== null && 'name' in a
            ? String((a as { name?: unknown }).name ?? '')
            : String(a ?? '')
          )
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean)
        .sort()
    : [];
  const restrictions = Array.isArray(user.dietaryRestrictions)
    ? [...user.dietaryRestrictions]
        .map((d) => String(d).trim().toLowerCase())
        .filter(Boolean)
        .sort()
    : [];
  const dislikes = normalizeKeywordList(user.foodDislikes).sort();

  return {
    allergens: allergies,
    diet: restrictions,
    dislikes,
    goal: user.goal ?? null,
    age: ageFromBirthDate(user.birthDate),
  };
}

/**
 * Отличаются ли текущие ограничения пользователя от снимка в плане.
 */
export function restrictionDiff(
  user: User,
  snapshot: Record<string, unknown> | null,
): Array<{ field: string; label: string; before: string; after: string }> {
  if (!snapshot) return [];

  const current = restrictionSnapshot(user);
  const diffs: Array<{ field: string; label: string; before: string; after: string }> = [];

  const fmt = (v: unknown): string =>
    Array.isArray(v) ? (v.length ? v.join(', ') : 'нет') : v == null ? 'не задано' : String(v);

  const labels: Record<string, string> = {
    allergens: 'Аллергии',
    diet: 'Тип питания',
    dislikes: 'Нежелательные продукты',
    goal: 'Цель',
  };

  for (const key of ['allergens', 'diet', 'dislikes', 'goal'] as const) {
    const a = fmt(snapshot[key]);
    const b = fmt(current[key]);
    if (a !== b) {
      diffs.push({ field: key, label: labels[key], before: a, after: b });
    }
  }

  const ageBefore = Number(snapshot.age);
  const ageNow = Number(current.age);
  if (Number.isFinite(ageBefore) && Number.isFinite(ageNow)) {
    const wasMinor = ageBefore < 18;
    const isMinor = ageNow < 18;
    if (wasMinor !== isMinor) {
      diffs.push({
        field: 'age',
        label: 'Возраст',
        before: wasMinor ? 'до 18' : '18 и старше',
        after: isMinor ? 'до 18' : '18 и старше',
      });
    }
  }

  return diffs;
}

export function parseFoodHabits(raw: unknown): PreferenceContext['habits'] {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  const teaRaw = Number(obj.teaCupsPerDay);
  const teaCupsPerDay =
    Number.isFinite(teaRaw) && teaRaw > 0 ? Math.min(MAX_TEA_CUPS, Math.floor(teaRaw)) : 0;

  const mealsRaw = Number(obj.mealsPerDay);
  const mealsPerDay =
    Number.isFinite(mealsRaw) && mealsRaw >= 3 && mealsRaw <= 5 ? Math.floor(mealsRaw) : null;

  const prefersHomeCooking = obj.prefersHomeCooking === true || obj.homeCooking === true;

  return { teaCupsPerDay, mealsPerDay, prefersHomeCooking };
}

export function dishHaystackForProduct(p: Product): string {
  const chunks: string[] = [String(p.name ?? '').toLowerCase()];
  const detailed = (p as Product & { ingredientsDetailed?: Array<{ name?: string }> }).ingredientsDetailed;
  if (Array.isArray(detailed)) {
    for (const row of detailed) chunks.push(String(row?.name ?? '').toLowerCase());
  }
  const ing = (p as Product & { ingredients?: Array<{ name?: string }> }).ingredients;
  if (Array.isArray(ing)) {
    for (const row of ing) chunks.push(String(row?.name ?? '').toLowerCase());
  }
  for (const { name } of inferIngredientsFromDishTitle(String(p.name ?? ''))) {
    chunks.push(String(name ?? '').toLowerCase());
  }
  return chunks.filter(Boolean).join(' ');
}

export function dislikeKeywordMatches(haystack: string, keywordRaw: string): boolean {
  const hay = normalizeRuFoodText(haystack);
  const kw = String(keywordRaw ?? '').trim().toLowerCase().replace(/ё/g, 'е');
  if (!kw) return false;
  if (
    ruHaystackMatchesKeyword(hay, `без ${kw}`) ||
    /(?<![\p{L}\p{N}_])без(?![\p{L}\p{N}_])\s+сахар[\p{L}\p{N}_]*/iu.test(hay)
  ) {
    return false;
  }
  if (ruHaystackMatchesKeyword(hay, kw)) return true;
  const kwRoots = collectIngredientMatchRoots([{ name: kw }], []).filter((r) => r.length >= 4);
  if (kwRoots.length === 0) return false;
  const hayRoots = new Set(collectIngredientMatchRoots([{ name: hay }], []));
  return kwRoots.some((r) => hayRoots.has(r));
}

export function productPreferenceScore(product: Product, pref: PreferenceContext): number {
  const n = normalizeRuFoodText(product.name);
  const hay = dishHaystackForProduct(product);
  let score = 0;
  for (const k of pref.likes) {
    if (k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k))) score += 8;
  }
  for (const k of pref.fridgeNames) {
    if (k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k))) score += 1.2;
  }
  for (const k of pref.dislikes) {
    if (k && (dislikeKeywordMatches(hay, k) || dislikeKeywordMatches(n, k))) score -= 12;
  }
  return score;
}

export function productReason(product: Product, pref: PreferenceContext): string | undefined {
  const hay = dishHaystackForProduct(product);
  const n = normalizeRuFoodText(product.name);
  const reasons: string[] = [];
  if (pref.likes.some((k) => k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k)))) {
    reasons.push('совпадает с вашими вкусовыми предпочтениями');
  }
  if (pref.fridgeNames.some((k) => k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k)))) {
    reasons.push('учтены продукты из вашего холодильника');
  }
  return reasons.length ? reasons.join(', ') : undefined;
}

export function productMatchesAnyLike(product: Product, likes: string[]): boolean {
  if (!likes.length) return false;
  const hay = dishHaystackForProduct(product);
  return likes.some((k) => k && ruHaystackMatchesKeyword(hay, k));
}

export function snapshotHaystackForPreferences(snapshot: MealSlotSnapshot): string {
  const chunks = [
    String(snapshot.name ?? '').toLowerCase(),
    ...(snapshot.ingredientsDetailed ?? []).map((r) => String(r.name ?? '').toLowerCase()),
    ...((snapshot.ingredients ?? []) as Array<{ name?: string }>).map((r) => String(r.name ?? '').toLowerCase()),
  ];
  const hasStructuredIngredients =
    (snapshot.ingredientsDetailed?.length ?? 0) > 0 || (snapshot.ingredients?.length ?? 0) > 0;
  if (!hasStructuredIngredients) {
    for (const { name } of inferIngredientsFromDishTitle(String(snapshot.name ?? ''))) {
      chunks.push(String(name ?? '').toLowerCase());
    }
  }
  return chunks.filter(Boolean).join(' ');
}

export function snapshotMatchesAnyLike(snapshot: MealSlotSnapshot | null, likes: string[]): boolean {
  if (!snapshot || !likes.length) return false;
  const hay = snapshotHaystackForPreferences(snapshot);
  return likes.some((k) => k && ruHaystackMatchesKeyword(hay, k));
}

export function dayTouchesFoodLike(day: SaveMealPlanDayDto, pref: PreferenceContext): boolean {
  if (!pref.baseLikes.length) return true;
  const snaps = [day.breakfast, day.lunch, day.dinner, day.snack, ...(day.extraSnacks ?? [])];
  return pref.baseLikes.every((base) => {
    const keys = expandSingleLikeKeyword(base);
    return snaps.some((snap) => snap && snapshotMatchesAnyLike(snap, keys));
  });
}

export function alternativesForPool(pool: Product[], excludeId: string | undefined, pref: PreferenceContext): string[] {
  return pool
    .filter((p) => p.id !== excludeId)
    .sort((a, b) => productPreferenceScore(b, pref) - productPreferenceScore(a, pref))
    .slice(0, 2)
    .map((p) => p.name);
}

export function filterProductsByDislikes(products: Product[], dislikeKeywords: string[]): Product[] {
  if (!dislikeKeywords.length) return products;
  const kw = expandDislikeKeywords(dislikeKeywords);
  return products.filter((p) => {
    const hay = dishHaystackForProduct(p);
    if (!hay.trim()) return true;
    return !kw.some((w) => w && dislikeKeywordMatches(hay, w));
  });
}

export function pickReusableDish(
  slot: MealSlotKey,
  pools: Record<MealSlotKey, Product[]>,
  fallbackAny: Product[],
  seed: number,
): Product | null {
  const own = pools[slot] ?? [];
  const source = own.length > 0 ? own : fallbackAny;
  if (source.length === 0) return null;
  return source[seed % source.length] ?? source[0] ?? null;
}

export function snapshotFromProduct(p: Product, category: MealSlotKey): MealSlotSnapshot {
  const raw = (p as Product & { ingredients?: Array<{ name?: string; grams?: number }> }).ingredients;
  const rawDetailed = (p as Product & {
    ingredientsDetailed?: Array<{
      id?: string;
      name?: string;
      amount?: number;
      unit?: string;
      grams?: number;
      originalString?: string;
      ingredientId?: string;
    }>;
  }).ingredientsDetailed;
  let ingredients: Array<{ name: string; grams: number }>;
  if (Array.isArray(raw) && raw.length > 0) {
    ingredients = raw.map((row) => ({
      name: String(row.name ?? ''),
      grams: Number(row.grams) || 0,
    }));
  } else {
    ingredients = inferIngredientsFromDishTitle(p.name);
  }
  const ingredientsDetailed = Array.isArray(rawDetailed)
    ? rawDetailed
        .map((row) => ({
          id: String(row?.id ?? ''),
          name: String(row?.name ?? ''),
          amount: Number(row?.amount) || 0,
          unit: String(row?.unit ?? ''),
          grams: Number(row?.grams) || 0,
          originalString: row?.originalString ? String(row.originalString) : undefined,
          ingredientId: row?.ingredientId ? String(row.ingredientId) : undefined,
        }))
        .filter((row) => row.id && row.name)
    : [];
  const matchKeywords = collectIngredientMatchRoots(ingredients, p.matchKeywords ?? []);
  return {
    dishId: p.id,
    name: p.name,
    calories: p.calories,
    protein: p.protein,
    fat: p.fat,
    carbs: p.carbs,
    allergens: p.allergens ?? [],
    dietaryTags: p.dietaryTags ?? [],
    category,
    ingredients,
    ingredientsDetailed: ingredientsDetailed.length ? ingredientsDetailed : undefined,
    matchKeywords,
    imageUrl: p.imageUrl ?? undefined,
  };
}
