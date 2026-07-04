import { Controller, Get, Param, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';

@Controller('stats')
@UseGuards(JwtAuthGuard)
export class StatsController {
  constructor(private readonly statsService: StatsService) {}

  @Get('progress/:userId')
  userProgress(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.statsService.userProgress(userId);
  }

  @Get('kbju/:userId')
  kbju(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.statsService.kbjuStats(userId);
  }

  @Get('plan-vs-fact/:userId')
  comparePlanVsFact(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.statsService.comparePlanVsFact(userId);
  }

  @Get('summary/:userId')
  userSummary(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.statsService.userStatsSummary(userId);
  }

  @Get('body-metrics/:userId')
  bodyMetrics(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.statsService.bodyMetricsTimeline(userId);
  }

  @Get('export/csv')
  exportCsv() {
    return this.statsService.exportCsv();
  }

  @Get('export/pdf')
  exportPdf() {
    return this.statsService.exportPdf();
  }
}
