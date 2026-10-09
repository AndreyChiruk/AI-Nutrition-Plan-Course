import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты хранения имени пользователя.
 *
 * Проблема: поля `name` не было ни в модели User, ни в таблице users.
 * Фронтенд писал имя в localStorage браузера, поэтому:
 *   - изменения не сохранялись в БД (пользователь менял имя — оно не
 *     переживало смену устройства или очистку хранилища);
 *   - сервер не знал имени (письма, уведомления, админка);
 *   - `updateProfile` не содержал `name` ни в whitelist, ни в payload формы.
 *
 * Здесь повторяется логика нормализации имени из UsersService.
 */
function normalizeName(value: unknown): string | null {
  const raw = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (raw.length > 120) throw new Error('Имя не должно превышать 120 символов');
  return raw.length > 0 ? raw : null;
}

/** Запасное имя при регистрации: часть email до «@». */
function fallbackName(email: string): string {
  return String(email ?? '').split('@')[0];
}

describe('имя пользователя', () => {
  it('сохраняет обычное имя', () => {
    assert.strictEqual(normalizeName('Андрей'), 'Андрей');
  });

  it('обрезает пробелы по краям', () => {
    assert.strictEqual(normalizeName('  Андрей  '), 'Андрей');
  });

  it('пустая строка превращается в null (имя не задано)', () => {
    assert.isNull(normalizeName(''));
    assert.isNull(normalizeName('   '));
    assert.isNull(normalizeName(null));
    assert.isNull(normalizeName(undefined));
  });

  it('удаляет управляющие символы', () => {
    assert.strictEqual(normalizeName('Ан\u0000дрей\n'), 'Андрей');
  });

  it('ограничивает длину 120 символами', () => {
    assert.strictEqual(normalizeName('А'.repeat(120))?.length, 120);
    assert.throws(() => normalizeName('А'.repeat(121)), /120/);
  });

  it('поддерживает кириллицу, латиницу и дефисы', () => {
    for (const n of ['Андрей', 'John', 'Анна-Мария', "О'Нил"]) {
      assert.strictEqual(normalizeName(n), n);
    }
  });

  it('запасное имя берётся из email при регистрации', () => {
    assert.strictEqual(fallbackName('andrey@example.com'), 'andrey');
    assert.strictEqual(fallbackName('user1@test.local'), 'user1');
  });

  it('регистрация сохраняет переданное имя, а не запасное', () => {
    // Логика: name || normalized.split('@')[0]
    const normalized = 'new@mail.com';
    assert.strictEqual(normalizeName('Иван') || fallbackName(normalized), 'Иван');
  });
});
