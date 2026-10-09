import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { assertUserAccess } from '../auth/request-access.util';
import { NotificationsService } from './notifications.service';
import type { NotificationType } from '../models/Notification';
import { FullUserGuard } from '../auth/full-user.guard';

type AuthedRequest = { user?: { sub?: string | number; id?: string | number } };

const TYPES = new Set<NotificationType>(['allergen', 'moderation', 'plan', 'system']);

@Controller('notifications')
@UseGuards(JwtAuthGuard, FullUserGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  /** Список уведомлений пользователя + счётчик непрочитанных. */
  @Get(':userId')
  async list(
    @Req() req: AuthedRequest,
    @Param('userId') userId: string,
    @Query('onlyUnread') onlyUnread?: string,
    @Query('type') type?: string,
    @Query('limit') limit?: string,
  ) {
    assertUserAccess(req.user, userId);
    const parsedType =
      type && TYPES.has(type as NotificationType) ? (type as NotificationType) : undefined;
    return this.notifications.list(Number(userId), {
      onlyUnread: onlyUnread === 'true' || onlyUnread === '1',
      type: parsedType,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Patch(':userId/read-all')
  async markAllRead(@Req() req: AuthedRequest, @Param('userId') userId: string) {
    assertUserAccess(req.user, userId);
    return this.notifications.markAllRead(Number(userId));
  }

  @Patch(':userId/:id/read')
  async markRead(
    @Req() req: AuthedRequest,
    @Param('userId') userId: string,
    @Param('id') id: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.notifications.markRead(Number(userId), id);
  }

  @Delete(':userId/:id')
  async remove(
    @Req() req: AuthedRequest,
    @Param('userId') userId: string,
    @Param('id') id: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.notifications.remove(Number(userId), id);
  }
}
