import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { subscriptionApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import type { SubscriptionStatusResponse } from '../types';

/**
 * Состояние подписки пользователя.
 *
 * Используется на ИИ-страницах: без активной подписки вместо формы
 * показывается предложение оформить её, а в чате — счётчик
 * оставшихся бесплатных сообщений.
 *
 * Состояние всегда берётся с сервера, а не хранится в localStorage:
 * подписка может измениться в другой вкладке или на другом устройстве,
 * и локальная копия быстро устарела бы.
 */
export function useSubscription() {
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [data, setData] = useState<SubscriptionStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!user) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      setData(await subscriptionApi.status());
    } catch {
      // Ошибка сети не должна ломать страницу: считаем подписку
      // неактивной и даём пользователю повторить попытку.
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Возврат со страницы оплаты.
   *
   * Вебхук Stripe может прийти с задержкой или не прийти вовсе
   * (например, если `stripe listen` не запущен). Поэтому при наличии
   * `?subscription=success` запрашиваем состояние напрямую у Stripe —
   * иначе пользователь видел бы «не оформлена» уже после оплаты.
   */
  useEffect(() => {
    if (!user) return;

    // Синхронизация нужна в двух случаях: вернулись с `?subscription=success`
    // либо ранее уходили на оплату (флаг в sessionStorage). Второй путь
    // страхует от потери query-параметров при редиректах.
    const fromQuery = searchParams.get('subscription') === 'success';
    const fromPending = sessionStorage.getItem('subscription:pending') === '1';
    if (!fromQuery && !fromPending) return;

    sessionStorage.removeItem('subscription:pending');

    let alive = true;
    void subscriptionApi
      .sync()
      .then((result) => {
        if (alive) setData(result);
      })
      .catch(() => {
        // Ничего не делаем: обычный refresh уже показал состояние.
      })
      .finally(() => {
        // Убираем параметр из адреса, чтобы повторное обновление
        // страницы не запускало синхронизацию заново.
        const next = new URLSearchParams(searchParams);
        next.delete('subscription');
        next.delete('session_id');
        if (alive) setSearchParams(next, { replace: true });
      });

    return () => {
      alive = false;
    };
  }, [searchParams, setSearchParams, user]);

  /**
   * Перечитывает подписку напрямую в Stripe.
   *
   * В отличие от `refresh`, который читает нашу базу, этот метод
   * спрашивает платёжную систему. Нужен, когда вебхук не дошёл:
   * например, оплата прошла в другой вкладке, а страница открыта давно.
   *
   * Возвращает текст ошибки или null при успехе.
   */
  const syncFromStripe = useCallback(async (): Promise<string | null> => {
    if (!user) return 'Требуется вход в систему.';
    try {
      setData(await subscriptionApi.sync());
      return null;
    } catch (err) {
      return (
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Не удалось проверить подписку в Stripe.'
      );
    }
  }, [user]);

  /**
   * Открывает Stripe Checkout.
   * Возвращает текст ошибки или null при успехе.
   */
  const startCheckout = useCallback(async (): Promise<string | null> => {
    try {
      const { url } = await subscriptionApi.checkout();
      // Отмечаем, что уходим на оплату: при возврате проверим подписку
      // даже если Stripe не сохранит query-параметры в адресе.
      sessionStorage.setItem('subscription:pending', '1');
      window.location.href = url;
      return null;
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Не удалось начать оформление подписки.';
      return message;
    }
  }, []);

  /** Открывает портал управления подпиской. */
  const openPortal = useCallback(async (): Promise<string | null> => {
    try {
      const { url } = await subscriptionApi.portal();
      window.location.href = url;
      return null;
    } catch (err) {
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        'Не удалось открыть управление подпиской.';
      return message;
    }
  }, []);

  return {
    /** Активна ли подписка прямо сейчас. */
    isActive: Boolean(data?.isActive),
    status: data?.status ?? 'none',
    currentPeriodEnd: data?.currentPeriodEnd ?? null,
    cancelAtPeriodEnd: Boolean(data?.cancelAtPeriodEnd),
    /** Остаток бесплатных сообщений; null при активной подписке. */
    chatMessagesLeft: data?.chatMessagesLeft ?? null,
    loading,
    /** Проверка подписки напрямую в Stripe (кнопка «Обновить статус»). */
    syncFromStripe,
    startCheckout,
    openPortal,
  };
}
