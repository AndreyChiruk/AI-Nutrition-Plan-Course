import { BadRequestException, Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'crypto';
import { hashPassword } from '../common/password.util';
import { normalizeEmailForStorage } from '../common/sanitize';
import { invalidateUserBlockCache } from '../auth/jwt-auth.guard';
import { Op, Transaction } from 'sequelize';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { PlatformStats } from '../models/PlatformStats';
import { User } from '../models/User';
import { BaseRecommendation } from '../models/BaseRecommendation';
import { Product, type ProductIngredient, type ProductIngredientDetailed } from '../models/Product';
import { Ingredient } from '../models/Ingredient';
import { MealPlanDay, type MealSlotSnapshot } from '../models/MealPlanDay';
import { inferIngredientsFromDishTitle, guessGramsForToken } from '../meal-plan/ingredient-utils';
import { collectIngredientMatchRoots } from '../meal-plan/ingredient-match.util';
import {
  normalizeCatalogAllergenList,
  normalizeCatalogDietaryTagList,
} from '../meal-plan/catalog-ai-normalize';
import { localizeFoodTitleToRu } from '../meal-plan/food-localize-ru';
import { OpenAiService } from '../openai/openai.service';
import {
  inferIngredientCategoryRu,
  makeIngredientDetail,
  normalizeIngredientNameRu,
} from './recipe-import.util';
import { MealPlan } from '../models/MealPlan';
import { FridgeItem } from '../models/FridgeItem';
import { FridgeImageStorage } from '../fridge/fridge-image.storage';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Meal) private readonly mealModel: typeof Meal,
    @InjectModel(MealItem) private readonly mealItemModel: typeof MealItem,
    @InjectModel(PlatformStats)
    private readonly statsModel: typeof PlatformStats,
    @InjectModel(BaseRecommendation)
    private readonly baseRecommendationModel: typeof BaseRecommendation,
    @InjectModel(Product)
    private readonly productModel: typeof Product,
    @InjectModel(Ingredient)
    private readonly ingredientModel: typeof Ingredient,
    @InjectModel(MealPlanDay)
    private readonly mealPlanDayModel: typeof MealPlanDay,
    @InjectModel(MealPlan)
    private readonly mealPlanModel: typeof MealPlan,
    private readonly openAiService: OpenAiService,
    @Optional()
    @InjectModel(FridgeItem)
    private readonly fridgeItemModel?: typeof FridgeItem,
    @Optional()
    private readonly fridgeImageStorage?: FridgeImageStorage,
  ) {}

  /**
   * Безопасный разбор размера страницы.
   *
   * `Number('abc')` даёт NaN, а `Math.max(1, NaN)` — тоже NaN.
   * Раньше такое значение уходило прямо в SQL, из-за чего запрос
   * падал или возвращал неожиданный результат.
   */
  private safePaging(value: unknown, fallback: number, max: number): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(max, Math.floor(n));
  }

  /** Безопасный разбор смещения: отрицательные и NaN приводятся к 0. */
  private safeOffset(value: unknown): number {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return Math.floor(n);
  }

  private readonly userPublicAttributes = {
    exclude: ['password', 'refreshTokenHash'] as string[],
  };

  getUsers(limit = 20, offset = 0) {
    return this.userModel.findAndCountAll({
      limit,
      offset,
      order: [['id', 'ASC']],
      attributes: this.userPublicAttributes,
    });
  }

  getUser(id: string) {
    return this.userModel.findByPk(id, { attributes: this.userPublicAttributes });
  }

  async createUser(payload: {
    email: string;
    password: string;
    role?: 'guest' | 'user' | 'admin';
    height?: number;
    weight?: number;
    gender?: 'male' | 'female';
    birthDate?: string;
    goal?: 'lose' | 'maintain' | 'gain';
    targetWeight?: number;
    activityLevel?: 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
    avatarUrl?: string;
  }) {
    const created = await this.userModel.create(
      {
        email: normalizeEmailForStorage(payload.email),
        password: await hashPassword(payload.password),
        role: payload.role ?? 'user',
        height: payload.height ?? 170,
        weight: payload.weight ?? 70,
        gender: payload.gender ?? 'male',
        birthDate: payload.birthDate ? new Date(payload.birthDate) : new Date('1995-01-01'),
        goal: payload.goal ?? 'maintain',
        targetWeight: payload.targetWeight,
        activityLevel: payload.activityLevel ?? 'moderate',
        avatarUrl: payload.avatarUrl,
        isBlocked: false,
      } as never,
    );
    // Не возвращаем наружу password/refreshTokenHash.
    return this.getUser(String(created.id));
  }

  async blockUser(id: string) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    await user.update({
      isBlocked: true,
      blockedAt: new Date(),
      // Разрываем активную сессию: refresh-токен перестаёт работать немедленно.
      refreshTokenHash: null,
    } as never);
    invalidateUserBlockCache(id);
    return this.getUser(id);
  }

  async unblockUser(id: string) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    await user.update({ isBlocked: false, blockedAt: null } as never);
    invalidateUserBlockCache(id);
    return this.getUser(id);
  }

  async deleteUser(id: string) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');

    const uid = Number(id);

    // Удаляем связанные фотографии продуктов пользователя из холодильника
    if (this.fridgeItemModel && this.fridgeImageStorage) {
      try {
        const fridgeItems = await this.fridgeItemModel.findAll({
          where: { userId: uid },
          attributes: ['imageUrl', 'imageSource'],
        });
        for (const item of fridgeItems) {
          if (item.imageSource === 'user' && item.imageUrl) {
            await this.fridgeImageStorage.removeByUrl(item.imageUrl);
          }
        }
      } catch (e) {
        this.logger.warn(`Ошибка при очистке фотографий холодильника пользователя ${uid}: ${String(e)}`);
      }
    }

    const runDelete = async (transaction?: Transaction) => {
      const tOpt = transaction ? { transaction } : {};
      const sequelize = this.userModel.sequelize;
      if (sequelize) {
        // Удаляем или очищаем связанные записи для совместимости с базами без ON DELETE CASCADE
        await sequelize.query(
          'DELETE FROM meal_items WHERE "mealId" IN (SELECT id FROM meals WHERE "userId" = :uid)',
          { replacements: { uid }, ...tOpt },
        );
        await sequelize.query('DELETE FROM meals WHERE "userId" = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query(
          'UPDATE meals SET "correctedByAdminId" = NULL WHERE "correctedByAdminId" = :uid',
          { replacements: { uid }, ...tOpt },
        );
        await sequelize.query(
          'DELETE FROM meal_plan_days WHERE "mealPlanId" IN (SELECT id FROM meal_plans WHERE "userId" = :uid)',
          { replacements: { uid }, ...tOpt },
        );
        await sequelize.query('DELETE FROM meal_plans WHERE "userId" = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query('DELETE FROM user_allergies WHERE "userId" = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query('DELETE FROM fridge_items WHERE "userId" = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query('DELETE FROM body_analyses WHERE "userId" = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query('DELETE FROM chat_messages WHERE "userId" = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query('DELETE FROM suggestions WHERE "userId" = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query('DELETE FROM subscriptions WHERE user_id = :uid', {
          replacements: { uid },
          ...tOpt,
        });
        await sequelize.query('DELETE FROM ai_chat_usage WHERE user_id = :uid', {
          replacements: { uid },
          ...tOpt,
        });
      }
      await user.destroy(tOpt);
    };

    if (this.userModel.sequelize) {
      await this.userModel.sequelize.transaction(async (t) => {
        await runDelete(t);
      });
    } else {
      await runDelete();
    }

    return { ok: true };
  }

  async updateUser(id: string, payload: Record<string, unknown>) {
    if (payload.password !== undefined || payload.refreshTokenHash !== undefined) {
      throw new BadRequestException('Пароль здесь менять нельзя (используйте смену пароля в профиле пользователя).');
    }
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    const allowed = [
      'email',
      'role',
      'height',
      'weight',
      'gender',
      'birthDate',
      'goal',
      'targetWeight',
      'activityLevel',
      'avatarUrl',
      'targetCalories',
      'dietaryRestrictions',
      'calorieMode',
      'calorieBand',
    ] as const;
    const data: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in payload && payload[key] !== undefined) {
        data[key] = payload[key];
      }
    }
    if (data.email !== undefined) {
      data.email = String(data.email).trim().toLowerCase();
    }
    if (data.birthDate !== undefined && typeof data.birthDate === 'string') {
      data.birthDate = new Date(data.birthDate);
    }
    if (data.role !== undefined) {
      const r = data.role as string;
      if (!['guest', 'user', 'admin'].includes(r)) {
        throw new BadRequestException('Недопустимая роль');
      }
    }
    await user.update(data as never);
    return this.getUser(id);
  }

  /**
   * Очередь модерации с пагинацией.
   *
   * Каждая запись содержит фотографию в base64, поэтому ответ мог быть
   * очень большим: без ограничения админка тянула все pending-записи сразу.
   */
  getPendingMeals(params?: { limit?: number; offset?: number }) {
    const limit = this.safePaging(params?.limit, 20, 100);
    const offset = this.safeOffset(params?.offset);
    return this.mealModel.findAndCountAll({
      where: { status: 'pending' },
      include: [MealItem],
      limit,
      offset,
      order: [['recognizedAt', 'DESC']],
    });
  }

  getMealById(id: string) {
    return this.mealModel.findByPk(id, { include: [MealItem] });
  }

  /**
   * Исправление распознавания администратором.
   *
   * ВАЖНО: выполняется в транзакции. Раньше позиции удалялись и создавались
   * заново тремя независимыми запросами: при сбое `bulkCreate` запись
   * оставалась БЕЗ позиций, но уже помеченной как исправленная — то есть
   * администратор «терял» распознавание целиком.
   *
   * Дополнительно каждый элемент дополняется значениями по умолчанию,
   * чтобы пустые поля не превращались в NULL и не ломали отображение.
   */
  async correctMeal(
    id: string,
    payload: { items: Array<Partial<MealItem>>; adminNote?: string; adminId?: number },
  ) {
    const meal = await this.mealModel.findByPk(id);
    if (!meal) throw new NotFoundException('Meal not found');

    const items = (payload.items ?? []).filter(
      (it) => String((it as { foodName?: unknown }).foodName ?? '').trim().length > 0,
    );

    // Пустой список недопустим: иначе запись остаётся без распознанных блюд,
    // но помеченной как «исправленная», и пользователь теряет результат.
    if (items.length === 0) {
      throw new BadRequestException(
        'Нужна хотя бы одна позиция с названием блюда — иначе запись останется пустой.',
      );
    }

    await this.mealModel.sequelize!.transaction(async (t) => {
      await this.mealItemModel.destroy({ where: { mealId: id }, transaction: t });

      if (items.length > 0) {
        await this.mealItemModel.bulkCreate(
          items.map((item) => {
            const row = item as Record<string, unknown>;
            const allergens = Array.isArray(row.allergensFound)
              ? (row.allergensFound as unknown[]).map((a) => String(a).trim()).filter(Boolean)
              : [];
            return {
              ...row,
              // Числовые поля приводим к числам: из формы приходят строки.
              calories: Number(row.calories) || 0,
              protein: Number(row.protein) || 0,
              fat: Number(row.fat) || 0,
              carbs: Number(row.carbs) || 0,
              allergensFound: allergens,
              mealId: id,
            };
          }) as MealItem[],
          { transaction: t },
        );
      }

      await this.mealModel.update(
        {
          status: 'corrected',
          adminNote: payload.adminNote ?? null,
          correctedByAdminId: payload.adminId ?? null,
        } as never,
        { where: { id }, transaction: t },
      );
    });

    return this.getMealById(id);
  }

  async rejectMeal(id: string) {
    const meal = await this.mealModel.findByPk(id);
    if (!meal) throw new NotFoundException('Meal not found');
    await meal.update({ status: 'rejected' });
    return { ok: true };
  }

  private categoryFromRecognizedCalories(calories: number): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
    const c = Number(calories) || 0;
    if (c <= 280) return 'snack';
    if (c <= 460) return 'breakfast';
    if (c <= 700) return 'lunch';
    return 'dinner';
  }

  async confirmMeal(id: string) {
    const meal = await this.mealModel.findByPk(id, { include: [MealItem] });
    if (!meal) throw new NotFoundException('Meal not found');
    const items = meal.items ?? [];
    const photo = meal.photoUrl?.trim() ? meal.photoUrl.trim() : null;

    const runInTx = async <T>(fn: (t?: Transaction) => Promise<T>): Promise<T> => {
      const seq = this.mealModel.sequelize;
      if (seq?.transaction) {
        return seq.transaction(fn);
      }
      return fn(undefined);
    };

    await runInTx(async (t) => {
      for (const item of items) {
        const rawName = String(item.foodName ?? '').trim();
        if (!rawName) continue;
        const localizedName = localizeFoodTitleToRu(rawName);

        const allergens = normalizeCatalogAllergenList(item.allergensFound ?? []);
        const dietaryTags = normalizeCatalogDietaryTagList(item.dietaryTags ?? []);

        let ingredients: ProductIngredient[] =
          Array.isArray(item.ingredients) && item.ingredients.length > 0
            ? item.ingredients
                .map((x) => ({
                  name: String(x?.name ?? '').trim(),
                  grams: Math.max(0, Number(x?.grams) || 0),
                }))
                .filter((x) => x.name)
            : [];

        let ingredientsDetailed: ProductIngredientDetailed[] =
          Array.isArray(item.ingredientsDetailed) && item.ingredientsDetailed.length > 0
            ? item.ingredientsDetailed
            : [];

        if (ingredients.length === 0) {
          ingredients = inferIngredientsFromDishTitle(localizedName);
        }

        if (ingredientsDetailed.length === 0 && ingredients.length > 0) {
          ingredientsDetailed = ingredients.map((ing) => ({
            id: randomUUID(),
            name: ing.name,
            amount: ing.grams,
            unit: 'г',
            grams: ing.grams,
          }));
        }

        if (ingredients.length === 0 && ingredientsDetailed.length > 0) {
          ingredients = ingredientsDetailed.map((d) => ({
            name: d.name,
            grams: d.grams || d.amount,
          }));
        }

        const matchKeywords = collectIngredientMatchRoots(ingredients, []);

        await this.productModel.findOrCreate({
          where: { name: localizedName },
          defaults: {
            name: localizedName,
            category: this.categoryFromRecognizedCalories(Number(item.calories) || 0),
            calories: Number(item.calories) || 0,
            protein: Number(item.protein) || 0,
            fat: Number(item.fat) || 0,
            carbs: Number(item.carbs) || 0,
            allergens,
            dietaryTags,
            ingredients,
            ingredientsDetailed,
            matchKeywords,
            imageUrl: photo,
            isFromApi: false,
          } as never,
          ...(t ? { transaction: t } : {}),
        });
      }
      await meal.update({ status: 'confirmed' }, t ? { transaction: t } : {});
    });

    return this.getMealById(id);
  }

  async overviewStats() {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const [
      totalUsers,
      totalMealsRecognized,
      totalProducts,
      totalBaseRecommendations,
      latestStats,
      activeUsersToday,
    ] = await Promise.all([
      this.userModel.count(),
      this.mealModel.count(),
      this.productModel.count(),
      this.baseRecommendationModel.count(),
      // Снимок за сегодня создаётся/обновляется при открытии дашборда.
      this.recordDailySnapshot(),
      this.userModel.count({
        where: { lastActiveAt: { [Op.gte]: start } },
      }),
    ]);
    return {
      totalUsers,
      totalMealsRecognized,
      totalProducts,
      totalBaseRecommendations,
      activeUsersToday,
      latestStats,
    };
  }

  /**
   * Статистика по дням.
   *
   * Раньше метод просто читал `platform_stats`, а таблица была ПУСТА:
   * её никто не заполнял, поэтому график в админке всегда показывал ноль.
   * Теперь, если снимков нет, значения считаются на лету по реальным данным,
   * а `recordDailySnapshot()` сохраняет их при обращении к дашборду.
   */
  async usersStats() {
    const saved = await this.statsModel.findAll({ order: [['date', 'DESC']], limit: 30 });
    if (saved.length > 0) return saved;
    return this.computeDailyStats(30);
  }

  /**
   * Считает статистику по дням за последние N дней на основе реальных данных.
   * Используется, когда снимков в `platform_stats` ещё нет.
   */
  private async computeDailyStats(days: number) {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const [users, meals, plans] = await Promise.all([
      this.userModel.findAll({ attributes: ['id', 'createdAt'], raw: true }),
      this.mealModel.findAll({
        where: { createdAt: { [Op.gte]: since } },
        attributes: ['id', 'createdAt', 'confidence'],
        raw: true,
      }),
      this.mealPlanModel.findAll({
        where: { createdAt: { [Op.gte]: since } },
        attributes: ['id', 'createdAt'],
        raw: true,
      }),
    ]);

    const userRows = users as unknown as Array<{ id: number; createdAt: Date }>;
    const mealRows = meals as unknown as Array<{ createdAt: Date; confidence: number }>;
    const planRows = plans as unknown as Array<{ createdAt: Date }>;

    const totalUsers = userRows.length;
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

      const mealsOfDay = mealRows.filter((m) => inDay(new Date(m.createdAt)));
      const confidenceSum = mealsOfDay.reduce((sum, m) => sum + (Number(m.confidence) || 0), 0);

      out.push({
        date: dayStart,
        // Пользователи, зарегистрированные к этому дню.
        totalUsers: userRows.filter((u) => new Date(u.createdAt) < dayEnd).length,
        activeUsers: userRows.filter((u) => inDay(new Date(u.createdAt))).length,
        totalMealsRecognized: mealsOfDay.length,
        totalMealPlansGenerated: planRows.filter((p) => inDay(new Date(p.createdAt))).length,
        avgConfidenceScore: mealsOfDay.length
          ? Math.round((confidenceSum / mealsOfDay.length) * 1000) / 1000
          : 0,
      });
    }

    return out.reverse();
  }

  /**
   * Сохраняет снимок статистики за сегодня.
   *
   * Вызывается при открытии дашборда: так `platform_stats` наполняется
   * реальными данными, и история сохраняется между перезапусками
   * (агрегация на лету доступна только за период, где есть исходные записи).
   */
  async recordDailySnapshot() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [computed] = await this.computeDailyStats(1);
    if (!computed) return null;

    const existing = await this.statsModel.findOne({ where: { date: today } });
    const payload = {
      date: today,
      totalUsers: computed.totalUsers,
      activeUsers: computed.activeUsers,
      totalMealsRecognized: computed.totalMealsRecognized,
      totalMealPlansGenerated: computed.totalMealPlansGenerated,
      avgConfidenceScore: computed.avgConfidenceScore,
    };

    try {
      if (existing) {
        await existing.update(payload as never);
        return existing;
      }
      return await this.statsModel.create(payload as never);
    } catch {
      // Гонка двух одновременных запросов: запись уже создана — читаем её.
      return this.statsModel.findOne({ where: { date: today } });
    }
  }

  async recognitionStats() {
    const meals = await this.mealModel.findAll({
      attributes: ['id', 'confidence'],
      raw: true,
    });
    const avgConfidenceScore =
      meals.reduce((sum, meal) => sum + (Number(meal.confidence) || 0), 0) / (meals.length || 1);
    return { avgConfidenceScore, total: meals.length };
  }

  mealsStats() {
    return this.mealItemModel.findAll({ limit: 20, order: [['createdAt', 'DESC']] });
  }

  getBaseRecommendations() {
    return this.baseRecommendationModel.findAll({ order: [['createdAt', 'DESC']] });
  }

  createBaseRecommendation(payload: Partial<BaseRecommendation>) {
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = payload as Record<string, unknown>;
    return this.baseRecommendationModel.create(rest as never);
  }

  async updateBaseRecommendation(id: string, payload: Partial<BaseRecommendation>) {
    const recommendation = await this.baseRecommendationModel.findByPk(id);
    if (!recommendation) throw new NotFoundException('Recommendation not found');
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = payload as Record<string, unknown>;
    return recommendation.update(rest as never);
  }

  async deleteBaseRecommendation(id: string) {
    const recommendation = await this.baseRecommendationModel.findByPk(id);
    if (!recommendation) throw new NotFoundException('Recommendation not found');
    await recommendation.destroy();
    return { ok: true };
  }

  /**
   * Список продуктов с пагинацией и поиском.
   *
   * Раньше отдавались ВСЕ продукты разом: при 669 позициях ответ занимал
   * 2.8 МБ, а админка рендерила длинную таблицу. С ростом каталога
   * (импорт рецептов) ответ рос линейно и мог упасть по памяти.
   *
   * Возвращаем `{ rows, count }` — как в `getUsers`, чтобы фронтенд
   * показывал общее число и постраничную навигацию.
   */
  getProducts(params?: { limit?: number; offset?: number; search?: string; category?: string }) {
    const limit = this.safePaging(params?.limit, 50, 200);
    const offset = this.safeOffset(params?.offset);
    const where: Record<string, unknown> = {};

    if (params?.search?.trim()) {
      where.name = { [Op.iLike]: `%${params.search.trim()}%` };
    }
    if (params?.category?.trim()) {
      where.category = params.category.trim();
    }

    return this.productModel.findAndCountAll({
      where,
      limit,
      offset,
      order: [['createdAt', 'DESC']],
    });
  }

  /** Сколько всего продуктов — для навигации без загрузки строк. */
  async countProducts(): Promise<number> {
    return this.productModel.count();
  }

  listIngredients(params?: { category?: string; search?: string; limit?: number; offset?: number }) {
    const where: Record<string, unknown> = {};
    if (params?.category?.trim()) where.category = params.category.trim();
    if (params?.search?.trim()) {
      where.name = { [Op.iLike]: `%${params.search.trim()}%` };
    }
    const limit = Math.min(500, Math.max(1, Number(params?.limit ?? 100)));
    const offset = Math.max(0, Number(params?.offset ?? 0));
    return this.ingredientModel.findAll({
      where,
      order: [['category', 'ASC'], ['name', 'ASC']],
      limit,
      offset,
    });
  }

  createProduct(payload: Partial<Product>) {
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = payload as Record<string, unknown>;
    return this.productModel.create(rest as never);
  }

  async updateProduct(id: string, payload: Partial<Product>) {
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');
    const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = payload as Record<string, unknown>;
    return product.update(rest as never);
  }

  async deleteProduct(id: string) {
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');
    await product.destroy();
    return { ok: true };
  }

  private async upsertIngredientRefs(
    source: Array<{ name: string; measure: string }>,
  ): Promise<{ detailed: ProductIngredientDetailed[]; simple: ProductIngredient[] }> {
    const detailed: ProductIngredientDetailed[] = [];
    const simple: ProductIngredient[] = [];
    for (const item of source) {
      const localized = normalizeIngredientNameRu(item.name);
      const category = inferIngredientCategoryRu(localized);
      let ing = await this.ingredientModel.findOne({ where: { name: localized } });
      if (!ing) {
        ing = await this.ingredientModel.create({
          name: localized,
          category,
          defaultUnit: 'г',
        } as never);
      }
      const det = makeIngredientDetail(localized, item.measure, ing.id);
      detailed.push(det);
      simple.push({
        name: localized,
        grams: Number(det.grams) > 0 ? Number(det.grams) : guessGramsForToken(localized.toLowerCase()),
      });
    }
    return { detailed, simple };
  }

  private snapshotJsonChanged(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  async syncMealPlanSnapshotsFromProductsByDishId(): Promise<{
    daysScanned: number;
    daysUpdated: number;
    snapshotCellsUpdated: number;
  }> {
    const products = await this.productModel.findAll();
    const byId = new Map<string, Product>(products.map((p) => [p.id, p]));

    const patchSnap = (snap: unknown): unknown => {
      if (snap == null || typeof snap !== 'object') return snap;
      const s = snap as MealSlotSnapshot;
      const id = s.dishId;
      if (!id || typeof id !== 'string') return snap;
      const p = byId.get(id);
      if (!p) return snap;
      const ings = (p.ingredients ?? []).map((row) => ({
        name: String(row?.name ?? ''),
        grams: Number(row?.grams) || 0,
      }));
      const detailed = (p.ingredientsDetailed ?? []).map((row) => ({
        id: String(row?.id ?? ''),
        name: String(row?.name ?? ''),
        amount: Number(row?.amount) || 0,
        unit: String(row?.unit ?? ''),
        grams: Number(row?.grams) || 0,
        originalString: row?.originalString ? String(row.originalString) : undefined,
        ingredientId: row?.ingredientId ? String(row.ingredientId) : undefined,
      }));
      return {
        ...s,
        name: p.name,
        imageUrl: p.imageUrl ?? s.imageUrl,
        ingredients: ings.length > 0 ? ings : s.ingredients,
        ingredientsDetailed: detailed.length > 0 ? detailed : (s as Record<string, unknown>).ingredientsDetailed,
      };
    };

    const days = await this.mealPlanDayModel.findAll();
    let daysUpdated = 0;
    let snapshotCellsUpdated = 0;
    for (const day of days) {
      const nb = patchSnap(day.breakfast);
      const nl = patchSnap(day.lunch);
      const nd = patchSnap(day.dinner);
      const os = day.snacks;
      const oe = day.extraSnacks;
      const ns = Array.isArray(os) ? os.map((x) => patchSnap(x)) : patchSnap(os);
      const ne = Array.isArray(oe) ? oe.map((x) => patchSnap(x)) : patchSnap(oe);
      let cells = 0;
      if (this.snapshotJsonChanged(day.breakfast, nb)) cells += 1;
      if (this.snapshotJsonChanged(day.lunch, nl)) cells += 1;
      if (this.snapshotJsonChanged(day.dinner, nd)) cells += 1;
      const countArr = (oldArr: unknown, newArr: unknown): number => {
        if (!Array.isArray(oldArr) && !Array.isArray(newArr)) {
          return this.snapshotJsonChanged(oldArr, newArr) ? 1 : 0;
        }
        const o = Array.isArray(oldArr) ? oldArr : [];
        const n = Array.isArray(newArr) ? newArr : [];
        const len = Math.max(o.length, n.length);
        let c = 0;
        for (let i = 0; i < len; i++) {
          if (this.snapshotJsonChanged(o[i], n[i])) c += 1;
        }
        return c;
      };
      cells += countArr(os, ns);
      cells += countArr(oe, ne);
      if (cells > 0) {
        await day.update({
          breakfast: nb as never,
          lunch: nl as never,
          dinner: nd as never,
          snacks: ns as never,
          extraSnacks: ne as never,
        });
        daysUpdated += 1;
        snapshotCellsUpdated += cells;
      }
    }
    return { daysScanned: days.length, daysUpdated, snapshotCellsUpdated };
  }

  private async aiLocalizeSingleProduct(
    p: Product,
  ): Promise<{ updated: boolean; error?: string }> {
    const seed = (p.ingredients ?? []).map((x) => ({ name: x.name, grams: x.grams }));
    const ai = await this.openAiService.localizeDishForCatalog({
      name: p.name,
      category: p.category,
      ingredientsSeed: seed,
    });
    if (!ai || !ai.nameRu || !ai.ingredients.length) {
      return { updated: false, error: 'empty AI result' };
    }
    const sourceIngredients = ai.ingredients.map((x) => ({
      name: normalizeIngredientNameRu(x.name),
      measure: `${Number.isFinite(Number(x.amount)) && Number(x.amount) > 0 ? Number(x.amount) : 1} ${x.unit || 'шт'}`,
    }));
    const parsed = await this.upsertIngredientRefs(sourceIngredients);
    if (!parsed.simple.length) return { updated: false, error: 'no parsed ingredients' };
    let finalName = String(ai.nameRu).trim();
    const twin = await this.productModel.findOne({ where: { name: finalName } });
    if (twin && twin.id !== p.id) {
      finalName = `${finalName} (${p.id.slice(0, 8)})`;
    }
    await p.update({
      name: finalName,
      ingredients: parsed.simple,
      ingredientsDetailed: parsed.detailed,
      allergens: Array.isArray(ai.allergens) ? ai.allergens.slice(0, 20) : p.allergens,
      dietaryTags: Array.isArray(ai.dietaryTags) ? ai.dietaryTags.slice(0, 20) : p.dietaryTags,
    } as never);
    return { updated: true };
  }

  async aiLocalizeProductById(id: string) {
    if (!this.openAiService.isConfigured()) {
      throw new BadRequestException('OpenAI API key is not configured on the server');
    }
    const product = await this.productModel.findByPk(id);
    if (!product) throw new NotFoundException('Product not found');
    const one = await this.aiLocalizeSingleProduct(product);
    const sync = await this.syncMealPlanSnapshotsFromProductsByDishId();
    return {
      model: this.openAiService.getModelLabel(),
      id,
      updated: one.updated,
      error: one.error ?? null,
      mealPlanDaysScanned: sync.daysScanned,
      mealPlanDaysUpdated: sync.daysUpdated,
      mealPlanSnapshotCellsUpdated: sync.snapshotCellsUpdated,
    };
  }
}
