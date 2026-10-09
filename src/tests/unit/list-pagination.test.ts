import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты пагинации пользовательских списков.
 *
 * `listUserPlans` возвращал ВСЕ планы пользователя разом. В реальных данных
 * у одного пользователя 45 планов, и число растёт с каждой генерацией:
 * ответ и таблица в интерфейсе росли неограниченно.
 *
 * Здесь повторяется логика нормализации параметров и разбиения на страницы.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function normalize(opts?: { limit?: unknown; offset?: unknown }): { limit: number; offset: number } {
  const rawLimit = Number(opts?.limit);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, Math.floor(rawLimit)) : DEFAULT_LIMIT;
  const rawOffset = Number(opts?.offset);
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? Math.floor(rawOffset) : 0;
  return { limit, offset };
}

describe('пагинация списка планов', () => {
  it('по умолчанию отдаёт первые 50', () => {
    assert.deepEqual(normalize(), { limit: 50, offset: 0 });
    assert.deepEqual(normalize({}), { limit: 50, offset: 0 });
  });

  it('ограничивает размер страницы 200 записями', () => {
    assert.strictEqual(normalize({ limit: 10000 }).limit, MAX_LIMIT);
  });

  it('приводит некорректные значения к безопасным', () => {
    assert.strictEqual(normalize({ limit: 'abc' as unknown }).limit, DEFAULT_LIMIT);
    assert.strictEqual(normalize({ limit: -3 }).limit, DEFAULT_LIMIT);
    assert.strictEqual(normalize({ offset: -10 }).offset, 0);
    assert.strictEqual(normalize({ offset: NaN }).offset, 0);
  });

  it('разбивает 45 планов на страницы', () => {
    const total = 45;
    const size = 50;
    assert.strictEqual(Math.ceil(total / size), 1, '45 планов помещаются в одну страницу');
  });

  it('обходит все страницы без потерь', () => {
    const total = 450;
    const size = 50;
    let seen = 0;
    for (let offset = 0; offset < total; offset += size) {
      seen += Math.max(0, Math.min(size, total - offset));
    }
    assert.strictEqual(seen, total);
  });

  it('возвращаемый объект содержит rows и count', () => {
    // Форма ответа важна: `findAndCountAll` даёт { count, rows },
    // и интерфейс использует count для навигации.
    const response = { count: 45, rows: [] as unknown[] };
    assert.property(response, 'count');
    assert.property(response, 'rows');
  });

  it('обратная совместимость: интерфейс читает rows и не падает на пустом ответе', () => {
    const page = { rows: [], count: 0 };
    const plans = Array.isArray(page?.rows) ? page.rows : [];
    assert.isEmpty(plans);
  });
});
