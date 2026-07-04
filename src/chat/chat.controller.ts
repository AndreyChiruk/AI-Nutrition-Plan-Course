import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ChatService } from './chat.service';

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('history/:userId')
  getHistory(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.chatService.getHistory(userId);
  }

  @Post('message')
  sendMessage(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; message: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.chatService.sendMessage(body.userId, body.message);
  }
}
