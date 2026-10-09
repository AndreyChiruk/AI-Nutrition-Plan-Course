import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты разнообразия плана внутри одного документа.
 *
 * Проблема: в плане на 7 дней повторялся ЦИКЛ ИЗ 3 ДНЕЙ —
 * «Кошари» на обед встречался 6 раз из 7, завтраки повторялись
 * строго через 3 дня. Уникальных блюд было 8 из 21 (38 %).
 *
 * Две причины:
 *  1. `diversifyCatalogDays` разрешал блюду встретиться 2 раза,
 *     а замену искал через `pool.find` — всегда ПЕРВОЕ подходящее блюдо,
 *     поэтому замена была одинаковой для всех дней.
 *  2. Набор «использованных» блюд создавался внутри цикла по дням
 *     и сбрасывался на каждом дне.
 *
 * Здесь повторяется исправленная логика диверсификации.
 */
const MAX_REPEATS = 1;

function hashOf(value: string): number {
  let h = 2166136261;
  for (let i = 0; i < value.length; i++) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/** Исправленная диверсификация. */
function diversify(base: string[], pool: string[], prevGuard = true): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (let i = 0; i < base.length; i++) {
    const current = base[i];
    const prev = out[i - 1];
    const count = seen.get(current) ?? 0;
    const repeatsPrev = prevGuard && prev != null && prev === current;
    if (count < MAX_REPEATS && !repeatsPrev) {
      seen.set(current, count + 1);
      out.push(current);
      continue;
    }
    const usable = pool.filter(
      (p) => p !== current && (!prevGuard || p !== prev) && (seen.get(p) ?? 0) < MAX_REPEATS + 1,
    );
    if (usable.length === 0) {
      seen.set(current, count + 1);
      out.push(current);
      continue;
    }
    const alt = usable[hashOf(`lunch:${current}:0:${usable.length}`) % usable.length];
    seen.set(alt, (seen.get(alt) ?? 0) + 1);
    out.push(alt);
  }
  return out;
}

/** Прежнее (ошибочное) поведение: лимит 2 и первое подходящее из пула. */
function diversifyOld(base: string[], pool: string[]): string[] {
  const seen = new Map<string, number>();
  const out: string[] = [];
  for (let i = 0; i < base.length; i++) {
    const current = base[i];
    const count = seen.get(current) ?? 0;
    if (count < 2) {
      seen.set(current, count + 1);
      out.push(current);
      continue;
    }
    const alt = pool.find(
      (p) => p !== current && (seen.get(p) ?? 0) < 2,
    );
    if (!alt) {
      seen.set(current, count + 1);
      out.push(current);
      continue;
    }
    seen.set(alt, (seen.get(alt) ?? 0) + 1);
    out.push(alt);
  }
  return out;
}

/**
 * Финальный проход дедупликации (deduplicateAcrossDays).
 *
 * Даже после диверсификации повторы оставались: замена алкоголя и подбор
 * по калориям могли снова привести одно блюдо в разные дни. Этот проход
 * работает последним и заменяет дубликаты внутри каждого слота.
 */
function deduplicate(
  days: Array<Record<string, { name: string } | undefined>>,
  pools: Record<string, Array<{ name: string }>>,
): string[] {
  const SLOTS = ['breakfast', 'lunch', 'dinner'];
  const usage = new Map<string, Map<string, number>>();
  for (const sl of SLOTS) usage.set(sl, new Map());
  const nameOf = (v?: { name?: string }) => String(v?.name ?? '').trim().toLowerCase();

  for (const d of days) {
    for (const sl of SLOTS) {
      const n = nameOf(d[sl]);
      if (!n) continue;
      const m = usage.get(sl)!;
      m.set(n, (m.get(n) ?? 0) + 1);
    }
  }

  for (const day of days) {
    for (const sl of SLOTS) {
      const snap = day[sl];
      const name = nameOf(snap);
      if (!snap || !name) continue;
      const m = usage.get(sl)!;
      if ((m.get(name) ?? 0) <= 1) continue;
      const cand = (pools[sl] ?? []).find((p) => {
        const pn = String(p.name).trim().toLowerCase();
        return pn.length > 0 && pn !== name && (m.get(pn) ?? 0) === 0;
      });
      if (!cand) continue;
      day[sl] = { name: cand.name };
      m.set(name, (m.get(name) ?? 1) - 1);
      const cn = String(cand.name).trim().toLowerCase();
      m.set(cn, (m.get(cn) ?? 0) + 1);
    }
  }

  return days.flatMap((d) => SLOTS.map((sl) => d[sl]?.name)).filter(Boolean) as string[];
}

