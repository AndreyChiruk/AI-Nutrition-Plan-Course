import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Sequelize } from 'sequelize';
import { Allergen } from '../models/Allergen';
import { FridgeItem } from '../models/FridgeItem';
import { Ingredient } from '../models/Ingredient';
import { MealPlan } from '../models/MealPlan';
import { MealPlanDay, MealSlotSnapshot, MealTrackStatus, MealTrackSlot } from '../models/MealPlanDay';
import { Product } from '../models/Product';
import { User } from '../models/User';
import { OpenAiService } from '../openai/openai.service';
import type { ConstructorRefinementChange } from '../openai/openai.validators';

/**
 * Максимальная длительность плана питания.
 *
 * Больше 30 дней генерировать не имеет смысла: каталог проверенных блюд
 * (только `is_from_api = true`) не вмещает столько уникальных позиций на
 * узких диетах, поэтому в длинном плане одно и то же блюдо начинает
 * повторяться десятки раз. Ограничение действует и для автоплана, и для
 * AI-плана, и для конструктора.
 */
export const MAX_PLAN_DAYS = 30;
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
import { calculateEnergy, resolveAge, resolveTargetCalories } from '../common/energy.util';
import {
  dishStoredOrInferredMatchesSlot,
  inferMealSlotFromDishName,
  type MealSlotKeyInfer,
} from './dish-category-infer.util';

/**
 * Читает ВСЕ перекусы дня, а не только первый.
 *
 * Раньше функция возвращала лишь `raw[0]`, поэтому второй и третий перекусы,
 * созданные генератором, пропадали из интерфейса после сохранения и
 * перезагрузки плана: пользователь видел день на ~2200 ккал вместо 3000.
 * Здесь объединяются оба места хранения (`snacks` и `extra_snacks`),
 * чтобы старые записи читались корректно.
 */
