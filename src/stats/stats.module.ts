import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BodyAnalysis } from '../models/BodyAnalysis';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { MealPlan } from '../models/MealPlan';
import { User } from '../models/User';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';
import { resolveJwtSecret } from '../common/jwt.config';
import { FullUserGuard } from '../auth/full-user.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([Meal, MealItem, MealPlan, BodyAnalysis, User]),
    JwtModule.register({ secret: resolveJwtSecret() }),
  ],
  controllers: [StatsController],
  providers: [FullUserGuard, StatsService, JwtAuthGuard],
})
export class StatsModule {}
