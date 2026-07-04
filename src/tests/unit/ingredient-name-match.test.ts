import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  isIngredientMatch,
  normalizeRuFoodText,
  resolveCatalogProductByName,
  ruHaystackMatchesKeyword,
} from '../../common/ingredient-name-match';

describe('ingredient-name-match', () => {
  it('normalizeRuFoodText: trim, lower, ё→е', () => {
    assert.equal(normalizeRuFoodText('  Ёлка '), 'елка');
  });

  it('ruHaystackMatchesKeyword: целое слово лук в строке', () => {
    assert.isTrue(ruHaystackMatchesKeyword('добавить лук и морковь', 'лук'));
    assert.isFalse(ruHaystackMatchesKeyword('луковый суп', 'лук'));
  });

  it('isIngredientMatch: лук и зелёный лук не считаются одним ингредиентом', () => {
    assert.isFalse(isIngredientMatch('лук', 'зелёный лук'));
    assert.isFalse(isIngredientMatch('зеленый лук', 'лук'));
  });

  it('isIngredientMatch: одинаковые названия совпадают', () => {
    assert.isTrue(isIngredientMatch('Помидор', 'помидор'));
  });

  it('resolveCatalogProductByName: точное совпадение после нормализации', () => {
    const hit = resolveCatalogProductByName('  Борщ ', [{ name: 'Борщ' }, { name: 'Суп' }]);
    assert.equal(hit?.name, 'Борщ');
  });

  it('resolveCatalogProductByName: null при пустых кандидатах', () => {
    assert.isNull(resolveCatalogProductByName('Суп', []));
  });
});
