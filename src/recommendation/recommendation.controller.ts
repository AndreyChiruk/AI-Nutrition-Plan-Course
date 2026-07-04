import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RecommendationService } from './recommendation.service';

@Controller('recommendations')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  @Get('base')
  getBaseRecommendations() {
    return this.recommendationService.getBaseRecommendations();
  }

  @Post('generate')
  @UseGuards(JwtAuthGuard)
  generate(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.recommendationService.generate(body.userId);
  }
}
