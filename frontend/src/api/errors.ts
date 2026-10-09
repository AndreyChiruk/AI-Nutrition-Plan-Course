import axios from 'axios';

/**
 * Извлечение человекочитаемого сообщения об ошибке из ответа API.
 *
 * Зачем: на фронтенде повсеместно использовались пустые `catch {}` или вывод
 * общего текста «Не удалось выполнить действие». Реальное сообщение сервера
 * (например, «Для аккаунта „Гость“ доступен только раздел „Распознавание еды“»
 * или «Поле „photoUrl“: изображение слишком большое») терялось, и пользователь
 * не понимал, что именно пошло не так и как это исправить.
 *
 * Здесь собираются все формы ответов NestJS:
 *   - `{ message: string }` — обычная ошибка;
 *   - `{ message: string[] }` — ошибки валидации (массив);
 *   - `{ error: string }` — краткое описание;
 *   - сетевые ошибки без ответа.
 */

/** Статусы, для которых показываем понятное объяснение, а не технический текст. */
const STATUS_HINTS: Record<number, string> = {
  400: 'Проверьте правильность заполнения полей.',
  401: 'Требуется вход в систему — возможно, срок сессии истёк.',
  403: 'Недостаточно прав для этого действия.',
  404: 'Запрашиваемые данные не найдены.',
  409: 'Данные уже существуют или конфликтуют с текущим состоянием.',
  413: 'Файл слишком большой.',
  429: 'Слишком много запросов — попробуйте немного позже.',
  500: 'Внутренняя ошибка сервера. Попробуйте позже.',
  503: 'Сервис временно недоступен. Попробуйте позже.',
};

export type ApiErrorInfo = {
  /** Основное сообщение для показа пользователю. */
  message: string;
  /** HTTP-статус, если ответ получен. */
  status?: number;
  /** Дополнительные сообщения валидации (если сервер вернул массив). */
  details: string[];
  /** Краткое пояснение по статусу. */
  hint?: string;
  /** Признак сетевой ошибки (сервер недоступен). */
  isNetworkError: boolean;
};

/** Достаёт текст из произвольного значения поля `message`. */
function extractMessage(value: unknown): { main: string; details: string[] } {
  if (typeof value === 'string') {
    const s = value.trim();
    return { main: s, details: [] };
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (typeof v === 'string' ? v.trim() : ''))
      .filter((v) => v.length > 0);
    if (parts.length === 0) return { main: '', details: [] };
    // Первое сообщение показываем крупно, остальные — списком.
    return { main: parts[0], details: parts.slice(1) };
  }
  return { main: '', details: [] };
}

export function getApiErrorInfo(error: unknown, fallback = 'Не удалось выполнить действие.'): ApiErrorInfo {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const data = error.response?.data as Record<string, unknown> | undefined;

    if (!error.response) {
      return {
        message:
          error.code === 'ECONNABORTED'
            ? 'Превышено время ожидания ответа сервера.'
            : 'Сервер недоступен. Проверьте подключение к сети.',
        details: [],
        hint: 'Если проблема повторяется, попробуйте позже.',
        isNetworkError: true,
      };
    }

    const fromMessage = extractMessage(data?.message);
    const fromError = extractMessage(data?.error);

    const main = fromMessage.main || fromError.main || fallback;
    const details = fromMessage.details.length > 0 ? fromMessage.details : fromError.details;

    return {
      message: main,
      status,
      details,
      hint: status ? STATUS_HINTS[status] : undefined,
      isNetworkError: false,
    };
  }

  if (error instanceof Error && error.message) {
    return { message: error.message, details: [], isNetworkError: false };
  }

  return { message: fallback, details: [], isNetworkError: false };
}

/** Готовая строка для показа: сообщение + пояснение + детали. */
export function formatApiError(error: unknown, fallback?: string): string {
  const info = getApiErrorInfo(error, fallback);
  const parts = [info.message];
  if (info.details.length > 0) parts.push(info.details.join(' '));
  if (info.hint && !info.message.includes(info.hint)) parts.push(info.hint);
  return parts.join(' ').trim();
}
