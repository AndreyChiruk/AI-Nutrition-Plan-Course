import { useState } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { Activity, Apple, Home, LayoutList, Leaf, Menu, MessageCircle, Refrigerator, Shield, Sparkles, User, UtensilsCrossed, X } from '../components/icons';
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
  { to: '/food', label: 'Еда', icon: Apple },
  { to: '/stats', label: 'Статистика', icon: Leaf },
  { to: '/recommendations', label: 'Рекомендации ИИ', icon: Sparkles },
  { to: '/chat', label: 'AI-чат', icon: MessageCircle },
  { to: '/admin', label: 'Админ', icon: Shield, adminOnly: true },
];

export const AppLayout = () => {
  const { user, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
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
          <span className="user-email-pill">{user?.email}</span>
          <button type="button" className="btn-logout" onClick={logout}>
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
