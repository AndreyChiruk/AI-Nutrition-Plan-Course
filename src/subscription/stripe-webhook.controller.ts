import {
  BadRequestException,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  InternalServerErrorException,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import type { RawBodyRequest } from '@nestjs/common';
import type Stripe from 'stripe';
import { stripe, stripeWebhookSecret } from '../config/stripe';
import { SubscriptionService, redactSecrets } from './subscription.service';

/**
 * Приём событий Stripe.
 *
 * Контроллер намеренно не использует `JwtAuthGuard`: запросы приходят
 * от Stripe, а не от пользователя. Подлинность подтверждается подписью
 * (`stripe-signature`), поэтому тело запроса обязано быть СЫРЫМ.
 *
 * Тело приходит как Buffer — это настроено в `main.ts` через
 * `rawBody: true`. Если бы применялся `express.json()`, подпись
 * не совпала бы, потому что JSON был бы уже разобран.
 *
 * Всегда возвращаем 200, если событие корректно подписано, даже если
 * оно нас не касается: иначе Stripe будет повторять доставку.
 */
@Controller('stripe')
export class StripeWebhookController {
  private readonly logger = new Logger(StripeWebhookController.name);

  constructor(private readonly subscription: SubscriptionService) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async handle(
    @Req() req: RawBodyRequest<Request>,
    @Headers('stripe-signature') signature?: string,
  ): Promise<{ received: boolean }> {
    if (!stripe || !stripeWebhookSecret) {
      throw new BadRequestException(
        'Вебхуки недоступны: не заданы STRIPE_SECRET_KEY или STRIPE_WEBHOOK_SECRET.',
      );
    }
    if (!signature) {
      throw new BadRequestException('Отсутствует заголовок stripe-signature.');
    }

    const raw = req.rawBody;
    if (!raw || raw.length === 0) {
      throw new BadRequestException(
        'Пустое тело запроса: требуется rawBody (проверьте настройку main.ts).',
      );
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(raw, signature, stripeWebhookSecret);
    } catch (e) {
      // Подпись не совпала — запрос мог быть подделан. Отвечаем 400,
      // чтобы Stripe не считал событие доставленным.
      // Может содержать секрет вебхука — в лог только после маскировки.
      this.logger.warn(`Подпись вебхука не подтверждена: ${redactSecrets(String(e))}`);
      throw new BadRequestException('Подпись вебхука не подтверждена.');
    }

    // Логируем каждое событие с ключевыми полями: без этого непонятно,
    // дошёл ли вебхук и что именно в нём пришло.
    const obj = event.data.object as {
      customer?: string | null;
      subscription?: string | null;
      status?: string;
      metadata?: Record<string, string> | null;
    };
    this.logger.log(
      `[stripe] событие ${event.type}: customer=${obj.customer ?? '—'} ` +
        `subscription=${obj.subscription ?? '—'} status=${obj.status ?? '—'} ` +
        `userId=${obj.metadata?.userId ?? '—'}`,
    );

    try {
      const applied = await this.subscription.applyStripeEvent(event);
      this.logger.log(
        `Событие ${event.type}: ${applied ? 'применено' : 'пропущено (нет подписки)'}`,
      );
    } catch (e) {
      this.logger.error(`Не удалось обработать ${event.type}: ${redactSecrets(String(e))}`);
      throw new InternalServerErrorException('Ошибка обработки события Stripe.');
    }

    return { received: true };
  }
}
