import { assert } from 'chai';
import { describe, it } from 'mocha';
import { productHasUserAllergen } from '../../meal-plan/dietary-rules';
import { ALLERGEN_INGREDIENTS } from '../../meal-plan/slovari';
import { CATALOG_ALLERGEN_VALUES } from '../../meal-plan/catalog-ai-normalize';
import type { Product } from '../../models/Product';

/**
 * Тесты полноты справочника аллергенов.
 *
 * Найденные пропуски (аудит + проверка на реальных данных каталога):
 *   - «сельдь», «скумбрия», «горбуша», «семга», «палтус», «хек», «камбала»,
 *     «сайда» не считались рыбой → блюдо проходило проверку при аллергии на рыбу;
 *   - «майонез» не считался яйцом → «Салат Цезарь» проходил при аллергии на яйца;
 *   - «сливочное масло», «мороженое», «сгущёнка», «маргарин» не считались
 *     лактозой;
 *   - кунжут и горчица (основные аллергены) отсутствовали в справочнике вовсе.
 */
function dish(name: string, ingredients: string[]): Product {
  return {
    id: name,
    name,
    calories: 300,
    protein: 10,
    fat: 10,
    carbs: 30,
    allergens: [],
    dietaryTags: [],
    ingredients: ingredients.map((n) => ({ name: n })),
    ingredientsDetailed: ingredients.map((n) => ({ name: n })),
  } as unknown as Product;
}

describe('ALLERGEN_INGREDIENTS: полнота справочника', () => {
  it('содержит все значения из CATALOG_ALLERGEN_VALUES', () => {
    for (const allergen of CATALOG_ALLERGEN_VALUES) {
      assert.isArray(
        ALLERGEN_INGREDIENTS[allergen],
        `справочник должен содержать «${allergen}»`,
      );
      assert.isAbove(ALLERGEN_INGREDIENTS[allergen].length, 0, allergen);
    }
  });

  it('распознаёт рыбу во всех распространённых видах', () => {
    const fish = ['Сельдь', 'Скумбрия', 'Горбуша', 'Семга', 'Палтус', 'Хек', 'Камбала', 'Сайда', 'Лосось', 'Треска'];
    for (const name of fish) {
      assert.isTrue(
        productHasUserAllergen(dish('Блюдо', [name]), new Set(['рыба'])),
        `«${name}» должен определяться как рыба`,
      );
    }
  });

  it('распознаёт яйца в майонезе', () => {
    assert.isTrue(
      productHasUserAllergen(dish('Салат Цезарь', ['Курица', 'Майонез', 'Сыр']), new Set(['яйца'])),
      'майонез делается на желтке',
    );
  });

  it('распознаёт лактозу в производных продуктах', () => {
    for (const name of ['Сливочное масло', 'Мороженое', 'Сгущённое молоко', 'Маргарин', 'Сливки', 'Творог']) {
      assert.isTrue(
        productHasUserAllergen(dish('Блюдо', [name]), new Set(['лактоза'])),
        `«${name}» должен определяться как лактоза`,
      );
    }
  });

  it('распознаёт кунжут и горчицу (новые аллергены)', () => {
    assert.isTrue(productHasUserAllergen(dish('Булочки', ['Мука', 'Кунжут']), new Set(['кунжут'])));
    assert.isTrue(productHasUserAllergen(dish('Соус', ['Горчица', 'Мёд']), new Set(['горчица'])));
    assert.isTrue(productHasUserAllergen(dish('Салат', ['Сельдерей']), new Set(['сельдерей'])));
  });

  it('реальные проблемные блюда из каталога', () => {
    assert.isTrue(
      productHasUserAllergen(dish('Сельдь под шубой', ['Сельдь', 'Картофель', 'Майонез']), new Set(['рыба'])),
    );
    assert.isTrue(
      productHasUserAllergen(dish('Сельдь под шубой', ['Сельдь', 'Картофель', 'Майонез']), new Set(['яйца'])),
    );
  });

  it('не даёт ложных срабатываний на безопасных блюдах', () => {
    assert.isFalse(productHasUserAllergen(dish('Овощной салат', ['Помидор', 'Огурец', 'Масло']), new Set(['рыба'])));
    assert.isFalse(productHasUserAllergen(dish('Рис с овощами', ['Рис', 'Морковь']), new Set(['орехи'])));
    assert.isFalse(productHasUserAllergen(dish('Фрукты', ['Яблоко', 'Банан']), new Set(['лактоза'])));
  });

  it('пустой набор аллергенов не блокирует ничего', () => {
    assert.isFalse(productHasUserAllergen(dish('Что угодно', ['Мясо']), new Set()));
  });
});
