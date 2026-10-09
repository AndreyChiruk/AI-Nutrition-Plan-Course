import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты извлечения сообщений об ошибках API.
 *
 * Раньше на фронтенде повсеместно были пустые `catch {}` либо общий текст
 * «Не удалось выполнить действие». Реальное сообщение сервера терялось:
 *   - «Для аккаунта „Гость“ доступен только раздел „Распознавание еды“»;
 *   - «Поле „photoUrl“: изображение слишком большое»;
 *   - «Слишком много запросов — попробуйте позже».
 * Пользователь не понимал причину и не знал, что делать.
 *
 * Здесь повторяется логика `getApiErrorInfo` / `formatApiError`.
 */
const STATUS_HINTS: Record<number, string> = {
  400: 'Проверьте правильность заполнения полей.',
  401: 'Требуется вход в систему — возможно, срок сессии истёк.',
  403: 'Недостаточно прав для этого действия.',
  404: 'Запрашиваемые данные не найдены.',
  429: 'Слишком много запросов — попробуйте немного позже.',
  500: 'Внутренняя ошибка сервера. Попробуйте позже.',
};

function extractMessage(value: unknown): { main: string; details: string[] } {
  if (typeof value === 'string') return { main: value.trim(), details: [] };
  if (Array.isArray(value)) {
    const parts = value.map((v) => (typeof v === 'string' ? v.trim() : '')).filter(Boolean);
    if (parts.length === 0) return { main: '', details: [] };
    return { main: parts[0], details: parts.slice(1) };
  }
  return { main: '', details: [] };
}

function getApiErrorInfo(
  response: { status: number; data?: Record<string, unknown> } | null,
  fallback = 'Не удалось выполнить действие.',
) {
  if (!response) {
    return {
      message: 'Сервер недоступен. Проверьте подключение к сети.',
      details: [] as string[],
      isNetworkError: true,
      hint: 'Если проблема повторяется, попробуйте позже.',
    };
  }
  const fromMessage = extractMessage(response.data?.message);
  const fromError = extractMessage(response.data?.error);
  const main = fromMessage.main || fromError.main || fallback;
  const details = fromMessage.details.length > 0 ? fromMessage.details : fromError.details;
  return {
    message: main,
    status: response.status,
    details,
    hint: STATUS_HINTS[response.status],
    isNetworkError: false,
  };
}

describe('извлечение сообщений об ошибках API', () => {
  it('достаёт строковое сообщение NestJS', () => {
    const info = getApiErrorInfo({
      status: 403,
      data: { message: 'Для аккаунта «Гость» доступен только раздел «Распознавание еды».' },
    });
    assert.strictEqual(info.message, 'Для аккаунта «Гость» доступен только раздел «Распознавание еды».');
    assert.strictEqual(info.status, 403);
    assert.include(info.hint ?? '', 'прав');
  });

  it('разбирает массив сообщений валидации', () => {
    const info = getApiErrorInfo({
      status: 400,
      data: { message: ['Поле «email»: обязательное поле', 'Поле «password»: минимум 8 символов'] },
    });
    assert.strictEqual(info.message, 'Поле «email»: обязательное поле');
    assert.lengthOf(info.details, 1);
    assert.include(info.details[0], 'password');
  });

  it('использует поле error, если message отсутствует', () => {
    const info = getApiErrorInfo({ status: 500, data: { error: 'Internal Server Error' } });
    assert.strictEqual(info.message, 'Internal Server Error');
  });

  it('возвращает запасной текст, если сервер не дал сообщения', () => {
    const info = getApiErrorInfo({ status: 400, data: {} }, 'Не удалось сохранить.');
    assert.strictEqual(info.message, 'Не удалось сохранить.');
  });

  it('распознаёт сетевую ошибку и не путает её с ответом сервера', () => {
    const info = getApiErrorInfo(null);
    assert.isTrue(info.isNetworkError);
    assert.include(info.message, 'недоступен');
    assert.isUndefined(info.status);
  });

  it('даёт понятное пояснение для лимита запросов', () => {
    const info = getApiErrorInfo({ status: 429, data: { message: 'ThrottlerException' } });
    assert.include(info.hint ?? '', 'Слишком много запросов');
  });

  it('не дублирует пояснение, если оно уже есть в сообщении', () => {
    const info = getApiErrorInfo({
      status: 500,
      data: { message: 'Внутренняя ошибка сервера. Попробуйте позже.' },
    });
    const parts = [info.message];
    if (info.hint && !info.message.includes(info.hint)) parts.push(info.hint);
    const formatted = parts.join(' ').trim();
    assert.strictEqual(formatted, 'Внутренняя ошибка сервера. Попробуйте позже.');
  });

  it('пустой массив сообщений не ломает разбор', () => {
    const info = getApiErrorInfo({ status: 400, data: { message: [] } }, 'Запасной текст.');
    assert.strictEqual(info.message, 'Запасной текст.');
    assert.isEmpty(info.details);
  });

  it('обрезает пробелы в сообщении сервера', () => {
    const info = getApiErrorInfo({ status: 400, data: { message: '   Ошибка   ' } });
    assert.strictEqual(info.message, 'Ошибка');
  });
});