describe('разнообразие плана', () => {
  const pool = Array.from({ length: 100 }, (_, i) => `Блюдо${i}`);

  it('исправленная диверсификация резко снижает повторы', () => {
    // Стартовый выбор дал цикл из 3 блюд, как в реальном плане.
    // Пул из 100 блюд — как настоящий каталог (446 обедов).
    const base = ['А', 'Б', 'В', 'А', 'Б', 'В', 'А'];
    const out = diversify(base, pool);
    const repeats = out.length - new Set(out).size;
    assert.strictEqual(repeats, 0, `повторов быть не должно, получено ${repeats}`);
  });

  it('при крошечном пуле повтор неизбежен, но не подряд', () => {
    // В пуле всего 3 блюда, а дней 7: полностью уникальный план невозможен.
    const base = ['А', 'Б', 'В', 'А', 'Б', 'В', 'А'];
    const out = diversify(base, ['А', 'Б', 'В']);
    for (let i = 1; i < out.length; i++) {
      assert.notStrictEqual(out[i], out[i - 1], 'даже при малом пуле соседние дни различаются');
    }
  });

  it('старое поведение оставляло повторы (регресс)', () => {
    const base = ['А', 'Б', 'В', 'А', 'Б', 'В', 'А'];
    const out = diversifyOld(base, [...pool, 'А', 'Б', 'В']);
    const repeats = out.length - new Set(out).size;
    assert.isAbove(repeats, 0, 'прежний алгоритм допускал повторы');
  });

  it('доля уникальных блюд высокая', () => {
    const base = Array.from({ length: 21 }, (_, i) => `Блюдо${i % 8}`);
    const out = diversify(base, pool);
    const ratio = new Set(out).size / out.length;
    assert.isAtLeast(ratio, 0.8, `уникальных должно быть ≥80 %, получено ${Math.round(ratio * 100)} %`);
  });

  it('соседние дни никогда не повторяют одно блюдо', () => {
    const base = ['А', 'Б', 'В', 'А', 'Б', 'В'];
    const out = diversify(base, [...pool, 'А', 'Б', 'В']);
    for (let i = 1; i < out.length; i++) {
      assert.notStrictEqual(out[i], out[i - 1], `день ${i + 1} повторяет предыдущий`);
    }
  });

  it('разные названия дают разные замены (хеш, а не «первое из пула»)', () => {
    const base = ['А', 'А', 'Б', 'Б', 'В', 'В'];
    const out = diversify(base, pool);
    // Если бы замена всегда бралась как первое блюдо пула, получилось бы
    // чередование одного и того же значения.
    assert.isAtLeast(new Set(out).size, 4);
  });

  it('работает при маленьком пуле, не зацикливаясь', () => {
    const small = ['А', 'Б'];
    const out = diversify(['А', 'Б', 'А', 'Б'], small);
    assert.lengthOf(out, 4);
    for (const v of out) assert.include(small, v);
  });

  it('не падает на пустом пуле', () => {
    const out = diversify(['А', 'А'], []);
    assert.lengthOf(out, 2);
  });

  it('финальный проход убирает повторы, оставшиеся после диверсификации', () => {
    // Реальный план после первой правки: 76 % уникальных, «Кошари» 4 раза.
    const days: Array<Record<string, { name: string }>> = [
      { breakfast: { name: 'Ямайские пельмени' }, lunch: { name: 'Сирийские спагетти' }, dinner: { name: 'Фасоль' } },
      { breakfast: { name: 'Эзме' }, lunch: { name: 'Кошари' }, dinner: { name: 'Хлеб' } },
      { breakfast: { name: 'Картофель' }, lunch: { name: 'Сирийские спагетти' }, dinner: { name: 'Капуста' } },
      { breakfast: { name: 'Котлеты' }, lunch: { name: 'Тамаринд' }, dinner: { name: 'Бхарта' } },
      { breakfast: { name: 'Угали' }, lunch: { name: 'Кошари' }, dinner: { name: 'Свёкла' } },
      { breakfast: { name: 'Рис' }, lunch: { name: 'Суп' }, dinner: { name: 'Хлеб' } },
      { breakfast: { name: 'Омлет' }, lunch: { name: 'Кошари' }, dinner: { name: 'Лепешки' } },
    ];
    const pools = {
      breakfast: Array.from({ length: 30 }, (_, i) => ({ name: `Завтрак${i}` })),
      lunch: Array.from({ length: 446 }, (_, i) => ({ name: `Обед${i}` })),
      dinner: Array.from({ length: 41 }, (_, i) => ({ name: `Ужин${i}` })),
    };
    const out = deduplicate(days, pools);
    const uniq = new Set(out).size;
    assert.isAtLeast(uniq / out.length, 0.9, `уникальных должно быть ≥90 %, получено ${Math.round((uniq / out.length) * 100)} %`);
  });

  it('пул слота исчерпан — повтор остаётся, но не ломает план', () => {
    const days = [
      { breakfast: { name: 'Каша' }, lunch: { name: 'Суп' }, dinner: { name: 'Рагу' } },
      { breakfast: { name: 'Каша' }, lunch: { name: 'Суп' }, dinner: { name: 'Рагу' } },
    ];
    const pools = { breakfast: [{ name: 'Каша' }], lunch: [{ name: 'Суп' }], dinner: [{ name: 'Рагу' }] };
    const out = deduplicate(days, pools);
    assert.lengthOf(out, 6, 'план не теряет приёмы пищи');
  });

  it('реальный кейс: 21 приём пищи, 8 исходных блюд', () => {
    // Именно так выглядел проблемный план: 3 завтрака, 1 обед, 3 ужина.
    const base = [
      ...Array.from({ length: 7 }, (_, i) => `Завтрак${i % 3}`),
      ...Array.from({ length: 7 }, () => 'Кошари'),
      ...Array.from({ length: 7 }, (_, i) => `Ужин${i % 4}`),
    ];
    const out = diversify(base, pool);
    const uniq = new Set(out).size;
    assert.isAbove(uniq, 8, 'должно быть больше 8 уникальных блюд, как было до правки');
    assert.isAtLeast(uniq / out.length, 0.8);
  });
});
