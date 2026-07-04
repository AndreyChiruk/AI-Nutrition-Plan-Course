import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
import { Allergen } from '../models/Allergen';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import type { ProductIngredient, ProductIngredientDetailed } from '../models/Product';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { OpenAiService } from '../openai/openai.service';
import { productHasUserAllergen } from '../meal-plan/dietary-rules';
import {
  normalizeCatalogAllergenList,
  normalizeCatalogDietaryTagList,
} from '../meal-plan/catalog-ai-normalize';

export type FoodRecognitionItemDto = {
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergensFound: string[];
  dietaryTags?: string[];
  ingredients?: Array<{ name: string; grams: number }>;
  ingredientsDetailed?: Array<{
    id?: string;
    name: string;
    grams?: number;
    amount?: number;
    unit?: string;
    originalString?: string;
    ingredientId?: string;
  }>;
};

@Injectable()
export class FoodRecognitionService {
  constructor(
    @InjectModel(Meal) private readonly mealModel: typeof Meal,
    @InjectModel(MealItem) private readonly mealItemModel: typeof MealItem,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Product) private readonly productModel: typeof Product,
    private readonly openAiService: OpenAiService,
  ) {}
  private sanitizeSubmitRow(item: FoodRecognitionItemDto, rowIdx: number) {
    const foodName = String(item.foodName ?? '').trim().slice(0, 200);
    if (!foodName) {
      throw new BadRequestException('У каждой позиции должно быть название блюда.');
    }
    const calories = Number(item.calories);
    const protein = Number(item.protein);
    const fat = Number(item.fat);
    const carbs = Number(item.carbs);
    if ([calories, protein, fat, carbs].some((n) => Number.isNaN(n) || n < 0 || n > 50000)) {
      throw new BadRequestException('Некорректные числовые значения КБЖУ.');
    }

    const allergensFound = normalizeCatalogAllergenList(item.allergensFound ?? []).slice(0, 24);
    const dietaryTags = normalizeCatalogDietaryTagList(item.dietaryTags ?? []).slice(0, 24);

    let ingredients: ProductIngredient[] = Array.isArray(item.ingredients)
      ? item.ingredients
          .slice(0, 40)
          .map((x) => ({
            name: String(x?.name ?? '').trim().slice(0, 160),
            grams: Math.min(50000, Math.max(0, Number(x?.grams ?? 0))),
          }))
          .filter((x) => x.name)
      : [];

    let ingredientsDetailed: ProductIngredientDetailed[] = Array.isArray(item.ingredientsDetailed)
      ? item.ingredientsDetailed
          .slice(0, 40)
          .map((row, j) => {
            const name = String(row?.name ?? '').trim().slice(0, 160);
            if (!name) return null;
            const gramsFromRow = Math.min(
              50000,
              Math.max(0, Number(row?.grams ?? row?.amount ?? 0)),
            );
            const amount = Math.min(
              50000,
              Math.max(0, Number(row?.amount ?? gramsFromRow ?? 0)),
            );
            const unit = String(row?.unit ?? 'г').trim().slice(0, 24) || 'г';
            const grams = gramsFromRow || amount;
            const id =
              typeof row?.id === 'string' && row.id.trim().length > 0
                ? row.id.trim().slice(0, 80)
                : `food-${rowIdx}-${j}-${randomUUID().slice(0, 8)}`;
            const original =
              typeof row?.originalString === 'string' ? row.originalString.trim().slice(0, 200) : undefined;
            const ingredientId =
              typeof row?.ingredientId === 'string' ? row.ingredientId.trim().slice(0, 80) : undefined;
            const detail: ProductIngredientDetailed = {
              id,
              name,
              amount: amount || grams,
              unit,
              grams: grams || amount,
            };
            if (original) detail.originalString = original;
            if (ingredientId) detail.ingredientId = ingredientId;
            return detail;
          })
          .filter((x): x is ProductIngredientDetailed => Boolean(x))
      : [];

    if (ingredients.length === 0 && ingredientsDetailed.length > 0) {
      ingredients = ingredientsDetailed.map((d) => ({
        name: d.name,
        grams: d.grams || d.amount,
      }));
    }
    if (ingredientsDetailed.length === 0 && ingredients.length > 0) {
      ingredientsDetailed = ingredients.map((ing, j) => ({
        id: `food-${rowIdx}-${j}-${randomUUID().slice(0, 8)}`,
        name: ing.name,
        amount: ing.grams,
        unit: 'г',
        grams: ing.grams,
      }));
    }

    return {
      foodName,
      calories,
      protein,
      fat,
      carbs,
      allergensFound,
      dietaryTags,
      ingredients,
      ingredientsDetailed,
    };
  }

  private userMatchesDetected(userName: string, detected: string): boolean {
    const u = userName.toLowerCase().trim();
    const d = detected.toLowerCase().trim();
    if (!u || !d) return false;
    if (d === u || u.includes(d) || d.includes(u)) return true;
    if (d === 'nuts' && /орех|арахис|фундук|миндаль|nuts|peanut/i.test(u)) return true;
    if (d === 'milk' && /молок|молоч|лактоз|сыр|milk|lactose/i.test(u)) return true;
    if (d === 'gluten' && /глютен|пшениц|gluten|wheat/i.test(u)) return true;
    return false;
  }

  private warningIfUserAllergic(
    userAllergenNames: string[],
    detected: string,
    foodName: string,
  ): string | null {
    for (const u of userAllergenNames) {
      if (this.userMatchesDetected(u, detected)) {
        return `Внимание: в «${foodName}» указан аллерген «${detected}» — совпадение с вашим профилем («${u}»).`;
      }
    }
    return null;
  }

  private async findCatalogProductsByFoodName(foodName: string): Promise<Product[]> {
    const terms = foodName
      .split(/[^a-zA-Zа-яА-ЯёЁ0-9]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
      .slice(0, 4);
    if (!terms.length) return [];
    return this.productModel.findAll({
      where: { [Op.or]: terms.map((t) => ({ name: { [Op.iLike]: `%${t}%` } })) },
      limit: 24,
    });
  }

  async previewRecognize(userId: string, photoUrl: string) {
    const uid = Number(userId);
    let confidence: number;
    let detectedItems: FoodRecognitionItemDto[];

    try {
      const ai = await this.openAiService.recognizeFoodFromPhoto(photoUrl);
      if (!ai) {
        throw new ServiceUnavailableException(
          'Распознавание еды по фото недоступно: укажите OPENAI_API_KEY в настройках сервера.',
        );
      }
      confidence = ai.confidence;
      detectedItems = ai.items.map((item) => ({
        foodName: item.foodName,
        calories: item.calories,
        protein: item.protein,
        fat: item.fat,
        carbs: item.carbs,
        allergensFound: Array.isArray(item.allergensFound) ? [...item.allergensFound] : [],
        dietaryTags: Array.isArray(item.dietaryTags) ? [...item.dietaryTags] : [],
        ingredients: Array.isArray(item.ingredients)
          ? item.ingredients.map((x) => ({ name: x.name, grams: x.grams }))
          : [],
        ingredientsDetailed: Array.isArray(item.ingredientsDetailed)
          ? item.ingredientsDetailed.map((d) => ({ ...d }))
          : [],
      }));
    } catch (e) {
      if (e instanceof ServiceUnavailableException) throw e;
      throw new ServiceUnavailableException(
        'Не удалось распознать блюдо по фото. Проверьте ключ OpenAI и повторите попытку.',
      );
    }

    const { allergenWarnings, hasAllergenMatchInProfile, hasDetectedAllergensInDish } =
      await this.buildAllergenWarnings(uid, detectedItems);
    const model = this.openAiService.getModelLabel();

    return {
      confidence,
      items: detectedItems,
      allergenWarnings,
      hasAllergenMatchInProfile,
      hasDetectedAllergensInDish,
      provider: `OpenAI (${model})`,
    };
  }

  async submitMealForModeration(
    userId: string,
    photoUrl: string,
    confidence: number,
    items: FoodRecognitionItemDto[],
  ) {
    const uid = Number(userId);
    if (!photoUrl?.trim()) {
      throw new BadRequestException('Нужно фото блюда.');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('Сначала выполните распознавание или передайте непустой список позиций.');
    }
    if (items.length > 12) {
      throw new BadRequestException('Не более 12 позиций за раз.');
    }

    const sanitized = items.map((item, idx) => this.sanitizeSubmitRow(item, idx));

    const c =
      typeof confidence === 'number' && !Number.isNaN(confidence)
        ? Math.min(1, Math.max(0, confidence))
        : 0;

    const meal = await this.mealModel.create({
      userId: uid,
      photoUrl,
      recognizedAt: new Date(),
      confidence: c,
      status: 'pending',
    } as Meal);

    await this.mealItemModel.bulkCreate(
      sanitized.map((item) => ({ mealId: meal.id, ...item })) as MealItem[],
    );

    return {
      mealId: meal.id,
      status: 'pending' as const,
      message:
        'Запись отправлена администратору. После проверки она будет подтверждена или отклонена в разделе модерации.',
    };
  }

  private async buildAllergenWarnings(
    uid: number,
    detectedItems: FoodRecognitionItemDto[],
  ): Promise<{
    allergenWarnings: string[];
    hasAllergenMatchInProfile: boolean;
    hasDetectedAllergensInDish: boolean;
  }> {
    const user = await this.userModel.findByPk(uid, {
      attributes: ['id'],
      include: [{ model: Allergen, attributes: ['id', 'name'], through: { attributes: [] } }],
    });

    const allergyNames = (user?.allergens ?? []).map((a) => a.name);
    const allergySet = new Set(allergyNames.map((a) => String(a).toLowerCase()));
    const allergenWarnings: string[] = [];

    for (const item of detectedItems) {
      for (const det of item.allergensFound) {
        const w = this.warningIfUserAllergic(allergyNames, det, item.foodName);
        if (w) allergenWarnings.push(w);
      }
      const catalogHits = await this.findCatalogProductsByFoodName(item.foodName);
      for (const p of catalogHits) {
        if (allergySet.size === 0) break;
        if (productHasUserAllergen(p, allergySet)) {
          const pa = (p.allergens ?? []).filter(Boolean).join(', ') || 'не указаны';
          allergenWarnings.push(
            `Каталог: блюдо похоже на «${p.name}» (аллергены в карточке: ${pa}) — пересечение с вашим профилем аллергий.`,
          );
          break;
        }
      }
    }

    const hasDetectedAllergensInDish = detectedItems.some((item) => item.allergensFound.length > 0);
    return {
      allergenWarnings,
      hasAllergenMatchInProfile: allergenWarnings.length > 0,
      hasDetectedAllergensInDish,
    };
  }
}
