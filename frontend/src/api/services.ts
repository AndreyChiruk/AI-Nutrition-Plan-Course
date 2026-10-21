import { api } from './client';
import type {
  AuthResponse,
  BodyAnalysisResult,
  SubscriptionStatusResponse,
  BodyAnalysisPageState,
  BodyForecastResponse,
  ChatMessage,
  EmailCodePurpose,
  FoodMealSubmitResponse,
  FoodPreviewResponse,
  Recommendation,
  SendEmailCodeResponse,
} from '../types';

/**
 * Публичные эндпоинты: работают без авторизации.
 * Используются на главной странице и на странице входа.
 */
export const publicApi = {
  /** Показатели каталога: количество блюд и категорий. */
  catalogStats: async () => {
    const { data } = await api.get<{
      dishes: number;
      categories: number;
      withAlcohol: number;
    }>('/health/catalog-stats');
    return data;
  },

  /** Несколько блюд с фото для блока «Что в каталоге» на главной. */
  catalogSamples: async () => {
    const { data } = await api.get<
      Array<{ id: string; name: string; slot: string; kcal: number; imageUrl: string }>
    >('/health/catalog-samples');
    return data;
  },
};

export const authApi = {
  sendEmailCode: async (email: string, purpose: EmailCodePurpose) => {
    const { data } = await api.post<SendEmailCodeResponse>('/auth/email/send-code', {
      email,
      purpose,
    });
    return data;
  },
  loginWithPassword: async (email: string, password: string) => {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, password });
    return data;
  },
  loginWithCode: async (email: string, code: string) => {
    const { data } = await api.post<AuthResponse>('/auth/login', { email, code });
    return data;
  },
  register: async (payload: Record<string, unknown>) => {
    const { data } = await api.post<AuthResponse>('/auth/register', payload);
    return data;
  },
  resetPassword: async (email: string, code: string, newPassword: string) => {
    const { data } = await api.post<{ ok: boolean }>('/auth/password-reset', {
      email,
      code,
      newPassword,
    });
    return data;
  },
};

