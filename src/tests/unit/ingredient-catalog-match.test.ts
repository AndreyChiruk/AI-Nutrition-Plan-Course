import { assert } from 'chai';
import { describe, it } from 'mocha';
import { resolveCatalogProductByName } from '../../common/ingredient-name-match';

/**
 * Тесты сопоставления распознанных ингредиентов со справочником.
 *
 * Раньше ингредиенты из ответа модели сохранялись как свободный текст:
 * ни нормализации, ни привязки к справочнику `ingredients`. Пользователь
 * видел «лук репчатый» без связи с ингредиентом, а админ при подтверждении
 * создавал дубли в справочнике («Курица» / «Куриная грудка» / «Куриные бёдра»
 * как три разные записи).
 */
describe('сопоставление ингредиентов со справочником', () => {
  // Фрагмент реального справочника.
  const catalog = [
    { id: 'i1', name: 'Лук' },
    { id: 'i2', name: 'Лук репчатый' },
    { id: 'i3', name: 'Сыр' },
    { id: 'i4', name: 'Сыр чеддер' },
    { id: 'i5', name: 'Яйцо' },
    { id: 'i6', name: 'Куриная грудка' },
    { id: 'i7', name: 'Оливковое масло' },
    { id: 'i8', name: 'Помидор' },
    { id: 'i9', name: 'Чеснок' },
    { id: 'i10', name: 'Рис' },
  ];

  it('находит ингредиент по точному названию', () => {
    const hit = resolveCatalogProductByName('Чеснок', catalog);
    assert.strictEqual(hit?.id, 'i9');
  });

  it('находит ингредиент по обобщённому названию от модели', () => {
    const cases: Array<[string, string]> = [
      ['лук', 'i1'],
      ['сыр', 'i3'],
      ['яйцо', 'i5'],
      ['курица', 'i6'],
      ['рис', 'i10'],
    ];
    for (const [query, expectedId] of cases) {
      const hit = resolveCatalogProductByName(query, catalog);
      assert.isNotNull(hit, `«${query}» должно находиться`);
      assert.strictEqual(hit?.id, expectedId, query);
    }
  });

  it('работает с названиями в нижнем регистре и с лишними пробелами', () => {
    assert.strictEqual(resolveCatalogProductByName('  ПОМИДОР ', catalog)?.name, 'Помидор');
    assert.strictEqual(resolveCatalogProductByName('оливковое масло', catalog)?.name, 'Оливковое масло');
  });

  it('возвращает null для отсутствующего ингредиента, а не «похожее»', () => {
    // «Зелень» нет в справочнике — подставлять что-то другое нельзя,
    // иначе ингредиент получит неверную привязку.
    assert.isNull(resolveCatalogProductByName('Зелень', catalog));
    assert.isNull(resolveCatalogProductByName('Трюфель чёрный', catalog));
  });

  it('не путает разные ингредиенты между собой', () => {
    // Каждый ингредиент должен найтись сам, без подмены.
    for (const item of catalog) {
      const hit = resolveCatalogProductByName(item.name, catalog);
      assert.strictEqual(hit?.id, item.id, item.name);
    }
  });

  it('устойчив к пустому справочнику и пустому запросу', () => {
    assert.isNull(resolveCatalogProductByName('лук', []));
    assert.isNull(resolveCatalogProductByName('', catalog));
    assert.isNull(resolveCatalogProductByName('   ', catalog));
  });
});
