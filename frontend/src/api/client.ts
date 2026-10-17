import axios from 'axios';

/**
 * Базовый адрес API.
 *
 * В продакшене фронтенд отдаёт Nginx и проксирует `/api` на backend,
 * поэтому достаточно относительного пути: он работает и по HTTPS,
 * и при смене домена. Явный адрес задаётся через `VITE_API_BASE_URL` —
 * он нужен только при запуске фронтенда отдельно от Nginx, и тогда
 * префикс `/api` обязателен.
 */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
});

let refreshPromise: Promise<string | null> | null = null;

export async function bootstrapSession(): Promise<boolean> {
  if (!localStorage.getItem('refreshToken')) return false;
  const t = await refreshAccessToken();
  return Boolean(t);
}

async function refreshAccessToken(): Promise<string | null> {
  if (refreshPromise) return refreshPromise;
  const rt = localStorage.getItem('refreshToken');
  if (!rt) return null;
  refreshPromise = (async () => {
    try {
      const { data } = await axios.post<{
        accessToken: string;
        refreshToken: string;
      }>(`${API_BASE_URL}/auth/refresh`, { refreshToken: rt });
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      return data.accessToken;
    } catch {
      localStorage.removeItem('accessToken');
      localStorage.removeItem('refreshToken');
      localStorage.removeItem('user');
      window.dispatchEvent(new CustomEvent('auth:session-lost'));
      return null;
    } finally {
      refreshPromise = null;
    }
  })();
  return refreshPromise;
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('accessToken');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const status = error?.response?.status;
    const orig = error.config;
    if (status === 401 && orig && !orig._retry) {
      orig._retry = true;
      const newAccess = await refreshAccessToken();
      if (newAccess) {
        orig.headers = orig.headers ?? {};
        orig.headers.Authorization = `Bearer ${newAccess}`;
        return api(orig);
      }
    }
    return Promise.reject(error);
  },
);
