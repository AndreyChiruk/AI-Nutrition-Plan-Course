import { Product } from '../models/Product';
import { MealSlotSnapshot } from '../models/MealPlanDay';
import type { ConstructorRefinementChange } from '../openai/openai.validators';
import {
  MealSlotKey,
  PreferenceContext,
  SaveMealPlanDayDto,
  snapshotFromProduct,
} from './meal-plan-preferences.helper';
import { pickFromPool } from './meal-plan-scaling.helper';

export type ConstructorPlanSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'snack2';

export const CONSTRUCTOR_PLAN_SLOTS: ConstructorPlanSlot[] = [
  'breakfast',
  'lunch',
  'dinner',
  'snack',
  'snack2',
];

const DEFAULT_DIST = { breakfast: 0.25, lunch: 0.35, dinner: 0.25, snacks: 0.15 };

export function isPlaceholderConstructorSnapshot(s: MealSlotSnapshot | null | undefined): boolean {
  if (!s?.name) return true;
  return /^блюдо\s*\(/i.test(String(s.name).trim());
}

export function getConstructorSlotSnapshot(
  day: SaveMealPlanDayDto,
  slot: ConstructorPlanSlot,
): MealSlotSnapshot | null {
  if (slot === 'snack2') return day.extraSnacks?.[0] ?? null;
  return day[slot] as MealSlotSnapshot | null;
}

export function setConstructorSlotSnapshot(
  day: SaveMealPlanDayDto,
  slot: ConstructorPlanSlot,
  snap: MealSlotSnapshot | null,
): SaveMealPlanDayDto {
  if (slot === 'snack2') {
    return { ...day, extraSnacks: snap ? [snap] : [] };
  }
  return { ...day, [slot]: snap };
}

export function formatConstructorPlanLine(day: SaveMealPlanDayDto): string {
  const fmt = (slot: ConstructorPlanSlot): string => {
    const s = getConstructorSlotSnapshot(day, slot);
    if (!s?.name || isPlaceholderConstructorSnapshot(s)) return 'null';
    return s.name;
  };
  return `день ${day.dayNumber}: breakfast=${fmt('breakfast')}; lunch=${fmt('lunch')}; dinner=${fmt('dinner')}; snack=${fmt('snack')}; snack2=${fmt('snack2')}`;
}

export function mergeConstructorRefinementAi(
  baseDays: SaveMealPlanDayDto[],
  aiChanges: ConstructorRefinementChange[],
  resolve: (rawName: string) => Product | null,
): SaveMealPlanDayDto[] {
  const changeByKey = new Map<string, ConstructorRefinementChange>();
  for (const c of aiChanges) {
    changeByKey.set(`${c.day}-${c.slot}`, c);
  }

  return baseDays.map((day) => {
    let next = { ...day };
    for (const slot of CONSTRUCTOR_PLAN_SLOTS) {
      const ch = changeByKey.get(`${day.dayNumber}-${slot}`);
      if (!ch) continue;

      if (ch.action === 'keep') {
        continue;
      }

      const cat: MealSlotKey = slot === 'snack2' || slot === 'snack' ? 'snack' : slot;
      const nm = (ch.dishName ?? '').trim();
      const pr = nm ? resolve(nm) : null;

      if (ch.action === 'replace') {
        if (pr) {
          const snap = snapshotFromProduct(pr, cat);
          if (ch.reason) snap.note = ch.reason;
          next = setConstructorSlotSnapshot(next, slot, snap);
        }
        continue;
      }

      if (ch.action === 'fill' && pr) {
        const snap = snapshotFromProduct(pr, cat);
        if (ch.reason) snap.note = ch.reason;
        next = setConstructorSlotSnapshot(next, slot, snap);
      }
    }
    return next;
  });
}

export function fillEmptyConstructorSlots(
  days: SaveMealPlanDayDto[],
  targetCalories: number,
  pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  pref: PreferenceContext,
  fallbackAnyPool: Product[],
): SaveMealPlanDayDto[] {
  const dist = DEFAULT_DIST;
  const snackShare1 = dist.snacks * 0.55;
  const snackShare2 = dist.snacks * 0.45;
  const tc = targetCalories;

  return days.map((day, di) => {
    let next = { ...day };
    const used = new Set<string>();
    for (const slot of CONSTRUCTOR_PLAN_SLOTS) {
      const s = getConstructorSlotSnapshot(next, slot);
      if (s?.dishId) used.add(String(s.dishId));
    }

    let salt = 0;
    const tryFill = (slot: ConstructorPlanSlot, budget: number, poolCat: MealSlotKey) => {
      const cur = getConstructorSlotSnapshot(next, slot);
      if (cur != null && !isPlaceholderConstructorSnapshot(cur)) return;
      const pool = pools[poolCat].length > 0 ? pools[poolCat] : fallbackAnyPool;
      const picked = pickFromPool(pool, budget, di, salt++, used, pref);
      if (!picked) return;
      const snap = snapshotFromProduct(picked, poolCat);
      next = setConstructorSlotSnapshot(next, slot, snap);
    };

    tryFill('breakfast', tc * dist.breakfast, 'breakfast');
    tryFill('lunch', tc * dist.lunch, 'lunch');
    tryFill('dinner', tc * dist.dinner, 'dinner');
    tryFill('snack', tc * snackShare1, 'snack');
    tryFill('snack2', tc * snackShare2, 'snack');

    return next;
  });
}

export function buildConstructorFallbackChanges(
  beforeDays: SaveMealPlanDayDto[],
  afterDays: SaveMealPlanDayDto[],
): ConstructorRefinementChange[] {
  const byDay = new Map(afterDays.map((d) => [d.dayNumber, d]));
  const out: ConstructorRefinementChange[] = [];
  for (const day of beforeDays) {
    const next = byDay.get(day.dayNumber);
    if (!next) continue;
    for (const slot of CONSTRUCTOR_PLAN_SLOTS) {
      const prevSnap = getConstructorSlotSnapshot(day, slot);
      const nextSnap = getConstructorSlotSnapshot(next, slot);
      const prevName = String(prevSnap?.name ?? '').trim();
      const nextName = String(nextSnap?.name ?? '').trim();
      if (prevName === nextName) continue;
      const action: ConstructorRefinementChange['action'] = !prevName && nextName ? 'fill' : 'replace';
      const reason =
        action === 'fill'
          ? 'Слот был пуст — заполнен автоматически из каталога.'
          : 'Слот заменён автоматически с учётом ограничений и калорийности.';
      out.push({
        day: day.dayNumber,
        slot: slot as ConstructorRefinementChange['slot'],
        action,
        dishName: nextName,
        previousDishName: prevName,
        reason,
      });
    }
  }
  return out;
}
