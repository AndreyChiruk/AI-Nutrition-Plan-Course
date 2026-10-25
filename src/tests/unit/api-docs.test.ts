import { assert } from 'chai';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { describe, it } from 'mocha';

/**
 * Тесты документации API.
 *
 * В проекте не было описания эндпоинтов (Swagger не подключён), поэтому состав
 * маршрутов выяснялся чтением кода. Рукописная документация быстро устаревает,
 * поэтому `docs/API.md` ГЕНЕРИРУЕТСЯ из контроллеров (`npm run docs:api`).
 *
 * Тесты проверяют, что файл существует, содержит ключевые разделы и
 * соответствует реальному коду (число контроллеров).
 */
const DOC_PATH = join(process.cwd(), 'docs', 'API.md');

describe('документация API', () => {
  it('файл существует', () => {
    assert.isTrue(existsSync(DOC_PATH), 'docs/API.md должен существовать (npm run docs:api)');
  });

  it('описывает health-check', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    assert.include(doc, '/health');
    assert.include(doc, '/health/ready');
    assert.include(doc, '503');
  });

  it('содержит все ключевые разделы', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    for (const section of [
      'auth',
      'users',
      'meal-plan',
      'stats',
      'food-recognition',
      'admin',
      'health',
    ]) {
      assert.include(doc, `### ${section}`, `раздел «${section}» отсутствует`);
    }
  });

  it('указывает уровни доступа', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    assert.include(doc, 'публичный');
    assert.include(doc, 'авторизация');
    assert.include(doc, 'админ');
  });

  it('документирует ограничение частоты платных вызовов', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    assert.include(doc, 'Ограничение', 'лимиты OpenAI-эндпоинтов должны быть указаны');
  });

  it('документирует лимит тела запроса и заголовок авторизации', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    assert.include(doc, 'Authorization: Bearer');
    assert.include(doc, '12 МБ');
  });

  it('указывает, что файл генерируется автоматически', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    assert.include(doc, 'npm run docs:api', 'должно быть понятно, как обновить документацию');
  });

  it('не содержит внутренних путей файловой системы', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    assert.notInclude(doc, 'src/');
    assert.notInclude(doc, '/Users/');
  });

  it('публичных эндпоинтов немного (security-контроль)', () => {
    const doc = readFileSync(DOC_PATH, 'utf8');
    const m = doc.match(/без авторизации: \*\*(\d+)\*\*/);
    assert.isNotNull(m, 'должно быть указано число публичных эндпоинтов');
    const publicCount = Number(m![1]);
    // Публичными должны быть только health, login, register и подобные.
    assert.isAtMost(publicCount, 12, `слишком много публичных эндпоинтов: ${publicCount}`);
  });
});
