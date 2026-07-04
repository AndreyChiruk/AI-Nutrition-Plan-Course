import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const failRate = new Rate('failed_requests');

export const options = {
  stages: [
    { duration: '30s', target: 5 },
    { duration: '1m', target: 15 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_failed: ['rate<0.1'],
    http_req_duration: ['p(95)<5000'],
    failed_requests: ['rate<0.15'],
  },
};

const BASE = (__ENV.K6_BASE_URL || 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const EMAIL = __ENV.K6_EMAIL || '';
const PASSWORD = __ENV.K6_PASSWORD || '';
const STATIC_TOKEN = __ENV.K6_ACCESS_TOKEN || '';
const STATIC_USER_ID = __ENV.K6_USER_ID || '';
const HEAVY = __ENV.K6_HEAVY === '1' || __ENV.K6_HEAVY === 'true';

function jsonHeaders(token) {
  const h = { 'Content-Type': 'application/json' };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

function login() {
  const res = http.post(
    `${BASE}/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASSWORD }),
    { headers: jsonHeaders(null), tags: { name: 'AuthLogin' } },
  );
  const ok = check(res, {
    'login status 200': (r) => r.status === 200,
  });
  failRate.add(!ok);
  if (!ok || res.status !== 200) return { token: '', userId: '' };
  let body;
  try {
    body = JSON.parse(res.body);
  } catch {
    return { token: '', userId: '' };
  }
  const token = body.accessToken || '';
  const userId = body.user && body.user.id != null ? String(body.user.id) : '';
  return { token, userId };
}

export function setup() {
  let token = STATIC_TOKEN;
  let userId = STATIC_USER_ID;

  if (!token && EMAIL && PASSWORD) {
    const auth = login();
    token = auth.token;
    userId = auth.userId || userId;
  }

  return {
    token,
    userId,
    hasAuth: Boolean(token && userId),
  };
}

export default function (data) {
  // Публичный endpoint без JWT
  {
    const res = http.get(`${BASE}/recommendations/base`, { tags: { name: 'RecommendationsBase' } });
    const ok = check(res, {
      'recommendations/base 200': (r) => r.status === 200 || r.status === 304,
    });
    failRate.add(!ok);
  }

  if (!data.hasAuth) {
    sleep(1);
    return;
  }

  const hdr = jsonHeaders(data.token);
  const uid = data.userId;

  {
    const res = http.get(`${BASE}/users/${uid}`, { headers: hdr, tags: { name: 'UsersGetById' } });
    failRate.add(!check(res, { 'users/:id 200': (r) => r.status === 200 }));
  }

  {
    const res = http.get(`${BASE}/meal-plan/active/${uid}`, { headers: hdr, tags: { name: 'MealPlanActive' } });
    failRate.add(!check(res, { 'meal-plan/active 200 or 404': (r) => r.status === 200 || r.status === 404 }));
  }

  {
    const res = http.get(`${BASE}/stats/summary/${uid}`, { headers: hdr, tags: { name: 'StatsSummary' } });
    failRate.add(!check(res, { 'stats/summary 200': (r) => r.status === 200 }));
  }

  {
    const res = http.get(`${BASE}/stats/progress/${uid}`, { headers: hdr, tags: { name: 'StatsProgress' } });
    failRate.add(!check(res, { 'stats/progress 200': (r) => r.status === 200 }));
  }

  {
    const url = `${BASE}/meal-plan/dishes?userId=${encodeURIComponent(uid)}`;
    const res = http.get(url, { headers: hdr, tags: { name: 'MealPlanDishes' } });
    failRate.add(!check(res, { 'meal-plan/dishes 200': (r) => r.status === 200 }));
  }

  {
    const res = http.get(`${BASE}/chat/history/${uid}`, { headers: hdr, tags: { name: 'ChatHistory' } });
    failRate.add(!check(res, { 'chat/history 200': (r) => r.status === 200 }));
  }

  if (HEAVY) {
    const genRes = http.post(
      `${BASE}/meal-plan/generate-auto`,
      JSON.stringify({
        userId: uid,
        durationDays: 1,
        targetCalories: 2000,
        calorieMode: 'precise',
      }),
      { headers: hdr, tags: { name: 'MealPlanGenerateAuto' } },
    );
    failRate.add(
      !check(genRes, {
        'generate-auto 200/201/502': (r) =>
          r.status === 200 || r.status === 201 || r.status === 502 || r.status === 503,
      }),
    );

    const recRes = http.post(
      `${BASE}/recommendations/generate`,
      JSON.stringify({ userId: uid }),
      { headers: hdr, tags: { name: 'RecommendationsGenerate' } },
    );
    failRate.add(
      !check(recRes, {
        'recommendations/generate ok': (r) =>
          r.status === 200 || r.status === 201 || r.status === 502 || r.status === 503,
      }),
    );
  }

  sleep(1);
}
