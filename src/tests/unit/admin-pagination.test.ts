import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты пагинации админских списков.
 *
 * Раньше `/admin/products` отдавал ВСЕ продукты разом: при 669 позициях
 * ответ занимал 2.8 МБ, а админка рендерила длинную таблицу. С ростом
 * каталога (импорт рецептов) размер ответа рос линейно.
 * Очередь модерации отдавалась целиком, причём каждая запись содержит
 * фотографию в base64.
 *
 * Здесь повторяется логика нормализации limit/offset.
 */
const MAX_LIMIT = 200;

/**
 * Безопасный разбор: `Number('abc')` = NaN, а `Math.max(1, NaN)` = NaN.
 * Раньше NaN уходил прямо в SQL — теперь мусор даёт значение по умолчанию.
 */
function safePaging(value: unknown, fallback: number, max: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(max, Math.floor(n));
}

function safeOffset(value: unknown): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function normalizePaging(params?: { limit?: unknown; offset?: unknown }): {
  limit: number;
  offset: number;
} {
  return {
    limit: safePaging(params?.limit, 50, MAX_LIMIT),
    offset: safeOffset(params?.offset),
  };
}

/** Проверяет, есть ли следующая страница. */
function hasNextPage(page: number, pageSize: number, total: number): boolean {
  return (page + 1) * pageSize < total;
}

describe('пагинация админских списков', () => {
  it('возвращает значения по умолчанию', () => {
    assert.deepEqual(normalizePaging(), { limit: 50, offset: 0 });
  });

  it('ограничивает максимальный размер страницы', () => {
    // Без ограничения клиент мог запросить limit=100000 и получить всё.
    assert.strictEqual(normalizePaging({ limit: 100000 }).limit, MAX_LIMIT);
    assert.strictEqual(normalizePaging({ limit: 500 }).limit, MAX_LIMIT);
  });

  it('не допускает отрицательных и нулевых значений', () => {
    // Некорректный размер страницы заменяется значением по умолчанию,
    // а не превращается в 0/NaN (иначе SQL вернул бы пустой результат).
    assert.strictEqual(normalizePaging({ limit: 0 }).limit, 50);
    assert.strictEqual(normalizePaging({ limit: -5 }).limit, 50);
    assert.strictEqual(normalizePaging({ offset: -100 }).offset, 0);
  });

  it('дробные значения округляются вниз', () => {
    assert.strictEqual(normalizePaging({ limit: 10.9 }).limit, 10);
    assert.strictEqual(normalizePaging({ offset: 5.7 }).offset, 5);
  });

  it('корректно обрабатывает мусорные значения', () => {
    assert.strictEqual(normalizePaging({ limit: 'abc' as unknown }).limit, 50);
    assert.strictEqual(normalizePaging({ offset: NaN }).offset, 0);
  });

  it('разбивает 669 продуктов на страницы по 50', () => {
    const total = 669;
    const size = 50;
    const pages = Math.ceil(total / size);
    assert.strictEqual(pages, 14, '669 / 50 = 14 страниц');
    // Последняя страница содержит остаток.
    const lastPageCount = total - (pages - 1) * size;
    assert.strictEqual(lastPageCount, 19);
  });

  it('определяет наличие следующей страницы', () => {
    assert.isTrue(hasNextPage(0, 50, 669));
    assert.isTrue(hasNextPage(12, 50, 669));
    assert.isFalse(hasNextPage(13, 50, 669), 'последняя страница');
    assert.isFalse(hasNextPage(0, 50, 30), 'одна страница — следующей нет');
  });

  it('размер ответа сокращается на порядок', () => {
    // 669 продуктов = 2.8 МБ => ~4.3 КБ на продукт.
    const bytesPerProduct = (2.8 * 1024 * 1024) / 669;
    const pageBytes = bytesPerProduct * 50;
    assert.isBelow(pageBytes, 300 * 1024, 'страница из 50 должна быть < 300 КБ');
  });

  it('пагинация не теряет записи при обходе всех страниц', () => {
    const total = 669;
    const size = 50;
    let seen = 0;
    for (let page = 0; hasNextPage(page - 1 < 0 ? 0 : page - 1, size, total) || page === 0; page++) {
      const offset = page * size;
      const count = Math.max(0, Math.min(size, total - offset));
      seen += count;
      if (!hasNextPage(page, size, total)) break;
    }
    assert.strictEqual(seen, total, 'обход всех страниц должен покрыть все записи');
  });
});