export const userApi = {
  getById: async (userId: string | number) => {
    const { data } = await api.get(`/users/${userId}`);
    return data;
  },
  updateProfile: async (userId: string | number, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/users/${userId}/profile`, payload);
    return data;
  },
  getCalories: async (userId: string | number) => {
    const { data } = await api.get(`/users/${userId}/calories`);
    return data as { bmr: number; dailyCalories: number };
  },
  setAllergies: async (userId: string | number, allergenIds: string[]) => {
    const { data } = await api.patch(`/users/${userId}/allergies`, { allergenIds });
    return data;
  },
  getAllergens: async () => {
    const { data } = await api.get('/users/allergens/list');
    return data as Array<{ id: string; name: string }>;
  },
  changePassword: async (userId: string | number, oldPassword: string, newPassword: string) => {
    const { data } = await api.post(`/users/${userId}/change-password`, {
      oldPassword,
      newPassword,
    });
    return data;
  },
  listFridge: async (userId: string | number) => {
    const { data } = await api.get<
      Array<{ id: string; name: string; quantity: number; unit: string; ingredientId?: string | null; expiresAt?: string | null }>
    >(`/users/${userId}/fridge`);
    return data;
  },
  addFridgeItem: async (
    userId: string | number,
    payload: { name: string; quantity?: number; unit?: string; expiresAt?: string | null },
  ) => {
    const { data } = await api.post(`/users/${userId}/fridge`, payload);
    return data;
  },
  updateFridgeItem: async (
    userId: string | number,
    itemId: string,
    payload: { name?: string; quantity?: number; unit?: string; expiresAt?: string | null },
  ) => {
    const { data } = await api.patch(`/users/${userId}/fridge/${itemId}`, payload);
    return data;
  },
  deleteFridgeItem: async (userId: string | number, itemId: string) => {
    const { data } = await api.delete(`/users/${userId}/fridge/${itemId}`);
    return data as { ok: boolean };
  },
  listUserProducts: async (userId: string | number) => {
    return userApi.listFridge(userId);
  },
  /**
   * Каких продуктов из рецепта не хватает в холодильнике.
   * Используется на странице плана: что нужно докупить.
   */
  missingFridge: async (
    userId: string | number,
    ingredients: Array<{ name: string; grams?: number }>,
  ) => {
    const { data } = await api.post<{ have: string[]; missing: string[] }>(
      `/users/${userId}/fridge/missing`,
      { ingredients },
    );
    return data;
  },
  addUserProduct: async (
    userId: string | number,
    payload: { name: string; quantity?: number; unit?: string; expiresAt?: string | null },
  ) => {
    return userApi.addFridgeItem(userId, payload);
  },
  updateUserProduct: async (
    userId: string | number,
    itemId: string,
    payload: { name?: string; quantity?: number; unit?: string; expiresAt?: string | null },
  ) => {
    return userApi.updateFridgeItem(userId, itemId, payload);
  },
  /**
   * Загружает фотографию продукта.
   *
   * Отправляется multipart/form-data: файл может весить несколько
   * мегабайт, и base64 в JSON раздул бы запрос примерно на треть.
   */
  uploadUserProductImage: async (
    userId: string | number,
    itemId: string,
    file: File,
  ) => {
    const form = new FormData();
    form.append('image', file);
    const { data } = await api.post<{ imageUrl: string; imageSource: 'user' }>(
      `/users/${userId}/fridge/${itemId}/image`,
      form,
      // Content-Type не задаём: axios подставит его сам вместе с boundary.
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
  },

  /** Удаляет фотографию продукта — остаётся заглушка по категории. */
  deleteUserProductImage: async (userId: string | number, itemId: string) => {
    const { data } = await api.delete<{ imageUrl: null; imageSource: 'placeholder' }>(
      `/users/${userId}/fridge/${itemId}/image`,
    );
    return data;
  },

  deleteUserProduct: async (userId: string | number, itemId: string) => {
    return userApi.deleteFridgeItem(userId, itemId);
  },
};

export const bodyApi = {
  analyze: async (userId: string | number, photoUrl: string) => {
    const { data } = await api.post<BodyAnalysisResult & { analyzedAt?: string }>('/body-analysis/analyze', {
      userId,
      photoUrl,
    });
    return data;
  },
  forecast: async (userId: string | number, durationWeeks: number) => {
    const { data } = await api.post<BodyForecastResponse>('/body-analysis/forecast', {
      userId,
      durationWeeks,
    });
    return data;
  },
  pageState: async (userId: string | number) => {
    const { data } = await api.get<BodyAnalysisPageState>(`/body-analysis/page-state/${userId}`, {
      params: { _t: Date.now() },
    });
    return data;
  },
  basicRecommendations: async (userId: string | number) => {
    const { data } = await api.get(`/body-analysis/basic-recommendations/${userId}`);
    return data;
  },
};

export const statsApi = {
  /**
   * Скачивает CSV со статистикой пользователя.
   *
   * Раньше эндпоинт экспорта возвращал заглушку `date,calories\n2026-01-01,1800`
   * и не использовался интерфейсом вовсе. Теперь выгружаются реальные данные,
   * а файл сохраняется через Blob.
   */
  downloadCsv: async (userId: string | number) => {
    const { data } = await api.get(`/stats/export/csv/${userId}`, { responseType: 'blob' });
    const blob = new Blob([data as BlobPart], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `stats-${userId}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return true;
  },
  /** Сведения о доступности PDF-отчёта (или причине недоступности). */
  pdfInfo: async (userId: string | number) => {
    const { data } = await api.get<{
      available: boolean;
      reason?: string;
      suggestedFormat?: string;
      summary: { meals: number; plans: number; bodyMeasurements: number };
    }>(`/stats/export/pdf/${userId}`);
    return data;
  },
  progress: async (userId: string | number) => {
    const { data } = await api.get<Array<{ date: string; calories: number; mealsCount: number }>>(
      `/stats/progress/${userId}`,
    );
    return data;
  },
  kbju: async (userId: string | number) => {
    const { data } = await api.get<{
      itemsCount: number;
      protein: number;
      fat: number;
      carbs: number;
      calories: number;
    }>(`/stats/kbju/${userId}`);
    return data;
  },
  planVsFact: async (userId: string | number) => {
    const { data } = await api.get<{
      targetDailyCalories: number | null;
      totalLoggedCalories: number;
      daysWithMealsLogged: number;
      avgDailyFactCalories: number;
      deltaVsTargetDaily: number | null;
      planId: string | null;
    }>(`/stats/plan-vs-fact/${userId}`);
    return data;
  },
  summary: async (userId: string | number) => {
    const { data } = await api.get<{
      mealPlansCount: number;
      workoutPlansCount: number;
      foodRecognitionCount: number;
    }>(`/stats/summary/${userId}`);
    return data;
  },
  bodyMetrics: async (userId: string | number) => {
    const { data } = await api.get<Array<{ sortAt: string; date: string; weight: number; bmi: number }>>(
      `/stats/body-metrics/${userId}`,
    );
    return data;
  },
};

