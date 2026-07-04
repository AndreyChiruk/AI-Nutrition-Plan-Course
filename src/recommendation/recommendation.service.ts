import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Allergen } from '../models/Allergen';
import { BaseRecommendation } from '../models/BaseRecommendation';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { Suggestion } from '../models/Suggestion';
import { User } from '../models/User';
import { OpenAiService } from '../openai/openai.service';
import { normalizeGoalByWeight } from '../common/weight-goal.util';
import { UsersService } from '../users/users.service';

const DIET_KEY_LABEL_RU: Record<string, string> = {
  vegetarian: 'Вегетарианство',
  vegan: 'Веган',
  'lactose-free': 'Безлактозная',
  'gluten-free': 'Безглютеновая',
  keto: 'Кето',
  paleo: 'Палео',
  'low-carb': 'Низкоуглеводная',
  'high-protein': 'Высокобелковая',
};

function dietaryRestrictionsForPrompt(keys: string[]): string[] {
  return keys.map((k) => DIET_KEY_LABEL_RU[k] ?? k);
}

@Injectable()
export class RecommendationService {
  constructor(
    @InjectModel(Suggestion) private readonly suggestionModel: typeof Suggestion,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(MealItem) private readonly mealItemModel: typeof MealItem,
    @InjectModel(BaseRecommendation)
    private readonly baseRecommendationModel: typeof BaseRecommendation,
    private readonly usersService: UsersService,
    private readonly openAiService: OpenAiService,
  ) {}

  getBaseRecommendations() {
    return this.baseRecommendationModel.findAll({ order: [['createdAt', 'DESC']] });
  }

  async generate(userId: string) {
    const user = await this.userModel.findByPk(userId, {
      include: [Allergen],
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    const uid = Number(userId);
    const recentMealItems = await this.mealItemModel.findAll({
      include: [
        {
          model: Meal,
          required: true,
          where: { userId: uid },
        },
      ],
      order: [['createdAt', 'DESC']],
      limit: 5,
    });
    const safeGoal = normalizeGoalByWeight(
      (user?.goal ?? 'maintain') as 'lose' | 'maintain' | 'gain',
      Number(user?.weight ?? 70),
      Number(user?.height ?? 170),
    );
    const target = user.targetCalories != null && Number(user.targetCalories) > 0
      ? Math.round(Number(user.targetCalories))
      : (await this.usersService.calculateBmrAndCalories(userId)).dailyCalories;
    const allergyNames = (user.allergens ?? []).map((a) => a.name).filter(Boolean);
    const dietaryRestrictions = dietaryRestrictionsForPrompt(
      (user.dietaryRestrictions ?? []).map(String).filter(Boolean),
    );
    const foodDislikes = (user.foodDislikes ?? []).filter(Boolean);
    const aiRecommendation = await this.openAiService.generateNutritionRecommendation({
      goal: safeGoal,
      dailyCalories: target,
      recentMeals: recentMealItems.map((item) => ({
        foodName: item.foodName,
        calories: item.calories,
      })),
      allergies: allergyNames,
      dietaryRestrictions,
      foodDislikes,
    });

    const recommendation = await this.suggestionModel.create({
      userId,
      type: 'general',
      content: {
        source: 'ИИ',
        ...aiRecommendation,
      },
      isRead: false,
    } as never);

    return recommendation;
  }
}
