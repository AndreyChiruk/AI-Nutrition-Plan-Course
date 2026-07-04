import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Sequelize } from 'sequelize';
import { Allergen } from '../models/Allergen';
import { FridgeItem } from '../models/FridgeItem';
import { MealPlan } from '../models/MealPlan';
import { MealPlanDay, MealSlotSnapshot, MealTrackStatus, MealTrackSlot } from '../models/MealPlanDay';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { OpenAiService } from '../openai/openai.service';
import type { ConstructorRefinementChange } from '../openai/openai.validators';
import {
  CALORIE_BANDS,
  dayCaloriesFromBand,
  filterProductsByDietary,
  getDietWarningsForProduct,
  productHasUserAllergen,
  productLooksLikeAlcoholicSnack,
} from './dietary-rules';
import { inferIngredientsFromDishTitle } from './ingredient-utils';
import { collectIngredientMatchRoots } from './ingredient-match.util';
import { computeFullYearsFromBirthDate } from '../common/age.util';
import {
  normalizeRuFoodText,
  resolveCatalogProductByName,
  ruHaystackMatchesKeyword,
} from '../common/ingredient-name-match';
import { normalizeGoalByWeight } from '../common/weight-goal.util';
import {
  dishStoredOrInferredMatchesSlot,
  type MealSlotKeyInfer,
} from './dish-category-infer.util';

function primarySnackFromDb(raw: unknown): MealSlotSnapshot | null {
  if (raw == null) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    if (first && typeof first === 'object' && first !== null && 'name' in first) {
      return first as MealSlotSnapshot;
    }
    return null;
  }
  if (typeof raw === 'object' && 'name' in raw) {
    return raw as MealSlotSnapshot;
  }
  return null;
}

export type SaveMealPlanDayDto = {
  dayNumber: number;
  breakfast: MealSlotSnapshot | null;
  lunch: MealSlotSnapshot | null;
  dinner: MealSlotSnapshot | null;
  snack: MealSlotSnapshot | null;
  extraSnacks?: MealSlotSnapshot[] | null;
};

type MealSlotKey = 'breakfast' | 'lunch' | 'dinner' | 'snack';

const SLOT_ORDER: MealSlotKey[] = ['breakfast', 'lunch', 'dinner', 'snack'];

type ConstructorPlanSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'snack2';

const CONSTRUCTOR_PLAN_SLOTS: ConstructorPlanSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'snack2'];

const DEFAULT_DIST = { breakfast: 0.25, lunch: 0.35, dinner: 0.25, snacks: 0.15 };
const CALORIE_TARGET_TOLERANCE = 0.1;

type PreferenceContext = {
  /** Отдельные фразы из профиля (без перекрёстного расширения) — для проверки «каждое любимое учтено». */
  baseLikes: string[];
  likes: string[];
  dislikes: string[];
  fridgeNames: string[];
};

