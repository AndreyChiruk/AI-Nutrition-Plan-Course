import { assert } from 'chai';
import { describe, it } from 'mocha';
import { RecommendationService } from '../../recommendation/recommendation.service';

describe('RecommendationService unit', () => {
  it('getBaseRecommendations делегирует findAll в модель', async () => {
    const rows = [{ id: '1', title: 'Пейте воду' }];
    const baseRecommendationModel = {
      findAll: async (opts: { order: unknown }) => {
        assert.deepEqual(opts.order, [['createdAt', 'DESC']]);
        return rows;
      },
    };
    const service = new RecommendationService(
      {} as never,
      {} as never,
      {} as never,
      baseRecommendationModel as never,
      {} as never,
      {} as never,
    );

    const result = await service.getBaseRecommendations();

    assert.deepEqual(result, rows);
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
