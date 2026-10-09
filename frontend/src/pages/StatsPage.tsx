import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Activity, Apple, Dumbbell, Target, Utensils } from '../components/icons';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { statsApi } from '../api/services';
import { useAuth } from '../context/AuthContext';

function humanBodyMetricLabel(sortAt: string, dateFallback: string): string {
  const d = new Date(sortAt);
  if (Number.isNaN(d.getTime())) return dateFallback;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export const StatsPage = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const [planFact, setPlanFact] = useState<{
    targetDailyCalories: number | null;
    deltaVsTargetDaily: number | null;
    daysWithMealsLogged: number;
  } | null>(null);
  const [summary, setSummary] = useState<{
    mealPlansCount: number;
    workoutPlansCount: number;
    foodRecognitionCount: number;
  } | null>(null);
  const [bodySeries, setBodySeries] = useState<
    Array<{ sortAt: string; date: string; weight: number; bmi: number }>
  >([]);

  const bodyChartData = useMemo(
    () =>
      bodySeries.map((p) => ({
        ...p,
        chartLabel: humanBodyMetricLabel(p.sortAt, p.date),
      })),
    [bodySeries],
  );

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const [pf, sum, body] = await Promise.all([
        statsApi.planVsFact(user.id),
        statsApi.summary(user.id),
        statsApi.bodyMetrics(user.id),
      ]);
      setPlanFact(pf);
      setSummary(sum);
      setBodySeries(Array.isArray(body) ? body : []);
    };
    void load();
  }, [user, pathname]);

  return (
    <div className="profile-premium">
      <section className="card section-card">
        <div className="section-head">
          <Activity size={18} />
          <h2>Статистика и графики</h2>
        </div>
        <p className="muted small">
          Счётчики планов и журнала — по вашим данным в приложении. Вес и ИМТ — по снимкам в разделе «Анализ
          тела».
        </p>

        <div className="grid stats-counters">
          <div className="card stat-mini">
            <Target size={18} />
            <span>Цель (план), ккал/день</span>
            <strong>{planFact?.targetDailyCalories ?? '—'}</strong>
          </div>
          <div className="card stat-mini">
            <Utensils size={18} />
            <span>Планов питания</span>
            <strong>{summary?.mealPlansCount ?? 0}</strong>
          </div>
          <div className="card stat-mini">
            <Dumbbell size={18} />
            <span>Планов тренировок</span>
            <strong>{summary?.workoutPlansCount ?? 0}</strong>
          </div>
          <div className="card stat-mini">
            <Apple size={18} />
            <span>Распознаваний еды</span>
            <strong>{summary?.foodRecognitionCount ?? 0}</strong>
          </div>
        </div>
      </section>

      <section className="grid two-cols-chart">
        <div className="card section-card chart-card">
          <div className="section-head">
            <h3>Вес, кг</h3>
          </div>
          {bodyChartData.length === 0 ? (
            <p className="muted">Нет данных: укажите рост и вес в профиле и при необходимости сделайте анализ тела.</p>
          ) : (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={bodyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(222,215,203,0.55)" />
                  <XAxis dataKey="chartLabel" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={32} />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(222,215,203,0.7)',
                      borderRadius: 8,
                    }}
                    labelFormatter={(label) => String(label ?? '')}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="weight"
                    name="Вес, кг"
                    stroke="var(--terracotta)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card section-card chart-card">
          <div className="section-head">
            <h3>ИМТ</h3>
          </div>
          {bodyChartData.length === 0 ? (
            <p className="muted">Нет данных для ИМТ (нужен рост и вес в профиле).</p>
          ) : (
            <div className="chart-area">
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={bodyChartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(222,215,203,0.55)" />
                  <XAxis dataKey="chartLabel" tick={{ fill: '#94a3b8', fontSize: 11 }} minTickGap={32} />
                  <YAxis
                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                    domain={['auto', 'auto']}
                  />
                  <Tooltip
                    contentStyle={{
                      background: '#0f172a',
                      border: '1px solid rgba(222,215,203,0.7)',
                      borderRadius: 8,
                    }}
                    labelFormatter={(label) => String(label ?? '')}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="bmi"
                    name="ИМТ"
                    stroke="var(--olive)"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