@Injectable()
export class MealPlanService {
  constructor(
    @InjectModel(MealPlan) private readonly mealPlanModel: typeof MealPlan,
    @InjectModel(MealPlanDay) private readonly mealPlanDayModel: typeof MealPlanDay,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Product) private readonly productModel: typeof Product,
    @InjectModel(FridgeItem) private readonly fridgeItemModel: typeof FridgeItem,
    private readonly openAiService: OpenAiService,
  ) {}

  private uid(userId: string) {
    return Number(userId);
  }


  private async archiveActivePlans(userId: string) {
    await this.mealPlanModel.update(
      { status: 'completed' },
      { where: { userId: this.uid(userId), status: 'active' } },
    );
  }

  private formatRuPlanDateTime(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  private sanitizePlanBaseName(raw: string | null | undefined): string {
    let s = (raw ?? '').trim();
    if (!s) return 'Без названия';
    for (let i = 0; i < 8; i++) {
      const before = s;
      s = s
        .replace(/^копия\s+от\s\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2}\s*[—\-]\s*/i, '')
        .replace(/^копия\s*:\s*/i, '')
        .trim();
      if (s === before) break;
    }
    return s || 'Без названия';
  }

  private clonePlanDisplayName(srcName: string | null | undefined, createdAt: Date): string {
    const base = this.sanitizePlanBaseName(srcName ?? undefined);
    return `Копия от ${this.formatRuPlanDateTime(createdAt)} — ${base}`;
  }

  private allergySet(user: User & { allergens?: Allergen[] }) {
    return new Set((user.allergens ?? []).map((a) => String(a.name).toLowerCase()));
  }

  private filterProductsByUserAllergens(products: Product[], user: User & { allergens?: Allergen[] }) {
    const names = this.allergySet(user);
    return products.filter((p) => !productHasUserAllergen(p, names));
  }

  private async loadPlanningUser(userId: string) {
    return (await this.userModel.findByPk(this.uid(userId), {
      include: [Allergen],
    })) as (User & { allergens?: Allergen[] }) | null;
  }

  private normalizeKeywordList(raw: unknown): string[] {
    if (!Array.isArray(raw)) return [];
    return raw
      .map((v) => String(v).trim().toLowerCase())
      .filter(Boolean);
  }

  private expandDislikeKeywords(keys: string[]): string[] {
    const s = new Set(keys);
    for (const x of keys) {
      if (/греч/i.test(x)) {
        s.add('греч');
        s.add('гречн');
      }
    }
    return [...s];
  }

  private expandSingleLikeKeyword(key: string): string[] {
    const k = String(key ?? '')
      .trim()
      .toLowerCase();
    if (!k) return [];
    const s = new Set<string>([k]);
    if (ruHaystackMatchesKeyword(k, 'суп')) {
      s.add('борщ');
      s.add('уха');
      s.add('солян');
      s.add('похлеб');
      s.add('рамен');
      s.add('том ям');
    }
    return [...s];
  }

  private expandLikeKeywords(keys: string[]): string[] {
    const s = new Set<string>();
    for (const key of keys) {
      for (const x of this.expandSingleLikeKeyword(key)) {
        s.add(x);
      }
    }
    return [...s];
  }

  private async preferenceContext(userId: string, user: User): Promise<PreferenceContext> {
    const fridge = await this.fridgeItemModel.findAll({
      where: { userId: this.uid(userId) },
      attributes: ['name'],
      limit: 200,
    });
    const baseLikes = this.normalizeKeywordList(user.foodLikes);
    return {
      baseLikes,
      likes: this.expandLikeKeywords(baseLikes),
      dislikes: this.normalizeKeywordList(user.foodDislikes),
      fridgeNames: fridge.map((r) => String(r.name).trim().toLowerCase()).filter(Boolean),
    };
  }

  private dishHaystackForProduct(p: Product): string {
    const chunks: string[] = [String(p.name ?? '').toLowerCase()];
    const detailed = (p as Product & { ingredientsDetailed?: Array<{ name?: string }> }).ingredientsDetailed;
    if (Array.isArray(detailed)) {
      for (const row of detailed) chunks.push(String(row?.name ?? '').toLowerCase());
    }
    const ing = (p as Product & { ingredients?: Array<{ name?: string }> }).ingredients;
    if (Array.isArray(ing)) {
      for (const row of ing) chunks.push(String(row?.name ?? '').toLowerCase());
    }
    for (const { name } of inferIngredientsFromDishTitle(String(p.name ?? ''))) {
      chunks.push(String(name ?? '').toLowerCase());
    }
    return chunks.filter(Boolean).join(' ');
  }

  private productMatchesAnyLike(product: Product, likes: string[]): boolean {
    if (!likes.length) return false;
    const hay = this.dishHaystackForProduct(product);
    return likes.some((k) => k && ruHaystackMatchesKeyword(hay, k));
  }

  private snapshotHaystackForPreferences(snapshot: MealSlotSnapshot): string {
    const chunks = [
      String(snapshot.name ?? '').toLowerCase(),
      ...(snapshot.ingredientsDetailed ?? []).map((r) => String(r.name ?? '').toLowerCase()),
      ...((snapshot.ingredients ?? []) as Array<{ name?: string }>).map((r) => String(r.name ?? '').toLowerCase()),
    ];
    const hasStructuredIngredients =
      (snapshot.ingredientsDetailed?.length ?? 0) > 0 || (snapshot.ingredients?.length ?? 0) > 0;
    if (!hasStructuredIngredients) {
      for (const { name } of inferIngredientsFromDishTitle(String(snapshot.name ?? ''))) {
        chunks.push(String(name ?? '').toLowerCase());
      }
    }
    return chunks.filter(Boolean).join(' ');
  }

  private snapshotMatchesAnyLike(snapshot: MealSlotSnapshot | null, likes: string[]): boolean {
    if (!snapshot || !likes.length) return false;
    const hay = this.snapshotHaystackForPreferences(snapshot);
    return likes.some((k) => k && ruHaystackMatchesKeyword(hay, k));
  }

  private dayTouchesFoodLike(day: SaveMealPlanDayDto, pref: PreferenceContext): boolean {
    if (!pref.baseLikes.length) return true;
    const snaps = [day.breakfast, day.lunch, day.dinner, day.snack, ...(day.extraSnacks ?? [])];
    return pref.baseLikes.every((base) => {
      const keys = this.expandSingleLikeKeyword(base);
      return snaps.some((snap) => snap && this.snapshotMatchesAnyLike(snap, keys));
    });
  }

  private ensureDayHasFoodLike(
    day: SaveMealPlanDayDto,
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
    pref: PreferenceContext,
  ): SaveMealPlanDayDto {
    if (!pref.baseLikes.length) return day;

    const tryReplaceSlotForBase = (
      slot: MealSlotKey,
      snap: MealSlotSnapshot | null,
      base: string,
    ): MealSlotSnapshot | null => {
      if (!snap) return null;
      const keys = this.expandSingleLikeKeyword(base);
      const target = Number(snap.calories) || 400;
      const pool = pools[slot].filter((p) => this.productMatchesAnyLike(p, keys));
      const rep = this.pickClosestByCalories(pool, target, pref);
      if (!rep) return null;
      const replaced = this.snapshotFromProduct(rep, slot);
      replaced.note = this.productReason(rep, pref);
      replaced.alternatives = this.alternativesForPool(pools[slot], rep.id, pref);
      return replaced;
    };

    let next = { ...day };
    for (let iter = 0; iter < 16; iter++) {
      const missing = pref.baseLikes.filter((base) => {
        const keys = this.expandSingleLikeKeyword(base);
        const snaps = [next.breakfast, next.lunch, next.dinner, next.snack, ...(next.extraSnacks ?? [])];
        return !snaps.some((snap) => snap && this.snapshotMatchesAnyLike(snap, keys));
      });
      if (missing.length === 0) return next;

      let progressed = false;
      outer: for (const base of missing) {
        for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as MealSlotKey[]) {
          const rep = tryReplaceSlotForBase(slot, next[slot] as MealSlotSnapshot | null, base);
          if (rep) {
            next = { ...next, [slot]: rep };
            progressed = true;
            break outer;
          }
        }
        const extras = [...(next.extraSnacks ?? [])];
        for (let i = 0; i < extras.length; i++) {
          const rep = tryReplaceSlotForBase('snack', extras[i] as MealSlotSnapshot | null, base);
          if (rep) {
            extras[i] = rep;
            next = { ...next, extraSnacks: extras };
            progressed = true;
            break outer;
          }
        }
      }
      if (!progressed) return next;
    }
    return next;
  }

  private async finalizeGeneratedPlanDays(
    days: SaveMealPlanDayDto[],
    user: User & { allergens?: Allergen[] },
    pref: PreferenceContext,
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  ): Promise<SaveMealPlanDayDto[]> {
    let out = days.map((d) => this.ensureDayHasFoodLike(d, pools, pref));
    out = await this.applyWeeklySnackAlcoholBudgetToPlanDays(out, user, pref);
    return out;
  }

  private async finalizeGeneratedPlanDaysLoadingPools(
    days: SaveMealPlanDayDto[],
    userId: string,
    user: User & { allergens?: Allergen[] },
  ): Promise<SaveMealPlanDayDto[]> {
    const pref = await this.preferenceContext(userId, user);
    const [bRaw, lRaw, dRaw, sRaw] = await Promise.all([
      this.productModel.findAll({ where: { category: 'breakfast' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'lunch' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'dinner' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'snack' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
    ]);
    const pools = this.buildFilteredPools({ breakfast: bRaw, lunch: lRaw, dinner: dRaw, snack: sRaw }, user);
    return this.finalizeGeneratedPlanDays(days, user, pref, pools);
  }

  private productPreferenceScore(product: Product, pref: PreferenceContext): number {
    const n = normalizeRuFoodText(product.name);
    const hay = this.dishHaystackForProduct(product);
    let score = 0;
    for (const k of pref.likes) {
      if (k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k))) score += 8;
    }
    for (const k of pref.fridgeNames) {
      if (k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k))) score += 1.2;
    }
    for (const k of pref.dislikes) {
      if (k && (this.dislikeKeywordMatches(hay, k) || this.dislikeKeywordMatches(n, k))) score -= 12;
    }
    return score;
  }

  private productReason(product: Product, pref: PreferenceContext): string | undefined {
    const hay = this.dishHaystackForProduct(product);
    const n = normalizeRuFoodText(product.name);
    const reasons: string[] = [];
    if (pref.likes.some((k) => k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k)))) {
      reasons.push('совпадает с вашими вкусовыми предпочтениями');
    }
    if (pref.fridgeNames.some((k) => k && (ruHaystackMatchesKeyword(hay, k) || ruHaystackMatchesKeyword(n, k)))) {
      reasons.push('учтены продукты из вашего холодильника');
    }
    return reasons.length ? reasons.join(', ') : undefined;
  }

  private alternativesForPool(pool: Product[], excludeId: string | undefined, pref: PreferenceContext): string[] {
    return pool
      .filter((p) => p.id !== excludeId)
      .sort((a, b) => this.productPreferenceScore(b, pref) - this.productPreferenceScore(a, pref))
      .slice(0, 2)
      .map((p) => p.name);
  }


  private filterProductsByDislikes(products: Product[], dislikeKeywords: string[]): Product[] {
    if (!dislikeKeywords.length) return products;
    const kw = this.expandDislikeKeywords(dislikeKeywords);
    return products.filter((p) => {
      const hay = this.dishHaystackForProduct(p);
      if (!hay.trim()) return true;
      return !kw.some((w) => w && this.dislikeKeywordMatches(hay, w));
    });
  }

  private dislikeKeywordMatches(haystack: string, keywordRaw: string): boolean {
    const hay = normalizeRuFoodText(haystack);
    const kw = String(keywordRaw ?? '').trim().toLowerCase().replace(/ё/g, 'е');
    if (!kw) return false;
    if (
      ruHaystackMatchesKeyword(hay, `без ${kw}`) ||
      /(?<![\p{L}\p{N}_])без(?![\p{L}\p{N}_])\s+сахар[\p{L}\p{N}_]*/iu.test(hay)
    ) {
      return false;
    }
    if (ruHaystackMatchesKeyword(hay, kw)) return true;
    const kwRoots = collectIngredientMatchRoots([{ name: kw }], []).filter((r) => r.length >= 4);
    if (kwRoots.length === 0) return false;
    const hayRoots = new Set(collectIngredientMatchRoots([{ name: hay }], []));
    return kwRoots.some((r) => hayRoots.has(r));
  }

  private buildFilteredPools(
    raw: {
      breakfast: Product[];
      lunch: Product[];
      dinner: Product[];
      snack: Product[];
    },
    user: User & { allergens?: Allergen[] },
  ) {
    const restrictions = user.dietaryRestrictions ?? [];
    const dislikeKeywords = this.normalizeKeywordList(user.foodDislikes);
    const apply = (list: Product[]) => {
      const safe = this.filterProductsByUserAllergens(list, user);
      const diet = filterProductsByDietary(safe, restrictions);
      const pool = restrictions.length > 0 ? diet : safe;
      return this.filterProductsByDislikes(pool, dislikeKeywords);
    };
    const stripMainAlcohol = (list: Product[]) => {
      const stripped = list.filter((p) => !productLooksLikeAlcoholicSnack(p));
      return stripped.length > 0 ? stripped : list;
    };
    return {
      breakfast: stripMainAlcohol(apply(raw.breakfast)),
      lunch: stripMainAlcohol(apply(raw.lunch)),
      dinner: stripMainAlcohol(apply(raw.dinner)),
      snack: stripMainAlcohol(apply(raw.snack)),
    };
  }

  private applyWeeklySnackAlcoholBudget(
    days: SaveMealPlanDayDto[],
    snackPool: Product[],
    pref: PreferenceContext,
  ): SaveMealPlanDayDto[] {
    const nonAlc = snackPool.filter((p) => !productLooksLikeAlcoholicSnack(p));
    const out: SaveMealPlanDayDto[] = [];
    for (let idx = 0; idx < days.length; idx++) {
      const d = days[idx];

      const fixSnackSnap = (snap: MealSlotSnapshot | null): MealSlotSnapshot | null => {
        if (!snap) return null;
        const probe = this.snapshotToProductProbe(snap);
        if (!productLooksLikeAlcoholicSnack(probe)) return snap;
        const target = Number(snap.calories) || 0;
        const source = nonAlc.length > 0 ? nonAlc : snackPool;
        const rep = this.pickClosestByCalories(source, target, pref);
        return rep ? this.snapshotFromProduct(rep, 'snack') : snap;
      };

      out.push({
        ...d,
        snack: fixSnackSnap(d.snack),
        extraSnacks: (d.extraSnacks ?? []).map((s) => fixSnackSnap(s)).filter(Boolean) as MealSlotSnapshot[],
      });
    }
    return out;
  }

  private async applyWeeklySnackAlcoholBudgetToPlanDays(
    days: SaveMealPlanDayDto[],
    user: User & { allergens?: Allergen[] },
    pref: PreferenceContext,
  ): Promise<SaveMealPlanDayDto[]> {
    const sRaw = await this.productModel.findAll({
      where: { category: 'snack' },
      order: [
        ['calories', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    const pools = this.buildFilteredPools(
      { breakfast: [], lunch: [], dinner: [], snack: sRaw },
      user,
    );
    const snackPool = pools.snack.length > 0 ? pools.snack : (sRaw as Product[]);
    return this.applyWeeklySnackAlcoholBudget(days, snackPool, pref);
  }

  snapshotFromProduct(p: Product, category: MealSlotKey): MealSlotSnapshot {
    const raw = (p as Product & { ingredients?: Array<{ name?: string; grams?: number }> }).ingredients;
    const rawDetailed = (p as Product & {
      ingredientsDetailed?: Array<{
        id?: string;
        name?: string;
        amount?: number;
        unit?: string;
        grams?: number;
        originalString?: string;
        ingredientId?: string;
      }>;
    }).ingredientsDetailed;
    let ingredients: Array<{ name: string; grams: number }>;
    if (Array.isArray(raw) && raw.length > 0) {
      ingredients = raw.map((row) => ({
        name: String(row.name ?? ''),
        grams: Number(row.grams) || 0,
      }));
    } else {
      ingredients = inferIngredientsFromDishTitle(p.name);
    }
    const ingredientsDetailed = Array.isArray(rawDetailed)
      ? rawDetailed
          .map((row) => ({
            id: String(row?.id ?? ''),
            name: String(row?.name ?? ''),
            amount: Number(row?.amount) || 0,
            unit: String(row?.unit ?? ''),
            grams: Number(row?.grams) || 0,
            originalString: row?.originalString ? String(row.originalString) : undefined,
            ingredientId: row?.ingredientId ? String(row.ingredientId) : undefined,
          }))
          .filter((row) => row.id && row.name)
      : [];
    const matchKeywords = collectIngredientMatchRoots(ingredients, p.matchKeywords ?? []);
    return {
      dishId: p.id,
      name: p.name,
      calories: p.calories,
      protein: p.protein,
      fat: p.fat,
      carbs: p.carbs,
      allergens: p.allergens ?? [],
      dietaryTags: p.dietaryTags ?? [],
      category,
      ingredients,
      ingredientsDetailed: ingredientsDetailed.length ? ingredientsDetailed : undefined,
      matchKeywords,
      imageUrl: p.imageUrl ?? undefined,
    };
  }

  private snapshotToProductProbe(snapshot: MealSlotSnapshot): Product {
    return {
      id: `probe-${snapshot.category}-${snapshot.name}`,
      name: snapshot.name,
      category: snapshot.category,
      calories: snapshot.calories,
      protein: snapshot.protein,
      fat: snapshot.fat,
      carbs: snapshot.carbs,
      allergens: snapshot.allergens ?? [],
      dietaryTags: snapshot.dietaryTags ?? [],
      ingredients: snapshot.ingredients ?? [],
      matchKeywords: [],
      imageUrl: null,
      description: null,
      servings: 1,
      cookingTimeMin: null,
      cuisine: null,
      mealTypes: [],
      isFromApi: false,
      sourceUrl: null,
      sourceMealId: null,
      ingredientsDetailed: snapshot.ingredientsDetailed ?? [],
    } as unknown as Product;
  }

  private snapshotViolatesDietary(snapshot: MealSlotSnapshot | null, restrictions: string[]): boolean {
    if (!snapshot || restrictions.length === 0) return false;
    const probe = this.snapshotToProductProbe(snapshot);
    return getDietWarningsForProduct(probe, restrictions).length > 0;
  }

  private snapshotViolatesAllergens(
    snapshot: MealSlotSnapshot | null,
    userAllergenNames: Set<string>,
  ): boolean {
    if (!snapshot || userAllergenNames.size === 0) return false;
    const probe = this.snapshotToProductProbe(snapshot);
    return productHasUserAllergen(probe, userAllergenNames);
  }

  private snapshotViolatesDislikes(snapshot: MealSlotSnapshot | null, dislikeKeywords: string[]): boolean {
    if (!snapshot || dislikeKeywords.length === 0) return false;
    const kw = this.expandDislikeKeywords(dislikeKeywords);
    const hay = this.snapshotHaystackForPreferences(snapshot);
    if (!hay.trim()) return false;
    return kw.some((w) => w && this.dislikeKeywordMatches(hay, w));
  }

  private pickClosestByCalories(
    pool: Product[],
    targetCalories: number,
    pref?: PreferenceContext,
  ): Product | null {
    if (!pool.length) return null;
    return (
      [...pool].sort((a, b) => {
        const d = Math.abs(Number(a.calories) - targetCalories) - Math.abs(Number(b.calories) - targetCalories);
        if (d !== 0) return d;
        if (pref) {
          const prefDiff = this.productPreferenceScore(b, pref) - this.productPreferenceScore(a, pref);
          if (prefDiff !== 0) return prefDiff;
        }
        return String(a.name).localeCompare(String(b.name), 'ru');
      })[0] ?? null
    );
  }

  private async enforceDietaryForAiDays(
    userId: string,
    user: User & { allergens?: Allergen[] },
    days: SaveMealPlanDayDto[],
  ): Promise<{ days: SaveMealPlanDayDto[]; warnings: string[] }> {
    const restrictions = user.dietaryRestrictions ?? [];
    const dislikeKeywords = this.normalizeKeywordList(user.foodDislikes);
    const allergyNames = this.allergySet(user);
    const pref = await this.preferenceContext(userId, user);
    if (restrictions.length === 0 && dislikeKeywords.length === 0 && allergyNames.size === 0) {
      return { days: await this.finalizeGeneratedPlanDaysLoadingPools(days, userId, user), warnings: [] };
    }
    const [bRaw, lRaw, dRaw, sRaw] = await Promise.all([
      this.productModel.findAll({ where: { category: 'breakfast' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'lunch' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'dinner' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'snack' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
    ]);
    const pools = this.buildFilteredPools(
      { breakfast: bRaw, lunch: lRaw, dinner: dRaw, snack: sRaw },
      user,
    );
    const allRaw = [...bRaw, ...lRaw, ...dRaw, ...sRaw];
    const allSafe = this.filterProductsByUserAllergens(allRaw, user);
    const allDiet = filterProductsByDietary(allSafe, restrictions);
    const fallbackAny = this.filterProductsByDislikes(allDiet, dislikeKeywords);
    const warnings: string[] = [];
    let replacedCount = 0;
    let unresolvedCount = 0;
    let allergyReplaced = 0;
    let dislikesReplaced = 0;
    let dietaryReplaced = 0;
    const out = days.map((d) => {
      const fixSlot = (slot: MealSlotKey, snap: MealSlotSnapshot | null): MealSlotSnapshot | null => {
        const violatesDiet = this.snapshotViolatesDietary(snap, restrictions);
        const violatesAllergy = this.snapshotViolatesAllergens(snap, allergyNames);
        const violatesDislike = this.snapshotViolatesDislikes(snap, dislikeKeywords);
        if (!violatesDiet && !violatesAllergy && !violatesDislike) return snap;
        const target = Number(snap?.calories) || 0;
        const bySlot = pools[slot] ?? [];
        const source = bySlot.length > 0 ? bySlot : fallbackAny;
        const replacement = this.pickClosestByCalories(source, target, pref);
        if (!replacement) {
          unresolvedCount += 1;
          return snap;
        }
        replacedCount += 1;
        if (violatesAllergy) allergyReplaced += 1;
        if (violatesDislike) dislikesReplaced += 1;
        if (violatesDiet) dietaryReplaced += 1;
        return this.snapshotFromProduct(replacement, slot);
      };
      const extraSnacks = (d.extraSnacks ?? []).map((snap) => fixSlot('snack', snap)).filter(Boolean) as MealSlotSnapshot[];
      return {
        ...d,
        breakfast: fixSlot('breakfast', d.breakfast),
        lunch: fixSlot('lunch', d.lunch),
        dinner: fixSlot('dinner', d.dinner),
        snack: fixSlot('snack', d.snack),
        extraSnacks,
      };
    });
    // if (replacedCount > 0) {
    //   warnings.push(
    //     `AI предложил ${replacedCount} блюд(а), нарушающих ограничения пользователя; они автоматически заменены из каталога.`,
    //   );
    // }
    // if (allergyReplaced > 0) {
    //   warnings.push(`Заменено из-за аллергенов: ${allergyReplaced}.`);
    // }
    // if (dietaryReplaced > 0) {
    //   warnings.push(`Заменено из-за несоответствия диете: ${dietaryReplaced}.`);
    // }
    // if (dislikesReplaced > 0) {
    //   warnings.push(`Заменено из-за нежелательных продуктов: ${dislikesReplaced}.`);
    // }
    // if (unresolvedCount > 0) {
    //   warnings.push(
    //     `Для ${unresolvedCount} позиции(й) не найдена подходящая замена по диете в каталоге. Пополните каталог блюдами нужной категории.`,
    //   );
    // }
    const adjusted = await this.finalizeGeneratedPlanDays(out, user, pref, pools);
    return { days: adjusted, warnings };
  }

  private daySnapshotsTotal(day: SaveMealPlanDayDto) {
    const list: MealSlotSnapshot[] = [];
    for (const k of SLOT_ORDER) {
      const s = day[k];
      if (s && typeof s === 'object' && 'name' in s) list.push(s as MealSlotSnapshot);
    }
    for (const ex of day.extraSnacks ?? []) {
      if (ex && typeof ex === 'object' && 'name' in ex) list.push(ex);
    }
    let calories = 0;
    let protein = 0;
    let fat = 0;
    let carbs = 0;
    for (const s of list) {
      calories += Number(s.calories) || 0;
      protein += Number(s.protein) || 0;
      fat += Number(s.fat) || 0;
      carbs += Number(s.carbs) || 0;
    }
    return { calories, protein, fat, carbs };
  }

  private scaleDaySnapshotsToTarget(
    day: SaveMealPlanDayDto,
    target: number,
    tolerance = CALORIE_TARGET_TOLERANCE,
  ): SaveMealPlanDayDto {
    const tot = this.daySnapshotsTotal(day);
    if (tot.calories <= 0 || !Number.isFinite(target) || target <= 0) return day;
    const low = target * (1 - Math.max(0, tolerance));
    const high = target * (1 + Math.max(0, tolerance));
    if (tot.calories >= low && tot.calories <= high) return day;
    const factor = target / tot.calories;
    const scaleSnap = (s: MealSlotSnapshot | null): MealSlotSnapshot | null => {
      if (!s || typeof s !== 'object' || !('calories' in s)) return s;
      const snap = s as MealSlotSnapshot;
      const c = Number(snap.calories) || 0;
      if (c <= 0) return { ...snap, calories: 0 };
      return {
        ...snap,
        calories: Math.max(0, Math.round(c * factor)),
        protein: Math.round((Number(snap.protein) || 0) * factor * 10) / 10,
        fat: Math.round((Number(snap.fat) || 0) * factor * 10) / 10,
        carbs: Math.round((Number(snap.carbs) || 0) * factor * 10) / 10,
      };
    };
    let next: SaveMealPlanDayDto = {
      ...day,
      breakfast: scaleSnap(day.breakfast),
      lunch: scaleSnap(day.lunch),
      dinner: scaleSnap(day.dinner),
      snack: scaleSnap(day.snack),
      extraSnacks: (day.extraSnacks ?? []).map(scaleSnap).filter(Boolean) as MealSlotSnapshot[],
    };
    const drift = Math.round(target - this.daySnapshotsTotal(next).calories);
    if (drift === 0) return next;
    const order: MealSlotKey[] = ['dinner', 'lunch', 'breakfast', 'snack'];
    for (const k of order) {
      const slot = next[k];
      if (!slot || typeof slot !== 'object') continue;
      const cal = Number((slot as MealSlotSnapshot).calories) || 0;
      if (cal + drift < 1) continue;
      next = {
        ...next,
        [k]: { ...(slot as MealSlotSnapshot), calories: cal + drift },
      };
      break;
    }
    return next;
  }

  private computePlanTotals(days: SaveMealPlanDayDto[]) {
    let calories = 0;
    let protein = 0;
    let fat = 0;
    let carbs = 0;
    for (const d of days) {
      const t = this.daySnapshotsTotal(d);
      calories += t.calories;
      protein += t.protein;
      fat += t.fat;
      carbs += t.carbs;
    }
    return { calories, protein, fat, carbs };
  }

  private diversifyCatalogDays(
    days: SaveMealPlanDayDto[],
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  ): SaveMealPlanDayDto[] {
    const seenPerSlot = new Map<string, number>();
    const out: SaveMealPlanDayDto[] = [];
    const pickAlt = (slot: MealSlotKey, current: MealSlotSnapshot | null, prevName?: string): MealSlotSnapshot | null => {
      if (!current?.name) return current;
      const key = `${slot}:${current.name.toLowerCase()}`;
      const seen = seenPerSlot.get(key) ?? 0;
      if (seen < 2 && (!prevName || prevName.toLowerCase() !== current.name.toLowerCase())) {
        seenPerSlot.set(key, seen + 1);
        return current;
      }
      const pool = pools[slot] ?? [];
      const alt = pool.find((p) => {
        const name = String(p.name ?? '').toLowerCase();
        if (!name || name === current.name.toLowerCase()) return false;
        if (prevName && prevName.toLowerCase() === name) return false;
        return (seenPerSlot.get(`${slot}:${name}`) ?? 0) < 2;
      });
      if (!alt) {
        seenPerSlot.set(key, seen + 1);
        return current;
      }
      const snap = this.snapshotFromProduct(alt, slot);
      seenPerSlot.set(`${slot}:${alt.name.toLowerCase()}`, (seenPerSlot.get(`${slot}:${alt.name.toLowerCase()}`) ?? 0) + 1);
      return snap;
    };

    for (let i = 0; i < days.length; i++) {
      const prev = out[i - 1];
      const d = days[i];
      const next: SaveMealPlanDayDto = {
        ...d,
        breakfast: pickAlt('breakfast', d.breakfast, prev?.breakfast?.name),
        lunch: pickAlt('lunch', d.lunch, prev?.lunch?.name),
        dinner: pickAlt('dinner', d.dinner, prev?.dinner?.name),
        snack: pickAlt('snack', d.snack, prev?.snack?.name),
        extraSnacks: (d.extraSnacks ?? []).map((s, exIdx) =>
          pickAlt('snack', s, exIdx === 0 ? prev?.extraSnacks?.[0]?.name : undefined),
        ) as MealSlotSnapshot[],
      };
      out.push(next);
    }
    return out;
  }

  private pickFromPool(
    pool: Product[],
    budget: number,
    dayIndex: number,
    slotSalt: number,
    usedIds: Set<string>,
    pref: PreferenceContext,
  ): Product | null {
    if (pool.length === 0) return null;
    const available = pool.filter((p) => !usedIds.has(p.id));
    const source = available.length ? available : pool;
    const near = source
      .map((p) => ({
        p,
        diff: Math.abs(Number(p.calories) - budget),
        pref: this.productPreferenceScore(p, pref),
      }))
      .sort((a, b) => a.diff - b.diff || b.pref - a.pref);
    const candidates = near.length ? near : source.map((p) => ({ p, diff: 0 }));
    const top = candidates.slice(0, Math.min(48, candidates.length));
    const idx = Math.abs((dayIndex * 31 + slotSalt * 17) % top.length);
    const chosen = top[idx]?.p ?? pool[dayIndex % pool.length];
    usedIds.add(chosen.id);
    return chosen;
  }

  private sortPoolByCalories(pool: Product[]) {
    return [...pool].sort(
      (a, b) => Number(a.calories) - Number(b.calories) || String(a.id).localeCompare(String(b.id)),
    );
  }

  private stridedPoolSample(pool: Product[], maxItems: number): Product[] {
    if (pool.length <= maxItems) return pool;
    const out: Product[] = [];
    const last = pool.length - 1;
    const step = last / Math.max(1, maxItems - 1);
    for (let k = 0; k < maxItems; k++) {
      out.push(pool[Math.min(last, Math.round(k * step))]);
    }
    return out;
  }

  private refineProductsToTarget(
    slots: Product[],
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
    target: number,
    tolerance: number,
  ): { products: Product[]; matched: boolean } {
    const slotCats: Array<'breakfast' | 'lunch' | 'dinner' | 'snack'> = [
      'breakfast',
      'lunch',
      'dinner',
      'snack',
      'snack',
    ];
    const current = [...slots];
    const sumCal = (arr: Product[]) => arr.reduce((a, p) => a + Number(p.calories), 0);
    const relErr = () => Math.abs(sumCal(current) - target) / Math.max(1, target);
    if (relErr() <= tolerance) return { products: current, matched: true };
    const maxCandPerSlot = 360;
    for (let iter = 0; iter < 260; iter++) {
      if (relErr() <= tolerance) return { products: current, matched: true };
      let bestScore = Infinity;
      let bestI = -1;
      let bestP: Product | null = null;
      for (let i = 0; i < 5; i++) {
        const cat = slotCats[i];
        const pool = pools[cat];
        if (!pool.length) continue;
        const sorted = this.sortPoolByCalories(pool);
        const capped = this.stridedPoolSample(sorted, maxCandPerSlot);
        for (const cand of capped) {
          const next = [...current];
          next[i] = cand;
          const err = Math.abs(sumCal(next) - target);
          if (err < bestScore) {
            bestScore = err;
            bestI = i;
            bestP = cand;
          }
        }
      }
      if (bestI >= 0 && bestP) {
        if (current[bestI] && current[bestI]!.id === bestP.id) {
          break;
        }
        current[bestI] = bestP;
      } else {
        break;
      }
    }
    return { products: current, matched: relErr() <= tolerance };
  }

  private dishSearchSqlCondition(term: string) {
    const alias = this.productModel.name;
    const qc = (attr: keyof typeof this.productModel.rawAttributes) => {
      const def = this.productModel.rawAttributes[attr];
      const col = def?.field ? String(def.field) : String(attr);
      return `"${alias}"."${col}"`;
    };
    const pattern = `%${term.trim()}%`;
    const sql = this.productModel.sequelize!;
    const p = sql.escape(pattern);
    return Sequelize.literal(`(
      ${qc('name')} ILIKE ${p}
      OR COALESCE(${qc('description')}, '') ILIKE ${p}
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(${qc('ingredients')}, '[]'::jsonb)) AS _ie
        WHERE (_ie->>'name') ILIKE ${p}
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements(COALESCE(${qc('ingredientsDetailed')}, '[]'::jsonb)) AS _id
        WHERE (_id->>'name') ILIKE ${p}
          OR COALESCE(_id->>'originalString', '') ILIKE ${p}
      )
      OR EXISTS (
        SELECT 1 FROM jsonb_array_elements_text(COALESCE(${qc('matchKeywords')}, '[]'::jsonb)) AS _mk
        WHERE _mk ILIKE ${p}
      )
    )`);
  }

  async listDishes(params: {
    category?: MealSlotKey;
    search?: string;
    excludeAllergens?: string;
    userId?: string;
  }) {
    const { category, search, excludeAllergens, userId } = params;
    const categoryWhere = { category: { [Op.in]: ['breakfast', 'lunch', 'dinner', 'snack'] } };
    const term = search?.trim();
    const where =
      term && term.length > 0
        ? { [Op.and]: [categoryWhere, this.dishSearchSqlCondition(term)] }
        : categoryWhere;
    const rows = await this.productModel.findAll({
      where,
      order: [['name', 'ASC']],
      limit: 4000,
    });
    const scoped = category
      ? rows.filter((p) =>
          dishStoredOrInferredMatchesSlot(
            String(p.category ?? ''),
            String(p.name ?? ''),
            category as MealSlotKeyInfer,
          ),
        )
      : rows;

    const withMatchKeywords = (plain: Record<string, unknown>) => {
      const ingRaw = plain.ingredients as Array<{ name?: string; grams?: number }> | undefined;
      const ingredients =
        Array.isArray(ingRaw) && ingRaw.length > 0
          ? ingRaw.map((row) => ({
              name: String(row?.name ?? ''),
              grams: Number(row?.grams) || 0,
            }))
          : inferIngredientsFromDishTitle(String(plain.name ?? ''));
      const mk = collectIngredientMatchRoots(ingredients, plain.matchKeywords);
      return { ...plain, matchKeywords: mk };
    };

    if (userId) {
      const user = await this.loadPlanningUser(userId);
      if (!user)
        return scoped.map((p) => withMatchKeywords(p.get({ plain: true }) as unknown as Record<string, unknown>));
      const names = this.allergySet(user);
      const restrictions = user.dietaryRestrictions ?? [];
      return scoped.map((p) => ({
        ...withMatchKeywords(p.get({ plain: true }) as unknown as Record<string, unknown>),
        blockedByAllergen: productHasUserAllergen(p, names),
        dietWarnings: getDietWarningsForProduct(p, restrictions),
      }));
    }

    const banned = new Set(
      (excludeAllergens ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean),
    );
    if (banned.size === 0)
      return scoped.map((p) => withMatchKeywords(p.get({ plain: true }) as unknown as Record<string, unknown>));
    return scoped
      .filter((p) => !(p.allergens ?? []).some((a) => banned.has(String(a).toLowerCase())))
      .map((p) => withMatchKeywords(p.get({ plain: true }) as unknown as Record<string, unknown>));
  }

  async generatePlan(
    userId: string,
    durationDays: number,
    opts?: {
      targetCalories?: number;
      calorieMode?: 'precise' | 'approximate';
      calorieBand?: keyof typeof CALORIE_BANDS;
    },
  ) {
    const user = await this.loadPlanningUser(userId);
    if (!user) throw new NotFoundException('User not found');
    const pref = await this.preferenceContext(userId, user);
    const safeGoal = normalizeGoalByWeight(user.goal, user.weight, user.height);

    const caloriesByGoal: Record<string, number> = {
      lose: 1800,
      maintain: 2200,
      gain: 2600,
    };
    const defaultCal = caloriesByGoal[safeGoal] ?? 2200;

    const mode: 'precise' | 'approximate' =
      opts?.calorieMode ??
      (user.calorieMode === 'precise' || user.calorieMode === 'approximate' ? user.calorieMode : 'approximate');
    const bandKey = opts?.calorieBand ?? user.calorieBand ?? 'medium';
    const band = bandKey in CALORIE_BANDS ? (bandKey as keyof typeof CALORIE_BANDS) : 'medium';

    const orderByCal: [string, string][] = [
      ['calories', 'ASC'],
      ['id', 'ASC'],
    ];
    const [bRaw, lRaw, dRaw, sRaw] = await Promise.all([
      this.productModel.findAll({ where: { category: 'breakfast' }, order: orderByCal }),
      this.productModel.findAll({ where: { category: 'lunch' }, order: orderByCal }),
      this.productModel.findAll({ where: { category: 'dinner' }, order: orderByCal }),
      this.productModel.findAll({ where: { category: 'snack' }, order: orderByCal }),
    ]);
    const pools = this.buildFilteredPools(
      { breakfast: bRaw, lunch: lRaw, dinner: dRaw, snack: sRaw },
      user,
    );
    const { breakfast: bPool, lunch: lPool, dinner: dPool, snack: sPool } = pools;
    const dislikeKeywords = this.normalizeKeywordList(user.foodDislikes);
    const allRaw = [...bRaw, ...lRaw, ...dRaw, ...sRaw];
    const allSafe = this.filterProductsByUserAllergens(allRaw, user);
    const allDiet = filterProductsByDietary(allSafe, user.dietaryRestrictions ?? []);
    const allFiltered = this.filterProductsByDislikes(
      (user.dietaryRestrictions ?? []).length > 0 ? allDiet : allSafe,
      dislikeKeywords,
    );
    const fallbackAnyPool = Array.from(new Map(allFiltered.map((p) => [p.id, p])).values());
    const stripAlc = (list: Product[]) => list.filter((p) => !productLooksLikeAlcoholicSnack(p));
    const fallbackMainNonAlc = stripAlc(allFiltered);
    const fallbackMainPool = fallbackMainNonAlc.length > 0 ? fallbackMainNonAlc : allFiltered;
    const fallbackSnackNonAlc = stripAlc(fallbackAnyPool);
    const fallbackSnackPool = fallbackSnackNonAlc.length > 0 ? fallbackSnackNonAlc : fallbackAnyPool;

    const dist = DEFAULT_DIST;
    const snackShare1 = dist.snacks * 0.55;
    const snackShare2 = dist.snacks * 0.45;

    const preciseTol = CALORIE_TARGET_TOLERANCE;
    const approxTol = CALORIE_TARGET_TOLERANCE;
    const targetForDay = (index: number): number => {
      const baseTc = opts?.targetCalories ?? user.targetCalories ?? defaultCal;
      return mode === 'precise' ? baseTc : dayCaloriesFromBand(band as 'low' | 'medium' | 'high' | 'sport', index);
    };

    const warnings: string[] = [];
    let unmatchedDays = 0;
    let anyPlaceholderMeal = false;

    const days: SaveMealPlanDayDto[] = Array.from({ length: durationDays }).map((_, index) => {
      const tc = targetForDay(index);

      const used = new Set<string>();
      const tol = mode === 'precise' ? preciseTol : approxTol;

      const pickWithFallback = (
        slotPool: Product[],
        budget: number,
        slotSalt: number,
        slot: MealSlotKey,
      ): Product | null => {
        const primary = this.pickFromPool(slotPool, budget, index, slotSalt, used, pref);
        if (primary) return primary;
        const fb = slot === 'snack' ? fallbackSnackPool : fallbackMainPool;
        return this.pickFromPool(fb, budget, index, slotSalt + 50, used, pref);
      };

      let b = pickWithFallback(bPool, tc * dist.breakfast, 1, 'breakfast');
      let l = pickWithFallback(lPool, tc * dist.lunch, 2, 'lunch');
      let d = pickWithFallback(dPool, tc * dist.dinner, 3, 'dinner');
      let s1 = pickWithFallback(sPool, tc * snackShare1, 4, 'snack');
      let s2 = pickWithFallback(sPool, tc * snackShare2, 5, 'snack');

      const slotProducts = [b, l, d, s1, s2].filter(Boolean) as Product[];
      if (slotProducts.length === 5) {
        const refined = this.refineProductsToTarget(slotProducts, pools, tc, tol);
        if (!refined.matched) unmatchedDays += 1;
        [b, l, d, s1, s2] = refined.products;
      }

      const fallback = (cat: MealSlotKey): MealSlotSnapshot => ({
        name: `Блюдо (${cat})`,
        calories: 300,
        protein: 20,
        fat: 10,
        carbs: 30,
        allergens: [],
        category: cat,
      });

      const breakfast = b
        ? this.snapshotFromProduct(b, 'breakfast')
        : fallback('breakfast');
      const lunch = l ? this.snapshotFromProduct(l, 'lunch') : fallback('lunch');
      const dinner = d ? this.snapshotFromProduct(d, 'dinner') : fallback('dinner');
      const snack = s1 ? this.snapshotFromProduct(s1, 'snack') : fallback('snack');
      const bAltPool = bPool.length > 0 ? bPool : fallbackAnyPool;
      const lAltPool = lPool.length > 0 ? lPool : fallbackAnyPool;
      const dAltPool = dPool.length > 0 ? dPool : fallbackAnyPool;
      const sAltPool = sPool.length > 0 ? sPool : fallbackAnyPool;

      if (b) {
        breakfast.note = this.productReason(b, pref);
        breakfast.alternatives = this.alternativesForPool(bAltPool, b.id, pref);
      }
      if (l) {
        lunch.note = this.productReason(l, pref);
        lunch.alternatives = this.alternativesForPool(lAltPool, l.id, pref);
      }
      if (d) {
        dinner.note = this.productReason(d, pref);
        dinner.alternatives = this.alternativesForPool(dAltPool, d.id, pref);
      }
      if (s1) {
        snack.note = this.productReason(s1, pref);
        snack.alternatives = this.alternativesForPool(sAltPool, s1.id, pref);
      }
      const extraSnacks: MealSlotSnapshot[] = [];
      if (s2 && (!s1 || s2.id !== s1.id)) {
        const ex = this.snapshotFromProduct(s2, 'snack');
        ex.note = this.productReason(s2, pref);
        ex.alternatives = this.alternativesForPool(sAltPool, s2.id, pref);
        extraSnacks.push(ex);
      }

      if (!b || !l || !d || !s1) anyPlaceholderMeal = true;

      return {
        dayNumber: index + 1,
        breakfast,
        lunch,
        dinner,
        snack,
        extraSnacks: extraSnacks.length ? extraSnacks : [],
      };
    });

    if (anyPlaceholderMeal) {
      warnings.push(
        'Для части приёмов пищи нет блюд в каталоге (ужин/перекус или другой слот пусты после фильтров): подставлены заглушки по 300 ккал, сумма дня не доводится к цели и шаг уточнения ±5% не применяется. Пополните категории в `products` или ослабьте аллергии/диету; после перезапуска сидер доукомплектует каталог, если в БД мало блюд по категориям.',
      );
    }

    if (unmatchedDays > 0) {
      const label =
        mode === 'precise'
          ? `в пределах ±${Math.round(CALORIE_TARGET_TOLERANCE * 100)}% от дневной цели`
          : 'в выбранном диапазоне калорийности';
      warnings.push(
        `Для ${unmatchedDays} из ${durationDays} дней не удалось подобрать сочетание блюд ${label}; показано ближайшее по калориям.`,
      );
    }

    const displayTarget =
      mode === 'precise'
        ? (opts?.targetCalories ?? user.targetCalories ?? defaultCal)
        : Math.round((CALORIE_BANDS[band][0] + CALORIE_BANDS[band][1]) / 2);

    const daysScaled = days.map((d, idx) =>
      this.scaleDaySnapshotsToTarget(d, targetForDay(idx), CALORIE_TARGET_TOLERANCE),
    );
    const daysFinal = await this.finalizeGeneratedPlanDays(daysScaled, user, pref, pools);
    if (pref.baseLikes.length > 0 && daysFinal.some((d) => !this.dayTouchesFoodLike(d, pref))) {
      warnings.push(
        'Для части дней в каталоге не удалось подобрать блюда под каждое из любимых ключевых слов в профиле — уточните формулировки или пополните каталог.',
      );
    }

    const saved = await this.saveUserPlan(userId, {
      durationDays,
      targetCalories: displayTarget,
      days: daysFinal,
      name: `Авто ${this.formatRuPlanDateTime(new Date())}`,
    });
    const plain = saved?.get ? saved.get({ plain: true }) : saved;
    return { ...(plain as object), warnings };
  }

  private async assertNoAlcoholicSnapshotsIfMinor(user: User, days: SaveMealPlanDayDto[]) {
    const age = computeFullYearsFromBirthDate(user.birthDate);
    if (age === null || age >= 18) return;

    const ids = new Set<string>();
    for (const d of days) {
      for (const s of [d.breakfast, d.lunch, d.dinner, d.snack, ...(d.extraSnacks ?? [])]) {
        if (s && typeof s === 'object' && 'dishId' in s && s.dishId) ids.add(String(s.dishId));
      }
    }
    const products =
      ids.size > 0 ? await this.productModel.findAll({ where: { id: { [Op.in]: [...ids] } } }) : [];
    const byId = new Map(products.map((p) => [p.id, p]));

    const snapshotIsAlcoholic = (s: MealSlotSnapshot): boolean => {
      if (s.dishId) {
        const p = byId.get(String(s.dishId));
        if (p && productLooksLikeAlcoholicSnack(p)) return true;
      }
      return productLooksLikeAlcoholicSnack(this.snapshotToProductProbe(s));
    };

    for (const d of days) {
      const snaps = [d.breakfast, d.lunch, d.dinner, d.snack, ...(d.extraSnacks ?? [])].filter(
        (x): x is MealSlotSnapshot => Boolean(x),
      );
      for (const s of snaps) {
        if (snapshotIsAlcoholic(s)) {
          throw new ForbiddenException(
            'Для пользователей младше 18 лет нельзя сохранять в плане алкогольные напитки и коктейли.',
          );
        }
      }
    }
  }

  async saveUserPlan(
    userId: string,
    dto: {
      durationDays: number;
      targetCalories: number;
      days: SaveMealPlanDayDto[];
      name?: string;
    },
  ) {
    const user = await this.userModel.findByPk(this.uid(userId));
    if (!user) throw new NotFoundException('User not found');

    await this.assertNoAlcoholicSnapshotsIfMinor(user, dto.days);

    await this.archiveActivePlans(userId);
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + dto.durationDays - 1);

    const totals = this.computePlanTotals(dto.days);
    const defaultName = `План на ${this.formatRuPlanDateTime(startDate)}`;

    const plan = await this.mealPlanModel.create({
      userId: this.uid(userId),
      startDate,
      endDate,
      durationDays: dto.durationDays,
      targetCalories: dto.targetCalories,
      status: 'active',
      name: dto.name ?? defaultName,
      totalCalories: totals.calories,
      totalProtein: totals.protein,
      totalFat: totals.fat,
      totalCarbs: totals.carbs,
    } as never);

    const rows = dto.days.map((d) => {
      const date = new Date(startDate);
      date.setDate(date.getDate() + d.dayNumber - 1);
      const extra = d.extraSnacks ?? [];
      return {
        mealPlanId: plan.id,
        dayNumber: d.dayNumber,
        date,
        breakfast: d.breakfast,
        lunch: d.lunch,
        dinner: d.dinner,
        snacks: d.snack ? [d.snack] : [],
        extraSnacks: extra.length ? extra : [],
        mealStatuses: {},
      };
    });

    await this.mealPlanDayModel.bulkCreate(rows as never);
    return this.getActivePlan(userId);
  }

  getActivePlan(userId: string) {
    return this.mealPlanModel.findOne({
      where: { userId: this.uid(userId), status: 'active' },
      include: [MealPlanDay],
      order: [['days', 'dayNumber', 'ASC']],
    });
  }

  async listUserPlans(userId: string) {
    return this.mealPlanModel.findAll({
      where: {
        userId: this.uid(userId),
        status: { [Op.in]: ['active', 'completed'] },
      },
      order: [['updatedAt', 'DESC']],
      attributes: [
        'id',
        'name',
        'startDate',
        'endDate',
        'durationDays',
        'targetCalories',
        'status',
        'totalCalories',
        'totalProtein',
        'totalFat',
        'totalCarbs',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async getPlanById(userId: string, planId: string) {
    const plan = await this.mealPlanModel.findOne({
      where: { id: planId, userId: this.uid(userId) },
      include: [MealPlanDay],
      order: [['days', 'dayNumber', 'ASC']],
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async deletePlan(userId: string, planId: string) {
    const plan = await this.mealPlanModel.findOne({
      where: { id: planId, userId: this.uid(userId) },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    await this.mealPlanDayModel.destroy({ where: { mealPlanId: planId } });
    await plan.destroy();
    return { ok: true };
  }

  async clonePlan(userId: string, planId: string, startDateIso?: string) {
    const user = await this.userModel.findByPk(this.uid(userId));
    if (!user) throw new NotFoundException('User not found');

    const src = await this.getPlanById(userId, planId);
    const days = (src.days ?? []).map((row) => {
      const extra = row.extraSnacks;
      const extraArr = Array.isArray(extra) ? extra : [];
      return {
        dayNumber: row.dayNumber,
        breakfast: (row.breakfast as MealSlotSnapshot) ?? null,
        lunch: (row.lunch as MealSlotSnapshot) ?? null,
        dinner: (row.dinner as MealSlotSnapshot) ?? null,
        snack: primarySnackFromDb(row.snacks),
        extraSnacks: extraArr.length ? extraArr : [],
      };
    });

    await this.assertNoAlcoholicSnapshotsIfMinor(user, days);

    const start = startDateIso ? new Date(startDateIso) : new Date();
    const name = this.clonePlanDisplayName(src.name, start);
    const endDate = new Date(start);
    endDate.setDate(endDate.getDate() + src.durationDays - 1);
    const totals = this.computePlanTotals(days);
    const plan = await this.mealPlanModel.create({
      userId: this.uid(userId),
      startDate: start,
      endDate,
      durationDays: src.durationDays,
      targetCalories: src.targetCalories,
      status: 'completed',
      name,
      totalCalories: totals.calories,
      totalProtein: totals.protein,
      totalFat: totals.fat,
      totalCarbs: totals.carbs,
    } as never);

    const rows = days.map((d) => {
      const date = new Date(start);
      date.setDate(date.getDate() + d.dayNumber - 1);
      return {
        mealPlanId: plan.id,
        dayNumber: d.dayNumber,
        date,
        breakfast: d.breakfast,
        lunch: d.lunch,
        dinner: d.dinner,
        snacks: d.snack ? [d.snack] : [],
        extraSnacks: d.extraSnacks?.length ? d.extraSnacks : [],
        mealStatuses: {},
      };
    });
    await this.mealPlanDayModel.bulkCreate(rows as never);
    return this.getPlanById(userId, plan.id);
  }

  async activatePlan(userId: string, planId: string) {
    const plan = await this.mealPlanModel.findOne({
      where: { id: planId, userId: this.uid(userId) },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    if (plan.status === 'active') {
      return this.getPlanById(userId, planId);
    }
    await this.archiveActivePlans(userId);
    await plan.update({ status: 'active' } as never);
    return this.getPlanById(userId, planId);
  }

  async planDownloadPayload(userId: string, planId: string) {
    const plan = await this.getPlanById(userId, planId);
    const days = (plan.days ?? []).map((row) => ({
      dayNumber: row.dayNumber,
      date: row.date,
      breakfast: row.breakfast,
      lunch: row.lunch,
      dinner: row.dinner,
      snacks: row.snacks ?? [],
      snack: primarySnackFromDb(row.snacks),
      extraSnacks: row.extraSnacks ?? [],
    }));
    return {
      id: plan.id,
      name: plan.name,
      durationDays: plan.durationDays,
      targetCalories: plan.targetCalories,
      totals: {
        calories: plan.totalCalories,
        protein: plan.totalProtein,
        fat: plan.totalFat,
        carbs: plan.totalCarbs,
      },
      days,
    };
  }

  async changeDuration(userId: string, durationDays: number) {
    const user = await this.loadPlanningUser(userId);
    return this.generatePlan(userId, durationDays, {
      targetCalories: user?.targetCalories ?? undefined,
      calorieMode: user?.calorieMode ?? ('approximate' as const),
      calorieBand: user?.calorieBand ?? ('medium' as const),
    });
  }

  async updateDayMealStatuses(
    userId: string,
    dayId: string,
    body: Partial<Record<MealTrackSlot, MealTrackStatus | null>>,
  ) {
    const day = await this.mealPlanDayModel.findOne({
      where: { id: dayId },
      include: [{ model: MealPlan, as: 'mealPlan', where: { userId: this.uid(userId) }, required: true }],
    });
    if (!day) {
      throw new NotFoundException('Day not found');
    }
    const mealPlan = day.mealPlan as MealPlan | undefined;
    if (!mealPlan || mealPlan.status !== 'active') {
      throw new ForbiddenException('Отметки приёмов пищи доступны только для активного плана.');
    }
    const allowed: MealTrackSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'snack2'];
    const raw = (day.mealStatuses ?? {}) as Record<string, MealTrackStatus | string>;
    const next: Record<string, MealTrackStatus> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (value === 'done' || value === 'skipped') {
        next[key] = value;
      }
    }
    for (const slot of allowed) {
      if (!(slot in body)) continue;
      const value = body[slot];
      if (value === null || value === undefined) {
        delete next[slot];
      } else if (value === 'done' || value === 'skipped') {
        next[slot] = value;
      }
    }
    await day.update({ mealStatuses: next } as never);
    return day;
  }

  private isPlaceholderConstructorSnapshot(s: MealSlotSnapshot | null | undefined): boolean {
    if (!s?.name) return true;
    return /^блюдо\s*\(/i.test(String(s.name).trim());
  }

  private getConstructorSlotSnapshot(day: SaveMealPlanDayDto, slot: ConstructorPlanSlot): MealSlotSnapshot | null {
    if (slot === 'snack2') return day.extraSnacks?.[0] ?? null;
    return day[slot] as MealSlotSnapshot | null;
  }

  private setConstructorSlotSnapshot(
    day: SaveMealPlanDayDto,
    slot: ConstructorPlanSlot,
    snap: MealSlotSnapshot | null,
  ): SaveMealPlanDayDto {
    if (slot === 'snack2') {
      return { ...day, extraSnacks: snap ? [snap] : [] };
    }
    return { ...day, [slot]: snap };
  }

  private formatConstructorPlanLine(day: SaveMealPlanDayDto): string {
    const fmt = (slot: ConstructorPlanSlot): string => {
      const s = this.getConstructorSlotSnapshot(day, slot);
      if (!s?.name || this.isPlaceholderConstructorSnapshot(s)) return 'null';
      return s.name;
    };
    return `день ${day.dayNumber}: breakfast=${fmt('breakfast')}; lunch=${fmt('lunch')}; dinner=${fmt('dinner')}; snack=${fmt('snack')}; snack2=${fmt('snack2')}`;
  }

  private mergeConstructorRefinementAi(
    baseDays: SaveMealPlanDayDto[],
    aiChanges: ConstructorRefinementChange[],
    resolve: (rawName: string) => Product | null,
  ): SaveMealPlanDayDto[] {
    const changeByKey = new Map<string, ConstructorRefinementChange>();
    for (const c of aiChanges) {
      changeByKey.set(`${c.day}-${c.slot}`, c);
    }

    return baseDays.map((day) => {
      let next = { ...day };
      for (const slot of CONSTRUCTOR_PLAN_SLOTS) {
        const ch = changeByKey.get(`${day.dayNumber}-${slot}`);
        if (!ch) continue;

        if (ch.action === 'keep') {
          continue;
        }

        const cat: MealSlotKey = slot === 'snack2' || slot === 'snack' ? 'snack' : slot;
        const nm = (ch.dishName ?? '').trim();
        const pr = nm ? resolve(nm) : null;

        if (ch.action === 'replace') {
          if (pr) {
            const snap = this.snapshotFromProduct(pr, cat);
            if (ch.reason) snap.note = ch.reason;
            next = this.setConstructorSlotSnapshot(next, slot, snap);
          }
          continue;
        }

        if (ch.action === 'fill' && pr) {
          const snap = this.snapshotFromProduct(pr, cat);
          if (ch.reason) snap.note = ch.reason;
          next = this.setConstructorSlotSnapshot(next, slot, snap);
        }
      }
      return next;
    });
  }

  private fillEmptyConstructorSlots(
    days: SaveMealPlanDayDto[],
    targetCalories: number,
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
    pref: PreferenceContext,
    fallbackAnyPool: Product[],
  ): SaveMealPlanDayDto[] {
    const dist = DEFAULT_DIST;
    const snackShare1 = dist.snacks * 0.55;
    const snackShare2 = dist.snacks * 0.45;
    const tc = targetCalories;

    return days.map((day, di) => {
      let next = { ...day };
      const used = new Set<string>();
      for (const slot of CONSTRUCTOR_PLAN_SLOTS) {
        const s = this.getConstructorSlotSnapshot(next, slot);
        if (s?.dishId) used.add(String(s.dishId));
      }

      let salt = 0;
      const tryFill = (slot: ConstructorPlanSlot, budget: number, poolCat: MealSlotKey) => {
        const cur = this.getConstructorSlotSnapshot(next, slot);
        if (cur != null && !this.isPlaceholderConstructorSnapshot(cur)) return;
        const pool = pools[poolCat].length > 0 ? pools[poolCat] : fallbackAnyPool;
        const picked = this.pickFromPool(pool, budget, di, salt++, used, pref);
        if (!picked) return;
        const snap = this.snapshotFromProduct(picked, poolCat);
        next = this.setConstructorSlotSnapshot(next, slot, snap);
      };

      tryFill('breakfast', tc * dist.breakfast, 'breakfast');
      tryFill('lunch', tc * dist.lunch, 'lunch');
      tryFill('dinner', tc * dist.dinner, 'dinner');
      tryFill('snack', tc * snackShare1, 'snack');
      tryFill('snack2', tc * snackShare2, 'snack');

      return next;
    });
  }

  private buildConstructorFallbackChanges(
    beforeDays: SaveMealPlanDayDto[],
    afterDays: SaveMealPlanDayDto[],
  ): ConstructorRefinementChange[] {
    const byDay = new Map(afterDays.map((d) => [d.dayNumber, d]));
    const out: ConstructorRefinementChange[] = [];
    for (const day of beforeDays) {
      const next = byDay.get(day.dayNumber);
      if (!next) continue;
      for (const slot of CONSTRUCTOR_PLAN_SLOTS) {
        const prevSnap = this.getConstructorSlotSnapshot(day, slot);
        const nextSnap = this.getConstructorSlotSnapshot(next, slot);
        const prevName = String(prevSnap?.name ?? '').trim();
        const nextName = String(nextSnap?.name ?? '').trim();
        if (prevName === nextName) continue;
        const action: ConstructorRefinementChange['action'] = !prevName && nextName ? 'fill' : 'replace';
        const reason =
          action === 'fill'
            ? 'Слот был пуст — заполнен автоматически из каталога.'
            : 'Слот заменён автоматически с учётом ограничений и калорийности.';
        out.push({
          day: day.dayNumber,
          slot: slot as ConstructorRefinementChange['slot'],
          action,
          dishName: nextName,
          previousDishName: prevName,
          reason,
        });
      }
    }
    return out;
  }

  async refineConstructorPlanWithAi(
    userId: string,
    body: { targetCalories: number; days: SaveMealPlanDayDto[]; auditHint?: string },
  ): Promise<{
    days: SaveMealPlanDayDto[];
    overview: string;
    changes: ConstructorRefinementChange[];
    warnings: string[];
  }> {
    const user = (await this.userModel.findByPk(this.uid(userId), {
      include: [Allergen],
    })) as User & { allergens?: Allergen[] };
    if (!user) throw new NotFoundException('User not found');

    const normalized = [...body.days].sort((a, b) => a.dayNumber - b.dayNumber);
    if (!normalized.length) {
      throw new BadRequestException('Добавьте хотя бы один день плана.');
    }

    const pref = await this.preferenceContext(userId, user);
    const dislikeKeywords = this.normalizeKeywordList(user.foodDislikes);
    const safeGoal = normalizeGoalByWeight(user.goal, user.weight, user.height);

    const age = Math.max(
      1,
      Math.floor((Date.now() - new Date(user.birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25)),
    );
    const caloriesRaw = Number(body.targetCalories);
    const calories =
      Number.isFinite(caloriesRaw) && caloriesRaw > 0
        ? Math.round(caloriesRaw)
        : user.targetCalories != null && user.targetCalories > 0
          ? Math.round(user.targetCalories)
          : Math.round(
              (10 * user.weight + 6.25 * user.height - 5 * age + (user.gender === 'male' ? 5 : -161)) * 1.5,
            );

    const products = await this.productModel.findAll({ limit: 400, order: [['name', 'ASC']] });
    const safe = this.filterProductsByUserAllergens(products, user);
    let allowed = filterProductsByDietary(safe, user.dietaryRestrictions ?? []);
    allowed = this.filterProductsByDislikes(allowed, dislikeKeywords);
    if (allowed.length === 0) {
      allowed = this.filterProductsByDislikes(safe, dislikeKeywords);
    }
    let catalogForAi = allowed.filter((p) => !productLooksLikeAlcoholicSnack(p));
    if (catalogForAi.length === 0) catalogForAi = allowed;

    if (allowed.length > 0) {
      allowed = [...allowed].sort(
        (a, b) => this.productPreferenceScore(b, pref) - this.productPreferenceScore(a, pref),
      );
    }

    const dishNames = catalogForAi.map((p) => p.name);

    const resolve = (rawName: string): Product | null => resolveCatalogProductByName(rawName, catalogForAi);

    const currentPlanLines = normalized.map((d) => this.formatConstructorPlanLine(d));

    const ai = await this.openAiService.refineConstructorPlanFromCatalog({
      days: normalized.length,
      gender: user.gender,
      age,
      weight: user.weight,
      height: user.height,
      goal: safeGoal,
      calories,
      allergies: (user.allergens ?? []).map((a) => a.name),
      dietaryRestrictions: user.dietaryRestrictions ?? [],
      foodLikes: pref.likes,
      foodDislikes: pref.dislikes,
      fridgeProducts: pref.fridgeNames,
      dishNames,
      currentPlanLines,
      auditHint: body.auditHint,
    });

    let merged = this.mergeConstructorRefinementAi(normalized, ai.changes, resolve);

    const [bRaw, lRaw, dRaw, sRaw] = await Promise.all([
      this.productModel.findAll({ where: { category: 'breakfast' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'lunch' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'dinner' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'snack' }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
    ]);
    const pools = this.buildFilteredPools({ breakfast: bRaw, lunch: lRaw, dinner: dRaw, snack: sRaw }, user);
    const fallbackAnyPool = Array.from(
      new Map(
        [...pools.breakfast, ...pools.lunch, ...pools.dinner, ...pools.snack].map((p) => [String(p.id), p]),
      ).values(),
    );

    merged = this.fillEmptyConstructorSlots(merged, calories, pools, pref, fallbackAnyPool);

    const scaledDays = merged.map((d) =>
      this.scaleDaySnapshotsToTarget(d, calories, CALORIE_TARGET_TOLERANCE),
    );
    const enforced = await this.enforceDietaryForAiDays(userId, user, scaledDays);
    const fallbackChanges = this.buildConstructorFallbackChanges(normalized, enforced.days);
    const finalChanges = ai.changes.length > 0 ? ai.changes : fallbackChanges;
    const finalOverview =
      ai.changes.length > 0
        ? ai.overview
        : `${ai.overview} Изменения определены сервером по сетке.`;

    return {
      days: enforced.days,
      overview: finalOverview,
      changes: finalChanges,
      warnings: enforced.warnings,
    };
  }

  async generateAiPlan(userId: string, durationDays: number, opts?: { targetCalories?: number }) {
    const user = (await this.userModel.findByPk(this.uid(userId), {
      include: [Allergen],
    })) as User & { allergens?: Allergen[] };
    if (!user) throw new NotFoundException('User not found');
    const safeGoal = normalizeGoalByWeight(user.goal, user.weight, user.height);
    const pref = await this.preferenceContext(userId, user);
    const dislikeKeywords = this.normalizeKeywordList(user.foodDislikes);

    const age = Math.max(
      1,
      Math.floor((Date.now() - new Date(user.birthDate).getTime()) / (1000 * 60 * 60 * 24 * 365.25)),
    );
    const calories =
      opts?.targetCalories ??
      user.targetCalories ??
      Math.round(
        (10 * user.weight + 6.25 * user.height - 5 * age + (user.gender === 'male' ? 5 : -161)) * 1.5,
      );

    const products = await this.productModel.findAll({ limit: 400, order: [['name', 'ASC']] });
    const safe = this.filterProductsByUserAllergens(products, user);
    let allowed = filterProductsByDietary(safe, user.dietaryRestrictions ?? []);
    allowed = this.filterProductsByDislikes(allowed, dislikeKeywords);
    if (allowed.length === 0) {
      allowed = this.filterProductsByDislikes(safe, dislikeKeywords);
    }
    if (allowed.length > 0) {
      allowed = [...allowed].sort(
        (a, b) => this.productPreferenceScore(b, pref) - this.productPreferenceScore(a, pref),
      );
    }
    const dishNames = allowed.map((p) => p.name);

    const ai = await this.openAiService.generateMealPlanFromCatalog({
      days: durationDays,
      gender: user.gender,
      age,
      weight: user.weight,
      height: user.height,
      goal: safeGoal,
      calories,
      allergies: (user.allergens ?? []).map((a) => a.name),
      dietaryRestrictions: user.dietaryRestrictions ?? [],
      foodLikes: pref.likes,
      foodDislikes: pref.dislikes,
      fridgeProducts: pref.fridgeNames,
      dishNames,
    });

    const resolve = (rawName: string): Product | null => resolveCatalogProductByName(rawName, allowed);

    const days: SaveMealPlanDayDto[] = (
      ai as {
        days: Array<{
          day: number;
          meals: {
            breakfast: string;
            lunch: string;
            dinner: string;
            snack: string;
            snacks?: string[];
          };
        }>;
      }
    ).days.map((item, index) => {
      const m = item.meals;
      const g = (name: string, cat: MealSlotKey) => {
        const pr = resolve(name);
        return pr
          ? this.snapshotFromProduct(pr, cat)
          : ({ name, calories: 0, protein: 0, fat: 0, carbs: 0, allergens: [], category: cat } as MealSlotSnapshot);
      };
      const extraRaw = m.snacks ?? [];
      const extraSnacks: MealSlotSnapshot[] = extraRaw
        .map((name) => g(name, 'snack'))
        .filter((s) => s.name);

      return {
        dayNumber: item.day ?? index + 1,
        breakfast: g(m.breakfast, 'breakfast'),
        lunch: g(m.lunch, 'lunch'),
        dinner: g(m.dinner, 'dinner'),
        snack: g(m.snack, 'snack'),
        extraSnacks,
      };
    });

    const diversified = this.diversifyCatalogDays(days, {
      breakfast: allowed.filter((p) => p.category === 'breakfast'),
      lunch: allowed.filter((p) => p.category === 'lunch'),
      dinner: allowed.filter((p) => p.category === 'dinner'),
      snack: allowed.filter((p) => p.category === 'snack'),
    });
    const scaledDays = diversified.map((d) =>
      this.scaleDaySnapshotsToTarget(d, calories, CALORIE_TARGET_TOLERANCE),
    );
    const enforced = await this.enforceDietaryForAiDays(userId, user, scaledDays);

    await this.saveUserPlan(userId, {
      durationDays,
      targetCalories: calories,
      days: enforced.days,
      name: `AI (каталог) ${this.formatRuPlanDateTime(new Date())}`,
    });
    const planCat = await this.getActivePlan(userId);
    return { ...(planCat?.get({ plain: true }) ?? {}), warnings: enforced.warnings };
  }
}
