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
import { ChatMessage } from './models/ChatMessage';
import { EmailVerificationCode } from './models/EmailVerificationCode';
import { FridgeItem } from './models/FridgeItem';
import { Ingredient } from './models/Ingredient';
import { AiChatUsage } from './models/AiChatUsage';
import { Subscription } from './models/Subscription';
import { AuthModule } from './auth/auth.module';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { BodyAnalysisModule } from './body-analysis/body-analysis.module';
import { MealPlanModule } from './meal-plan/meal-plan.module';
import { FoodRecognitionModule } from './food-recognition/food-recognition.module';
import { HealthModule } from './health/health.module';
import { RecommendationModule } from './recommendation/recommendation.module';
import { AdminModule } from './admin/admin.module';
import { StatsModule } from './stats/stats.module';
import { ChatModule } from './chat/chat.module';
import { SubscriptionModule } from './subscription/subscription.module';

@Module({
    controllers: [],
    providers: [
        {
            provide: APP_GUARD,
            useClass: ThrottlerGuard,
        },
    ],
    imports: [
        HealthModule,
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
                ChatMessage,
                EmailVerificationCode,
                FridgeItem,
                Ingredient,
                AiChatUsage,
                Subscription,
            ],
            autoLoadModels: true,
        }),
        LoggerModule,
        AuthModule,
        UsersModule,
        BodyAnalysisModule,
        MealPlanModule,
        FoodRecognitionModule,
        RecommendationModule,
        ChatModule,
        SubscriptionModule,
        AdminModule,
        StatsModule,
    ],
})
export class AppModule {}
