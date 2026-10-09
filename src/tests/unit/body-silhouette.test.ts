import { assert } from 'chai';
import { describe, it } from 'mocha';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SILHOUETTE = join(HERE, '..', '..', '..', 'frontend', 'public', 'silhouettes', 'body-front.svg');

/**
 * Тесты силуэта тела с подсветкой целиком (вариант А).
 *
 * Источник графики — Wikimedia Commons, «Human body silhouette.svg»,
 * лицензия Public domain (атрибуция не требуется). Файл переработан:
 * оставлена одна замкнутая фигура, координаты нормализованы.
 *
 * Подсветка применяется к фигуре ЦЕЛИКОМ, а не по зонам: обхваты
 * в приложении не измеряются, а оцениваются по весу, росту и ИМТ.
 * Оценка по отдельным зонам («обхват плеча» из ИМТ) создавала бы
 * ложное впечатление точного измерения.
 */
type SilhouetteState = 'low' | 'normal' | 'high' | 'unknown';

function stateFromBmi(bmi: number): SilhouetteState {
  if (!Number.isFinite(bmi) || bmi <= 0) return 'unknown';
  if (bmi < 18.5) return 'low';
  if (bmi < 25) return 'normal';
  return 'high';
}

const LABEL: Record<SilhouetteState, string> = {
  low: 'ниже нормы',
  normal: 'норма',
  high: 'выше нормы',
  unknown: 'нет данных',
};

describe('силуэт тела: состояние по ИМТ', () => {
  it('определяет норму в диапазоне 18.5–24.9', () => {
    assert.strictEqual(stateFromBmi(18.5), 'normal', 'нижняя граница включительно');
    assert.strictEqual(stateFromBmi(22.9), 'normal');
    assert.strictEqual(stateFromBmi(24.9), 'normal', 'верхняя граница включительно');
  });

  it('определяет недостаток веса', () => {
    assert.strictEqual(stateFromBmi(17), 'low');
    assert.strictEqual(stateFromBmi(18.4), 'low');
  });

  it('определяет избыток веса и ожирение', () => {
    assert.strictEqual(stateFromBmi(25), 'high');
    assert.strictEqual(stateFromBmi(31), 'high');
  });

  it('некорректный ИМТ даёт состояние «нет данных»', () => {
    // ИМТ = 0 при незаполненном росте: показывать «норму» было бы ложью.
    assert.strictEqual(stateFromBmi(0), 'unknown');
    assert.strictEqual(stateFromBmi(-5), 'unknown');
    assert.strictEqual(stateFromBmi(NaN), 'unknown');
    assert.strictEqual(stateFromBmi(Infinity), 'unknown');
  });

  it('у каждого состояния есть подпись для интерфейса', () => {
    for (const s of ['low', 'normal', 'high', 'unknown'] as const) {
      assert.isString(LABEL[s]);
      assert.isAbove(LABEL[s].length, 0);
    }
  });

  it('границы не пересекаются: каждое значение попадает ровно в одно состояние', () => {
    for (const bmi of [15, 18.5, 20, 24.9, 25, 30, 40]) {
      const s = stateFromBmi(bmi);
      assert.notStrictEqual(s, 'unknown', `ИМТ ${bmi} должен иметь состояние`);
    }
  });
});

describe('силуэт тела: графический файл', () => {
  it('силуэт — один замкнутый контур без разметки зон', () => {
    // Проверяем через файл: у варианта А нет отдельных зон,
    // поэтому подсветка применяется к фигуре целиком.
    const svg = readFileSync(SILHOUETTE, 'utf8');

    const paths = svg.match(/<path/g) ?? [];
    assert.strictEqual(paths.length, 1, 'должен быть ровно один контур');

    // Замкнутость: контур заканчивается командой z (перед закрытием тега
    // может стоять пробел).
    assert.match(svg, /z\s*"\s*\/>/, 'контур должен быть замкнут');

    // Заливка задаётся снаружи — файл не знает о состояниях.
    assert.include(svg, 'fill="#000"', 'заливка нужна для работы CSS-маски');
    assert.notInclude(svg, 'var(--zone', 'цвет не должен быть зашит в файл');
  });

  it('координаты укладываются в viewBox (нет обрезки)', () => {
    const svg = readFileSync(SILHOUETTE, 'utf8');

    const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
    assert.isNotNull(vb, 'viewBox должен быть задан');
    const [, w, h] = vb!;

    // Исходный контур выходит за начало координат, поэтому в файле
    // есть компенсирующий transform — без него силуэт обрезался бы.
    const tr = /transform="translate\(([\d.]+) ([\d.]+)\)"/.exec(svg);
    assert.isNotNull(tr, 'нужен компенсирующий transform');

    assert.isAbove(Number(w), 0);
    assert.isAbove(Number(h), 0);
  });

  it('лицензия зафиксирована в файле', () => {
    const svg = readFileSync(SILHOUETTE, 'utf8');

    assert.include(svg, 'Public domain', 'лицензия должна быть указана');
    assert.include(svg, 'Wikimedia Commons', 'источник должен быть указан');
  });
});
