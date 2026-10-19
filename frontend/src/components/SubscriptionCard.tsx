import { useState } from 'react';
import { AlertCircle, CreditCard, Loader2, Settings } from '../components/icons';
import { useSubscription } from '../hooks/useSubscription';

/**
 * Карточка подписки в профиле.
 *
 * Показывает состояние подписки, список возможностей и кнопку
 * оформления либо управления. После возврата со Stripe
 * (`?subscription=success`) состояние перезапрашивается, потому что
 * вебхук мог прийти с задержкой.
 */

/** Что даёт подписка: коротко, без маркетинговых формулировок. */
const FEATURES = [
  'Распознавание блюд по фотографии',
  'Генерация плана питания на 7–30 дней',
  'Анализ тела и прогноз изменения фигуры',
  'Персональные рекомендации',
  'Диалог с ассистентом без ограничений',
] as const;

/** Запасная цена, если бэкенд не отдал курс (BYN по умолчанию). */
const FALLBACK_PRICE_LABEL = '9.90 $';

const STATUS_LABEL: Record<string, string> = {
  active: 'Активна',
  trialing: 'Пробный период',
  past_due: 'Просрочена оплата',
  canceled: 'Отменена',
  incomplete: 'Не завершена',
  unpaid: 'Не оплачена',
  none: 'Не оформлена',
};

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function SubscriptionCard() {
  const {
    isActive,
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd,
    chatMessagesLeft,
    priceByn,
    loading,
    syncFromStripe,
    startCheckout,
    openPortal,
  } = useSubscription();

  // Название суммы: основная цена в долларах, рядом — пересчёт в BYN.
  const priceLabel = priceByn ? `${priceByn.usd.toFixed(2)} $` : FALLBACK_PRICE_LABEL;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  /**
   * Запускает действие и показывает результат.
   *
   * Раньше `busy` снимался только при ошибке: считалось, что успех всегда
   * уводит на Stripe редиректом. Но у «Обновить статус» редиректа нет —
   * кнопка оставалась заблокированной навсегда и казалась зависшей,
   * хотя запрос уже завершился.
   */
  const runAction = async (
    action: () => Promise<string | null>,
    successText?: string,
    redirects = true,
  ) => {
    setBusy(true);
    setError('');
    setNotice('');
    const message = await action();
    if (message) {
      setError(message);
      setBusy(false);
      return;
    }
    if (redirects) {
      // Уходим на Stripe: busy не снимаем, иначе кнопка мигнёт.
      return;
    }
    setNotice(successText ?? 'Готово.');
    setBusy(false);
  };

  if (loading) {
    return (
      <section className="card section-card">
        <div className="section-head">
          <h3>Подписка</h3>
        </div>
        <p className="muted small">
          <Loader2 size={14} className="pref-spinner" /> Проверяем состояние…
        </p>
      </section>
    );
  }

  const tone = isActive ? 'active' : status === 'past_due' || status === 'unpaid' ? 'warn' : 'none';

  return (
    <section className="card section-card">
      <div className="section-head">
        <h3>Подписка</h3>
        <span className={`subscription-badge is-${tone}`}>{STATUS_LABEL[status] ?? status}</span>
      </div>

      {isActive ? (
        <>
          <p className="muted small">
            {cancelAtPeriodEnd
              ? `Подписка будет отменена ${formatDate(currentPeriodEnd)}.`
              : currentPeriodEnd
                ? `Действует до ${formatDate(currentPeriodEnd)}.`
                : 'Подписка активна.'}
          </p>

          <ol className="subscription-features">
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>

          <div className="subscription-actions">
            <button
              type="button"
              className="btn-secondary"
              title="Отмена и смена карты в личном кабинете Stripe"
              disabled={busy}
              onClick={() => void runAction(openPortal, undefined, false)}
            >
              {busy ? <Loader2 size={15} className="pref-spinner" /> : <Settings size={15} aria-hidden />}
              {busy ? 'Открываем…' : 'Управлять подпиской'}
            </button>
            <button
              type="button"
              className="btn-link-outline"
              disabled={busy}
              onClick={() =>
                void runAction(syncFromStripe, 'Статус подписки обновлён.', false)
              }
            >
              {busy ? <Loader2 size={14} className="pref-spinner" /> : null}
              {busy ? 'Проверяем…' : 'Обновить статус'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="muted small">
            Открывает все возможности с искусственным интеллектом. Оформление через
            Stripe, отмена — в любой момент.
          </p>

          <p className="subscription-price">
            <span className="subscription-price-value mono">{priceLabel}</span>
            <span className="muted small">в месяц</span>
          </p>

          {/* Курс НБРБ меняется ежедневно, поэтому сумму в BYN считает
              бэкенд и отдаёт вместе со статусом подписки. */}
          {priceByn && !priceByn.isFallback ? (
            <p className="muted small subscription-rate-note">
              ≈ {priceByn.byn.toFixed(2)} BYN по курсу НБРБ {priceByn.rate.toFixed(4)}
              {priceByn.rateDate ? ` от ${priceByn.rateDate}` : ''}
            </p>
          ) : (
            <p className="muted small subscription-rate-note">
              Оплата в долларах. Курс НБРБ временно недоступен — сумма в BYN не показана.
            </p>
          )}

          <ol className="subscription-features">
            {FEATURES.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ol>

          <div className="subscription-actions">
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void runAction(startCheckout)}
            >
              {busy ? <Loader2 size={15} className="pref-spinner" /> : <CreditCard size={15} />}
              Оформить подписку
            </button>
            <button
              type="button"
              className="btn-link-outline"
              disabled={busy}
              onClick={() =>
                void runAction(syncFromStripe, 'Статус подписки обновлён.', false)
              }
            >
              Обновить статус
            </button>
          </div>

          {/* Бесплатный чат доступен и без подписки. */}
          {chatMessagesLeft !== null ? (
            <p className="muted small subscription-hint">
              В чате с ассистентом бесплатно доступно{' '}
              <strong>{chatMessagesLeft}</strong> из 3 сообщений в день.
            </p>
          ) : null}
        </>
      )}

      {error ? (
        <p className="subscription-error" role="alert">
          <AlertCircle size={14} aria-hidden />
          {error}
        </p>
      ) : null}

      {/* Подтверждение для действий без редиректа («Обновить статус»):
          без него казалось, что кнопка ничего не делает. */}
      {notice ? (
        <p className="subscription-notice" role="status">
          {notice}
        </p>
      ) : null}
    </section>
  );
}
