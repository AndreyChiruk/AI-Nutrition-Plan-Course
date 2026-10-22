import { Module } from '@nestjs/common';
import { SequelizeModule } from '@nestjs/sequelize';
import { LoggerModule } from './logger/logger.module';
import { UsersModule } from './users/users.module';
import { User } from './models/User';
import { Allergen } from './models/Allergen';
import { UserAllergy } from './models/UserAllergy';
import { Meal } from './models/Meal';
import { MealItem } from './models/MealItem';
import { MealPlan } from './models/MealPlan';
import { MealPlanDay } from './models/MealPlanDay';
import { BodyAnalysis } from './models/BodyAnalysis';
import { Suggestion } from './models/Suggestion';
import { PlatformStats } from './models/PlatformStats';
import { BaseRecommendation } from './models/BaseRecommendation';
import { Product } from './models/Product';
import { TrainingBlock } from './models/TrainingBlock';
import { WorkoutPlan } from './models/WorkoutPlan';
import { WorkoutPlanDay } from './models/WorkoutPlanDay';
import { ChatMessage } from './models/ChatMessage';
import { EmailVerificationCode } from './models/EmailVerificationCode';
import { RefDishModifier } from './models/RefDishModifier';
import { RefBreakfastName } from './models/RefBreakfastName';
import { RefLunchPair } from './models/RefLunchPair';
import { RefLunchProtein } from './models/RefLunchProtein';
import { RefGrainGarnish } from './models/RefGrainGarnish';
import { RefDinnerName } from './models/RefDinnerName';
import { RefSnack } from './models/RefSnack';
import { FridgeItem } from './models/FridgeItem';
import { Ingredient } from './models/Ingredient';
import { AiChatUsage } from './models/AiChatUsage';
import { Notification } from './models/Notification';
import { Subscription } from './models/Subscription';
import { AuthModule } from './auth/auth.module';
import { ThrottlerModule } from '@nestjs/throttler';
import { BodyAnalysisModule } from './body-analysis/body-analysis.module';
import { MealPlanModule } from './meal-plan/meal-plan.module';
import { WorkoutPlanModule } from './workout-plan/workout-plan.module';
import { FoodRecognitionModule } from './food-recognition/food-recognition.module';
import { HealthModule } from './health/health.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RecommendationModule } from './recommendation/recommendation.module';
import { AdminModule } from './admin/admin.module';
import { StatsModule } from './stats/stats.module';
import { ChatModule } from './chat/chat.module';
import { SubscriptionModule } from './subscription/subscription.module';

@Module({
    controllers: [],
    providers: [],
    imports: [
    HealthModule,
    NotificationsModule,
        ThrottlerModule.forRoot([
            {
                ttl: 60_000,
                limit: 100,
            },
        ]),
        SequelizeModule.forRoot({
            dialect: 'postgres',
            host: process.env.POSTGRES_HOST ?? 'localhost',
            port: parseInt(process.env.POSTGRES_PORT ?? '5432', 10),
            username: process.env.POSTGRES_USER ?? 'postgres',
            password: process.env.POSTGRES_PASSWORD ?? '12345678',
            database: process.env.POSTGRES_DB ?? 'course',
            synchronize: process.env.DB_AUTO_SYNC === '1',
            models: [
                User,
                Allergen,
                UserAllergy,
                Meal,
                MealItem,
                MealPlan,
                MealPlanDay,
                BodyAnalysis,
                Suggestion,
                PlatformStats,
                BaseRecommendation,
                Product,
                TrainingBlock,
                WorkoutPlan,
                WorkoutPlanDay,
                ChatMessage,
                EmailVerificationCode,
                RefDishModifier,
                RefBreakfastName,
                RefLunchPair,
                RefLunchProtein,
                RefGrainGarnish,
                RefDinnerName,
                RefSnack,
                FridgeItem,
                Ingredient,
                AiChatUsage,
                Notification,
                Subscription,
            ],
            autoLoadModels: true,
        }),
        LoggerModule,
        AuthModule,
        UsersModule,
        BodyAnalysisModule,
        MealPlanModule,
        WorkoutPlanModule,
        FoodRecognitionModule,
        RecommendationModule,
        ChatModule,
        SubscriptionModule,
        AdminModule,
        StatsModule,
    ],
})
export class AppModule {}