export const foodRecognitionApi = {
  analyze: async (userId: string | number, photoUrl: string) => {
    const { data } = await api.post<FoodPreviewResponse>('/food-recognition/analyze', {
      userId,
      photoUrl,
    });
    return data;
  },
  submitMeal: async (
    userId: string | number,
    payload: { photoUrl: string; confidence: number; items: FoodPreviewResponse['items'] },
  ) => {
    const { data } = await api.post<FoodMealSubmitResponse>('/food-recognition/submit-meal', {
      userId,
      photoUrl: payload.photoUrl,
      confidence: payload.confidence,
      items: payload.items,
    });
    return data;
  },
};

export const recommendationApi = {
  getBase: async () => {
    const { data } = await api.get('/recommendations/base');
    return data;
  },
  generate: async (userId: string | number) => {
    const { data } = await api.post<Recommendation>('/recommendations/generate', { userId });
    return data;
  },
};

export type MealIngredient = { name: string; grams: number };
export type MealIngredientDetailed = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  grams: number;
  originalString?: string;
  ingredientId?: string;
};

export type MealSlotSnapshot = {
  dishId?: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergens: string[];
  dietaryTags?: string[];
  category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  ingredients?: MealIngredient[];
  ingredientsDetailed?: MealIngredientDetailed[];
  /** Корни матча с продуктами пользователя (каталог + БД match_keywords) */
  matchKeywords?: string[];
  imageUrl?: string | null;
  note?: string;
  alternatives?: string[];
};

export type MealPlanDayPayload = {
  dayNumber: number;
  breakfast: MealSlotSnapshot | null;
  lunch: MealSlotSnapshot | null;
  dinner: MealSlotSnapshot | null;
  snack: MealSlotSnapshot | null;
  extraSnacks?: MealSlotSnapshot[] | null;
};

export type SavedMealPlan = {
  id: string;
  durationDays: number;
  targetCalories: number;
  startDate: string;
  endDate: string;
  status: string;
  name?: string | null;
  totalCalories?: number | null;
  totalProtein?: number | null;
  totalFat?: number | null;
  totalCarbs?: number | null;
  days: Array<{
    id: string;
    dayNumber: number;
    date: string;
    breakfast: MealSlotSnapshot | null;
    lunch: MealSlotSnapshot | null;
    dinner: MealSlotSnapshot | null;
    /** С бэкенда: массив в колонке snacks (первый = основной перекус). */
    snacks?: MealSlotSnapshot[] | null;
    snack?: MealSlotSnapshot | null;
    extraSnacks?: MealSlotSnapshot[] | null;
    mealStatuses?: Partial<Record<'breakfast' | 'lunch' | 'dinner' | 'snack' | 'snack2', 'done' | 'skipped'>>;
  }>;
};

