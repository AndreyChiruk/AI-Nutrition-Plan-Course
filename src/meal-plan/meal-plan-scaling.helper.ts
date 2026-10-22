import { Product } from '../models/Product';
import { MealSlotSnapshot } from '../models/MealPlanDay';
import {
  MealSlotKey,
  PreferenceContext,
  SaveMealPlanDayDto,
  productPreferenceScore,
  snapshotFromProduct,
} from './meal-plan-preferences.helper';

export const SLOT_ORDER: MealSlotKey[] = ['breakfast', 'lunch', 'dinner', 'snack'];
export const CALORIE_TARGET_TOLERANCE = 0.1;

/**
 * Читает перекусы дня из обоих возможных полей базы данных.
 */
export function snacksFromDb(snacksRaw: unknown, extraRaw: unknown): MealSlotSnapshot[] {
  const out: MealSlotSnapshot[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value === 'object' && value !== null && 'name' in (value as object)) {
      out.push(value as MealSlotSnapshot);
    }
  };
  push(snacksRaw);
  push(extraRaw);

  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${String(s.name ?? '')}|${Number(s.calories) || 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Первый перекус дня (для обратной совместимости с полем `snack`). */
export function primarySnackFromDb(raw: unknown): MealSlotSnapshot | null {
  return snacksFromDb(raw, null)[0] ?? null;
}

export function daySnapshotsTotal(day: SaveMealPlanDayDto) {
  const list: MealSlotSnapshot[] = [];
  for (const k of SLOT_ORDER) {
    const s = day[k];
    if (s && typeof s === 'object' && 'name' in s) list.push(s as MealSlotSnapshot);
  }
  for (const ex of day.extraSnacks ?? []) {
    if (ex && typeof ex === 'object' && 'name' in ex) list.push(ex);
  }
  let calories = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  for (const s of list) {
    calories += Number(s.calories) || 0;
    protein += Number(s.protein) || 0;
    fat += Number(s.fat) || 0;
    carbs += Number(s.carbs) || 0;
  }
  return { calories, protein, fat, carbs };
}

export function scaleDaySnapshotsToTarget(
  day: SaveMealPlanDayDto,
  target: number,
  tolerance = CALORIE_TARGET_TOLERANCE,
): SaveMealPlanDayDto {
  const tot = daySnapshotsTotal(day);
  if (tot.calories <= 0 || !Number.isFinite(target) || target <= 0) return day;
  const low = target * (1 - Math.max(0, tolerance));
  const high = target * (1 + Math.max(0, tolerance));
  if (tot.calories >= low && tot.calories <= high) return day;
  const factor = target / tot.calories;

  const scaleSnap = (s: MealSlotSnapshot | null): MealSlotSnapshot | null => {
    if (!s || typeof s !== 'object' || !('calories' in s)) return s;
    const snap = s as MealSlotSnapshot;
    const c = Number(snap.calories) || 0;
    if (c <= 0) return { ...snap, calories: 0 };

    const round1 = (v: number) => Math.round(v * 10) / 10;
    const scaleGrams = (v: unknown) => {
      const g = Number(v) || 0;
      return g > 0 ? round1(g * factor) : g;
    };

    const mapIngredient = <T extends { grams?: unknown; amount?: unknown }>(row: T): T => {
      if (!row || typeof row !== 'object') return row;
      const next: Record<string, unknown> = { ...row };
      if (row.grams !== undefined && row.grams !== null) next.grams = scaleGrams(row.grams);
      if (row.amount !== undefined && row.amount !== null) next.amount = scaleGrams(row.amount);
      return next as T;
    };

    const snapshotWithIngredients = snap as MealSlotSnapshot & {
      ingredients?: Array<{ grams?: unknown }>;
      ingredientsDetailed?: Array<{ grams?: unknown; amount?: unknown }>;
    };

    return {
      ...snap,
      calories: Math.max(0, Math.round(c * factor)),
      protein: round1((Number(snap.protein) || 0) * factor),
      fat: round1((Number(snap.fat) || 0) * factor),
      carbs: round1((Number(snap.carbs) || 0) * factor),
      ...(Number((snap as { weight?: unknown }).weight) > 0
        ? { weight: round1(Number((snap as { weight?: unknown }).weight) * factor) }
        : {}),
      ...(Array.isArray(snapshotWithIngredients.ingredients)
        ? { ingredients: snapshotWithIngredients.ingredients.map(mapIngredient) }
        : {}),
      ...(Array.isArray(snapshotWithIngredients.ingredientsDetailed)
        ? { ingredientsDetailed: snapshotWithIngredients.ingredientsDetailed.map(mapIngredient) }
        : {}),
    } as MealSlotSnapshot;
  };
  let next: SaveMealPlanDayDto = {
    ...day,
    breakfast: scaleSnap(day.breakfast),
    lunch: scaleSnap(day.lunch),
    dinner: scaleSnap(day.dinner),
    snack: scaleSnap(day.snack),
    extraSnacks: (day.extraSnacks ?? []).map(scaleSnap).filter(Boolean) as MealSlotSnapshot[],
  };
  const drift = Math.round(target - daySnapshotsTotal(next).calories);
  if (drift === 0) return next;
  const order: MealSlotKey[] = ['dinner', 'lunch', 'breakfast', 'snack'];
  for (const k of order) {
    const slot = next[k];
    if (!slot || typeof slot !== 'object') continue;
    const cal = Number((slot as MealSlotSnapshot).calories) || 0;
    if (cal + drift < 1) continue;
    next = {
      ...next,
      [k]: { ...(slot as MealSlotSnapshot), calories: cal + drift },
    };
    break;
  }
  return next;
}

export function computeTotalsFromDbDays(
  days: Array<{ breakfast?: unknown; lunch?: unknown; dinner?: unknown; snacks?: unknown; extraSnacks?: unknown }>,
) {
  let calories = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;

  const addSnapshot = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || !('calories' in (raw as object))) return;
    const s = raw as MealSlotSnapshot;
    calories += Number(s.calories) || 0;
    protein += Number(s.protein) || 0;
    fat += Number(s.fat) || 0;
    carbs += Number(s.carbs) || 0;
  };

  for (const d of days ?? []) {
    addSnapshot(d?.breakfast);
    addSnapshot(d?.lunch);
    addSnapshot(d?.dinner);
    for (const snack of snacksFromDb(d?.snacks, d?.extraSnacks)) addSnapshot(snack);
  }

  return {
    calories: Math.round(calories),
    protein: Math.round(protein * 10) / 10,
    fat: Math.round(fat * 10) / 10,
    carbs: Math.round(carbs * 10) / 10,
  };
}

