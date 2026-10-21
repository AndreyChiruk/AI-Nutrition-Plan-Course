import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './theme.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './styles/fonts';
/* «Обычный» вариант оформления (src/styles/plain-theme.css) ОТКЛЮЧЁН.
   Этот слой грузился последним и перебивал новый дизайн: ставил Arial
   вместо IBM Plex, углы 2px вместо скруглённых, гасил иконки
   (`.section-tile-head svg { display: none !important }`), тени
   и анимации. Из-за него главная не совпадала с макетом
   newdesign/mockup-home-light.png.

   Чтобы вернуть прежнее «слабое» оформление — раскомментируйте
   строку ниже и пересоберите web. */
// import './styles/plain-theme';

/* Тема зафиксирована в светлой.
   Тёмная тема больше не нужна: переключатель убран, а сам атрибут
   всё равно выставляем — от него зависят стили html[data-theme="light"]
   во всём theme.css. Значение из localStorage игнорируем, чтобы у тех,
   у кого там осталось 'dark' с прошлых визитов, страница не осталась
   тёмной навсегда. */
document.documentElement.setAttribute('data-theme', 'light');
localStorage.setItem('ui-theme', 'light');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
