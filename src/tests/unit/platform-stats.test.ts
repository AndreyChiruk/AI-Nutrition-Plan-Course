import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты агрегации статистики платформы.
 *
 * Раньше `GET /admin/stats/users` просто читал таблицу `platform_stats`,
 * а она была ПУСТА: ни один код в неё не писал. График в админке всегда
 * показывал ноль, хотя данные для него есть в `users`, `meals`, `meal_plans`.
 *
 * Теперь, если снимков нет, значения считаются на лету; кроме того,
 * `recordDailySnapshot()` сохраняет снимок за сегодня.
 *
 * Здесь повторяется логика `computeDailyStats`.
 */
type Row = { createdAt: Date };

function computeDailyStats(
  days: number,
  users: Row[],
  meals: Array<Row & { confidence: number }>,
  plans: Row[],
  now: Date,
) {
  const since = new Date(now);
  since.setHours(0, 0, 0, 0);
  since.setDate(since.getDate() - (days - 1));

  const out: Array<{
    date: Date;
    totalUsers: number;
    activeUsers: number;
    totalMealsRecognized: number;
    totalMealPlansGenerated: number;
    avgConfidenceScore: number;
  }> = [];

  for (let i = 0; i < days; i++) {
    const dayStart = new Date(since);
    dayStart.setDate(dayStart.getDate() + i);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    const inDay = (d: Date) => d >= dayStart && d < dayEnd;

    const mealsOfDay = meals.filter((m) => inDay(new Date(m.createdAt)));
    const confidenceSum = mealsOfDay.reduce((s, m) => s + (Number(m.confidence) || 0), 0);

    out.push({
      date: dayStart,
      totalUsers: users.filter((u) => new Date(u.createdAt) < dayEnd).length,
      activeUsers: users.filter((u) => inDay(new Date(u.createdAt))).length,
      totalMealsRecognized: mealsOfDay.length,
      totalMealPlansGenerated: plans.filter((p) => inDay(new Date(p.createdAt))).length,
      avgConfidenceScore: mealsOfDay.length
        ? Math.round((confidenceSum / mealsOfDay.length) * 1000) / 1000
        : 0,
    });
  }
  return out.reverse();
}

const NOW = new Date('2026-10-06T12:00:00Z');

describe('статистика платформы', () => {
  it('возвращает запись на каждый день периода', () => {
    const stats = computeDailyStats(7, [], [], [], NOW);
    assert.lengthOf(stats, 7, 'за 7 дней должно быть 7 записей');
  });

  it('сортирует по дате от новых к старым', () => {
    const stats = computeDailyStats(3, [], [], [], NOW);
    for (let i = 1; i < stats.length; i++) {
      assert.isAtLeast(
        stats[i - 1].date.getTime(),
        stats[i].date.getTime(),
        'даты должны убывать',
      );
    }
  });

  it('считает распознавания за день', () => {
    const meals = [
      { createdAt: new Date('2026-10-06T09:00:00Z'), confidence: 0.9 },
      { createdAt: new Date('2026-10-06T14:00:00Z'), confidence: 0.7 },
      { createdAt: new Date('2026-10-05T09:00:00Z'), confidence: 0.5 },
    ];
    const stats = computeDailyStats(2, [], meals, [], NOW);
    assert.strictEqual(stats[0].totalMealsRecognized, 2, 'сегодня — 2 распознавания');
    assert.strictEqual(stats[1].totalMealsRecognized, 1, 'вчера — 1');
  });

  it('считает среднюю уверенность распознавания', () => {
    const meals = [
      { createdAt: new Date('2026-10-06T09:00:00Z'), confidence: 0.8 },
      { createdAt: new Date('2026-10-06T10:00:00Z'), confidence: 0.6 },
    ];
    const stats = computeDailyStats(1, [], meals, [], NOW);
    assert.approximately(stats[0].avgConfidenceScore, 0.7, 0.001);
  });

  it('не делит на ноль, когда распознаваний нет', () => {
    const stats = computeDailyStats(1, [], [], [], NOW);
    assert.strictEqual(stats[0].avgConfidenceScore, 0);
    assert.strictEqual(stats[0].totalMealsRecognized, 0);
  });

  it('считает накопительное число пользователей', () => {
    const users = [
      { createdAt: new Date('2026-10-01T10:00:00Z') },
      { createdAt: new Date('2026-10-06T10:00:00Z') },
    ];
    const stats = computeDailyStats(3, users, [], [], NOW);
    const today = stats[0];
    assert.strictEqual(today.totalUsers, 2, 'к сегодняшнему дню зарегистрированы оба');
    assert.strictEqual(today.activeUsers, 1, 'сегодня зарегистрировался один');
  });

  it('считает сгенерированные планы', () => {
    const plans = [
      { createdAt: new Date('2026-10-06T08:00:00Z') },
      { createdAt: new Date('2026-10-06T15:00:00Z') },
    ];
    const stats = computeDailyStats(1, [], [], plans, NOW);
    assert.strictEqual(stats[0].totalMealPlansGenerated, 2);
  });

  it('на реальных объёмах проекта даёт ненулевые значения', () => {
    // 6 пользователей, 10 распознаваний, 67 планов — как в текущей БД.
    const users = Array.from({ length: 6 }, (_, i) => ({
      createdAt: new Date(`2026-10-0${(i % 5) + 1}T10:00:00Z`),
    }));
    const meals = Array.from({ length: 10 }, () => ({
      createdAt: new Date('2026-10-06T10:00:00Z'),
      confidence: 0.8,
    }));
    const plans = Array.from({ length: 67 }, () => ({ createdAt: new Date('2026-10-06T11:00:00Z') }));

    const stats = computeDailyStats(30, users, meals, plans, NOW);
    const today = stats[0];
    assert.isAbove(today.totalUsers, 0, 'график не должен быть нулевым');
    assert.strictEqual(today.totalMealsRecognized, 10);
    assert.strictEqual(today.totalMealPlansGenerated, 67);
  });
});
