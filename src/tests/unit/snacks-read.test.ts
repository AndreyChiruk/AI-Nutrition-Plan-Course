import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты чтения перекусов дня.
 *
 * Было: перекусы хранились в двух колонках (`snacks` и `extra_snacks`),
 * а чтение брало только `snacks[0]`. Второй и третий перекусы, созданные
 * генератором, пропадали из интерфейса после сохранения и перезагрузки:
 * пользователь видел день на ~2200 ккал вместо 3000, а при клонировании
 * плана перекусы терялись вовсе.
 *
 * Здесь повторяется логика `snacksFromDb` из meal-plan.service.ts.
 */
type Snack = { name: string; calories: number };

function snacksFromDb(snacksRaw: unknown, extraRaw: unknown): Snack[] {
  const out: Snack[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value === 'object' && value !== null && 'name' in (value as object)) {
      out.push(value as Snack);
    }
  };
  push(snacksRaw);
  push(extraRaw);

  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${String(s.name ?? '')}|${Number(s.calories) || 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const apple = { name: 'Яблоко', calories: 80 };
const nuts = { name: 'Орехи', calories: 200 };
const yogurt = { name: 'Йогурт', calories: 120 };

describe('чтение перекусов дня', () => {
  it('возвращает все перекусы, а не только первый', () => {
    // Новая схема: всё лежит в snacks, extra дублирует хвост.
    const r = snacksFromDb([apple, nuts, yogurt], [nuts, yogurt]);
    assert.lengthOf(r, 3);
    assert.deepEqual(r.map((s) => s.name), ['Яблоко', 'Орехи', 'Йогурт']);
  });

  it('читает старые записи, где перекусы лежали в двух полях', () => {
    // Старая схема: snacks = [первый], extra_snacks = [остальные].
    const r = snacksFromDb([apple], [nuts, yogurt]);
    assert.lengthOf(r, 3);
  });

  it('не дублирует перекусы при совмещённом хранении', () => {
    const r = snacksFromDb([apple, nuts], [apple, nuts]);
    assert.lengthOf(r, 2);
  });

  it('корректно обрабатывает пустые и отсутствующие значения', () => {
    assert.isEmpty(snacksFromDb(null, null));
    assert.isEmpty(snacksFromDb([], []));
    assert.isEmpty(snacksFromDb(undefined, undefined));
    assert.lengthOf(snacksFromDb([apple], null), 1);
    assert.lengthOf(snacksFromDb(null, [apple]), 1);
  });

  it('поддерживает одиночный объект вместо массива (старый формат)', () => {
    const r = snacksFromDb(apple, null);
    assert.lengthOf(r, 1);
    assert.strictEqual(r[0].name, 'Яблоко');
  });

  it('сохраняет сумму калорий всех перекусов', () => {
    const r = snacksFromDb([apple, nuts, yogurt], [nuts, yogurt]);
    const total = r.reduce((s, x) => s + x.calories, 0);
    assert.strictEqual(total, 400, 'день не должен «терять» калории перекусов');
  });

  it('не падает на мусорных значениях', () => {
    assert.isEmpty(snacksFromDb('строка', 42));
    assert.isEmpty(snacksFromDb([{ noName: true }], [{ alsoNoName: 1 }]));
  });
});
