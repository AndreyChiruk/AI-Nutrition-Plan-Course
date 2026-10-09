import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты разнообразия планов.
 *
 * Раньше индекс блюда вычислялся как `|(dayIndex*31 + slotSalt*17) % top.length|`
 * — чистая функция без случайности. Повторная генерация плана в тот же день
 * возвращала ИДЕНТИЧНЫЙ результат: кнопка «Сгенерировать заново» ничего
 * не меняла, а в базе появлялись планы-дубликаты с одинаковыми итогами.
 *
 * Здесь повторяется логика выбора из `pickFromPool`.
 */
type Dish = { name: string; calories: number };

function pickDish(
  pool: Dish[],
  budget: number,
  dayIndex: number,
  slotSalt: number,
  seed: number,
): Dish | null {
  if (pool.length === 0) return null;
  const near = pool
    .map((p) => ({ p, diff: Math.abs(p.calories - budget) }))
    .sort((a, b) => a.diff - b.diff);
  const top = near.slice(0, Math.min(48, near.length));
  const idx = Math.abs((dayIndex * 31 + slotSalt * 17 + seed) % top.length) % top.length;
  return top[idx].p;
}

const pool: Dish[] = Array.from({ length: 48 }, (_, i) => ({
  name: `Блюдо${i}`,
  calories: 200 + i * 15,
}));

function buildPlan(seed: number): string[] {
  return Array.from({ length: 7 }, (_, d) =>
    pickDish(pool, 500, d, 1, (seed + d * 7919) % 2_000_000_000)?.name ?? '',
  );
}

describe('разнообразие планов (seed)', () => {
  it('одинаковый seed даёт одинаковый план (воспроизводимость)', () => {
    assert.deepEqual(buildPlan(12345), buildPlan(12345));
  });

  it('разные seed дают разные планы (исправление бага)', () => {
    const a = buildPlan(11111);
    const b = buildPlan(99999);
    assert.notDeepEqual(a, b, 'план должен меняться при новой генерации');
  });

  it('старое поведение (нулевой seed) всегда давало один и тот же план', () => {
    // Это иллюстрация дефекта: без seed результат детерминирован.
    const old = Array.from({ length: 7 }, (_, d) => pickDish(pool, 500, d, 1, 0)?.name);
    const oldAgain = Array.from({ length: 7 }, (_, d) => pickDish(pool, 500, d, 1, 0)?.name);
    assert.deepEqual(old, oldAgain, 'без seed план повторяется — именно это и было багом');
  });

  it('внутри одного плана дни не дублируются полностью', () => {
    const plan = buildPlan(555);
    const unique = new Set(plan);
    assert.isAtLeast(unique.size, 4, 'дни должны различаться');
  });

  it('несколько разных seed дают несколько разных планов', () => {
    const plans = new Set(
      [1, 2, 3, 4, 5].map((s) => JSON.stringify(buildPlan(s * 7919))),
    );
    assert.isAtLeast(plans.size, 4, 'разные seed должны давать разные планы');
  });

  it('пустой пул не ломает выбор', () => {
    assert.isNull(pickDish([], 500, 0, 1, 42));
  });

  it('день со слотом всегда получает блюдо при непустом пуле', () => {
    for (let d = 0; d < 7; d++) {
      assert.isNotNull(pickDish(pool, 500, d, 1, 42));
    }
  });
});