export type MealPlanSummary = {
  id: string;
  name: string | null;
  startDate: string;
  endDate: string;
  durationDays: number;
  targetCalories: number;
  status: string;
  totalCalories: number | null;
  totalProtein: number | null;
  totalFat: number | null;
  totalCarbs: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CatalogDish = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergens: string[];
  category: string;
  ingredients?: MealIngredient[];
  ingredientsDetailed?: MealIngredientDetailed[];
  matchKeywords?: string[];
  imageUrl?: string | null;
  blockedByAllergen?: boolean;
  dietWarnings?: string[];
  sourceMealId?: string | null;
  description?: string | null;
  cuisine?: string | null;
};

export const mealPlanApi = {
  dishes: async (params?: {
    category?: string;
    search?: string;
    excludeAllergens?: string;
    userId?: string | number;
  }) => {
    const { data } = await api.get<CatalogDish[] | Array<Record<string, unknown>>>('/meal-plan/dishes', { params });
    return data as CatalogDish[];
  },
  getActive: async (userId: string | number) => {
    const { data } = await api.get<SavedMealPlan | null>(`/meal-plan/active/${userId}`);
    return data;
  },
  save: async (
    userId: string | number,
    payload: {
      durationDays: number;
      targetCalories: number;
      days: MealPlanDayPayload[];
      name?: string;
    },
  ) => {
    const { data } = await api.post<SavedMealPlan>('/meal-plan/save', { userId, ...payload });
    return data;
  },
  generate: async (
    userId: string | number,
    durationDays: number,
    opts?: {
      targetCalories?: number;
      calorieMode?: 'precise' | 'approximate';
      calorieBand?: 'low' | 'medium' | 'high' | 'sport';
    },
  ) => {
    const { data } = await api.post<SavedMealPlan & { warnings?: string[] }>('/meal-plan/generate', {
      userId,
      durationDays,
      targetCalories: opts?.targetCalories,
      calorieMode: opts?.calorieMode,
      calorieBand: opts?.calorieBand,
    });
    return data;
  },
  generateAuto: async (
    userId: string | number,
    durationDays: number,
    opts?: {
      targetCalories?: number;
      calorieMode?: 'precise' | 'approximate';
      calorieBand?: 'low' | 'medium' | 'high' | 'sport';
      /** Зерно выбора блюд — позволяет получить другой вариант плана. */
      seed?: number;
    },
  ) => {
    const { data } = await api.post<SavedMealPlan & { warnings?: string[] }>('/meal-plan/generate-auto', {
      userId,
      durationDays,
      targetCalories: opts?.targetCalories,
      calorieMode: opts?.calorieMode,
      calorieBand: opts?.calorieBand,
      // Зерно выбора блюд: без него сервер берёт значение от времени,
      // и повторная генерация даёт новый вариант плана.
      seed: opts?.seed,
    });
    return data;
  },
  generateAiCatalog: async (userId: string | number, durationDays: number, targetCalories?: number) => {
    const { data } = await api.post<SavedMealPlan & { warnings?: string[] }>('/meal-plan/generate-ai-catalog', {
      userId,
      durationDays,
      targetCalories,
    });
    return data;
  },
  refineConstructorAi: async (
    userId: string | number,
    payload: {
      targetCalories: number;
      days: MealPlanDayPayload[];
      auditHint?: string;
    },
  ) => {
    const { data } = await api.post<{
      days: MealPlanDayPayload[];
      overview: string;
      changes: Array<{
        day: number;
        slot: string;
        action: string;
        dishName?: string;
        previousDishName?: string;
        reason: string;
      }>;
      warnings: string[];
    }>('/meal-plan/refine-constructor-ai', { userId, ...payload });
    return data;
  },
  /**
   * Список планов пользователя.
   *
   * Сервер отдаёт страницу `{ rows, count }`: у активного пользователя
   * планов может быть много (в реальных данных уже 45), а раньше
   * возвращались все сразу.
   */
  /**
   * Поиск по каталогу для автокомплита предпочтений.
   * Возвращает ингредиенты и блюда, подходящие под введённый текст.
   */
  catalogSearch: async (q: string, limit = 12) => {
    const { data } = await api.get<Array<{ type: 'ingredient' | 'dish'; name: string; category?: string | null }>>(
      '/meal-plan/catalog-search',
      { params: { q, limit } },
    );
    return data;
  },
  listPlans: async (userId: string | number, params?: { limit?: number; offset?: number }) => {
    const { data } = await api.get<{ rows: MealPlanSummary[]; count: number }>(
      `/meal-plan/plans/${userId}`,
      { params },
    );
    return data;
  },
  getPlan: async (userId: string | number, planId: string) => {
    const { data } = await api.get<SavedMealPlan>(`/meal-plan/plans/${userId}/${planId}`);
    return data;
  },
  deletePlan: async (userId: string | number, planId: string) => {
    const { data } = await api.delete<{ ok: boolean }>(`/meal-plan/plans/${userId}/${planId}`);
    return data;
  },
  clonePlan: async (userId: string | number, planId: string, startDate?: string) => {
    const { data } = await api.post<SavedMealPlan>(`/meal-plan/plans/${userId}/${planId}/clone`, {
      startDate,
    });
    return data;
  },
  /**
   * Делает план текущим.
   *
   * Если план создан по другим ограничениям, сервер не активирует его
   * сразу, а возвращает `requiresConfirmation` со списком различий.
   * Повторный вызов с `force: true` подтверждает активацию.
   */
  activatePlan: async (userId: string | number, planId: string, force = false) => {
    const { data } = await api.post<
      | SavedMealPlan
      | {
          requiresConfirmation: true;
          changed: Array<{ field: string; label: string; before: string; after: string }>;
          planId: string;
          message: string;
        }
    >(`/meal-plan/plans/${userId}/${planId}/activate`, { force });
    return data;
  },
  changeDuration: async (userId: string | number, durationDays: number) => {
    const { data } = await api.post<SavedMealPlan & { warnings?: string[] }>('/meal-plan/duration', {
      userId,
      durationDays,
    });
    return data;
  },
  patchDayMeals: async (
    userId: string | number,
    dayId: string,
    body: Partial<Record<'breakfast' | 'lunch' | 'dinner' | 'snack' | 'snack2', 'done' | 'skipped' | null>>,
  ) => {
    const { data } = await api.post(`/meal-plan/plans/${userId}/days/${dayId}/meals`, body);
    return data as { id: string; mealStatuses: Record<string, 'done' | 'skipped'> };
  },
};

