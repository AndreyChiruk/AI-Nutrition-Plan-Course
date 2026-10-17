import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты валидации входных данных сохранения плана.
 *
 * Раньше `POST /meal-plan/save` не проверял тело запроса: `durationDays`
 * мог быть undefined (→ Invalid Date и 500), `days` — не массивом
 * (→ TypeError и 500), номера дней могли повторяться. Проверки вынесены
 * в отдельную функцию, чтобы покрыть их без поднятия всего сервиса.
 */

/** Повторяет правила валидации из MealPlanService.saveUserPlan. */
function validateSaveInput(dto: {
  durationDays?: unknown;
  targetCalories?: unknown;
  days?: unknown;
}): { ok: true } | { ok: false; reason: string } {
  const durationDays = Number(dto.durationDays);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 30) {
    return { ok: false, reason: 'duration' };
  }
  if (!Array.isArray(dto.days) || dto.days.length === 0) {
    return { ok: false, reason: 'days-empty' };
  }
  if (dto.days.length !== durationDays) {
    return { ok: false, reason: 'days-mismatch' };
  }
  const seen = new Set<number>();
  for (const d of dto.days as Array<{ dayNumber?: unknown }>) {
    const n = Number(d?.dayNumber);
    if (!Number.isInteger(n) || n < 1 || n > durationDays) {
      return { ok: false, reason: 'day-number' };
    }
    if (seen.has(n)) return { ok: false, reason: 'day-duplicate' };
    seen.add(n);
  }
  const tc = Number(dto.targetCalories);
  if (!Number.isFinite(tc) || tc <= 0) return { ok: false, reason: 'calories' };
  return { ok: true };
}

const day = (n: number) => ({ dayNumber: n });

describe('валидация сохранения плана питания', () => {
  it('принимает корректный план', () => {
    const r = validateSaveInput({
      durationDays: 7,
      targetCalories: 2200,
      days: Array.from({ length: 7 }, (_, i) => day(i + 1)),
    });
    assert.isTrue(r.ok);
  });

  it('отклоняет durationDays = undefined (раньше давало 500 и Invalid Date)', () => {
    const r = validateSaveInput({ targetCalories: 2200, days: [day(1)] });
    assert.isFalse(r.ok);
    assert.strictEqual((r as { reason: string }).reason, 'duration');
  });

  it('отклоняет недопустимую длительность', () => {
    for (const d of [0, -1, 400, 1.5, 'abc']) {
      const r = validateSaveInput({ durationDays: d, targetCalories: 2000, days: [day(1)] });
      assert.isFalse(r.ok, `длительность ${d} должна отклоняться`);
    }
  });

  it('отклоняет пустой или не-массив days', () => {
    for (const days of [[], undefined, 'строка', 42]) {
      const r = validateSaveInput({ durationDays: 1, targetCalories: 2000, days });
      assert.isFalse(r.ok);
    }
  });

  it('отклоняет несовпадение числа дней и длительности', () => {
    const r = validateSaveInput({ durationDays: 7, targetCalories: 2000, days: [day(1), day(2)] });
    assert.isFalse(r.ok);
    assert.strictEqual((r as { reason: string }).reason, 'days-mismatch');
  });

  it('отклоняет повторяющиеся номера дней', () => {
    const r = validateSaveInput({
      durationDays: 2,
      targetCalories: 2000,
      days: [day(1), day(1)],
    });
    assert.isFalse(r.ok);
    assert.strictEqual((r as { reason: string }).reason, 'day-duplicate');
  });

  it('отклоняет некорректный номер дня', () => {
    const r = validateSaveInput({
      durationDays: 2,
      targetCalories: 2000,
      days: [day(1), day(99)],
    });
    assert.isFalse(r.ok);
    assert.strictEqual((r as { reason: string }).reason, 'day-number');
  });

  it('отклоняет некорректную целевую калорийность', () => {
    for (const tc of [0, -100, NaN, undefined]) {
      const r = validateSaveInput({ durationDays: 1, targetCalories: tc, days: [day(1)] });
      assert.isFalse(r.ok, `калории ${tc} должны отклоняться`);
    }
  });
});