export function computePlanTotals(days: SaveMealPlanDayDto[]) {
  let calories = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  for (const d of days) {
    const t = daySnapshotsTotal(d);
    calories += t.calories;
    protein += t.protein;
    fat += t.fat;
    carbs += t.carbs;
  }
  return { calories, protein, fat, carbs };
}

export function diversifyCatalogDays(
  days: SaveMealPlanDayDto[],
  pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
): SaveMealPlanDayDto[] {
  const seenPerSlot = new Map<string, number>();
  const out: SaveMealPlanDayDto[] = [];
  const MAX_REPEATS = 1;

  const hashOf = (value: string): number => {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
  };

  const pickAlt = (
    slot: MealSlotKey,
    current: MealSlotSnapshot | null,
    prevName?: string,
    salt = 0,
  ): MealSlotSnapshot | null => {
    if (!current?.name) return current;

    const key = `${slot}:${current.name.toLowerCase()}`;
    const seen = seenPerSlot.get(key) ?? 0;
    const repeatsPrev =
      prevName != null && prevName.toLowerCase() === current.name.toLowerCase();

    if (seen < MAX_REPEATS && !repeatsPrev) {
      seenPerSlot.set(key, seen + 1);
      return current;
    }

    const pool = pools[slot] ?? [];
    const usable = pool.filter((p) => {
      const name = String(p.name ?? '').toLowerCase();
      if (!name || name === current.name.toLowerCase()) return false;
      if (prevName && prevName.toLowerCase() === name) return false;
      return (seenPerSlot.get(`${slot}:${name}`) ?? 0) < MAX_REPEATS + 1;
    });

    if (usable.length === 0) {
      seenPerSlot.set(key, seen + 1);
      return current;
    }

    const alt = usable[hashOf(`${slot}:${current.name}:${salt}:${usable.length}`) % usable.length];
    const snap = snapshotFromProduct(alt, slot);
    const altKey = `${slot}:${String(alt.name).toLowerCase()}`;
    seenPerSlot.set(altKey, (seenPerSlot.get(altKey) ?? 0) + 1);
    return snap;
  };

  for (let i = 0; i < days.length; i++) {
    const prev = out[i - 1];
    const d = days[i];
    const next: SaveMealPlanDayDto = {
      ...d,
      breakfast: pickAlt('breakfast', d.breakfast, prev?.breakfast?.name),
      lunch: pickAlt('lunch', d.lunch, prev?.lunch?.name),
      dinner: pickAlt('dinner', d.dinner, prev?.dinner?.name),
      snack: pickAlt('snack', d.snack, prev?.snack?.name),
      extraSnacks: (d.extraSnacks ?? []).map((s, exIdx) =>
        pickAlt('snack', s, exIdx === 0 ? prev?.extraSnacks?.[0]?.name : undefined, exIdx + 1),
      ) as MealSlotSnapshot[],
    };
    out.push(next);
  }
  return out;
}

