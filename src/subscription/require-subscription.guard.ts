import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';
import { SubscriptionService } from '../subscription/subscription.service';

/**
 * Проверяет, что у пользователя есть действующая подписка.
 *
 * Применяется к ИИ-эндпоинтам: анализ тела, генерация плана,
 * распознавание еды, рекомендации. Эти вызовы стоят денег, поэтому
 * без подписки они недоступны.
 *
 * Отвечает 402 Payment Required с кодом `subscription_required` —
 * интерфейс по нему показывает плашку с предложением оформить подписку,
 * а не общую ошибку.
 *
 * Гости не допускаются: у них нет записи о подписке.
 */
@Injectable()
export class RequireSubscriptionGuard implements CanActivate {
  constructor(private readonly subscription: SubscriptionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: { sub?: number; role?: string } }>();

    const userId = req.user?.sub;
    if (!userId) {
      throw new HttpException(
        { error: 'unauthorized', message: 'Требуется вход в систему.' },
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (await this.subscription.isActive(userId)) return true;

    throw new HttpException(
      {
        error: 'subscription_required',
        message:
          'Функция доступна по подписке. Оформите её в разделе «Профиль».',
      },
      HttpStatus.PAYMENT_REQUIRED,
    );
  }
}
