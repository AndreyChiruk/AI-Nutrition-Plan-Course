import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Allergen } from '../models/Allergen';
import { ChatMessage } from '../models/ChatMessage';
import { User } from '../models/User';
import { OpenAiService } from '../openai/openai.service';

@Injectable()
export class ChatService {
  constructor(
    @InjectModel(ChatMessage)
    private readonly chatMessageModel: typeof ChatMessage,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly openAiService: OpenAiService,
  ) {}

  async getHistory(userId: string, limit = 20) {
    return this.chatMessageModel.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit,
    });
  }

  async sendMessage(userId: string, text: string) {
    // Выбираем поля, влияющие на рекомендации. Раньше здесь не было
    // dietaryRestrictions, foodLikes/foodDislikes и foodHabits, поэтому
    // ассистент не знал о диете пользователя и мог посоветовать ему
    // запрещённые продукты (например, яйца при веганстве).
    const user = await this.userModel.findByPk(userId, {
      include: [Allergen],
      attributes: [
        'id',
        'name',
        'gender',
        'goal',
        'height',
        'weight',
        'birthDate',
        'dietaryRestrictions',
        'foodLikes',
        'foodDislikes',
        'foodHabits',
      ],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const question = String(text ?? '').trim();
    if (!question) {
      throw new BadRequestException('Сообщение не должно быть пустым');
    }

    const history = await this.chatMessageModel.findAll({
      where: { userId: Number(userId) },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    const chronological = history.reverse();
    const messages = [
      ...chronological.map((item) => ({
        role: item.role,
        content: item.content,
      })),
      { role: 'user' as const, content: question },
    ];

    const assistantReply = await this.openAiService.generateChatReply({
      userProfile: {
        gender: user.gender,
        goal: user.goal,
        height: user.height,
        weight: user.weight,
        birthDate: user.birthDate,
        allergies: user.allergens?.map((a) => a.name) ?? [],
        dietaryRestrictions: (user.dietaryRestrictions ?? []).filter(Boolean),
        foodLikes: (user.foodLikes ?? []).filter(Boolean),
        foodDislikes: (user.foodDislikes ?? []).filter(Boolean),
        foodHabits: (user.foodHabits ?? {}) as Record<string, unknown>,
      },
      messages,
    });

    // Защита от пустого ответа: модель может вернуть пустую строку или null
    // (например, при сбое сети), а колонка `content` объявлена NOT NULL —
    // раньше это приводило к 500 «ChatMessage.content cannot be null».
    const safeReply =
      String(assistantReply ?? '').trim() ||
      'Не удалось получить ответ. Попробуйте повторить вопрос позже.';

    await this.chatMessageModel.create({
      userId: Number(userId),
      role: 'user',
      content: question,
    } as never);

    const assistantMessage = await this.chatMessageModel.create({
      userId: Number(userId),
      role: 'assistant',
      content: safeReply,
    } as never);

    return {
      reply: assistantMessage,
      history: await this.getHistory(userId, 20),
    };
  }
}
