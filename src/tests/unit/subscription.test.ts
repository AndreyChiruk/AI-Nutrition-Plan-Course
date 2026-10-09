import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  isSubscriptionActive,
  type SubscriptionStatus,
} from '../../models/Subscription';
import { FREE_CHAT_MESSAGES_PER_DAY } from '../../subscription/subscription.service';

/**
 * Тесты логики подписки.
 *
 * Ключевой момент — метод `isActive()`: одного статуса `active`
 * недостаточно. Stripe может не прислать вебхук об окончании периода
 * (например, при сбое доставки), поэтому дополнительно проверяется
 * дата окончания оплаченного периода.
 */
/** Проверка активности: обёртка над чистой функцией. */
function make(status: SubscriptionStatus, periodEnd: Date | null): boolean {
  return isSubscriptionActive(status, periodEnd);
}

const FUTURE = new Date(Date.now() + 7 * 86_400_000);
const PAST = new Date(Date.now() - 86_400_000);

describe('подписка: проверка активности', () => {
  it('активна при статусе active и будущей дате', () => {
    assert.isTrue(make('active', FUTURE));
  });

  it('trialing считается активной', () => {
    assert.isTrue(make('trialing', FUTURE));
  });

  it('истёкший период делает подписку неактивной', () => {
    // Статус всё ещё `active`, но период закончился — доступ закрыт.
    assert.isFalse(make('active', PAST));
  });

  it('без даты окончания полагаемся на статус', () => {
    assert.isTrue(make('active', null));
  });

  it('неактивные статусы закрывают доступ', () => {
    for (const status of ['none', 'canceled', 'past_due', 'unpaid', 'incomplete'] as const) {
      assert.isFalse(make(status, FUTURE), `«${status}» не должен давать доступ`);
    }
  });

  it('дата окончания принимается строкой из БД', () => {
    // Sequelize может вернуть дату строкой — сравнение должно работать.
    const future = new Date(Date.now() + 86_400_000).toISOString();
    assert.isTrue(isSubscriptionActive('active', future));
  });

  it('некорректная дата не даёт доступ', () => {
    assert.isFalse(isSubscriptionActive('active', 'не-дата'));
  });
});

describe('подписка: лимит бесплатного чата', () => {
  it('лимит равен трём сообщениям в день', () => {
    assert.strictEqual(FREE_CHAT_MESSAGES_PER_DAY, 3);
  });

  it('лимит положительный и разумный', () => {
    assert.isAbove(FREE_CHAT_MESSAGES_PER_DAY, 0);
    assert.isBelow(FREE_CHAT_MESSAGES_PER_DAY, 50);
  });
});
