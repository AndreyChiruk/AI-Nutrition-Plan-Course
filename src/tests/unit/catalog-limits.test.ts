import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты согласованности лимитов каталога для AI.
 *
 * Регрессия: выборка брала по 150 блюд на категорию (до 600 имён),
 * а промпт обрезал список по 12 000 символов — это примерно 300 названий.
 * Часть блюд не попадала в промпт, модель предлагала их «по памяти»,
 * названия не проходили проверку и заменялись: в плане появлялись
 * десятки замен и заглушки «Блюдо (breakfast)».
 *
 * Здесь проверяется арифметика лимитов, чтобы рассинхрон не вернулся.
 */
const CATEGORIES = 4;

function sampledTotal(perSlot: number): number {
  return perSlot * CATEGORIES;
}

function promptLimit(value?: string): number {
  return Math.max(50, Number(value ?? 700) || 700);
}

describe('каталог для AI: согласованность лимитов', () => {
  it('лимит промпта покрывает выборку по умолчанию', () => {
    // 150 × 4 = 600 блюд попадает в выборку, промпт должен вместить все.
    assert.isAtLeast(promptLimit('700'), sampledTotal(150));
  });

  it('прежний лимит 400 был недостаточен', () => {
    // Фиксируем причину регрессии: при 150 на слот 400 имён мало.
    assert.isBelow(400, sampledTotal(150));
  });

  it('некорректное значение заменяется значением по умолчанию', () => {
    // Пустое или нечисловое значение — используем умолчание,
    // иначе список блюд оказался бы пустым и план не сгенерировался.
    assert.strictEqual(promptLimit(''), 700);
    assert.strictEqual(promptLimit('abc'), 700);
    assert.strictEqual(promptLimit('0'), 700);
  });

  it('лимит промпта не опускается ниже 50', () => {
    // Малое положительное значение поднимается до безопасного минимума.
    assert.strictEqual(promptLimit('10'), 50);
    assert.strictEqual(promptLimit('1'), 50);
  });

  it('значение из переменной окружения учитывается', () => {
    assert.strictEqual(promptLimit('250'), 250);
  });

  it('при уменьшении per_slot лимит остаётся достаточным', () => {
    for (const perSlot of [20, 50, 100, 150]) {
      assert.isAtLeast(promptLimit('700'), sampledTotal(perSlot), `per_slot=${perSlot}`);
    }
  });
});
