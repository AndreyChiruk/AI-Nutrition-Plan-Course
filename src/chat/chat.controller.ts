import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';
import { FullUserGuard } from '../auth/full-user.guard';
import {
  FREE_CHAT_MESSAGES_PER_DAY,
  SubscriptionService,
} from '../subscription/subscription.service';

@Controller('chat')
@UseGuards(JwtAuthGuard, FullUserGuard)
export class ChatController {
  constructor(
    private readonly chatService: ChatService,
    private readonly subscription: SubscriptionService,
  ) {}

  @Get('history/:userId')
  getHistory(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.chatService.getHistory(userId);
  }

  /**
   * Отправка сообщения ассистенту.
   *
   * Подписка снимает ограничения. Без подписки доступно
   * `FREE_CHAT_MESSAGES_PER_DAY` сообщений в день: чат — самый частый
   * вызов модели, и без лимита расходы не контролируются.
   *
   * Лимит расходуется ДО обращения к модели: иначе при ошибке API
   * счётчик не увеличивался бы, и пользователь мог слать запросы
   * бесконечно.
   */
  @Post('message')
  async sendMessage(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; message: string },
  ) {
    assertUserAccess(req.user, body.userId);

    const gate = await this.subscription.consumeChatMessage(body.userId);
    if (!gate.allowed) {
      throw new HttpException(
        {
          error: 'chat_limit_reached',
          message:
            `Бесплатных сообщений на сегодня не осталось (${FREE_CHAT_MESSAGES_PER_DAY} в день). ` +
            'Оформите подписку, чтобы общаться без ограничений.',
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const reply = await this.chatService.sendMessage(body.userId, body.message);
    // `left` = -1 означает «без ограничений» (активная подписка).
    return { ...reply, messagesLeft: gate.left };
  }
}
