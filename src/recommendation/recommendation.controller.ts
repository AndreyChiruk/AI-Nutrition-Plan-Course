import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecommendationService } from './recommendation.service';
import { FullUserGuard } from '../auth/full-user.guard';
import { RequireSubscriptionGuard } from '../subscription/require-subscription.guard';
import { Throttle } from '@nestjs/throttler';

@Controller('recommendations')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  /*
   * Базовые рекомендации для конкретного пользователя.
   *
   * Раньше маршрут был публичным и без параметров: отдавал все записи,
   * а поле audience ни на что не влияло. Теперь по userId вычисляется
   * возраст и возвращаются только подходящие рекомендации.
   *
   * Доступ проверяется через assertUserAccess — чужой userId вернёт 403.
   */
  @Get('base/:userId')
  @UseGuards(JwtAuthGuard, FullUserGuard)
  getBaseRecommendations(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.recommendationService.getBaseRecommendations(userId);
  }

  @Post('generate')
  @UseGuards(JwtAuthGuard, FullUserGuard, RequireSubscriptionGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  generate(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.recommendationService.generate(body.userId);
  }
}
