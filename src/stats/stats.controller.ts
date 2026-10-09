import { Controller, Get, Param, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StatsService } from './stats.service';
import { FullUserGuard } from '../auth/full-user.guard';

@Controller('stats')
@UseGuards(JwtAuthGuard, FullUserGuard)
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

  /**
   * Выгрузка статистики в CSV.
   *
   * Раньше эндпоинт не принимал пользователя и возвращал заглушку
   * `date,calories\n2026-01-01,1800` — одну и ту же для всех.
   * Теперь данные берутся из профиля, а доступ проверяется по JWT.
   */
  @Get('export/csv/:userId')
  async exportCsv(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    assertUserAccess(req.user, userId);
    const csv = await this.statsService.exportCsv(userId);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="stats-${userId}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    return csv;
  }

  /** Честный ответ о недоступности PDF вместо ссылки на несуществующий файл. */
  @Get('export/pdf/:userId')
  exportPdf(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.statsService.exportPdf(userId);
  }
}
