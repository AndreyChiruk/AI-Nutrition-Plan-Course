import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  TileActivity as Activity,
  TileApple as Apple,
  TileLineChart as LineChart,
  TileRefrigerator as Refrigerator,
  TileUtensilsCrossed as UtensilsCrossed,
  Salad,
  Soup,
  Wheat,
} from '../components/icons';
import { publicApi } from '../api/services';

/** Одно блюдо витрины, приходит из /health/catalog-samples. */
type CatalogSample = { id: string; name: string; slot: string; kcal: number; imageUrl: string };

/** Фото для hero-блока. Лежит локально в public/home/, как и фото входа. */
const HERO_PHOTO = '/home/hero-bowl.png';

/** Ссылка кнопки «Создать план питания» — тот же раздел, что и в быстром доступе. */
const CREATE_PLAN_TO = '/meal-plan';

const SECTIONS = [
  {
    to: '/meal-plan',
    Icon: UtensilsCrossed,
    title: 'План питания',
    text: 'Сборка рациона на 1–30 дней с расчётом КБЖУ по составу блюд.',
  },
  {
    to: '/fridge',
    Icon: Refrigerator,
    title: 'Мой холодильник',
    text: 'Продукты по категориям, сроки годности и список покупок.',
  },
  {
    to: '/body-analysis',
    Icon: Activity,
    title: 'Анализ тела',
    text: 'Замеры по зонам силуэта и прогноз изменения фигуры.',
  },
  {
    to: '/food',
    Icon: Apple,
    title: 'Распознавание еды',
    text: 'Фото блюда — состав, калории и предупреждения об аллергенах.',
  },
  {
    to: '/stats',
    Icon: LineChart,
    title: 'Статистика',
    text: 'Динамика веса, ИМТ и калорийности питания по дням.',
  },
] as const;

const STEPS = [
  {
    n: '01',
    title: 'Заполните профиль',
    text: 'Пол, возраст, вес и рост — от них зависят норма калорий и БЖУ.',
  },
  {
    n: '02',
    title: 'Укажите ограничения',
    text: 'Аллергии, тип питания и нежелательные продукты. Они учитываются везде.',
  },
  {
    n: '03',
    title: 'Получите план',
    text: 'Рацион на 1–30 дней: калорийность считается по составу каждого блюда.',
  },
  {
    n: '04',
    title: 'Ведите прогресс',
    text: 'Отмечайте приёмы пищи и следите за динамикой веса и ИМТ.',
  },
] as const;

const SAMPLE_DISHES = [
  { name: 'Борщ украинский', slot: 'Обед', kcal: 393, Icon: Soup },
  { name: 'Сырники со сметаной', slot: 'Завтрак', kcal: 511, Icon: Salad },
  { name: 'Куриная грудка с овощами', slot: 'Ужин', kcal: 458, Icon: UtensilsCrossed },
  { name: 'Гречневая каша с маслом', slot: 'Гарнир', kcal: 310, Icon: Wheat },
] as const;

export const DashboardPage = () => {
  const [stats, setStats] = useState<{ dishes: number; categories: number } | null>(null);
  const [samples, setSamples] = useState<CatalogSample[] | null>(null);

  useEffect(() => {
    let alive = true;
    void publicApi
      .catalogStats()
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch(() => {});

    void publicApi
      .catalogSamples()
      .then((data) => {
        if (alive) setSamples(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="dashboard">
      <header className="dashboard-hero">
        <div className="dashboard-hero-text">
          <p className="eyebrow">Главная</p>
          <h1 className="h1-home">Твой персональный план питания</h1>
          <p className="lead">
            Достигай целей, следи за прогрессом и заботься о себе с умом
          </p>
          <Link to={CREATE_PLAN_TO} className="btn-primary hero-cta">
            Создать план питания
          </Link>
        </div>
        <div className="dashboard-hero-photo" aria-hidden="true">
          <img src={HERO_PHOTO} alt="" loading="eager" />
        </div>
      </header>

      <h2 className="dashboard-block-title">Быстрый доступ</h2>

      <section className="section-grid" aria-label="Разделы">
        {SECTIONS.map(({ to, Icon, title, text }) => (
          <Link key={to} to={to} className="section-tile">
            <span className="section-tile-head">
              <Icon size={18} strokeWidth={1.75} aria-hidden />
              <span className="section-tile-title">{title}</span>
            </span>
            <span className="section-tile-text">{text}</span>
          </Link>
        ))}
      </section>

      <section className="dashboard-block" aria-label="Как это работает">
        <h2 className="dashboard-block-title">Как это работает</h2>
        <ol className="steps-grid">
          {STEPS.map((step) => (
            <li key={step.n} className="step-card">
              <span className="step-number mono">{step.n}</span>
              <span className="step-title">{step.title}</span>
              <span className="step-text">{step.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="dashboard-block" aria-label="Что в каталоге">
        <h2 className="dashboard-block-title">Что в каталоге</h2>
        <div className="dish-sample-grid">
          {samples && samples.length
            ? samples.map((d) => (
                <article key={d.id} className="dish-sample has-photo">
                  <span className="dish-sample-photo">
                    <img src={d.imageUrl} alt="" loading="lazy" />
                  </span>
                  <span className="dish-sample-body">
                    <span className="dish-sample-name">{d.name}</span>
                    <span className="dish-sample-meta">
                      {d.slot} · <span className="mono">{d.kcal}</span> ккал
                    </span>
                  </span>
                </article>
              ))
            : SAMPLE_DISHES.map(({ name: dish, slot, kcal, Icon }) => (
                <article key={dish} className="dish-sample">
                  <span className="dish-sample-icon">
                    <Icon size={20} strokeWidth={1.6} aria-hidden />
                  </span>
                  <span className="dish-sample-name">{dish}</span>
                  <span className="dish-sample-meta">
                    {slot} · <span className="mono">{kcal}</span> ккал
                  </span>
                </article>
              ))}
        </div>
        <p className="muted small">
          Калорийность рассчитана по составу блюда, а не взята приблизительно.
        </p>
      </section>

      {stats ? (
        <section className="dashboard-block" aria-label="Показатели">
          <div className="dashboard-metrics">
            <div className="metric">
              <span className="metric-label">Блюд в каталоге</span>
              <span className="metric-value">{stats.dishes}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Категорий приёмов</span>
              <span className="metric-value">{stats.categories}</span>
            </div>
            <div className="metric">
              <span className="metric-label">Продуктов в справочнике</span>
              <span className="metric-value">1200+</span>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
};
