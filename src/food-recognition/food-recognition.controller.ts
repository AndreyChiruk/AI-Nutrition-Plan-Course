import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import type { FoodRecognitionItemDto } from './food-recognition.service';
import { FoodRecognitionService } from './food-recognition.service';

@Controller('food-recognition')
@UseGuards(JwtAuthGuard)
export class FoodRecognitionController {
  constructor(private readonly foodRecognitionService: FoodRecognitionService) {}

  @Post('analyze')
  analyze(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; photoUrl: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.foodRecognitionService.previewRecognize(body.userId, body.photoUrl);
  }

  @Post('submit-meal')
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
