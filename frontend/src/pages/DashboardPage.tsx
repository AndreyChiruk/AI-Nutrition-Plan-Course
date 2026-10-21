import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  /* Иконки карточек «Быстрый доступ»: версии Tile* рисуют SVG
     даже при PLAIN_ICONS = true — в макете иконки есть именно здесь.
     Имена обычных (Activity, Apple и т.д.) остаются заглушками,
     поэтому боковое меню не изменится. */
  TileActivity as Activity,
  TileApple as Apple,
  TileDumbbell as Dumbbell,
  TileLineChart as LineChart,
  TileRefrigerator as Refrigerator,
  TileUtensilsCrossed as UtensilsCrossed,
  Salad,
  Soup,
  Wheat,
} from '../components/icons';
import { publicApi } from '../api/services';

/**
 * Главная страница.
 *
 * Прежний вариант начинался с декоративной иллюстрации салата
 * (`FreshHeroIllustration`) и SVG-акцентов с градиентами. Эти элементы
 * не несли информации: занимали половину экрана и создавали ощущение
 * сгенерированного интерфейса.
 *
 * Теперь вместо иллюстрации — сетка разделов: пользователь сразу видит,
 * куда можно перейти и что даёт каждый раздел. Оформление строится
 * на типографике и сетке, без декоративных картинок.
 */

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
    text: 'Сборка рациона на 7–30 дней с расчётом КБЖУ по составу блюд.',
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
    to: '/workout-plan',
    Icon: Dumbbell,
    title: 'План тренировок',
    text: 'Нагрузка согласована с целью по весу и с питанием.',
  },
  {
    to: '/stats',
    Icon: LineChart,
    title: 'Статистика',
    text: 'Динамика веса, калорий и тренировок по дням.',
  },
] as const;

/**
 * Шаги работы с приложением.
 * Короткие и в порядке реального использования — чтобы новый
 * пользователь понял последовательность, а не изучал все разделы.
 */
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
    text: 'Рацион на 7–30 дней: калорийность считается по составу каждого блюда.',
  },
  {
    n: '04',
    title: 'Ведите прогресс',
    text: 'Отмечайте приёмы пищи, следите за динамикой веса и тренировками.',
  },
] as const;

/** Примеры блюд для главной: показывают, что внутри каталога. */
const SAMPLE_DISHES = [
  { name: 'Борщ украинский', slot: 'Обед', kcal: 393, Icon: Soup },
  { name: 'Сырники со сметаной', slot: 'Завтрак', kcal: 511, Icon: Salad },
  { name: 'Куриная грудка с овощами', slot: 'Ужин', kcal: 458, Icon: UtensilsCrossed },
  { name: 'Гречневая каша с маслом', slot: 'Гарнир', kcal: 310, Icon: Wheat },
] as const;

export const DashboardPage = () => {
  /* useAuth здесь больше не нужен: заголовок hero теперь фиксированный
     («Твой персональный план питания» по макету), а не приветствие
     по имени пользователя. */
  /** Показатели каталога — публичный эндпоинт, работает без входа. */
  const [stats, setStats] = useState<{ dishes: number; categories: number } | null>(null);
  /** Блюда для витрины: берём из базы с фотографиями (см. catalog-samples). */
  const [samples, setSamples] = useState<CatalogSample[] | null>(null);

  useEffect(() => {
    let alive = true;
    void publicApi
      .catalogStats()
      .then((data) => {
        if (alive) setStats(data);
      })
      .catch(() => {
        // Показатели не критичны: без них страница остаётся рабочей.
      });

    /* Блюда витрины грузим отдельным запросом: он медленнее из-за
       random(), и его падение не должно ломать всю главную. */
    void publicApi
      .catalogSamples()
      .then((data) => {
        if (alive) setSamples(data);
      })
      .catch(() => {
        // Витрина не критична: останутся карточки без фото.
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="dashboard">
      {/* Hero по макету: слева заголовок, подзаголовок и КНОПКА
          «Создать план питания» (ведёт в тот же раздел, что и карточка
          «План питания» в быстром доступе); справа — фото блюда. */}
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

      {/* Как это работает: последовательность действий. */}
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

      {/* Блюда берём из базы (с фото), а не из захардкоженного списка:
          у трёх из четырёх прежних блюд фотографий в products нет,
          поэтому на витрине были пустые заглушки. Если запрос не
          прошёл — показываем прежний список с иконками. */}
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

      {/* Показатели каталога. */}
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
