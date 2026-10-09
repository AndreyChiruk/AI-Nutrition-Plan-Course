import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from '../components/icons';
import { useSubscription } from '../hooks/useSubscription';

/**
 * Плашка «доступно по подписке».
 *
 * Показывается вместо формы на ИИ-страницах, если подписка не активна.
 * Сервер всё равно отклонит запрос (402), но без плашки пользователь
 * видел бы непонятную ошибку после заполнения формы.
 */
export function SubscriptionGate({
  children,
  title = 'Доступно по подписке',
  description = 'Эта функция использует искусственный интеллект и доступна по подписке.',
}: {
  children: ReactNode;
  title?: string;
  description?: string;
}) {
  const { isActive, loading } = useSubscription();

  // Пока состояние неизвестно, не показываем ни форму, ни плашку:
  // иначе интерфейс «мигнёт» при загрузке.
  if (loading) {
    return <p className="muted small">Проверяем доступ…</p>;
  }

  if (isActive) return <>{children}</>;

  return (
    <div className="subscription-gate" role="note">
      <div className="subscription-gate-head">
        <Lock size={16} aria-hidden />
        <strong>{title}</strong>
      </div>
      <p className="muted small">{description}</p>
      <Link className="btn-primary" to="/profile#subscription">
        Оформить подписку
      </Link>
    </div>
  );
}
