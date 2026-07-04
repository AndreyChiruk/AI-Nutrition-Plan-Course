import { Injectable, NotFoundException } from '@nestjs/common';
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
    const user = await this.userModel.findByPk(userId, {
      include: [Allergen],
      attributes: ['id', 'gender', 'goal', 'height', 'weight', 'birthDate'],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    await this.chatMessageModel.create({
      userId: Number(userId),
      role: 'user',
      content: text,
    } as never);

    const history = await this.chatMessageModel.findAll({
      where: { userId },
      order: [['createdAt', 'DESC']],
      limit: 20,
    });
    const chronological = history.reverse();
    const messages = chronological.map((item) => ({
      role: item.role,
      content: item.content,
    }));

    const assistantReply = await this.openAiService.generateChatReply({
      userProfile: {
        gender: user.gender,
        goal: user.goal,
        height: user.height,
        weight: user.weight,
        birthDate: user.birthDate,
        allergies: user.allergens?.map((a) => a.name) ?? [],
      },
      messages,
    });

    const assistantMessage = await this.chatMessageModel.create({
      userId: Number(userId),
      role: 'assistant',
      content: assistantReply,
    } as never);

    return {
      reply: assistantMessage,
      history: await this.getHistory(userId, 20),
    };
  }
}
