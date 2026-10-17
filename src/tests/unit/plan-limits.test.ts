import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты ограничений на параметры плана питания.
 *
 * Регрессия: списки предпочтений не имели лимитов — пользователь мог
 * задать сотни нежелательных продуктов. Алгоритм исключает каждый пункт
 * из пула, поэтому такой список сужал выбор почти до нуля, а требование
 * «любимое слово в каждом дне» становилось невыполнимым.
 *
 * Логика повторяет проверки в users.service и meal-plan.service.
 */
const LIST_LIMITS = { foodLikes: 20, foodDislikes: 30 } as const;

/** Проверяет список так же, как updateProfile. */
function validateList(value: unknown, limit: number): { ok: boolean; cleaned?: string[]; error?: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'должно быть списком' };
  if (value.length > limit) return { ok: false, error: `не более ${limit}` };
  const cleaned: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const v = String(raw ?? '').trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    cleaned.push(v.slice(0, 60));
  }
  return { ok: true, cleaned };
}

/** Проверяет длительность плана. */
function validateDuration(n: unknown): { ok: boolean; error?: string } {
  const d = Number(n);
  if (!Number.isInteger(d) || d < 1 || d > 365) {
    return { ok: false, error: 'от 1 до 365 дней' };
  }
  return { ok: true };
}

describe('план питания: длительность', () => {
  it('допускает все варианты из интерфейса', () => {
    for (const d of [1, 7, 14, 30, 90, 180]) {
      assert.isTrue(validateDuration(d).ok, `${d} дней должен проходить`);
    }
  });

  it('отклоняет нуль, отрицательные и слишком большие сроки', () => {
    for (const d of [0, -1, 366, 1000]) {
      assert.isFalse(validateDuration(d).ok, `${d} должен быть отклонён`);
    }
  });

  it('отклоняет нечисловые значения', () => {
    assert.isFalse(validateDuration('abc').ok);
    assert.isFalse(validateDuration(undefined).ok);
    assert.isFalse(validateDuration(7.5).ok, 'дробное число дней недопустимо');
  });
});

describe('план питания: лимиты списков предпочтений', () => {
  it('принимает список в пределах лимита', () => {
    const r = validateList(['тофу', 'гречка'], LIST_LIMITS.foodLikes);
    assert.isTrue(r.ok);
    assert.deepStrictEqual(r.cleaned, ['тофу', 'гречка']);
  });

  it('отклоняет слишком длинный список', () => {
    // Без лимита такой список сужал пул блюд почти до нуля.
    const many = Array.from({ length: 31 }, (_, i) => `продукт${i}`);
    assert.isFalse(validateList(many, LIST_LIMITS.foodDislikes).ok);
    assert.isTrue(validateList(many.slice(0, 30), LIST_LIMITS.foodDislikes).ok);
  });

  it('убирает пустые значения и дубликаты', () => {
    const r = validateList(['грибы', '', '  ', 'Грибы', 'грибы'], LIST_LIMITS.foodDislikes);
    assert.deepStrictEqual(r.cleaned, ['грибы'], 'дубликаты в разном регистре схлопываются');
  });

  it('обрезает слишком длинные значения', () => {
    const long = 'я'.repeat(200);
    const r = validateList([long], LIST_LIMITS.foodLikes);
    assert.strictEqual(r.cleaned![0].length, 60);
  });

  it('отклоняет не-массив', () => {
    assert.isFalse(validateList('грибы', LIST_LIMITS.foodDislikes).ok);
    assert.isFalse(validateList(null, LIST_LIMITS.foodDislikes).ok);
  });

  it('лимит нежелательных выше, чем любимых', () => {
    // Исключать проще, чем гарантировать присутствие: любимое слово
    // должно попасть в каждый день, поэтому его список короче.
    assert.isAbove(LIST_LIMITS.foodDislikes, LIST_LIMITS.foodLikes);
  });
});

describe('план питания: ёмкость каталога', () => {
  /** Определяет, хватает ли блюд в пуле на все дни. */
  function capacityWarning(pools: Record<string, number>, days: number): string | null {
    const short: string[] = [];
    for (const [slot, available] of Object.entries(pools)) {
      if (available > 0 && available < days) short.push(`${slot}: ${available} на ${days}`);
    }
    return short.length ? `нехватка: ${short.join(', ')}` : null;
  }

  it('не предупреждает, когда блюд достаточно', () => {
    assert.isNull(capacityWarning({ breakfast: 30, lunch: 50 }, 14));
  });

  it('предупреждает при нехватке блюд', () => {
    // Для вегана в каталоге около 10 завтраков — на 180 дней мало.
    const w = capacityWarning({ breakfast: 10, lunch: 46 }, 180);
    assert.isNotNull(w);
    assert.include(w!, 'breakfast');
  });

  it('сообщает про каждый слот с нехваткой', () => {
    // На 180 дней не хватает всех слотов, кроме обеда (их 200).
    const w = capacityWarning({ breakfast: 10, lunch: 200, dinner: 15, snack: 16 }, 180);
    assert.include(w!, 'breakfast');
    assert.include(w!, 'dinner');
    assert.include(w!, 'snack');
    assert.notInclude(w!, 'lunch', 'обедов хватает — о них не сообщаем');
  });

  it('игнорирует пустой пул', () => {
    // Пустой пул означает другую проблему, о ней сообщается отдельно.
    assert.isNull(capacityWarning({ breakfast: 0 }, 7));
  });
});
