/**
 * Центральный клиент OpenRouter.
 *
 * Проект переведён с прямых запросов к OpenAI на OpenRouter — единый
 * шлюз к разным моделям. Формат API совместим с OpenAI, поэтому
 * используется тот же пакет `openai` с подменённым `baseURL`;
 * менять библиотеку не требуется.
 *
 * Настройка:
 *   OPENROUTER_API_KEY  — ключ из https://openrouter.ai/keys
 *   OPENROUTER_BASE_URL — по умолчанию https://openrouter.ai/api/v1
 *   APP_URL             — адрес приложения, уходит в HTTP-Referer
 *
 * Заголовки `HTTP-Referer` и `X-Title` OpenRouter использует для
 * атрибуции запросов в статистике аккаунта. Они необязательны,
 * но без них запросы помечаются как анонимные.
 *
 * Документация: https://openrouter.ai/docs
 * Список моделей: https://openrouter.ai/models
 *
 * ВАЖНО: пакет `openai` остаётся зависимостью — он работает как
 * совместимый клиент. Удалять его нельзя.
 */
import OpenAI from 'openai';

/** Ключ берём из окружения; при отсутствии клиент не создаётся. */
const apiKey = process.env.OPENROUTER_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim();

/** Базовый адрес шлюза. */
export const OPENROUTER_BASE_URL =
  process.env.OPENROUTER_BASE_URL?.trim() || 'https://openrouter.ai/api/v1';

/** Адрес приложения для атрибуции запросов. */
const appUrl = process.env.APP_URL?.trim() || 'http://localhost';

/**
 * Инстанс клиента или `null`, если ключ не задан.
 *
 * `null` — намеренное решение: сервисы проверяют наличие клиента
 * и отдают понятную ошибку («AI недоступен: не задан ключ»),
 * вместо падения при старте приложения.
 */
export const openrouter: OpenAI | null = apiKey
  ? new OpenAI({
      baseURL: OPENROUTER_BASE_URL,
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': appUrl,
        // Заголовки HTTP обязаны быть ASCII. Кириллица здесь приводит
        // к ошибке «Cannot convert argument to a ByteString» ещё ДО
        // отправки запроса: fetch отвергает такое значение заголовка,
        // и все AI-вызовы падают, не дойдя до OpenRouter.
        'X-Title': process.env.APP_TITLE?.trim() || 'Meal Planner',
      },
      timeout: Number(process.env.OPENAI_TIMEOUT_MS ?? 20_000),
    })
  : null;

/** Задан ли ключ — используется для сообщений об ошибках. */
export const isOpenRouterConfigured = Boolean(apiKey);

/** Понятное сообщение об отсутствии ключа (для ответов API). */
export const OPENROUTER_MISSING_KEY_MESSAGE =
  'AI-функции недоступны: не задан OPENROUTER_API_KEY в настройках сервера.';
