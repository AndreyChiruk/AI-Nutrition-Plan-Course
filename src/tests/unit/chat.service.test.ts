import { NotFoundException } from '@nestjs/common';
import { assert } from 'chai';
import { describe, it } from 'mocha';
import { ChatService } from '../../chat/chat.service';

describe('ChatService модульные тесты', () => {
  it('sendMessage: выбрасывает исключение, если пользователь не найден', async () => {
    const chatMessageModel = {
      create: async () => ({}),
      findAll: async () => [],
    };
    const userModel = {
      findByPk: async () => null,
    };
    const openAiService = {
      generateChatReply: async () => 'reply',
    };
    const service = new ChatService(
      chatMessageModel as never,
      userModel as never,
      openAiService as never,
    );

    try {
      await service.sendMessage('10', 'Привет');
      assert.fail('Ожидалось исключение NotFoundException');
    } catch (error) {
      assert.instanceOf(error, NotFoundException);
    }
  });

  it('sendMessage: сохраняет сообщения и возвращает историю', async () => {
    const stored: Array<Record<string, unknown>> = [];
    const chatMessageModel = {
      create: async (payload: Record<string, unknown>) => {
        const message = {
          id: String(stored.length + 1),
          createdAt: new Date().toISOString(),
          ...payload,
        };
        stored.push(message);
        return message;
      },
      findAll: async () => stored,
    };
    const userModel = {
      findByPk: async () => ({
        id: 1,
        gender: 'male',
        goal: 'maintain',
        height: 180,
        weight: 80,
        birthDate: new Date('1995-01-01'),
        allergens: [{ name: 'nuts' }],
      }),
    };
    const openAiService = {
      generateChatReply: async () => 'Пейте воду и придерживайтесь графика питания.',
    };
    const service = new ChatService(
      chatMessageModel as never,
      userModel as never,
      openAiService as never,
    );

    const result = await service.sendMessage('1', 'Что улучшить в рационе?');

    assert.equal(stored.length, 2);
    assert.equal(stored[0].role, 'user');
    assert.equal(stored[1].role, 'assistant');
    assert.equal(result.history.length, 2);
  });
});
