import { assert } from 'chai';
import { describe, it } from 'mocha';
import { inferMealSlotFromDishName } from '../../meal-plan/dish-category-infer.util';

/**
 * Регрессионные тесты на классификацию блюд по приёмам пищи.
 *
 * Причина появления: в каталоге оказалось 406 «ужинов», 0 «обедов» и 22 «завтрака».
 * Генератор планов не мог подобрать обед (пул `lunch` был пуст), поэтому обед
 * всегда подставлялся из ужинов и закусок, а категория в снапшоте перезаписывалась
 * слотом — внешне это выглядело как рабочая функция.
 */
describe('inferMealSlotFromDishName', () => {
  it('распознаёт завтраки', () => {
    for (const n of ['Банановые блины', 'Омлет с хлебом', 'Овсяная каша', 'Сырники', 'Яичница', 'Шакшука', 'Вафли']) {
      assert.strictEqual(inferMealSlotFromDishName(n), 'breakfast', n);
    }
  });

  it('распознаёт основные блюда как обед', () => {
    for (const n of ['Кабса', 'Курица по-ямайски с рисом', 'Лапша с курицей', 'Борщ', 'Плов', 'Паста карбонара']) {
      assert.strictEqual(inferMealSlotFromDishName(n), 'lunch', n);
    }
  });

  it('белковое горячее с салатом — обед, а не перекус', () => {
    assert.strictEqual(inferMealSlotFromDishName('Курица Piri-piri с салатом'), 'lunch');
    assert.strictEqual(inferMealSlotFromDishName('Лосось на гриле с овощами'), 'lunch');
  });

  it('запечённые блюда и овощи относятся к ужину', () => {
    // Явные маркеры ужина: «запечён», «тушён», овощи, фенхель.
    for (const n of [
      'Запечённый лосось с фенхелем',
      'Запечённые овощи',
      'Тушёная капуста',
      'Рагу из овощей',
    ]) {
      assert.strictEqual(inferMealSlotFromDishName(n), 'dinner', n);
    }
  });

  it('распознаёт перекусы и десерты', () => {
    for (const n of ['Печенье Анзак', 'Яблочный торт', 'Торт Баттенберг', 'Салат из огурцов', 'Яблочный крамбл']) {
      assert.strictEqual(inferMealSlotFromDishName(n), 'snack', n);
    }
  });

  it('распознаёт ужины (овощные и запечённые блюда)', () => {
    for (const n of ['Запеченные баклажаны с соусом тахини', 'Овощной пирог', 'Ма по тофу']) {
      assert.strictEqual(inferMealSlotFromDishName(n), 'dinner', n);
    }
  });

  it('не сваливает всё в один слот (защита от прошлого дефекта)', () => {
    const sample = [
      'Банановые блины',
      'Кабса',
      'Печенье Анзак',
      'Запеченные баклажаны',
      'Омлет',
      'Борщ',
      'Яблочный торт',
    ];
    const slots = new Set(sample.map((s) => inferMealSlotFromDishName(s)));
    assert.isAtLeast(slots.size, 3, 'должны получаться разные слоты');
  });

  it('устойчива к пустой строке и регистру', () => {
    assert.strictEqual(inferMealSlotFromDishName(''), 'dinner');
    assert.strictEqual(inferMealSlotFromDishName('  БОРЩ  '), 'lunch');
    assert.strictEqual(inferMealSlotFromDishName('ОМЛЕТ'), 'breakfast');
  });
});
