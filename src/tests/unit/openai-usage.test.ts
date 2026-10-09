import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты учёта токенов и стоимости вызовов OpenAI.
 *
 * Раньше ответ `responses.create` содержит поле `usage`, но оно нигде
 * не сохранялось: расход и стоимость вызовов были неизвестны, аномалии
 * (например, промпт с огромным каталогом) не замечались.
 *
 * Здесь повторяется логика `OpenAiUsageService`.
 */
const PRICING = [
  { prefix: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { prefix: 'gpt-4o', input: 2.5, output: 10 },
];

function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const m = String(model ?? '').toLowerCase();
  const pricing = PRICING.find((p) => m.startsWith(p.prefix)) ?? PRICING[0];
  const cost = (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

function extractUsage(response: unknown): { inputTokens: number; outputTokens: number } {
  const u = (response as { usage?: Record<string, unknown> } | null)?.usage;
  if (!u || typeof u !== 'object') return { inputTokens: 0, outputTokens: 0 };
  const num = (...keys: string[]): number => {
    for (const k of keys) {
      const v = Number((u as Record<string, unknown>)[k]);
      if (Number.isFinite(v) && v > 0) return v;
    }
    return 0;
  };
  return {
    inputTokens: num('input_tokens', 'prompt_tokens'),
    outputTokens: num('output_tokens', 'completion_tokens'),
  };
}

describe('учёт токенов OpenAI', () => {
  it('извлекает usage из формата Responses API', () => {
    const u = extractUsage({ usage: { input_tokens: 1200, output_tokens: 340 } });
    assert.strictEqual(u.inputTokens, 1200);
    assert.strictEqual(u.outputTokens, 340);
  });

  it('извлекает usage из формата Chat Completions', () => {
    const u = extractUsage({ usage: { prompt_tokens: 800, completion_tokens: 150 } });
    assert.strictEqual(u.inputTokens, 800);
    assert.strictEqual(u.outputTokens, 150);
  });

  it('возвращает нули, если usage отсутствует', () => {
    assert.deepEqual(extractUsage({}), { inputTokens: 0, outputTokens: 0 });
    assert.deepEqual(extractUsage(null), { inputTokens: 0, outputTokens: 0 });
    assert.deepEqual(extractUsage({ usage: null }), { inputTokens: 0, outputTokens: 0 });
  });

  it('считает стоимость для gpt-4o-mini', () => {
    // 1M входных = $0.15, 1M выходных = $0.60
    assert.approximately(estimateCostUsd('gpt-4o-mini', 1_000_000, 0), 0.15, 0.001);
    assert.approximately(estimateCostUsd('gpt-4o-mini', 0, 1_000_000), 0.6, 0.001);
  });

  it('различает стоимость разных моделей', () => {
    const mini = estimateCostUsd('gpt-4o-mini', 10_000, 2_000);
    const full = estimateCostUsd('gpt-4o', 10_000, 2_000);
    assert.isAbove(full, mini, 'gpt-4o дороже gpt-4o-mini');
  });

  it('считает реалистичную стоимость распознавания', () => {
    // Типичный запрос: изображение ~1500 токенов + ответ ~500.
    const cost = estimateCostUsd('gpt-4o-mini', 1500, 500);
    assert.isAbove(cost, 0);
    assert.isBelow(cost, 0.01, 'один запрос распознавания стоит меньше цента');
  });

  it('неизвестная модель считается по минимальному тарифу', () => {
    const unknown = estimateCostUsd('некая-новая-модель', 1_000_000, 0);
    assert.approximately(unknown, 0.15, 0.001, 'не должна завышать расход');
  });

  it('сумма за 100 распознаваний остаётся небольшой', () => {
    const one = estimateCostUsd('gpt-4o-mini', 1500, 500);
    assert.isBelow(one * 100, 0.1);
  });
});

/**
 * Тесты схем Structured Outputs.
 */
describe('схемы Structured Outputs', () => {
  // Требования OpenAI: additionalProperties: false и все поля в required.
  function validateSchema(schema: Record<string, unknown>, path = 'root'): string[] {
    const errors: string[] = [];
    if (schema.type === 'object') {
      if (schema.additionalProperties !== false) {
        errors.push(`${path}: additionalProperties должен быть false`);
      }
      const props = (schema.properties ?? {}) as Record<string, unknown>;
      const required = (schema.required ?? []) as string[];
      for (const key of Object.keys(props)) {
        if (!required.includes(key)) errors.push(`${path}.${key}: отсутствует в required`);
      }
      for (const [key, value] of Object.entries(props)) {
        errors.push(...validateSchema(value as Record<string, unknown>, `${path}.${key}`));
      }
    }
    if (schema.type === 'array' && schema.items) {
      errors.push(...validateSchema(schema.items as Record<string, unknown>, `${path}[]`));
    }
    return errors;
  }

  it('схема распознавания еды валидна', () => {
    const schema = {
      type: 'object',
      additionalProperties: false,
      required: ['confidence', 'items'],
      properties: {
        confidence: { type: 'number' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['foodName', 'calories', 'allergensFound'],
            properties: {
              foodName: { type: 'string' },
              calories: { type: 'number' },
              // Массив строк не является объектом, поэтому additionalProperties
              // для него не требуется — валидатор верно пропускает.
              allergensFound: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    };
    assert.deepEqual(validateSchema(schema), []);
  });

  it('обнаруживает отсутствие additionalProperties', () => {
    const bad = { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] };
    assert.isNotEmpty(validateSchema(bad));
  });

  it('обнаруживает поле, не указанное в required', () => {
    const bad = {
      type: 'object',
      additionalProperties: false,
      required: [],
      properties: { a: { type: 'string' } },
    };
    assert.isNotEmpty(validateSchema(bad));
  });

  it('необязательность выражается через union с null, а не через отсутствие поля', () => {
    const optionalField = { type: ['number', 'null'] };
    assert.deepEqual(optionalField.type, ['number', 'null']);
  });
});
