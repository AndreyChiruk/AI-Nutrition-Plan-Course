import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Allergen } from '../models/Allergen';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { OpenAiModule } from '../openai/openai.module';
import { FoodRecognitionController } from './food-recognition.controller';
import { FoodRecognitionService } from './food-recognition.service';
import { resolveJwtSecret } from '../common/jwt.config';
import { Ingredient } from '../models/Ingredient';
import { NotificationsModule } from '../notifications/notifications.module';
import { SubscriptionModule } from '../subscription/subscription.module';

@Module({
  imports: [
    SubscriptionModule,
    OpenAiModule,
    SequelizeModule.forFeature([Meal, MealItem, User, Allergen, Product, Ingredient]),
    JwtModule.register({ secret: resolveJwtSecret() }),
    NotificationsModule,
  ],
  controllers: [FoodRecognitionController],
  providers: [FoodRecognitionService, JwtAuthGuard],
})
export class FoodRecognitionModule {}