export type WorkoutSessionSnapshot = {
  blockId?: string;
  title: string;
  description: string;
  durationMin: number;
  exercises: string[];
  slot: 'session1' | 'session2' | 'session3' | 'session4';
};

export type WorkoutDayPayload = {
  dayNumber: number;
  session1: WorkoutSessionSnapshot | null;
  session2: WorkoutSessionSnapshot | null;
  session3: WorkoutSessionSnapshot | null;
  session4: WorkoutSessionSnapshot | null;
};

export type WorkoutSessionTrack = 'done' | 'skipped';

export type SavedWorkoutPlan = {
  id: string;
  name?: string | null;
  durationDays: number;
  startDate: string;
  endDate: string;
  status: string;
  trackingStartedAt?: string | null;
  days: Array<{
    id: string;
    dayNumber: number;
    date: string;
    session1: WorkoutSessionSnapshot | null;
    session2: WorkoutSessionSnapshot | null;
    session3: WorkoutSessionSnapshot | null;
    session4: WorkoutSessionSnapshot | null;
    sessionStatuses?: Partial<Record<'session1' | 'session2' | 'session3' | 'session4', WorkoutSessionTrack>>;
  }>;
};

export type WorkoutPlanListItem = {
  id: string;
  name: string | null;
  startDate: string;
  endDate: string;
  durationDays: number;
  status: string;
  trackingStartedAt: string | null;
  createdAt?: string;
};

