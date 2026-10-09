import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Allergen } from '../models/Allergen';
import { BaseRecommendation } from '../models/BaseRecommendation';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { Suggestion } from '../models/Suggestion';
import { User } from '../models/User';
import { OpenAiModule } from '../openai/openai.module';
import { RecommendationController } from './recommendation.controller';
import { RecommendationService } from './recommendation.service';
import { UsersModule } from '../users/users.module';
import { resolveJwtSecret } from '../common/jwt.config';
import { FullUserGuard } from '../auth/full-user.guard';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    SubscriptionModule,
    SequelizeModule.forFeature([Suggestion, User, Allergen, Meal, MealItem, BaseRecommendation]),
    JwtModule.register({ secret: resolveJwtSecret() }),
    OpenAiModule,
    UsersModule,
  ],
  controllers: [RecommendationController],
  providers: [FullUserGuard, RecommendationService, JwtAuthGuard],
})
export class RecommendationModule {}
