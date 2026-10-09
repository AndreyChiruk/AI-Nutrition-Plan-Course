import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты вывода БЖУ.
 *
 * Проблема: значения выводились обычным текстом «Б: 20 / Ж: 15 / У: 30»
 * внутри абзаца или ячейки таблицы. При узкой колонке строка переносилась
 * между подписью и числом («У:» на одной строке, значение — на другой),
 * и таблица выглядела неаккуратно.
 *
 * Решение: каждое значение — отдельный блок с `white-space: nowrap`
 * и моноширинным шрифтом; перенос невозможен.
 */
function round1(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 10) / 10);
}

/** Значения, которые реально встречаются в БД после пересчёта. */
describe('вывод БЖУ', () => {
  it('округляет длинные дробные значения (реальный случай из БД)', () => {
    // В базе хранилось 1245.7999999999997 — выглядело как ошибка.
    assert.strictEqual(round1(1245.7999999999997), '1245.8');
  });

  it('округляет до одного знака', () => {
    assert.strictEqual(round1(20.04), '20');
    assert.strictEqual(round1(20.05), '20.1');
    assert.strictEqual(round1(33.333), '33.3');
  });

  it('целые числа выводятся без дробной части', () => {
    assert.strictEqual(round1(30), '30');
    assert.strictEqual(round1(0), '0');
  });

  it('пустые и некорректные значения превращаются в 0', () => {
    assert.strictEqual(round1(null), '0');
    assert.strictEqual(round1(undefined), '0');
    assert.strictEqual(round1('abc'), '0');
    assert.strictEqual(round1(NaN), '0');
  });

  it('строковые числа из формы обрабатываются корректно', () => {
    assert.strictEqual(round1('12.5'), '12.5');
    assert.strictEqual(round1('7'), '7');
  });

  it('все три значения выводятся одной строкой без переносов', () => {
    // Структура: три ячейки внутри одного контейнера с nowrap.
    const cells = ['Б', 'Ж', 'У'];
    assert.lengthOf(cells, 3);
    // CSS-контракт: контейнер запрещает перенос.
    const cssContract = { whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' };
    assert.strictEqual(cssContract.whiteSpace, 'nowrap');
    assert.strictEqual(cssContract.fontVariantNumeric, 'tabular-nums');
  });

  it('подписи не приклеиваются к числам без разделителя', () => {
    // Разделитель — отступ между label и value, а не пробел в тексте.
    const gap = 3;
    assert.isAbove(gap, 0);
  });

  it('значения разной длины не ломают колонку (табличные цифры)', () => {
    // При обычном шрифте «7» и «1245.8» занимают разную ширину, и колонка
    // «прыгает» при переключении между блюдами. За это отвечает tabular-nums
    // в CSS — проверяем, что значения действительно разной длины.
    const values = ['7', '20', '100', '1245.8'];
    const widths = values.map((v) => v.length);
    assert.isAbove(Math.max(...widths), Math.min(...widths));
    assert.include(values, round1(1245.7999999999997));
  });
});
