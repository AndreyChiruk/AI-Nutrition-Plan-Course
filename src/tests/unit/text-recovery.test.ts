import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  looksLikeMojibake,
  recoverDeep,
  recoverIfMojibake,
  recoverMojibake,
} from '../../common/text-recovery.util';

/**
 * Тесты на восстановление данных, повреждённых перекодированием UTF-8 ↔ CP866.
 *
 * Реальный инцидент: при переносе проекта дамп БД был снят с неверной
 * клиентской кодировкой, из-за чего в базе вместо «Аризонский жала» лежало
 * «╨Р╤А╨╕╨╖╨╛╨╜╤Б╨║╨╕╨╣ ╨╢╨░╨╗╨░». Пострадали имена блюд, состав,
 * ингредиенты, аллергены и снапшоты планов — на таких данных не работала
 * ни фильтрация по аллергенам, ни классификация блюд.
 */
describe('text-recovery (восстановление UTF-8 ↔ CP866)', () => {
  it('восстанавливает реальные повреждённые названия из базы', () => {
    const cases: Array<[string, string]> = [
      ['╨Р╤А╨╕╨╖╨╛╨╜╤Б╨║╨╕╨╣ ╨╢╨░╨╗╨░', 'Аризонский жала'],
      ['╨Ъ╤Г╤А╨╕╤Ж╨░ ╨┐╨╛-╤П╨╝╨░╨╣╤Б╨║╨╕', 'Курица по-ямайски'],
      ['╨С╨░╨╜╨░╨╜╨╛╨▓╤Л╨╡ ╨▒╨╗╨╕╨╜╤Л', 'Банановые блины'],
      ['╨Ю╨╝╨╗╨╡╤В ╤Б ╤Е╨╗╨╡╨▒╨╛╨╝', 'Омлет с хлебом'],
      ['╨╗╨░╨║╤В╨╛╨╖╨░', 'лактоза'],
      ['╤Б╨╛╤П', 'соя'],
    ];
    for (const [bad, expected] of cases) {
      assert.strictEqual(recoverIfMojibake(bad), expected, bad);
    }
  });

  it('распознаёт признак повреждения', () => {
    assert.isTrue(looksLikeMojibake('╨Ъ╤Г╤А╨╕╤Ж╨░'));
    assert.isFalse(looksLikeMojibake('Курица'));
    assert.isFalse(looksLikeMojibake('Caesar Salad'));
    assert.isFalse(looksLikeMojibake(''));
  });

  it('не портит корректный текст (идемпотентность)', () => {
    for (const good of ['Курица по-ямайски', 'Caesar Salad', 'Борщ', 'Ёж', 'сыр 50%']) {
      assert.strictEqual(recoverIfMojibake(good), good, good);
    }
    // Повторное применение к уже восстановленному тексту ничего не меняет.
    const once = recoverIfMojibake('╨Ъ╤Г╤А╨╕╤Ж╨░');
    assert.strictEqual(recoverIfMojibake(once), once);
  });

  it('восстанавливает вложенные структуры (состав блюда, снапшоты планов)', () => {
    const damaged = {
      name: '╨Ю╨╝╨╗╨╡╤В',
      ingredients: [{ name: '╨п╨╣╤Ж╨╛', grams: 100 }, { name: '╨б╨╛╨╗╤М', grams: 2 }],
      nested: { note: '╨Ъ╤Г╤А╨╕╤Ж╨░' },
      calories: 250,
      tags: ['╤Б╨╛╤П'],
    };
    const fixed = recoverDeep(damaged);
    assert.strictEqual(fixed.name, 'Омлет');
    assert.strictEqual(fixed.ingredients[0].name, 'Яйцо');
    assert.strictEqual(fixed.ingredients[1].name, 'Соль');
    assert.strictEqual(fixed.nested.note, 'Курица');
    assert.strictEqual(fixed.tags[0], 'соя');
    // Нестроковые значения не меняются.
    assert.strictEqual(fixed.calories, 250);
  });

  it('возвращает null, если восстановление невозможно', () => {
    // Эмодзи нет в CP866 — строка повреждена не этим способом.
    assert.isNull(recoverMojibake('привет 🍕'));
    // Символы псевдографики вне диапазона восстановления.
    assert.isNull(recoverMojibake('╔═╗'));
  });

  it('не падает на пустых и нестроковых значениях', () => {
    assert.strictEqual(recoverIfMojibake(''), '');
    assert.strictEqual(recoverIfMojibake(null), '');
    assert.strictEqual(recoverIfMojibake(undefined), '');
    assert.deepEqual(recoverDeep(null), null);
    assert.deepEqual(recoverDeep([1, 2]), [1, 2]);
  });
});
