import { assert } from 'chai';
import { describe, it } from 'mocha';
import { containsDietKey } from '../../meal-plan/dietary-rules';
import { ALLERGEN_INGREDIENTS } from '../../meal-plan/slovari';
import { normalizeCatalogAllergenToken } from '../../meal-plan/catalog-ai-normalize';

/**
 * Тесты определения аллергенов ПО СОСТАВУ блюда.
 *
 * Раньше аллергены брались только из поля `allergensFound`, которое заполняет
 * модель. Если она забывала указать аллерген, но в составе было «Сельдь» или
 * «Майонез», пользователь НЕ получал предупреждения — ложная безопасность.
 *
 * Состав блюда — объективный источник, не зависящий от того, что «вспомнила»
 * модель. Здесь повторяется логика `detectAllergensFromIngredients`.
 */
function detectAllergensFromIngredients(ingredientNames: string[]): string[] {
  const names = ingredientNames.map((n) => String(n ?? '').trim()).filter(Boolean);
  if (names.length === 0) return [];
  const haystack = names.join(' | ');
  const found = new Set<string>();
  for (const [allergen, roots] of Object.entries(ALLERGEN_INGREDIENTS)) {
    for (const root of roots ?? []) {
      if (containsDietKey(haystack, root)) {
        found.add(normalizeCatalogAllergenToken(allergen) ?? allergen);
        break;
      }
    }
  }
  return [...found];
}

describe('аллергены из состава блюда', () => {
  it('находит рыбу в «Сельди под шубой» (главный кейс)', () => {
    const found = detectAllergensFromIngredients([
      'Сельдь',
      'Картофель',
      'Морковь',
      'Майонез',
      'Свёкла',
    ]);
    assert.include(found, 'рыба');
    // Майонез делается на желтке — аллергия на яйца тоже важна.
    assert.include(found, 'яйца');
  });

  it('находит яйца в майонезе для «Салата Цезарь»', () => {
    const found = detectAllergensFromIngredients([
      'Куриная грудка',
      'Майонез',
      'Сыр',
      'Сухарики',
    ]);
    assert.include(found, 'яйца');
    assert.include(found, 'лактоза');
    assert.include(found, 'глютен');
  });

  it('находит аллергены по видам рыб', () => {
    for (const fish of ['Скумбрия', 'Сельдь', 'Горбуша', 'Палтус', 'Хек', 'Камбала']) {
      const found = detectAllergensFromIngredients([fish, 'Лимон']);
      assert.include(found, 'рыба', fish);
    }
  });

  it('находит новые аллергены: кунжут, горчицу, сельдерей', () => {
    assert.include(detectAllergensFromIngredients(['Мука', 'Кунжут']), 'кунжут');
    assert.include(detectAllergensFromIngredients(['Горчица', 'Уксус']), 'горчица');
    assert.include(detectAllergensFromIngredients(['Сельдерей', 'Соль']), 'сельдерей');
  });

  it('находит лактозу в производных молока', () => {
    for (const product of ['Молоко', 'Сливки', 'Сыр', 'Масло сливочное', 'Мороженое', 'Творог']) {
      assert.include(detectAllergensFromIngredients([product]), 'лактоза', product);
    }
  });

  it('не даёт ложных срабатываний на безопасных блюдах', () => {
    assert.isEmpty(detectAllergensFromIngredients(['Помидор', 'Огурец', 'Масло оливковое']));
    assert.isEmpty(detectAllergensFromIngredients(['Рис', 'Морковь', 'Лук']));
    assert.isEmpty(detectAllergensFromIngredients(['Яблоко', 'Банан']));
  });

  it('не путает похожие слова (границы слов)', () => {
    // «Кокос» не орех в смысле аллергии, «рис» не должен ловиться в «ирисе».
    assert.notInclude(detectAllergensFromIngredients(['Рис']), 'орехи');
    assert.notInclude(detectAllergensFromIngredients(['Ирис']), 'рыба');
  });

  it('устойчив к пустому составу', () => {
    assert.isEmpty(detectAllergensFromIngredients([]));
    assert.isEmpty(detectAllergensFromIngredients(['', '   ']));
  });

  it('находит несколько аллергенов одновременно', () => {
    const found = detectAllergensFromIngredients([
      'Мука пшеничная',
      'Молоко',
      'Яйцо',
      'Кунжут',
      'Горчица',
    ]);
    for (const a of ['глютен', 'лактоза', 'яйца', 'кунжут', 'горчица']) {
      assert.include(found, a, a);
    }
  });
});
