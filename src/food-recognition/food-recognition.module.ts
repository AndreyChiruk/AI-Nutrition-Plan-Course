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

@Module({
  imports: [
    OpenAiModule,
    SequelizeModule.forFeature([Meal, MealItem, User, Allergen, Product]),
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
  ],
  controllers: [FoodRecognitionController],
  providers: [FoodRecognitionService, JwtAuthGuard],
})
export class FoodRecognitionModule {}
