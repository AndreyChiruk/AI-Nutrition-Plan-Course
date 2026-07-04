import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Camera, Sparkles, UploadCloud } from 'lucide-react';
import { BodyFigureWithTint } from '../components/BodyFigureWithTint';
import { bodyApi, recommendationApi, userApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { computeAgeFromBirthDate } from '../utils/age';
import type { BodyAnalysisPageState, BodyForecastResponse } from '../types';

function suggestionContentToDisplay(data: Record<string, unknown> | null): {
  summary: string;
  actions: string[];
  source: string;
} | null {
  if (!data) return null;
  const c = data.content as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return null;
  const summary = typeof c.summary === 'string' ? c.summary : '';
  const actions = Array.isArray(c.actions) ? c.actions.filter((x): x is string => typeof x === 'string') : [];
  const source = typeof c.source === 'string' ? c.source : 'ИИ';
  if (!summary && !actions.length) return null;
  return { summary, actions, source };
}

export const BodyAnalysisPage = () => {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [savedAt, setSavedAt] = useState('');
  const [detailedRecommendation, setDetailedRecommendation] = useState<Record<string, unknown> | null>(null);
  const [profile, setProfile] = useState<{
    weight: number;
    height: number;
    gender: 'male' | 'female';
    birthDate: string;
    goal: 'lose' | 'maintain' | 'gain';
  } | null>(null);
  const [message, setMessage] = useState('');
  const [forecastWeeks, setForecastWeeks] = useState(8);
  const [forecast, setForecast] = useState<BodyForecastResponse | null>(null);
  const [forecastAtLabel, setForecastAtLabel] = useState('');
  const [forecastLoading, setForecastLoading] = useState(false);
  const [latestBodyAiNotes, setLatestBodyAiNotes] = useState('');

  const applyPageState = useCallback((state: BodyAnalysisPageState) => {
    if (state.latestAnalysis?.photoUrl) {
      setPhotoUrl(state.latestAnalysis.photoUrl);
      setSavedAt(new Date(state.latestAnalysis.analyzedAt).toLocaleString('ru-RU'));
    } else {
      setPhotoUrl('');
      setSavedAt('');
    }
    if (state.savedForecast) {
      setForecast(state.savedForecast);
    } else {
      setForecast(null);
    }
    if (state.savedForecastWeeks != null) {
      setForecastWeeks(state.savedForecastWeeks);
    }
    if (state.forecastUpdatedAt) {
      setForecastAtLabel(new Date(state.forecastUpdatedAt).toLocaleString('ru-RU'));
    } else {
      setForecastAtLabel('');
    }
    setLatestBodyAiNotes(state.latestAnalysis?.aiNotes?.trim() ?? '');
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!user) return;
      const [data, state] = await Promise.all([userApi.getById(user.id), bodyApi.pageState(user.id)]);
      if (cancelled) return;
      setProfile({
        weight: Number(data.weight ?? 70),
        height: Number(data.height ?? 170),
        gender: (data.gender ?? 'male') as 'male' | 'female',
        birthDate: String(data.birthDate ?? '1995-01-01'),
        goal: (data.goal ?? 'maintain') as 'lose' | 'maintain' | 'gain',
      });
      applyPageState(state);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [user, pathname, applyPageState]);

  const bmi = useMemo(() => {
    if (!profile) return 0;
    return Number((profile.weight / ((profile.height / 100) * (profile.height / 100))).toFixed(1));
  }, [profile]);

  const age = useMemo(() => {
    if (!profile) return 0;
    const y = computeAgeFromBirthDate(profile.birthDate);
    return y === null ? 0 : Math.max(0, y);
  }, [profile]);

  const idealWeightRange = useMemo(() => {
    if (!profile) return { min: 0, max: 0 };
    const h = profile.height / 100;
    return {
      min: Number((18.5 * h * h).toFixed(1)),
      max: Number((24.9 * h * h).toFixed(1)),
    };
  }, [profile]);

  const safeGoal = useMemo<'lose' | 'maintain' | 'gain'>(() => {
    if (!profile) return 'maintain';
    if (profile.weight < idealWeightRange.min && profile.goal === 'lose') return 'gain';
    if (profile.weight > idealWeightRange.max && profile.goal === 'gain') return 'lose';
    return profile.goal;
  }, [profile, idealWeightRange.min, idealWeightRange.max]);

  const bmiStatus = useMemo(() => {
    if (bmi < 18.5) return { label: 'Недостаток веса', color: '#60a5fa' };
    if (bmi < 25) return { label: 'Норма', color: '#34d399' };
    if (bmi < 30) return { label: 'Избыток веса', color: '#fb923c' };
    return { label: 'Ожирение', color: '#f43f5e' };
  }, [bmi]);

  const localRecommendations = useMemo(() => {
    if (!profile) return [];
    const items: string[] = [];

    if (safeGoal === 'lose' && bmi > 25) {
      items.push(
        'Рекомендуем дефицит 300–500 ккал в день. Увеличьте белковую пищу и ходьбу 8–10 тыс. шагов.',
      );
    }
    if (safeGoal === 'gain' && bmi < 18.5) {
      items.push(
        'Увеличьте калорийность на 15–20%. Добавьте сложные углеводы и силовые тренировки 3 раза в неделю.',
      );
    }
    if (safeGoal === 'maintain' && bmi >= 18.5 && bmi < 25) {
      items.push('Отлично! Продолжайте в том же духе. Следите за балансом БЖУ.');
    }
    if (bmi >= 25 && bmi < 30) {
      items.push(
        'Зона избыточного веса. Начните с контроля порций и исключения добавленного сахара.',
      );
    }
    if (bmi >= 30) {
      items.push('Снизьте калорийность на 15% и добавьте регулярную аэробную активность 4–5 раз в неделю.');
    }
    if (bmi < 18.5) {
      items.push('Добавьте 2–3 калорийных перекуса в день и следите за набором массы плавно.');
    }
    items.push('Поддерживайте питьевой режим и сон не менее 7–8 часов для восстановления.');

    if (safeGoal !== profile.goal) {
      items.unshift(
        safeGoal === 'gain'
          ? 'Снижение веса временно не рекомендуется: текущий вес ниже нормы, фокус на безопасном наборе.'
          : 'Набор веса временно не рекомендуется: текущий вес выше нормы, фокус на мягком снижении.',
      );
    }

    return items.slice(0, 5);
  }, [bmi, profile, safeGoal]);

  const uploadBodyPhoto = async () => {
    if (!user) return;
    if (!photoUrl) {
      setMessage('Сначала загрузите фото фигуры.');
      return;
    }
    const analyzed = await bodyApi.analyze(user.id, photoUrl);
    if (analyzed.aiNotes?.trim()) setLatestBodyAiNotes(analyzed.aiNotes.trim());
    const state = await bodyApi.pageState(user.id);
    applyPageState(state);
    setMessage('Фото успешно загружено и сохранено.');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadDetailedRecommendation = async () => {
    if (!user) return;
    const data = await recommendationApi.generate(user.id);
    setDetailedRecommendation(data as Record<string, unknown>);
  };

  const loadForecast = async () => {
    if (!user) return;
    setForecastLoading(true);
    try {
      await bodyApi.forecast(user.id, forecastWeeks);
      const state = await bodyApi.pageState(user.id);
      applyPageState(state);
    } finally {
      setForecastLoading(false);
    }
  };

  const onFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="analysis-page profile-premium">
      <div className="profile-grid">
        <aside className="left-col">
          <section className="card section-card">
            <div className="section-head">
              <UploadCloud size={18} />
              <h3>Фото фигуры</h3>
            </div>
            <div
              className="dropzone"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const file = event.dataTransfer.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === 'string') setPhotoUrl(reader.result);
                };
                reader.readAsDataURL(file);
              }}
            >
              Перетащите фото или нажмите для выбора
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden-file-input"
              onChange={onFileChange}
              aria-label="Загрузка фото фигуры"
            />
            {photoUrl ? (
              <div className="body-analysis-photo-frame">
                <img src={photoUrl} alt="Ваше фото для анализа фигуры" className="body-analysis-user-photo" />
              </div>
            ) : null}
            <p className="muted small body-analysis-photo-hint">
              Лучше полный силуэт по рост: вертикальное фото, камера на уровне пояса, весь рост в кадре.
            </p>
            <button type="button" onClick={uploadBodyPhoto}>
              <Camera size={16} /> Загрузить / заменить фото
            </button>
            <p className="muted small">Последнее обновление: {savedAt || '—'}</p>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <Sparkles size={18} />
              <h3>Показатели</h3>
            </div>
            <div className="stats-grid">
              <div>
                <span>Вес</span>
                <strong>{profile?.weight ?? 0} кг</strong>
              </div>
              <div>
                <span>Рост</span>
                <strong>{profile?.height ?? 0} см</strong>
              </div>
              <div>
                <span>ИМТ</span>
                <strong className={`bmi-value ${bmi < 18.5 ? 'bmi-under' : bmi < 25 ? 'bmi-normal' : bmi < 30 ? 'bmi-over' : 'bmi-obese'}`}>
                  {bmi || 0}
                </strong>
              </div>
            </div>
            <p className="muted small">
              Идеальный диапазон веса: {idealWeightRange.min}–{idealWeightRange.max} кг
            </p>
            <p className="muted small">
              Цель с учетом зоны веса: {safeGoal === 'lose' ? 'похудеть' : safeGoal === 'gain' ? 'набрать массу' : 'поддерживать'}
            </p>
            <p className="muted small">
              Статус ИМТ:{' '}
              <span className={`bmi-label ${bmi < 18.5 ? 'bmi-under' : bmi < 25 ? 'bmi-normal' : bmi < 30 ? 'bmi-over' : 'bmi-obese'}`}>
                {bmiStatus.label}
              </span>
            </p>
            <p className="muted small">Возраст: {age} лет</p>
          </section>

          {latestBodyAiNotes ? (
            <section className="card section-card">
              <div className="section-head">
                <Sparkles size={18} />
                <h3>Краткий разбор текущего телосложения</h3>
              </div>
              <p className="muted small" style={{ marginBottom: 8 }}>
                По последнему сохранённому фото (оценка модели, не диагноз).
              </p>
              <p className="small" style={{ margin: 0, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
                {latestBodyAiNotes}
              </p>
            </section>
          ) : null}
        </aside>

        <section className="right-col">
          <section className="card section-card">
            <div className="section-head">
              <Sparkles size={18} />
              <h3>Силуэт и подсветка по ИМТ</h3>
            </div>
            <p className="muted small">Цвет — по всему силуэту: норма, дефицит, отклонение (25–30), проблемная зона (30+).</p>
            <div className="figure-wrap">
              {profile ? <BodyFigureWithTint gender={profile.gender} bmi={bmi} /> : <p className="muted small">Загрузка профиля…</p>}
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <Sparkles size={18} />
              <h3>Прогноз фигуры на срок</h3>
            </div>
            <p className="muted small">
              Ориентир по изменениям силуэта (текст + иллюстрация). Расчёт с учётом цели и последнего анализа
              фото; при настроенном ключе API — расширенная формулировка на русском. Для картинки «после программы»
              лучше подойдёт фото в <strong>закрытой спортивной одежде</strong> (футболка, длинные брюки) — иначе сервис
              генерации может отклонить снимок по правилам безопасности.
            </p>
            {latestBodyAiNotes ? (
              <p className="muted small" style={{ marginTop: 8 }}>
                Краткая оценка текущего телосложения по сохранённому фото — в колонке слева («Краткий разбор…»).
              </p>
            ) : null}
            <div className="forecast-controls">
              <label className="muted small">
                Недель:&nbsp;
                <select
                  value={forecastWeeks}
                  onChange={(e) => setForecastWeeks(Number(e.target.value))}
                  className="select-inline"
                >
                  {[4, 8, 12, 16, 24].map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="btn-primary ripple" disabled={forecastLoading} onClick={loadForecast}>
                {forecastLoading ? 'Считаем…' : 'Построить прогноз'}
              </button>
            </div>
            {forecast ? (
              <div className="forecast-block">
                <div className="forecast-illustration-wrap">
                  <img
                    src={forecast.illustrationUrl}
                    alt="Визуальный прогноз фигуры"
                    className="forecast-illustration"
                  />
                </div>
                {forecastAtLabel ? (
                  <p className="muted small" style={{ marginTop: 4 }}>
                    Прогноз обновлён: {forecastAtLabel}
                  </p>
                ) : null}
                {forecast.illustrationSource === 'ai' ? (
                  <p className="muted small" style={{ marginTop: 6 }}>
                    Изображение сгенерировано по вашему фото: ориентир «после программы» (ИИ), не медицинский прогноз.
                  </p>
                ) : (
                  <p className="muted small" style={{ marginTop: 6 }}>
                    Показан пример: нет фото в анализе, сбой API или фото не прошло проверку безопасности. Загрузите
                    снимок в спортивной одежде (см. выше) и нажмите «Построить прогноз» снова.
                  </p>
                )}
                <p>{forecast.summary}</p>
                <p className="muted small">{forecast.visualDescription}</p>
                <ul className="recommend-list">
                  {forecast.milestones.slice(0, 8).map((m) => (
                    <li key={m.week}>
                      <strong>Неделя {m.week}.</strong> {m.note}
                    </li>
                  ))}
                </ul>
                <p className="muted small">{forecast.disclaimer}</p>
              </div>
            ) : null}
          </section>

          <section className="card section-card">
            <div className="section-head">
              <Sparkles size={18} />
              <h3>Локальные рекомендации</h3>
            </div>
            <ul className="recommend-list">
              {localRecommendations.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <button type="button" onClick={loadDetailedRecommendation}>
              Получить подробную рекомендацию (ИИ)
            </button>
            {(() => {
              const d = suggestionContentToDisplay(detailedRecommendation);
              if (!d) return null;
              return (
                <div className="card" style={{ marginTop: 12 }}>
                  {d.summary ? (
                    <p className="muted" style={{ margin: 0, lineHeight: 1.55, whiteSpace: 'pre-line' }}>
                      {d.summary}
                    </p>
                  ) : null}
                  {d.actions.length > 0 ? (
                    <ul className="recommendation-action-list" style={{ marginTop: 10 }}>
                      {d.actions.map((a, i) => (
                        <li key={i}>{a}</li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
                    Источник: {d.source}
                  </p>
                </div>
              );
            })()}
            {message ? <p className="success">{message}</p> : null}
          </section>
        </section>
      </div>
    </div>
  );
};
