import { Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { SubscriptionService } from './subscription.service';

/**
 * Управление подпиской на ИИ-функции.
 *
 * Все эндпоинты требуют авторизации: подписка привязана к пользователю.
 * Публичного доступа здесь нет — состояние подписки это персональные данные.
 */
@Controller('subscription')
@UseGuards(JwtAuthGuard, RolesGuard)
export class SubscriptionController {
  constructor(private readonly subscription: SubscriptionService) {}

  /** Текущее состояние подписки для интерфейса. */
  @Get('status')
  status(@Req() req: Request & { user?: { sub?: number } }) {
    return this.subscription.snapshot(req.user?.sub ?? 0);
  }

  /**
   * Перепроверяет подписку напрямую в Stripe.
   *
   * Вызывается при возврате со страницы оплаты: вебхук может прийти
   * с задержкой или не прийти вовсе (например, если `stripe listen`
   * не запущен), а пользователь должен получить доступ сразу.
   */
  @Post('sync')
  sync(@Req() req: Request & { user?: { sub?: number } }) {
    return this.subscription.syncFromStripe(req.user?.sub ?? 0);
  }

  /** Создаёт сессию оплаты и возвращает ссылку на Stripe Checkout. */
  @Post('checkout')
  checkout(@Req() req: Request & { user?: { sub?: number } }) {
    return this.subscription.createCheckoutSession(req.user?.sub ?? 0);
  }

  /** Ссылка на портал управления подпиской. */
  @Post('portal')
  portal(@Req() req: Request & { user?: { sub?: number } }) {
    return this.subscription.createPortalSession(req.user?.sub ?? 0);
  }
}
