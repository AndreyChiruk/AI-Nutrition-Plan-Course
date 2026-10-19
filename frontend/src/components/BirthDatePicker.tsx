import { useMemo } from 'react';

/**
 * Выбор даты рождения тремя списками: день / месяц / год.
 *
 * Почему не `<input type="date">`: нативный календарь в разных браузерах
 * выглядит по-разному, в тёмной теме не стилизуется и требует сначала
 * переключить год, потом месяц — пользователю непонятно, как выбрать
 * дату 1990 года. Три списка читаются сразу и одинаковы везде.
 *
 * Компонент отдаёт наружу строку `YYYY-MM-DD`, чтобы не менять формат,
 * который уже ждёт бэкенд.
 */

const MONTHS_RU = [
  'январь',
  'февраль',
  'март',
  'апрель',
  'май',
  'июнь',
  'июль',
  'август',
  'сентябрь',
  'октябрь',
  'ноябрь',
  'декабрь',
] as const;

/** Сколько дней в месяце с учётом високосного года. */
function daysInMonth(year: number, month: number): number {
  // Месяц здесь 1-based: день 0 следующего месяца = последний день текущего.
  return new Date(year, month, 0).getDate();
}

/** «1990-05-17» → части; неполная или битая строка → null-и. */
function parseYmd(value: string): { y: number | null; m: number | null; d: number | null } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim());
  if (!match) return { y: null, m: null, d: null };
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (!Number.isFinite(y) || m < 1 || m > 12 || d < 1 || d > 31) {
    return { y: null, m: null, d: null };
  }
  return { y, m, d };
}

/** Собирает `YYYY-MM-DD`, проверяя, что такой день существует. */
export function buildBirthDate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (year < 1900 || year > 2200) return null;
  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}

export type BirthDatePickerProps = {
  /** Значение в формате YYYY-MM-DD; пустая строка — не выбрано. */
  value: string;
  onChange: (next: string) => void;
  /** Минимальный и максимальный допустимый возраст — задаёт диапазон годов. */
  minAge: number;
  maxAge: number;
};

export function BirthDatePicker({ value, onChange, minAge, maxAge }: BirthDatePickerProps) {
  const { y, m, d } = useMemo(() => parseYmd(value), [value]);

  // Список годов строится от текущего года: сверху — самый молодой возраст.
  /*
   * Список годов: от будущего года вниз до самого старого возраста.
   *
   * Верхняя граница — не «текущий год минус minAge», а следующий год:
   * иначе список обрывался на 2016 и выбранного года могло не оказаться
   * в списке. Проверка возраста всё равно выполняется при сохранении.
   */
  const years = useMemo(() => {
    const now = new Date().getFullYear();
    const newest = now + 1;
    const oldest = now - maxAge;
    const out: number[] = [];
    for (let year = newest; year >= oldest; year -= 1) out.push(year);
    return out;
  }, [minAge, maxAge]);

  // Дней в выбранном месяце: 31 для «не выбран», чтобы список не прыгал.
  const days = useMemo(() => {
    const total = y && m ? daysInMonth(y, m) : 31;
    return Array.from({ length: total }, (_, i) => i + 1);
  }, [y, m]);

  /** Пересобирает дату; неполный выбор наружу не отдаём. */
  const emit = (nextY: number | null, nextM: number | null, nextD: number | null) => {
    if (nextY === null || nextM === null || nextD === null) {
      onChange('');
      return;
    }
    // Если в новом месяце меньше дней (31 → февраля), день подрезается,
    // иначе получилась бы дата вроде 31 февраля.
    const safeDay = Math.min(nextD, daysInMonth(nextY, nextM));
    onChange(buildBirthDate(nextY, nextM, safeDay) ?? '');
  };

  /** Смена года или месяца не должна сбрасывать уже выбранный день. */
  const pickYear = (raw: string) => emit(raw ? Number(raw) : null, m, d);
  const pickMonth = (raw: string) => emit(y, raw ? Number(raw) : null, d);
  const pickDay = (raw: string) => emit(y, m, raw ? Number(raw) : null);

  return (
    <div className="birthdate-picker">
      <select
        aria-label="День рождения"
        value={d ?? ''}
        onChange={(e) => pickDay(e.target.value)}
      >
        <option value="">День</option>
        {days.map((day) => (
          <option key={day} value={day}>
            {day}
          </option>
        ))}
      </select>

      <select
        aria-label="Месяц рождения"
        value={m ?? ''}
        onChange={(e) => pickMonth(e.target.value)}
      >
        <option value="">Месяц</option>
        {MONTHS_RU.map((name, index) => (
          <option key={name} value={index + 1}>
            {name}
          </option>
        ))}
      </select>

      <select
        aria-label="Год рождения"
        value={y ?? ''}
        onChange={(e) => pickYear(e.target.value)}
      >
        <option value="">Год</option>
        {years.map((year) => (
          <option key={year} value={year}>
            {year}
          </option>
        ))}
      </select>
    </div>
  );
}
