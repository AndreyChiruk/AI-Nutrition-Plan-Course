import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  SaveWorkoutDayDto,
  WorkoutPlanService,
  WorkoutSessionKey,
} from './workout-plan.service';

@Controller('workout-plan')
@UseGuards(JwtAuthGuard)
export class WorkoutPlanController {
  constructor(private readonly workoutPlanService: WorkoutPlanService) {}

  @Get('blocks')
  listBlocks(
    @Query('slot') slot?: 'session1' | 'session2' | 'session3' | 'session4',
  ) {
    return this.workoutPlanService.listBlocks(slot);
  }

  @Post('generate')
  generate(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; durationDays: number },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.workoutPlanService.generatePlan(body.userId, body.durationDays);
  }

  @Post('save')
  save(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; durationDays: number; days: SaveWorkoutDayDto[]; name?: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.workoutPlanService.saveUserPlan(body.userId, body);
  }

  @Get('active/:userId')
  getActive(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.workoutPlanService.getActivePlan(userId);
  }

  @Get('plans/:userId')
  listPlans(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.workoutPlanService.listUserPlans(userId);
  }

  @Get('plans/:userId/:planId')
  getPlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('planId') planId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.workoutPlanService.getPlanById(userId, planId);
  }

  @Delete('plans/:userId/:planId')
  removePlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('planId') planId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.workoutPlanService.deletePlan(userId, planId);
  }

  @Post('plans/:userId/:planId/clone')
  clonePlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('planId') planId: string,
    @Body() body: { startDate?: string },
  ) {
    assertUserAccess(req.user, userId);
    return this.workoutPlanService.clonePlan(userId, planId, body?.startDate);
  }

  @Post('plans/activate')
  activate(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; planId: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.workoutPlanService.activatePlan(body.userId, body.planId);
  }

  @Post('plans/tracking-start')
  startTracking(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; planId: string },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.workoutPlanService.startTracking(body.userId, body.planId);
  }

  @Post('plans/tracking-complete')
  completeTracking(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; planId: string; early?: boolean },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.workoutPlanService.completeTracking(body.userId, body.planId, body.early === true);
  }

  @Patch('plans/:userId/days/:dayId/sessions')
  patchDaySessions(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('dayId') dayId: string,
    @Body() body: Partial<Record<WorkoutSessionKey, 'done' | 'skipped' | null>>,
  ) {
    assertUserAccess(req.user, userId);
    return this.workoutPlanService.updateDaySessionStatuses(userId, dayId, body);
  }
}
