import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Allergen } from '../models/Allergen';
import { FridgeItem } from '../models/FridgeItem';
import { Ingredient } from '../models/Ingredient';
import { User } from '../models/User';
import { hashPassword, verifyPassword } from '../common/password.util';
import { invalidateUserBlockCache } from '../auth/jwt-auth.guard';
import { calculateEnergy } from '../common/energy.util';
import { normalizeGoalByWeight } from '../common/weight-goal.util';
import { FridgeImageStorage } from '../fridge/fridge-image.storage';

const MASS_UNIT_MAP: Record<string, 'г' | 'кг'> = {
  г: 'г',
  gram: 'г',
  grams: 'г',
  g: 'г',
  гр: 'г',
  грамм: 'г',
  грамма: 'г',
  граммов: 'г',
  кг: 'кг',
  kg: 'кг',
  kilo: 'кг',
  kilos: 'кг',
  килограмм: 'кг',
  килограмма: 'кг',
  килограммов: 'кг',
};

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Allergen) private readonly allergenModel: typeof Allergen,
    @InjectModel(FridgeItem) private readonly fridgeItemModel: typeof FridgeItem,
    @InjectModel(Ingredient) private readonly ingredientModel: typeof Ingredient,
    private readonly fridgeImageStorage: FridgeImageStorage,
  ) {}

  /**
   * Публичный набор полей пользователя. Секреты (`password`, `refreshTokenHash`)
   * наружу не отдаются: раньше они уходили в ответах GET /users/:id,
   * PATCH /users/:id/profile и PATCH /users/:id/allergies.
   */
  private static readonly PUBLIC_ATTRIBUTES = [
    'id',
    'name',
    'email',
    'role',
    'height',
    'weight',
    'gender',
    'birthDate',
    'goal',
    'targetWeight',
    'activityLevel',
    'isBlocked',
    'blockedAt',
    'avatarUrl',
    'lastActiveAt',
    'targetCalories',
    'dietaryRestrictions',
    'foodLikes',
    'foodDislikes',
    'foodHabits',
    'calorieMode',
    'calorieBand',
    'bodyForecastIllustrationUrl',
    'bodyForecastPayload',
    'bodyForecastAt',
    'createdAt',
    'updatedAt',
  ];

  getById(id: string) {
    return this.userModel.findByPk(id, {
      attributes: UsersService.PUBLIC_ATTRIBUTES,
      include: [Allergen],
    });
  }

  async updateProfile(id: string, payload: Partial<User> & Record<string, unknown>) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    const allowed = [
      'name',
      'email',
      'height',
      'weight',
      'birthDate',
      'gender',
      'goal',
      'activityLevel',
      'avatarUrl',
      'targetWeight',
      'targetCalories',
      'dietaryRestrictions',
      'calorieMode',
      'calorieBand',
      'foodLikes',
      'foodDislikes',
      'foodHabits',
    ] as const;
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in payload && payload[key] !== undefined) {
        patch[key] = payload[key];
      }
    }

    // Имя: обрезаем пробелы, ограничиваем длину и запрещаем управляющие
    // символы. Пустая строка сохраняется как null — «имя не задано»,
    // чтобы интерфейс показал запасной вариант (часть email).
    if ('name' in patch) {
      const raw = String(patch.name ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
      if (raw.length > 120) {
        throw new BadRequestException('Имя не должно превышать 120 символов');
      }
      patch.name = raw.length > 0 ? raw : null;
    }
    const nextWeight = Number(patch.weight ?? user.weight);
    const nextHeight = Number(patch.height ?? user.height);
    const requestedGoal = (patch.goal ?? user.goal) as 'lose' | 'maintain' | 'gain';
    patch.goal = normalizeGoalByWeight(requestedGoal, nextWeight, nextHeight);
    await user.update(patch as never);
    const reloaded = await this.getById(id);
    if (!reloaded) throw new NotFoundException('User not found');
    return reloaded;
  }

  async uploadAvatar(id: string, avatarUrl: string) {
    return this.updateProfile(id, { avatarUrl } as Partial<User>);
  }

  async setAllergies(userId: string, allergenIds: string[]) {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new NotFoundException('User not found');
    const allergens = await this.allergenModel.findAll({ where: { id: allergenIds } });
    await user.$set('allergens', allergens);
    return this.getById(userId);
  }

  createAllergen(payload: Partial<Allergen>) {
    return this.allergenModel.create(payload as never);
  }

  getAllergens() {
    return this.allergenModel.findAll();
  }

  async updateAllergen(id: string, payload: Partial<Allergen>) {
    const allergen = await this.allergenModel.findByPk(id);
    if (!allergen) throw new NotFoundException('Allergen not found');
    return allergen.update(payload);
  }

  async deleteAllergen(id: string) {
    const allergen = await this.allergenModel.findByPk(id);
    if (!allergen) throw new NotFoundException('Allergen not found');
    await allergen.destroy();
    return { ok: true };
  }

  /**
   * Энергетические потребности пользователя.
   * Расчёт вынесен в общий модуль (src/common/energy.util.ts), чтобы
   * планировщик и этот эндпоинт не расходились в значениях.
   */
  async calculateBmrAndCalories(userId: string) {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new NotFoundException('User not found');

    const energy = calculateEnergy({
      weightKg: Number(user.weight),
      heightCm: Number(user.height),
      birthDate: user.birthDate,
      gender: user.gender,
      activityLevel: user.activityLevel,
      goal: user.goal,
    });

    return {
      bmr: energy.bmr,
      dailyCalories: energy.dailyCalories,
    };
  }

  async blockUser(userId: string) {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new NotFoundException('User not found');
    await user.update({
      isBlocked: true,
      blockedAt: new Date(),
      // Разрываем активную сессию пользователя.
      refreshTokenHash: null,
    } as never);
    invalidateUserBlockCache(userId);
    return this.getById(userId);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'password'],
    });
    if (!user) throw new NotFoundException('User not found');
    if (!(await verifyPassword(oldPassword, user.password))) {
      throw new NotFoundException('Old password mismatch');
    }
    if (!newPassword || newPassword.length < 6) {
      throw new BadRequestException('Пароль должен быть не короче 6 символов');
    }
    await user.update({ password: await hashPassword(newPassword) } as never);
    return { ok: true };
  }

  /**
   * Список продуктов холодильника с категорией.
   *
   * Категория берётся из справочника ингредиентов (по `ingredientId` или
   * по совпадению названия). Нужна для группировки в интерфейсе: без неё
   * все продукты шли одним списком, и в нём было трудно ориентироваться.
   */
  async listFridgeItems(userId: string) {
    await this.ensureUserExists(userId);
    const items = await this.fridgeItemModel.findAll({
      where: { userId: Number(userId) },
      order: [['createdAt', 'DESC']],
    });

    if (items.length === 0) return [];

    // Один запрос к справочнику вместо запроса на каждый продукт.
    const ingredients = await this.ingredientModel.findAll({
      attributes: ['id', 'name', 'category', 'defaultUnit'],
    });
    const byId = new Map<string, { category: string; defaultUnit: string }>();
    const byName = new Map<string, { category: string; defaultUnit: string }>();
    for (const ing of ingredients) {
      const key = String(ing.name ?? '').trim().toLowerCase();
      const value = {
        category: String(ing.category ?? 'Прочее'),
        defaultUnit: String(ing.defaultUnit ?? 'г'),
      };
      byId.set(String(ing.id), value);
      if (key) byName.set(key, value);
    }

    return items.map((item) => {
      const plain = item.get({ plain: true }) as unknown as Record<string, unknown>;
      const linked =
        (plain.ingredientId ? byId.get(String(plain.ingredientId)) : undefined) ??
        byName.get(String(plain.name ?? '').trim().toLowerCase());
      return {
        ...plain,
        // Категория нужна интерфейсу для группировки.
        category: linked?.category ?? 'Прочее',
        // Признак того, что продукт распознан в справочнике:
        // такие значения корректно учитываются планировщиком.
        matchedInCatalog: Boolean(linked),
      };
    });
  }

  /**
   * Каких продуктов из рецепта не хватает в холодильнике.
   *
   * Используется на странице плана питания: пользователь видит, что нужно
   * докупить перед готовкой. Сравнение идёт по корням слов, поэтому
   * «Куриная грудка» и «курица» считаются одним продуктом.
   */
  async missingFridgeIngredients(
    userId: string,
    ingredients: Array<{ name: string; grams?: number }>,
  ): Promise<{ have: string[]; missing: string[] }> {
    const names = (Array.isArray(ingredients) ? ingredients : [])
      .map((i) => String(i?.name ?? '').trim())
      .filter(Boolean);
    if (names.length === 0) return { have: [], missing: [] };

    const items = await this.fridgeItemModel.findAll({
      where: { userId: Number(userId) },
      attributes: ['name'],
    });
    const fridgeHaystack = items
      .map((i) => String(i.name ?? '').toLowerCase())
      .filter(Boolean);

    const have: string[] = [];
    const missing: string[] = [];

    // Сравниваем по корням слов, а не только по подстроке.
    // «Куриная грудка» и «курица» не являются подстроками друг друга,
    // поэтому простая проверка `includes` давала ложное «не хватает».
    const rootOf = (value: string): string => {
      const first = value.split(/[\s,]+/).filter(Boolean)[0] ?? value;
      // Берём 4 символа: достаточно, чтобы «куриная» и «курица» совпали
      // по корню «кури», но не настолько мало, чтобы ловить случайные слова.
      return first.length > 4 ? first.slice(0, 4) : first;
    };

    for (const raw of names) {
      const needle = raw.toLowerCase().trim();
      const needleRoot = rootOf(needle);
      const found = fridgeHaystack.some((f) => {
        if (f === needle) return true;
        if (f.includes(needle) || needle.includes(f)) return true;
        // Сравнение по корню первого слова.
        return needleRoot.length >= 4 && f.startsWith(needleRoot);
      });
      (found ? have : missing).push(raw);
    }

    return { have, missing };
  }

  /**
   * Сохраняет фотографию продукта.
   *
   * Старый файл удаляется, чтобы том не забивался мусором: при
   * повторной загрузке пользователь заменяет фото, а не добавляет второе.
   */
  async setFridgeImage(
    userId: string,
    itemId: string,
    buffer: Buffer,
    originalName?: string,
  ) {
    await this.ensureUserExists(userId);

    const item = await this.fridgeItemModel.findOne({
      where: { id: itemId, userId: Number(userId) },
    });
    if (!item) throw new NotFoundException('Продукт не найден');

    const stored = await this.fridgeImageStorage.save(buffer, originalName);

    // Прежний файл удаляем только после успешной записи нового.
    if (item.imageSource === 'user' && item.imageUrl) {
      await this.fridgeImageStorage.removeByUrl(item.imageUrl);
    }

    await item.update({
      imageUrl: stored.url,
      imageSource: 'user',
    } as never);

    return { imageUrl: stored.url, imageSource: 'user' as const };
  }

  /** Убирает фотографию: остаётся заглушка по категории. */
  async clearFridgeImage(userId: string, itemId: string) {
    await this.ensureUserExists(userId);

    const item = await this.fridgeItemModel.findOne({
      where: { id: itemId, userId: Number(userId) },
    });
    if (!item) throw new NotFoundException('Продукт не найден');

    if (item.imageSource === 'user' && item.imageUrl) {
      await this.fridgeImageStorage.removeByUrl(item.imageUrl);
    }

    await item.update({
      imageUrl: null,
      imageSource: 'placeholder',
    } as never);

    return { imageUrl: null, imageSource: 'placeholder' as const };
  }

  async addFridgeItem(
    userId: string,
    payload: {
      name: string;
      quantity?: number;
      unit?: string;
      expiresAt?: string | null;
    },
  ) {
    await this.ensureUserExists(userId);
    const unit = this.normalizeMassUnit(payload.unit);
    const ingredient = await this.findIngredientByName(payload.name);
    return this.fridgeItemModel.create({
      userId: Number(userId),
      name: payload.name.trim(),
      quantity: payload.quantity && payload.quantity > 0 ? payload.quantity : 100,
      unit,
      ingredientId: ingredient?.id ?? null,
      expiresAt: payload.expiresAt ? new Date(payload.expiresAt) : null,
    } as never);
  }

  async updateFridgeItem(
    userId: string,
    itemId: string,
    payload: {
      name?: string;
      quantity?: number;
      unit?: string;
      expiresAt?: string | null;
    },
  ) {
    const row = await this.fridgeItemModel.findOne({
      where: { id: itemId, userId: Number(userId) },
    });
    if (!row) throw new NotFoundException('Fridge item not found');
    const patch: Record<string, unknown> = {};
    if (payload.name !== undefined) {
      patch.name = payload.name.trim();
      const ingredient = await this.findIngredientByName(payload.name);
      patch.ingredientId = ingredient?.id ?? null;
    }
    if (payload.quantity !== undefined) patch.quantity = payload.quantity > 0 ? payload.quantity : 100;
    if (payload.unit !== undefined) patch.unit = this.normalizeMassUnit(payload.unit);
    if (payload.expiresAt !== undefined) {
      patch.expiresAt = payload.expiresAt ? new Date(payload.expiresAt) : null;
    }
    await row.update(patch as never);
    return row;
  }

  async deleteFridgeItem(userId: string, itemId: string) {
    const row = await this.fridgeItemModel.findOne({
      where: { id: itemId, userId: Number(userId) },
    });
    if (!row) throw new NotFoundException('Fridge item not found');
    await row.destroy();
    return { ok: true };
  }

  private async ensureUserExists(userId: string) {
    const user = await this.userModel.findByPk(userId, { attributes: ['id'] });
    if (!user) throw new NotFoundException('User not found');
  }

  private normalizeMassUnit(raw?: string): 'г' | 'кг' {
    const key = String(raw ?? '')
      .trim()
      .toLowerCase();
    return MASS_UNIT_MAP[key] ?? 'г';
  }

  private normalizeIngredientName(name: string): string {
    const t = String(name ?? '')
      .trim()
      .replace(/\s+/g, ' ');
    if (!t) return t;
    return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
  }

  private async findIngredientByName(rawName?: string): Promise<Ingredient | null> {
    const name = this.normalizeIngredientName(String(rawName ?? ''));
    if (!name) return null;
    return this.ingredientModel.findOne({ where: { name } });
  }
}
