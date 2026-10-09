import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { FoodRecognitionItemDto } from './food-recognition.service';
import { FoodRecognitionService } from './food-recognition.service';
import { RequireSubscriptionGuard } from '../subscription/require-subscription.guard';

/**
 * Распознавание еды — платный вызов OpenAI.
 *
 * Глобальный лимит (100 запросов/мин) для этого не годится: один пользователь
 * мог отправить сотни фотографий подряд и израсходовать бюджет. Здесь
 * собственные, более строгие лимиты.
 */
@Controller('food-recognition')
@UseGuards(JwtAuthGuard, ThrottlerGuard)
export class FoodRecognitionController {
  constructor(private readonly foodRecognitionService: FoodRecognitionService) {}

  @Post('analyze')
  @UseGuards(RequireSubscriptionGuard)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  analyze(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; photoUrl: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.foodRecognitionService.previewRecognize(body.userId, body.photoUrl);
  }

  @Post('submit-meal')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  submitMeal(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body()
    body: {
      userId: string;
      photoUrl: string;
      confidence: number;
      items: FoodRecognitionItemDto[];
    },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.foodRecognitionService.submitMealForModeration(
      body.userId,
      body.photoUrl,
      body.confidence,
      body.items,
    );
  }
}