/**
 * Подписка на ИИ-функции.
 *
 * Все эндпоинты требуют авторизации. Состояние отдаётся сервером,
 * клиент не хранит его локально — иначе после оплаты интерфейс
 * показывал бы устаревшие данные.
 */
export const subscriptionApi = {
  /** Текущее состояние подписки и остаток бесплатных сообщений. */
  status: async () => {
    const { data } = await api.get<SubscriptionStatusResponse>('/subscription/status');
    return data;
  },

  /**
   * Перепроверяет подписку напрямую в Stripe.
   * Нужно при возврате со страницы оплаты: вебхук может задержаться.
   */
  sync: async () => {
    const { data } = await api.post<SubscriptionStatusResponse>('/subscription/sync');
    return data;
  },

  /** Создаёт сессию оплаты, возвращает ссылку на Stripe Checkout. */
  checkout: async () => {
    const { data } = await api.post<{ url: string }>('/subscription/checkout');
    return data;
  },

  /** Ссылка на портал управления подпиской. */
  portal: async () => {
    const { data } = await api.post<{ url: string }>('/subscription/portal');
    return data;
  },
};

export const workoutPlanApi = {
  blocks: async (slot?: string) => {
    const { data } = await api.get<
      Array<{
        id: string;
        slot: string;
        title: string;
        description: string;
        durationMin: number;
        exercises: string[];
      }>
    >('/workout-plan/blocks', { params: slot ? { slot } : {} });
    return data;
  },
  getActive: async (userId: string | number) => {
    const { data } = await api.get<SavedWorkoutPlan | null>(`/workout-plan/active/${userId}`);
    return data;
  },
  getPlan: async (userId: string | number, planId: string) => {
    const { data } = await api.get<SavedWorkoutPlan>(`/workout-plan/plans/${userId}/${planId}`);
    return data;
  },
  listPlans: async (userId: string | number) => {
    const { data } = await api.get<WorkoutPlanListItem[]>(`/workout-plan/plans/${userId}`);
    return data;
  },
  deletePlan: async (userId: string | number, planId: string) => {
    const { data } = await api.delete<{ ok: boolean }>(`/workout-plan/plans/${userId}/${planId}`);
    return data;
  },
  clonePlan: async (userId: string | number, planId: string, startDate?: string) => {
    const { data } = await api.post<SavedWorkoutPlan>(`/workout-plan/plans/${userId}/${planId}/clone`, {
      startDate,
    });
    return data;
  },
  activatePlan: async (userId: string | number, planId: string) => {
    const { data } = await api.post<SavedWorkoutPlan>('/workout-plan/plans/activate', { userId, planId });
    return data;
  },
  startTracking: async (userId: string | number, planId: string) => {
    const { data } = await api.post<SavedWorkoutPlan>('/workout-plan/plans/tracking-start', { userId, planId });
    return data;
  },
  completeTracking: async (userId: string | number, planId: string, early: boolean) => {
    const { data } = await api.post<SavedWorkoutPlan>('/workout-plan/plans/tracking-complete', {
      userId,
      planId,
      early,
    });
    return data;
  },
  patchDaySessions: async (
    userId: string | number,
    dayId: string,
    body: Partial<Record<'session1' | 'session2' | 'session3' | 'session4', WorkoutSessionTrack | null>>,
  ) => {
    const { data } = await api.patch<{ id: string; sessionStatuses: Record<string, 'done' | 'skipped'> }>(
      `/workout-plan/plans/${userId}/days/${dayId}/sessions`,
      body,
    );
    return data;
  },
  save: async (
    userId: string | number,
    payload: { durationDays: number; days: WorkoutDayPayload[]; name?: string },
  ) => {
    const { data } = await api.post<SavedWorkoutPlan>('/workout-plan/save', { userId, ...payload });
    return data;
  },
  generate: async (userId: string | number, durationDays: number) => {
    const { data } = await api.post<SavedWorkoutPlan>('/workout-plan/generate', { userId, durationDays });
    return data;
  },
};

