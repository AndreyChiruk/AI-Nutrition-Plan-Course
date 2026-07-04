import { Link } from 'react-router-dom';
import { Activity, Apple, Dumbbell, LineChart, Sparkles, UtensilsCrossed } from 'lucide-react';
import { FreshHeroIllustration } from '../components/FreshHeroIllustration';
import { AccentActivitySvg } from '../components/DecorativeAccents';
import { useAuth } from '../context/AuthContext';

export const DashboardPage = () => {
  const { user } = useAuth();
  return (
    <div className="dashboard">
      <section className="card card--interactive dashboard-hero">
        <div>
          <h2>Ваш личный помощник по питанию</h2>
          <p className="lead muted">
            Добро пожаловать,{' '}
            {user?.email ? <strong className="dashboard-welcome-name">{user.email}</strong> : 'друг'}. Планируйте
            рацион, следите за прогрессом и получайте дружелюбные подсказки.
          </p>
          <div className="dashboard-hero-cta" role="navigation" aria-label="Быстрые действия">
            <Link className="btn-link-outline" to="/meal-plan">
              <UtensilsCrossed size={18} strokeWidth={2} />
              План питания
            </Link>
            <Link className="btn-link-outline" to="/food">
              <Apple size={18} strokeWidth={2} />
              Еда
            </Link>
            <Link className="btn-link-outline" to="/stats">
              <LineChart size={18} strokeWidth={2} />
              Статистика
            </Link>
            <Link className="btn-link-outline" to="/recommendations">
              <Sparkles size={18} strokeWidth={2} />
              Советы ИИ
            </Link>
          </div>
          <p className="muted small dashboard-accent-hint">
            <span className="chip chip--accent">Ккал</span>
            важные значения выделены тёплым акцентом — следите за балансом без стресса.
          </p>
        </div>
        <div className="dashboard-illustration-wrap" aria-hidden>
          <FreshHeroIllustration />
        </div>
      </section>

      <div className="card goal-progress-card">
        <p className="small muted goal-progress-title">Цель дня</p>
        <div className="progress-track" aria-hidden>
          <div className="progress-fill progress-fill--70" />
        </div>
        <p className="muted small goal-progress-caption">
          Визуализация плана (подсказка: держитесь в комфортном дефиците или поддержке)
        </p>
      </div>

      <section className="feature-grid-animated">
        <div className="card card--interactive feature-tile">
          <h3>
            <Activity size={22} strokeWidth={2} />
            Анализ тела
          </h3>
          <div className="feature-tile-deco" aria-hidden>
            <AccentActivitySvg />
          </div>
          <p className="muted">Фото и мягкая оценка динамики — без жёстких цифр на весь экран.</p>
        </div>
        <div className="card card--interactive feature-tile">
          <h3>
            <UtensilsCrossed size={22} strokeWidth={2} />
            План на неделю
          </h3>
          <p className="muted">Сборка приёмов пищи на 7–30 дней с учётом вашей цели и вкуса.</p>
        </div>
        <div className="card card--interactive feature-tile feature-tile--wide">
          <h3>
            <Dumbbell size={22} strokeWidth={2} />
            Движение и питание вместе
          </h3>
          <p className="muted">Тренировки и еда в одном сервисе — меньше переключений, больше ясности.</p>
        </div>
      </section>
    </div>
  );
};
