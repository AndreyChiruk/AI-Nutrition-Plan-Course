import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Copy, Trash2, FolderOpen } from 'lucide-react';
import { mealPlanApi, type MealPlanSummary } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { formatApiError } from '../api/errors';

export const MyMealPlansPage = () => {
  const { user } = useAuth();
  const [plans, setPlans] = useState<MealPlanSummary[]>([]);
  const [msg, setMsg] = useState('');
  /**
   * Предупреждение о том, что план создан по другим ограничениям.
   * null — предупреждения нет.
   */
  const [restrictionWarning, setRestrictionWarning] = useState<{
    planId: string;
    changed: Array<{ field: string; label: string; before: string; after: string }>;
    message: string;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      // Сервер отдаёт страницу: { rows, count }.
      const page = await mealPlanApi.listPlans(user.id, { limit: 50 });
      setPlans(Array.isArray(page?.rows) ? page.rows : []);
    } catch (err) {
      setMsg(formatApiError(err, 'Не удалось загрузить список планов.'));
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
      // Убираем указатель на удалённый план: иначе страница плана
      // попытается открыть его из sessionStorage и покажет ошибку.
      if (sessionStorage.getItem('mealPlan:lastOpened') === String(planId)) {
        sessionStorage.removeItem('mealPlan:lastOpened');
      }
      setMsg('План удалён.');
      await load();
    } catch (err) {
      setMsg(formatApiError(err, 'Не удалось удалить план.'));
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
    } catch (err) {
      setMsg('Не удалось скопировать план.');
    }
  };

  /**
   * Активация плана.
   *
   * Сервер может отказать, если план построен по другим ограничениям
   * (изменились аллергии, диета или нежелательные продукты). Тогда
   * показываем список различий и предлагаем пересоздать план.
   */
  const activate = async (planId: string, force = false) => {
    if (!user) return;
    setMsg('');
    try {
      const res = await mealPlanApi.activatePlan(user.id, planId, force);

      if (res && 'requiresConfirmation' in res && res.requiresConfirmation) {
        setRestrictionWarning({ planId, changed: res.changed, message: res.message });
        return;
      }

      setRestrictionWarning(null);
      sessionStorage.setItem('mealPlan:lastOpened', String(planId));
      setMsg('План сделан активным; предыдущий активный переведён в архив.');
      await load();
    } catch (err) {
      setMsg(formatApiError(err, 'Не удалось активировать план.'));
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

        {/* Предупреждение: план построен по другим ограничениям.
            Показываем, что именно изменилось, и предлагаем пересоздать. */}
        {restrictionWarning ? (
          <div className="restriction-warning" role="alert">
            <div className="restriction-warning-head">
              <AlertTriangle size={16} />
              <strong>План создан по старым ограничениям</strong>
            </div>
            <p className="muted small">{restrictionWarning.message}</p>
            <table className="restriction-diff">
              <thead>
                <tr>
                  <th>Ограничение</th>
                  <th>Было при создании</th>
                  <th>Сейчас</th>
                </tr>
              </thead>
              <tbody>
                {restrictionWarning.changed.map((c) => (
                  <tr key={c.field}>
                    <td>{c.label}</td>
                    <td className="muted">{c.before}</td>
                    <td>
                      <strong>{c.after}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="restriction-warning-actions">
              <Link className="btn-primary" to="/meal-plan?regenerate=1">
                Сгенерировать новый план
              </Link>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void activate(restrictionWarning.planId, true)}
              >
                Всё равно включить
              </button>
              <button type="button" className="btn-link-outline" onClick={() => setRestrictionWarning(null)}>
                Отмена
              </button>
            </div>
          </div>
        ) : null}

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
