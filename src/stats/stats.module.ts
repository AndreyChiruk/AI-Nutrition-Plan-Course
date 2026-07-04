import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { BodyAnalysis } from '../models/BodyAnalysis';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { MealPlan } from '../models/MealPlan';
import { User } from '../models/User';
import { WorkoutPlan } from '../models/WorkoutPlan';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [
    SequelizeModule.forFeature([Meal, MealItem, MealPlan, WorkoutPlan, BodyAnalysis, User]),
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  controllers: [StatsController],
  providers: [StatsService, JwtAuthGuard],
})
export class StatsModule {}
