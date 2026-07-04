import axios from 'axios';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, Lock, Mail, Moon, Sun, User, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import type { EmailCodePurpose } from '../types';

const LOGIN_ART_SLIDES = [
  {
    url: 'https://images.unsplash.com/photo-1498837167922-ddd27525d352?auto=format&fit=crop&w=1200&q=75',
    caption: 'Сбалансированное питание — первый шаг к цели',
  },
  {
    url: 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1200&q=75',
    caption: 'Больше цвета на тарелке — больше витаминов без усложнений',
  },
  {
    url: 'https://images.unsplash.com/photo-1490645935967-10de6ba17061?auto=format&fit=crop&w=1200&q=75',
    caption: 'От трекинга калорий к осознанным привычкам',
  },
  {
    url: 'https://images.unsplash.com/photo-1466637574441-749b8f19452f?auto=format&fit=crop&w=1200&q=75',
    caption: 'Планы питания и единый профиль — всё в одном месте',
  },
] as const;

const SLIDE_INTERVAL_MS = 8500;

function slideBackground(theme: 'dark' | 'light', url: string): string {
  const overlay =
    theme === 'dark'
      ? 'linear-gradient(rgba(15, 23, 42, 0.42), rgba(15, 23, 42, 0.82))'
      : 'linear-gradient(rgba(255, 255, 255, 0.12), rgba(17, 24, 39, 0.46))';
  return `${overlay}, url(${url})`;
}

