import { assert } from 'chai';
import { describe, it } from 'mocha';
import { RecommendationService } from '../../recommendation/recommendation.service';

describe('RecommendationService unit', () => {
  it('getBaseRecommendations фильтрует по аудитории взрослого', async () => {
    const rows = [{ id: '1', title: 'Пейте воду', audience: 'adult' }];
    let seenWhere: Record<string, unknown> | undefined;
    const baseRecommendationModel = {
      findAll: async (opts: { where: Record<string, unknown>; order: unknown }) => {
        seenWhere = opts.where;
        assert.deepEqual(opts.order, [['createdAt', 'DESC']]);
        return rows;
      },
    };
    // Взрослый пользователь: 1990 год рождения.
    const userModel = {
      findByPk: async () => ({ id: '1', birthDate: new Date('1990-01-01') }),
    };
    const service = new RecommendationService(
      {} as never,
      userModel as never,
      {} as never,
      baseRecommendationModel as never,
      {} as never,
      {} as never,
    );

    const result = await service.getBaseRecommendations('1');

    assert.deepEqual(seenWhere, { audience: 'adult' });
    assert.deepEqual(result, rows);
  });

  it('getBaseRecommendations отдаёт minor для несовершеннолетнего', async () => {
    let seenWhere: Record<string, unknown> | undefined;
    const baseRecommendationModel = {
      findAll: async (opts: { where: Record<string, unknown> }) => {
        seenWhere = opts.where;
        return [];
      },
    };
    // Ребёнок: дата рождения — 5 лет назад.
    const fiveYearsAgo = new Date();
    fiveYearsAgo.setFullYear(fiveYearsAgo.getFullYear() - 5);
    const userModel = {
      findByPk: async () => ({ id: '2', birthDate: fiveYearsAgo }),
    };
    const service = new RecommendationService(
      {} as never,
      userModel as never,
      {} as never,
      baseRecommendationModel as never,
      {} as never,
      {} as never,
    );

    await service.getBaseRecommendations('2');

    assert.deepEqual(seenWhere, { audience: 'minor' });
  });

  it('getBaseRecommendations считает взрослым, если дата рождения не задана', async () => {
    let seenWhere: Record<string, unknown> | undefined;
    const baseRecommendationModel = {
      findAll: async (opts: { where: Record<string, unknown> }) => {
        seenWhere = opts.where;
        return [];
      },
    };
    const userModel = { findByPk: async () => ({ id: '3', birthDate: null }) };
    const service = new RecommendationService(
      {} as never,
      userModel as never,
      {} as never,
      baseRecommendationModel as never,
      {} as never,
      {} as never,
    );

    await service.getBaseRecommendations('3');

    assert.deepEqual(seenWhere, { audience: 'adult' });
  });

  it('generate создаёт suggestion с ответом ИИ', async () => {
    let createdPayload: any = null;

    const suggestionModel = {
      create: async (payload: { type?: string; content?: Record<string, unknown> }) => {
        createdPayload = payload;
        return { id: 'sug-1', ...payload };
      },
    };
    const userModel = {
      findByPk: async () => ({
        goal: 'maintain',
        weight: 75,
        height: 180,
        allergens: [{ name: 'арахис' }],
        dietaryRestrictions: ['vegetarian'],
        foodDislikes: [],
      }),
    };
    const mealItemModel = {
      findAll: async (opts: {
        include?: Array<{ required?: boolean; where?: { userId: number } }>;
        order?: unknown;
        limit?: number;
      }) => {
        assert.equal(opts.limit, 5);
        assert.deepEqual(opts.order, [['createdAt', 'DESC']]);
        assert.equal(opts.include?.length, 1);
        assert.isTrue(opts.include?.[0]?.required);
        assert.deepEqual(opts.include?.[0]?.where, { userId: 42 });
        return [{ foodName: 'Овсянка', calories: 300 }];
      },
    };
    const usersService = {
      calculateBmrAndCalories: async () => ({ dailyCalories: 1950 }),
    };
    const openAiService = {
      generateNutritionRecommendation: async (input: {
        goal: string;
        dailyCalories: number;
        recentMeals: unknown[];
        allergies?: string[];
        dietaryRestrictions?: string[];
        foodDislikes?: string[];
      }) => {
        assert.equal(input.goal, 'maintain');
        assert.equal(input.dailyCalories, 1950);
        assert.equal(input.recentMeals.length, 1);
        assert.deepEqual(input.allergies, ['арахис']);
        assert.deepEqual(input.dietaryRestrictions, ['Вегетарианство']);
        assert.deepEqual(input.foodDislikes, []);
        return { summary: 'Ешьте больше клетчатки', tips: ['Вода'] };
      },
    };

    const service = new RecommendationService(
      suggestionModel as never,
      userModel as never,
      mealItemModel as never,
      {} as never,
      usersService as never,
      openAiService as never,
    );

    const result = await service.generate('42');

    assert.equal(String((result as unknown as { userId: unknown }).userId), '42');
    assert.equal((result as { type: string }).type, 'general');
    assert.isFalse((result as { isRead: boolean }).isRead);
    assert.equal(createdPayload?.type, 'general');
    const content = createdPayload?.content as Record<string, unknown>;
    assert.equal(content.source, 'ИИ');
    assert.equal(content.summary, 'Ешьте больше клетчатки');
  });
});
