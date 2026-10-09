import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { SequelizeModule } from '@nestjs/sequelize';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { resolveJwtSecret } from '../common/jwt.config';
import { AiChatUsage } from '../models/AiChatUsage';
import { Subscription } from '../models/Subscription';
import { User } from '../models/User';
import { SubscriptionController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';
import { StripeWebhookController } from './stripe-webhook.controller';

/**
 * Подписка на ИИ-функции.
 *
 * Модуль экспортирует `SubscriptionService`: его использует middleware
 * `RequireSubscriptionGuard`, который подключается в других модулях
 * (анализ тела, планы, распознавание еды, рекомендации, чат).
 */
@Module({
  imports: [
    SequelizeModule.forFeature([Subscription, AiChatUsage, User]),
    JwtModule.register({ secret: resolveJwtSecret() }),
  ],
  controllers: [SubscriptionController, StripeWebhookController],
  providers: [SubscriptionService, JwtAuthGuard, RolesGuard],
  exports: [SubscriptionService],
})
export class SubscriptionModule {}
