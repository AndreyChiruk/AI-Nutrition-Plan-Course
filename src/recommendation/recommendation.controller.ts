import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
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

  @Get('base')
  getBaseRecommendations() {
    return this.recommendationService.getBaseRecommendations();
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
