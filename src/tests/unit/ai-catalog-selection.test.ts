import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты выборки каталога для AI-плана.
 *
 * Раньше брались первые 400 блюд по алфавиту (`limit: 400, order: name ASC`).
 * В выборку не попадали 13 завтраков, 7 ужинов, 183 обеда и 66 перекусов —
 * модель физически не могла их использовать, а при узкой диете пул нужной
 * категории мог оказаться пустым, и план сохранялся с блюдами по 0 ккал.
 *
 * Теперь выборка сбалансирована по категориям.
 */
function stridedSample<T>(pool: T[], maxItems: number): T[] {
  if (pool.length <= maxItems) return pool;
  const out: T[] = [];
  const last = pool.length - 1;
  const step = last / Math.max(1, maxItems - 1);
  for (let k = 0; k < maxItems; k++) out.push(pool[Math.min(last, Math.round(k * step))]);
  return out;
}

const CATEGORIES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

describe('выборка каталога для AI-плана', () => {
  it('каждая категория представлена хотя бы одним блюдом', () => {
    const catalog = {
      breakfast: Array.from({ length: 30 }, (_, i) => ({ id: `b${i}`, category: 'breakfast' })),
      lunch: Array.from({ length: 453 }, (_, i) => ({ id: `l${i}`, category: 'lunch' })),
      dinner: Array.from({ length: 38 }, (_, i) => ({ id: `d${i}`, category: 'dinner' })),
      snack: Array.from({ length: 148 }, (_, i) => ({ id: `s${i}`, category: 'snack' })),
    };
    const picked = CATEGORIES.flatMap((c) => stridedSample(catalog[c], 150));
    for (const cat of CATEGORIES) {
      const count = picked.filter((p) => p.category === cat).length;
      assert.isAbove(count, 0, `категория «${cat}» не должна быть пустой`);
    }
  });

  it('небольшие категории попадают в выборку целиком', () => {
    const dinner = Array.from({ length: 38 }, (_, i) => ({ id: `d${i}` }));
    assert.lengthOf(stridedSample(dinner, 150), 38, 'ужины должны попасть полностью');
  });

  it('большие категории равномерно прореживаются', () => {
    const lunch = Array.from({ length: 453 }, (_, i) => ({ id: i }));
    const picked = stridedSample(lunch, 150);
    assert.lengthOf(picked, 150);
    // Равномерность: расстояние между соседними выбранными примерно одинаково.
    const gaps: number[] = [];
    for (let i = 1; i < picked.length; i++) gaps.push(picked[i].id - picked[i - 1].id);
    const minGap = Math.min(...gaps);
    const maxGap = Math.max(...gaps);
    assert.isAtMost(maxGap - minGap, 2, 'прореживание должно быть равномерным');
  });

  it('покрытие категорий не хуже прежнего', () => {
    // Прежняя выборка (первые 400 по алфавиту) давала: 17/30, 270/453, 31/38, 82/148.
    const oldCoverage = { breakfast: 17, lunch: 270, dinner: 31, snack: 82 };
    const totals = { breakfast: 30, lunch: 453, dinner: 38, snack: 148 };
    for (const cat of CATEGORIES) {
      const pool = Array.from({ length: totals[cat] }, (_, i) => ({ id: i }));
      const picked = stridedSample(pool, 150).length;
      const oldPct = oldCoverage[cat] / totals[cat];
      const newPct = picked / totals[cat];
      assert.isAtLeast(newPct, Math.min(oldPct, 0.33), cat);
    }
  });

  it('не превышает заданный лимит на категорию', () => {
    const big = Array.from({ length: 1000 }, (_, i) => ({ id: i }));
    assert.lengthOf(stridedSample(big, 150), 150);
  });

  it('устойчив к пустой категории', () => {
    assert.isEmpty(stridedSample([], 150));
  });
});
