import { assert } from 'chai';
import { describe, it } from 'mocha';
import { collectIngredientMatchRoots } from '../../meal-plan/ingredient-match.util';

/**
 * Тесты на построение ключевых слов для поиска и подбора блюд.
 *
 * Причина появления: при импорте каталога поле `match_keywords` не заполнялось
 * вовсе — пусто у всех 669 блюд. Из-за этого поиск по ингредиентам, подбор по
 * вкусовым предпочтениям и фильтрация по dislikes работали вслепую.
 */
describe('collectIngredientMatchRoots: ключевые слова каталога', () => {
  it('извлекает корни слов из состава', () => {
    const roots = collectIngredientMatchRoots(
      [{ name: 'Куриная грудка' }, { name: 'Оливковое масло' }],
      [],
    );
    assert.isAbove(roots.length, 0);
    assert.include(roots, 'куриная');
    assert.include(roots, 'оливковое');
  });

  it('добавляет усечённые основы для длинных слов', () => {
    const roots = collectIngredientMatchRoots([{ name: 'картофель' }], []);
    // Для слов от 6 символов добавляется основа из 5 букв.
    assert.isTrue(roots.some((r) => r.startsWith('карто')), `ожидалась основа, есть: ${roots}`);
  });

  it('приводит к нижнему регистру и убирает «ё»', () => {
    const roots = collectIngredientMatchRoots([{ name: 'Свёкла' }], []);
    assert.isTrue(roots.includes('свекла'), `есть: ${roots}`);
  });

  it('сохраняет ранее записанные ключевые слова', () => {
    const roots = collectIngredientMatchRoots([{ name: 'рис' }], ['базилик']);
    assert.include(roots, 'базилик');
    assert.include(roots, 'рис');
  });

  it('разбивает составные названия на слова', () => {
    const roots = collectIngredientMatchRoots([{ name: 'лук репчатый' }], []);
    assert.include(roots, 'лук');
    assert.include(roots, 'репчатый');
  });

  it('не падает на пустом составе', () => {
    assert.deepEqual(collectIngredientMatchRoots([], []), []);
    assert.deepEqual(collectIngredientMatchRoots([], null), []);
  });
});
