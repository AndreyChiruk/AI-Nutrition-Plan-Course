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
import { resolveJwtSecret } from '../common/jwt.config';
import { FullUserGuard } from '../auth/full-user.guard';

@Module({
  imports: [
    SequelizeModule.forFeature([WorkoutPlan, WorkoutPlanDay, User, TrainingBlock]),
    JwtModule.register({ secret: resolveJwtSecret() }),
  ],
  controllers: [WorkoutPlanController],
  providers: [FullUserGuard, WorkoutPlanService, JwtAuthGuard],
})
export class WorkoutPlanModule {}
