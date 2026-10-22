import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { randomUUID } from 'crypto';
import { Op } from 'sequelize';
import { Allergen } from '../models/Allergen';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import type { ProductIngredient, ProductIngredientDetailed } from '../models/Product';
import { Product } from '../models/Product';
import { Ingredient } from '../models/Ingredient';
import { NotificationsService } from '../notifications/notifications.service';
import { User } from '../models/User';
import { OpenAiService } from '../openai/openai.service';
import { containsDietKey, productHasUserAllergen } from '../meal-plan/dietary-rules';
import { validateAndNormalizePhoto } from '../common/image-validation.util';
import { ALLERGEN_INGREDIENTS } from '../meal-plan/slovari';
import { normalizeRuFoodText, resolveCatalogProductByName } from '../common/ingredient-name-match';
import {
  normalizeAllergensExpanding,
  normalizeCatalogAllergenToken,
  normalizeCatalogDietaryTagList,
} from '../meal-plan/catalog-ai-normalize';
import { OPENROUTER_MISSING_KEY_MESSAGE } from '../config/openrouter';
import { normalizeIngredientName } from './ingredient-names.util';

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
    @InjectModel(Ingredient) private readonly ingredientModel: typeof Ingredient,
    private readonly notifications: NotificationsService,
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

    // Расширяющая нормализация: неизвестные аллергены сохраняем,
    // чтобы не потерять потенциально опасное вещество.
    const allergensFound = normalizeAllergensExpanding(item.allergensFound ?? []).all.slice(0, 24);
    const dietaryTags = normalizeCatalogDietaryTagList(item.dietaryTags ?? []).slice(0, 24);

    let ingredients: ProductIngredient[] = Array.isArray(item.ingredients)
      ? item.ingredients
          .slice(0, 40)
          .map((x) => ({
            // Название переводим на русский: модель иногда отвечает
            // английскими словами, и они попадают в состав блюда.
            name: normalizeIngredientName(String(x?.name ?? '').trim()).slice(0, 160),
            grams: Math.min(50000, Math.max(0, Number(x?.grams ?? 0))),
          }))
          .filter((x) => x.name)
      : [];

    let ingredientsDetailed: ProductIngredientDetailed[] = Array.isArray(item.ingredientsDetailed)
      ? item.ingredientsDetailed
          .slice(0, 40)
          .map((row, j) => {
            const name = normalizeIngredientName(String(row?.name ?? '').trim()).slice(0, 160);
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

  /**
   * Сопоставляет аллерген из профиля пользователя с обнаруженным в блюде.
   *
   * Раньше сравнение было чисто подстрочным (`includes`), поэтому:
   *   - «майонез» (обнаружено) НЕ совпадал с «яйца» (профиль) → ложная безопасность;
   *   - «рис» совпадал с «ирис», «соя» — с «соевый соус» (ложные тревоги).
   *
   * Теперь сначала пробуем привести обнаруженное значение к справочнику
   * (через словарь синонимов и корней ингредиентов), а затем сравниваем
   * уже нормализованные категории. Остаток — сопоставление по границам слов.
   */
  private userMatchesDetected(userName: string, detected: string): boolean {
    const u = normalizeRuFoodText(userName);
    const d = normalizeRuFoodText(detected);
    if (!u || !d) return false;

    // 1. Точное совпадение категорий справочника.
    const normUser = normalizeCatalogAllergenToken(u) ?? normalizeCatalogAllergenToken(d);
    const normDetected = normalizeCatalogAllergenToken(d);
    if (normDetected && normUser && normDetected === normUser) return true;

    // 2. Обнаруженное значение — ингредиент, который относится к аллергену
    //    из профиля («майонез» → яйца, «сельдь» → рыба).
    const target = normUser ?? normalizeCatalogAllergenToken(u);
    if (target) {
      const roots = ALLERGEN_INGREDIENTS[target] ?? [];
      if (roots.some((root) => containsDietKey(d, root))) return true;
    }

    // 3. Совпадение по границам слов (без ложных подстрок).
    if (d === u) return true;
    if (containsDietKey(d, u) || containsDietKey(u, d)) return true;

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

  /**
   * Сопоставляет ингредиенты, распознанные моделью, со справочником `ingredients`.
   *
   * Раньше ингредиенты сохранялись как свободный текст: ни нормализации,
   * ни привязки к каталогу. Пользователь видел «лук репчатый» без связи
   * с ингредиентом, а админ при подтверждении создавал дубли в справочнике.
   *
   * Теперь каждому ингредиенту подбирается запись справочника
   * (через общий резолвер `resolveCatalogProductByName`), а неуверенные
   * совпадения помечаются отдельно — их можно предложить создать.
   */
  private async matchIngredientsToCatalog(
    items: FoodRecognitionItemDto[],
  ): Promise<{ matched: number; unmatched: string[] }> {
    const names = new Set<string>();
    for (const item of items) {
      for (const ing of item.ingredientsDetailed ?? []) {
        const n = String(ing?.name ?? '').trim();
        if (n) names.add(n);
      }
      for (const ing of item.ingredients ?? []) {
        const n = String(ing?.name ?? '').trim();
        if (n) names.add(n);
      }
    }
    if (names.size === 0) return { matched: 0, unmatched: [] };

    // Ограничиваем выборку: справочник небольшой, но лимит защищает от роста.
    const catalog = await this.ingredientModel.findAll({ limit: 5000 });
    const candidates = catalog.map((row) => ({
      id: String(row.id),
      name: String(row.name),
    }));

    const matchedByName = new Map<string, { id: string; name: string }>();
    const unmatched: string[] = [];

    for (const name of names) {
      const hit = resolveCatalogProductByName(name, candidates);
      if (hit) matchedByName.set(name, hit);
      else unmatched.push(name);
    }

    // Проставляем ingredientId в самих элементах.
    for (const item of items) {
      const enrich = <T extends { name: string; ingredientId?: string }>(row: T): T => {
        const hit = matchedByName.get(String(row.name ?? '').trim());
        return hit ? { ...row, ingredientId: hit.id } : row;
      };
      if (Array.isArray(item.ingredientsDetailed)) {
        item.ingredientsDetailed = item.ingredientsDetailed.map(enrich);
      }
      if (Array.isArray(item.ingredients)) {
        // У простого списка поле не предусмотрено типом — приводим безопасно.
        item.ingredients = item.ingredients as typeof item.ingredients;
      }
    }

    return { matched: matchedByName.size, unmatched };
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

    // Проверяем и нормализуем изображение: формат по magic bytes, размер,
    // уменьшение до 1600 px и перекодирование в JPEG. Раньше в OpenAI уходила
    // произвольная строка, а в БД могло попасть до 35 МБ base64.
    const photo = await validateAndNormalizePhoto(photoUrl, 'photoUrl');

    let confidence: number;
    let detectedItems: FoodRecognitionItemDto[];

    try {
      const ai = await this.openAiService.recognizeFoodFromPhoto(photo.dataUrl);
      if (!ai) {
        throw new ServiceUnavailableException(
          OPENROUTER_MISSING_KEY_MESSAGE,
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
      if (e instanceof ServiceUnavailableException || e instanceof BadRequestException) throw e;
      throw new ServiceUnavailableException(
        'Не удалось распознать блюдо по фото. Проверьте ключ OpenAI и повторите попытку.',
      );
    }

    if (detectedItems.length === 0) {
      throw new BadRequestException('На фотографии не удалось распознать блюда. Попробуйте другой снимок.');
    }

    // Сопоставляем распознанные ингредиенты со справочником.
    const ingredientMatch = await this.matchIngredientsToCatalog(detectedItems);

    const { allergenWarnings, hasAllergenMatchInProfile, hasDetectedAllergensInDish } =
      await this.buildAllergenWarnings(uid, detectedItems);

    const model = this.openAiService.getModelLabel();

    return {
      confidence,
      items: detectedItems,
      allergenWarnings,
      hasAllergenMatchInProfile,
      hasDetectedAllergensInDish,
      // Диагностика сопоставления: сколько ингредиентов нашли в справочнике.
      ingredientMatch: {
        matched: ingredientMatch.matched,
        unmatched: ingredientMatch.unmatched.slice(0, 20),
      },
      provider: `OpenAI (${model})`,
    };
  }

  async submitMealForModeration(
    userId: string,
    photoUrlRaw: string,
    confidence: number,
    items: FoodRecognitionItemDto[],
  ) {
    const uid = Number(userId);

    // То же, что и при распознавании: проверяем и нормализуем фото,
    // чтобы в БД не попадал «сырой» base64 произвольного размера.
    const photo = await validateAndNormalizePhoto(photoUrlRaw, 'photoUrl');

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
      // Храним нормализованное изображение (JPEG, до 1600 px).
      photoUrl: photo.dataUrl,
      recognizedAt: new Date(),
      confidence: c,
      status: 'pending',
    } as Meal);

    await this.mealItemModel.bulkCreate(
      sanitized.map((item) => ({ mealId: meal.id, ...item })) as MealItem[],
    );

    // Сохраняем предупреждения об аллергенах, привязав их к записи приёма пищи.
    const { allergenWarnings } = await this.buildAllergenWarnings(uid, sanitized);
    for (const item of sanitized) {
      const forItem = allergenWarnings.filter((w) => w.includes(item.foodName));
      if (forItem.length === 0) continue;
      await this.notifications.saveAllergenWarnings(uid, forItem, item.foodName, meal.id);
    }

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
      // 1. Аллергены, названные моделью.
      for (const det of item.allergensFound) {
        const w = this.warningIfUserAllergic(allergyNames, det, item.foodName);
        if (w) allergenWarnings.push(w);
      }

      // 2. Аллергены, определённые ПО СОСТАВУ блюда.
      //
      // Раньше этот источник отсутствовал: если модель не указала аллерген
      // в `allergensFound`, но в составе было «Сельдь» или «Майонез»,
      // пользователь НЕ получал предупреждения — ложная безопасность.
      const compositionAllergens = this.detectAllergensFromIngredients(item);
      for (const allergen of compositionAllergens) {
        if (!allergySet.has(allergen)) continue;
        const human = ALLERGEN_LABELS_RU[allergen] ?? allergen;
        allergenWarnings.push(
          `В составе «${item.foodName}» обнаружен аллерген «${human}» — совпадение с вашим профилем.`,
        );
      }

      // 3. Похожее блюдо из каталога (дополнительная подсказка).
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

    // Убираем дубликаты, сохраняя порядок.
    const uniqueWarnings = [...new Set(allergenWarnings)];

    const hasDetectedAllergensInDish =
      detectedItems.some((item) => item.allergensFound.length > 0) ||
      detectedItems.some((item) => this.detectAllergensFromIngredients(item).length > 0);

    return {
      allergenWarnings: uniqueWarnings,
      hasAllergenMatchInProfile: uniqueWarnings.length > 0,
      hasDetectedAllergensInDish,
    };
  }

  /**
   * Определяет аллергены по НАЗВАНИЯМ ингредиентов блюда.
   *
   * Использует словарь `ALLERGEN_INGREDIENTS` (корни слов) и уже проверенную
   * функцию сопоставления с границами слов, поэтому «помидоры» не считается
   * мясом, а «кокос» — орехом.
   *
   * Это ключевая страховка: модель может забыть указать аллерген,
   * но состав блюда остаётся объективным источником.
   */
  private detectAllergensFromIngredients(item: FoodRecognitionItemDto): string[] {
    const names: string[] = [];
    for (const ing of item.ingredientsDetailed ?? []) {
      const n = String(ing?.name ?? '').trim();
      if (n) names.push(n);
    }
    for (const ing of item.ingredients ?? []) {
      const n = String(ing?.name ?? '').trim();
      if (n) names.push(n);
    }
    if (names.length === 0) return [];

    const haystack = names.join(' | ');
    const found = new Set<string>();

    for (const [allergen, roots] of Object.entries(ALLERGEN_INGREDIENTS)) {
      for (const root of roots ?? []) {
        if (containsDietKey(haystack, root)) {
          found.add(normalizeCatalogAllergenToken(allergen) ?? allergen);
          break;
        }
      }
    }

    return [...found];
  }
}

/** Человекочитаемые названия аллергенов для сообщений. */
const ALLERGEN_LABELS_RU: Record<string, string> = {
  лактоза: 'молоко (лактоза)',
  глютен: 'глютен',
  арахис: 'арахис',
  орехи: 'орехи',
  морепродукты: 'морепродукты',
  яйца: 'яйца',
  соя: 'соя',
  рыба: 'рыба',
  кунжут: 'кунжут',
  горчица: 'горчица',
  сельдерей: 'сельдерей',
};
