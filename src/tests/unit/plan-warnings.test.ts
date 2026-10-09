import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты предупреждений о деградации плана.
 *
 * Раньше блок формирования предупреждений в `enforceDietaryForAiDays` был
 * закомментирован, поэтому пользователь НЕ узнавал, что:
 *   - AI предложил блюда с его аллергенами (они молча заменялись);
 *   - для части позиций не нашлось подходящей замены.
 * План выглядел «нормальным», хотя был собран частично из заглушек.
 *
 * Здесь повторяется логика формирования предупреждений.
 */
type Counters = {
  replacedCount: number;
  allergyReplaced: number;
  dietaryReplaced: number;
  dislikesReplaced: number;
  unresolvedCount: number;
};

function buildWarnings(c: Counters): string[] {
  const w: string[] = [];
  if (c.allergyReplaced > 0) {
    w.push(`AI предложил ${c.allergyReplaced} блюд(а) с вашими аллергенами — они заменены.`);
  }
  if (c.dietaryReplaced > 0) w.push(`Заменено из-за несоответствия диете: ${c.dietaryReplaced}.`);
  if (c.dislikesReplaced > 0) w.push(`Заменено из-за нежелательных продуктов: ${c.dislikesReplaced}.`);
  if (c.unresolvedCount > 0) w.push(`Для ${c.unresolvedCount} позиции(й) не нашлось замены.`);
  if (c.replacedCount > 0 && c.allergyReplaced + c.dietaryReplaced + c.dislikesReplaced === 0) {
    w.push(`Автоматически заменено блюд: ${c.replacedCount}.`);
  }
  return w;
}

/** Считает заглушки «Блюдо (slot)» в плане. */
function countPlaceholders(days: Array<Record<string, unknown>>): number {
  return days.reduce((sum, d) => {
    const slots = [
      d.breakfast,
      d.lunch,
      d.dinner,
      d.snack,
      ...((d.extraSnacks as unknown[]) ?? []),
    ] as Array<{ name?: string } | null>;
    return (
      sum + slots.filter((s) => s && /^Блюдо \(/.test(String(s.name ?? ''))).length
    );
  }, 0);
}

const clean: Counters = {
  replacedCount: 0,
  allergyReplaced: 0,
  dietaryReplaced: 0,
  dislikesReplaced: 0,
  unresolvedCount: 0,
};

describe('предупреждения о деградации плана', () => {
  it('сообщает о замене блюд с аллергенами', () => {
    const w = buildWarnings({ ...clean, allergyReplaced: 3, replacedCount: 3 });
    assert.lengthOf(w, 1);
    assert.include(w[0], 'аллерген');
  });

  it('сообщает, когда замена не найдена (главный случай)', () => {
    const w = buildWarnings({ ...clean, unresolvedCount: 4 });
    assert.lengthOf(w, 1);
    assert.include(w[0], 'не нашлось замены');
  });

  it('сообщает о заменах по диете и нежелательным продуктам', () => {
    const w = buildWarnings({ ...clean, dietaryReplaced: 2, dislikesReplaced: 5, replacedCount: 7 });
    assert.lengthOf(w, 2);
  });

  it('не создаёт предупреждений, когда план чистый', () => {
    assert.isEmpty(buildWarnings(clean));
  });

  it('не дублирует общее предупреждение, если есть конкретные', () => {
    // replacedCount = 3 и все три — аллергены: общее сообщение не нужно.
    const w = buildWarnings({ ...clean, replacedCount: 3, allergyReplaced: 3 });
    assert.lengthOf(w, 1, 'должно быть только конкретное предупреждение');
  });

  it('общее предупреждение появляется, когда причина неизвестна', () => {
    const w = buildWarnings({ ...clean, replacedCount: 2 });
    assert.lengthOf(w, 1);
    assert.include(w[0], 'Автоматически заменено');
  });

  it('находит заглушки «Блюдо (slot)» в плане', () => {
    const days = [
      {
        breakfast: { name: 'Омлет' },
        lunch: { name: 'Блюдо (lunch)' },
        dinner: { name: 'Рыба' },
        snack: { name: 'Яблоко' },
        extraSnacks: [],
      },
      {
        breakfast: { name: 'Блюдо (breakfast)' },
        lunch: { name: 'Борщ' },
        dinner: { name: 'Блюдо (dinner)' },
        snack: { name: 'Орехи' },
        extraSnacks: [],
      },
    ];
    assert.strictEqual(countPlaceholders(days), 3);
  });

  it('не считает заглушками нормальные блюда', () => {
    const days = [
      {
        breakfast: { name: 'Омлет' },
        lunch: { name: 'Борщ' },
        dinner: { name: 'Рыба' },
        snack: { name: 'Яблоко' },
        extraSnacks: [{ name: 'Орехи' }],
      },
    ];
    assert.strictEqual(countPlaceholders(days), 0);
  });
});
