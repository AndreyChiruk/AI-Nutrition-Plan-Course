import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './theme.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './styles/fonts';
// «Обычный» вариант оформления. Уберите строку ниже,
// чтобы вернуть прежний вид (см. src/styles/plain-theme.ts).
import './styles/plain-theme';

document.documentElement.setAttribute('data-theme', localStorage.getItem('ui-theme') ?? 'dark');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
