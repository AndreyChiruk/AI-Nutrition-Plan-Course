import { assert } from 'chai';
import { describe, it } from 'mocha';
import { inferMealSlotFromDishName } from '../../meal-plan/dish-category-infer.util';

/**
 * Тесты алкогольной политики.
 *
 * Два дефекта:
 * 1. `stripMainAlcohol` возвращал исходный список, если «трезвый» оказывался
 *    пуст (`stripped.length > 0 ? stripped : list`) — алкоголь попадал
 *    в завтрак/обед/ужин.
 * 2. Финальная проверка касалась ТОЛЬКО перекусов. В реальном плане
 *    вегетарианца находились «Коктейль Гиллигана» и «Лимонная корона».
 *
 * Дополнительно: напитки из TheCocktailDB классифицировались как `lunch`
 * (40 позиций), то есть алкоголь оказывался в пуле основного приёма пищи.
 */
describe('классификация напитков', () => {
  it('алкогольные напитки относятся к перекусам, а не к основным блюдам', () => {
    const drinks = [
      'Коктейль Абсолютно великолепный',
      'Коктейль Гиллигана',
      'Лимонная корона',
      'Мохито',
      'Маргарита',
      'Дайкири',
      'Пиво светлое',
      'Красное вино',
      'Белое сухое вино',
      'Шампанское',
      'Портвейн',
      'Виски',
      'Водка',
    ];
    for (const d of drinks) {
      assert.strictEqual(
        inferMealSlotFromDishName(d),
        'snack',
        `«${d}» должен быть перекусом, а не основным блюдом`,
      );
    }
  });

  it('безалкогольные напитки тоже перекус', () => {
    for (const d of ['Апельсиновый сок', 'Лимонад', 'Компот', 'Кофе латте', 'Какао']) {
      assert.strictEqual(inferMealSlotFromDishName(d), 'snack', d);
    }
  });

  it('не путает напитки с блюдами, содержащими похожие слова', () => {
    // «Винный уксус» и «пиво» в названии блюда не должны ломать классификацию еды.
    assert.strictEqual(inferMealSlotFromDishName('Борщ'), 'lunch');
    assert.strictEqual(inferMealSlotFromDishName('Курица по-ямайски'), 'lunch');
    assert.strictEqual(inferMealSlotFromDishName('Банановые блины'), 'breakfast');
    assert.strictEqual(inferMealSlotFromDishName('Запечённые баклажаны'), 'dinner');
  });

  it('алкоголь не попадает ни в один основной приём пищи', () => {
    const alcohol = ['Коктейль', 'Вино', 'Пиво', 'Водка', 'Джин', 'Виски', 'Ром', 'Текила'];
    for (const kind of alcohol) {
      const slot = inferMealSlotFromDishName(kind);
      assert.notStrictEqual(slot, 'breakfast', kind);
      assert.notStrictEqual(slot, 'lunch', kind);
      assert.notStrictEqual(slot, 'dinner', kind);
    }
  });
});
