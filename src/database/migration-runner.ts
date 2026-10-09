import { Logger } from '@nestjs/common';
import { Sequelize } from 'sequelize';
import { createHash } from 'crypto';
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * Применение SQL-миграций при старте приложения.
 *
 * Зачем: миграции в `database/migrations/*.sql` существовали, но применялись
 * только вручную (`psql < файл`). В результате:
 *   - на чистой базе схема не соответствовала коду (приходилось помнить,
 *     какие файлы и в каком порядке выполнить);
 *   - повторный запуск мог выполнить миграцию дважды;
 *   - нельзя было понять, что уже применено, а что нет.
 *
 * Здесь ведётся таблица `schema_migrations` с контрольной суммой файла:
 *   - применённые миграции пропускаются;
 *   - изменённый после применения файл обнаруживается и вызывает ошибку
 *     (защита от «тихого» расхождения схемы);
 *   - каждая миграция выполняется в транзакции: при сбое база остаётся
 *     в согласованном состоянии.
 *
 * ВАЖНО: несколько миграций этого проекта содержат блоки `DO $$ ... $$`
 * с `RAISE NOTICE`. Они работают в транзакции PostgreSQL нормально,
 * поэтому оборачивание безопасно.
 */

export type MigrationRunResult = {
  applied: string[];
  skipped: string[];
  failed: Array<{ file: string; error: string }>;
};

const MIGRATIONS_DIR = join(process.cwd(), 'database', 'migrations');

/** Создаёт таблицу учёта миграций, если её ещё нет. */
async function ensureMigrationsTable(sequelize: Sequelize): Promise<void> {
  await sequelize.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name VARCHAR(255) PRIMARY KEY,
      checksum VARCHAR(64) NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      duration_ms INTEGER NOT NULL DEFAULT 0
    );
  `);
}

/** SHA-256 содержимого файла — для обнаружения изменений после применения. */
function checksumOf(sql: string): string {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/** Список .sql файлов в лексикографическом порядке (001_, 002_, …). */
function listMigrationFiles(): string[] {
  try {
    return readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.toLowerCase().endsWith('.sql'))
      .sort((a, b) => a.localeCompare(b, 'en'));
  } catch {
    return [];
  }
}

/**
 * Применяет все неприменённые миграции.
 *
 * @param opts.allowChecksumMismatch — не падать, если файл изменился после
 *        применения (нужно при первой установке на существующую базу,
 *        где таблица учёта пуста, а схема уже создана вручную).
 */
export async function runMigrations(
  sequelize: Sequelize,
  opts: { logger?: Logger; allowChecksumMismatch?: boolean } = {},
): Promise<MigrationRunResult> {
  const logger = opts.logger ?? new Logger('Migrations');
  const result: MigrationRunResult = { applied: [], skipped: [], failed: [] };

  await ensureMigrationsTable(sequelize);

  const [rows] = await sequelize.query('SELECT name, checksum FROM schema_migrations');
  const applied = new Map<string, string>(
    (rows as Array<{ name: string; checksum: string }>).map((r) => [r.name, r.checksum]),
  );

  const files = listMigrationFiles();
  if (files.length === 0) {
    logger.warn(`Каталог миграций не найден или пуст: ${MIGRATIONS_DIR}`);
    return result;
  }

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    let sql: string;
    try {
      sql = readFileSync(path, 'utf8');
    } catch (e) {
      result.failed.push({ file, error: `не удалось прочитать: ${String(e)}` });
      continue;
    }

    const checksum = checksumOf(sql);
    const prev = applied.get(file);

    // Уже применена.
    if (prev !== undefined) {
      if (prev === checksum) {
        result.skipped.push(file);
        continue;
      }
      const msg =
        `Файл миграции «${file}» изменён после применения ` +
        `(было ${prev.slice(0, 8)}…, стало ${checksum.slice(0, 8)}…). ` +
        'Схема может отличаться от кода — создайте новую миграцию вместо правки применённой.';
      if (opts.allowChecksumMismatch) {
        logger.warn(msg);
        result.skipped.push(file);
        continue;
      }
      logger.error(msg);
      result.failed.push({ file, error: 'checksum mismatch' });
      continue;
    }

    // Применяем в транзакции.
    const startedAt = Date.now();
    try {
      await sequelize.transaction(async (t) => {
        await sequelize.query(sql, { transaction: t });
      });
      const durationMs = Date.now() - startedAt;
      await sequelize.query(
        'INSERT INTO schema_migrations (name, checksum, duration_ms) VALUES (:name, :checksum, :durationMs)',
        { replacements: { name: file, checksum, durationMs } },
      );
      result.applied.push(file);
      logger.log(`Применена миграция ${file} (${durationMs} мс)`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error(`Миграция ${file} не применена: ${message}`);
      result.failed.push({ file, error: message });
      // Останавливаемся на первой ошибке: последующие миграции могут
      // зависеть от неудавшейся.
      break;
    }
  }

  const summary =
    `Миграции: применено ${result.applied.length}, ` +
    `пропущено ${result.skipped.length}, ошибок ${result.failed.length}`;
  if (result.failed.length > 0) logger.error(summary);
  else logger.log(summary);

  return result;
}
