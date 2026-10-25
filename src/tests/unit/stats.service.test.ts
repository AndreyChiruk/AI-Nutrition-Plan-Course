import { assert } from 'chai';
import { describe, it } from 'mocha';
import { StatsService } from '../../stats/stats.service';

describe('StatsService unit', () => {
  it('userStatsSummary возвращает счётчики из моделей', async () => {
    const mealPlanModel = { count: async ({ where }: { where: { userId: number } }) => (where.userId === 7 ? 2 : 0) };
    const mealModel = { count: async ({ where }: { where: { userId: number } }) => (where.userId === 7 ? 5 : 0) };
    const bodyAnalysisModel = {};
    const userModel = {};

    const service = new StatsService(
      mealModel as never,
      mealPlanModel as never,
      bodyAnalysisModel as never,
      userModel as never,
    );

    const result = await service.userStatsSummary('7');

    assert.deepEqual(result, {
      mealPlansCount: 2,
      foodRecognitionCount: 5,
    });
  });

  it('userProgress агрегирует калории по дням', async () => {
    const d1 = new Date('2026-05-01T12:00:00Z');
    const d2 = new Date('2026-05-01T18:00:00Z');
    const d3 = new Date('2026-05-02T10:00:00Z');

    const mealModel = {
      findAll: async () => [
        {
          recognizedAt: d1,
          items: [{ calories: 400 }, { calories: 100 }],
        },
        {
          recognizedAt: d2,
          items: [{ calories: 200 }],
        },
        {
          recognizedAt: d3,
          items: [{ calories: 500 }],
        },
      ],
    };

    const service = new StatsService(
      mealModel as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const rows = await service.userProgress('1');

    assert.equal(rows.length, 2);
    assert.equal(rows[0].date, '2026-05-01');
    assert.equal(rows[0].calories, 700);
    assert.equal(rows[0].mealsCount, 2);
    assert.equal(rows[1].date, '2026-05-02');
    assert.equal(rows[1].calories, 500);
  });

  it('kbjuStats суммирует макронутриенты по позициям', async () => {
    const mealModel = {
      findAll: async () => [
        {
          items: [
            { protein: 10, fat: 5, carbs: 20, calories: 200 },
            { protein: 5, fat: 15, carbs: 30, calories: 300 },
          ],
        },
      ],
    };

    const service = new StatsService(
      mealModel as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const r = await service.kbjuStats('1');

    assert.equal(r.itemsCount, 2);
    assert.equal(r.protein, 15);
    assert.equal(r.fat, 20);
    assert.equal(r.carbs, 50);
    assert.equal(r.calories, 500);
  });

  it('comparePlanVsFact учитывает активный план и факт по дням', async () => {
    const mealPlanModel = {
      findOne: async () => ({
        id: 'plan-uuid',
        targetCalories: 2000,
      }),
    };
    const mealModel = {
      findAll: async () => [
        {
          recognizedAt: new Date('2026-05-01T12:00:00Z'),
          items: [{ calories: 1000 }],
        },
        {
          recognizedAt: new Date('2026-05-02T12:00:00Z'),
          items: [{ calories: 500 }],
        },
      ],
    };

    const service = new StatsService(
      mealModel as never,
      mealPlanModel as never,
      {} as never,
      {} as never,
    );

    const r = await service.comparePlanVsFact('3');

    assert.equal(r.planId, 'plan-uuid');
    assert.equal(r.targetDailyCalories, 2000);
    assert.equal(r.daysWithMealsLogged, 2);
    assert.equal(r.totalLoggedCalories, 1500);
    assert.equal(r.avgDailyFactCalories, 750);
    assert.equal(r.deltaVsTargetDaily, -1250);
  });

  it('exportCsv формирует реальный CSV, а не заглушку', async () => {
    // Раньше метод возвращал жёстко прописанную строку
    // 'date,calories\n2026-01-01,1800' — одинаковую для всех пользователей.
    const mealModel = {
      findAll: async () => [
        {
          recognizedAt: new Date('2026-10-06T10:00:00Z'),
          createdAt: new Date('2026-10-06T10:00:00Z'),
          confidence: 0.85,
          status: 'pending',
          items: [
            {
              foodName: 'Филе рыбы на гриле',
              calories: 250,
              protein: 30,
              fat: 10,
              carbs: 0,
              allergensFound: ['рыба'],
            },
          ],
        },
      ],
    };
    const planModel = { findAll: async () => [] };
    const bodyModel = { findAll: async () => [] };
    const service = new StatsService(
      mealModel as never,
      planModel as never,
      bodyModel as never,
      {} as never,
    );

    const csv = await service.exportCsv('2');
    assert.notInclude(csv, '2026-01-01,1800', 'заглушки быть не должно');
    assert.include(csv, 'Филе рыбы на грибе'.replace('бе', 'ле'), 'содержит реальное блюдо');
    assert.include(csv, 'рыба', 'содержит аллергены');
    assert.include(csv, 'Планы питания', 'содержит раздел планов');
  });

  it('exportPdf честно сообщает о недоступности, а не отдаёт несуществующий файл', async () => {
    // Раньше возвращалась ссылка на https://cdn.example.com/reports/... (404).
    const counter = { count: async () => 3 };
    const service = new StatsService(
      counter as never,
      counter as never,
      counter as never,
      counter as never,
    );

    const pdf = await service.exportPdf('2');
    assert.isFalse(pdf.available, 'PDF не поддерживается');
    assert.strictEqual(pdf.suggestedFormat, 'csv');
    assert.notProperty(pdf, 'url', 'ссылки на внешний файл быть не должно');
    assert.strictEqual(pdf.summary.meals, 3);
  });
});
