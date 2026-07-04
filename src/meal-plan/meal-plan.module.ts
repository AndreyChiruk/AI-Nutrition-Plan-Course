import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { CatalogBootstrapService } from '../database/catalog-bootstrap.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RefBreakfastName } from '../models/RefBreakfastName';
import { RefDinnerName } from '../models/RefDinnerName';
import { RefDishModifier } from '../models/RefDishModifier';
import { RefGrainGarnish } from '../models/RefGrainGarnish';
import { RefLunchPair } from '../models/RefLunchPair';
import { RefLunchProtein } from '../models/RefLunchProtein';
import { RefSnack } from '../models/RefSnack';
import { MealPlanDay } from '../models/MealPlanDay';
import { MealPlan } from '../models/MealPlan';
import { Product } from '../models/Product';
import { TrainingBlock } from '../models/TrainingBlock';
import { User } from '../models/User';
import { FridgeItem } from '../models/FridgeItem';
import { OpenAiModule } from '../openai/openai.module';
import { DishCatalogBuilderService } from './dish-catalog.builder.service';
import { MealPlanController } from './meal-plan.controller';
import { MealPlanService } from './meal-plan.service';
import { PlansLibrarySeedService } from './plans-library.seed.service';

@Module({
  imports: [
    SequelizeModule.forFeature([
      MealPlan,
      MealPlanDay,
      User,
      FridgeItem,
      Product,
      TrainingBlock,
      RefDishModifier,
      RefBreakfastName,
      RefLunchPair,
      RefLunchProtein,
      RefGrainGarnish,
      RefDinnerName,
      RefSnack,
    ]),
    JwtModule.register({ secret: process.env.JWT_SECRET ?? 'dev-secret' }),
    OpenAiModule,
  ],
  controllers: [MealPlanController],
  providers: [CatalogBootstrapService, DishCatalogBuilderService, MealPlanService, JwtAuthGuard, PlansLibrarySeedService],
})
export class MealPlanModule {}
