import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты пересчёта итогов плана по фактическим дням.
 *
 * Проблема: `meal_plans.total_calories` (и protein/fat/carbs) — денормализация.
 * Значения записываются при сохранении и больше не обновляются. Если состав
 * дней менялся, они расходились с суммой дней — на реальных данных
 * до 5568 ккал (14 из 67 планов). Из-за этого скачанный JSON плана был
 * внутренне противоречив.
 *
 * Здесь повторяется логика `computeTotalsFromDbDays` из meal-plan.service.ts.
 */
type Snapshot = { name: string; calories: number; protein: number; fat: number; carbs: number };
type Day = {
  breakfast?: unknown;
  lunch?: unknown;
  dinner?: unknown;
  snacks?: unknown;
  extraSnacks?: unknown;
};

function snacksFromDb(snacksRaw: unknown, extraRaw: unknown): Snapshot[] {
  const out: Snapshot[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value === 'object' && value !== null && 'name' in (value as object)) {
      out.push(value as Snapshot);
    }
  };
  push(snacksRaw);
  push(extraRaw);
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${s.name}|${s.calories}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function computeTotalsFromDbDays(days: Day[]) {
  let calories = 0;
  let protein = 0;
  let fat = 0;
  let carbs = 0;
  const add = (raw: unknown) => {
    if (!raw || typeof raw !== 'object' || !('calories' in (raw as object))) return;
    const s = raw as Snapshot;
    calories += s.calories || 0;
    protein += s.protein || 0;
    fat += s.fat || 0;
    carbs += s.carbs || 0;
  };
  for (const d of days ?? []) {
    add(d?.breakfast);
    add(d?.lunch);
    add(d?.dinner);
    for (const snack of snacksFromDb(d?.snacks, d?.extraSnacks)) add(snack);
  }
  return { calories: Math.round(calories) };
}

const snap = (name: string, calories: number): Snapshot => ({
  name,
  calories,
  protein: calories * 0.1,
  fat: calories * 0.1,
  carbs: calories * 0.1,
});

describe('пересчёт итогов плана', () => {
  it('суммирует все слоты дня, включая все перекусы', () => {
    const days: Day[] = [
      {
        breakfast: snap('Омлет', 300),
        lunch: snap('Борщ', 400),
        dinner: snap('Рыба', 500),
        snacks: [snap('Яблоко', 80), snap('Орехи', 200)],
        extraSnacks: [snap('Орехи', 200)],
      },
    ];
    // 300 + 400 + 500 + 80 + 200 = 1480 (дубль «Орехи» не считается дважды)
    assert.strictEqual(computeTotalsFromDbDays(days).calories, 1480);
  });

  it('считает по нескольким дням', () => {
    const days: Day[] = [
      { breakfast: snap('A', 100), lunch: snap('B', 200), dinner: snap('C', 300), snacks: [] },
      { breakfast: snap('D', 100), lunch: snap('E', 200), dinner: snap('F', 300), snacks: [] },
    ];
    assert.strictEqual(computeTotalsFromDbDays(days).calories, 1200);
  });

  it('не зависит от денормализованной колонки total_calories', () => {
    // Регресс: раньше итог брался из колонки (34020), а дни давали 28452.
    const days: Day[] = [
      { breakfast: snap('A', 400), lunch: snap('B', 500), dinner: snap('C', 500), snacks: [] },
    ];
    const computed = computeTotalsFromDbDays(days).calories;
    assert.strictEqual(computed, 1400);
    assert.notStrictEqual(computed, 34020);
  });

  it('корректно обрабатывает старую схему перекусов', () => {
    // Старая схема: snacks = [первый], extra_snacks = [остальные].
    // Сумма: 100 + 100 + 100 + 50 + 60 + 70 = 480.
    const days: Day[] = [
      {
        breakfast: snap('A', 100),
        lunch: snap('B', 100),
        dinner: snap('C', 100),
        snacks: [snap('Снэк1', 50)],
        extraSnacks: [snap('Снэк2', 60), snap('Снэк3', 70)],
      },
    ];
    assert.strictEqual(computeTotalsFromDbDays(days).calories, 480);
  });

  it('не считает дубликат перекуса дважды (новая схема хранения)', () => {
    // Новая схема: все перекусы в snacks, хвост продублирован в extraSnacks.
    const days: Day[] = [
      {
        breakfast: snap('A', 100),
        lunch: snap('B', 100),
        dinner: snap('C', 100),
        snacks: [snap('Снэк1', 50), snap('Снэк2', 60)],
        extraSnacks: [snap('Снэк2', 60)],
      },
    ];
    assert.strictEqual(computeTotalsFromDbDays(days).calories, 410);
  });

  it('устойчив к пустым и некорректным слотам', () => {
    assert.strictEqual(computeTotalsFromDbDays([]).calories, 0);
    assert.strictEqual(computeTotalsFromDbDays([{}]).calories, 0);
    assert.strictEqual(
      computeTotalsFromDbDays([{ breakfast: null, lunch: 'мусор', dinner: 42 }]).calories,
      0,
    );
    assert.strictEqual(computeTotalsFromDbDays([{ snacks: null, extraSnacks: null }]).calories, 0);
  });
});
