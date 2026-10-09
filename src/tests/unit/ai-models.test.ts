import { assert } from 'chai';
import { describe, it } from 'mocha';
import { AI_MODELS, normalizeModelId } from '../../config/ai-models';

/**
 * Тесты конфигурации AI-моделей.
 *
 * Проект переведён с прямого OpenAI на OpenRouter. Ключевое отличие:
 * OpenRouter требует формат `провайдер/модель`, поэтому «сырое» имя
 * `gpt-4o-mini` из старого `.env` привело бы к ошибке 400.
 */
describe('AI-модели: нормализация идентификатора', () => {
  it('добавляет префикс провайдера к имени без слэша', () => {
    // Старое значение из .env должно продолжать работать.
    assert.strictEqual(normalizeModelId('gpt-4o-mini'), 'openai/gpt-4o-mini');
    assert.strictEqual(normalizeModelId('gpt-4o'), 'openai/gpt-4o');
  });

  it('не трогает идентификатор с префиксом провайдера', () => {
    assert.strictEqual(normalizeModelId('openai/gpt-4o-mini'), 'openai/gpt-4o-mini');
    assert.strictEqual(normalizeModelId('anthropic/claude-3.5-sonnet'), 'anthropic/claude-3.5-sonnet');
    assert.strictEqual(normalizeModelId('google/gemini-flash-1.5'), 'google/gemini-flash-1.5');
  });

  it('пустое значение даёт модель по умолчанию', () => {
    assert.strictEqual(normalizeModelId(''), 'openai/gpt-4o-mini');
    assert.strictEqual(normalizeModelId('   '), 'openai/gpt-4o-mini');
  });

  it('обрезает пробелы', () => {
    assert.strictEqual(normalizeModelId('  openai/gpt-4o  '), 'openai/gpt-4o');
  });
});

describe('AI-модели: набор задач', () => {
  it('все задачи имеют модель в формате провайдер/модель', () => {
    for (const [key, value] of Object.entries(AI_MODELS)) {
      assert.isString(value);
      assert.isAbove(value.length, 0, `${key}: пустое значение`);
      assert.include(value, '/', `${key}: нужен префикс провайдера, получено «${value}»`);
    }
  });

  it('содержит все пять задач из ТЗ', () => {
    for (const key of [
      'FOOD_RECOGNITION',
      'PLAN_GENERATION',
      'BODY_ANALYSIS',
      'RECOMMENDATIONS',
      'CHAT',
    ] as const) {
      assert.property(AI_MODELS, key);
    }
  });

  it('модели по умолчанию совпадают у всех задач', () => {
    // Без переменных окружения все задачи используют одну модель —
    // это упрощает первый запуск.
    const defaults = [
      AI_MODELS.FOOD_RECOGNITION,
      AI_MODELS.PLAN_GENERATION,
      AI_MODELS.BODY_ANALYSIS,
      AI_MODELS.RECOMMENDATIONS,
      AI_MODELS.CHAT,
    ];
    assert.strictEqual(new Set(defaults).size, 1);
    assert.strictEqual(defaults[0], 'openai/gpt-4o-mini');
  });
});