export const adminApi = {
  overview: async () => {
    const { data } = await api.get('/admin/stats/overview');
    return data;
  },
  users: async () => {
    const { data } = await api.get('/admin/users');
    return data;
  },
  pendingMeals: async (params?: { limit?: number; offset?: number }) => {
    const { data } = await api.get<{ rows: unknown[]; count: number }>('/admin/meals/pending', {
      params,
    });
    return data;
  },
  createUser: async (payload: Record<string, unknown>) => {
    const { data } = await api.post('/admin/users', payload);
    return data;
  },
  updateUser: async (id: string | number, payload: Record<string, unknown>) => {
    const { data } = await api.patch(`/admin/users/${id}`, payload);
    return data;
  },
  deleteUser: async (id: string | number) => {
    const { data } = await api.delete(`/admin/users/${id}`);
    return data;
  },
  getBaseRecommendations: async () => {
    const { data } = await api.get('/admin/base-recommendations');
    return data;
  },
  createBaseRecommendation: async (payload: Record<string, unknown>) => {
    const { data } = await api.post('/admin/base-recommendations', payload);
    return data;
  },
  updateBaseRecommendation: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.put(`/admin/base-recommendations/${id}`, payload);
    return data;
  },
  deleteBaseRecommendation: async (id: string) => {
    const { data } = await api.delete(`/admin/base-recommendations/${id}`);
    return data;
  },
  /**
   * Продукты с пагинацией.
   * Раньше сервер отдавал все 669 позиций (2.8 МБ) — теперь страницами.
   */
  getProducts: async (params?: {
    limit?: number;
    offset?: number;
    search?: string;
    category?: string;
  }) => {
    const { data } = await api.get<{ rows: unknown[]; count: number }>('/admin/products', { params });
    return data;
  },
  productsCount: async () => {
    const { data } = await api.get<{ count: number }>('/admin/products/count');
    return data.count;
  },
  getIngredients: async (params?: { category?: string; search?: string; limit?: number; offset?: number }) => {
    const { data } = await api.get<
      Array<{ id: string; name: string; category: string; defaultUnit: string; caloriesPerUnit: number | null }>
    >('/admin/ingredients', { params });
    return data;
  },
  createProduct: async (payload: Record<string, unknown>) => {
    const { data } = await api.post('/admin/products', payload);
    return data;
  },
  updateProduct: async (id: string, payload: Record<string, unknown>) => {
    const { data } = await api.put(`/admin/products/${id}`, payload);
    return data;
  },
  deleteProduct: async (id: string) => {
    const { data } = await api.delete(`/admin/products/${id}`);
    return data;
  },
  importPublicProducts: async (limit?: number) => {
    const { data } = await api.post<{ imported: number; skipped: number }>(
      '/admin/products/import-public',
      {},
      { params: limit != null ? { limit } : {} },
    );
    return data;
  },
  backfillProductIngredients: async () => {
    const { data } = await api.post<{ updated: number; total: number }>('/admin/products/backfill-ingredients');
    return data;
  },
  replaceCatalogTheMealDb: async (opts?: {
    perCategory?: number;
    delayMs?: number;
    ingredientDetails?: boolean;
  }) => {
    const { data } = await api.post<{
      removed: number;
      imported: number;
      skippedDuplicates: number;
      recipesGoalReached: boolean;
      uniqueRecipesSeen: number;
      ingredientRows: number;
      categoriesProcessed: number;
      errors: string[];
      mealPlanDaysScanned: number;
      mealPlanDaysUpdated: number;
      mealPlanSnapshotCellsUpdated: number;
    }>('/admin/products/replace-catalog-themealdb', undefined, {
      params: {
        perCategory: opts?.perCategory,
        delayMs: opts?.delayMs,
        ingredientDetails: opts?.ingredientDetails ? '1' : undefined,
      },
    });
    return data;
  },
  aiLocalizeCatalogBatch: async (opts?: { limit?: number; offset?: number; onlyMissingDetailed?: boolean }) => {
    const { data } = await api.post<{
      model: string;
      limit: number;
      offset: number;
      processed: number;
      updated: number;
      failed: number;
      mealPlanDaysScanned: number;
      mealPlanDaysUpdated: number;
      mealPlanSnapshotCellsUpdated: number;
      errors: string[];
      processedItems: Array<{ id: string; nameBefore: string; updated: boolean }>;
    }>('/admin/products/ai-localize-batch', undefined, {
      params: {
        limit: opts?.limit,
        offset: opts?.offset,
        onlyMissingDetailed: opts?.onlyMissingDetailed ? '1' : undefined,
      },
    });
    return data;
  },
  aiLocalizeCatalogAll: async (opts?: { batchSize?: number; onlyMissingDetailed?: boolean }) => {
    const { data } = await api.post<{
      model: string;
      batchSize: number;
      onlyMissingDetailed: boolean;
      totalCandidates: number;
      batches: number;
      processed: number;
      updated: number;
      failed: number;
      mealPlanDaysScanned: number;
      mealPlanDaysUpdated: number;
      mealPlanSnapshotCellsUpdated: number;
      errors: string[];
      processedItems: Array<{ id: string; nameBefore: string; updated: boolean }>;
    }>('/admin/products/ai-localize-all', undefined, {
      params: {
        batchSize: opts?.batchSize,
        onlyMissingDetailed: opts?.onlyMissingDetailed ? '1' : undefined,
      },
    });
    return data;
  },
  aiLocalizeProductById: async (id: string) => {
    const { data } = await api.post<{
      model: string;
      id: string;
      updated: boolean;
      error: string | null;
      mealPlanDaysScanned: number;
      mealPlanDaysUpdated: number;
      mealPlanSnapshotCellsUpdated: number;
    }>(`/admin/products/${id}/ai-localize`);
    return data;
  },
  confirmMeal: async (id: string) => {
    const { data } = await api.post(`/admin/meals/${id}/confirm`);
    return data;
  },
  /**
   * Исправление распознавания перед подтверждением.
   *
   * Раньше админ мог только подтвердить или отклонить запись: если модель
   * ошиблась в калорийности или не указала аллерген, исправить это было
   * нечем — приходилось отклонять корректное в целом блюдо.
   * ВАЖНО: передаём ПОЛНЫЙ список позиций, так как сервер заменяет его целиком.
   */
  correctMeal: async (
    id: string,
    payload: { items: Array<Record<string, unknown>>; adminNote?: string },
  ) => {
    const { data } = await api.put(`/admin/meals/${id}/correct`, payload);
    return data;
  },
  rejectMeal: async (id: string) => {
    const { data } = await api.delete(`/admin/meals/${id}/reject`);
    return data;
  },
  blockUser: async (id: string | number) => {
    const { data } = await api.post(`/admin/users/${id}/block`);
    return data;
  },
  unblockUser: async (id: string | number) => {
    const { data } = await api.post(`/admin/users/${id}/unblock`);
    return data;
  },
  openAiBilling: async () => {
    const { data } = await api.get('/admin/openai/billing');
    return data;
  },
};

export const chatApi = {
  history: async (userId: string | number) => {
    const { data } = await api.get<ChatMessage[]>(`/chat/history/${userId}`);
    return data;
  },
  sendMessage: async (userId: string | number, message: string) => {
    const { data } = await api.post<{ reply: ChatMessage; history: ChatMessage[] }>(
      '/chat/message',
      {
        userId,
        message,
      },
    );
    return data;
  },
};
