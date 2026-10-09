import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты извлечения текста из ответа Responses API.
 *
 * Регрессия: код читал только поле `output_text`, которое есть в SDK
 * OpenAI. OpenRouter возвращает текст в `output[].content[]`, поэтому
 * ответ считался пустым — и все функции AI молча отдавали заглушки
 * вместо результата (анализ тела, распознавание еды, планы).
 *
 * Логика повторяет private-метод OpenAiService: проверить оба формата.
 */
function responsesOutputPlainText(output: unknown): string {
  if (!Array.isArray(output)) return '';
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    if (o.type !== 'message') continue;
    if (!Array.isArray(o.content)) continue;
    for (const part of o.content) {
      if (!part || typeof part !== 'object') continue;
      const p = part as Record<string, unknown>;
      if (p.type === 'output_text' && typeof p.text === 'string') chunks.push(p.text);
    }
  }
  return chunks.join('');
}

function responsesPlainText(response: unknown): string {
  const r = response as { output_text?: unknown; output?: unknown };
  if (typeof r?.output_text === 'string' && r.output_text.trim()) return r.output_text;
  return responsesOutputPlainText(r?.output);
}

describe('ответ AI: извлечение текста', () => {
  it('читает output_text (формат SDK OpenAI)', () => {
    assert.strictEqual(responsesPlainText({ output_text: 'привет' }), 'привет');
  });

  it('читает output[].content[] (формат OpenRouter)', () => {
    // Именно так отвечает OpenRouter — поля output_text там нет.
    const response = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Красный.' }] },
      ],
    };
    assert.strictEqual(responsesPlainText(response), 'Красный.');
  });

  it('склеивает несколько частей ответа', () => {
    const response = {
      output: [
        { type: 'message', content: [{ type: 'output_text', text: 'Часть 1. ' }] },
        { type: 'message', content: [{ type: 'output_text', text: 'Часть 2.' }] },
      ],
    };
    assert.strictEqual(responsesPlainText(response), 'Часть 1. Часть 2.');
  });

  it('предпочитает output_text, если он заполнен', () => {
    const response = {
      output_text: 'из поля',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'из массива' }] }],
    };
    assert.strictEqual(responsesPlainText(response), 'из поля');
  });

  it('игнорирует пустой output_text и читает массив', () => {
    const response = {
      output_text: '   ',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'из массива' }] }],
    };
    assert.strictEqual(responsesPlainText(response), 'из массива');
  });

  it('возвращает пустую строку для пустого ответа', () => {
    assert.strictEqual(responsesPlainText({ output: [] }), '');
    assert.strictEqual(responsesPlainText({}), '');
    assert.strictEqual(responsesPlainText(null), '');
    assert.strictEqual(responsesPlainText(undefined), '');
  });

  it('пропускает блоки без текста (reasoning, tool_call)', () => {
    const response = {
      output: [
        { type: 'reasoning', content: [] },
        { type: 'message', content: [{ type: 'output_text', text: 'Ответ' }] },
        { type: 'function_call', name: 'x' },
      ],
    };
    assert.strictEqual(responsesPlainText(response), 'Ответ');
  });

  it('устойчив к неожиданной структуре', () => {
    assert.strictEqual(responsesPlainText({ output: 'строка' }), '');
    assert.strictEqual(responsesPlainText({ output: [{ type: 'message' }] }), '');
    assert.strictEqual(responsesPlainText({ output: [{ type: 'message', content: 'нет' }] }), '');
  });
});
