import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import './theme.css';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import './styles/fonts';

/* Тема зафиксирована в светлой. */
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
