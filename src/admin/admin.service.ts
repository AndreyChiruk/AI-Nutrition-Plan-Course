import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash, randomUUID } from 'crypto';
import { Op } from 'sequelize';
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
import { localizeFoodTitleToRu, localizeProductFields } from '../meal-plan/food-localize-ru';
import { OpenAiService } from '../openai/openai.service';
import {
  inferIngredientCategoryRu,
  makeIngredientDetail,
  normalizeIngredientNameRu,
} from './recipe-import.util';
import { inferMealSlotFromDishName } from '../meal-plan/dish-category-infer.util';

@Injectable()
export class AdminService {
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
    private readonly openAiService: OpenAiService,
  ) {}

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

  createUser(payload: {
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
    return this.userModel.create(
      {
        email: payload.email,
        password: createHash('sha256').update(payload.password).digest('hex'),
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
  }

  async blockUser(id: string) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    return user.update({ isBlocked: true, blockedAt: new Date() });
  }

  async unblockUser(id: string) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    return user.update({ isBlocked: false, blockedAt: undefined });
  }

  async deleteUser(id: string) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    await user.destroy();
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

  getPendingMeals() {
    return this.mealModel.findAll({ where: { status: 'pending' }, include: [MealItem] });
  }

  getMealById(id: string) {
    return this.mealModel.findByPk(id, { include: [MealItem] });
  }

  async correctMeal(
    id: string,
    payload: { items: Array<Partial<MealItem>>; adminNote?: string; adminId?: number },
  ) {
    const meal = await this.mealModel.findByPk(id);
    if (!meal) throw new NotFoundException('Meal not found');
    await this.mealItemModel.destroy({ where: { mealId: id } });
    await this.mealItemModel.bulkCreate(
      payload.items.map((item) => ({ ...item, mealId: id })) as MealItem[],
    );
    await meal.update({
      status: 'corrected',
      adminNote: payload.adminNote,
      correctedByAdminId: payload.adminId,
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

    for (const item of items) {
      const rawName = String(item.foodName ?? '').trim();
      if (!rawName) continue;
      const localizedName = localizeFoodTitleToRu(rawName);
      const exists = await this.productModel.findOne({ where: { name: localizedName } });
      if (exists) continue;

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

      await this.productModel.create({
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
      } as never);
    }
    await meal.update({ status: 'confirmed' });
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
      this.statsModel.findOne({ order: [['date', 'DESC']] }),
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

  usersStats() {
    return this.statsModel.findAll({ order: [['date', 'DESC']], limit: 30 });
  }

  async recognitionStats() {
    const meals = await this.mealModel.findAll();
    const avgConfidenceScore =
      meals.reduce((sum, meal) => sum + meal.confidence, 0) / (meals.length || 1);
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

  getProducts() {
    return this.productModel.findAll({ order: [['createdAt', 'DESC']] });
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

  private categoryFromMealName(name: string): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
    return inferMealSlotFromDishName(name);
  }

  private roughCaloriesByName(name: string): number {
    const n = name.toLowerCase();
    if (n.includes('salad')) return 210;
    if (n.includes('soup')) return 320;
    if (n.includes('lobster') || n.includes('crab') || n.includes('beef')) return 360;
    if (n.includes('pasta') || n.includes('rice')) return 420;
    if (n.includes('cake')) return 380;
    return 300;
  }

  private categoryFromTheMealDbCategory(
    apiCategory: string,
    mealName: string,
  ): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
    return this.mealSlotByApiCategory(apiCategory, mealName);
  }

  private mealTypesBySlot(slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'): string[] {
    if (slot === 'breakfast') return ['завтрак'];
    if (slot === 'lunch') return ['обед'];
    if (slot === 'dinner') return ['ужин'];
    return ['перекус'];
  }

  private mealSlotByApiCategory(
    apiCategory: string,
    mealName: string,
  ): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
    const c = apiCategory.toLowerCase().trim();
    if (/breakfast/.test(c)) return 'breakfast';
    if (/dessert|side|starter|beverage|drink|cocktail/.test(c)) return 'snack';
    if (
      /^(chicken|beef|pork|pasta|seafood|lamb|goat|vegan|vegetarian)$/i.test(c) ||
      /miscellaneous/i.test(c)
    ) {
      return 'lunch';
    }
    return this.categoryFromMealName(mealName);
  }

  private extractExternalIngredients(raw: Record<string, unknown>): Array<{ name: string; measure: string }> {
    const out: Array<{ name: string; measure: string }> = [];
    for (let i = 1; i <= 20; i++) {
      const v = raw[`strIngredient${i}`];
      const m = raw[`strMeasure${i}`];
      if (typeof v !== 'string') continue;
      const trimmed = v.trim();
      if (!trimmed) continue;
      out.push({ name: trimmed, measure: String(m ?? '').trim() });
    }
    return out;
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

  private normalizeCatalogDishName(name: string): string {
    return String(name ?? '')
      .replace(/\s·[SML]$/i, '')
      .trim()
      .toLowerCase();
  }

  private remapOneSnapshotToCatalog(
    snap: unknown,
    productByNormName: Map<string, Product>,
  ): unknown {
    if (snap == null || typeof snap !== 'object') return snap;
    if (!('name' in snap) || typeof (snap as MealSlotSnapshot).name !== 'string') return snap;
    const s = { ...(snap as MealSlotSnapshot & Record<string, unknown>) };
    const key = this.normalizeCatalogDishName(s.name);
    const p = productByNormName.get(key);
    if (p) {
      s.dishId = p.id;
      if (p.imageUrl) s.imageUrl = p.imageUrl;
      const ings = p.ingredients;
      const detailed = p.ingredientsDetailed;
      if (Array.isArray(ings) && ings.length > 0) {
        s.ingredients = ings.map((row) => ({
          name: String(row?.name ?? ''),
          grams: Number(row?.grams) || 0,
        }));
      }
      if (Array.isArray(detailed) && detailed.length > 0) {
        s.ingredientsDetailed = detailed.map((row) => ({
          id: String(row?.id ?? ''),
          name: String(row?.name ?? ''),
          amount: Number(row?.amount) || 0,
          unit: String(row?.unit ?? ''),
          grams: Number(row?.grams) || 0,
          originalString: row?.originalString ? String(row.originalString) : undefined,
          ingredientId: row?.ingredientId ? String(row.ingredientId) : undefined,
        }));
      }
    } else {
      delete s.dishId;
    }
    return s;
  }

  private snapshotJsonChanged(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) !== JSON.stringify(b);
  }

  async remapMealPlanDaySnapshotsToProducts(): Promise<{
    daysScanned: number;
    daysUpdated: number;
    snapshotCellsUpdated: number;
  }> {
    const products = await this.productModel.findAll();
    const map = new Map<string, Product>();
    for (const p of products) {
      map.set(this.normalizeCatalogDishName(p.name), p);
    }
    const days = await this.mealPlanDayModel.findAll();
    let daysUpdated = 0;
    let snapshotCellsUpdated = 0;
    for (const day of days) {
      const nb = this.remapOneSnapshotToCatalog(day.breakfast, map);
      const nl = this.remapOneSnapshotToCatalog(day.lunch, map);
      const nd = this.remapOneSnapshotToCatalog(day.dinner, map);
      const os = day.snacks;
      const oe = day.extraSnacks;
      const ns = Array.isArray(os)
        ? os.map((x) => this.remapOneSnapshotToCatalog(x, map))
        : this.remapOneSnapshotToCatalog(os, map);
      const ne = Array.isArray(oe)
        ? oe.map((x) => this.remapOneSnapshotToCatalog(x, map))
        : this.remapOneSnapshotToCatalog(oe, map);
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

  async localizeCatalogToRussian(): Promise<{
    productsUpdated: number;
    productsTotal: number;
    nameCollisionsResolved: number;
    mealPlanDaysScanned: number;
    mealPlanDaysUpdated: number;
    mealPlanSnapshotCellsUpdated: number;
  }> {
    const rows = await this.productModel.findAll({ order: [['id', 'ASC']] });
    let productsUpdated = 0;
    let nameCollisionsResolved = 0;
    for (const p of rows) {
      const { name: locName, ingredients: locIng } = localizeProductFields(
        p.name,
        (p.ingredients ?? []) as ProductIngredient[],
      );
      if (locName === p.name && JSON.stringify(locIng) === JSON.stringify(p.ingredients ?? [])) {
        continue;
      }
      let finalName = locName;
      const twin = await this.productModel.findOne({ where: { name: finalName } });
      if (twin && twin.id !== p.id) {
        nameCollisionsResolved += 1;
        const hint = p.name.length > 24 ? `${p.name.slice(0, 21)}…` : p.name;
        finalName = `${locName} (${hint})`;
      }
      await p.update({ name: finalName, ingredients: locIng } as never);
      productsUpdated += 1;
    }
    const sync = await this.syncMealPlanSnapshotsFromProductsByDishId();
    return {
      productsUpdated,
      productsTotal: rows.length,
      nameCollisionsResolved,
      mealPlanDaysScanned: sync.daysScanned,
      mealPlanDaysUpdated: sync.daysUpdated,
      mealPlanSnapshotCellsUpdated: sync.snapshotCellsUpdated,
    };
  }

  async replaceCatalogFromTheMealDb(opts?: {
    perCategory?: number;
    delayMs?: number;
    withIngredientDetails?: boolean;
  }) {
    const perCategory = Math.min(500, Math.max(1, opts?.perCategory ?? 120));
    const delayMs = Math.min(2500, Math.max(0, opts?.delayMs ?? 80));
    const withIngredientDetails = opts?.withIngredientDetails !== false;

    const removed = await this.productModel.destroy({ where: {} });
    await this.ingredientModel.destroy({ where: {} });

    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    const fetchJson = async <T>(url: string): Promise<T | null> => {
      try {
        const r = await fetch(url);
        if (!r.ok) return null;
        return (await r.json()) as T;
      } catch {
        return null;
      }
    };

    const mealCategoriesPayload = await fetchJson<{ categories?: Array<{ strCategory?: string }> }>(
      'https://www.themealdb.com/api/json/v1/1/categories.php',
    );
    if (!mealCategoriesPayload?.categories?.length) {
      throw new BadRequestException('TheMealDB: не удалось загрузить категории блюд');
    }
    const mealCategories = mealCategoriesPayload.categories
      .map((c) => String(c.strCategory ?? '').trim())
      .filter(Boolean);

    const drinkCategoriesPayload = await fetchJson<{ drinks?: Array<{ strCategory?: string }> }>(
      'https://www.thecocktaildb.com/api/json/v1/1/list.php?c=list',
    );
    const drinkCategories = (drinkCategoriesPayload?.drinks ?? [])
      .map((d) => String(d.strCategory ?? '').trim())
      .filter(Boolean)
      .slice(0, 8);

    const seenSources = new Set<string>();
    let imported = 0;
    let skippedDuplicates = 0;
    const errors: string[] = [];

    const persistRecipe = async (data: {
      sourceMealId: string;
      externalName: string;
      imageUrl?: string | null;
      sourceUrl?: string | null;
      categoryLabel: string;
      cuisine?: string | null;
      description?: string | null;
      sourceIngredients: Array<{ name: string; measure: string }>;
    }) => {
      if (seenSources.has(data.sourceMealId)) {
        skippedDuplicates += 1;
        return;
      }
      seenSources.add(data.sourceMealId);

      const localizedSourceIngredients = data.sourceIngredients.map((x) => ({
        name: localizeFoodTitleToRu(x.name),
        measure: x.measure,
      }));
      const withLocalize = localizeProductFields(
        data.externalName,
        localizedSourceIngredients.map((x) => ({ name: x.name, grams: 0 })),
      );
      const parsed = await this.upsertIngredientRefs(
        withIngredientDetails ? localizedSourceIngredients : localizedSourceIngredients.slice(0, 20),
      );
      const ingredientsSimple = parsed.simple.length > 0 ? parsed.simple : withLocalize.ingredients;
      const ingredientsDetailed = parsed.detailed.length
        ? parsed.detailed.map((it) => ({
            ...it,
            name:
              withLocalize.ingredients.find((r) => r.name.toLowerCase() === it.name.toLowerCase())?.name ?? it.name,
          }))
        : [];

      const ruName = withLocalize.name;
      const slotCategory = this.mealSlotByApiCategory(data.categoryLabel, ruName);
      const calories = Math.max(
        120,
        ingredientsSimple.reduce((sum, i) => sum + Number(i.grams || 0), 0) > 0
          ? Math.round(ingredientsSimple.reduce((sum, i) => sum + Number(i.grams || 0), 0) * 1.2)
          : this.roughCaloriesByName(ruName),
      );
      const mealTypes = this.mealTypesBySlot(slotCategory);

      let finalName = ruName;
      const twin = await this.productModel.findOne({ where: { name: finalName } });
      if (twin) finalName = `${ruName} (${data.sourceMealId})`;

      await this.productModel.create({
        name: finalName,
        category: slotCategory,
        calories,
        protein: Math.round((calories * 0.22) / 4),
        fat: Math.round((calories * 0.28) / 9),
        carbs: Math.round((calories * 0.5) / 4),
        allergens: [],
        ingredients: ingredientsSimple,
        ingredientsDetailed,
        imageUrl: data.imageUrl ?? null,
        isFromApi: true,
        sourceMealId: data.sourceMealId,
        sourceUrl: data.sourceUrl ?? null,
        servings: 1,
        description: data.description ?? null,
        cuisine: data.cuisine ?? null,
        mealTypes,
      } as never);
      imported += 1;
    };

    for (const cat of mealCategories) {
      if (delayMs > 0) await sleep(delayMs);
      const list = await fetchJson<{ meals?: Array<{ idMeal?: string }> }>(
        `https://www.themealdb.com/api/json/v1/1/filter.php?c=${encodeURIComponent(cat)}`,
      );
      const ids = (list?.meals ?? []).map((m) => String(m.idMeal ?? '').trim()).filter(Boolean).slice(0, perCategory);
      for (const id of ids) {
        if (delayMs > 0) await sleep(delayMs);
        const detailPayload = await fetchJson<{ meals?: Record<string, unknown>[] }>(
          `https://www.themealdb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(id)}`,
        );
        const raw = detailPayload?.meals?.[0];
        if (!raw) continue;
        const sourceIngredients = this.extractExternalIngredients(raw);
        if (!sourceIngredients.length) continue;
        try {
          await persistRecipe({
            sourceMealId: `mealdb:${id}`,
            externalName: String(raw.strMeal ?? ''),
            imageUrl: String(raw.strMealThumb ?? '').trim() || null,
            sourceUrl: String(raw.strSource ?? raw.strYoutube ?? '').trim() || null,
            categoryLabel: cat,
            cuisine: String(raw.strArea ?? '').trim() || null,
            description: String(raw.strInstructions ?? '').trim() || null,
            sourceIngredients,
          });
        } catch (e: unknown) {
          errors.push(`mealdb:${id} ${String((raw.strMeal as string) ?? '')}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    for (const cat of drinkCategories) {
      if (delayMs > 0) await sleep(delayMs);
      const list = await fetchJson<{ drinks?: Array<{ idDrink?: string }> }>(
        `https://www.thecocktaildb.com/api/json/v1/1/filter.php?c=${encodeURIComponent(cat)}`,
      );
      const ids = (list?.drinks ?? [])
        .map((d) => String(d.idDrink ?? '').trim())
        .filter(Boolean)
        .slice(0, Math.max(20, Math.floor(perCategory / 2)));
      for (const id of ids) {
        if (delayMs > 0) await sleep(delayMs);
        const detailPayload = await fetchJson<{ drinks?: Record<string, unknown>[] }>(
          `https://www.thecocktaildb.com/api/json/v1/1/lookup.php?i=${encodeURIComponent(id)}`,
        );
        const raw = detailPayload?.drinks?.[0];
        if (!raw) continue;
        const sourceIngredients = this.extractExternalIngredients(raw);
        if (!sourceIngredients.length) continue;
        try {
          await persistRecipe({
            sourceMealId: `cocktaildb:${id}`,
            externalName: String(raw.strDrink ?? ''),
            imageUrl: String(raw.strDrinkThumb ?? '').trim() || null,
            sourceUrl: String(raw.strVideo ?? '').trim() || null,
            categoryLabel: 'Drink',
            cuisine: 'Напитки',
            description: String(raw.strInstructions ?? '').trim() || null,
            sourceIngredients,
          });
        } catch (e: unknown) {
          errors.push(
            `cocktaildb:${id} ${String((raw.strDrink as string) ?? '')}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }

    const remap = await this.remapMealPlanDaySnapshotsToProducts();
    return {
      removed,
      imported,
      skippedDuplicates,
      recipesGoalReached: imported >= 500,
      uniqueRecipesSeen: seenSources.size,
      ingredientRows: await this.ingredientModel.count(),
      categoriesProcessed: mealCategories.length + drinkCategories.length,
      errors: errors.slice(0, 120),
      mealPlanDaysScanned: remap.daysScanned,
      mealPlanDaysUpdated: remap.daysUpdated,
      mealPlanSnapshotCellsUpdated: remap.snapshotCellsUpdated,
    };
  }

  async importPublicProducts(limit = 24) {
    const endpoints = [
      'https://www.themealdb.com/api/json/v1/1/filter.php?c=Seafood',
      'https://www.themealdb.com/api/json/v1/1/filter.php?c=Chicken',
      'https://www.themealdb.com/api/json/v1/1/filter.php?c=Vegetarian',
      'https://www.themealdb.com/api/json/v1/1/filter.php?c=Dessert',
    ];
    let imported = 0;
    let skipped = 0;
    for (const url of endpoints) {
      try {
        const response = await fetch(url);
        if (!response.ok) continue;
        const payload = (await response.json()) as {
          meals?: Array<{ strMeal?: string; strMealThumb?: string }>;
        };
        const rows = (payload.meals ?? [])
          .map((m) => ({
            name: String(m.strMeal ?? '').trim(),
            thumb: String(m.strMealThumb ?? '').trim() || null,
          }))
          .filter((m) => m.name.length > 0)
          .slice(0, limit);
        for (const row of rows) {
          const exists = await this.productModel.findOne({ where: { name: row.name } });
          if (exists) {
            skipped += 1;
            continue;
          }
          const calories = this.roughCaloriesByName(row.name);
          await this.productModel.create({
            name: row.name,
            category: this.categoryFromMealName(row.name),
            calories,
            protein: Math.round((calories * 0.22) / 4),
            fat: Math.round((calories * 0.28) / 9),
            carbs: Math.round((calories * 0.5) / 4),
            allergens: [],
            ingredients: inferIngredientsFromDishTitle(row.name),
            imageUrl: row.thumb,
          } as never);
          imported += 1;
        }
      } catch {
        continue;
      }
    }

    const showcase = [
      { name: 'Kamchatka Crab Bowl', category: 'lunch', calories: 340 },
      { name: 'Lobster with Herbs', category: 'dinner', calories: 360 },
      { name: 'Crab Avocado Salad', category: 'snack', calories: 250 },
    ] as const;
    for (const item of showcase) {
      const exists = await this.productModel.findOne({ where: { name: item.name } });
      if (exists) {
        skipped += 1;
        continue;
      }
      await this.productModel.create({
        ...item,
        protein: Math.round((item.calories * 0.25) / 4),
        fat: Math.round((item.calories * 0.3) / 9),
        carbs: Math.round((item.calories * 0.45) / 4),
        allergens: ['морепродукты'],
        ingredients: inferIngredientsFromDishTitle(item.name),
      } as never);
      imported += 1;
    }
    return { imported, skipped };
  }

  async backfillProductIngredients() {
    const rows = await this.productModel.findAll();
    let updated = 0;
    for (const p of rows) {
      const cur = (p as Product & { ingredients?: unknown }).ingredients;
      if (Array.isArray(cur) && cur.length > 0) continue;
      const inferred = inferIngredientsFromDishTitle(p.name);
      if (inferred.length === 0) continue;
      await p.update({ ingredients: inferred } as never);
      updated += 1;
    }
    return { updated, total: rows.length };
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

  async aiLocalizeCatalogBatch(params?: { limit?: number; offset?: number; onlyMissingDetailed?: boolean }) {
    if (!this.openAiService.isConfigured()) {
      throw new BadRequestException('OpenAI API key is not configured on the server');
    }
    const limit = Math.min(50, Math.max(1, Number(params?.limit ?? 10)));
    const offset = Math.max(0, Number(params?.offset ?? 0));
    const where = params?.onlyMissingDetailed
      ? {
          [Op.or]: [{ ingredientsDetailed: { [Op.eq]: [] } }, { ingredientsDetailed: { [Op.is]: null } }],
        }
      : undefined;
    const rows = await this.productModel.findAll({
      where,
      order: [['createdAt', 'DESC'], ['id', 'ASC']],
      limit,
      offset,
    });
    let processed = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];
    const processedItems: Array<{ id: string; nameBefore: string; updated: boolean }> = [];
    for (const p of rows) {
      processed += 1;
      try {
        const nameBefore = p.name;
        const one = await this.aiLocalizeSingleProduct(p);
        if (!one.updated) {
          failed += 1;
          errors.push(`${p.id}: ${one.error ?? 'no update'}`);
          processedItems.push({ id: p.id, nameBefore, updated: false });
          continue;
        }
        updated += 1;
        processedItems.push({ id: p.id, nameBefore, updated: true });
      } catch (e: unknown) {
        failed += 1;
        errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
        processedItems.push({ id: p.id, nameBefore: p.name, updated: false });
      }
    }
    const sync = await this.syncMealPlanSnapshotsFromProductsByDishId();
    return {
      model: this.openAiService.getModelLabel(),
      limit,
      offset,
      processed,
      updated,
      failed,
      mealPlanDaysScanned: sync.daysScanned,
      mealPlanDaysUpdated: sync.daysUpdated,
      mealPlanSnapshotCellsUpdated: sync.snapshotCellsUpdated,
      errors: errors.slice(0, 30),
      processedItems: processedItems.slice(0, 30),
    };
  }

  async aiLocalizeCatalogAll(params?: {
    batchSize?: number;
    onlyMissingDetailed?: boolean;
    delayMs?: number;
  }) {
    if (!this.openAiService.isConfigured()) {
      throw new BadRequestException('OpenAI API key is not configured on the server');
    }
    const batchSize = Math.min(50, Math.max(1, Number(params?.batchSize ?? 10)));
    const onlyMissingDetailed = Boolean(params?.onlyMissingDetailed);
    const delayMs = Math.min(5000, Math.max(0, Number(params?.delayMs ?? 300)));
    const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const where = onlyMissingDetailed
      ? {
          [Op.or]: [{ ingredientsDetailed: { [Op.eq]: [] } }, { ingredientsDetailed: { [Op.is]: null } }],
        }
      : undefined;
    const totalCandidates = await this.productModel.count({ where });
    let offset = 0;
    let batches = 0;
    let processed = 0;
    let updated = 0;
    let failed = 0;
    const errors: string[] = [];
    const processedItems: Array<{ id: string; nameBefore: string; updated: boolean }> = [];
    while (true) {
      const rows = await this.productModel.findAll({
        where,
        order: [['createdAt', 'DESC'], ['id', 'ASC']],
        limit: batchSize,
        offset: onlyMissingDetailed ? 0 : offset,
      });
      if (rows.length === 0) break;
      batches += 1;
      for (const p of rows) {
        if (delayMs > 0) {
          await sleep(delayMs);
        }
        processed += 1;
        try {
          const nameBefore = p.name;
          const one = await this.aiLocalizeSingleProduct(p);
          if (!one.updated) {
            failed += 1;
            errors.push(`${p.id}: ${one.error ?? 'no update'}`);
            processedItems.push({ id: p.id, nameBefore, updated: false });
            continue;
          }
          updated += 1;
          processedItems.push({ id: p.id, nameBefore, updated: true });
        } catch (e: unknown) {
          failed += 1;
          errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
          processedItems.push({ id: p.id, nameBefore: p.name, updated: false });
        }
      }
      if (!onlyMissingDetailed) offset += rows.length;
    }
    const sync = await this.syncMealPlanSnapshotsFromProductsByDishId();
    return {
      model: this.openAiService.getModelLabel(),
      batchSize,
      delayMs,
      onlyMissingDetailed,
      totalCandidates,
      batches,
      processed,
      updated,
      failed,
      mealPlanDaysScanned: sync.daysScanned,
      mealPlanDaysUpdated: sync.daysUpdated,
      mealPlanSnapshotCellsUpdated: sync.snapshotCellsUpdated,
      errors: errors.slice(0, 60),
      processedItems: processedItems.slice(0, 50),
    };
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