export function pickFromPool(
  pool: Product[],
  budget: number,
  dayIndex: number,
  slotSalt: number,
  usedIds: Set<string>,
  pref: PreferenceContext,
  seed = 0,
): Product | null {
  if (pool.length === 0) return null;
  const available = pool.filter((p) => !usedIds.has(p.id));
  const source = available.length ? available : pool;
  const near = source
    .map((p) => ({
      p,
      diff: Math.abs(Number(p.calories) - budget),
      pref: productPreferenceScore(p, pref),
    }))
    .sort((a, b) => a.diff - b.diff || b.pref - a.pref);
  const candidates = near.length ? near : source.map((p) => ({ p, diff: 0 }));
  const top = candidates.slice(0, Math.min(48, candidates.length));

  const key = `${seed}:${dayIndex}:${slotSalt}:${top.length}`;
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const idx = Math.abs(h) % top.length;

  const chosen = top[idx]?.p ?? pool[dayIndex % pool.length];
  usedIds.add(chosen.id);
  return chosen;
}

export function hashSeed(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function sortPoolByCalories(pool: Product[]) {
  return [...pool].sort(
    (a, b) => Number(a.calories) - Number(b.calories) || String(a.id).localeCompare(String(b.id)),
  );
}

export function stridedPoolSample(pool: Product[], maxItems: number): Product[] {
  if (pool.length <= maxItems) return pool;
  const out: Product[] = [];
  const last = pool.length - 1;
  const step = last / Math.max(1, maxItems - 1);
  for (let k = 0; k < maxItems; k++) {
    out.push(pool[Math.min(last, Math.round(k * step))]);
  }
  return out;
}

export function refineProductsToTarget(
  slots: Product[],
  pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  target: number,
  tolerance: number,
): { products: Product[]; matched: boolean } {
  const slotCats: Array<'breakfast' | 'lunch' | 'dinner' | 'snack'> = [
    'breakfast',
    'lunch',
    'dinner',
    'snack',
    'snack',
  ];
  const current = [...slots];
  const sumCal = (arr: Product[]) => arr.reduce((a, p) => a + Number(p.calories), 0);
  const relErr = () => Math.abs(sumCal(current) - target) / Math.max(1, target);
  if (relErr() <= tolerance) return { products: current, matched: true };
  const maxCandPerSlot = 360;
  for (let iter = 0; iter < 260; iter++) {
    if (relErr() <= tolerance) return { products: current, matched: true };
    let bestScore = Infinity;
    let bestI = -1;
    let bestP: Product | null = null;
    for (let i = 0; i < 5; i++) {
      const cat = slotCats[i];
      const pool = pools[cat];
      if (!pool.length) continue;
      const sorted = sortPoolByCalories(pool);
      const capped = stridedPoolSample(sorted, maxCandPerSlot);
      for (const cand of capped) {
        const next = [...current];
        next[i] = cand;
        const err = Math.abs(sumCal(next) - target);
        if (err < bestScore) {
          bestScore = err;
          bestI = i;
          bestP = cand;
        }
      }
    }
    if (bestI >= 0 && bestP) {
      current[bestI] = bestP;
    }
  }
  return { products: current, matched: relErr() <= tolerance };
}
