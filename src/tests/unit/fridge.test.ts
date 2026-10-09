import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты холодильника.
 *
 * Раньше это был небольшой блок внутри профиля: название вводилось свободным
 * текстом, редактировать количество можно было только удалив продукт, не было
 * группировки по категориям. Страница стала полноценным «Моим холодильником».
 *
 * Здесь проверяются: нормализация единиц, группировка, срок годности
 * и сопоставление состава рецепта с холодильником.
 */
const MASS_UNITS = ['г', 'кг', 'мл', 'л', 'шт'] as const;
type Unit = (typeof MASS_UNITS)[number];

function normalizeUnit(raw?: string | null): Unit {
  const u = String(raw ?? '').trim().toLowerCase();
  const map: Record<string, Unit> = {
    г: 'г', гр: 'г', g: 'г',
    кг: 'кг', kg: 'кг',
    мл: 'мл', ml: 'мл',
    л: 'л', l: 'л',
    шт: 'шт', штук: 'шт', pcs: 'шт',
  };
  return map[u] ?? 'г';
}

/** Сколько дней осталось до конца срока годности. */
function daysLeft(iso: string | null | undefined, today = new Date('2026-10-06')): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - t.getTime()) / 86_400_000);
}

/** Состояние продукта по сроку годности. */
function expiryState(iso: string | null | undefined, today?: Date): 'none' | 'ok' | 'expiring' | 'expired' {
  const d = daysLeft(iso, today);
  if (d === null) return 'none';
  if (d < 0) return 'expired';
  if (d <= 2) return 'expiring';
  return 'ok';
}

/** Группировка по категориям с сохранением порядка. */
function groupByCategory(items: Array<{ name: string; category?: string }>) {
  const map = new Map<string, string[]>();
  for (const i of items) {
    const cat = i.category?.trim() || 'Прочее';
    const list = map.get(cat) ?? [];
    list.push(i.name);
    map.set(cat, list);
  }
  return map;
}

/** Каких продуктов из рецепта не хватает. */
function missingFromFridge(recipe: string[], fridge: string[]) {
  const rootOf = (value: string): string => {
    const first = value.split(/[\s,]+/).filter(Boolean)[0] ?? value;
    return first.length > 4 ? first.slice(0, 4) : first;
  };
  const have: string[] = [];
  const missing: string[] = [];
  const hay = fridge.map((f) => f.toLowerCase());
  for (const raw of recipe) {
    const needle = raw.toLowerCase().trim();
    const needleRoot = rootOf(needle);
    const found = hay.some(
      (f) =>
        f === needle ||
        f.includes(needle) ||
        needle.includes(f) ||
        (needleRoot.length >= 4 && f.startsWith(needleRoot)),
    );
    (found ? have : missing).push(raw);
  }
  return { have, missing };
}

describe('холодильник: единицы измерения', () => {
  it('нормализует основные единицы', () => {
    assert.strictEqual(normalizeUnit('г'), 'г');
    assert.strictEqual(normalizeUnit('КГ'), 'кг');
    assert.strictEqual(normalizeUnit('мл'), 'мл');
    assert.strictEqual(normalizeUnit('шт'), 'шт');
  });

  it('поддерживает варианты написания и латиницу', () => {
    assert.strictEqual(normalizeUnit('гр'), 'г');
    assert.strictEqual(normalizeUnit('g'), 'г');
    assert.strictEqual(normalizeUnit('kg'), 'кг');
    assert.strictEqual(normalizeUnit('штук'), 'шт');
  });

  it('неизвестное значение приводит к граммам', () => {
    assert.strictEqual(normalizeUnit('унция'), 'г');
    assert.strictEqual(normalizeUnit(''), 'г');
    assert.strictEqual(normalizeUnit(null), 'г');
  });
});

describe('холодильник: срок годности', () => {
  const today = new Date('2026-10-06');

  it('срок не указан — состояние none', () => {
    assert.strictEqual(expiryState(null, today), 'none');
    assert.strictEqual(expiryState(undefined, today), 'none');
  });

  it('просроченный продукт определяется', () => {
    assert.strictEqual(expiryState('2026-10-04', today), 'expired');
    assert.isBelow(daysLeft('2026-10-04', today)!, 0);
  });

  it('истекает в ближайшие 2 дня — предупреждение', () => {
    assert.strictEqual(expiryState('2026-10-06', today), 'expiring');
    assert.strictEqual(expiryState('2026-10-08', today), 'expiring');
  });

  it('далёкий срок — состояние ok', () => {
    assert.strictEqual(expiryState('2026-10-20', today), 'ok');
    assert.strictEqual(daysLeft('2026-10-16', today), 10);
  });

  it('некорректная дата не ломает расчёт', () => {
    assert.strictEqual(daysLeft('не-дата', today), null);
    assert.strictEqual(expiryState('не-дата', today), 'none');
  });
});

describe('холодильник: группировка и сопоставление', () => {
  it('группирует продукты по категориям', () => {
    const grouped = groupByCategory([
      { name: 'Молоко', category: 'Молочные продукты' },
      { name: 'Гречка', category: 'Крупы и мучное' },
      { name: 'Сыр', category: 'Молочные продукты' },
    ]);
    assert.deepEqual(grouped.get('Молочные продукты'), ['Молоко', 'Сыр']);
    assert.deepEqual(grouped.get('Крупы и мучное'), ['Гречка']);
  });

  it('продукты без категории попадают в «Прочее»', () => {
    const grouped = groupByCategory([{ name: 'Нечто' }]);
    assert.deepEqual(grouped.get('Прочее'), ['Нечто']);
  });

  it('находит, чего не хватает для рецепта', () => {
    const recipe = ['Куриная грудка', 'Гречка', 'Лук', 'Морковь'];
    const fridge = ['Куриная грудка', 'Гречка', 'Лук'];
    const { have, missing } = missingFromFridge(recipe, fridge);
    assert.deepEqual(missing, ['Морковь']);
    assert.lengthOf(have, 3);
  });

  it('учитывает частичное совпадение названий', () => {
    // «курица» в холодильнике и «Куриная грудка» в рецепте — один продукт.
    const { missing } = missingFromFridge(['Куриная грудка'], ['курица']);
    assert.isEmpty(missing);
  });

  it('пустой холодильник — не хватает всего', () => {
    const { have, missing } = missingFromFridge(['Гречка', 'Лук'], []);
    assert.isEmpty(have);
    assert.lengthOf(missing, 2);
  });
});
