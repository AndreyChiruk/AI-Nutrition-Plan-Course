import { assert } from 'chai';
import { describe, it } from 'mocha';
import { redactSecrets } from '../../subscription/subscription.service';

/**
 * Регрессия утечки секретного ключа Stripe.
 *
 * Ключ в `.env` — `rkcs_test_...` (claimable sandbox). Stripe в ответе на
 * запрос с таким ключом возвращает текст вида
 * `Expired API Key provided: rkcs_test_51UOLI***Zz3Y`, и он уходил напрямую
 * в `message` ответа API. Карточка подписки в профиле рендерила это поле —
 * пользователь видел фрагмент ключа прямо в браузере.
 *
 * Теперь все ошибки Stripe проходят через `redactSecrets` и наружу
 * отдаётся только нейтральный текст.
 */
describe('Stripe: маскирование секретов', () => {
  const REAL_LEAK =
    'Expired API Key provided: rkcs_test_51UOLIeA4LtutUH7qA1UFB0QnJHsRAQnYOYzNJJ6anfMnRJ48grjEg3ID7D8QaOAfm5wbHIReWUSmRXRya8F5NgIF00hN7dMeDG***Zz3Y';

  it('прячет реальный ключ из сообщения Stripe', () => {
    const out = redactSecrets(REAL_LEAK);
    assert.notInclude(out, 'rkcs_test_');
    assert.notInclude(out, '51UOLI');
    assert.include(out, '[ключ скрыт]');
  });

  it('прячет тестовые, боевые, публикуемые ключи и секрет вебхука', () => {
    for (const secret of [
      'sk_test_abc123XYZ',
      'sk_live_ABCdef123',
      'pk_test_51UOLIeA4Ltut',
      'whsec_2d3eadb76292b7e2e4bab82be581240d',
      'rkcs_test_51UOLIeA4',
    ]) {
      const out = redactSecrets(`Ошибка: ${secret} недействителен`);
      assert.notInclude(out, secret, `секрет ${secret.slice(0, 8)}… утёк`);
      assert.notInclude(out, '_test_');
      assert.notInclude(out, '_live_');
    }
  });

  it('не трогает безопасные идентификаторы (price_, cus_, sub_)', () => {
    // Это не секреты: price_/cus_/sub_ не дают доступа к аккаунту,
    // и их полезно видеть в логе для диагностики.
    const text = 'No such price: price_1UOLdeA4LtutUH7q0YcB0qiD; customer: cus_VPBu6Ywqd8pX4f';
    const out = redactSecrets(text);
    assert.include(out, 'price_1UOLdeA4LtutUH7q0YcB0qiD');
    assert.include(out, 'cus_VPBu6Ywqd8pX4f');
  });

  it('переживает пустые и нестроковые значения', () => {
    assert.strictEqual(redactSecrets(''), '');
    assert.strictEqual(redactSecrets(undefined as unknown as string), '');
    assert.strictEqual(redactSecrets(null as unknown as string), '');
  });

  it('маскирует ключ, даже если он окружён другим текстом', () => {
    const out = redactSecrets(`[Stripe] request failed (key=sk_test_ABC123) after 2 retries`);
    assert.notInclude(out, 'sk_test_ABC123');
    assert.include(out, 'after 2 retries');
  });
});
