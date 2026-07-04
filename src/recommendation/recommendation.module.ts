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

@Module({
  imports: [
    SequelizeModule.forFeature([Suggestion, User, Allergen, Meal, MealItem, BaseRecommendation]),
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
    OpenAiModule,
    UsersModule,
  ],
  controllers: [RecommendationController],
  providers: [RecommendationService, JwtAuthGuard],
})
export class RecommendationModule {}