export const LoginPage = () => {
  const { login, register } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [loginSubMode, setLoginSubMode] = useState<'password' | 'code'>('password');
  const [imageIndex, setImageIndex] = useState(0);
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [registerEmailCode, setRegisterEmailCode] = useState('');
  const [name, setName] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [error, setError] = useState('');
  const [resetError, setResetError] = useState('');
  const [toast, setToast] = useState('');
  const [codeSending, setCodeSending] = useState(false);
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [resetCode, setResetCode] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    const t = localStorage.getItem('ui-theme');
    return t === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ui-theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));

  const slideTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startSlideRotation = useCallback(() => {
    if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    slideTimerRef.current = setInterval(() => {
      setImageIndex((prev) => (prev + 1) % LOGIN_ART_SLIDES.length);
    }, SLIDE_INTERVAL_MS);
  }, []);

  useEffect(() => {
    LOGIN_ART_SLIDES.forEach((slide) => {
      const img = new Image();
      img.decoding = 'async';
      img.src = slide.url;
    });
  }, []);

  useEffect(() => {
    startSlideRotation();
    return () => {
      if (slideTimerRef.current) clearInterval(slideTimerRef.current);
    };
  }, [startSlideRotation]);

  const goToSlide = (index: number) => {
    setImageIndex(index);
    startSlideRotation();
  };

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(timer);
  }, [toast]);

  const isEmailValid = useMemo(() => /\S+@\S+\.\S+/.test(email), [email]);

  const sendCode = async (purpose: EmailCodePurpose) => {
    setError('');
    setResetError('');
    if (!isEmailValid) {
      const msg = 'Введите корректный email.';
      if (resetModalOpen) setResetError(msg);
      else setError(msg);
      return;
    }
    setCodeSending(true);
    try {
      const res = await authApi.sendEmailCode(email.trim(), purpose);
      let msg = res.message ?? 'Код отправлен на email';
      if (res.devCode) {
        msg += ` (dev: ${res.devCode})`;
      }
      setToast(msg);
    } catch (err) {
      const backendMessage = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string } | undefined)?.message
        : undefined;
      const msg = backendMessage ?? 'Не удалось отправить код.';
      if (resetModalOpen) setResetError(msg);
      else setError(msg);
    } finally {
      setCodeSending(false);
    }
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!isEmailValid) {
      setError('Введите корректный email.');
      return;
    }

    try {
      if (mode === 'login') {
        if (loginSubMode === 'password') {
          if (password.length < 6) {
            setError('Пароль должен содержать минимум 6 символов.');
            return;
          }
          await login(email.trim(), password, 'password');
        } else {
          if (!loginCode.trim()) {
            setError('Введите код из письма.');
            return;
          }
          await login(email.trim(), loginCode.trim(), 'code');
        }
        if (!rememberMe) {
          localStorage.removeItem('refreshToken');
        }
        setToast(`Добро пожаловать, ${email}!`);
      } else {
        if (!name.trim()) {
          setError('Имя обязательно.');
          return;
        }
        if (password.length < 6) {
          setError('Пароль должен содержать минимум 6 символов.');
          return;
        }
        if (password !== confirmPassword) {
          setError('Пароли не совпадают.');
          return;
        }
        if (!acceptTerms) {
          setError('Необходимо принять условия использования.');
          return;
        }
        if (!registerEmailCode.trim()) {
          setError('Введите код из письма (кнопка «Код на email»).');
          return;
        }
        await register({
          email: email.trim(),
          password,
          emailCode: registerEmailCode.trim(),
          role: 'user',
          height: 170,
          weight: 70,
          gender: 'male',
          birthDate: '1995-01-01',
          goal: 'maintain',
          activityLevel: 'moderate',
          displayName: name.trim(),
        });
        setToast(`Добро пожаловать, ${name}!`);
      }
      navigate('/');
    } catch (err) {
      const backendMessage = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string } | undefined)?.message
        : undefined;
      setError(
        backendMessage ??
          (mode === 'login'
            ? 'Вход не выполнен. Проверьте данные и доступность сервера.'
            : 'Регистрация не выполнена. Проверьте корректность данных.'),
      );
    }
  };

  const onResetSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setResetError('');
    if (!isEmailValid) {
      setResetError('Введите корректный email.');
      return;
    }
    if (!resetCode.trim()) {
      setResetError('Введите код из письма.');
      return;
    }
    if (resetPassword.length < 6) {
      setResetError('Новый пароль — минимум 6 символов.');
      return;
    }
    if (resetPassword !== resetConfirm) {
      setResetError('Пароли не совпадают.');
      return;
    }
    try {
      await authApi.resetPassword(email.trim(), resetCode.trim(), resetPassword);
      setToast('Пароль обновлён. Войдите с новым паролем.');
      setResetModalOpen(false);
      setResetCode('');
      setResetPassword('');
      setResetConfirm('');
      setMode('login');
      setLoginSubMode('password');
    } catch (err) {
      const backendMessage = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string } | undefined)?.message
        : undefined;
      setResetError(backendMessage ?? 'Не удалось сменить пароль.');
    }
  };

  const openResetModal = () => {
    setError('');
    setResetError('');
    setResetModalOpen(true);
  };

  return (
    <div className="login-page">
      <div className="login-page-toolbar">
        <button type="button" className="ghost-icon theme-toggle" onClick={toggleTheme} title="Тема">
          {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
        </button>
      </div>
      <div className="login-art" aria-hidden="true">
        {LOGIN_ART_SLIDES.map((slide, i) => (
          <div
            key={slide.url}
            className={`login-art-slide ${imageIndex === i ? 'is-visible' : ''}`}
            style={{ backgroundImage: slideBackground(theme, slide.url) }}
          />
        ))}
        <div className="login-art-overlay">
          <div className="login-art-caption-wrap">
            <p key={imageIndex} className="login-art-caption">
              {LOGIN_ART_SLIDES[imageIndex].caption}
            </p>
          </div>
          <div className="login-art-dots">
            {LOGIN_ART_SLIDES.map((slide, i) => (
              <button
                key={slide.url}
                type="button"
                className={imageIndex === i ? 'active' : ''}
                aria-label={`Слайд ${i + 1}`}
                aria-current={imageIndex === i ? 'true' : undefined}
                onClick={() => goToSlide(i)}
              />
            ))}
          </div>
        </div>
      </div>
      <div className={`card narrow auth-card ${mode}`}>
        <div className="auth-tabs">
          <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
            Вход
          </button>
          <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
            Регистрация
          </button>
        </div>

        <h2>{mode === 'login' ? 'Добро пожаловать!' : 'Создать аккаунт'}</h2>
        <p className="muted">Начни свой путь к здоровому питанию</p>

        <form onSubmit={onSubmit} className="stack auth-form">
          {mode === 'register' ? (
            <label className="input-icon">
              <User size={16} />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" />
            </label>
          ) : null}

          <label className="input-icon">
            <Mail size={16} />
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
          </label>

          {mode === 'login' ? (
            <div className="auth-subtabs">
              <button
                type="button"
                className={loginSubMode === 'password' ? 'active' : ''}
                onClick={() => setLoginSubMode('password')}
              >
                Пароль
              </button>
              <button
                type="button"
                className={loginSubMode === 'code' ? 'active' : ''}
                onClick={() => setLoginSubMode('code')}
              >
                Код из письма
              </button>
            </div>
          ) : null}

          {mode === 'login' && loginSubMode === 'password' ? (
            <label className="input-icon">
              <Lock size={16} />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Пароль"
                type={showPassword ? 'text' : 'password'}
              />
              <button type="button" className="ghost-icon" onClick={() => setShowPassword((prev) => !prev)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </label>
          ) : null}

          {mode === 'login' && loginSubMode === 'code' ? (
            <div className="auth-code-row">
              <label className="input-icon grow">
                <KeyRound size={16} />
                <input
                  value={loginCode}
                  onChange={(e) => setLoginCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Код из письма"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                />
              </label>
              <button
                type="button"
                className="btn-secondary code-send"
                disabled={codeSending}
                onClick={() => sendCode('login')}
              >
                {codeSending ? '…' : 'Код на email'}
              </button>
            </div>
          ) : null}

          {mode === 'register' ? (
            <>
              <div className="auth-code-row">
                <label className="input-icon grow">
                  <KeyRound size={16} />
                  <input
                    value={registerEmailCode}
                    onChange={(e) => setRegisterEmailCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Код из письма"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary code-send"
                  disabled={codeSending}
                  onClick={() => sendCode('register')}
                >
                  {codeSending ? '…' : 'Код на email'}
                </button>
              </div>
              <label className="input-icon">
                <Lock size={16} />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Пароль"
                  type={showPassword ? 'text' : 'password'}
                />
                <button type="button" className="ghost-icon" onClick={() => setShowPassword((prev) => !prev)}>
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </label>
              <label className="input-icon">
                <Lock size={16} />
                <input
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Подтверждение пароля"
                  type={showPassword ? 'text' : 'password'}
                />
              </label>
            </>
          ) : null}

          {mode === 'login' ? (
            <>
              <div className="auth-row">
                <label className="check-item">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                  />
                  Запомнить меня
                </label>
              </div>
              <button type="button" className="btn-primary ripple auth-forgot-password" onClick={openResetModal}>
                Забыли пароль?
              </button>
            </>
          ) : (
            <label className="check-item">
              <input
                type="checkbox"
                checked={acceptTerms}
                onChange={(e) => setAcceptTerms(e.target.checked)}
              />
              Я согласен с условиями использования
            </label>
          )}

          {error ? <p className="error">{error}</p> : null}
          <button type="submit" className="btn-primary ripple">
            {mode === 'login' ? 'Войти' : 'Зарегистрироваться'}
          </button>
        </form>
      </div>
      {toast ? <div className="toast">{toast}</div> : null}

      {resetModalOpen ? (
        <div className="auth-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="reset-title">
          <div className="auth-modal card narrow">
            <div className="auth-modal-head">
              <h3 id="reset-title">Восстановление пароля</h3>
              <button
                type="button"
                className="ghost-icon"
                aria-label="Закрыть"
                onClick={() => {
                  setResetModalOpen(false);
                  setResetError('');
                }}
              >
                <X size={20} />
              </button>
            </div>
            <p className="muted small">
              Укажите email, нажмите «Код на email», затем введите код и новый пароль.
            </p>
            <form onSubmit={onResetSubmit} className="stack auth-form">
              <label className="input-icon">
                <Mail size={16} />
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" />
              </label>
              <div className="auth-code-row">
                <label className="input-icon grow">
                  <KeyRound size={16} />
                  <input
                    value={resetCode}
                    onChange={(e) => setResetCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder="Код из письма"
                    inputMode="numeric"
                  />
                </label>
                <button
                  type="button"
                  className="btn-secondary code-send"
                  disabled={codeSending}
                  onClick={() => sendCode('reset_password')}
                >
                  {codeSending ? '…' : 'Код на email'}
                </button>
              </div>
              <label className="input-icon">
                <Lock size={16} />
                <input
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Новый пароль"
                  type="password"
                />
              </label>
              <label className="input-icon">
                <Lock size={16} />
                <input
                  value={resetConfirm}
                  onChange={(e) => setResetConfirm(e.target.value)}
                  placeholder="Повторите пароль"
                  type="password"
                />
              </label>
              {resetError ? <p className="error">{resetError}</p> : null}
              <button type="submit" className="btn-primary ripple">
                Сохранить новый пароль
              </button>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
};
