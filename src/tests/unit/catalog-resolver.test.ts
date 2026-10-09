import { assert } from 'chai';
import { describe, it } from 'mocha';
import { resolveCatalogProductByName } from '../../common/ingredient-name-match';

/**
 * Тесты поиска блюда в каталоге по названию от модели.
 *
 * Раньше функция умела только точное совпадение и `isIngredientMatch`
 * со строгим равенством ключей. Базовые продукты отнесены к WEAK_HEADS,
 * поэтому обобщённые названия не находились:
 *   resolveCatalogProductByName('лук',    [Лук репчатый])   -> null
 *   resolveCatalogProductByName('курица', [Куриная грудка]) -> null
 *   resolveCatalogProductByName('сыр',    [Сыр чеддер])     -> null
 *
 * Последствие: в AI-ветке плана нераспознанное блюдо становилось снапшотом
 * с `calories: 0`, и такой план сохранялся в БД.
 */
describe('resolveCatalogProductByName', () => {
  const catalog = [
    { name: 'Лук репчатый' },
    { name: 'Зелёный лук' },
    { name: 'Сыр чеддер' },
    { name: 'Куриная грудка' },
    { name: 'Яйца' },
    { name: 'Рис' },
    { name: 'Оливковое масло' },
    { name: 'Хлеб' },
    { name: 'Молоко' },
  ];

  it('находит обобщённые названия из ответа модели', () => {
    const cases: Array<[string, string]> = [
      ['лук', 'Лук репчатый'],
      ['сыр', 'Сыр чеддер'],
      ['курица', 'Куриная грудка'],
      ['яйцо куриное', 'Яйца'],
      ['рис', 'Рис'],
      ['оливковое масло', 'Оливковое масло'],
      ['хлеб', 'Хлеб'],
      ['молоко', 'Молоко'],
    ];
    for (const [query, expected] of cases) {
      const hit = resolveCatalogProductByName(query, catalog);
      assert.isNotNull(hit, `«${query}» должно находиться`);
      assert.strictEqual(hit?.name, expected, query);
    }
  });

  it('предпочитает основное блюдо, а не его вариант', () => {
    // «лук» должен вести на «Лук репчатый», а не на «Зелёный лук».
    const hit = resolveCatalogProductByName('лук', [
      { name: 'Лук репчатый' },
      { name: 'Зелёный лук' },
    ]);
    assert.strictEqual(hit?.name, 'Лук репчатый');
  });

  it('точное совпадение имеет наивысший приоритет', () => {
    const hit = resolveCatalogProductByName('Рис', [
      { name: 'Рис' },
      { name: 'Рис с овощами' },
      { name: 'Рисовая лапша' },
    ]);
    assert.strictEqual(hit?.name, 'Рис');
  });

  it('не схлопывает разные блюда в одно', () => {
    // Регресс: раньше «борщ» и «суп» могли дать одно и то же блюдо.
    const dishes = [
      { name: 'Борщ' },
      { name: 'Куриный суп' },
      { name: 'Солянка' },
      { name: 'Окрошка' },
    ];
    for (const d of dishes) {
      const hit = resolveCatalogProductByName(d.name, dishes);
      assert.strictEqual(hit?.name, d.name, `«${d.name}» должен находиться сам`);
    }
  });

  it('возвращает null для отсутствующего в каталоге названия', () => {
    assert.isNull(resolveCatalogProductByName('несуществующееблюдо', catalog));
    assert.isNull(resolveCatalogProductByName('qwerty', catalog));
  });

  it('устойчив к регистру, «ё» и лишним пробелам', () => {
    const hit = resolveCatalogProductByName('  СЫР ЧЕДДЕР  ', catalog);
    assert.strictEqual(hit?.name, 'Сыр чеддер');
    const hit2 = resolveCatalogProductByName('зелёный лук', catalog);
    assert.isNotNull(hit2);
  });

  it('не падает на пустом запросе и пустом каталоге', () => {
    assert.isNull(resolveCatalogProductByName('', catalog));
    assert.isNull(resolveCatalogProductByName('лук', []));
  });
});
