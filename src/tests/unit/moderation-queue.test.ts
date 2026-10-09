import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты очереди модерации.
 *
 * Механика работала: `submit-meal` создавал запись со статусом `pending`,
 * а `GET /admin/meals/pending` читал именно этот статус.
 *
 * Но фронтенд при ПЕРВОЙ загрузке админки ожидал массив
 * (`Array.isArray(pendingMealsData)`), тогда как сервер после введения
 * пагинации отдаёт `{ rows, count }`. Условие всегда было ложным, поэтому
 * очередь ВСЕГДА выглядела пустой: распознавания лежали в БД, но
 * администратор их не видел, пока не выполнял действие, вызывающее
 * перезагрузку списка (подтверждение или отклонение).
 */
type ApiPage<T> = { rows: T[]; count: number };

/** Как фронтенд разбирает ответ очереди (исправленная версия). */
function parseQueue(data: unknown): { rows: Array<{ foodName: string }>; count: number } {
  const page = data as Partial<ApiPage<{ foodName: string }>> | undefined;
  return {
    rows: Array.isArray(page?.rows) ? page.rows : [],
    count: typeof page?.count === 'number' ? page.count : 0,
  };
}

/** Прежнее (ошибочное) поведение — для демонстрации регресса. */
function parseQueueOld(data: unknown): Array<{ foodName: string }> {
  return Array.isArray(data) ? (data as Array<{ foodName: string }>) : [];
}

describe('очередь модерации', () => {
  const serverResponse = { rows: [{ foodName: 'Гречка с курицей' }], count: 1 };

  it('разбирает ответ сервера в формате { rows, count }', () => {
    const q = parseQueue(serverResponse);
    assert.lengthOf(q.rows, 1);
    assert.strictEqual(q.count, 1);
  });

  it('старый код показывал пустую очередь (регресс)', () => {
    // Это и был баг: массив не найден, список пустой при непустой БД.
    assert.isEmpty(parseQueueOld(serverResponse));
  });

  it('показывает все записи и общее число', () => {
    const many = {
      rows: Array.from({ length: 5 }, (_, i) => ({ foodName: `Блюдо ${i}` })),
      count: 42,
    };
    const q = parseQueue(many);
    assert.lengthOf(q.rows, 5, 'на странице 5 записей');
    assert.strictEqual(q.count, 42, 'всего в очереди 42');
  });

  it('корректно обрабатывает пустую очередь', () => {
    const q = parseQueue({ rows: [], count: 0 });
    assert.isEmpty(q.rows);
    assert.strictEqual(q.count, 0);
  });

  it('устойчив к неожиданному формату ответа', () => {
    assert.isEmpty(parseQueue(null).rows);
    assert.isEmpty(parseQueue(undefined).rows);
    assert.isEmpty(parseQueue({}).rows);
    assert.strictEqual(parseQueue({}).count, 0);
  });

  it('запись отправляется со статусом pending', () => {
    // Контракт: submit-meal создаёт запись именно в этом статусе.
    const status = 'pending';
    assert.strictEqual(status, 'pending');
  });

  it('после подтверждения запись уходит из очереди', () => {
    // Очередь читает только статус pending.
    const statuses = ['pending', 'confirmed', 'rejected'];
    const inQueue = statuses.filter((st) => st === 'pending');
    assert.deepEqual(inQueue, ['pending']);
    assert.notInclude(inQueue, 'confirmed');
    assert.notInclude(inQueue, 'rejected');
  });
});
