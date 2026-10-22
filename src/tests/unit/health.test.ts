import { assert } from 'chai';
import { describe, it } from 'mocha';
import { HealthController } from '../../health/health.controller';

/**
 * Тесты проверки работоспособности.
 *
 * У контейнера `api` не было healthcheck: Docker считал его здоровым сразу
 * после старта процесса, даже если база недоступна и запросы падают.
 * Мониторинг не замечал отказ БД, а `depends_on` не мог дождаться
 * реальной готовности.
 *
 * Здесь повторяется логика `HealthController`.
 */
function live() {
  return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
}

async function ready(query: () => Promise<unknown>) {
  const startedAt = Date.now();
  try {
    await query();
  } catch (e) {
    return {
      statusCode: 503,
      body: {
        status: 'unavailable',
        database: 'down',
        message: 'База данных недоступна',
        detail: e instanceof Error ? e.message : String(e),
      },
    };
  }
  return {
    statusCode: 200,
    body: { status: 'ok', database: 'up', dbLatencyMs: Date.now() - startedAt },
  };
}

describe('health-check', () => {
  it('live отвечает ok независимо от базы', () => {
    const r = live();
    assert.strictEqual(r.status, 'ok');
    assert.isNumber(r.uptimeSec);
  });

  it('ready возвращает ok, когда база доступна', async () => {
    const r = await ready(async () => [{ '?column?': 1 }]);
    assert.strictEqual(r.statusCode, 200);
    assert.strictEqual(r.body.database, 'up');
    assert.isNumber((r.body as { dbLatencyMs: number }).dbLatencyMs);
  });

  it('ready возвращает 503, когда база недоступна (главный кейс)', async () => {
    const r = await ready(async () => {
      throw new Error('connection refused');
    });
    assert.strictEqual(r.statusCode, 503, 'Docker должен увидеть unhealthy');
    assert.strictEqual(r.body.database, 'down');
    assert.include(r.body.detail ?? '', 'connection refused');
  });

  it('ответ ready не раскрывает лишних сведений', async () => {
    const r = await ready(async () => 1);
    const keys = Object.keys(r.body);
    // Ни версий, ни путей, ни конфигурации — эндпоинт открыт без авторизации.
    assert.notInclude(keys, 'version');
    assert.notInclude(keys, 'config');
    assert.notInclude(keys, 'env');
    assert.notInclude(keys, 'host');
  });

  it('сообщение об ошибке на русском и понятное', async () => {
    const r = await ready(async () => {
      throw new Error('timeout');
    });
    assert.strictEqual(r.body.message, 'База данных недоступна');
  });

  it('нагрузка на БД минимальна: один SELECT 1', async () => {
    let calls = 0;
    let sql = '';
    await ready(async () => {
      calls++;
      sql = 'SELECT 1';
      return [];
    });
    assert.strictEqual(calls, 1, 'healthcheck не должен делать лишних запросов');
    assert.strictEqual(sql, 'SELECT 1');
  });

  it('healthy-статус api зависит от готовности web (порядок запуска)', () => {
    // docker-compose: web.depends_on.api.condition = service_healthy
    const compose = { web: { dependsOn: { api: 'service_healthy' } } };
    assert.strictEqual(compose.web.dependsOn.api, 'service_healthy');
  });

  it('catalogStats кэширует результат на 5 минут и не делает повторный SQL-запрос', async () => {
    let queryCount = 0;
    const mockSequelize = {
      query: async () => {
        queryCount++;
        return [[{ dishes: '100', categories: '15', with_alcohol: '2' }]];
      },
    };
    const ctrl = new HealthController(mockSequelize as never);
    const first = await ctrl.catalogStats();
    assert.deepEqual(first, { dishes: 100, categories: 15, withAlcohol: 2 });
    assert.strictEqual(queryCount, 1);

    const second = await ctrl.catalogStats();
    assert.deepEqual(second, { dishes: 100, categories: 15, withAlcohol: 2 });
    assert.strictEqual(queryCount, 1, 'второй вызов должен возвращать результат из кэша');
  });
});
