import { randomBytes, scrypt as scryptCb, scryptSync, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/**
 * Хэширование паролей.
 *
 * Раньше использовался несолёный SHA-256 (`createHash('sha256').update(pw).digest('hex')`),
 * что давало мгновенный подбор по радужным таблицам и одинаковые хэши у пользователей
 * с одинаковым паролем.
 *
 * Теперь — scrypt (встроен в Node, без внешних зависимостей): соль на каждый пароль,
 * параметризуемая стоимость, сравнение в постоянном времени.
 *
 * Формат хранения: `scrypt$N$r$p$<salt-hex>$<hash-hex>`
 * Префикс позволяет отличить новый формат от старых SHA-256 хэшей и выполнить
 * «ленивую» миграцию при следующем успешном входе пользователя.
 */

const N = 16384; // стоимость CPU/памяти
const R = 8; // размер блока
const P = 1; // параллелизм
const KEYLEN = 64;
const SALT_BYTES = 16;

export const SCRYPT_PREFIX = 'scrypt$';

export function isLegacySha256Hash(stored: string): boolean {
  return /^[0-9a-f]{64}$/i.test(String(stored ?? '').trim());
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const derived = await scrypt(plain, salt, KEYLEN);
  return `${SCRYPT_PREFIX}${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

/** Синхронный вариант — только для bootstrap-скриптов и тестов. */
export function hashPasswordSync(plain: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(plain, salt, KEYLEN);
  return `${SCRYPT_PREFIX}${N}$${R}$${P}$${salt.toString('hex')}$${derived.toString('hex')}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const value = String(stored ?? '').trim();
  if (!value) return false;

  if (value.startsWith(SCRYPT_PREFIX)) {
    const parts = value.split('$');
    // scrypt, N, r, p, salt, hash
    if (parts.length !== 6) return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

    let salt: Buffer;
    let expected: Buffer;
    try {
      salt = Buffer.from(parts[4], 'hex');
      expected = Buffer.from(parts[5], 'hex');
    } catch {
      return false;
    }
    if (salt.length === 0 || expected.length === 0) return false;

    try {
      const derived = await new Promise<Buffer>((resolve, reject) => {
        scryptCb(plain, salt, expected.length, { N: n, r, p }, (err, key) =>
          err ? reject(err) : resolve(key),
        );
      });
      return derived.length === expected.length && timingSafeEqual(derived, expected);
    } catch {
      return false;
    }
  }

  // Старый формат: несолёный SHA-256. Проверяем для ленивой миграции.
  if (isLegacySha256Hash(value)) {
    const { createHash } = await import('crypto');
    const legacy = createHash('sha256').update(plain).digest('hex');
    const a = Buffer.from(legacy, 'hex');
    const b = Buffer.from(value, 'hex');
    return a.length === b.length && timingSafeEqual(a, b);
  }

  return false;
}

/** Нужно ли перехэшировать пароль после успешного входа (старый формат). */
export function needsRehash(stored: string): boolean {
  const v = String(stored ?? '').trim();
  if (!v.startsWith(SCRYPT_PREFIX)) return true;
  const parts = v.split('$');
  if (parts.length !== 6) return true;
  return Number(parts[1]) !== N || Number(parts[2]) !== R || Number(parts[3]) !== P;
}
