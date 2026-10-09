import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  ACTIVITY_MULTIPLIERS,
  calculateEnergy,
  GOAL_DELTAS,
  resolveAge,
  resolveTargetCalories,
} from '../../common/energy.util';

/**
 * Тесты единого расчёта калорийности.
 *
 * Раньше в проекте было два расходящихся расчёта: `GET /users/:id/calories`
 * использовал корректные коэффициенты активности, а планировщик питания —
 * захардкоженный ×1.5 и игнорировал `activityLevel`. Для «сидячего»
 * пользователя это завышало норму примерно на 25 %, для «очень активного» —
 * занижало почти на 20 %.
 */
describe('energy.util: единый расчёт калорий', () => {
  const base = {
    weightKg: 70,
    heightCm: 175,
    birthDate: '1990-01-01',
    gender: 'male' as const,
    activityLevel: 'moderate' as const,
    goal: 'maintain' as const,
  };

  it('считает BMR по формуле Миффлина–Сан Жеора', () => {
    const r = calculateEnergy(base);
    const age = resolveAge(base.birthDate);
    const expectedBmr = 10 * 70 + 6.25 * 175 - 5 * age + 5;
    assert.approximately(r.bmr, Math.round(expectedBmr), 1);
  });

  it('применяет коэффициент активности, а не фиксированный ×1.5', () => {
    const sedentary = calculateEnergy({ ...base, activityLevel: 'sedentary' });
    const veryActive = calculateEnergy({ ...base, activityLevel: 'very_active' });
    assert.strictEqual(sedentary.activityMultiplier, ACTIVITY_MULTIPLIERS.sedentary);
    assert.strictEqual(veryActive.activityMultiplier, ACTIVITY_MULTIPLIERS.very_active);
    // Ключевой регресс: разница между уровнями должна быть заметной.
    assert.isAbove(veryActive.dailyCalories - sedentary.dailyCalories, 800);
  });

  it('соответствует эталонной формуле для каждого уровня активности', () => {
    for (const level of Object.keys(ACTIVITY_MULTIPLIERS) as Array<
      keyof typeof ACTIVITY_MULTIPLIERS
    >) {
      const r = calculateEnergy({ ...base, activityLevel: level });
      const bmr = 10 * 70 + 6.25 * 175 - 5 * r.age + 5;
      const expected = Math.round(bmr * ACTIVITY_MULTIPLIERS[level] + GOAL_DELTAS.maintain);
      assert.approximately(r.dailyCalories, expected, 1, level);
    }
  });

  it('корректирует калорийность под цель', () => {
    const lose = calculateEnergy({ ...base, goal: 'lose' });
    const maintain = calculateEnergy({ ...base, goal: 'maintain' });
    const gain = calculateEnergy({ ...base, goal: 'gain' });
    assert.isBelow(lose.dailyCalories, maintain.dailyCalories);
    assert.isAbove(gain.dailyCalories, maintain.dailyCalories);
  });

  it('учитывает пол', () => {
    const male = calculateEnergy({ ...base, gender: 'male' });
    const female = calculateEnergy({ ...base, gender: 'female' });
    assert.isAbove(male.bmr, female.bmr);
  });

  it('нормализует цель по ИМТ (защита от опасного совета)', () => {
    // ИМТ ≈ 27.8 — при такой массе цель «набрать» заменяется на «снизить».
    const r = calculateEnergy({ ...base, weightKg: 90, heightCm: 180, goal: 'gain' });
    assert.strictEqual(r.goal, 'lose', 'цель должна быть нормализована');
  });

  it('не опускает норму ниже безопасного минимума', () => {
    const r = calculateEnergy({
      weightKg: 45,
      heightCm: 155,
      birthDate: '2010-01-01',
      gender: 'female',
      activityLevel: 'sedentary',
      goal: 'lose',
    });
    assert.isAtLeast(r.dailyCalories, 1200);
  });

  it('корректно считает возраст и переживает некорректную дату', () => {
    const age = resolveAge('1990-01-01');
    assert.isAtLeast(age, 30);
    assert.isAtMost(age, 45);
    assert.strictEqual(resolveAge(null), 30);
    assert.strictEqual(resolveAge('не-дата'), 30);
  });

  it('resolveTargetCalories соблюдает приоритет значений', () => {
    assert.strictEqual(resolveTargetCalories(base, 2000, 2500), 2000);
    assert.strictEqual(resolveTargetCalories(base, null, 2500), 2500);
    assert.strictEqual(resolveTargetCalories(base, undefined, undefined), calculateEnergy(base).dailyCalories);
    // Некорректные значения игнорируются.
    assert.strictEqual(resolveTargetCalories(base, 0, 2500), 2500);
    assert.strictEqual(resolveTargetCalories(base, -100, 2500), 2500);
    assert.strictEqual(resolveTargetCalories(base, NaN, 2500), 2500);
  });

  it('устойчив к отсутствующим и некорректным данным профиля', () => {
    const r = calculateEnergy({
      weightKg: NaN,
      heightCm: 0,
      birthDate: null,
      gender: 'unknown',
      activityLevel: 'неизвестно',
      goal: 'что-то',
    });
    assert.isAbove(r.dailyCalories, 0);
    assert.strictEqual(r.activityMultiplier, ACTIVITY_MULTIPLIERS.moderate);
  });
});
