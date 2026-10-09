/**
 * JSON-схемы для Structured Outputs OpenAI (`text.format` с `json_schema`).
 *
 * Зачем: раньше ответ модели парсился «на веру» — `extractModelJsonString`
 * вырезал JSON из свободного текста регуляркой, после чего значения
 * проверялись вручную. Модель могла вернуть текст вместо JSON, лишние
 * поля, числа строками или `null` там, где ожидается число, и это
 * приводило к 500 либо к «блюду» без калорий.
 *
 * Structured Outputs заставляет модель соблюдать схему на стороне API:
 * ответ гарантированно соответствует описанию, лишние поля запрещены
 * (`additionalProperties: false`), а все поля перечислены в `required`.
 *
 * Особенности формата, которые важно соблюсти:
 *   - все объекты обязаны иметь `additionalProperties: false`;
 *   - каждое свойство должно быть указано в `required`;
 *   - необязательность выражается через `type: ['string', 'null']`.
 */

/** Общая обёртка формата ответа для `responses.create`. */
export function jsonSchemaFormat(
  name: string,
  schema: Record<string, unknown>,
): { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict: true } {
  return { type: 'json_schema', name, schema, strict: true };
}

const ingredientSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'grams'],
  properties: {
    name: { type: 'string', description: 'Название ингредиента на русском' },
    grams: {
      type: ['number', 'null'],
      description: 'Масса в граммах, если определима; иначе null',
    },
  },
} as const;

const ingredientDetailedSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'grams', 'amount', 'unit'],
  properties: {
    name: { type: 'string' },
    grams: { type: ['number', 'null'] },
    amount: { type: ['number', 'null'] },
    unit: { type: ['string', 'null'], description: 'Единица измерения: г, шт, мл' },
  },
} as const;

/** Схема ответа распознавания еды по фото. */
export const FOOD_RECOGNITION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['confidence', 'items'],
  properties: {
    confidence: {
      type: 'number',
      description: 'Уверенность распознавания от 0 до 1',
    },
    items: {
      type: 'array',
      description: 'Распознанные блюда на фотографии',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'foodName',
          'calories',
          'protein',
          'fat',
          'carbs',
          'allergensFound',
          'dietaryTags',
          'ingredients',
          'ingredientsDetailed',
        ],
        properties: {
          foodName: { type: 'string', description: 'Название блюда на русском' },
          calories: { type: 'number' },
          protein: { type: 'number' },
          fat: { type: 'number' },
          carbs: { type: 'number' },
          allergensFound: {
            type: 'array',
            items: { type: 'string' },
            description: 'Обнаруженные аллергены',
          },
          dietaryTags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Подходящие диетические метки',
          },
          ingredients: { type: 'array', items: ingredientSchema },
          ingredientsDetailed: { type: 'array', items: ingredientDetailedSchema },
        },
      },
    },
  },
} as const;

/** Схема ответа анализа тела по фото. */
export const BODY_ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['bodyFatPercent', 'muscleMassPercent', 'notes'],
  properties: {
    bodyFatPercent: { type: ['number', 'null'] },
    muscleMassPercent: { type: ['number', 'null'] },
    notes: { type: 'string' },
  },
} as const;

/** Схема ответа прогноза по телу. */
export const BODY_FORECAST_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['summary', 'milestones'],
  properties: {
    summary: { type: 'string' },
    milestones: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['week', 'weightKg', 'note'],
        properties: {
          week: { type: 'number' },
          weightKg: { type: 'number' },
          note: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * Схема ответа генерации плана по каталогу.
 *
 * `dishNames` ограничивает выбор модели — она обязана вернуть названия
 * из каталога (проверяется отдельно в сервисе).
 */
export const MEAL_PLAN_CATALOG_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['days'],
  properties: {
    days: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'meals'],
        properties: {
          day: { type: 'number' },
          meals: {
            type: 'object',
            additionalProperties: false,
            required: ['breakfast', 'lunch', 'dinner', 'snack', 'snacks'],
            properties: {
              breakfast: { type: 'string' },
              lunch: { type: 'string' },
              dinner: { type: 'string' },
              snack: { type: 'string' },
              snacks: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  },
} as const;

/** Схема ответа нутрициологической рекомендации. */
export const NUTRITION_RECOMMENDATION_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'summary', 'recommendations'],
  properties: {
    title: { type: 'string' },
    summary: { type: 'string' },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'reason'],
        properties: {
          text: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;

/**
 * Схема правок конструктора плана.
 * Список изменений — модель предлагает точечные замены блюд.
 */
export const CONSTRUCTOR_REFINEMENT_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['changes', 'summary'],
  properties: {
    summary: { type: 'string' },
    changes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['day', 'slot', 'dishName', 'reason'],
        properties: {
          day: { type: 'number' },
          slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
          dishName: { type: 'string' },
          reason: { type: 'string' },
        },
      },
    },
  },
} as const;
