import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  describeDietaryPool,
  dietMismatchScore,
  filterProductsByDietary,
} from '../../meal-plan/dietary-rules';
import type { Product } from '../../models/Product';

/**
 * Тесты «мягкой» фильтрации по диетам.
 *
 * Причина появления: жёсткий фильтр по диете мог обнулить пул блюд
 * (например, «высокобелковая» отбрасывала все 669 блюд каталога, потому что
 * ни одно не достигало порога 28 % белка). Генератор планов в таком случае
 * подставлял заглушки «Блюдо (slot)» с фиксированными 300 ккал, а в AI-ветке
 * сохранялся план с нулевой калорийностью.
 */

/** Создаёт минимальный объект блюда для тестов. */
function dish(partial: Partial<Product> & { name: string }): Product {
  return {
    id: partial.id ?? partial.name,
    calories: 300,
    protein: 10,
    fat: 10,
    carbs: 30,
    allergens: [],
    dietaryTags: [],
    ingredients: [],
    ingredientsDetailed: [],
    ...partial,
  } as unknown as Product;
}

describe('filterProductsByDietary: жёсткий и мягкий режимы', () => {
  it('без ограничений возвращает всё как есть', () => {
    const pool = [dish({ name: 'A' }), dish({ name: 'B' })];
    assert.lengthOf(filterProductsByDietary(pool, []), 2);
  });

  it('качественные диеты (веган) не смягчаются', () => {
    // Блюда с мясом и яйцами не должны попасть в веганский пул,
    // даже если после фильтра осталось мало блюд.
    const pool = [
      dish({ name: 'Овсянка', dietaryTags: ['vegan'], ingredientsDetailed: [{ name: 'Овсянка' }] as never }),
      dish({ name: 'Омлет', ingredientsDetailed: [{ name: 'Яйцо' }, { name: 'Молоко' }] as never }),
      dish({ name: 'Стейк', ingredientsDetailed: [{ name: 'Говядина' }] as never }),
    ];
    const filtered = filterProductsByDietary(pool, ['vegan']);
    const names = filtered.map((p) => p.name);
    assert.notInclude(names, 'Омлет', 'яйца не должны попасть в веганский пул');
    assert.notInclude(names, 'Стейк', 'мясо не должно попасть в веганский пул');
  });

  it('диета без глютена не смягчается', () => {
    const pool = [
      dish({ name: 'Рис', ingredientsDetailed: [{ name: 'Рис' }] as never }),
      dish({ name: 'Хлеб', ingredientsDetailed: [{ name: 'Пшеничная мука' }] as never }),
    ];
    const names = filterProductsByDietary(pool, ['gluten-free']).map((p) => p.name);
    assert.notInclude(names, 'Хлеб');
  });

  it('количественные диеты (высокобелковая) добирают пул до минимума', () => {
    // Ни одно блюдо не достигает 28 % белка, но пул не должен остаться пустым.
    const pool = Array.from({ length: 40 }, (_, i) =>
      dish({ name: `Блюдо${i}`, calories: 300, protein: 12 }),
    );
    const filtered = filterProductsByDietary(pool, ['high-protein']);
    assert.isAtLeast(filtered.length, 25, 'пул должен быть пригодным для генерации плана');

    const desc = describeDietaryPool(pool, ['high-protein']);
    assert.isTrue(desc.usedSoft, 'должен включиться мягкий режим');
  });

  it('в мягком режиме более подходящие блюда идут первыми', () => {
    const pool = [
      dish({ name: 'Мало белка', calories: 300, protein: 6 }), // 8 %
      dish({ name: 'Много белка', calories: 300, protein: 20 }), // 26.7 %
      dish({ name: 'Средне', calories: 300, protein: 15 }), // 20 %
    ];
    const filtered = filterProductsByDietary(pool, ['high-protein']);
    assert.strictEqual(filtered[0].name, 'Много белка', 'ближайшее к порогу должно быть первым');
  });

  it('кето: мягкий добор сохраняет порядок по близости к порогу', () => {
    const pool = [
      dish({ name: 'Много углеводов', carbs: 80 }),
      dish({ name: 'Мало углеводов', carbs: 24 }),
      dish({ name: 'Средне', carbs: 40 }),
    ];
    const filtered = filterProductsByDietary(pool, ['keto']);
    assert.strictEqual(filtered[0].name, 'Мало углеводов');
  });

  it('возвращает не больше исходного пула', () => {
    const pool = [dish({ name: 'A', protein: 1 })];
    assert.lengthOf(filterProductsByDietary(pool, ['high-protein']), 1);
  });

  it('dietMismatchScore: 0 для соответствующего блюда', () => {
    const good = dish({ name: 'Курица', calories: 200, protein: 30, dietaryTags: ['high-protein'] });
    assert.strictEqual(dietMismatchScore(good, 'high-protein'), 0);
  });

  it('dietMismatchScore: больше нуля для несоответствующего', () => {
    const bad = dish({ name: 'Торт', calories: 400, protein: 2 });
    assert.isAbove(dietMismatchScore(bad, 'high-protein'), 0);
  });

  it('describeDietaryPool сообщает о строгом количестве', () => {
    const pool = [
      dish({ name: 'A', dietaryTags: ['vegan'], ingredientsDetailed: [{ name: 'Овсянка' }] as never }),
      dish({ name: 'B', ingredientsDetailed: [{ name: 'Мясо' }] as never }),
    ];
    const desc = describeDietaryPool(pool, ['vegan']);
    assert.strictEqual(desc.strict, 1);
    assert.isFalse(desc.usedSoft);
  });
});
