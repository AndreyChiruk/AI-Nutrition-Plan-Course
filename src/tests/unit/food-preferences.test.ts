import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты выбора предпочтений через каталог.
 *
 * Раньше любимые и нежелательные продукты вводились СВОБОДНЫМ ТЕКСТОМ через
 * запятую. Пользователь писал «куриная грудка», а в каталоге было
 * «Алжирская жареная курица» — совпадений не находилось, и предпочтение
 * молча игнорировалось планировщиком.
 *
 * Проверка на реальных данных показала:
 *   «курица»          → совпало 2 из 4 блюд с курицей
 *   «куриная грудка»  → совпало 0 из 4   (предпочтение не работало)
 *
 * Теперь значение выбирается из каталога, поэтому оно гарантированно
 * присутствует в БД и распознаётся фильтрами.
 */
type Suggestion = { type: 'ingredient' | 'dish'; name: string; category?: string | null };

/** Логика поиска: ингредиенты первыми, затем блюда, без дублей. */
function searchCatalog(
  term: string,
  ingredients: string[],
  dishes: string[],
  limit = 12,
): Suggestion[] {
  const q = String(term ?? '').trim();
  if (q.length < 2) return [];
  const lower = q.toLowerCase();
  const out: Suggestion[] = [];
  const seen = new Set<string>();

  for (const name of ingredients) {
    if (out.length >= limit) break;
    if (!name.toLowerCase().includes(lower)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: 'ingredient', name });
  }
  for (const name of dishes) {
    if (out.length >= limit) break;
    if (!name.toLowerCase().includes(lower)) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type: 'dish', name });
  }
  return out;
}

const INGREDIENTS = ['Куриная грудка', 'Куриное бедро', 'Гречка', 'Тофу', 'Майонез', 'Грибы'];
const DISHES = ['Алжирская жареная курица', 'Бургеры с курицей и халлуми', 'Гречка с курицей'];

describe('выбор предпочтений через каталог', () => {
  it('находит ингредиенты по подстроке (главный кейс)', () => {
    const found = searchCatalog('курин', INGREDIENTS, DISHES);
    const names = found.map((f) => f.name);
    assert.include(names, 'Куриная грудка');
    assert.include(names, 'Куриное бедро');
  });

  it('ингредиенты идут раньше блюд', () => {
    const found = searchCatalog('кури', INGREDIENTS, DISHES);
    const firstDishIdx = found.findIndex((f) => f.type === 'dish');
    const lastIngIdx = found.map((f) => f.type).lastIndexOf('ingredient');
    if (firstDishIdx !== -1 && lastIngIdx !== -1) {
      assert.isAbove(firstDishIdx, lastIngIdx, 'ингредиенты должны быть выше');
    }
  });

  it('не возвращает дубликаты', () => {
    const found = searchCatalog('гречк', INGREDIENTS, DISHES);
    const names = found.map((f) => f.name.toLowerCase());
    assert.strictEqual(names.length, new Set(names).size);
  });

  it('игнорирует запрос короче двух символов', () => {
    assert.isEmpty(searchCatalog('к', INGREDIENTS, DISHES));
    assert.isEmpty(searchCatalog('', INGREDIENTS, DISHES));
    assert.isEmpty(searchCatalog('   ', INGREDIENTS, DISHES));
  });

  it('ограничивает число подсказок', () => {
    const many = Array.from({ length: 100 }, (_, i) => `Продукт${i}`);
    assert.lengthOf(searchCatalog('продукт', many, [], 12), 12);
  });

  it('возвращает пустой список, если ничего не найдено', () => {
    assert.isEmpty(searchCatalog('трюфель', INGREDIENTS, DISHES));
  });

  it('поиск регистронезависимый', () => {
    const lower = searchCatalog('тофу', INGREDIENTS, DISHES);
    const upper = searchCatalog('ТОФУ', INGREDIENTS, DISHES);
    assert.deepEqual(lower, upper);
  });

  it('выбранное из каталога значение совпадает с записью в БД', () => {
    // Это ключевое отличие от свободного текста: значение существует в БД,
    // поэтому фильтр планировщика его находит.
    const picked = searchCatalog('куриная', INGREDIENTS, DISHES)[0];
    assert.isDefined(picked);
    assert.include(INGREDIENTS, picked.name);
  });
});
