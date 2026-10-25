import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { MealPlanDay } from '../models/MealPlanDay';
import { MealPlan } from '../models/MealPlan';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { FridgeItem } from '../models/FridgeItem';
import { OpenAiModule } from '../openai/openai.module';
import { MealPlanController } from './meal-plan.controller';
import { MealPlanService } from './meal-plan.service';
import { PlansLibrarySeedService } from './plans-library.seed.service';
import { resolveJwtSecret } from '../common/jwt.config';
import { FullUserGuard } from '../auth/full-user.guard';
import { Ingredient } from '../models/Ingredient';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    SubscriptionModule,
    SequelizeModule.forFeature([
      MealPlan,
      MealPlanDay,
      User,
      FridgeItem,
      Product,
      Ingredient,
    ]),
    JwtModule.register({ secret: resolveJwtSecret() }),
    OpenAiModule,
  ],
  controllers: [MealPlanController],
  providers: [FullUserGuard, MealPlanService, JwtAuthGuard, PlansLibrarySeedService],
})
export class MealPlanModule {}