function snacksFromDb(snacksRaw: unknown, extraRaw: unknown): MealSlotSnapshot[] {
  const out: MealSlotSnapshot[] = [];
  const push = (value: unknown) => {
    if (!value) return;
    if (Array.isArray(value)) {
      for (const item of value) push(item);
      return;
    }
    if (typeof value === 'object' && value !== null && 'name' in (value as object)) {
      out.push(value as MealSlotSnapshot);
    }
  };
  push(snacksRaw);
  push(extraRaw);

  // Убираем возможные дубликаты по названию и калорийности.
  const seen = new Set<string>();
  return out.filter((s) => {
    const key = `${String(s.name ?? '')}|${Number(s.calories) || 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Первый перекус дня (для обратной совместимости с полем `snack`). */
function primarySnackFromDb(raw: unknown): MealSlotSnapshot | null {
  return snacksFromDb(raw, null)[0] ?? null;
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

/**
 * Допуск для ФИНАЛЬНОГО прохода масштабирования.
 *
 * Меньше основного, потому что после финального масштабирования план
 * сохраняется как есть: если ориентироваться на 10 %, день может
 * остановиться на границе и после округления выйти за неё (наблюдалось 11.2 %).
 */
const CALORIE_TARGET_STRICT_TOLERANCE = 0.05;

type PreferenceContext = {
  /** Отдельные фразы из профиля (без перекрёстного расширения) — для проверки «каждое любимое учтено». */
  baseLikes: string[];
  likes: string[];
  dislikes: string[];
  fridgeNames: string[];
  /**
   * Пищевые привычки из профиля (`users.food_habits`).
   * Раньше поле только сохранялось и отдавалось в API, но в планировании
   * не использовалось вовсе — «учтём ваши привычки» было фикцией.
   */
  habits: {
    /** Сколько чашек чая/кофе в день добавлять перекусом. */
    teaCupsPerDay: number;
    /** Число приёмов пищи в день (3 или 4), если задано. */
    mealsPerDay: number | null;
    /** Предпочитает ли пользователь домашнюю еду. */
    prefersHomeCooking: boolean;
  };
};

/** Разумные границы для привычек, чтобы мусор в профиле не ломал план. */
const MAX_TEA_CUPS = 6;

@Injectable()
export class MealPlanService {
  constructor(
    @InjectModel(MealPlan) private readonly mealPlanModel: typeof MealPlan,
    @InjectModel(MealPlanDay) private readonly mealPlanDayModel: typeof MealPlanDay,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(Product) private readonly productModel: typeof Product,
    @InjectModel(FridgeItem) private readonly fridgeItemModel: typeof FridgeItem,
    @InjectModel(Ingredient) private readonly ingredientModel: typeof Ingredient,
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
      habits: this.parseFoodHabits(user.foodHabits),
    };
  }

  /**
   * Снимок ограничений пользователя для сохранения в план.
   *
   * Нужен, чтобы отличить план, построенный с текущими аллергиями и диетой,
   * от плана, созданного до их изменения. Без снимка пользователь мог
   * сделать текущим старый план, в котором оставались блюда с рыбой,
   * уже запрещённой по аллергии.
   */
  private restrictionSnapshot(user: User & { allergens?: Array<Allergen | string> }): Record<string, unknown> {
    const allergies = Array.isArray(user.allergens)
      ? [...user.allergens]
          .map((a) =>
            (typeof a === 'object' && a !== null && 'name' in a
              ? String((a as { name?: unknown }).name ?? '')
              : String(a ?? '')
            )
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean)
          .sort()
      : [];
    const restrictions = Array.isArray(user.dietaryRestrictions)
      ? [...user.dietaryRestrictions]
          .map((d) => String(d).trim().toLowerCase())
          .filter(Boolean)
          .sort()
      : [];
    const dislikes = this.normalizeKeywordList(user.foodDislikes).sort();

    return {
      allergens: allergies,
      diet: restrictions,
      dislikes,
      goal: user.goal ?? null,
      // Возраст важен для правила «не предлагать алкоголь до 18 лет».
      age: this.ageFromBirthDate(user.birthDate),
    };
  }

  /** Возраст в полных годах или null, если дата не задана. */
  private ageFromBirthDate(raw: unknown): number | null {
    if (!raw) return null;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age -= 1;
    return age >= 0 && age < 130 ? age : null;
  }

  /**
   * Отличаются ли текущие ограничения пользователя от снимка в плане.
   *
   * Возвращает список различий для показа пользователю.
   * Пустой массив — план соответствует текущим ограничениям.
   */
  private restrictionDiff(
    user: User,
    snapshot: Record<string, unknown> | null,
  ): Array<{ field: string; label: string; before: string; after: string }> {
    if (!snapshot) return [];

    const current = this.restrictionSnapshot(user);
    const diffs: Array<{ field: string; label: string; before: string; after: string }> = [];

    const fmt = (v: unknown): string =>
      Array.isArray(v) ? (v.length ? v.join(', ') : 'нет') : v == null ? 'не задано' : String(v);

    const labels: Record<string, string> = {
      allergens: 'Аллергии',
      diet: 'Тип питания',
      dislikes: 'Нежелательные продукты',
      goal: 'Цель',
    };

    for (const key of ['allergens', 'diet', 'dislikes', 'goal'] as const) {
      const a = fmt(snapshot[key]);
      const b = fmt(current[key]);
      if (a !== b) {
        diffs.push({ field: key, label: labels[key], before: a, after: b });
      }
    }

    // Возраст: если пользователь перешёл в 18 лет, алкоголь становится
    // допустимым — это тоже изменение, но показываем только переход
    // через границу, чтобы не сбрасывать план каждый год.
    const ageBefore = Number(snapshot.age);
    const ageNow = Number(current.age);
    if (Number.isFinite(ageBefore) && Number.isFinite(ageNow)) {
      const wasMinor = ageBefore < 18;
      const isMinor = ageNow < 18;
      if (wasMinor !== isMinor) {
        diffs.push({
          field: 'age',
          label: 'Возраст',
          before: wasMinor ? 'до 18' : '18 и старше',
          after: isMinor ? 'до 18' : '18 и старше',
        });
      }
    }

    return diffs;
  }

  /**
   * Разбирает `users.food_habits` в типизированную структуру с проверкой границ.
   * Поле приходит из профиля как произвольный JSON, поэтому любые значения
   * приводятся к разумным пределам.
   */
  private parseFoodHabits(raw: unknown): PreferenceContext['habits'] {
    const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

    const teaRaw = Number(obj.teaCupsPerDay);
    const teaCupsPerDay =
      Number.isFinite(teaRaw) && teaRaw > 0 ? Math.min(MAX_TEA_CUPS, Math.floor(teaRaw)) : 0;

    const mealsRaw = Number(obj.mealsPerDay);
    const mealsPerDay =
      Number.isFinite(mealsRaw) && mealsRaw >= 3 && mealsRaw <= 5 ? Math.floor(mealsRaw) : null;

    const prefersHomeCooking = obj.prefersHomeCooking === true || obj.homeCooking === true;

    return { teaCupsPerDay, mealsPerDay, prefersHomeCooking };
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
    // Привычки из профиля (users.food_habits): раньше поле не использовалось
    // вовсе, хотя в интерфейсе обещано «учтём ваши привычки».
    out = this.applyFoodHabits(out, pref, pools);
    // Проверка алкоголя по ВСЕМ слотам (не только перекусам), с передачей
    // основных пулов для осмысленной замены.
    out = await this.applyWeeklySnackAlcoholBudgetToPlanDays(out, user, pref, pools);

    // ФИНАЛЬНЫЙ проход разнообразия.
    //
    // Предыдущие шаги (подбор по калориям, замена напитков, привычки) могут
    // снова привести одно и то же блюдо в разные дни: например, замена
    // алкоголя брала ближайшее по калорийности блюдо из пула и повторяла его.
    // Здесь убираем оставшиеся дубликаты внутри каждого слота.
    out = this.deduplicateAcrossDays(out, pools, pref);

    // Если блюд в пуле меньше, чем дней, полностью избежать повторов
    // невозможно — дедупликация лишь распределяет их равномерно.
    // Сообщаем об этом честно: иначе пользователь видит одинаковые
    // блюда и считает это ошибкой подбора.
    const capacity = this.planCapacityWarning(out, pools);
    this.lastCapacityWarning = capacity;

    return out;
  }

  /** Предупреждение о нехватке блюд; заполняется при финализации плана. */
  private lastCapacityWarning: string | null = null;

  /**
   * Проверяет, хватает ли блюд в пуле на все дни плана.
   *
   * Для 180-дневного плана нужно 180 завтраков, а веганских завтраков
   * в каталоге всего около десяти — повторы неизбежны, и пользователь
   * должен понимать, что это ограничение каталога, а не ошибка.
   */
  private planCapacityWarning(
    days: SaveMealPlanDayDto[],
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  ): string | null {
    const SLOT_LABEL: Record<string, string> = {
      breakfast: 'завтраков',
      lunch: 'обедов',
      dinner: 'ужинов',
      snack: 'перекусов',
    };
    const need = days.length;
    const short: string[] = [];
    for (const slot of ['breakfast', 'lunch', 'dinner', 'snack'] as const) {
      const available = (pools[slot] ?? []).length;
      if (available > 0 && available < need) {
        short.push(`${SLOT_LABEL[slot]}: ${available} на ${need} дней`);
      }
    }
    if (short.length === 0) return null;
    return `В каталоге меньше подходящих блюд, чем дней плана (${short.join(', ')}) — повторы неизбежны. ` +
      'Уменьшите срок или ослабьте ограничения, чтобы получить больше разнообразия.';
  }

  /**
   * Заменяет повторяющиеся блюда внутри одного слота на неиспользованные.
   *
   * Работает по каждому слоту отдельно: «Овсянка» может быть завтраком
   * в один день и не встречаться больше нигде, но не должна повторяться
   * на завтрак каждый день.
   *
   * Если пул слота исчерпан, повтор остаётся — это ограничение каталога,
   * а не ошибка алгоритма.
   */
  private deduplicateAcrossDays(
    days: SaveMealPlanDayDto[],
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
    pref: PreferenceContext,
  ): SaveMealPlanDayDto[] {
    const SLOT_KEYS: MealSlotKey[] = ['breakfast', 'lunch', 'dinner', 'snack'];

    /** Для каждого слота — какие блюда уже заняты и с какой частотой. */
    const usage = new Map<string, Map<string, number>>();
    for (const slot of SLOT_KEYS) usage.set(slot, new Map());

    const nameOf = (s: MealSlotSnapshot | null | undefined): string =>
      String(s?.name ?? '').trim().toLowerCase();

    // 1. Считаем частоты по всем дням.
    for (const day of days) {
      for (const slot of SLOT_KEYS) {
        const snap = day[slot] as MealSlotSnapshot | null | undefined;
        const n = nameOf(snap);
        if (!n) continue;
        const map = usage.get(slot)!;
        map.set(n, (map.get(n) ?? 0) + 1);
      }
      for (const ex of day.extraSnacks ?? []) {
        const n = nameOf(ex);
        if (!n) continue;
        const map = usage.get('snack')!;
        map.set(n, (map.get(n) ?? 0) + 1);
      }
    }

    // 2. Проходим по дням и заменяем те блюда, что встречаются больше одного раза.
    const result = days.map((day) => {
      const next: SaveMealPlanDayDto = { ...day };

      for (const slot of SLOT_KEYS) {
        const snap = next[slot] as MealSlotSnapshot | null | undefined;
        const name = nameOf(snap);
        if (!snap || !name) continue;

        const map = usage.get(slot)!;
        if ((map.get(name) ?? 0) <= 1) continue;

        const pool = pools[slot] ?? [];
        // Кандидат: не используется в этом слоте и отличается от текущего.
        const candidate = pool.find((p) => {
          const pn = String(p.name ?? '').trim().toLowerCase();
          if (!pn || pn === name) return false;
          return (map.get(pn) ?? 0) === 0;
        });

        if (!candidate) continue;

        const replacement = this.snapshotFromProduct(candidate, slot);
        replacement.note = 'подобрано для разнообразия плана';
        next[slot] = replacement;

        // Обновляем счётчики: старое блюдо освободилось, новое занято.
        map.set(name, (map.get(name) ?? 1) - 1);
        const cName = String(candidate.name).trim().toLowerCase();
        map.set(cName, (map.get(cName) ?? 0) + 1);
      }

      return next;
    });

    // Масштабирование под целевую калорийность выполняется вызывающим кодом
    // ПОСЛЕ этого метода, поэтому замена не нарушает допуск по калориям.
    return result;
  }

  /**
   * Применяет пищевые привычки пользователя к плану.
   *
   * `users.food_habits` хранит, например, `{ teaCupsPerDay: 2 }`. Раньше поле
   * сохранялось и отдавалось в API, но в планировании не участвовало.
   *
   * Реализовано:
   *  - `teaCupsPerDay` — добавляет перекусы-напитки (чай/кофе) в начало дня;
   *  - `mealsPerDay` — при значении 3 убирает лишние перекусы, оставляя
   *    завтрак/обед/ужин.
   */
  private applyFoodHabits(
    days: SaveMealPlanDayDto[],
    pref: PreferenceContext,
    pools: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  ): SaveMealPlanDayDto[] {
    const { teaCupsPerDay, mealsPerDay } = pref.habits;
    if (teaCupsPerDay === 0 && mealsPerDay === null) return days;

    // Напитки ищем среди перекусов.
    const drinkPool = pools.snack.filter((p) =>
      /(чай|кофе|какао|напиток|смузи|компот|морс|кисель|латте|капучино|tea|coffee|cocoa|smoothie|juice)/i.test(
        String(p.name ?? ''),
      ),
    );

    return days.map((d) => {
      let next = { ...d };

      // 1. Привычка пить чай/кофе: добавляем напитки перекусами.
      if (teaCupsPerDay > 0 && drinkPool.length > 0) {
        const existing = [...(next.extraSnacks ?? [])];
        for (let i = 0; i < teaCupsPerDay; i++) {
          const drink = drinkPool[i % drinkPool.length];
          const already = [next.snack, ...existing].some(
            (s) => s && String(s.name ?? '').toLowerCase() === String(drink.name).toLowerCase(),
          );
          if (already) continue;
          const snap = this.snapshotFromProduct(drink, 'snack');
          snap.note = 'учтена привычка: чай/кофе';
          existing.push(snap);
        }
        next = { ...next, extraSnacks: existing };
      }

      // 2. Привычка к трём приёмам пищи: убираем дополнительные перекусы.
      if (mealsPerDay === 3) {
        next = { ...next, extraSnacks: [] };
      }

      return next;
    });
  }

  private async finalizeGeneratedPlanDaysLoadingPools(
    days: SaveMealPlanDayDto[],
    userId: string,
    user: User & { allergens?: Allergen[] },
  ): Promise<SaveMealPlanDayDto[]> {
    const pref = await this.preferenceContext(userId, user);
    const [bRaw, lRaw, dRaw, sRaw] = await Promise.all([
      this.productModel.findAll({ where: { category: 'breakfast', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'lunch', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'dinner', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'snack', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
    ]);
    const pools = this.buildFilteredPools({ breakfast: bRaw, lunch: lRaw, dinner: dRaw, snack: sRaw }, user);
    return this.finalizeGeneratedPlanDays(days, user, pref, pools);
  }

  /**
   * Подбирает блюдо для слота, когда подходящих не осталось.
   *
   * Раньше в этом случае ставилась заглушка «Блюдо (breakfast)» с
   * усреднёнными 300 ккал. Такие записи выглядели как настоящие блюда,
   * но не существовали в каталоге, и при нехватке вариантов занимали
   * половину плана.
   *
   * Теперь повторяется реальное блюдо: сначала из того же слота, затем
   * из любого другого. Дубликат допустим — показать существующее блюдо
   * дважды лучше, чем выдуманное.
   */
  private pickReusableDish(
    slot: MealSlotKey,
    pools: Record<MealSlotKey, Product[]>,
    fallbackAny: Product[],
    seed: number,
  ): Product | null {
    const own = pools[slot] ?? [];
    const source = own.length > 0 ? own : fallbackAny;
    if (source.length === 0) return null;
    // Смещение по seed даёт разные блюда в разных днях,
    // а не одно и то же во всех пустых слотах.
    return source[seed % source.length] ?? source[0] ?? null;
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
    pref?: PreferenceContext,
  ) {
    const restrictions = user.dietaryRestrictions ?? [];
    const dislikeKeywords = this.normalizeKeywordList(user.foodDislikes);

    // Алкоголь запрещён пользователям младше 18 лет.
    // Возраст берётся из `users.birth_date`; если дата не задана,
    // ограничение не применяется — иначе взрослые пользователи
    // без заполненной даты потеряли бы часть каталога.
    const age = this.ageFromBirthDate(user.birthDate);
    const isMinor = age !== null && age < 18;

    const apply = (list: Product[]) => {
      const safe = this.filterProductsByUserAllergens(list, user);
      const diet = filterProductsByDietary(safe, restrictions);
      const pool = restrictions.length > 0 ? diet : safe;
      const withoutDislikes = this.filterProductsByDislikes(pool, dislikeKeywords);
      const legal = isMinor
        ? withoutDislikes.filter(
            (p) => p.containsAlcohol !== true && !productLooksLikeAlcoholicSnack(p),
          )
        : withoutDislikes;

      // Приоритет продуктам из холодильника: раньше они влияли лишь на
      // сортировку внутри top-48 (вес +1.2) и на текстовую сноску, то есть
      // состав плана от содержимого холодильника практически не зависел.
      // Используем их как префильтр, если набирается достаточно блюд.
      const fridgeNames = pref?.fridgeNames ?? [];
      if (fridgeNames.length === 0) return legal;

      const fromFridge = legal.filter((p) => {
        const hay = this.dishHaystackForProduct(p);
        return fridgeNames.some((k) => k && ruHaystackMatchesKeyword(hay, k));
      });
      // Если таких блюд достаточно для выбора — ограничиваем пул ими.
      return fromFridge.length >= 8 ? fromFridge : legal;
    };
    /**
     * Убирает алкоголь из пула слота.
     *
     * Раньше при пустом «трезвом» списке возвращался ИСХОДНЫЙ список с алкоголем
     * (`stripped.length > 0 ? stripped : list`), поэтому алкогольный напиток мог
     * попасть в завтрак, обед или ужин. Теперь возвращаем пустой список: генератор
     * подберёт блюдо из более широкого пула или сообщит о нехватке каталога —
     * это лучше, чем поставить пользователю коктейль на обед.
     */
    const stripMainAlcohol = (list: Product[]) =>
      list.filter((p) => !productLooksLikeAlcoholicSnack(p));
    return {
      breakfast: stripMainAlcohol(apply(raw.breakfast)),
      lunch: stripMainAlcohol(apply(raw.lunch)),
      dinner: stripMainAlcohol(apply(raw.dinner)),
      snack: stripMainAlcohol(apply(raw.snack)),
    };
  }

  /**
   * Финальная проверка плана: ни в одном слоте не должно остаться алкоголя.
   *
   * Раньше проверялись ТОЛЬКО перекусы («weekly snack alcohol budget»), поэтому
   * алкогольный коктейль мог оказаться в завтраке, обеде или ужине. В реальном
   * плане вегетарианца находились «Коктейль Гиллигана» и «Лимонная корона».
   *
   * Замена подбирается из трезвого пула той же категории, что и слот,
   * по ближайшей калорийности. Если заменить нечем — слот удаляется,
   * чтобы алкоголь гарантированно не попал в готовый план.
   */
  private applyWeeklySnackAlcoholBudget(
    days: SaveMealPlanDayDto[],
    snackPool: Product[],
    pref: PreferenceContext,
    mainPools?: { breakfast: Product[]; lunch: Product[]; dinner: Product[] },
  ): SaveMealPlanDayDto[] {
    const nonAlcSnack = snackPool.filter((p) => !productLooksLikeAlcoholicSnack(p));

    const poolFor = (slot: MealSlotKey): Product[] => {
      if (slot === 'snack') return nonAlcSnack;
      const p = mainPools?.[slot] ?? [];
      return p.filter((x) => !productLooksLikeAlcoholicSnack(x));
    };

    const fixSnap = (
      snap: MealSlotSnapshot | null,
      slot: MealSlotKey,
    ): MealSlotSnapshot | null => {
      if (!snap) return null;
      const probe = this.snapshotToProductProbe(snap);
      if (!productLooksLikeAlcoholicSnack(probe)) return snap;

      const source = poolFor(slot);
      const rep = this.pickClosestByCalories(source, Number(snap.calories) || 0, pref);
      return rep ? this.snapshotFromProduct(rep, slot) : null;
    };

    const out: SaveMealPlanDayDto[] = [];
    for (const [dayIndex, d] of days.entries()) {
      const breakfast = fixSnap(d.breakfast, 'breakfast');
      const lunch = fixSnap(d.lunch, 'lunch');
      const dinner = fixSnap(d.dinner, 'dinner');
      const snack = fixSnap(d.snack, 'snack');
      const extraSnacks = (d.extraSnacks ?? [])
        .map((s) => fixSnap(s, 'snack'))
        .filter(Boolean) as MealSlotSnapshot[];

      // Если слот пуст, повторяем подходящее блюдо из пула.
      // Заглушка «Блюдо (cat)» используется только при пустом каталоге.
      const reuse = (cat: MealSlotKey, seed: number): MealSlotSnapshot | null => {
        const source = poolFor(cat);
        if (source.length === 0) return null;
        const dish = source[(dayIndex + seed) % source.length] ?? source[0];
        return dish ? this.snapshotFromProduct(dish, cat) : null;
      };

      const fallbackSlot = (cat: MealSlotKey): MealSlotSnapshot => ({
        name: `Блюдо (${cat})`,
        calories: 300,
        protein: 20,
        fat: 10,
        carbs: 30,
        allergens: [],
        category: cat,
      });

      out.push({
        ...d,
        breakfast: breakfast ?? reuse('breakfast', 1) ?? fallbackSlot('breakfast'),
        lunch: lunch ?? reuse('lunch', 2) ?? fallbackSlot('lunch'),
        dinner: dinner ?? reuse('dinner', 3) ?? fallbackSlot('dinner'),
        snack: snack ?? reuse('snack', 4) ?? fallbackSlot('snack'),
        extraSnacks,
      });
    }
    return out;
  }

  private async applyWeeklySnackAlcoholBudgetToPlanDays(
    days: SaveMealPlanDayDto[],
    user: User & { allergens?: Allergen[] },
    pref: PreferenceContext,
    mainPools?: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
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
    // Основные пулы: переданные вызывающим кодом, иначе — из свежезагруженного каталога.
    const effectiveMain = mainPools ?? pools;
    return this.applyWeeklySnackAlcoholBudget(days, snackPool, pref, {
      breakfast: effectiveMain.breakfast,
      lunch: effectiveMain.lunch,
      dinner: effectiveMain.dinner,
    });
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
      this.productModel.findAll({ where: { category: 'breakfast', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'lunch', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'dinner', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'snack', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
    ]);
    const pools = this.buildFilteredPools(
      { breakfast: bRaw, lunch: lRaw, dinner: dRaw, snack: sRaw },
      user,
      pref,
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
    // Предупреждения о деградации плана.
    //
    // Раньше этот блок был закомментирован, поэтому пользователь НЕ узнавал,
    // что AI предложил блюда с его аллергенами (они молча заменялись) или что
    // для части позиций не нашлось подходящей замены — план выглядел
    // «нормальным», хотя был собран частично из заглушек.
    if (allergyReplaced > 0) {
      warnings.push(
        `AI предложил ${allergyReplaced} блюд(а) с вашими аллергенами — они заменены на безопасные из каталога.`,
      );
    }
    if (dietaryReplaced > 0) {
      warnings.push(
        `Заменено из-за несоответствия диете: ${dietaryReplaced} блюд(а).`,
      );
    }
    if (dislikesReplaced > 0) {
      warnings.push(
        `Заменено из-за нежелательных для вас продуктов: ${dislikesReplaced} блюд(а).`,
      );
    }
    if (unresolvedCount > 0) {
      warnings.push(
        `Для ${unresolvedCount} позиции(й) не нашлось подходящей замены в каталоге — ` +
          'эти приёмы пищи заполнены усреднёнными данными. Пополните каталог блюдами нужной категории.',
      );
    }
    if (replacedCount > 0 && allergyReplaced + dietaryReplaced + dislikesReplaced === 0) {
      warnings.push(
        `Автоматически заменено блюд: ${replacedCount} (нарушали ограничения профиля).`,
      );
    }

    const adjusted = await this.finalizeGeneratedPlanDays(out, user, pref, pools);

    // Добавляем предупреждение, если в плане остались заглушки
    // («Блюдо (slot)») — это признак нехватки каталога.
    const placeholders = adjusted.reduce((sum, d) => {
      const slots = [d.breakfast, d.lunch, d.dinner, d.snack, ...(d.extraSnacks ?? [])];
      return sum + slots.filter((s) => s && /^Блюдо \(/.test(String(s.name ?? ''))).length;
    }, 0);
    if (placeholders > 0) {
      warnings.push(
        `В плане ${placeholders} приём(а) пищи заполнены усреднёнными данными (300 ккал) ` +
          'из-за нехватки подходящих блюд в каталоге под ваши аллергии и диету.',
      );
    }

    // Предупреждение о нехватке блюд для длинных планов: без него
    // пользователь видит повторы и считает их ошибкой подбора.
    if (this.lastCapacityWarning) {
      warnings.push(this.lastCapacityWarning);
    }

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

    /**
     * Масштабирует снапшот под нужную калорийность.
     *
     * Раньше изменялись только КБЖУ, а граммовки ингредиентов оставались
     * исходными: пользователь видел «Омлет 270 г» и «1100 ккал» одновременно,
     * а при закупке по граммовкам получал вдвое меньше калорий, чем в плане.
     * Теперь масса ингредиентов масштабируется тем же коэффициентом.
     */
    const scaleSnap = (s: MealSlotSnapshot | null): MealSlotSnapshot | null => {
      if (!s || typeof s !== 'object' || !('calories' in s)) return s;
      const snap = s as MealSlotSnapshot;
      const c = Number(snap.calories) || 0;
      if (c <= 0) return { ...snap, calories: 0 };

      const round1 = (v: number) => Math.round(v * 10) / 10;
      const scaleGrams = (v: unknown) => {
        const g = Number(v) || 0;
        return g > 0 ? round1(g * factor) : g;
      };

      const mapIngredient = <T extends { grams?: unknown; amount?: unknown }>(row: T): T => {
        if (!row || typeof row !== 'object') return row;
        const next: Record<string, unknown> = { ...row };
        if (row.grams !== undefined && row.grams !== null) next.grams = scaleGrams(row.grams);
        if (row.amount !== undefined && row.amount !== null) next.amount = scaleGrams(row.amount);
        return next as T;
      };

      const snapshotWithIngredients = snap as MealSlotSnapshot & {
        ingredients?: Array<{ grams?: unknown }>;
        ingredientsDetailed?: Array<{ grams?: unknown; amount?: unknown }>;
      };

      return {
        ...snap,
        calories: Math.max(0, Math.round(c * factor)),
        protein: round1((Number(snap.protein) || 0) * factor),
        fat: round1((Number(snap.fat) || 0) * factor),
        carbs: round1((Number(snap.carbs) || 0) * factor),
        // Общая масса порции тоже меняется.
        ...(Number((snap as { weight?: unknown }).weight) > 0
          ? { weight: round1(Number((snap as { weight?: unknown }).weight) * factor) }
          : {}),
        ...(Array.isArray(snapshotWithIngredients.ingredients)
          ? { ingredients: snapshotWithIngredients.ingredients.map(mapIngredient) }
          : {}),
        ...(Array.isArray(snapshotWithIngredients.ingredientsDetailed)
          ? { ingredientsDetailed: snapshotWithIngredients.ingredientsDetailed.map(mapIngredient) }
          : {}),
      } as MealSlotSnapshot;
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

  /**
   * Пересчитывает итоги плана по ФАКТИЧЕСКИМ дням из БД.
   *
   * Колонки `total_*` в `meal_plans` — денормализация: они записываются при
   * сохранении и больше не обновляются. Если состав дней менялся (конструктор,
   * повторное сохранение, миграции перекусов), значения расходились с суммой
   * дней — вплоть до 5568 ккал. Из-за этого скачанный JSON был внутренне
   * противоречив, а статистика показывала неверную калорийность плана.
   *
   * Читаем дни и считаем итоги заново — это единственный источник истины.
   */
  private computeTotalsFromDbDays(
    days: Array<{ breakfast?: unknown; lunch?: unknown; dinner?: unknown; snacks?: unknown; extraSnacks?: unknown }>,
  ) {
    let calories = 0;
    let protein = 0;
    let fat = 0;
    let carbs = 0;

    const addSnapshot = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || !('calories' in (raw as object))) return;
      const s = raw as MealSlotSnapshot;
      calories += Number(s.calories) || 0;
      protein += Number(s.protein) || 0;
      fat += Number(s.fat) || 0;
      carbs += Number(s.carbs) || 0;
    };

    for (const d of days ?? []) {
      addSnapshot(d?.breakfast);
      addSnapshot(d?.lunch);
      addSnapshot(d?.dinner);
      for (const snack of snacksFromDb(d?.snacks, d?.extraSnacks)) addSnapshot(snack);
    }

    return {
      calories: Math.round(calories),
      protein: Math.round(protein * 10) / 10,
      fat: Math.round(fat * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
    };
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

    // Разрешаем блюду встретиться не более одного раза за план.
    //
    // Раньше лимит был 2 повтора, а замена искала ПЕРВОЕ подходящее блюдо
    // в пуле (`pool.find`) — всегда одно и то же. Из-за этого недельный план
    // превращался в цикл из 3 дней: «Кошари» на обед повторялся 6 раз из 7.
    // Замена теперь выбирается псевдослучайно по названию блюда, поэтому
    // разные слоты получают разные альтернативы.
    const MAX_REPEATS = 1;

    /** Детерминированный хеш строки — стабильный выбор замены. */
    const hashOf = (value: string): number => {
      let h = 2166136261;
      for (let i = 0; i < value.length; i++) {
        h ^= value.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return Math.abs(h);
    };

    const pickAlt = (
      slot: MealSlotKey,
      current: MealSlotSnapshot | null,
      prevName?: string,
      salt = 0,
    ): MealSlotSnapshot | null => {
      if (!current?.name) return current;

      const key = `${slot}:${current.name.toLowerCase()}`;
      const seen = seenPerSlot.get(key) ?? 0;
      const repeatsPrev =
        prevName != null && prevName.toLowerCase() === current.name.toLowerCase();

      if (seen < MAX_REPEATS && !repeatsPrev) {
        seenPerSlot.set(key, seen + 1);
        return current;
      }

      const pool = pools[slot] ?? [];
      const usable = pool.filter((p) => {
        const name = String(p.name ?? '').toLowerCase();
        if (!name || name === current.name.toLowerCase()) return false;
        if (prevName && prevName.toLowerCase() === name) return false;
        return (seenPerSlot.get(`${slot}:${name}`) ?? 0) < MAX_REPEATS + 1;
      });

      if (usable.length === 0) {
        seenPerSlot.set(key, seen + 1);
        return current;
      }

      // Выбор замены зависит от слота, названия и позиции — разные слоты
      // получают разные блюда, а не одно и то же «первое из списка».
      const alt = usable[hashOf(`${slot}:${current.name}:${salt}:${usable.length}`) % usable.length];
      const snap = this.snapshotFromProduct(alt, slot);
      const altKey = `${slot}:${String(alt.name).toLowerCase()}`;
      seenPerSlot.set(altKey, (seenPerSlot.get(altKey) ?? 0) + 1);
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
          pickAlt('snack', s, exIdx === 0 ? prev?.extraSnacks?.[0]?.name : undefined, exIdx + 1),
        ) as MealSlotSnapshot[],
      };
      out.push(next);
    }
    return out;
  }

  /**
   * Выбирает блюдо из пула под бюджет слота.
   *
   * Раньше индекс вычислялся как `|(dayIndex*31 + slotSalt*17) % top.length|` —
   * чистая функция без случайности. Из-за этого повторная генерация плана
   * в тот же день возвращала ИДЕНТИЧНЫЙ результат: кнопка «Сгенерировать заново»
   * ничего не меняла.
   *
   * Теперь в формулу входит `seed`. При обычной генерации он берётся от времени
   * (каждый запрос даёт новый вариант), а при явной передаче — воспроизводим,
   * что нужно для тестов.
   */
  private pickFromPool(
    pool: Product[],
    budget: number,
    dayIndex: number,
    slotSalt: number,
    usedIds: Set<string>,
    pref: PreferenceContext,
    seed = 0,
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

    // Индекс выбирается хешированием, а не линейной формулой.
    //
    // Прежняя формула `(dayIndex * 31 + slotSalt * 17 + seed) % top.length`
    // линейна по дню, поэтому при фиксированном размере топа давала
    // короткий цикл: дни повторялись с периодом 48/НОД(31,48) = 48,
    // а на практике — каждые 3 дня из-за пересортировки по калориям.
    // Смешивание «прогоняет» индекс по всему диапазону без циклов.
    const key = `${seed}:${dayIndex}:${slotSalt}:${top.length}`;
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % top.length;

    const chosen = top[idx]?.p ?? pool[dayIndex % pool.length];
    usedIds.add(chosen.id);
    return chosen;
  }

  /** Детерминированный хеш строки — для воспроизводимого seed. */
  private hashSeed(value: string): number {
    let h = 2166136261;
    for (let i = 0; i < value.length; i++) {
      h ^= value.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h);
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

  /**
   * Поиск по каталогу для автокомплита «любимые / нежелательные».
   *
   * Пользователь набирает текст, а мы ищем совпадения сразу в двух наборах:
   *   - ингредиенты (`ingredients`, 1892 записи) — «гречка», «куриная грудка»;
   *   - блюда (`products`, 671 запись) — «борщ», «овсянка».
   *
   * Раньше любимые и нежелательные продукты вводились СВОБОДНЫМ ТЕКСТОМ через
   * запятую. Пользователь писал «курица», а в каталоге было «Куриная грудка»,
   * поэтому предпочтение не срабатывало: планировщик искал подстроку и
   * ничего не находил. Теперь значения выбираются из реальных записей БД.
   *
   * Возвращаются короткие карточки: тип, название, категория — достаточно
   * для выпадающего списка.
   */
  async searchCatalogForPreferences(
    term: string,
    opts?: { limit?: number },
  ): Promise<Array<{ type: 'ingredient' | 'dish'; name: string; category?: string | null }>> {
    const q = String(term ?? '').trim();
    // С одной буквы поиск даёт слишком много совпадений и не помогает.
    if (q.length < 2) return [];

    const limit = Math.min(30, Math.max(1, Number(opts?.limit) || 12));

    const [ingredients, dishes] = await Promise.all([
      this.ingredientModel.findAll({
        where: { name: { [Op.iLike]: `%${q}%` } },
        order: [['name', 'ASC']],
        limit,
        attributes: ['name', 'category'],
      }),
      this.productModel.findAll({
        where: { name: { [Op.iLike]: `%${q}%` } },
        order: [['name', 'ASC']],
        limit,
        attributes: ['name', 'category'],
      }),
    ]);

    const seen = new Set<string>();
    const out: Array<{ type: 'ingredient' | 'dish'; name: string; category?: string | null }> = [];

    // Ингредиенты идут первыми: для предпочтений «гречка» полезнее,
    // чем конкретное блюдо «Гречка с курицей».
    for (const row of ingredients) {
      const name = String(row.name ?? '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'ingredient', name, category: row.category ?? null });
      if (out.length >= limit) break;
    }

    for (const row of dishes) {
      if (out.length >= limit) break;
      const name = String(row.name ?? '').trim();
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      out.push({ type: 'dish', name, category: row.category ?? null });
    }

    return out;
  }

  async listDishes(params: {
    category?: MealSlotKey;
    search?: string;
    excludeAllergens?: string;
    userId?: string;
  }) {
    const { category, search, excludeAllergens, userId } = params;
    // Показываем только опубликованные блюда: отбракованные (испорченный
    // состав) не должны попадать в каталог и в планы.
    const categoryWhere = {
      category: { [Op.in]: ['breakfast', 'lunch', 'dinner', 'snack'] },
      isPublished: { [Op.ne]: false },
    };
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

    // Несовершеннолетним не показываем алкогольные блюда в каталоге —
    // так же, как их не получает планировщик.
    let visible = rows;
    if (userId) {
      const owner = await this.userModel.findByPk(this.uid(userId), {
        attributes: ['birthDate'],
      });
      const age = this.ageFromBirthDate(owner?.birthDate);
      if (age !== null && age < 18) {
        visible = rows.filter((p) => p.containsAlcohol !== true);
      }
    }
    const rowsFiltered = visible;
    const scoped = category
      ? rowsFiltered.filter((p) =>
          dishStoredOrInferredMatchesSlot(
            String(p.category ?? ''),
            String(p.name ?? ''),
            category as MealSlotKeyInfer,
          ),
        )
      : rowsFiltered;

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
      /**
       * Зерно выбора блюд. Если не задано — берётся от текущего времени,
       * поэтому повторная генерация даёт ДРУГОЙ план. Явное значение
       * обеспечивает воспроизводимость (используется в тестах).
       */
      seed?: number;
    },
  ) {
    const user = await this.loadPlanningUser(userId);
    if (!user) throw new NotFoundException('User not found');
    const pref = await this.preferenceContext(userId, user);
    const safeGoal = normalizeGoalByWeight(user.goal, user.weight, user.height);

    // Зерно выбора блюд: явное (для тестов) либо от времени — чтобы повторная
    // генерация давала новый вариант, а не тот же самый план.
    const seed =
      Number.isFinite(Number(opts?.seed)) && Number(opts?.seed) !== 0
        ? Math.abs(Math.trunc(Number(opts?.seed)))
        : Math.abs(Math.trunc(Date.now() + Math.random() * 1_000_000));

    // Цель по калориям при отсутствии явного значения.
    //
    // Раньше использовалась грубая таблица {lose:1800, maintain:2200, gain:2600},
    // одинаковая для всех: пол, возраст, рост, вес и уровень активности
    // не учитывались вовсе. Теперь считаем реальную норму (Миффлин–Сан Жеор
    // с коэффициентом активности) — это и есть настоящая персонализация.
    const energyForGoal = calculateEnergy({
      weightKg: Number(user.weight),
      heightCm: Number(user.height),
      birthDate: user.birthDate,
      gender: user.gender,
      activityLevel: user.activityLevel,
      goal: safeGoal,
    });
    const defaultCal = energyForGoal.dailyCalories;

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
      pref,
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
    // Алкоголь исключается из фолбэк-пулов безусловно: использовать его как
    // «последний вариант» нельзя ни в основных слотах, ни в перекусах.
    const stripAlc = (list: Product[]) => list.filter((p) => !productLooksLikeAlcoholicSnack(p));
    const fallbackMainPool = stripAlc(allFiltered);
    const fallbackSnackPool = stripAlc(fallbackAnyPool);

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

    // Набор использованных блюд общий для ВСЕГО плана.
    //
    // Раньше он создавался внутри цикла по дням, поэтому «занятые» блюда
    // забывались при переходе к следующему дню, и один и тот же обед
    // выбирался снова. В плане на неделю повторялся цикл из 3 дней
    // («Кошари» на обед 6 раз из 7).
    const used = new Set<string>();

    const days: SaveMealPlanDayDto[] = Array.from({ length: durationDays }).map((_, index) => {
      const tc = targetForDay(index);

      const tol = mode === 'precise' ? preciseTol : approxTol;

      /**
       * Подбор блюда для слота с осмысленным фолбэком.
       *
       * Раньше при пустом пуле (например, `lunch` — 0 блюд в каталоге)
       * бралось любое блюдо из всех категорий, поэтому обедом мог стать
       * десерт или закуска. Теперь сначала пытаемся взять блюдо, чьё НАЗВАНИЕ
       * соответствует слоту, и только в крайнем случае — общий пул.
       */
      // Смещение на каждый день, чтобы разные дни получали разные блюда.
      const daySeed = (seed + index * 7919) % 2_000_000_000;

      const pickWithFallback = (
        slotPool: Product[],
        budget: number,
        slotSalt: number,
        slot: MealSlotKey,
      ): Product | null => {
        const primary = this.pickFromPool(slotPool, budget, index, slotSalt, used, pref, daySeed);
        if (primary) return primary;

        const base = slot === 'snack' ? fallbackSnackPool : fallbackMainPool;
        const nameMatched = base.filter(
          (p) => inferMealSlotFromDishName(String(p.name ?? '')) === slot,
        );
        const pool = nameMatched.length > 0 ? nameMatched : base;
        return this.pickFromPool(pool, budget, index, slotSalt + 50, used, pref, daySeed);
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

      // Если блюдо не подобрано, повторяем существующее из пула,
      // а не подставляем выдуманную запись.
      const fallbackDish = (cat: MealSlotKey, seed: number): Product | null =>
        this.pickReusableDish(cat, pools, fallbackAnyPool, index + seed);

      const pick = (cat: MealSlotKey, chosen: Product | null, seed: number) =>
        chosen ?? fallbackDish(cat, seed);

      b = pick('breakfast', b, 1);
      l = pick('lunch', l, 2);
      d = pick('dinner', d, 3);
      s1 = pick('snack', s1, 4);
      s2 = pick('snack', s2, 5);

      // Заглушка остаётся только на случай полностью пустого каталога.
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
    const daysFinalRaw = await this.finalizeGeneratedPlanDays(daysScaled, user, pref, pools);

    // Финальное масштабирование: `finalizeGeneratedPlanDays` подменяет слоты
    // (например, под любимые продукты или убирает алкоголь), из-за чего
    // калорийность дня снова уходит от цели. Раньше это приводило к тому,
    // что 36 из 472 дней выходили за пределы ±10 % (максимум +82 %).
    //
    // Точность повышена до ±5 %: проверка показала, что при допуске 10 %
    // день мог оказаться на границе (11.2 %), так как после масштабирования
    // калорийность ещё немного меняется при округлении и добавлении перекусов.
    const daysFinal = daysFinalRaw.map((d, idx) =>
      this.scaleDaySnapshotsToTarget(d, targetForDay(idx), CALORIE_TARGET_STRICT_TOLERANCE),
    );
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

  /**
   * Сохранение плана питания.
   *
   * ВАЖНО: архивация предыдущего плана, создание нового и запись дней выполняются
   * в ОДНОЙ транзакции. Раньше это были три независимых запроса: при сбое
   * `bulkCreate` пользователь оставался с активным планом без единого дня,
   * а прежний план уже был помечен `completed`. Кроме того, два параллельных
   * вызова могли создать два активных плана одновременно.
   */
  async saveUserPlan(
    userId: string,
    dto: {
      durationDays: number;
      targetCalories: number;
      days: SaveMealPlanDayDto[];
      name?: string;
    },
  ) {
    const user = await this.loadPlanningUser(userId);
    if (!user) throw new NotFoundException('User not found');

    // Валидация входа: без неё `days` мог быть не-массивом, а durationDays —
    // undefined, что давало Invalid Date и 500 вместо понятной ошибки.
    const durationDays = Number(dto.durationDays);
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_PLAN_DAYS) {
      throw new BadRequestException(`Длительность плана должна быть от 1 до ${MAX_PLAN_DAYS} дней`);
    }
    if (!Array.isArray(dto.days) || dto.days.length === 0) {
      throw new BadRequestException('План должен содержать хотя бы один день');
    }
    if (dto.days.length !== durationDays) {
      throw new BadRequestException(
        `Количество дней (${dto.days.length}) не совпадает с длительностью плана (${durationDays})`,
      );
    }
    const dayNumbers = new Set<number>();
    for (const d of dto.days) {
      const n = Number(d.dayNumber);
      if (!Number.isInteger(n) || n < 1 || n > durationDays) {
        throw new BadRequestException(`Некорректный номер дня: ${d.dayNumber}`);
      }
      if (dayNumbers.has(n)) {
        throw new BadRequestException(`День ${n} повторяется в плане`);
      }
      dayNumbers.add(n);
    }
    const targetCalories = Number(dto.targetCalories);
    if (!Number.isFinite(targetCalories) || targetCalories <= 0) {
      throw new BadRequestException('Некорректная целевая калорийность');
    }

    await this.assertNoAlcoholicSnapshotsIfMinor(user, dto.days);

    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + durationDays - 1);

    const totals = this.computePlanTotals(dto.days);
    const defaultName = `План на ${this.formatRuPlanDateTime(startDate)}`;
    const uid = this.uid(userId);

    const planId = await this.mealPlanModel.sequelize!.transaction(async (t) => {
      // Блокируем строки пользователя, чтобы два параллельных запроса
      // не создали два активных плана.
      await this.mealPlanModel.sequelize!.query(
        'SELECT id FROM users WHERE id = :id FOR UPDATE',
        { replacements: { id: uid }, transaction: t },
      );

      // Архивация предыдущих активных планов.
      await this.mealPlanModel.update(
        { status: 'completed' },
        { where: { userId: uid, status: 'active' }, transaction: t },
      );

      const plan = await this.mealPlanModel.create(
        {
          userId: uid,
          startDate,
          endDate,
          durationDays,
          targetCalories,
          status: 'active',
          name: dto.name ?? defaultName,
          totalCalories: totals.calories,
          totalProtein: totals.protein,
          totalFat: totals.fat,
          totalCarbs: totals.carbs,
          // Ограничения фиксируются вместе с планом: позже по ним
          // определим, соответствует ли план текущему профилю.
          restrictionsSnapshot: this.restrictionSnapshot(user),
          restrictionsChanged: false,
        } as never,
        { transaction: t },
      );

      const rows = dto.days.map((d) => {
        const date = new Date(startDate);
        date.setDate(date.getDate() + Number(d.dayNumber) - 1);
        const extra = d.extraSnacks ?? [];
        return {
          mealPlanId: plan.id,
          dayNumber: Number(d.dayNumber),
          date,
          breakfast: d.breakfast,
          lunch: d.lunch,
          dinner: d.dinner,
          // Все перекусы дня хранятся в `snacks` (единое представление).
          // `extraSnacks` заполняем тем же списком без первого элемента
          // для обратной совместимости со старыми записями и фронтендом.
          snacks: [d.snack, ...extra].filter(Boolean) as MealSlotSnapshot[],
          extraSnacks: extra.length ? extra : [],
          mealStatuses: {},
        };
      });

      await this.mealPlanDayModel.bulkCreate(rows as never, { transaction: t });
      return plan.id;
    });

    if (!planId) throw new BadRequestException('Не удалось сохранить план питания');
    return this.getActivePlan(userId);
  }

  getActivePlan(userId: string) {
    // Сортировка по createdAt DESC нужна на случай, если в базе окажется
    // больше одного активного плана (наследие прошлых версий): отдаём свежий.
    return this.mealPlanModel.findOne({
      where: { userId: this.uid(userId), status: 'active' },
      include: [MealPlanDay],
      order: [
        ['createdAt', 'DESC'],
        ['days', 'dayNumber', 'ASC'],
      ],
    });
  }

  /**
   * Список планов пользователя с пагинацией.
   *
   * Раньше отдавались ВСЕ планы разом. У одного пользователя в реальных
   * данных уже 45 планов, и число растёт с каждой генерацией: ответ и таблица
   * в интерфейсе росли неограниченно.
   *
   * По умолчанию возвращается первая страница; общее число планов приходит
   * в поле `count`, чтобы интерфейс мог показать навигацию.
   */
  async listUserPlans(userId: string, opts?: { limit?: number; offset?: number }) {
    const limit = Math.min(200, Math.max(1, Number(opts?.limit) || 50));
    const offset = Math.max(0, Number(opts?.offset) || 0);

    return this.mealPlanModel.findAndCountAll({
      where: {
        userId: this.uid(userId),
        status: { [Op.in]: ['active', 'completed'] },
      },
      order: [['updatedAt', 'DESC']],
      limit,
      offset,
      distinct: true,
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

  /** Удаление плана вместе с днями — в одной транзакции, чтобы не осталось «сирот». */
  async deletePlan(userId: string, planId: string) {
    const plan = await this.mealPlanModel.findOne({
      where: { id: planId, userId: this.uid(userId) },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    await this.mealPlanModel.sequelize!.transaction(async (t) => {
      await this.mealPlanDayModel.destroy({ where: { mealPlanId: planId }, transaction: t });
      await this.mealPlanModel.destroy({ where: { id: planId }, transaction: t });
    });
    return { ok: true };
  }

  async clonePlan(userId: string, planId: string, startDateIso?: string) {
    const user = await this.loadPlanningUser(userId);
    if (!user) throw new NotFoundException('User not found');

    const src = await this.getPlanById(userId, planId);
    const days = (src.days ?? []).map((row) => {
      // Читаем ВСЕ перекусы (и snacks, и extra_snacks), иначе при
      // клонировании плана второй перекус терялся.
      const all = snacksFromDb(row.snacks, row.extraSnacks);
      return {
        dayNumber: row.dayNumber,
        breakfast: (row.breakfast as MealSlotSnapshot) ?? null,
        lunch: (row.lunch as MealSlotSnapshot) ?? null,
        dinner: (row.dinner as MealSlotSnapshot) ?? null,
        snack: all[0] ?? null,
        extraSnacks: all.slice(1),
      };
    });

    await this.assertNoAlcoholicSnapshotsIfMinor(user, days);

    const start = startDateIso ? new Date(startDateIso) : new Date();
    const name = this.clonePlanDisplayName(src.name, start);
    const endDate = new Date(start);
    endDate.setDate(endDate.getDate() + src.durationDays - 1);
    const totals = this.computePlanTotals(days);

    // Копия создаётся вместе с днями в одной транзакции: иначе при сбое
    // оставался план-пустышка без дней.
    const newPlanId = await this.mealPlanModel.sequelize!.transaction(async (t) => {
      const plan = await this.mealPlanModel.create(
        {
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
          // Копия плана наследует ограничения источника, но сразу
          // помечается, если они уже разошлись с профилем.
          restrictionsSnapshot: this.restrictionSnapshot(user),
          restrictionsChanged: false,
        } as never,
        { transaction: t },
      );

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
      await this.mealPlanDayModel.bulkCreate(rows as never, { transaction: t });
      return plan.id;
    });

    return this.getPlanById(userId, newPlanId);
  }

  /**
   * Делает план текущим.
   *
   * Если план построен по другим ограничениям (пользователь изменил
   * аллергии, диету или нежелательные продукты), активация не выполняется
   * без явного подтверждения: в плане могли остаться неподходящие блюда.
   * Интерфейс получает `requiresConfirmation` и список различий, после
   * чего пользователь выбирает — пересоздать план или всё же включить.
   */
  async activatePlan(userId: string, planId: string, opts?: { force?: boolean }) {
    const plan = await this.mealPlanModel.findOne({
      where: { id: planId, userId: this.uid(userId) },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const user = await this.loadPlanningUser(userId);
    if (!user) throw new NotFoundException('User not found');

    const snapshot = (plan.restrictionsSnapshot ?? null) as Record<string, unknown> | null;
    const diffs = this.restrictionDiff(user, snapshot);

    if (diffs.length > 0 && !opts?.force) {
      await plan.update({ restrictionsChanged: true } as never);
      return {
        requiresConfirmation: true,
        changed: diffs,
        planId: String(plan.id),
        message:
          'Этот план создан по старым ограничениям. Рекомендуем пересоздать его — ' +
          'иначе в рационе останутся неподходящие блюда.',
      };
    }

    if (plan.status === 'active' && diffs.length === 0) {
      return this.getPlanById(userId, planId);
    }

    await this.archiveActivePlans(userId);
    await plan.update({
      status: 'active',
      restrictionsChanged: diffs.length > 0,
    } as never);
    return this.getPlanById(userId, planId);
  }

  /**
   * Отличаются ли ограничения плана от текущего профиля.
   * Используется интерфейсом, чтобы показать метку «план устарел».
   */
  async planRestrictionDiff(userId: string, planId: string) {
    const [plan, user] = await Promise.all([
      this.mealPlanModel.findOne({
        where: { id: planId, userId: this.uid(userId) },
        attributes: ['id', 'restrictionsSnapshot'],
      }),
      this.loadPlanningUser(userId),
    ]);
    if (!plan || !user) throw new NotFoundException('Plan not found');

    const changed = this.restrictionDiff(
      user,
      (plan.restrictionsSnapshot ?? null) as Record<string, unknown> | null,
    );
    return { changed, upToDate: changed.length === 0 };
  }

  async planDownloadPayload(userId: string, planId: string) {
    const plan = await this.getPlanById(userId, planId);
    const rows = (plan.days ?? []) as unknown as Array<{
      dayNumber: number;
      date: Date;
      breakfast: unknown;
      lunch: unknown;
      dinner: unknown;
      snacks: unknown;
      extraSnacks: unknown;
    }>;
    const days = rows.map((row) => ({
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
      // Итоги считаем по фактическим дням, а не берём из колонок: они
      // денормализованы и расходились с содержимым (до 5568 ккал).
      totals: this.computeTotalsFromDbDays(rows),
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

    // Возраст нужен отдельно — уходит в промпт ИИ.
    const age = resolveAge(user.birthDate);

    // Единый расчёт калорий (src/common/energy.util.ts): формула Миффлина–Сан Жеора
    // с реальным коэффициентом активности. Раньше здесь был захардкожен ×1.5,
    // из-за чего для «сидячего» пользователя норма завышалась на ~25 %.
    const calories = resolveTargetCalories(
      {
        weightKg: Number(user.weight),
        heightCm: Number(user.height),
        birthDate: user.birthDate,
        gender: user.gender,
        activityLevel: user.activityLevel,
        goal: user.goal,
      },
      Number(body.targetCalories),
      user.targetCalories,
    );

    // Каталог для AI-плана.
    //
    // Раньше брались первые 400 блюд по алфавиту: в выборку не попадали
    // 13 завтраков, 7 ужинов, 183 обеда и 66 перекусов — модель физически
    // не могла их использовать, а для узкой диеты пул нужной категории
    // мог оказаться пустым.
    //
    // Теперь выборка сбалансирована по категориям: берём до AI_CATALOG_PER_SLOT
    // блюд каждого слота, равномерно распределённых по калорийности
    // (функция stridedPoolSample уже используется в других ветках).
    const perSlot = Number(process.env.AI_CATALOG_PER_SLOT ?? 150) || 150;
    // Для AI берём ТОЛЬКО проверенный каталог (isFromApi = true).
    //
    // Пользовательские продукты проходят модерацию и попадают в общий
    // список, но их названия и состав не выверены: в план попадали записи
    // вида «Тест модерации t6». Для генерации такие блюда непригодны.
    const byCategory = await Promise.all(
      (['breakfast', 'lunch', 'dinner', 'snack'] as const).map((cat) =>
        this.productModel.findAll({
          where: { category: cat, isPublished: { [Op.ne]: false }, isFromApi: true },
          order: [
            ['calories', 'ASC'],
            ['id', 'ASC'],
          ],
        }),
      ),
    );
    const products = byCategory.flatMap((list) =>
      this.stridedPoolSample(list as Product[], perSlot),
    );

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
      this.productModel.findAll({ where: { category: 'breakfast', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'lunch', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'dinner', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
      this.productModel.findAll({ where: { category: 'snack', isPublished: { [Op.ne]: false } }, order: [['calories', 'ASC'], ['id', 'ASC']] }),
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
    const calories = resolveTargetCalories(
      {
        weightKg: Number(user.weight),
        heightCm: Number(user.height),
        birthDate: user.birthDate,
        gender: user.gender,
        activityLevel: user.activityLevel,
        goal: user.goal,
      },
      opts?.targetCalories,
      user.targetCalories,
    );

    // Каталог для AI-плана.
    //
    // Раньше брались первые 400 блюд по алфавиту: в выборку не попадали
    // 13 завтраков, 7 ужинов, 183 обеда и 66 перекусов — модель физически
    // не могла их использовать, а для узкой диеты пул нужной категории
    // мог оказаться пустым.
    //
    // Теперь выборка сбалансирована по категориям: берём до AI_CATALOG_PER_SLOT
    // блюд каждого слота, равномерно распределённых по калорийности
    // (функция stridedPoolSample уже используется в других ветках).
    const perSlot = Number(process.env.AI_CATALOG_PER_SLOT ?? 150) || 150;
    // Для AI берём ТОЛЬКО проверенный каталог (isFromApi = true).
    //
    // Пользовательские продукты проходят модерацию и попадают в общий
    // список, но их названия и состав не выверены: в план попадали записи
    // вида «Тест модерации t6». Для генерации такие блюда непригодны.
    const byCategory = await Promise.all(
      (['breakfast', 'lunch', 'dinner', 'snack'] as const).map((cat) =>
        this.productModel.findAll({
          where: { category: cat, isPublished: { [Op.ne]: false }, isFromApi: true },
          order: [
            ['calories', 'ASC'],
            ['id', 'ASC'],
          ],
        }),
      ),
    );
    const products = byCategory.flatMap((list) =>
      this.stridedPoolSample(list as Product[], perSlot),
    );

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

    // Имена блюд, которые модель предложила, но их нет в каталоге.
    const unresolvedNames = new Set<string>();
    const poolsBySlot = {
      breakfast: allowed.filter((p) => p.category === 'breakfast'),
      lunch: allowed.filter((p) => p.category === 'lunch'),
      dinner: allowed.filter((p) => p.category === 'dinner'),
      snack: allowed.filter((p) => p.category === 'snack'),
    };

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

      /**
       * Превращает название от модели в снапшот блюда.
       *
       * Раньше при ненайденном названии создавался снапшот с `calories: 0`
       * и пустым составом, и такой план сохранялся в БД: пользователь получал
       * «блюдо» без калорий и без ингредиентов, а день не добирал норму.
       *
       * Теперь подбираем ближайшее реальное блюдо той же категории, а имя
       * запоминаем для предупреждения.
       */
      const g = (name: string, cat: MealSlotKey): MealSlotSnapshot | null => {
        const pr = resolve(name);
        if (pr) return this.snapshotFromProduct(pr, cat);

        const trimmed = String(name ?? '').trim();
        const pool = poolsBySlot[cat] ?? [];
        if (pool.length === 0) {
          // Каталог пуст для этого слота — вернуть нечего, вызывающий код
          // подставит явную заглушку с корректной калорийностью.
          if (trimmed) unresolvedNames.add(trimmed);
          return null;
        }

        // Ближайшее по калорийности блюдо того же слота.
        const target = Number(calories) * (DEFAULT_DIST[cat] ?? 0.25) || 300;
        const replacement = this.pickClosestByCalories(pool, target, pref);
        if (!replacement) {
          if (trimmed) unresolvedNames.add(trimmed);
          return null;
        }
        if (trimmed) unresolvedNames.add(trimmed);
        const snap = this.snapshotFromProduct(replacement, cat);
        snap.note = `«${trimmed}» нет в каталоге — подобрано близкое блюдо`;
        return snap;
      };

      /**
       * Явная заглушка с ПРАВДОПОДОБНОЙ калорийностью (а не 0).
       * Используется только если пул слота пуст полностью.
       */
      const placeholder = (cat: MealSlotKey): MealSlotSnapshot => {
        const kcal = Math.max(
          120,
          Math.round((Number(calories) || 2000) * (DEFAULT_DIST[cat] ?? 0.25)),
        );
        return {
          name: `Блюдо (${cat})`,
          calories: kcal,
          protein: Math.round((kcal * 0.2) / 4),
          fat: Math.round((kcal * 0.3) / 9),
          carbs: Math.round((kcal * 0.5) / 4),
          allergens: [],
          category: cat,
        };
      };
      const extraRaw = m.snacks ?? [];
      const extraSnacks: MealSlotSnapshot[] = extraRaw
        .map((name) => g(name, 'snack'))
        .filter((s): s is MealSlotSnapshot => Boolean(s));

      return {
        dayNumber: item.day ?? index + 1,
        breakfast: g(m.breakfast, 'breakfast') ?? placeholder('breakfast'),
        lunch: g(m.lunch, 'lunch') ?? placeholder('lunch'),
        dinner: g(m.dinner, 'dinner') ?? placeholder('dinner'),
        snack: g(m.snack, 'snack') ?? placeholder('snack'),
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

    // Сообщаем, если модель предложила блюда, которых нет в каталоге:
    // раньше такие позиции сохранялись с 0 ккал и без состава.
    const aiWarnings = [...enforced.warnings];
    if (unresolvedNames.size > 0) {
      const sample = [...unresolvedNames].slice(0, 3).join(', ');
      aiWarnings.push(
        `AI предложил ${unresolvedNames.size} блюд(о), которых нет в каталоге (${sample}` +
          `${unresolvedNames.size > 3 ? ' и др.' : ''}) — вместо них подобраны близкие по калорийности.`,
      );
    }

    await this.saveUserPlan(userId, {
      durationDays,
      targetCalories: calories,
      days: enforced.days,
      name: `AI (каталог) ${this.formatRuPlanDateTime(new Date())}`,
    });
    const planCat = await this.getActivePlan(userId);
    return { ...(planCat?.get({ plain: true }) ?? {}), warnings: aiWarnings };
  }
}
