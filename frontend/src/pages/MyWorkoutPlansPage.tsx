import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Copy, Trash2 } from '../components/icons';
import { workoutPlanApi, type WorkoutPlanListItem } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { formatApiError } from '../api/errors';

export const MyWorkoutPlansPage = () => {
  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { timeZone: 'Europe/Minsk' });

  const { user } = useAuth();
  const [plans, setPlans] = useState<WorkoutPlanListItem[]>([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = await workoutPlanApi.listPlans(user.id);
      setPlans(rows);
    } catch (err) {
      setMsg(formatApiError(err, 'Не удалось загрузить список планов тренировок.'));
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (planId: string) => {
    if (!user || !confirm('Удалить этот план тренировок из базы?')) return;
    setMsg('');
    try {
      await workoutPlanApi.deletePlan(user.id, planId);
      setMsg('План удалён.');
      await load();
    } catch (err) {
      setMsg(formatApiError(err, 'Не удалось удалить план.'));
    }
  };

  const makeActive = async (planId: string) => {
    if (!user) return;
    setMsg('');
    try {
      await workoutPlanApi.activatePlan(user.id, planId);
      setMsg('План сделан активным; предыдущий активный переведён в архив.');
      await load();
    } catch (err) {
      setMsg('Не удалось активировать план.');
    }
  };

  const clone = async (planId: string) => {
    if (!user) return;
    setMsg('');
    try {
      const copy = await workoutPlanApi.clonePlan(user.id, planId);
      setMsg(
        `Копия создана «${copy.name ?? 'без названия'}». Она в архиве с обнулёнными отметками — откройте или активируйте.`,
      );
      await load();
    } catch (err) {
      setMsg('Не удалось скопировать план.');
    }
  };

  return (
    <div className="profile-premium">
      <section className="card section-card">
        <div className="section-head">
          <h3>Мои планы тренировок</h3>
        </div>
        <p className="muted small">
          Откройте план для просмотра и правки. Учёт выполнения по шагам — на странице «План тренировок». Копия создаёт новый
          план от текущей даты с тем же составом и без отметок по слотам.
        </p>
        {msg ? <p className="success">{msg}</p> : null}
        {loading ? <p className="muted">Загрузка…</p> : null}
        {!loading && plans.length === 0 ? <p className="muted">Пока нет сохранённых планов тренировок.</p> : null}
        <div className="stack" style={{ marginTop: 16 }}>
          {plans.map((p) => (
            <div key={p.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <strong>{p.name ?? 'Без названия'}</strong>
                <span className="muted small">
                  {p.durationDays} дн. ·{' '}
                  {p.status === 'active'
                    ? 'активный'
                    : p.status === 'cancelled'
                      ? 'архив'
                      : p.status === 'completed'
                        ? 'завершён'
                        : p.status}
                  {p.trackingStartedAt && p.status !== 'completed' ? ' · учёт начат' : ''}
                </span>
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {dateLabel(p.startDate)} — {dateLabel(p.endDate)}
              </div>
              <div className="chip-grid" style={{ marginTop: 10 }}>
                <Link className="btn-primary plan-list-open-link" to={`/workout-plan?loadPlan=${p.id}`}>
                  Открыть план
                </Link>
                {p.status !== 'active' ? (
                  <button type="button" className="btn-secondary" onClick={() => void makeActive(p.id)}>
                    <CheckCircle2 size={14} /> Сделать активным
                  </button>
                ) : null}
                <button type="button" className="btn-secondary" onClick={() => void clone(p.id)}>
                  <Copy size={14} /> Копировать план
                </button>
                <button type="button" className="btn-secondary" onClick={() => void remove(p.id)}>
                  <Trash2 size={14} /> Удалить
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
};
