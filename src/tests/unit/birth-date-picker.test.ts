import { assert } from 'chai';
import { describe, it } from 'mocha';
/**
 * Повторяет `buildBirthDate` из frontend/src/components/BirthDatePicker.tsx.
 *
 * Компонент живёт на фронтенде, а тестовый раннер собирает только `src/`,
 * поэтому логика продублирована здесь — как и в других тестах проекта.
 */
function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

function buildBirthDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (year < 1900 || year > 2200) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

/**
 * Сборка даты рождения из трёх списков (день / месяц / год).
 *
 * Раньше использовался нативный `<input type="date">`: в тёмной теме он
 * не стилизовался, а чтобы дойти до 1990 года, нужно было сначала
 * переключить год в календаре — пользователю это было непонятно.
 * Тесты фиксируют, что нельзя собрать несуществующую дату.
 */
describe('дата рождения: сборка из дня, месяца и года', () => {
  it('собирает корректную дату в формате YYYY-MM-DD', () => {
    assert.strictEqual(buildBirthDate(1990, 5, 17), '1990-05-17');
    assert.strictEqual(buildBirthDate(2003, 12, 1), '2003-12-01');
  });

  it('добавляет ведущие нули', () => {
    assert.strictEqual(buildBirthDate(1999, 1, 5), '1999-01-05');
  });

  it('не даёт собрать 31 февраля и 31 апреля', () => {
    assert.isNull(buildBirthDate(1990, 2, 31), 'в феврале не бывает 31 дня');
    assert.isNull(buildBirthDate(1990, 4, 31), 'в апреле 30 дней');
  });

  it('учитывает високосный год', () => {
    assert.strictEqual(buildBirthDate(2000, 2, 29), '2000-02-29', '2000 — високосный');
    assert.isNull(buildBirthDate(1900, 2, 29), '1900 — не високосный');
    assert.isNull(buildBirthDate(2001, 2, 29), '2001 — не високосный');
  });

  it('отклоняет месяц вне диапазона и мусор', () => {
    assert.isNull(buildBirthDate(1990, 0, 10));
    assert.isNull(buildBirthDate(1990, 13, 10));
    assert.isNull(buildBirthDate(1990, 5, 0));
    assert.isNull(buildBirthDate(1990, 5, 32));
    assert.isNull(buildBirthDate(1990.5 as number, 5, 10));
    assert.isNull(buildBirthDate(NaN, 5, 10));
  });

  it('отклоняет неправдоподобный год', () => {
    assert.isNull(buildBirthDate(1800, 5, 10), 'слишком старый год');
    assert.isNull(buildBirthDate(3000, 5, 10), 'год из будущего');
    assert.isNotNull(buildBirthDate(1900, 5, 10));
  });

  it('подрезает день при переходе на короткий месяц', () => {
    // Так делает BirthDatePicker: 31 января → февраль даёт 28/29, а не 31.
    const daysInFeb = new Date(1990, 2, 0).getDate();
    const safe = Math.min(31, daysInFeb);
    assert.strictEqual(buildBirthDate(1990, 2, safe), '1990-02-28');
  });
});
