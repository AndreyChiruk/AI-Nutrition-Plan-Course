/**
 * Модели для разных задач.
 *
 * OpenRouter требует формат `провайдер/модель`, поэтому идентификаторы
 * отличаются от «сырых» имён OpenAI: `openai/gpt-4o-mini` вместо
 * `gpt-4o-mini`. Без префикса запрос завершается ошибкой 400.
 *
 * Разделение по задачам нужно, чтобы можно было менять модель точечно:
 * распознавание еды по фото требует vision, генерация плана — больший
 * контекст, а чат должен быть дешёвым, потому что он самый частый.
 *
 * Все значения читаются из окружения с разумным значением по умолчанию,
 * поэтому приложение работает без дополнительной настройки.
 */

/** Значение по умолчанию для всех задач. */
const DEFAULT = 'openai/gpt-4o-mini';

function model(envKey: string): string {
  const value = process.env[envKey]?.trim();
  return value && value.length > 0 ? value : DEFAULT;
}

export const AI_MODELS = {
  /** Распознавание блюда по фотографии. Требуется поддержка vision. */
  FOOD_RECOGNITION: model('AI_MODEL_FOOD_RECOGNITION'),

  /** Генерация плана питания: длинный контекст, структурированный вывод. */
  PLAN_GENERATION: model('AI_MODEL_PLAN_GENERATION'),

  /** Анализ тела по фото и прогноз изменения фигуры. */
  BODY_ANALYSIS: model('AI_MODEL_BODY_ANALYSIS'),

  /** Персональные рекомендации. */
  RECOMMENDATIONS: model('AI_MODEL_RECOMMENDATIONS'),

  /** Диалог с ассистентом — самый частый вызов, модель дешёвая. */
  CHAT: model('AI_MODEL_CHAT'),

  /** Генерация изображений (план питания в виде картинки). */
  // Модель генерации изображений для прогноза фигуры.
  //
  // `openai/gpt-image-1` здесь не подходит: OpenRouter отвечает на неё
  // ошибкой «image generation model cannot be used with chat/completions»,
  // а эндпоинт /images недоступен (403 по региону). Поэтому по умолчанию
  // берём модель, которая принимает фото и текст через chat/completions.
  IMAGE: process.env['AI_MODEL_IMAGE']?.trim() || 'google/gemini-3.1-flash-image',
} as const;

export type AiModelKey = keyof typeof AI_MODELS;

/**
 * Добавляет префикс провайдера, если его нет.
 *
 * Нужно для совместимости: в существующем `.env` может остаться
 * значение без префикса (`gpt-4o-mini`), и тогда запрос к OpenRouter
 * упадёт. Здесь оно приводится к нужному виду автоматически.
 */
export function normalizeModelId(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value) return DEFAULT;
  // Уже есть префикс провайдера — оставляем как есть.
  if (value.includes('/')) return value;
  // Иначе считаем, что это модель OpenAI.
  return `openai/${value}`;
}
