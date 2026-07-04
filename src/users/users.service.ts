import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { createHash } from 'crypto';
import { Allergen } from '../models/Allergen';
import { FridgeItem } from '../models/FridgeItem';
import { Ingredient } from '../models/Ingredient';
import { User } from '../models/User';
import { normalizeGoalByWeight } from '../common/weight-goal.util';

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
  ) {}

  getById(id: string) {
    return this.userModel.findByPk(id, { include: [Allergen] });
  }

  async updateProfile(id: string, payload: Partial<User> & Record<string, unknown>) {
    const user = await this.userModel.findByPk(id);
    if (!user) throw new NotFoundException('User not found');
    const allowed = [
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

  async calculateBmrAndCalories(userId: string) {
    const user = await this.userModel.findByPk(userId);
    if (!user) throw new NotFoundException('User not found');

    const age = Math.max(
      1,
      Math.floor(
        (Date.now() - new Date(user.birthDate).getTime()) /
          (1000 * 60 * 60 * 24 * 365.25),
      ),
    );
    const base =
      10 * user.weight +
      6.25 * user.height -
      5 * age +
      (user.gender === 'male' ? 5 : -161);
    const activityMultipliers: Record<string, number> = {
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    };
    const maintenance = base * activityMultipliers[user.activityLevel];
    const safeGoal = normalizeGoalByWeight(user.goal, user.weight, user.height);
    const goalDelta: Record<string, number> = {
      lose: -400,
      maintain: 0,
      gain: 300,
    };

    return {
      bmr: Math.round(base),
      dailyCalories: Math.round(maintenance + goalDelta[safeGoal]),
    };
  }

  async blockUser(userId: string) {
    return this.updateProfile(userId, { isBlocked: true, blockedAt: new Date() } as Partial<User>);
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const user = await this.userModel.findByPk(userId, {
      attributes: ['id', 'password'],
    });
    if (!user) throw new NotFoundException('User not found');
    const oldHash = createHash('sha256').update(oldPassword).digest('hex');
    if (user.password !== oldHash) {
      throw new NotFoundException('Old password mismatch');
    }
    const newHash = createHash('sha256').update(newPassword).digest('hex');
    await user.update({ password: newHash } as never);
    return { ok: true };
  }

  async listFridgeItems(userId: string) {
    await this.ensureUserExists(userId);
    return this.fridgeItemModel.findAll({
      where: { userId: Number(userId) },
      order: [['createdAt', 'DESC']],
    });
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
