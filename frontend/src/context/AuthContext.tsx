import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { bootstrapSession } from '../api/client';
import { authApi } from '../api/services';
import type { AuthResponse } from '../types';

type LoginMode = 'password' | 'code';

type AuthContextValue = {
  user: AuthResponse['user'] | null;
  login: (email: string, secret: string, mode?: LoginMode) => Promise<void>;
  register: (payload: Record<string, unknown>) => Promise<void>;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<AuthResponse['user'] | null>(() => {
    const stored = localStorage.getItem('user');
    return stored ? (JSON.parse(stored) as AuthResponse['user']) : null;
  });

  useEffect(() => {
    const onLost = () => setUser(null);
    window.addEventListener('auth:session-lost', onLost);
    return () => window.removeEventListener('auth:session-lost', onLost);
  }, []);

  useEffect(() => {
    if (!localStorage.getItem('refreshToken')) return;
    void (async () => {
      const ok = await bootstrapSession();
      if (!ok) {
        setUser(null);
        return;
      }
      const raw = localStorage.getItem('user');
      if (raw) {
        try {
          setUser(JSON.parse(raw) as AuthResponse['user']);
        } catch {
          setUser(null);
        }
      }
    })();
  }, []);

  const login = async (email: string, secret: string, mode: LoginMode = 'password') => {
    const data =
      mode === 'code'
        ? await authApi.loginWithCode(email, secret)
        : await authApi.loginWithPassword(email, secret);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
  };

  const register = async (payload: Record<string, unknown>) => {
    const data = await authApi.register(payload);
    localStorage.setItem('accessToken', data.accessToken);
    localStorage.setItem('refreshToken', data.refreshToken);
    localStorage.setItem('user', JSON.stringify(data.user));
    setUser(data.user);
    const displayName =
      typeof payload.displayName === 'string'
        ? payload.displayName.trim()
        : typeof payload.name === 'string'
          ? payload.name.trim()
          : '';
    if (displayName && data.user?.id != null) {
      localStorage.setItem(`profile:name:${data.user.id}`, displayName);
    }
    localStorage.removeItem('profile:name:temp');
  };

  const logout = () => {
    void authApi.logout().catch(() => {});
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('user');
    setUser(null);
  };

  const value = useMemo(() => ({ user, login, register, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};
