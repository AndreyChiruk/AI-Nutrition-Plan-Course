import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  normalizeIngredientName,
  normalizeIngredients,
} from '../../food-recognition/ingredient-names.util';

/**
 * Тесты перевода названий ингредиентов.
 *
 * Модель иногда вставляет английские слова в состав блюда
 * («в blueberries ~15 г»), хотя промпт требует русский язык.
 * Эти тесты фиксируют, что частые продукты переводятся, а
 * незнакомые слова не портятся.
 */
describe('ингредиенты: перевод названий', () => {
  it('переводит частые ягоды и фрукты', () => {
    assert.strictEqual(normalizeIngredientName('blueberries'), 'голубика');
    assert.strictEqual(normalizeIngredientName('strawberry'), 'клубника');
    assert.strictEqual(normalizeIngredientName('apple'), 'яблоко');
  });

  it('не зависит от регистра и лишних пробелов', () => {
    assert.strictEqual(normalizeIngredientName('  BlueBerries  '), 'голубика');
    assert.strictEqual(normalizeIngredientName('OLIVE OIL'), 'оливковое масло');
  });

  it('русские названия не трогает', () => {
    assert.strictEqual(normalizeIngredientName('голубика'), 'голубика');
    assert.strictEqual(normalizeIngredientName('Овсяные хлопья'), 'Овсяные хлопья');
  });

  it('переводит слова внутри словосочетания', () => {
    // «fresh blueberries» → «fresh голубика»: незнакомое слово остаётся,
    // знакомое переводится. Это лучше, чем потерять продукт целиком.
    const result = normalizeIngredientName('fresh blueberries');
    assert.include(result, 'голубика');
  });

  it('незнакомое слово возвращает как есть', () => {
    // Выдуманный перевод хуже оригинала.
    assert.strictEqual(normalizeIngredientName('quinoa'), 'quinoa');
    assert.strictEqual(normalizeIngredientName('xyz-unknown'), 'xyz-unknown');
  });

  it('пустые значения не ломают функцию', () => {
    assert.strictEqual(normalizeIngredientName(''), '');
    assert.strictEqual(normalizeIngredientName(null), '');
    assert.strictEqual(normalizeIngredientName(undefined), '');
    assert.strictEqual(normalizeIngredientName('   '), '');
  });

  it('переводит список и не меняет исходный массив', () => {
    const source = [{ name: 'blueberries', grams: 15 }, { name: 'молоко', grams: 100 }];
    const result = normalizeIngredients(source);

    assert.strictEqual(result[0].name, 'голубика');
    assert.strictEqual(result[1].name, 'молоко');
    assert.strictEqual(result[0].grams, 15, 'остальные поля сохраняются');
    assert.strictEqual(source[0].name, 'blueberries', 'исходный массив не изменён');
  });

  it('нормализация списка безопасна для пустых значений', () => {
    assert.deepStrictEqual(normalizeIngredients(null), []);
    assert.deepStrictEqual(normalizeIngredients(undefined), []);
    assert.deepStrictEqual(normalizeIngredients([]), []);
  });
});
