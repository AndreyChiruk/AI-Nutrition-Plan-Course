import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, Apple, ArrowLeft, BarChart3, ChevronRight, Dumbbell, Home, LayoutList, Leaf, Menu, MessageCircle, Refrigerator, Shield, Sparkles, User, UtensilsCrossed, X } from '../components/icons';
import type { LucideIcon } from '../components/icons';
import { useAuth } from '../context/AuthContext';
import { Logo } from '../components/Logo';

const navItems: Array<{
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  adminOnly?: boolean;
}> = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/profile', label: 'Профиль', icon: User },
  { to: '/body-analysis', label: 'Анализ тела', icon: Activity },
  { to: '/fridge', label: 'Холодильник', icon: Refrigerator },
  { to: '/meal-plan', label: 'План питания', icon: UtensilsCrossed },
  { to: '/meal-plans', label: 'Мои планы', icon: LayoutList },
  { to: '/workout-plan', label: 'План тренировок', icon: Dumbbell },
  { to: '/workout-plans', label: 'Тренировки', icon: BarChart3 },
  { to: '/food', label: 'Еда', icon: Apple },
  { to: '/stats', label: 'Статистика', icon: Leaf },
  { to: '/recommendations', label: 'Рекомендации ИИ', icon: Sparkles },
  { to: '/chat', label: 'AI-чат', icon: MessageCircle },
  { to: '/admin', label: 'Админ', icon: Shield, adminOnly: true },
];

export const AppLayout = () => {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  /**
   * Свёрнуто ли боковое меню за левый край.
   *
   * Когда свёрнуто, видна только узкая полоска; наведение на неё
   * плавно выдвигает панель полностью, а уход курсора возвращает её
   * обратно. Выбор запоминается, чтобы меню не разворачивалось при
   * каждом переходе между страницами.
   */
  const [collapsed, setCollapsed] = useState(() => {
    return localStorage.getItem('ui-sidebar-collapsed') === '1';
  });
  /** Меню раскрыто наведением прямо сейчас. */
  const [navHovered, setNavHovered] = useState(false);

  useEffect(() => {
    localStorage.setItem('ui-sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const t = localStorage.getItem('ui-theme');
    return t === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ui-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  return (
    <div
      className={`app-shell${navOpen ? ' app-shell--nav-open' : ''}${
        collapsed ? ' app-shell--nav-collapsed' : ''
      }${collapsed && navHovered ? ' app-shell--nav-peek' : ''}`}
    >
      {navOpen ? (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Закрыть меню"
          onClick={() => setNavOpen(false)}
        />
      ) : null}
      <header className="topbar">
        <div className="topbar-left">
          <button
            type="button"
            className="nav-burger btn-link-outline"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            aria-label={navOpen ? 'Закрыть меню' : 'Открыть меню'}
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? <X size={20} /> : <Menu size={20} />}
            {navOpen ? 'Закрыть' : 'Меню'}
          </button>
          <div className="brand">
            <Logo variant="full" size={26} />
          </div>
        </div>
        <div className="actions">
          <button
            type="button"
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
          >
            Сменить тему
          </button>
          <span className="user-email-pill">{user?.email}</span>
          <button type="button" className="btn-logout" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>
      {/*
        Узкая полоса у левого края: видна только у свёрнутого меню.
        Наведение раскрывает панель, поэтому кнопка не нужна для
        самого выезда — она остаётся для открепления меню.
      */}
      {collapsed ? (
        <div
          className="sidebar-peek"
          aria-hidden="true"
          onMouseEnter={() => setNavHovered(true)}
        />
      ) : null}
      <nav
        id="app-sidebar"
        className="sidebar"
        aria-label="Основное меню"
        onMouseEnter={() => setNavHovered(true)}
        onMouseLeave={() => setNavHovered(false)}
      >
        <button
          type="button"
          className="sidebar-collapse"
          onClick={() => {
            setCollapsed((v) => !v);
            setNavHovered(false);
          }}
          aria-expanded={!collapsed}
          title={collapsed ? 'Закрепить меню' : 'Свернуть меню'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ArrowLeft size={16} />}
          {collapsed ? 'Закрепить' : 'Свернуть'}
        </button>
        {navItems
          .filter((item) => !item.adminOnly || user?.role === 'admin')
          .map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => 'nav-link' + (isActive ? ' active' : '')}
              onClick={() => setNavOpen(false)}
            >
              <Icon size={20} strokeWidth={2} />
              {label}
            </NavLink>
          ))}
      </nav>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
};
