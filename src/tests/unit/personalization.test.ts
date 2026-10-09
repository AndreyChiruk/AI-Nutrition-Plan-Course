import { assert } from 'chai';
import { describe, it } from 'mocha';
import { calculateEnergy } from '../../common/energy.util';

/**
 * Тесты реальной персонализации плана.
 *
 * Три дефекта:
 * 1. `users.food_habits` сохранялся и отдавался в API, но в планировании
 *    не участвовал вовсе — «учтём ваши привычки» было фикцией.
 * 2. Продукты из холодильника влияли только на сортировку внутри top-48
 *    (вес +1.2), а не на состав плана.
 * 3. Цель пользователя транслировалась в калории грубой таблицей
 *    {lose:1800, maintain:2200, gain:2600} — одинаковой для всех,
 *    без учёта пола, возраста, роста, веса и активности.
 */
describe('персонализация: цель -> калорийность', () => {
  const base = {
    heightCm: 175,
    birthDate: '1990-01-01',
    gender: 'male' as const,
    activityLevel: 'moderate' as const,
  };

  it('цель влияет на калорийность в правильную сторону', () => {
    const lose = calculateEnergy({ ...base, weightKg: 70, goal: 'lose' });
    const maintain = calculateEnergy({ ...base, weightKg: 70, goal: 'maintain' });
    const gain = calculateEnergy({ ...base, weightKg: 70, goal: 'gain' });
    assert.isBelow(lose.dailyCalories, maintain.dailyCalories);
    assert.isAbove(gain.dailyCalories, maintain.dailyCalories);
  });

  it('одинаковая цель даёт РАЗНУЮ калорийность разным людям', () => {
    // Регресс: старая таблица давала всем 2200 ккал при цели «поддержание».
    const bigActive = calculateEnergy({
      weightKg: 90,
      heightCm: 185,
      birthDate: '1995-01-01',
      gender: 'male',
      activityLevel: 'active',
      goal: 'maintain',
    });
    const smallSedentary = calculateEnergy({
      weightKg: 55,
      heightCm: 162,
      birthDate: '1990-01-01',
      gender: 'female',
      activityLevel: 'sedentary',
      goal: 'maintain',
    });
    assert.notStrictEqual(bigActive.dailyCalories, smallSedentary.dailyCalories);
    assert.isAbove(
      bigActive.dailyCalories - smallSedentary.dailyCalories,
      1000,
      'разница должна быть существенной',
    );
  });

  it('учитывает уровень активности', () => {
    const levels = ['sedentary', 'light', 'moderate', 'active', 'very_active'] as const;
    const values = levels.map(
      (activityLevel) => calculateEnergy({ ...base, weightKg: 70, goal: 'maintain', activityLevel }).dailyCalories,
    );
    for (let i = 1; i < values.length; i++) {
      assert.isAbove(values[i], values[i - 1], `уровень ${levels[i]} должен давать больше`);
    }
  });

  it('учитывает пол при прочих равных', () => {
    const male = calculateEnergy({ ...base, weightKg: 70, goal: 'maintain', gender: 'male' });
    const female = calculateEnergy({ ...base, weightKg: 70, goal: 'maintain', gender: 'female' });
    assert.isAbove(male.dailyCalories, female.dailyCalories);
  });

  it('учитывает вес и рост', () => {
    const light = calculateEnergy({ ...base, weightKg: 60, goal: 'maintain' });
    const heavy = calculateEnergy({ ...base, weightKg: 90, goal: 'maintain' });
    assert.isAbove(heavy.dailyCalories, light.dailyCalories);

    const short = calculateEnergy({ ...base, weightKg: 70, heightCm: 160, goal: 'maintain' });
    const tall = calculateEnergy({ ...base, weightKg: 70, heightCm: 190, goal: 'maintain' });
    assert.isAbove(tall.dailyCalories, short.dailyCalories);
  });

  it('никогда не опускается ниже безопасного минимума', () => {
    for (const w of [40, 45, 50]) {
      for (const goal of ['lose', 'maintain', 'gain'] as const) {
        const r = calculateEnergy({
          weightKg: w,
          heightCm: 150,
          birthDate: '2005-01-01',
          gender: 'female',
          activityLevel: 'sedentary',
          goal,
        });
        assert.isAtLeast(r.dailyCalories, 1200, `${w}кг / ${goal}`);
      }
    }
  });
});

/**
 * Проверки разбора привычек (повторяют parseFoodHabits из meal-plan.service.ts).
 */
describe('персонализация: пищевые привычки', () => {
  const MAX_TEA_CUPS = 6;

  function parseFoodHabits(raw: unknown) {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    const teaRaw = Number(obj.teaCupsPerDay);
    const teaCupsPerDay =
      Number.isFinite(teaRaw) && teaRaw > 0 ? Math.min(MAX_TEA_CUPS, Math.floor(teaRaw)) : 0;
    const mealsRaw = Number(obj.mealsPerDay);
    const mealsPerDay =
      Number.isFinite(mealsRaw) && mealsRaw >= 3 && mealsRaw <= 5 ? Math.floor(mealsRaw) : null;
    const prefersHomeCooking = obj.prefersHomeCooking === true || obj.homeCooking === true;
    return { teaCupsPerDay, mealsPerDay, prefersHomeCooking };
  }

  it('читает teaCupsPerDay', () => {
    assert.strictEqual(parseFoodHabits({ teaCupsPerDay: 2 }).teaCupsPerDay, 2);
  });

  it('ограничивает неразумное количество чашек', () => {
    assert.strictEqual(parseFoodHabits({ teaCupsPerDay: 100 }).teaCupsPerDay, MAX_TEA_CUPS);
    assert.strictEqual(parseFoodHabits({ teaCupsPerDay: -5 }).teaCupsPerDay, 0);
  });

  it('принимает только разумное число приёмов пищи', () => {
    assert.strictEqual(parseFoodHabits({ mealsPerDay: 3 }).mealsPerDay, 3);
    assert.strictEqual(parseFoodHabits({ mealsPerDay: 4 }).mealsPerDay, 4);
    assert.isNull(parseFoodHabits({ mealsPerDay: 1 }).mealsPerDay);
    assert.isNull(parseFoodHabits({ mealsPerDay: 20 }).mealsPerDay);
  });

  it('устойчив к мусору в поле', () => {
    const r = parseFoodHabits({ teaCupsPerDay: 'abc', mealsPerDay: null });
    assert.strictEqual(r.teaCupsPerDay, 0);
    assert.isNull(r.mealsPerDay);
    assert.deepEqual(parseFoodHabits(null), {
      teaCupsPerDay: 0,
      mealsPerDay: null,
      prefersHomeCooking: false,
    });
    assert.deepEqual(parseFoodHabits('строка'), {
      teaCupsPerDay: 0,
      mealsPerDay: null,
      prefersHomeCooking: false,
    });
  });
});
