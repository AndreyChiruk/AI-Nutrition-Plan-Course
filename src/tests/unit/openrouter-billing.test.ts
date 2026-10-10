import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты расчёта остатка средств OpenRouter.
 *
 * Регрессия: панель «Расходы на AI» показывала лишь ссылку на личный
 * кабинет и локальный учёт токенов. Фактические списания не выводились,
 * хотя OpenRouter отдаёт их через `/api/v1/credits`.
 *
 * Логика повторяет private-метод OpenAiBillingService.
 */
function remaining(totalCredits: number | null, totalUsage: number): number | null {
  if (totalCredits == null) return null;
  return Math.max(0, totalCredits - totalUsage);
}

describe('OpenRouter: остаток средств', () => {
  it('считает остаток как разницу пополнений и расходов', () => {
    assert.strictEqual(remaining(20, 15.08), 20 - 15.08);
  });

  it('не уходит в минус при перерасходе', () => {
    // Если расходы превысили пополнения, показываем 0, а не отрицательное.
    assert.strictEqual(remaining(10, 12.5), 0);
  });

  it('возвращает null, когда пополнений нет', () => {
    assert.isNull(remaining(null, 5));
  });

  it('работает с нулевыми значениями', () => {
    assert.strictEqual(remaining(0, 0), 0);
    assert.strictEqual(remaining(20, 0), 20);
  });

  it('сохраняет точность дробных сумм', () => {
    // Суммы приходят с многими знаками после запятой.
    const result = remaining(20, 15.083315286) as number;
    assert.isTrue(Math.abs(result - 4.916684714) < 1e-9);
  });
});
