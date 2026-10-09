/**
 * Лёгкая валидация входных данных без внешних зависимостей.
 *
 * Зачем: типы TypeScript стираются в рантайме, поэтому `@Body() body: SomeType`
 * ничего не проверяет — клиент может прислать любое поле (например `role: 'admin'`
 * при регистрации) или значение неверного типа (`durationDays: undefined` → NaN-даты).
 *
 * Использование:
 *   const dto = sanitize(body, {
 *     email: { type: 'string', required: true, maxLength: 255 },
 *     password: { type: 'string', required: true, minLength: 6 },
 *   });
 */

export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object' | 'date';

export type FieldRule = {
  type: FieldType;
  required?: boolean;
  /** Допустимые значения (для строковых enum-полей). */
  enum?: readonly string[];
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  /** Проверка формата e-mail. */
  email?: boolean;
  /** Значение по умолчанию, если поле отсутствует. */
  default?: unknown;
  /** Любое значение поля должно входить в этот список (для массивов строк). */
  arrayOfStrings?: boolean;
};

export type Schema = Record<string, FieldRule>;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function fail(field: string, reason: string): never {
  throw new ValidationError(`Поле «${field}»: ${reason}`);
}

function coerceString(field: string, value: unknown, rule: FieldRule): string | undefined {
  if (typeof value !== 'string') fail(field, 'ожидалась строка');
  let s = (value as string).trim();
  if (rule.maxLength != null && s.length > rule.maxLength) {
    fail(field, `длина не должна превышать ${rule.maxLength}`);
  }
  if (rule.minLength != null && s.length < rule.minLength) {
    fail(field, `длина должна быть не менее ${rule.minLength}`);
  }
  if (rule.email) {
    if (!s) fail(field, 'e-mail не может быть пустым');
    if (s.length > 255) fail(field, 'e-mail слишком длинный');
    if (!EMAIL_RE.test(s)) fail(field, 'некорректный e-mail');
    s = s.toLowerCase();
  }
  if (rule.enum && !rule.enum.includes(s)) {
    fail(field, `допустимые значения: ${rule.enum.join(', ')}`);
  }
  return s;
}

function coerceNumber(field: string, value: unknown, rule: FieldRule): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) fail(field, 'ожидалось число');
  if (rule.min != null && n < rule.min) fail(field, `значение не должно быть меньше ${rule.min}`);
  if (rule.max != null && n > rule.max) fail(field, `значение не должно быть больше ${rule.max}`);
  return n;
}

/**
 * Проверяет `input` по схеме и возвращает НОВЫЙ объект, содержащий только
 * перечисленные в схеме поля (whitelist). Лишние поля молча отбрасываются —
 * это ключевая защита от mass-assignment (`role`, `isBlocked`, `id` и т.п.).
 */
export function sanitize<T extends Record<string, unknown>>(
  input: unknown,
  schema: Schema,
): T {
  if (input == null || typeof input !== 'object' || Array.isArray(input)) {
    throw new ValidationError('Ожидался объект в теле запроса');
  }
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  for (const [field, rule] of Object.entries(schema)) {
    const raw = src[field];
    const absent = raw === undefined || raw === null || raw === '';

    if (absent) {
      if (rule.default !== undefined) {
        out[field] = rule.default;
        continue;
      }
      if (rule.required) fail(field, 'обязательное поле');
      continue;
    }

    switch (rule.type) {
      case 'string': {
        const s = coerceString(field, raw, rule);
        if (s !== undefined && s !== '') out[field] = s;
        else if (rule.required) fail(field, 'обязательное поле');
        break;
      }
      case 'number':
        out[field] = coerceNumber(field, raw, rule);
        break;
      case 'boolean':
        out[field] =
          typeof raw === 'boolean' ? raw : !['false', '0', ''].includes(String(raw).toLowerCase());
        break;
      case 'date': {
        const d = raw instanceof Date ? raw : new Date(String(raw));
        if (Number.isNaN(d.getTime())) fail(field, 'некорректная дата');
        out[field] = d;
        break;
      }
      case 'array': {
        if (!Array.isArray(raw)) fail(field, 'ожидался массив');
        let arr = raw as unknown[];
        if (rule.maxLength != null && arr.length > rule.maxLength) {
          fail(field, `не более ${rule.maxLength} элементов`);
        }
        if (rule.arrayOfStrings) {
          arr = arr
            .filter((x) => typeof x === 'string')
            .map((x) => (x as string).trim())
            .filter(Boolean);
        }
        out[field] = arr;
        break;
      }
      case 'object':
        if (typeof raw !== 'object' || Array.isArray(raw)) fail(field, 'ожидался объект');
        out[field] = raw;
        break;
    }
  }

  return out as T;
}

/** Быстрая проверка «строка похожа на e-mail» — для переиспользования в сервисах. */
/**
 * Единая нормализация e-mail перед записью в БД.
 *
 * Без неё один и тот же адрес в разном регистре создавал дубли аккаунтов:
 * уникальный индекс в PostgreSQL регистрозависим.
 */
export function normalizeEmailForStorage(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}
