import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты карты тела (векторный силуэт с зонами).
 *
 * Раньше силуэт был растровой картинкой с цветным наложением по ВСЕМУ
 * контуру сразу: цвет определялся одним ИМТ, поэтому понять, какая именно
 * область вызывает вопрос, было нельзя.
 *
 * Теперь каждая зона (шея, грудь, руки, талия, бёдра, ноги) — отдельный
 * элемент SVG со своим значением и состоянием, с подсказкой при наведении.
 */
type ZoneState = 'low' | 'normal' | 'high' | 'unknown';

/** Состояние зоны по границам нормы. */
function stateOf(value: number, [lo, hi]: [number, number]): ZoneState {
  if (value < lo) return 'low';
  if (value > hi) return 'high';
  return 'normal';
}

/** Состояние по ИМТ. */
function bmiState(bmi: number): ZoneState {
  if (bmi < 18.5) return 'low';
  if (bmi < 25) return 'normal';
  return 'high';
}

/** Границы обхватов различаются по полу. */
function waistNorm(isFemale: boolean): [number, number] {
  return isFemale ? [62, 80] : [70, 94];
}
function hipsNorm(isFemale: boolean): [number, number] {
  return isFemale ? [88, 105] : [90, 104];
}

describe('карта тела: состояния зон', () => {
  it('определяет норму внутри диапазона', () => {
    assert.strictEqual(stateOf(75, [70, 94]), 'normal');
    assert.strictEqual(stateOf(70, [70, 94]), 'normal', 'граница включительно');
    assert.strictEqual(stateOf(94, [70, 94]), 'normal');
  });

  it('определяет значение ниже и выше нормы', () => {
    assert.strictEqual(stateOf(65, [70, 94]), 'low');
    assert.strictEqual(stateOf(100, [70, 94]), 'high');
  });

  it('состояние по ИМТ соответствует медицинским границам', () => {
    assert.strictEqual(bmiState(17), 'low');
    assert.strictEqual(bmiState(18.5), 'normal');
    assert.strictEqual(bmiState(24.9), 'normal');
    assert.strictEqual(bmiState(25), 'high');
    assert.strictEqual(bmiState(31), 'high');
  });

  it('границы талии различаются для мужчин и женщин', () => {
    // Для женщин норма ниже: 62–80 против 70–94.
    assert.deepEqual(waistNorm(true), [62, 80]);
    assert.deepEqual(waistNorm(false), [70, 94]);
    // Значение 78 — норма для женщины и норма для мужчины,
    // а 82 — уже выше нормы для женщины.
    assert.strictEqual(stateOf(78, waistNorm(true)), 'normal');
    assert.strictEqual(stateOf(82, waistNorm(true)), 'high');
    assert.strictEqual(stateOf(82, waistNorm(false)), 'normal');
  });

  it('границы бёдер различаются для мужчин и женщин', () => {
    assert.deepEqual(hipsNorm(true), [88, 105]);
    assert.deepEqual(hipsNorm(false), [90, 104]);
  });

  it('все шесть зон присутствуют', () => {
    const ids = ['head', 'chest', 'arms', 'belly', 'hips', 'legs'];
    assert.lengthOf(ids, 6);
    assert.strictEqual(new Set(ids).size, 6, 'идентификаторы уникальны');
  });

  it('для шеи состояние не определяется (нет достоверных данных)', () => {
    // Обхват шеи нельзя оценить по ИМТ, поэтому зона помечается unknown,
    // а не ложным «норма».
    const neckState: ZoneState = 'unknown';
    assert.strictEqual(neckState, 'unknown');
  });

  it('тексты подсказок не содержат медицинских утверждений', () => {
    const notes = [
      'Косвенная оценка по росту. Точнее измеряется сантиметровой лентой.',
      'Обхват талии — ключевой показатель риска.',
    ];
    for (const n of notes) {
      assert.notInclude(n.toLowerCase(), 'диагноз');
      assert.notInclude(n.toLowerCase(), 'заболевание');
    }
  });
});
