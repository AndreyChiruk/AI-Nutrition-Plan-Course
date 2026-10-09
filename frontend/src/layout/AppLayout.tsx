import { useEffect, useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, Apple, BarChart3, Dumbbell, Home, LayoutList, Leaf, LogOut, Menu, MessageCircle, Moon, Refrigerator, Shield, Sparkles, Sun, User, UtensilsCrossed, X } from '../components/icons';
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
    <div className={`app-shell${navOpen ? ' app-shell--nav-open' : ''}`}>
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
            className="nav-burger ghost-icon"
            aria-expanded={navOpen}
            aria-controls="app-sidebar"
            onClick={() => setNavOpen((v) => !v)}
          >
            {navOpen ? <X size={22} /> : <Menu size={22} />}
          </button>
          <div className="brand">
            <Logo variant="full" size={26} />
          </div>
        </div>
        <div className="actions">
          <button type="button" className="ghost-icon theme-toggle" onClick={toggleTheme} title="Тема">
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <span className="user-email-pill">{user?.email}</span>
          <button type="button" className="btn-logout" onClick={logout}>
            <LogOut size={15} strokeWidth={1.75} aria-hidden />
            Выйти
          </button>
        </div>
      </header>
      <nav id="app-sidebar" className="sidebar" aria-label="Основное меню">
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
