import { computeFullYearsFromBirthDate } from './age.util';
import { normalizeGoalByWeight } from './weight-goal.util';

/**
 * Единый расчёт энергетических потребностей (BMR/TDEE/целевая калорийность).
 *
 * Зачем: в проекте было ДВА расходящихся расчёта.
 *   - `UsersService.calculateBmrAndCalories` — формула Миффлина–Сан Жеора
 *     с корректными коэффициентами активности (1.2 … 1.9) и коррекцией цели
 *     (−400 / 0 / +300). Отдаётся фронтенду через `GET /users/:id/calories`.
 *   - внутри `MealPlanService` — та же формула, но с захардкоженным
 *     коэффициентом 1.5 и `activityLevel`, который вообще не читался,
 *     а возраст считался как `ms / 365.25` (ошибка ±1 год).
 *
 * Для «сидячего» пользователя планировщик завышал норму примерно на 25 %,
 * для «очень активного» — занижал. Теперь расчёт один на весь проект.
 */

export type Gender = 'male' | 'female';
export type Goal = 'lose' | 'maintain' | 'gain';
export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';

/** Коэффициенты физической активности (стандартные множители TDEE). */
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

/** Коррекция калорийности под цель, ккал/сутки. */
export const GOAL_DELTAS: Record<Goal, number> = {
  lose: -400,
  maintain: 0,
  gain: 300,
};

/** Возраст по умолчанию, если дата рождения не задана или некорректна. */
const FALLBACK_AGE = 30;

export type EnergyInput = {
  weightKg: number;
  heightCm: number;
  birthDate?: Date | string | null;
  gender?: Gender | string | null;
  activityLevel?: ActivityLevel | string | null;
  goal?: Goal | string | null;
};

export type EnergyResult = {
  /** Базальный метаболизм, ккал/сутки (Миффлин–Сан Жеор). */
  bmr: number;
  /** Поддержание веса с учётом активности, ккал/сутки. */
  maintenance: number;
  /** Целевая калорийность с учётом цели, ккал/сутки. */
  dailyCalories: number;
  /** Возраст, использованный в расчёте (полных лет). */
  age: number;
  /** Коэффициент активности, использованный в расчёте. */
  activityMultiplier: number;
  /** Цель после нормализации по ИМТ. */
  goal: Goal;
};

/** Аккуратно вычисляет возраст: сначала точный расчёт, затем оценка. */
export function resolveAge(birthDate: Date | string | null | undefined): number {
  if (!birthDate) return FALLBACK_AGE;
  const exact = computeFullYearsFromBirthDate(birthDate as never);
  if (exact !== null && Number.isFinite(exact) && exact >= 0 && exact <= 120) {
    return exact;
  }
  const ms = Date.now() - new Date(birthDate).getTime();
  if (!Number.isFinite(ms)) return FALLBACK_AGE;
  const approx = Math.floor(ms / (1000 * 60 * 60 * 24 * 365.25));
  if (approx < 0 || approx > 120) return FALLBACK_AGE;
  return approx;
}

function normalizeActivity(level: ActivityLevel | string | null | undefined): ActivityLevel {
  const key = String(level ?? '').trim() as ActivityLevel;
  return key in ACTIVITY_MULTIPLIERS ? key : 'moderate';
}

function normalizeGender(gender: Gender | string | null | undefined): Gender {
  return String(gender ?? '').trim() === 'female' ? 'female' : 'male';
}

/**
 * Считает BMR, поддержание и целевую калорийность.
 *
 * Формула Миффлина–Сан Жеора:
 *   мужчины: 10·вес + 6.25·рост − 5·возраст + 5
 *   женщины: 10·вес + 6.25·рост − 5·возраст − 161
 */
export function calculateEnergy(input: EnergyInput): EnergyResult {
  const weight = Number(input.weightKg);
  const height = Number(input.heightCm);
  const safeWeight = Number.isFinite(weight) && weight > 0 ? weight : 70;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : 170;

  const age = resolveAge(input.birthDate);
  const gender = normalizeGender(input.gender);
  const activityMultiplier = ACTIVITY_MULTIPLIERS[normalizeActivity(input.activityLevel)];

  // Нормализация цели по ИМТ: при дефиците веса «похудение» заменяется набором
  // и наоборот — иначе пользователь получает опасную рекомендацию.
  const requestedGoal = (String(input.goal ?? 'maintain').trim() as Goal) || 'maintain';
  const goal = normalizeGoalByWeight(
    ['lose', 'maintain', 'gain'].includes(requestedGoal) ? requestedGoal : 'maintain',
    safeWeight,
    safeHeight,
  );

  const bmrRaw =
    10 * safeWeight + 6.25 * safeHeight - 5 * age + (gender === 'male' ? 5 : -161);
  const bmr = Math.max(0, bmrRaw);
  const maintenance = bmr * activityMultiplier;
  const dailyCalories = maintenance + GOAL_DELTAS[goal];

  return {
    bmr: Math.round(bmr),
    maintenance: Math.round(maintenance),
    // Нижняя граница безопасности: не рекомендуем меньше 1200 ккал/сутки.
    dailyCalories: Math.max(1200, Math.round(dailyCalories)),
    age,
    activityMultiplier,
    goal,
  };
}

/**
 * Целевая калорийность с приоритетом явно заданного значения.
 * Используется планировщиком: `targetCalories` из запроса → сохранённый
 * в профиле → расчёт по формуле.
 */
export function resolveTargetCalories(
  input: EnergyInput,
  explicit?: number | null,
  stored?: number | null,
): number {
  const e = Number(explicit);
  if (Number.isFinite(e) && e > 0) return Math.round(e);
  const s = Number(stored);
  if (Number.isFinite(s) && s > 0) return Math.round(s);
  return calculateEnergy(input).dailyCalories;
}
