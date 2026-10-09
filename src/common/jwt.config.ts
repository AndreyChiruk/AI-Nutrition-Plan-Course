/**
 * Единый источник JWT-секрета.
 *
 * Раньше каждый из 10 модулей использовал `process.env.JWT_SECRET ?? 'dev-secret'`.
 * При отсутствии переменной приложение молча стартовало с публично известным
 * секретом, и любой мог подписать токен с `role: 'admin'`.
 *
 * Теперь секрет валидируется. Исключение — тесты и явный opt-in
 * ALLOW_INSECURE_JWT_SECRET=1 для локального запуска без секрета.
 */

const PLACEHOLDER_SECRETS = new Set([
  'dev-secret',
  'secret',
  'jwt-secret',
  'docker-dev-change-me',
  'changeme',
  'change-me',
]);

const MIN_LENGTH = 32;

let cached: string | null = null;

export function resolveJwtSecret(): string {
  if (cached) return cached;

  const raw = process.env.JWT_SECRET?.trim();
  const allowInsecure = process.env.ALLOW_INSECURE_JWT_SECRET === '1';
  const isTest = process.env.NODE_ENV === 'test';

  if (!raw || PLACEHOLDER_SECRETS.has(raw.toLowerCase()) || raw.length < MIN_LENGTH) {
    if (allowInsecure || isTest) {
      cached = raw && raw.length >= MIN_LENGTH ? raw : 'insecure-local-dev-secret-000000000000';
      return cached;
    }
    if (!raw) {
      throw new Error(
        'JWT_SECRET не задан. Сгенерируйте значение командой `openssl rand -hex 32` ' +
          'и добавьте его в .env — приложение не запускается без секрета подписи токенов.',
      );
    }
    throw new Error(
      `JWT_SECRET небезопасен: значение-заглушка или длина ${raw.length} < ${MIN_LENGTH}. ` +
        'Сгенерируйте уникальный секрет: `openssl rand -hex 32`. ' +
        'Для локального запуска без секрета установите ALLOW_INSECURE_JWT_SECRET=1.',
    );
  }

  cached = raw;
  return cached;
}

/** Для тестов: сбросить кэш после изменения переменных окружения. */
export function resetJwtSecretCache(): void {
  cached = null;
}
