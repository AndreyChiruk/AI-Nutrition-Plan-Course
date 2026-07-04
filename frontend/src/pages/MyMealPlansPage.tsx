import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, Trash2, FolderOpen } from 'lucide-react';
import { mealPlanApi, type MealPlanSummary } from '../api/services';
import { useAuth } from '../context/AuthContext';

export const MyMealPlansPage = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<MealPlanSummary[]>([]);
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = await mealPlanApi.listPlans(user.id);
      setPlans(rows);
    } catch {
      setMsg('Не удалось загрузить список планов.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const remove = async (planId: string) => {
    if (!user || !confirm('Удалить этот план из базы?')) return;
    setMsg('');
    try {
      await mealPlanApi.deletePlan(user.id, planId);
      setMsg('План удалён.');
      await load();
    } catch {
      setMsg('Ошибка удаления.');
    }
  };

  const clone = async (planId: string) => {
    if (!user) return;
    setMsg('');
    try {
      const copy = await mealPlanApi.clonePlan(user.id, planId);
      setMsg(
        `Копия создана «${copy.name ?? 'без названия'}». Она в архиве с обнулёнными отметками — откройте её или активируйте.`,
      );
      await load();
    } catch {
      setMsg('Не удалось скопировать план.');
    }
  };

  const activate = async (planId: string) => {
    if (!user) return;
    setMsg('');
    try {
      await mealPlanApi.activatePlan(user.id, planId);
      setMsg('План сделан активным; предыдущий активный переведён в архив.');
      await load();
    } catch {
      setMsg('Не удалось активировать план.');
    }
  };

  return (
    <div className="profile-premium">
      <section className="card section-card">
        <div className="section-head">
          <FolderOpen size={18} />
          <h3>Мои планы питания</h3>
        </div>
        <p className="muted small">
          Откройте план для просмотра и правки. Отметки «съел / пропустил» доступны только у активного плана.
          Копия создаёт новый план от текущей даты с тем же составом и без отметок.
        </p>
        {msg ? <p className="success">{msg}</p> : null}
        {loading ? <p className="muted">Загрузка…</p> : null}
        {!loading && plans.length === 0 ? <p className="muted">Пока нет сохранённых планов.</p> : null}
        <div className="stack" style={{ marginTop: 16 }}>
          {plans.map((p) => (
            <div key={p.id} className="card" style={{ padding: 12 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <strong>{p.name ?? 'Без названия'}</strong>
                <span className="muted small">
                  {p.durationDays} дн. · {Math.round(p.targetCalories)} ккал/день ·{' '}
                  {p.status === 'active' ? 'активный' : 'архив'}
                </span>
              </div>
              <div className="muted small" style={{ marginTop: 4 }}>
                {new Date(p.startDate).toLocaleDateString('ru-RU')} —{' '}
                {new Date(p.endDate).toLocaleDateString('ru-RU')}
                {p.totalCalories != null ? (
                  <>
                    {' '}
                    · Σ ккал: {Math.round(p.totalCalories)}
                  </>
                ) : null}
              </div>
              <div className="chip-grid" style={{ marginTop: 10 }}>
                <Link className="btn-primary plan-list-open-link" to={`/meal-plan?loadPlan=${p.id}`}>
                  Открыть план
                </Link>
                {p.status !== 'active' ? (
                  <button type="button" className="btn-secondary" onClick={() => void activate(p.id)}>
                    Сделать активным
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
