import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Request } from 'express';
import { assertUserAccess } from '../auth/request-access.util';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MealPlanService, SaveMealPlanDayDto } from './meal-plan.service';
import { MealTrackSlot, MealTrackStatus } from '../models/MealPlanDay';

@Controller('meal-plan')
@UseGuards(JwtAuthGuard)
export class MealPlanController {
  constructor(private readonly mealPlanService: MealPlanService) {}

  @Get('dishes')
  listDishes(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Query('category') category?: 'breakfast' | 'lunch' | 'dinner' | 'snack',
    @Query('search') search?: string,
    @Query('excludeAllergens') excludeAllergens?: string,
    @Query('userId') userId?: string,
  ) {
    if (userId) assertUserAccess(req.user, userId);
    return this.mealPlanService.listDishes({ category, search, excludeAllergens, userId });
  }

  @Post('generate')
  generate(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body()
    body: {
      userId: string;
      durationDays: number;
      targetCalories?: number;
      calorieMode?: 'precise' | 'approximate';
      calorieBand?: 'low' | 'medium' | 'high' | 'sport';
    },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.generatePlan(body.userId, body.durationDays, {
      targetCalories: body.targetCalories,
      calorieMode: body.calorieMode,
      calorieBand: body.calorieBand,
    });
  }

  @Post('generate-auto')
  generateAuto(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body()
    body: {
      userId: string;
      durationDays: number;
      targetCalories?: number;
      calorieMode?: 'precise' | 'approximate';
      calorieBand?: 'low' | 'medium' | 'high' | 'sport';
    },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.generatePlan(body.userId, body.durationDays, {
      targetCalories: body.targetCalories,
      calorieMode: body.calorieMode,
      calorieBand: body.calorieBand,
    });
  }

  @Post('save')
  save(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body()
    body: {
      userId: string;
      durationDays: number;
      targetCalories: number;
      days: SaveMealPlanDayDto[];
      name?: string;
    },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.saveUserPlan(body.userId, body);
  }

  @Get('active/:userId')
  getActive(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.mealPlanService.getActivePlan(userId);
  }

  @Get('plans/:userId')
  listPlans(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.mealPlanService.listUserPlans(userId);
  }

  @Get('plans/:userId/:planId')
  getPlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('planId') planId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.mealPlanService.getPlanById(userId, planId);
  }

  @Delete('plans/:userId/:planId')
  deletePlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('planId') planId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.mealPlanService.deletePlan(userId, planId);
  }

  @Post('plans/:userId/:planId/clone')
  clonePlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('planId') planId: string,
    @Body() body: { startDate?: string },
  ) {
    assertUserAccess(req.user, userId);
    return this.mealPlanService.clonePlan(userId, planId, body?.startDate);
  }

  @Post('plans/:userId/:planId/activate')
  activatePlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('planId') planId: string,
  ) {
    assertUserAccess(req.user, userId);
    return this.mealPlanService.activatePlan(userId, planId);
  }

  @Post('plans/:userId/days/:dayId/meals')
  patchMealStatuses(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Param('userId') userId: string,
    @Param('dayId') dayId: string,
    @Body() body: Partial<Record<MealTrackSlot, MealTrackStatus | null>>,
  ) {
    assertUserAccess(req.user, userId);
    return this.mealPlanService.updateDayMealStatuses(userId, dayId, body);
  }

  @Get('plans/:userId/:planId/download')
  async downloadPlan(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Res() res: Response,
    @Param('userId') userId: string,
    @Param('planId') planId: string,
    @Query('format') format?: string,
  ) {
    assertUserAccess(req.user, userId);
    const payload = await this.mealPlanService.planDownloadPayload(userId, planId);
    if (format === 'json' || !format) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="meal-plan-${planId}.json"`);
      return res.send(JSON.stringify(payload, null, 2));
    }
    return res.status(400).json({ message: 'Supported format: json' });
  }

  @Post('duration')
  changeDuration(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; durationDays: number },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.changeDuration(body.userId, body.durationDays);
  }

  @Post('generate-ai-catalog')
  generateAiCatalog(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; durationDays: number; targetCalories?: number },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.generateAiPlan(body.userId, body.durationDays, {
      targetCalories: body.targetCalories,
    });
  }

  @Post('refine-constructor-ai')
  refineConstructorAi(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body()
    body: {
      userId: string;
      targetCalories: number;
      days: SaveMealPlanDayDto[];
      auditHint?: string;
    },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.refineConstructorPlanWithAi(body.userId, {
      targetCalories: body.targetCalories,
      days: body.days,
      auditHint: body.auditHint,
    });
  }
}
