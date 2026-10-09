import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { PlatformStats } from '../models/PlatformStats';
import { User } from '../models/User';
import { BaseRecommendation } from '../models/BaseRecommendation';
import { Product } from '../models/Product';
import { MealPlanDay } from '../models/MealPlanDay';
import { Ingredient } from '../models/Ingredient';
import { OpenAiModule } from '../openai/openai.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { OpenAiBillingService } from './openai-billing.service';
import { resolveJwtSecret } from '../common/jwt.config';
import { MealPlan } from '../models/MealPlan';

@Module({
  imports: [
    SequelizeModule.forFeature([User, Meal, MealItem, PlatformStats, BaseRecommendation, Product, MealPlanDay, Ingredient, MealPlan]),
    JwtModule.register({ secret: resolveJwtSecret() }),
    OpenAiModule,
  ],
  controllers: [AdminController],
  providers: [AdminService, OpenAiBillingService, JwtAuthGuard, AdminGuard],
})
export class AdminModule {}
