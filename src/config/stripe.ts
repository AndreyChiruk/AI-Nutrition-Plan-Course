/**
 * Клиент Stripe.
 *
 * Работает только в тестовом режиме: ключ из `STRIPE_SECRET_KEY`
 * начинается с `sk_test_`. Live-ключи (`sk_live_`) намеренно
 * не поддерживаются на этом этапе — при попытке использовать
 * боевой ключ приложение сообщит об этом при старте.
 *
 * Настройка:
 *   STRIPE_SECRET_KEY      — секретный ключ (sk_test_...)
 *   STRIPE_WEBHOOK_SECRET  — секрет вебхука (whsec_...)
 *   STRIPE_PRICE_ID_MONTHLY — идентификатор цены подписки (price_...)
 *   APP_URL                — адрес приложения для success/cancel URL
 *
 * Документация: https://docs.stripe.com/api
 */
import Stripe from 'stripe';

const secretKey = process.env.STRIPE_SECRET_KEY?.trim() ?? '';

/** Задан ли ключ — используется для понятных сообщений об ошибке. */
export const isStripeConfigured = secretKey.length > 0;

/** Предупреждение, если подставлен боевой ключ. */
export const isLiveKey = secretKey.startsWith('sk_live_');

/**
 * Версия API не задаётся явно: используется та, что зашита в SDK.
 * При её ручном указании библиотека падает, если версия не совпадает
 * с ожидаемой, — а это ломает приложение при обновлении пакета.
 */
export const stripe = isStripeConfigured
  ? new Stripe(secretKey, {
      // Приложение работает с тестовым режимом: запросы без ключа
      // должны падать сразу, а не висеть в очереди.
      timeout: 20_000,
      maxNetworkRetries: 2,
    })
  : null;

/** Секрет вебхука — нужен для проверки подписи запроса. */
export const stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim() ?? '';

/** Идентификатор цены месячной подписки. */
export const stripePriceIdMonthly = process.env.STRIPE_PRICE_ID_MONTHLY?.trim() ?? '';

/** Публикуемый ключ — уходит на клиент. */
export const stripePublishableKey =
  process.env.STRIPE_PUBLISHABLE_KEY?.trim() ||
  process.env.STRIPE_PUBLISH_KEY?.trim() ||
  '';

/** Адрес приложения для редиректов после оплаты. */
export const appUrl = process.env.APP_URL?.trim() || 'http://localhost';

/**
 * Проверяет полноту настройки перед созданием сессии оплаты.
 * Возвращает текст ошибки или null, если всё готово.
 */
export function stripeConfigError(): string | null {
  if (!isStripeConfigured) return 'Платежи недоступны: не задан STRIPE_SECRET_KEY.';
  if (isLiveKey) return 'Платежи недоступны: используется боевой ключ, допустим только тестовый.';
  if (!stripePriceIdMonthly) {
    return 'Платежи недоступны: не задан STRIPE_PRICE_ID_MONTHLY.';
  }
  return null;
}
