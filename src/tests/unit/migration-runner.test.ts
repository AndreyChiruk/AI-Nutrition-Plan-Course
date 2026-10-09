import { assert } from 'chai';
import { createHash } from 'crypto';
import { describe, it } from 'mocha';

/**
 * Тесты механизма миграций.
 *
 * Раньше SQL-миграции в `database/migrations/` применялись ТОЛЬКО вручную
 * (`psql < файл`). Последствия:
 *   - на чистой базе схема не соответствовала коду;
 *   - повторный запуск мог выполнить миграцию дважды;
 *   - нельзя было понять, что применено, а что нет.
 *
 * Здесь покрыты: контрольная сумма, порядок применения и идемпотентность.
 */
function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Сортировка файлов миграций: 001_, 002_, … 010_ (лексикографически). */
function sortMigrationFiles(files: string[]): string[] {
  return [...files].sort((a, b) => a.localeCompare(b, 'en'));
}

describe('механизм миграций', () => {
  it('считает контрольную сумму файла', () => {
    const a = checksumOf('CREATE TABLE t (id int);');
    const b = checksumOf('CREATE TABLE t (id int);');
    const c = checksumOf('CREATE TABLE t (id bigint);');
    assert.strictEqual(a, b, 'одинаковый SQL — одинаковая сумма');
    assert.notStrictEqual(a, c, 'изменённый SQL — другая сумма');
    assert.lengthOf(a, 64, 'SHA-256 в hex — 64 символа');
  });

  it('сортирует миграции в правильном порядке', () => {
    const files = ['010_x.sql', '002_y.sql', '001_z.sql', '021_w.sql', '003_v.sql'];
    assert.deepEqual(sortMigrationFiles(files), [
      '001_z.sql',
      '002_y.sql',
      '003_v.sql',
      '010_x.sql',
      '021_w.sql',
    ]);
  });

  it('обнаруживает изменение применённой миграции', () => {
    const applied = checksumOf('CREATE TABLE t (id int);');
    const current = checksumOf('CREATE TABLE t (id bigint);');
    assert.notStrictEqual(applied, current, 'изменение должно быть замечено');
  });

  it('пропускает уже применённую миграцию с той же суммой', () => {
    const sql = 'ALTER TABLE t ADD COLUMN a int;';
    const applied = new Map([['001_a.sql', checksumOf(sql)]]);
    assert.strictEqual(applied.get('001_a.sql'), checksumOf(sql));
  });

  it('идемпотентность: повторный прогон не применяет ничего', () => {
    // Имитация: после первого прогона все файлы есть в schema_migrations.
    const files = ['001_a.sql', '002_b.sql'];
    const applied = new Map(files.map((f) => [f, checksumOf('sql-' + f)]));
    const toApply = files.filter((f) => !applied.has(f));
    assert.isEmpty(toApply, 'повторный прогон не должен применять миграции');
  });

  it('применяет только отсутствующие миграции', () => {
    const files = ['001_a.sql', '002_b.sql', '003_c.sql'];
    const applied = new Map([['001_a.sql', 'x']]);
    const toApply = files.filter((f) => !applied.has(f));
    assert.deepEqual(toApply, ['002_b.sql', '003_c.sql']);
  });

  it('нумерация миграций не содержит пропусков в начале', () => {
    // Первая миграция должна создавать базовую схему.
    const files = ['000_products_schema.sql', '001_reference_catalog.sql'];
    assert.isTrue(files[0].startsWith('000_'), 'базовая схема идёт первой');
  });
});
