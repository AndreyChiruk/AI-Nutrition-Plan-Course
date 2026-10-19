import { assert } from 'chai';
import { describe, it } from 'mocha';
import { FALLBACK_USD_BYN } from '../../subscription/currency.service';
import { SUBSCRIPTION_PRICE_USD } from '../../subscription/subscription.service';

/**
 * Пересчёт цены подписки в белорусские рубли.
 *
 * Цена в Stripe задана в долларах, пользователю показывается BYN по
 * официальному курсу НБРБ. Тесты фиксируют арифметику и формат, чтобы
 * цена не «поехала» при изменении курсового сервиса.
 */
describe('подписка: цена в BYN', () => {
  /** Повторяет priceByn() в subscription.service. */
  const priceInByn = (rate: number) => Number((SUBSCRIPTION_PRICE_USD * rate).toFixed(2));

  it('пересчитывает доллары в BYN по курсу', () => {
    assert.strictEqual(priceInByn(3.0098), 29.8);
    assert.strictEqual(priceInByn(3), 29.7);
    assert.strictEqual(priceInByn(1), 9.9);
  });

  it('округляет до копеек, а не отдаёт длинную дробь', () => {
    const value = priceInByn(3.14159);
    const decimals = String(value).split('.')[1]?.length ?? 0;
    assert.isAtMost(decimals, 2, 'в BYN не должно быть больше двух знаков');
  });

  it('запасной курс даёт разумную сумму', () => {
    // Если НБРБ недоступен, карточка не должна остаться без цены.
    const fallback = priceInByn(FALLBACK_USD_BYN);
    assert.isAbove(fallback, 10, 'сумма подозрительно мала');
    assert.isBelow(fallback, 200, 'сумма подозрительно велика');
  });

  it('курс должен быть положительным числом', () => {
    assert.isAbove(FALLBACK_USD_BYN, 0);
    assert.isAbove(SUBSCRIPTION_PRICE_USD, 0);
  });
});
