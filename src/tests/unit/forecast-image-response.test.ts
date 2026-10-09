import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты разбора ответа генерации изображения.
 *
 * Регрессия: прогноз фигуры вызывал OpenAI-эндпоинт `/images/edits`,
 * которого нет в OpenRouter — приходил 404, и изображение не создавалось.
 * Теперь запрос идёт через `chat/completions`, а картинка лежит в
 * `choices[0].message.images[0].image_url.url` как data URL.
 *
 * Логика повторяет private-метод OpenAiService.
 */
function extractForecastImage(completion: unknown): string {
  const c = completion as {
    choices?: Array<{ message?: { images?: Array<{ image_url?: { url?: string } }> } }>;
  };
  const url = c?.choices?.[0]?.message?.images?.[0]?.image_url?.url ?? '';
  return url.includes(',') ? url.slice(url.indexOf(',') + 1) : '';
}

describe('прогноз: разбор изображения из ответа', () => {
  it('извлекает base64 из data URL', () => {
    const response = {
      choices: [{ message: { images: [{ image_url: { url: 'data:image/png;base64,AAAA' } }] } }],
    };
    assert.strictEqual(extractForecastImage(response), 'AAAA');
  });

  it('корректно обрабатывает длинные данные', () => {
    const payload = 'x'.repeat(5000);
    const response = {
      choices: [{ message: { images: [{ image_url: { url: `data:image/png;base64,${payload}` } }] } }],
    };
    assert.strictEqual(extractForecastImage(response).length, 5000);
  });

  it('возвращает пустую строку, если изображений нет', () => {
    // Модель может вернуть только текст — это не ошибка формата.
    const response = { choices: [{ message: { content: 'текстовый ответ' } }] };
    assert.strictEqual(extractForecastImage(response), '');
  });

  it('устойчив к пустому ответу', () => {
    assert.strictEqual(extractForecastImage({}), '');
    assert.strictEqual(extractForecastImage(null), '');
    assert.strictEqual(extractForecastImage(undefined), '');
    assert.strictEqual(extractForecastImage({ choices: [] }), '');
    assert.strictEqual(extractForecastImage({ choices: [{ message: {} }] }), '');
  });

  it('не падает на URL без запятой', () => {
    const response = {
      choices: [{ message: { images: [{ image_url: { url: 'https://example.com/a.png' } }] } }],
    };
    assert.strictEqual(extractForecastImage(response), '');
  });
});
