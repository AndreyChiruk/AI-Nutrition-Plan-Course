import { useEffect, useMemo, useState } from 'react';
import { Apple, Droplet, Loader2, Moon } from '../components/icons';
import { Brain, ListChecks } from '../components/icons';
import { recommendationApi, userApi } from '../api/services';
import { formatApiError } from '../api/errors';
import { SubscriptionGate } from '../components/SubscriptionGate';
import { useAuth } from '../context/AuthContext';
import { computeAgeFromBirthDate } from '../utils/age';

type AiDisplay = {
  summary: string;
  actions: string[];
  source?: string;
  profileLine?: string;
};

const BASE_HEALTH_TIPS: { title: string; text: string; icon: 'droplet' | 'moon' | 'apple' }[] = [
  {
    title: 'Вода',
    text: '1.5–2 л в день; в жару и после тренировки — больше. Ограничьте сладкие напитки.',
    icon: 'droplet',
  },
  {
    title: 'Сон',
    text: '7–8 часов сна стабилизируют голод и настроение. Стабильный режим важнее «идеала».',
    icon: 'moon',
  },
  {
    title: 'Овощи',
    text: 'Половина тарелки — овощи/зелень хотя бы в двух приёмах пищи в день.',
    icon: 'apple',
  },
];

const TipIcon = ({ kind }: { kind: (typeof BASE_HEALTH_TIPS)[number]['icon'] }) => {
  if (kind === 'droplet') return <Droplet size={18} />;
  if (kind === 'moon') return <Moon size={18} />;
  return <Apple size={18} />;
};

function parseAiResult(result: Record<string, unknown> | null): AiDisplay | null {
  if (!result) return null;
  const raw = result.ai as Record<string, unknown> | undefined;
  if (!raw || typeof raw !== 'object') return null;

  const prof = result.profile as Record<string, unknown> | undefined;
  let profileLine: string | undefined;
  if (prof && typeof prof === 'object') {
    const parts: string[] = [];
    if (typeof prof.gender === 'string') parts.push(`пол: ${prof.gender}`);
    if (typeof prof.age === 'number' && prof.age > 0) parts.push(`возраст: ${prof.age} лет`);
    if (typeof prof.weight === 'number') parts.push(`вес: ${prof.weight} кг`);
    if (typeof prof.height === 'number') parts.push(`рост: ${prof.height} см`);
    if (typeof prof.goal === 'string') parts.push(`цель: ${prof.goal}`);
    if (parts.length) profileLine = `Учтено: ${parts.join(' · ')}.`;
  }

  const content = (raw.content as Record<string, unknown>) || raw;
  const summary = typeof content.summary === 'string' ? content.summary : '';
  const actions = Array.isArray(content.actions)
    ? content.actions.filter((x): x is string => typeof x === 'string')
    : [];
  const source = typeof content.source === 'string' ? content.source : undefined;

  if (!summary && !actions.length) return null;
  return { summary, actions, source, profileLine };
}

export const RecommendationsPage = () => {
  const { user } = useAuth();
  const [mode, setMode] = useState<'ai' | 'base'>('ai');
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [baseRecommendations, setBaseRecommendations] = useState<Array<Record<string, unknown>>>([]);
  const [loadingAi, setLoadingAi] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const loadBase = async () => {
      try {
        const data = await recommendationApi.getBase();
        setBaseRecommendations(data as Array<Record<string, unknown>>);
      } catch (err) {
        setError(formatApiError(err, 'Не удалось получить рекомендации.'));
      }
    };
    void loadBase();
  }, []);

  const cacheKey = useMemo(() => `ai-recommendation:${user?.id ?? 'anon'}`, [user?.id]);

  const onGenerate = async () => {
    if (!user) return;
    setError('');
    setLoadingAi(true);
    try {
      const profile = await userApi.getById(user.id);
      const data = await recommendationApi.generate(user.id);
      const enriched = {
        profile: {
          gender: profile.gender,
          age: Math.max(0, computeAgeFromBirthDate(String(profile.birthDate)) ?? 0),
          weight: profile.weight,
          height: profile.height,
          goal: profile.goal,
        },
        ai: data,
      };
      setResult(enriched as Record<string, unknown>);
      localStorage.setItem(
        cacheKey,
        JSON.stringify({
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
          data: enriched,
        }),
      );
    } catch (err) {
      setError(formatApiError(err, 'Не удалось получить рекомендации.'));
    } finally {
      setLoadingAi(false);
    }
  };

  const aiDisplay = mode === 'ai' ? parseAiResult(result) : null;

  return (
    <div className="profile-premium">
      <section className="card section-card">
        <div className="section-head">
          <h3>Рекомендации</h3>
        </div>

        {error ? <p className="error">{error}</p> : null}

        <div className="base-tips-row">
          {BASE_HEALTH_TIPS.map((t) => (
            <div key={t.title} className="card base-tip-card">
              <div className="base-tip-card__head">
                <TipIcon kind={t.icon} />
                <h4>{t.title}</h4>
              </div>
              <p className="muted small" style={{ margin: 0 }}>
                {t.text}
              </p>
            </div>
          ))}
        </div>

        <div className="goal-cards">
          <button type="button" className={`goal-card ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            <Brain size={18} /> AI-рекомендации
          </button>
          <button type="button" className={`goal-card ${mode === 'base' ? 'active' : ''}`} onClick={() => setMode('base')}>
            <ListChecks size={18} /> Базовые рекомендации
          </button>
        </div>

        {mode === 'ai' ? (
          <div className="stack">
            <SubscriptionGate
              title="AI-рекомендации по подписке"
              description="Персональные рекомендации искусственного интеллекта доступны по подписке."
            >
              <button
                type="button"
                className="btn-primary"
                onClick={onGenerate}
                disabled={loadingAi}
                aria-busy={loadingAi}
              >
                {loadingAi ? <Loader2 size={16} className="btn-spinner" /> : null}
                {loadingAi ? 'Генерация...' : 'Сгенерировать AI-рекомендации'}
              </button>
            </SubscriptionGate>
            {aiDisplay ? (
              <div className="ai-recommendation-block stack">
                {aiDisplay.profileLine ? <p className="small muted ai-recommendation-profile">{aiDisplay.profileLine}</p> : null}
                <div className="card">
                  <h4>Персональные советы</h4>
                  {aiDisplay.summary ? (
                    <p className="muted ai-recommendation-summary">{aiDisplay.summary}</p>
                  ) : null}
                  {aiDisplay.actions.length > 0 ? (
                    <ul className="recommendation-action-list">
                      {aiDisplay.actions.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {!aiDisplay.summary && !aiDisplay.actions.length ? (
                    <p className="muted small">Нет текста в ответе. Попробуйте сгенерировать снова.</p>
                  ) : null}
                  <p className="small muted ai-recommendation-source">
                    Источник: {aiDisplay.source ?? 'ИИ'}
                  </p>
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="stack">
            {baseRecommendations.map((item) => (
              <div key={String(item.id)} className="card">
                <h4>{String(item.title ?? 'Рекомендация')}</h4>
                <p className="muted">{String(item.description ?? '')}</p>
                <p className="small muted">Категория: {String(item.category ?? 'nutrition')}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};
