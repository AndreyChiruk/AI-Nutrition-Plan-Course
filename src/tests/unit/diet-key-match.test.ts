import { assert } from 'chai';
import { describe, it } from 'mocha';
import { containsDietKey } from '../../meal-plan/dietary-rules';

/**
 * Тесты сопоставления ингредиентов со словарём диет.
 *
 * Раньше использовался `ingredient.includes(key)`, из-за чего ключи-обрубки
 * срабатывали внутри других слов и блюдо помечалось неверно:
 *   «мид»    → «помидоры»        → мясное
 *   «гус»    → «густой соус»     → гусь
 *   «фарш»   → «фаршированный»   → мясной фарш
 *   «nut»    → «coconut»         → орехи (кокос — не орех)
 *   «butter» → «buttermilk»      → масло
 *   «икр»    → «икра баклажанная»→ рыбная икра
 *   «рис»    → «ирис», «барбарис»
 *   «соль»   → «фасоль»
 */
describe('containsDietKey: границы слов вместо подстрок', () => {
  it('не срабатывает на ложных вхождениях (русские ключи)', () => {
    const falsePositives: Array<[string, string]> = [
      ['Помидоры', 'мид'],
      ['Томатный соус', 'мид'],
      ['Густой соус', 'гус'],
      ['Гуляш', 'гус'],
      ['Фаршированный перец', 'фарш'],
      ['Икра баклажанная', 'икр'],
      ['Ирис', 'рис'],
      ['Барбарис', 'рис'],
      ['Фасоль', 'соль'],
      ['Макароны', 'мак'],
    ];
    for (const [word, key] of falsePositives) {
      assert.isFalse(containsDietKey(word, key), `«${key}» не должен срабатывать в «${word}»`);
    }
  });

  it('не срабатывает на ложных вхождениях (латинские ключи)', () => {
    assert.isFalse(containsDietKey('coconut', 'nut'));
    assert.isFalse(containsDietKey('butternut squash', 'nut'));
    assert.isFalse(containsDietKey('nutmeg', 'nut'));
    assert.isFalse(containsDietKey('buttermilk', 'butter'));
    assert.isFalse(containsDietKey('peach', 'pea'));
    assert.isFalse(containsDietKey('peanut', 'pea'));
  });

  it('срабатывает на настоящих ингредиентах (русские основы)', () => {
    const positives: Array<[string, string]> = [
      ['Курица', 'кури'],
      ['Куриный бульон', 'кури'],
      ['Курицей', 'кури'],
      ['Говядина', 'говяд'],
      ['Рыба', 'рыб'],
      ['Рыбное филе', 'рыб'],
      ['Яйцо', 'яйц'],
      ['Яйца', 'яйц'],
      ['Яичный белок', 'яичн'],
      ['Молоко', 'молок'],
      ['Сыр', 'сыр'],
      ['Пшеничная мука', 'пшен'],
      ['Картофель', 'картоф'],
      ['Фасоль', 'фасол'],
      ['Орехи', 'орех'],
      ['Миндаль', 'миндал'],
      ['Сахар', 'сахар'],
    ];
    for (const [word, key] of positives) {
      assert.isTrue(containsDietKey(word, key), `«${key}» должен срабатывать в «${word}»`);
    }
  });

  it('срабатывает на настоящих ингредиентах (латиница)', () => {
    assert.isTrue(containsDietKey('chicken breast', 'chicken'));
    assert.isTrue(containsDietKey('butter', 'butter'));
    assert.isTrue(containsDietKey('peanut', 'peanut'));
  });

  it('различает «фарш» и «фаршированный»', () => {
    // Ключевой кейс: фаршированные овощи — вегетарианское блюдо,
    // а свиной фарш — нет.
    assert.isFalse(containsDietKey('Фаршированный перец', 'фарш'));
    assert.isTrue(containsDietKey('Фарш свиной', 'фарш'));
  });

  it('различает «гусь» и «густой»', () => {
    assert.isFalse(containsDietKey('Густой соус', 'гус'));
    assert.isTrue(containsDietKey('Гусь запечённый', 'гус'));
  });

  it('устойчив к регистру и «ё»', () => {
    assert.isTrue(containsDietKey('КУРИЦА', 'кури'));
    assert.isTrue(containsDietKey('свёкла', 'свекл'));
  });

  it('не падает на пустых значениях', () => {
    assert.isFalse(containsDietKey('', 'кури'));
    assert.isFalse(containsDietKey('курица', ''));
    assert.isFalse(containsDietKey('', ''));
  });
});
