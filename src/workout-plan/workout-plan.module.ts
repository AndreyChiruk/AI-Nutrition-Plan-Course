import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { TrainingBlock } from '../models/TrainingBlock';
import { User } from '../models/User';
import { WorkoutPlanDay } from '../models/WorkoutPlanDay';
import { WorkoutPlan } from '../models/WorkoutPlan';
import { WorkoutPlanController } from './workout-plan.controller';
import { WorkoutPlanService } from './workout-plan.service';

@Module({
  imports: [
    SequelizeModule.forFeature([WorkoutPlan, WorkoutPlanDay, User, TrainingBlock]),
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  controllers: [WorkoutPlanController],
  providers: [WorkoutPlanService, JwtAuthGuard],
})
export class WorkoutPlanModule {}
