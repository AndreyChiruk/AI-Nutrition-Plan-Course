import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BodyAnalysisService } from './body-analysis.service';
import { FullUserGuard } from '../auth/full-user.guard';
import { RequireSubscriptionGuard } from '../subscription/require-subscription.guard';

@Controller('body-analysis')
@UseGuards(JwtAuthGuard, ThrottlerGuard, FullUserGuard)
export class BodyAnalysisController {
  constructor(private readonly bodyAnalysisService: BodyAnalysisService) {}

  @Post('analyze')
  @UseGuards(RequireSubscriptionGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  analyze(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; photoUrl: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.bodyAnalysisService.uploadAndAnalyze(body.userId, body.photoUrl);
  }

  @Post('forecast')
  @UseGuards(RequireSubscriptionGuard)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  forecast(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; durationWeeks?: number },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.bodyAnalysisService.generateVisualForecast(body.userId, body.durationWeeks);
  }

  @Get('basic-recommendations/:userId')
  basicRecommendations(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.bodyAnalysisService.getBasicRecommendations(userId);
  }

  @Get('page-state/:userId')
  pageState(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.bodyAnalysisService.getPageState(userId);
  }
}
