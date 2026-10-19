import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  closestCenter,
  DndContext,
  PointerSensor,
  type DragEndEvent,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { AlertTriangle, Brain, ChefHat, ClipboardList, Loader2, Lock, ShoppingBasket } from '../components/icons';
import html2pdf from 'html2pdf.js';
import { isAxiosError } from 'axios';
import {
  mealPlanApi,
  type CatalogDish,
  type MealIngredient,
  type MealIngredientDetailed,
  type MealPlanDayPayload,
  type MealSlotSnapshot,
  type SavedMealPlan,
  userApi,
} from '../api/services';
import { useAuth } from '../context/AuthContext';
import {
  isIngredientMatch,
  RU_ONION_WORD_RE,
  RU_PEPPER_WORD_RE,
  ruHaystackMatchesKeyword,
} from '../utils/ingredient-name-match';
import { dishMatchesPlanSlot } from '../utils/dish-category-infer';
import { ALLERGEN_HINTS_RU, DIET_HINTS_RU } from '../constants/nutrition-hints';
import { MINOR_ALCOHOL_BLOCK_MSG, mealLooksLikeAlcoholic } from '../utils/alcohol-dish';
import { computeAgeFromBirthDate } from '../utils/age';
import { formatApiError, getApiErrorInfo } from '../api/errors';
import { DishThumb } from '../components/DishThumb';
import { CalorieValue, MacroRow, round1 } from '../components/MacroRow';

type Mode = 'basic' | 'ai' | 'constructor';
type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'snack2';
type MealItem = {
  id: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergens: string[];
  category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  ingredients?: MealIngredient[];
  ingredientsDetailed?: MealIngredientDetailed[];
  imageUrl?: string | null;
  blockedByAllergen?: boolean;
  dietWarnings?: string[];
  note?: string;
  alternatives?: string[];
  matchKeywords?: string[];
  sourceMealId?: string | null;
  description?: string | null;
  cuisine?: string | null;
};
type MealTrackStatus = 'done' | 'skipped';
type UserProduct = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  ingredientId?: string | null;
  expiresAt?: string | null;
};

// Максимум 30 дней — согласовано с MAX_PLAN_DAYS на бэкенде.
const DURATIONS = [1, 7, 14, 30] as const;

function durationChipLabel(days: number): string {
  if (days === 1) return '1 день';
  if (days === 7) return '1 нед.';
  if (days === 14) return '2 нед.';
  if (days === 30) return '1 мес.';
  return '1 мес.';
}

const MAIN_SLOTS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack', 'snack2'];

function constructorRefineSlotLabel(slot: string): string {
  switch (slot) {
    case 'breakfast':
      return 'Завтрак';
    case 'lunch':
      return 'Обед';
    case 'dinner':
      return 'Ужин';
    case 'snack':
      return 'Перекус 1';
    case 'snack2':
      return 'Перекус 2';
    default:
      return slot;
  }
}

function constructorRefineActionLabel(action: string): string {
  if (action === 'keep') return 'оставлено';
  if (action === 'fill') return 'добавлено';
  if (action === 'replace') return 'замена';
  return action;
}

function catalogSlotMatchesDish(dish: MealItem, slot: MealSlot): boolean {
  return slot === 'snack2' ? dish.category === 'snack' : dish.category === slot;
}

const DIET_LABELS: Record<string, string> = {
  vegetarian: 'Вегетарианство',
  vegan: 'Веган',
  'lactose-free': 'Безлактозная',
  'gluten-free': 'Безглютеновая',
  keto: 'Кето',
  paleo: 'Палео',
  'low-carb': 'Низкоуглеводная',
  'high-protein': 'Высокобелковая',
};

const DIET_NAME_HITS = {
  meatFish: [
    'куриц',
    'кури',
    'курин',
    'индейк',
    'индюш',
    'утк',
    'утин',
    'утятин',
    'говядин',
    'свинин',
    'баранин',
    'барань',
    'козлят',
    'козл',
    'оленин',
    'конин',
    'курятин',
    'мяс',
    'котлет',
    'фарш',
    'бекон',
    'колбас',
    'сосиск',
    'шашлык',
    'стейк',
    'конфи',
    'рыб',
    'лосос',
    'треск',
    'минтай',
    'кревет',
    'кальмар',
    'мидии',
    'краб',
    'икра',
    'гребеш',
    'мидий',
  ],
  dairy: ['молок', 'сыр', 'творог', 'йогурт', 'кефир', 'сливк', 'сметан', 'лактоз'],
  eggs: ['яйц', 'омлет', 'яичн', 'скрэмбл', 'пашот'],
  gluten: ['пшен', 'рожь', 'ячмен', 'овсян', 'мука', 'глютен', 'хлеб', 'булк', 'лапша', 'макарон'],
  paleoExtra: ['фасол', 'чечевиц', 'нут', 'горох', 'соя', 'тофу', 'бобов'],
};

function mealDetailedTextBlob(meal: MealItem): string {
  const detailed = (meal.ingredientsDetailed ?? []).map((x) => String(x.name ?? '').trim()).filter(Boolean);
  const simple = (meal.ingredients ?? []).map((x) => String(x.name ?? '').trim()).filter(Boolean);
  const allergens = (meal.allergens ?? []).map((a) => String(a ?? '').trim()).filter(Boolean);
  const blob = [...detailed, ...simple, ...allergens].join(' ').toLowerCase();
  const title = String(meal.name ?? '').toLowerCase();
  return `${blob} ${title}`.trim();
}

function mealHasDietCheckSources(meal: MealItem): boolean {
  return (
    (meal.ingredientsDetailed?.length ?? 0) > 0 ||
    (meal.ingredients?.length ?? 0) > 0 ||
    (meal.allergens?.length ?? 0) > 0 ||
    String(meal.name ?? '').trim().length > 0
  );
}

function hasDetailedDislike(meal: MealItem, dislikes: string[]): boolean {
  const blob = mealDetailedTextBlob(meal);
  if (!blob) return dislikes.length > 0;
  return dislikes.some((d) => d && blob.includes(d));
}

function mealIngredientsForView(meal: MealItem): string[] {
  if (Array.isArray(meal.ingredientsDetailed) && meal.ingredientsDetailed.length > 0) {
    return meal.ingredientsDetailed.map((x) => {
      const n = String(x?.name ?? '').trim();
      const grams = Number(x?.grams) || 0;
      if (!n) return '';
      if (grams > 0) return `${n} - ${Math.round(grams)} г`;
      const amount = Number(x?.amount) || 0;
      const unit = String(x?.unit ?? '').trim();
      if (amount > 0 && unit) return `${n} - ${amount} ${unit}`;
      return n;
    });
  }
  if (Array.isArray(meal.ingredients) && meal.ingredients.length > 0) {
    return meal.ingredients.map((x) => {
      const n = String(x?.name ?? '').trim();
      const grams = Number(x?.grams) || 0;
      if (!n) return '';
      return grams > 0 ? `${n} - ${Math.round(grams)} г` : n;
    });
  }
  return [];
}

function hasAnyToken(text: string, tokens: string[]): boolean {
  return tokens.some((t) => text.includes(t));
}

function getDietWarningsForMeal(meal: MealItem, restrictions: string[]): string[] {
  if (!restrictions.length) return [];
  if (!mealHasDietCheckSources(meal)) {
    return ['Нет данных о составе для проверки диеты'];
  }
  const text = mealDetailedTextBlob(meal);
  const out: string[] = [];
  for (const key of restrictions) {
    if (key === 'vegetarian' && hasAnyToken(text, DIET_NAME_HITS.meatFish)) out.push(DIET_LABELS[key] ?? key);
    if (
      key === 'vegan' &&
      (hasAnyToken(text, DIET_NAME_HITS.meatFish) ||
        hasAnyToken(text, DIET_NAME_HITS.dairy) ||
        hasAnyToken(text, DIET_NAME_HITS.eggs))
    ) {
      out.push(DIET_LABELS[key] ?? key);
    }
    if (key === 'lactose-free' && hasAnyToken(text, DIET_NAME_HITS.dairy)) out.push(DIET_LABELS[key] ?? key);
    if (key === 'gluten-free' && hasAnyToken(text, DIET_NAME_HITS.gluten)) out.push(DIET_LABELS[key] ?? key);
    if (
      key === 'paleo' &&
      (hasAnyToken(text, DIET_NAME_HITS.gluten) ||
        hasAnyToken(text, DIET_NAME_HITS.paleoExtra) ||
        hasAnyToken(text, DIET_NAME_HITS.dairy))
    ) {
      out.push(DIET_LABELS[key] ?? key);
    }
    if (key === 'keto' && meal.carbs > 22) out.push(DIET_LABELS[key] ?? key);
    if (key === 'low-carb' && meal.carbs > 35) out.push(DIET_LABELS[key] ?? key);
    if (key === 'high-protein' && (meal.protein < 20 || meal.protein / Math.max(1, meal.calories) < 0.15)) {
      out.push(DIET_LABELS[key] ?? key);
    }
  }
  return out;
}

type MealConstraintFlags = {
  allergen: boolean;
  diet: boolean;
  dislike: boolean;
  missingDetailed: boolean;
  labels: string[];
};

function isHighProtein(m: MealItem) {
  const cal = Math.max(1, m.calories);
  return m.protein >= 25 || m.protein / cal >= 0.15;
}

function snapshotToMeal(s: MealSlotSnapshot | null | undefined, fallback: MealSlot): MealItem | null {
  if (!s || typeof s !== 'object' || !('name' in s)) return null;
  const cat = (s.category as MealItem['category']) ?? (fallback === 'snack2' ? 'snack' : fallback);
  const name = (s as MealSlotSnapshot).name;
  const rawIng = (s as MealSlotSnapshot).ingredients;
  const rawDetailed = (s as MealSlotSnapshot).ingredientsDetailed;
  let ingredients: MealIngredient[] | undefined;
  let ingredientsDetailed: MealIngredientDetailed[] | undefined;
  if (Array.isArray(rawIng) && rawIng.length > 0) {
    ingredients = rawIng
      .map((row) => ({
        name: String(row?.name ?? '').trim(),
        grams: Number(row?.grams) || 0,
      }))
      .filter((row) => row.name.length > 0);
  }
  if (Array.isArray(rawDetailed) && rawDetailed.length > 0) {
    ingredientsDetailed = rawDetailed
      .map((row) => ({
        id: String(row?.id ?? ''),
        name: String(row?.name ?? '').trim(),
        amount: Number(row?.amount) || 0,
        unit: String(row?.unit ?? '').trim(),
        grams: Number(row?.grams) || 0,
        originalString: row?.originalString ? String(row.originalString) : undefined,
        ingredientId: row?.ingredientId ? String(row.ingredientId) : undefined,
      }))
      .filter((row) => row.id && row.name);
  }
  if (!ingredients?.length) ingredients = inferIngredientsClientFromTitle(name);
  return {
    id: (s as MealSlotSnapshot).dishId ?? `row-${cat}-${(s as MealSlotSnapshot).name}`,
    name,
    calories: Number((s as MealSlotSnapshot).calories ?? 0),
    protein: Number((s as MealSlotSnapshot).protein ?? 0),
    fat: Number((s as MealSlotSnapshot).fat ?? 0),
    carbs: Number((s as MealSlotSnapshot).carbs ?? 0),
    allergens: Array.isArray((s as MealSlotSnapshot).allergens) ? (s as MealSlotSnapshot).allergens : [],
    category: cat,
    ingredients: ingredients.length ? ingredients : undefined,
    ingredientsDetailed: ingredientsDetailed?.length ? ingredientsDetailed : undefined,
    imageUrl: (s as MealSlotSnapshot).imageUrl != null ? String((s as MealSlotSnapshot).imageUrl) : undefined,
    note: (s as MealSlotSnapshot).note,
    alternatives: (s as MealSlotSnapshot).alternatives,
    matchKeywords: Array.isArray((s as MealSlotSnapshot).matchKeywords)
      ? ((s as MealSlotSnapshot).matchKeywords as string[])
      : undefined,
  };
}

function mealToSnapshot(m: MealItem | null): MealSlotSnapshot | null {
  if (!m) return null;
  return {
    dishId: m.id.length > 20 && !m.id.startsWith('row-') ? m.id : undefined,
    name: m.name,
    calories: m.calories,
    protein: m.protein,
    fat: m.fat,
    carbs: m.carbs,
    allergens: m.allergens,
    category: m.category,
    ingredients: m.ingredients?.length ? m.ingredients : undefined,
    ingredientsDetailed: m.ingredientsDetailed?.length ? m.ingredientsDetailed : undefined,
    imageUrl: m.imageUrl ?? undefined,
    note: m.note,
    alternatives: m.alternatives,
    matchKeywords: m.matchKeywords?.length ? m.matchKeywords : undefined,
  };
}

function emptyDays(len: number) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return Array.from({ length: len }).map((_, index) => ({
    day: index + 1,
    date: new Date(start.getTime() + index * 24 * 60 * 60 * 1000).toISOString(),
    dayId: undefined as string | undefined,
    mealStatuses: {} as Partial<Record<MealSlot, MealTrackStatus>>,
    meals: {
      breakfast: null,
      lunch: null,
      dinner: null,
      snack: null,
      snack2: null,
    } as Record<MealSlot, MealItem | null>,
  }));
}

/**
 * Определяет приём пищи по названию блюда — упрощённая версия серверного
 * `inferMealSlotFromDishName`. Используется только для выбора запасной
 * иконки миниатюры, поэтому достаточно основных признаков.
 */
export function inferSlotFromName(name?: string | null): 'breakfast' | 'lunch' | 'dinner' | 'snack' {
  const n = String(name ?? '').toLowerCase().replace(/ё/g, 'е');
  if (!n) return 'lunch';
  if (/(каша|овсян|блин|оладь|омлет|яичниц|сырник|тост|гренк|круассан|завтрак|йогурт|мюсли|гранола)/.test(n))
    return 'breakfast';
  if (/(салат|десерт|торт|печенье|кекс|пирожн|мороженое|шоколад|фрукт|ягод|смузи|чипсы|орешк|батончик|чай|кофе|сок)/.test(n))
    return 'snack';
  if (/(запечен|тушен|рагу|овощ|баклажан|кабачок|брокколи|гриб|ужин)/.test(n)) return 'dinner';
  return 'lunch';
}

function DraggableDish({
  dish,
  onSelect,
  compact,
}: {
  dish: MealItem;
  onSelect?: (dish: MealItem) => void;
  compact?: boolean;
}) {
  const blocked = Boolean(dish.blockedByAllergen);
  const warn = (dish.dietWarnings?.length ?? 0) > 0;
  // Слот нужен только для запасной SVG-иконки миниатюры:
  // если картинка с TheMealDB не загрузится, покажем тематическую иконку.
  const slotForDish = inferSlotFromName(dish.name);
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `lib-${dish.id}`,
    disabled: blocked,
  });
  const style = transform
    ? { transform: `translate3d(${transform.x}px,${transform.y}px,0)` }
    : undefined;
  const hp = isHighProtein(dish);
  return (
    <button
      ref={setNodeRef}
      style={style}
      {...(blocked ? {} : listeners)}
      {...(blocked ? {} : attributes)}
      type="button"
      disabled={blocked}
      title={
        blocked
          ? 'Содержит аллерген из профиля'
          : warn
            ? dish.dietWarnings?.join('; ')
            : undefined
      }
      className={`allergy-chip catalog-dish-chip ${hp ? 'high-protein-dish' : ''} ${isDragging ? 'dnd-dragging' : ''} ${
        blocked ? 'catalog-dish-blocked' : ''
      } ${warn && !blocked ? 'catalog-dish-diet-warn' : ''}`}
      onClick={() => onSelect?.(dish)}
    >
      <DishThumb imageUrl={dish.imageUrl} name={dish.name} slot={slotForDish} size="sm" />
      <span className="catalog-dish-chip-text">
        <span className="catalog-dish-chip-name">
          {blocked ? <Lock size={13} aria-hidden /> : null}
          {warn && !blocked ? <AlertTriangle size={13} aria-hidden /> : null}
          {compact ? dish.name.slice(0, 28) : dish.name}
        </span>
        {/* БЖУ отдельными блоками фиксированной ширины: цифры не
            переносятся на другую строку и выравниваются по столбцам. */}
        <span className="macro-row catalog-dish-macros">
          <span className="macro-cell">
            <span className="macro-label">Б</span>
            <span className="macro-value">{round1(dish.protein)}</span>
            <span className="macro-unit">г</span>
          </span>
          <span className="macro-cell">
            <span className="macro-label">Ж</span>
            <span className="macro-value">{round1(dish.fat)}</span>
            <span className="macro-unit">г</span>
          </span>
          <span className="macro-cell">
            <span className="macro-label">У</span>
            <span className="macro-value">{round1(dish.carbs)}</span>
            <span className="macro-unit">г</span>
          </span>
          <span className="macro-cell macro-cell-kcal">
            <span className="macro-value">{Math.round(dish.calories)}</span>
            <span className="macro-unit">ккал</span>
          </span>
        </span>
      </span>
    </button>
  );
}

function DroppableCell({
  id,
  children,
}: {
  id: string;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={isOver ? 'cell-drop-over' : undefined}
      style={{ minHeight: 96, borderRadius: 8 }}
    >
      {children}
    </div>
  );
}

function formatRuPlanStamp(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function normalizeMealTrackStatus(raw: unknown): MealTrackStatus | undefined {
  if (raw === 'done' || raw === 'skipped') return raw;
  return undefined;
}

function mealTrackLabel(status: MealTrackStatus | undefined) {
  if (status === 'done') return 'съел';
  if (status === 'skipped') return 'пропуск';
  return 'ожидает';
}

/** Любимые продукты: совпадение с названием блюда или с составом (как на бэкенде). */
function mealMatchesFoodLike(meal: MealItem, likes: string[]): boolean {
  if (!likes.length) return false;
  const hay = mealDetailedTextBlob(meal);
  const title = String(meal.name ?? '');
  return likes.some((l) => {
    const k = String(l).trim();
    return Boolean(k) && (ruHaystackMatchesKeyword(title, k) || ruHaystackMatchesKeyword(hay, k));
  });
}

function extractIngredientsFromDishName(name: string): string[] {
  const noPortion = name.replace(/\s·[SML]$/i, '').trim();
  const normalized = noPortion
    .replace(/\s+\+\s+/g, ',')
    .replace(/\s+и\s+/gi, ',')
    .replace(/\s+с\s+/gi, ',')
    .replace(/\//g, ',');
  return normalized
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x.length >= 2);
}

function guessGramsForIngredientToken(tokenLower: string): number {
  const t = tokenLower.trim();
  if (!t) return 120;
  const rules: Array<[RegExp, number]> = [
    [/рис|гречк|греча|макарон|паста|каша|овсян/i, 180],
    [/rice|pasta|noodle|oat|quinoa/i, 180],
    [/куриц|индейк|говядин|свинин|рыб|лосос|треск|краб|лобстер|морепродукт/i, 160],
    [/chicken|turkey|beef|pork|salmon|tuna|fish|seafood|shrimp|prawn|crab|lobster|steak/i, 160],
    [/салат|цезар/i, 220],
    [/salad/i, 220],
    [/хлеб|бутерброд|тост|лаваш/i, 85],
    [/bread|toast|sandwich|bagel/i, 85],
    [/йогурт|творог|сыр[^к]|молок|сливк|сметан/i, 140],
    [/yogurt|cottage|milk|cream/i, 140],
    [/финик|миндаль|орех|ягод|апельсин|яблок|банан|клубник/i, 55],
    [/berry|berries|apple|banana|orange|nut|almond/i, 55],
    [/яйц|омлет/i, 110],
    [/egg|omelet|omelette/i, 110],
    [/масло|оливк/i, 25],
    [/butter|olive\s+oil|^oil$/i, 25],
    [/овощ|помид|огурц|перец|капуст|морков/i, 150],
    [/tomato|cucumber|pepper|carrot|cabbage|vegetable|onion|potato/i, 150],
  ];
  for (const [re, g] of rules) {
    if (re.test(t)) return g;
  }
  return 120;
}

function inferIngredientsClientFromTitle(title: string): MealIngredient[] {
  return extractIngredientsFromDishName(title).map((raw) => ({
    name: raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase(),
    grams: guessGramsForIngredientToken(raw.toLowerCase()),
  }));
}

const INGREDIENT_RU_PHRASES: Array<[RegExp, string]> = [
  [/chicken\s+stock/gi, 'Куриный бульон'],
  [/smoked\s+haddock/gi, 'Копчёная рыба'],
  [/black\s+pepper/gi, 'Чёрный перец'],
  [/bay\s+leaf/gi, 'Лавровый лист'],
  [/basmati\s+rice/gi, 'Рис басмати'],
  [/orange\s+juice/gi, 'Апельсиновый сок'],
  [/lime\s+juice/gi, 'Сок лайма'],
  [/olive\s+oil/gi, 'Оливковое масло'],
  [/vegetable\s+oil/gi, 'Растительное масло'],
  [/balsamic\s+vinegar/gi, 'Бальзамический уксус'],
  [/dijon\s+mustard/gi, 'Горчица дижонская'],
  [/cayenne\s+pepper/gi, 'Кайенский перец'],
  [/sugar\s+syrup/gi, 'Сахарный сироп'],
  [/garlic\s+clove/gi, 'Чеснок'],
  [/cinnamon\s+stick/gi, 'Палочка корицы'],
  [/liquid\s+cheese/gi, 'Сырный соус'],
  [/orange\s+peel/gi, 'Цедра апельсина'],
  [/tarragon\s+leaves/gi, 'Эстрагон'],
];

const INGREDIENT_RU_WORDS: Record<string, string> = {
  butter: 'Сливочное масло',
  onion: 'Лук',
  cardamom: 'Кардамон',
  turmeric: 'Куркума',
  cinnamon: 'Корица',
  eggs: 'Яйца',
  egg: 'Яйцо',
  parsley: 'Петрушка',
  lemon: 'Лимон',
  water: 'Вода',
  garlic: 'Чеснок',
  salt: 'Соль',
  chicken: 'Курица',
  tomato: 'Томат',
  parmesan: 'Пармезан',
  chives: 'Шнитт-лук',
  gruyere: 'Грюйер',
  mint: 'Мята',
  ginger: 'Имбирь',
  gin: 'Джин',
  vodka: 'Водка',
  campari: 'Кампари',
  grenadine: 'Гренадин',
  sprite: 'Спрайт',
  lemonade: 'Лимонад',
};

function normalizeIngredientLabel(rawName: string): string {
  let s = String(rawName ?? '').trim();
  if (!s) return s;
  for (const [re, ru] of INGREDIENT_RU_PHRASES) {
    s = s.replace(re, ru);
  }
  s = s.replace(/\b([a-zA-Z]+)\b/g, (w) => {
    const v = INGREDIENT_RU_WORDS[w.toLowerCase()];
    return v ?? w;
  });
  s = s.replace(/\s+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fridgeSpecificityBlocksMatch(ingredientDisplayName: string, productName: string): boolean {
  const ing = ingredientDisplayName.toLowerCase().replace(/ё/g, 'е');
  const prod = productName.toLowerCase().replace(/ё/g, 'е');
  const ingHasOnion = RU_ONION_WORD_RE.test(ing);
  const prodHasOnion = RU_ONION_WORD_RE.test(prod);
  if (ingHasOnion && prodHasOnion) {
    const greenOnionHint = /зелен|шнитт|батун|порей/;
    const ingGreen = greenOnionHint.test(ing);
    const prodGreen = prodHasGreenOnionOnly(prod);
    if (ingGreen !== prodGreen) return true;
  }
  const ingHasPepper = RU_PEPPER_WORD_RE.test(ing);
  const prodHasPepper = RU_PEPPER_WORD_RE.test(prod);
  if (ingHasPepper && prodHasPepper) {
    const bell = /болгар|сладк|паприк/;
    const chili = /остр|чили|кайен|халапень|халапеньо/;
    const ingBell = bell.test(ing);
    const prodBell = bell.test(prod);
    const ingChili = chili.test(ing);
    const prodChili = chili.test(prod);
    if (ingBell !== prodBell || ingChili !== prodChili) return true;
  }
  return false;
}

function prodHasGreenOnionOnly(productName: string): boolean {
  const p = productName.toLowerCase().replace(/ё/g, 'е');
  return RU_ONION_WORD_RE.test(p) && /зелен|шнитт|батун|порей/.test(p);
}

function fridgeProductMatchesIngredient(
  ingredientDisplayName: string,
  productName: string,
  ingredientId?: string,
  userIngredientId?: string | null,
  _dishMatchKeywords?: string[],
): boolean {
  if (fridgeSpecificityBlocksMatch(ingredientDisplayName, productName)) return false;
  if (ingredientId && userIngredientId && ingredientId === userIngredientId) return true;
  return isIngredientMatch(ingredientDisplayName, productName);
}

function userProductExpired(p: UserProduct): boolean {
  if (!p.expiresAt) return false;
  const exp = new Date(p.expiresAt);
  if (Number.isNaN(exp.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  exp.setHours(0, 0, 0, 0);
  return exp.getTime() < today.getTime();
}

function fridgeProductsUsableForAudit(products: UserProduct[]): UserProduct[] {
  return products.filter((p) => !userProductExpired(p));
}

function quantityToGramsStock(q: number, unitRaw: string): number | null {
  const u = unitRaw.toLowerCase().trim();
  if (!Number.isFinite(q) || q <= 0) return null;
  if (!u || u === 'г' || u === 'g' || u.startsWith('грам')) return q;
  if (u === 'кг' || u === 'kg' || u.startsWith('килограм')) return q * 1000;
  if (u === 'мл' || u === 'ml') return q;
  return null;
}

function stockGramsForIngredient(
  ingredientDisplayName: string,
  products: UserProduct[],
  ingredientId?: string,
  dishMatchKeywords?: string[],
): { grams: number; nameMatchWithoutGrams: boolean } {
  let grams = 0;
  let nameMatchWithoutGrams = false;
  for (const p of products) {
    if (!fridgeProductMatchesIngredient(ingredientDisplayName, p.name, ingredientId, p.ingredientId, dishMatchKeywords)) continue;
    const g = quantityToGramsStock(p.quantity, p.unit);
    if (g !== null) grams += g;
    else nameMatchWithoutGrams = true;
  }
  return { grams, nameMatchWithoutGrams };
}

function mealSlotCardClass(status: MealTrackStatus | undefined): string {
  if (status === 'done') return 'meal-slot-done';
  if (status === 'skipped') return 'meal-slot-skipped';
  return '';
}

export const MealPlanPage = () => {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const loadPlanFromUrl = searchParams.get('loadPlan');
  const loadPlanId = useMemo(() => {
    if (typeof sessionStorage === 'undefined') return loadPlanFromUrl;
    return loadPlanFromUrl ?? sessionStorage.getItem('mealPlan:lastOpened');
  }, [loadPlanFromUrl]);
  const pdfRef = useRef<HTMLDivElement | null>(null);
  const [isExportingPdf, setIsExportingPdf] = useState(false);
  const [mode, setMode] = useState<Mode>('basic');
  const [duration, setDuration] = useState<number>(14);
  const [isLoadingAi, setIsLoadingAi] = useState(false);
  const [isLoadingPlan, setIsLoadingPlan] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');
  const [aiError, setAiError] = useState('');
  const [selectedMeal, setSelectedMeal] = useState<MealItem | null>(null);
  /** Продукты из рецепта, которых нет в холодильнике (что докупить). */
  const [fridgeMissing, setFridgeMissing] = useState<string[]>([]);
  const [dishSearch, setDishSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');
  const [dishLibrary, setDishLibrary] = useState<MealItem[]>([]);
  const [dailyCalories, setDailyCalories] = useState(2200);
  const [goal, setGoal] = useState<'lose' | 'maintain' | 'gain'>('maintain');
  const [allergies, setAllergies] = useState<string[]>([]);
  const [allergyNamesDisplay, setAllergyNamesDisplay] = useState<string[]>([]);
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [foodLikes, setFoodLikes] = useState<string[]>([]);
  const [foodDislikes, setFoodDislikes] = useState<string[]>([]);
  const [userAgeYears, setUserAgeYears] = useState<number | null>(null);
  const [userProducts, setUserProducts] = useState<UserProduct[]>([]);
  const [constructorAudit, setConstructorAudit] = useState<{
    score: number;
    verdict: string;
    scopeDays: number;
    have: string[];
    buy: string[];
    replace: string[];
    corrections: string[];
  } | null>(null);
  const [constructorDaysScope, setConstructorDaysScope] = useState<1 | 2 | 3 | 7 | 14 | 0>(2);
  const [aiRefineModal, setAiRefineModal] = useState<null | {
    overview: string;
    changes: Array<{
      day: number;
      slot: string;
      action: string;
      dishName?: string;
      previousDishName?: string;
      reason: string;
    }>;
    warnings: string[];
    days: MealPlanDayPayload[];
  }>(null);
  const [aiRefineLoading, setAiRefineLoading] = useState(false);
  const [showTargetModal, setShowTargetModal] = useState(false);
  const [targetInput, setTargetInput] = useState(2200);
  const [pendingGenerate, setPendingGenerate] = useState<'auto' | 'aiCat' | null>(null);
  /**
   * Подтверждение добавления блюда, которое нарушает ограничения.
   * Причины собираются в список: аллергены, диета, нежелательные продукты.
   */
  const [dietConfirm, setDietConfirm] = useState<{
    dish: MealItem;
    day: number;
    slot: MealSlot;
    reasons: string[];
  } | null>(null);
  const [openPlanMeta, setOpenPlanMeta] = useState<{ id: string; status: string } | null>(null);
  const [days, setDays] = useState<
    Array<{
      day: number;
      date: string;
      dayId?: string;
      mealStatuses: Partial<Record<MealSlot, MealTrackStatus>>;
      meals: Record<MealSlot, MealItem | null>;
    }>
  >([]);

  const trackingEnabled = openPlanMeta?.status === 'active';
  const hasProfileConstraintsForReview =
    allergies.length > 0 || dietaryRestrictions.length > 0 || foodDislikes.length > 0;
  const reviewPlanMsg = hasProfileConstraintsForReview
    ? ' Перепроверьте план в конструкторе: при наличии аллергенов/ограничений точность подбора не гарантируется на 100%.'
    : '';

  const isMinorAlcoholRestricted = useMemo(
    () => userAgeYears !== null && userAgeYears < 18,
    [userAgeYears],
  );

  const notifyMinorAlcoholBlocked = useCallback(() => {
    setSaveMsg(MINOR_ALCOHOL_BLOCK_MSG);
    window.setTimeout(() => setSaveMsg(''), 6000);
  }, []);

  const allowConstructorAlcoholPlacement = useCallback(
    (dish: MealItem): boolean => {
      if (mode !== 'constructor' || !isMinorAlcoholRestricted) return true;
      if (!mealLooksLikeAlcoholic(dish)) return true;
      notifyMinorAlcoholBlocked();
      return false;
    },
    [mode, isMinorAlcoholRestricted, notifyMinorAlcoholBlocked],
  );

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 2 } }));

  const applySavedPlan = useCallback((plan: SavedMealPlan | null) => {
    if (!plan?.days?.length) return;
    setOpenPlanMeta({ id: plan.id, status: plan.status });
    setDailyCalories(Math.round(plan.targetCalories));
    setDuration(Math.max(1, plan.durationDays));
    setDays(
      plan.days.map((row) => {
        const extra = row.extraSnacks;
        const ex = Array.isArray(extra) && extra.length > 0 ? snapshotToMeal(extra[0], 'snack2') : null;
        const primarySnack =
          row.snack ??
          (Array.isArray(row.snacks) && row.snacks.length > 0 ? row.snacks[0] : null);
        return {
          day: row.dayNumber,
          date: row.date,
          dayId: row.id,
          mealStatuses: {
            breakfast: normalizeMealTrackStatus(row.mealStatuses?.breakfast),
            lunch: normalizeMealTrackStatus(row.mealStatuses?.lunch),
            dinner: normalizeMealTrackStatus(row.mealStatuses?.dinner),
            snack: normalizeMealTrackStatus(row.mealStatuses?.snack),
            snack2: normalizeMealTrackStatus(row.mealStatuses?.snack2),
          },
          meals: {
            breakfast: snapshotToMeal(row.breakfast, 'breakfast'),
            lunch: snapshotToMeal(row.lunch, 'lunch'),
            dinner: snapshotToMeal(row.dinner, 'dinner'),
            snack: snapshotToMeal(primarySnack, 'snack'),
            snack2: ex,
          },
        };
      }),
    );
  }, []);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;
      const [profile, calories] = await Promise.all([
        userApi.getById(user.id),
        userApi.getCalories(user.id),
      ]);
      setGoal((profile.goal ?? 'maintain') as 'lose' | 'maintain' | 'gain');
      const tc = (profile as { targetCalories?: number }).targetCalories;
      const daily = tc && tc > 0 ? tc : calories.dailyCalories;
      setDailyCalories(daily);
      setTargetInput(daily);
      const allergens = profile.allergens ?? [];
      setAllergyNamesDisplay(allergens.map((a: { name: string }) => a.name));
      setAllergies(allergens.map((a: { name: string }) => a.name.toLowerCase()));
      const dr = (profile as { dietaryRestrictions?: string[] }).dietaryRestrictions;
      setDietaryRestrictions(Array.isArray(dr) ? dr : []);
      const likes = (profile as { foodLikes?: string[] }).foodLikes;
      const dislikes = (profile as { foodDislikes?: string[] }).foodDislikes;
      setFoodLikes(Array.isArray(likes) ? likes.map((v) => String(v).toLowerCase()) : []);
      setFoodDislikes(Array.isArray(dislikes) ? dislikes.map((v) => String(v).toLowerCase()) : []);
      const products = await userApi.listUserProducts(user.id);
      setUserProducts(products);
      const birthRaw = (profile as { birthDate?: string | null }).birthDate;
      const birthStr = birthRaw ? String(birthRaw).slice(0, 10) : '';
      setUserAgeYears(birthStr ? computeAgeFromBirthDate(birthStr) : null);
    };
    void loadProfile();
  }, [user]);

  const loadDishes = useCallback(async () => {
    if (!user) return;
    const dishes = await mealPlanApi.dishes({
      search: dishSearch || undefined,
      category: categoryFilter || undefined,
      userId: user.id,
    });
    setDishLibrary(
      dishes.map((d: CatalogDish) => {
        const cleaned =
          Array.isArray(d.ingredients) && d.ingredients.length > 0
            ? d.ingredients
                .map((row) => ({
                  name: String(row?.name ?? '').trim(),
                  grams: Number(row?.grams) || 0,
                }))
                .filter((row) => row.name.length > 0)
            : [];
        const ingredients = cleaned.length > 0 ? cleaned : inferIngredientsClientFromTitle(d.name);
        const ingredientsDetailed =
          Array.isArray(d.ingredientsDetailed) && d.ingredientsDetailed.length > 0
            ? d.ingredientsDetailed
                .map((row) => ({
                  id: String(row?.id ?? ''),
                  name: String(row?.name ?? '').trim(),
                  amount: Number(row?.amount) || 0,
                  unit: String(row?.unit ?? '').trim(),
                  grams: Number(row?.grams) || 0,
                  originalString: row?.originalString ? String(row.originalString) : undefined,
                  ingredientId: row?.ingredientId ? String(row.ingredientId) : undefined,
                }))
                .filter((row) => row.id && row.name)
            : undefined;
        return {
          id: d.id,
          name: d.name,
          calories: d.calories,
          protein: d.protein,
          fat: d.fat,
          carbs: d.carbs,
          allergens: d.allergens ?? [],
          category: d.category as MealItem['category'],
          ingredients: ingredients.length ? ingredients : undefined,
          ingredientsDetailed: ingredientsDetailed?.length ? ingredientsDetailed : undefined,
          imageUrl: d.imageUrl != null && String(d.imageUrl).trim() ? String(d.imageUrl) : undefined,
          blockedByAllergen: d.blockedByAllergen,
          dietWarnings: d.dietWarnings,
          matchKeywords: Array.isArray(d.matchKeywords) ? d.matchKeywords.map((x) => String(x).toLowerCase()) : undefined,
          sourceMealId: d.sourceMealId != null && String(d.sourceMealId).trim() ? String(d.sourceMealId).trim() : undefined,
          description: d.description != null && String(d.description).trim() ? String(d.description).trim() : undefined,
          cuisine: d.cuisine != null && String(d.cuisine).trim() ? String(d.cuisine).trim() : undefined,
        };
      }),
    );
  }, [user, dishSearch, categoryFilter]);

  useEffect(() => {
    const t = setTimeout(() => {
      void loadDishes();
    }, 300);
    return () => clearTimeout(t);
  }, [loadDishes]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      setIsLoadingPlan(true);
      try {
        const plan = loadPlanId
          ? await mealPlanApi.getPlan(user.id, loadPlanId)
          : await mealPlanApi.getActive(user.id);
        if (cancelled) return;
        if (plan?.days?.length) {
          applySavedPlan(plan);
          if (plan && 'id' in plan && plan.id) {
            sessionStorage.setItem('mealPlan:lastOpened', String(plan.id));
          }
        } else {
          setOpenPlanMeta(null);
          setDays(emptyDays(14));
          setDuration(14);
        }
      } catch (err) {
        if (!cancelled) setSaveMsg(formatApiError(err, 'Не удалось загрузить план или библиотеку.'));
      } finally {
        if (!cancelled) setIsLoadingPlan(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loadPlanId, applySavedPlan]);

  const runGenerate = async (kind: 'auto' | 'aiCat') => {
    if (!user) return;
    setSaveMsg('');
    setAiError('');
    const tc = targetInput;
    setDailyCalories(tc);
    try {
      if (kind === 'auto') {
        const saved = await mealPlanApi.generateAuto(user.id, duration, {
          targetCalories: tc,
          calorieMode: 'precise',
          // Новое зерно при каждой генерации: иначе повторное нажатие
          // возвращало тот же самый план.
          seed: Date.now() % 2_000_000_000,
        });
        applySavedPlan(saved);
        const w = (saved as SavedMealPlan & { warnings?: string[] }).warnings;
        setSaveMsg(
          w?.length
            ? `План сохранён. ${w.join(' ')}${reviewPlanMsg}`
            : `План сформирован автоматически и сохранён.${reviewPlanMsg}`,
        );
      } else {
        setIsLoadingAi(true);
        const saved = await mealPlanApi.generateAiCatalog(user.id, duration, tc);
        applySavedPlan(saved);
        const w = (saved as SavedMealPlan & { warnings?: string[] }).warnings;
        setSaveMsg(
          w?.length
            ? `AI-план по каталогу БД сохранён. ${w.join(' ')}${reviewPlanMsg}`
            : `AI-план по каталогу БД сохранён.${reviewPlanMsg}`,
        );
      }
    } catch (err) {
      // Показываем реальное сообщение сервера: оно объясняет причину
      // (нет ключа, лимит запросов, ошибка валидации), тогда как раньше
      // пользователь видел общий текст и не знал, что делать.
      const info = getApiErrorInfo(err);
      if (kind === 'aiCat') {
        setAiError(
          info.status === 503
            ? `${info.message} Используйте автогенерацию или проверьте OPENAI_API_KEY на сервере.`
            : info.message,
        );
      } else {
        setSaveMsg(info.hint ? `${info.message} ${info.hint}` : info.message);
      }
    } finally {
      setIsLoadingAi(false);
      setShowTargetModal(false);
      setPendingGenerate(null);
    }
  };

  const openGenerateModal = (kind: 'auto' | 'aiCat') => {
    setTargetInput(dailyCalories);
    setPendingGenerate(kind);
    setShowTargetModal(true);
  };

  const saveToServer = async () => {
    if (!user) return;
    setSaveMsg('');
    const payloadDays: MealPlanDayPayload[] = days.map((d) => {
      const snack2 = d.meals.snack2;
      const extraSnacks = snack2 ? [mealToSnapshot(snack2)!].filter(Boolean) : [];
      return {
        dayNumber: d.day,
        breakfast: mealToSnapshot(d.meals.breakfast),
        lunch: mealToSnapshot(d.meals.lunch),
        dinner: mealToSnapshot(d.meals.dinner),
        snack: mealToSnapshot(d.meals.snack),
        extraSnacks: extraSnacks.length ? (extraSnacks as MealSlotSnapshot[]) : [],
      };
    });
    try {
      const saved = await mealPlanApi.save(user.id, {
        durationDays: duration,
        targetCalories: dailyCalories,
        days: payloadDays,
        name: `План на ${formatRuPlanStamp(new Date())}`,
      });
      applySavedPlan(saved);
      setSaveMsg('План сохранён в базе.');
      if (mode === 'constructor') {
        analyzeConstructorPlan();
      }
    } catch (e: unknown) {
      if (isAxiosError(e) && e.response?.status === 403) {
        const raw = e.response.data as { message?: string | string[] };
        const m = raw?.message;
        setSaveMsg(Array.isArray(m) ? m.join(' ') : (m ?? MINOR_ALCOHOL_BLOCK_MSG));
        return;
      }
      setSaveMsg('Не удалось сохранить план.');
    }
  };

  const exportPdf = async () => {
    if (!pdfRef.current) return;
    setIsExportingPdf(true);
    document.body.classList.add('pdf-export-loading');
    document.body.classList.add('pdf-exporting');
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const options: Record<string, unknown> = {
        margin: 10,
        filename: `meal-plan-${user?.id ?? 'user'}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: {
          scale: 2,
          ignoreElements: (el: HTMLElement) => el.tagName.toLowerCase() === 'img',
        },
        pagebreak: { mode: ['css'], before: '.meal-pdf-break-before' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      };
      await html2pdf()
        .set(options as never)
        .from(pdfRef.current)
        .save();
    } finally {
      document.body.classList.remove('pdf-exporting');
      document.body.classList.remove('pdf-export-loading');
      setIsExportingPdf(false);
    }
  };

  const setMealForDay = (day: number, slot: MealSlot, meal: MealItem | null) => {
    setDays((prev) =>
      prev.map((item) =>
        item.day === day
          ? {
              ...item,
              mealStatuses:
                meal === null
                  ? (() => {
                      const next = { ...item.mealStatuses };
                      delete next[slot];
                      return next;
                    })()
                  : item.mealStatuses,
              meals: {
                ...item.meals,
                [slot]: meal,
              },
            }
          : item,
      ),
    );
  };

  const clearMealForDay = async (day: (typeof days)[number], slot: MealSlot) => {
    setMealForDay(day.day, slot, null);
    if (trackingEnabled) {
      await setMealStatusForDay(day, slot, null);
    }
  };

  const mealConstraintFlags = (meal: MealItem | null): MealConstraintFlags => {
    if (!meal) return { allergen: false, diet: false, dislike: false, missingDetailed: false, labels: [] };
    const missingDetailed =
      (!Array.isArray(meal.ingredientsDetailed) || meal.ingredientsDetailed.length === 0) &&
      (!Array.isArray(meal.ingredients) || meal.ingredients.length === 0) &&
      (!Array.isArray(meal.allergens) || meal.allergens.length === 0);
    const blob = mealDetailedTextBlob(meal);
    const allergen = allergies.some((a) => {
      const al = String(a ?? '').toLowerCase();
      return blob.includes(al);
    });
    const diet = Array.from(new Set([...(meal.dietWarnings ?? []), ...getDietWarningsForMeal(meal, dietaryRestrictions)])).length > 0;
    const dislike = hasDetailedDislike(meal, foodDislikes);
    const labels: string[] = [];
    if (missingDetailed) labels.push('нет состава');
    if (allergen) labels.push('аллерген');
    if (diet) labels.push('диета');
    if (dislike) labels.push('нежелательный');
    return { allergen, diet, dislike, missingDetailed, labels };
  };

  const activateCurrentPlan = async () => {
    if (!user || !openPlanMeta?.id) return;
    setSaveMsg('');
    try {
      const res = await mealPlanApi.activatePlan(user.id, openPlanMeta.id);

      // Сервер не активирует план, созданный по другим ограничениям,
      // и возвращает список различий вместо самого плана.
      if (res && 'requiresConfirmation' in res && res.requiresConfirmation === true) {
        const details = res.changed
          .map((c) => `${c.label}: ${c.before} → ${c.after}`)
          .join('; ');
        setSaveMsg(
          `План создан по старым ограничениям (${details}). ` +
            'Сгенерируйте новый план или подтвердите активацию в разделе «Мои планы».',
        );
        return;
      }

      // Здесь res — уже сохранённый план (ветка подтверждения вышла выше).
      applySavedPlan(res as Parameters<typeof applySavedPlan>[0]);
      setSaveMsg('План активирован — можно отмечать приёмы пищи.');
    } catch (err) {
      setSaveMsg('Не удалось сделать план активным.');
    }
  };

  const setMealStatusForDay = async (day: (typeof days)[number], slot: MealSlot, status: MealTrackStatus | null) => {
    if (!trackingEnabled) return;
    if (!user || !day.dayId) {
      setSaveMsg('Сначала сохраните план, чтобы отмечать приёмы пищи.');
      return;
    }
    try {
      await mealPlanApi.patchDayMeals(user.id, day.dayId, { [slot]: status });
      setDays((prev) =>
        prev.map((row) => {
          if (row.dayId !== day.dayId) return row;
          const next = { ...row.mealStatuses };
          if (status === null) delete next[slot];
          else next[slot] = status;
          return { ...row, mealStatuses: next };
        }),
      );
    } catch (err) {
      setSaveMsg('Не удалось обновить статус приёма пищи.');
    }
  };

  const notifyCatalogSlotMismatch = (dish: MealItem, slot: MealSlot) => {
    const titles: Record<MealSlot, string> = {
      breakfast: 'Завтрак',
      lunch: 'Обед',
      dinner: 'Ужин',
      snack: 'Перекус',
      snack2: 'Перекус 2',
    };
    const catName = titles[dish.category];
    const slotName = titles[slot];
    setSaveMsg(
      `«${dish.name}» в каталоге указано как блюдо на «${catName}», а вы ставите в «${slotName}». Так можно — добавляем в выбранную ячейку.`,
    );
    window.setTimeout(() => setSaveMsg(''), 7000);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const dragId = String(active.id);
    if (!dragId.startsWith('lib-')) return;
    const dishId = dragId.slice(4);
    const dish = dishLibrary.find((d) => d.id === dishId);
    if (!dish) return;
    const overId = String(over.id);
    const m = /^drop-(\d+)-(breakfast|lunch|dinner|snack|snack2)$/.exec(overId);
    if (!m) return;
    const dayNum = Number(m[1]);
    const slot = m[2] as MealSlot;
    if (!catalogSlotMatchesDish(dish, slot)) {
      notifyCatalogSlotMismatch(dish, slot);
    }
    if (dish.blockedByAllergen) {
      setSaveMsg('Нельзя добавить блюдо с аллергеном из профиля.');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    if (!allowConstructorAlcoholPlacement(dish)) return;

    // Собираем ВСЕ причины, по которым блюдо не подходит:
    // так пользователь видит полную картину, а не первое совпадение.
    const reasons: string[] = [];
    if (dish.dietWarnings?.length) {
      reasons.push(`Не подходит для вашей диеты: ${dish.dietWarnings.join(', ')}`);
    }
    if (hasDetailedDislike(dish, foodDislikes)) {
      reasons.push('Входит в список нежелательных продуктов');
    }

    if (reasons.length > 0) {
      setDietConfirm({ dish, day: dayNum, slot, reasons });
      return;
    }
    setMealForDay(dayNum, slot, dish);
  };

  const tryPlaceDish = (dayNum: number, slot: MealSlot, dish: MealItem) => {
    if (!catalogSlotMatchesDish(dish, slot)) {
      notifyCatalogSlotMismatch(dish, slot);
    }
    if (dish.blockedByAllergen) {
      setSaveMsg('Нельзя добавить блюдо с аллергеном из профиля.');
      setTimeout(() => setSaveMsg(''), 3000);
      return;
    }
    if (!allowConstructorAlcoholPlacement(dish)) return;

    const reasons: string[] = [];
    if (dish.dietWarnings?.length) {
      reasons.push(`Не подходит для вашей диеты: ${dish.dietWarnings.join(', ')}`);
    }
    if (hasDetailedDislike(dish, foodDislikes)) {
      reasons.push('Входит в список нежелательных продуктов');
    }

    if (reasons.length > 0) {
      setDietConfirm({ dish, day: dayNum, slot, reasons });
      return;
    }
    setMealForDay(dayNum, slot, dish);
  };

  const copyDayPlan = (day: number) => {
    const from = days.find((d) => d.day === day);
    if (!from) return;
    setDays((prev) =>
      prev.map((item) =>
        item.day === day + 1 ? { ...item, meals: { ...from.meals }, mealStatuses: {} } : item,
      ),
    );
  };

  const resetDayPlan = (day: number) => {
    setDays((prev) =>
      prev.map((item) =>
        item.day === day
          ? {
              ...item,
              meals: {
                breakfast: null,
                lunch: null,
                dinner: null,
                snack: null,
                snack2: null,
              },
              mealStatuses: {},
            }
          : item,
      ),
    );
  };

  const clearAll = () => {
    setDays((prev) =>
      prev.map((item) => ({
        ...item,
        meals: {
          breakfast: null,
          lunch: null,
          dinner: null,
          snack: null,
          snack2: null,
        },
        mealStatuses: {},
      })),
    );
  };

  const analyzeConstructorPlan = (overrideDays?: typeof days) => {
    const rowDays = overrideDays ?? days;
    const scopedDays =
      constructorDaysScope === 0
        ? rowDays
        : rowDays.slice(0, Math.max(1, Math.min(constructorDaysScope, rowDays.length)));
    const chosenMeals = scopedDays.flatMap((d) =>
      MAIN_SLOTS.map((slot) => d.meals[slot]).filter(Boolean) as MealItem[],
    ).filter((m) => !/^Блюдо\s*\(/i.test(String(m.name ?? '')));
    if (chosenMeals.length === 0) {
      setConstructorAudit({
        score: 0,
        verdict: 'План пустой — сначала заполните блюда в конструкторе.',
        scopeDays: constructorDaysScope === 0 ? rowDays.length : constructorDaysScope,
        have: [],
        buy: [],
        replace: [],
        corrections: ['Добавьте блюда во все слоты (завтрак, обед, ужин, перекусы) и повторите анализ.'],
      });
      return;
    }
    const fridgeForAudit = fridgeProductsUsableForAudit(userProducts);
    const skippedExpiredCount = userProducts.length - fridgeForAudit.length;

    const agg = new Map<
      string,
      { displayName: string; grams: number; ingredientId?: string; dishKeywords: Set<string> }
    >();
    for (const meal of chosenMeals) {
      const list: Array<{ name: string; grams: number; ingredientId?: string }> =
        meal.ingredientsDetailed && meal.ingredientsDetailed.length > 0
          ? meal.ingredientsDetailed.map((x) => ({
              name: normalizeIngredientLabel(x.name),
              grams: Number(x.grams) || 0,
              ingredientId: x.ingredientId,
            }))
          : meal.ingredients && meal.ingredients.length > 0
            ? meal.ingredients.map((x) => ({ name: normalizeIngredientLabel(x.name), grams: x.grams, ingredientId: undefined }))
            : inferIngredientsClientFromTitle(meal.name).map((x) => ({
                name: normalizeIngredientLabel(x.name),
                grams: x.grams,
                ingredientId: undefined,
              }));
      const mealKw = meal.matchKeywords ?? [];
      for (const ing of list) {
        const key = ing.ingredientId ? `id:${ing.ingredientId}` : `name:${ing.name.toLowerCase().trim()}`;
        if (!key) continue;
        const add = Number(ing.grams) || 0;
        const prev = agg.get(key);
        if (!prev) {
          agg.set(key, {
            displayName: ing.name,
            grams: add,
            ingredientId: ing.ingredientId,
            dishKeywords: new Set(mealKw),
          });
        } else {
          for (const kw of mealKw) prev.dishKeywords.add(kw);
          agg.set(key, {
            displayName: prev.displayName,
            grams: prev.grams + add,
            ingredientId: prev.ingredientId,
            dishKeywords: prev.dishKeywords,
          });
        }
      }
    }
    const have: string[] = [];
    const buy: string[] = [];
    for (const { displayName, grams: need, ingredientId, dishKeywords } of agg.values()) {
      const kwList = dishKeywords.size ? [...dishKeywords] : undefined;
      const { grams: stockG, nameMatchWithoutGrams } = stockGramsForIngredient(
        displayName,
        fridgeForAudit,
        ingredientId,
        kwList,
      );
      const roundedNeed = Math.round(need);
      if (need <= 0) {
        const matched = fridgeForAudit.some((p) =>
          fridgeProductMatchesIngredient(displayName, p.name, ingredientId, p.ingredientId, kwList),
        );
        if (matched) have.push(`${displayName}: совпадение по названию без оценки массы`);
        else buy.push(`${displayName}: проверить наличие`);
        continue;
      }
      if (stockG >= need) {
        have.push(`${displayName}: нужно ~${roundedNeed} г — у вас ~${Math.round(stockG)} г`);
      } else if (stockG > 0) {
        have.push(`${displayName}: есть ~${Math.round(stockG)} г из ~${roundedNeed} г`);
        buy.push(`${displayName}: докупить ~${Math.round(Math.max(0, need - stockG))} г`);
      } else if (nameMatchWithoutGrams) {
        buy.push(
          `${displayName}: докупить ~${roundedNeed} г (продукт есть в списке без г/кг — укажите единицу в профиле для точности)`,
        );
      } else {
        buy.push(`${displayName}: докупить ~${roundedNeed} г`);
      }
    }
    const replace: string[] = [];
    for (const meal of chosenMeals) {
      if (hasDetailedDislike(meal, foodDislikes)) {
        const alt = dishLibrary.find(
          (x) => x.category === meal.category && !hasDetailedDislike(x, foodDislikes),
        );
        replace.push(`${meal.name} -> ${alt?.name ?? 'подобрать альтернативу из каталога'}`);
      }
    }
    const allergenViolations: string[] = [];
    const dietViolations: string[] = [];
    const missingDetailedViolations: string[] = [];
    for (const meal of chosenMeals) {
      const blob = mealDetailedTextBlob(meal);
      const hasDetailed = Array.isArray(meal.ingredientsDetailed) && meal.ingredientsDetailed.length > 0;
      if (!hasDetailed) {
        missingDetailedViolations.push(meal.name);
      }
      const matchedAllergens = allergies.filter((a) => {
        const lowered = a.toLowerCase();
        return blob.includes(lowered);
      });
      if (matchedAllergens.length > 0) {
        allergenViolations.push(`${meal.name} (аллергены: ${matchedAllergens.join(', ')})`);
      }
      const warns = Array.from(
        new Set([...(meal.dietWarnings ?? []), ...getDietWarningsForMeal(meal, dietaryRestrictions)]),
      );
      if (warns.length > 0) {
        dietViolations.push(`${meal.name} (диета: ${warns.join(', ')})`);
      }
    }
    const avgCalories = Math.round(
      scopedDays.reduce((sum, day) => sum + MAIN_SLOTS.reduce((s, slot) => s + (day.meals[slot]?.calories ?? 0), 0), 0) /
        Math.max(1, scopedDays.length),
    );
    let score = 100;
    const delta = Math.abs(avgCalories - dailyCalories);
    if (delta > dailyCalories * 0.2) score -= 20;
    const buyStress = buy.length;
    const ingCount = Math.max(1, agg.size);
    if (buyStress > Math.max(3, ingCount * 0.35)) score -= 20;
    if (replace.length > 0) score -= Math.min(20, replace.length * 6);
    if (allergenViolations.length > 0) score -= Math.min(35, allergenViolations.length * 10);
    if (dietViolations.length > 0) score -= Math.min(25, dietViolations.length * 6);
    if (missingDetailedViolations.length > 0) score -= Math.min(30, missingDetailedViolations.length * 5);
    const likesHits = chosenMeals.filter((m) => mealMatchesFoodLike(m, foodLikes)).length;
    if (likesHits > 0) score += Math.min(10, likesHits * 2);
    if (foodLikes.length > 0 && likesHits === 0) score -= 8;
    const calorieRatio = avgCalories / Math.max(1, dailyCalories);
    const goalMismatch =
      (goal === 'lose' && calorieRatio > 1.02) ||
      (goal === 'gain' && calorieRatio < 0.98) ||
      (goal === 'maintain' && (calorieRatio < 0.9 || calorieRatio > 1.1));
    if (goalMismatch) score -= 12;
    score = Math.max(0, Math.min(100, score));
    const corrections: string[] = [];
    if (skippedExpiredCount > 0) {
      corrections.push(
        `В расчёте запасов не учитывалось ${skippedExpiredCount} поз. с истёкшим сроком годности (срок в профиле раньше сегодня). При смешанных партиях заведите отдельные строки: годное количество и просрочное.`,
      );
    }
    if (goalMismatch) {
      corrections.push(
        goal === 'lose'
          ? 'Для цели «похудеть» снизьте среднюю калорийность дня или замените самые калорийные блюда на более лёгкие.'
          : goal === 'gain'
            ? 'Для цели «набрать массу» увеличьте среднюю калорийность дня (добавьте калорийный перекус/более плотный ужин).'
            : 'Для цели «поддерживать» приблизьте среднюю калорийность к целевой дневной норме.',
      );
    } else if (delta > dailyCalories * 0.1) {
      corrections.push('Подровняйте ккал: средняя калорийность заметно отличается от целевого значения.');
    }
    if (allergenViolations.length > 0) {
      corrections.push(
        `Уберите блюда с аллергенами из профиля: ${allergenViolations.slice(0, 4).join(' | ')}${allergenViolations.length > 4 ? ' ...' : ''}`,
      );
    }
    if (dietViolations.length > 0) {
      corrections.push(
        `Замените блюда, нарушающие выбранную диету: ${dietViolations.slice(0, 4).join(' | ')}${dietViolations.length > 4 ? ' ...' : ''}`,
      );
    }
    if (replace.length > 0) {
      corrections.push(
        `Замените нежелательные продукты: ${replace.slice(0, 4).join(' | ')}${replace.length > 4 ? ' ...' : ''}`,
      );
    }
    if (missingDetailedViolations.length > 0) {
      corrections.push(
        `Для этих блюд нет ingredientsDetailed, поэтому ограничения не могут быть строго проверены: ${missingDetailedViolations
          .slice(0, 5)
          .join(' | ')}${missingDetailedViolations.length > 5 ? ' ...' : ''}`,
      );
    }
    if (buyStress > Math.max(3, ingCount * 0.35)) {
      corrections.push(
        'План слабо опирается на продукты в холодильнике: увеличьте долю блюд из доступных ингредиентов или обновите список продуктов.',
      );
    }
    if (foodLikes.length > 0 && likesHits === 0) {
      corrections.push('Добавьте 1-2 блюда из любимых продуктов пользователя для лучшей персонализации.');
    }
    if (corrections.length === 0) {
      corrections.push('План соответствует цели, диете, аллергенам и доступным продуктам.');
    }
    const verdict =
      score >= 80
        ? 'План хороший: калорийность и состав близки к цели.'
        : score >= 60
          ? 'План средний: требуется небольшая корректировка.'
          : 'План слабый: стоит заменить часть блюд и учесть доступные продукты.';
    setConstructorAudit({
      score,
      verdict,
      scopeDays: constructorDaysScope === 0 ? rowDays.length : constructorDaysScope,
      have,
      buy,
      replace,
      corrections,
    });
  };

  const buildConstructorAuditHint = useCallback(() => {
    if (!constructorAudit) return undefined;
    const chunks = [
      `Балл ${constructorAudit.score}/100.`,
      constructorAudit.verdict.trim(),
      constructorAudit.replace.length ? `Рекомендации по замене: ${constructorAudit.replace.join('; ')}` : '',
      constructorAudit.corrections.length ? `Корректировки: ${constructorAudit.corrections.join('; ')}` : '',
    ].filter((x) => String(x).trim().length > 0);
    return chunks.join(' ');
  }, [constructorAudit]);

  const runAiRefineConstructor = async () => {
    if (!user) return;
    setAiRefineLoading(true);
    setSaveMsg('');
    try {
      const payloadDays: MealPlanDayPayload[] = days.map((d) => {
        const snack2 = d.meals.snack2;
        const extraSnacks = snack2 ? [mealToSnapshot(snack2)!].filter(Boolean) : [];
        return {
          dayNumber: d.day,
          breakfast: mealToSnapshot(d.meals.breakfast),
          lunch: mealToSnapshot(d.meals.lunch),
          dinner: mealToSnapshot(d.meals.dinner),
          snack: mealToSnapshot(d.meals.snack),
          extraSnacks: extraSnacks.length ? (extraSnacks as MealSlotSnapshot[]) : [],
        };
      });
      const data = await mealPlanApi.refineConstructorAi(user.id, {
        targetCalories: dailyCalories,
        days: payloadDays,
        auditHint: buildConstructorAuditHint(),
      });
      setAiRefineModal({
        overview: data.overview,
        changes: data.changes,
        warnings: data.warnings ?? [],
        days: data.days,
      });
    } catch (err) {
      setSaveMsg('Не удалось доработать план с ИИ. Проверьте сеть и ключ API на сервере.');
    } finally {
      setAiRefineLoading(false);
    }
  };

  const totalCalories = (day: (typeof days)[number]) =>
    MAIN_SLOTS.reduce((s, slot) => s + (day.meals[slot]?.calories ?? 0), 0);

  const dayMacros = (day: (typeof days)[number]) => {
    let p = 0,
      f = 0,
      c = 0;
    for (const slot of MAIN_SLOTS) {
      const m = day.meals[slot];
      if (m) {
        p += m.protein;
        f += m.fat;
        c += m.carbs;
      }
    }
    return { p, f, c };
  };

  const calorieStatusClass = (value: number) => {
    const t = dailyCalories;
    if (t <= 0) return 'bmi-normal';
    const ratio = value / t;
    if (ratio > 1.1) return 'cal-dev-over';
    if (ratio < 0.9) return 'cal-dev-under';
    return 'bmi-normal';
  };

  const slotTitle: Record<MealSlot, string> = {
    breakfast: 'Завтрак',
    lunch: 'Обед',
    dinner: 'Ужин',
    snack: 'Перекус',
    snack2: 'Перекус 2',
  };

  const dateLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });

  const selectedMealIngredients = selectedMeal ? mealIngredientsForView(selectedMeal).filter(Boolean) : [];

  /**
   * При открытии блюда проверяем, чего не хватает в холодильнике.
   * Пользователь сразу видит список для покупки, не сверяя вручную.
   */
  useEffect(() => {
    if (!selectedMeal || !user) {
      setFridgeMissing([]);
      return;
    }
    const names = mealIngredientsForView(selectedMeal)
      .map((row) => String(row).split('—')[0]?.trim() ?? '')
      .filter(Boolean)
      .map((name) => ({ name }));
    if (names.length === 0) {
      setFridgeMissing([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await userApi.missingFridge(user.id, names);
        if (!cancelled) setFridgeMissing(Array.isArray(res?.missing) ? res.missing : []);
      } catch {
        if (!cancelled) setFridgeMissing([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMeal, user]);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="profile-premium plan-surface">
      <section className="card section-card">
        <div className="section-head">
          <h3>План питания</h3>
        </div>
        {openPlanMeta && openPlanMeta.status !== 'active' ? (
          <div className="muted small" style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
            <span>Просмотр и правка без отметок приёмов пищи. Чтобы отмечать «съел / пропустил», сделайте план активным.</span>
            <button type="button" className="btn-primary" onClick={() => void activateCurrentPlan()}>
              Сделать этот план активным
            </button>
          </div>
        ) : null}
        <div className="meal-plan-restrictions">
          <h4 className="meal-plan-restrictions-title">Аллергии и ограничения</h4>
          <div className="meal-plan-restrictions-body">
            <p>
              <span className="muted">Аллергены: </span>
              {allergyNamesDisplay.length > 0 ? (
                allergyNamesDisplay.map((name, i) => (
                  <span
                    key={`${name}-${i}`}
                    className="meal-plan-hint-term"
                    title={
                      ALLERGEN_HINTS_RU[name.toLowerCase()] ??
                      `«${name}»: исключаются блюда, где этот аллерген указан в каталоге.`
                    }
                  >
                    {name}
                    {i < allergyNamesDisplay.length - 1 ? ', ' : ''}
                  </span>
                ))
              ) : (
                'не указаны в профиле'
              )}
            </p>
            <p>
              <span className="muted">Диетические ограничения: </span>
              {dietaryRestrictions.length > 0 ? (
                dietaryRestrictions.map((k, i) => (
                  <span
                    key={k}
                    className="meal-plan-hint-term"
                    title={DIET_HINTS_RU[k] ?? `Диета «${DIET_LABELS[k] ?? k}».`}
                  >
                    {DIET_LABELS[k] ?? k}
                    {i < dietaryRestrictions.length - 1 ? ', ' : ''}
                  </span>
                ))
              ) : (
                'не указаны в профиле'
              )}
            </p>
            <p>
              <span className="muted">Любимые продукты и блюда: </span>
              {foodLikes.length > 0 ? foodLikes.join(', ') : 'не указаны в профиле'}
            </p>
            <p>
              <span className="muted">Нежелательные продукты: </span>
              {foodDislikes.length > 0 ? foodDislikes.join(', ') : 'не указаны в профиле'}
            </p>
            {allergyNamesDisplay.length === 0 &&
            dietaryRestrictions.length === 0 &&
            foodLikes.length === 0 &&
            foodDislikes.length === 0 ? (
              <p className="muted small">
                Настроить можно в разделе «Профиль». Если аллергены не заданы, в каталоге отображаются все блюда.
              </p>
            ) : null}
          </div>
        </div>

        <div className="meal-plan-topbar">
          <div className="chip-grid">
            {DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={`allergy-chip ${duration === d ? 'selected' : ''}`}
                onClick={() => {
                  setDuration(d);
                  setDays(emptyDays(d));
                }}
              >
                {durationChipLabel(d)}
                <span className="muted small"> ({d} дн.)</span>
              </button>
            ))}
          </div>
          <div className="muted small">Цель ккал/день: {dailyCalories}</div>
          <div className="muted small">
            Цель: {goal === 'lose' ? 'похудеть' : goal === 'gain' ? 'набрать' : 'поддерживать'}
          </div>
        </div>

        {isLoadingPlan ? <p className="muted">Загрузка плана…</p> : null}

        <div className="goal-cards" style={{ marginTop: 12 }}>
          <button type="button" className={`goal-card ${mode === 'basic' ? 'active' : ''}`} onClick={() => setMode('basic')}>
            <ClipboardList size={18} /> Автоплан
          </button>
          <button type="button" className={`goal-card ${mode === 'ai' ? 'active' : ''}`} onClick={() => setMode('ai')}>
            <Brain size={18} /> AI
          </button>
          <button type="button" className={`goal-card ${mode === 'constructor' ? 'active' : ''}`} onClick={() => setMode('constructor')}>
            <ChefHat size={18} /> Конструктор
          </button>
        </div>

        <div className="stack-row wrap-actions meal-plan-actions" style={{ marginTop: 12 }}>
          {mode === 'basic' ? (
            <button type="button" className="btn-primary" onClick={() => openGenerateModal('auto')}>
              Сгенерировать автоматически
            </button>
          ) : null}
          {mode === 'ai' ? (
            <button type="button" className="btn-primary" onClick={() => openGenerateModal('aiCat')} disabled={isLoadingAi}>
              {isLoadingAi ? '…' : 'Сгенерировать AI по каталогу БД'}
            </button>
          ) : null}
          <button type="button" className="btn-secondary" onClick={saveToServer}>
            Сохранить план
          </button>
          <button type="button" className="btn-secondary" onClick={exportPdf}>
            PDF
          </button>
          {mode === 'constructor' ? (
            <button type="button" className="btn-secondary" onClick={clearAll}>
              Очистить таблицу
            </button>
          ) : null}
          {mode === 'constructor' ? (
            <select
              value={constructorDaysScope}
              onChange={(e) => setConstructorDaysScope(Number(e.target.value) as 1 | 2 | 3 | 7 | 14 | 0)}
              title="Горизонт расчёта списка покупок"
            >
              <option value={1}>На 1 день</option>
              <option value={2}>На 2 дня</option>
              <option value={3}>На 3 дня</option>
              <option value={7}>На 7 дней</option>
              <option value={14}>На 14 дней</option>
              <option value={0}>На весь план</option>
            </select>
          ) : null}
          {/* Анализ конструктора считается синхронно по уже загруженным
              данным, без обращения к серверу — спиннер здесь не нужен. */}
          {mode === 'constructor' ? (
            <button type="button" className="btn-secondary" onClick={() => analyzeConstructorPlan()}>
              Анализ конструктора
            </button>
          ) : null}
          {mode === 'constructor' ? (
            <button
              type="button"
              className="btn-secondary"
              disabled={aiRefineLoading || days.length === 0}
              title="Учитываются любимые и нежелательные продукты из профиля (подсказки для модели и фильтр каталога). ИИ заполнит пустые слоты и при необходимости скорректирует блюда с пояснениями."
              onClick={() => void runAiRefineConstructor()}
            >
              {aiRefineLoading ? <Loader2 size={14} className="btn-spinner" /> : null}
              {aiRefineLoading ? 'ИИ думает…' : 'Доработать с ИИ'}
            </button>
          ) : null}
        </div>
        {mode === 'constructor' ? (
          <p className="muted small" style={{ marginTop: 8 }}>
            Кнопка «Доработать с ИИ» передаёт в модель любимые и нежелательные продукты из профиля (как подсказки),
            плюс диету и аллергены; каталог для подстановки фильтруется с учётом нежелательных ингредиентов.
          </p>
        ) : null}
        {saveMsg ? <p className="success">{saveMsg}</p> : null}
        {mode === 'ai' && aiError ? <p className="error">{aiError}</p> : null}
        {mode === 'constructor' && constructorAudit ? (
          <div className="card" style={{ marginTop: 10 }}>
            <h4>Анализ плана: {constructorAudit.score}/100</h4>
            <p className="muted small">Горизонт расчёта: {constructorAudit.scopeDays} дн.</p>
            <p className="muted small">{constructorAudit.verdict}</p>
            <p className="muted small" style={{ marginTop: 8 }}>
              Сводка по граммам опирается на состав блюд и ваш список продуктов; для точности указывайте единицы г или кг
              (не только шт).
            </p>
            <p className="small">
              <strong>Есть у вас:</strong>{' '}
              {constructorAudit.have.length ? constructorAudit.have.join('; ') : 'нет совпадений по массе'}
            </p>
            <p className="small">
              <strong>Нужно докупить:</strong>{' '}
              {constructorAudit.buy.length ? constructorAudit.buy.join('; ') : 'ничего по расчёту'}
            </p>
            <p className="small">
              <strong>Рекомендации по замене:</strong>{' '}
              {constructorAudit.replace.length ? constructorAudit.replace.join(' | ') : 'критичных замен не найдено'}
            </p>
            <p className="small">
              <strong>Корректировки плана:</strong>{' '}
              {constructorAudit.corrections.length
                ? constructorAudit.corrections.join(' | ')
                : 'дополнительные корректировки не требуются'}
            </p>
          </div>
        ) : null}

        {showTargetModal ? (
          <div className="modal-backdrop">
            <div className="modal-window">
              <h4>Параметры генерации</h4>
              <label className="stack" style={{ display: 'block', marginBottom: 8 }}>
                {pendingGenerate === 'auto'
                  ? 'Целевая калорийность в день (автоплан подгоняет блюда к этому значению, допуск ±10%)'
                  : 'Ккал/день (ориентир для AI-плана по каталогу)'}
                <input
                  type="number"
                  min={800}
                  max={6000}
                  value={targetInput}
                  onChange={(e) => setTargetInput(Number(e.target.value))}
                />
              </label>
              <div className="chip-grid" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => pendingGenerate && void runGenerate(pendingGenerate)}
                >
                  Запустить
                </button>
                <button type="button" className="btn-secondary" onClick={() => setShowTargetModal(false)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {aiRefineModal ? (
          <div className="modal-backdrop">
            <div className="modal-window" style={{ maxWidth: 560 }}>
              <h4>Доработка плана (ИИ)</h4>
              <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
                {aiRefineModal.overview}
              </p>
              {aiRefineModal.warnings.length ? (
                <div className="card" style={{ marginTop: 10 }}>
                  {aiRefineModal.warnings.map((w) => (
                    <p key={w} className="small muted" style={{ margin: '0 0 6px' }}>
                      {w}
                    </p>
                  ))}
                </div>
              ) : null}
              <div style={{ maxHeight: 280, overflow: 'auto', marginTop: 12 }}>
                {aiRefineModal.changes.length === 0 ? (
                  <p className="muted small" style={{ margin: 0 }}>
                    Пояснения по отдельным ячейкам недоступны. Нажмите «Применить»: сервер мог автоматически
                    заполнить пустые слоты из каталога.
                  </p>
                ) : (
                  <>
                    <p className="muted small" style={{ margin: '0 0 6px' }}>
                      Изменения по ячейкам (пояснения модели):
                    </p>
                    <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                      {aiRefineModal.changes.map((c, idx) => (
                        <li key={`${c.day}-${c.slot}-${idx}`} style={{ marginBottom: 8 }}>
                          <strong>
                            День {c.day}, {constructorRefineSlotLabel(c.slot)}
                          </strong>
                          {' — '}
                          {constructorRefineActionLabel(c.action)}
                          {c.dishName ? `: ${c.dishName}` : ''}
                          <div className="muted small">{c.reason}</div>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              <div className="chip-grid" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    const merged = days.map((row) => {
                      const hit = aiRefineModal.days.find((d) => d.dayNumber === row.day);
                      if (!hit) return row;
                      const snack2 =
                        hit.extraSnacks && hit.extraSnacks.length > 0
                          ? snapshotToMeal(hit.extraSnacks[0], 'snack2')
                          : null;
                      return {
                        ...row,
                        meals: {
                          breakfast: snapshotToMeal(hit.breakfast, 'breakfast'),
                          lunch: snapshotToMeal(hit.lunch, 'lunch'),
                          dinner: snapshotToMeal(hit.dinner, 'dinner'),
                          snack: snapshotToMeal(hit.snack, 'snack'),
                          snack2,
                        },
                      };
                    });
                    setDays(merged);
                    analyzeConstructorPlan(merged);
                    setAiRefineModal(null);
                    setSaveMsg(
                      aiRefineModal.changes.length === 0
                        ? `Таблица обновлена: пустые слоты заполнены из каталога (пояснения ИИ недоступны). Сохраните план при необходимости.${reviewPlanMsg}`
                        : `План обновлён по предложению ИИ. При необходимости сохраните его на сервере.${reviewPlanMsg}`,
                    );
                  }}
                >
                  Применить к таблице
                </button>
                <button type="button" className="btn-secondary" onClick={() => setAiRefineModal(null)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {dietConfirm ? (
          <div className="modal-backdrop">
            <div className="modal-window">
              <h4>Блюдо не соответствует ограничениям</h4>
              <p className="muted small">
                Вы можете добавить его принудительно, но рекомендуем выбрать другое.
              </p>
              <ul className="confirm-reasons">
                {dietConfirm.reasons.map((r) => (
                  <li key={r}>
                    <AlertTriangle size={14} aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
              <div className="chip-grid" style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    if (!allowConstructorAlcoholPlacement(dietConfirm.dish)) {
                      setDietConfirm(null);
                      return;
                    }
                    setMealForDay(dietConfirm.day, dietConfirm.slot, dietConfirm.dish);
                    setDietConfirm(null);
                  }}
                >
                  Всё равно добавить
                </button>
                <button type="button" className="btn-secondary" onClick={() => setDietConfirm(null)}>
                  Отмена
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {mode === 'constructor' ? (
            <div className="constructor-layout" style={{ marginTop: 12 }}>
              <div className="card">
                <h4>Каталог блюд</h4>
                <div className="stack" style={{ gap: 8 }}>
                  <input
                    value={dishSearch}
                    onChange={(e) => setDishSearch(e.target.value)}
                    placeholder="Название или ингредиент в составе…"
                  />
                  <select
                    aria-label="Категория блюд"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                  >
                    <option value="">Все категории</option>
                    <option value="breakfast">Завтрак</option>
                    <option value="lunch">Обед</option>
                    <option value="dinner">Ужин</option>
                    <option value="snack">Перекус</option>
                  </select>
                </div>
                <p className="muted small" style={{ marginTop: 8 }}>
                  В каталоге можно искать по названию блюда или по слову из состава. Замок — аллерген (нельзя добавить).
                  Треугольник — возможный конфликт с диетой (можно с подтверждением). Высокий белок подсвечен.
                  {isMinorAlcoholRestricted ? (
                    <> Алкогольные напитки и коктейли в план до 18 лет добавить нельзя.</>
                  ) : null}
                </p>
                <div className="stack dish-scroll" style={{ marginTop: 10 }}>
                  {dishLibrary.map((dish) => (
                    <DraggableDish key={dish.id} dish={dish} onSelect={setSelectedMeal} />
                  ))}
                </div>
              </div>
              <div className="card">
                <h4>Подсказка</h4>
                <p className="muted small">
                  Клик по ячейке открывает карточку. Можно подставить блюдо кнопками быстрого выбора ниже.
                </p>
              </div>
            </div>
        ) : null}

          <div
            ref={pdfRef}
            className={`table-wrap pdf-export meal-plan-pdf ${isExportingPdf ? 'meal-plan-pdf-exporting' : ''}`}
            style={{ marginTop: 14 }}
          >
            <h4 className="pdf-only-heading">План питания</h4>
            <table className="plan-table">
              <thead>
                <tr>
                  <th>Дата</th>
                  {MAIN_SLOTS.map((s) => (
                    <th key={s}>{slotTitle[s]}</th>
                  ))}
                  <th>Ккал</th>
                  <th>Б / Ж / У</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day, rowIndex) => {
                  const dayCalories = totalCalories(day);
                  const mac = dayMacros(day);
                  return (
                    <tr key={day.day} className={rowIndex > 0 && rowIndex % 6 === 0 ? 'meal-pdf-break-before' : undefined}>
                      <td>
                        <strong>{dateLabel(day.date)}</strong>
                        <div className="muted small">День {day.day}</div>
                        {mode === 'constructor' && !isExportingPdf ? (
                          <div className="stack">
                            <button type="button" onClick={() => resetDayPlan(day.day)}>
                              Сбросить день
                            </button>
                            {day.day < days.length ? (
                              <button type="button" onClick={() => copyDayPlan(day.day)}>
                                Копировать на след. день
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </td>
                      {MAIN_SLOTS.map((slot) => {
                        const meal = day.meals[slot];
                        const flags = mealConstraintFlags(meal);
                        const constructorViolation = mode === 'constructor' && flags.labels.length > 0;
                        const pdfStripChrome = isExportingPdf;
                        const trackingCls = mealSlotCardClass(day.mealStatuses[slot]);
                        const slotCardClass = pdfStripChrome
                          ? ''
                          : [trackingCls, constructorViolation ? 'cell-card-constraint' : '']
                              .filter(Boolean)
                              .join(' ');
                        return (
                        <td key={slot}>
                          <DroppableCell id={`drop-${day.day}-${slot}`}>
                            <button
                              type="button"
                              className={`cell-card${slotCardClass ? ` ${slotCardClass}` : ''}`}
                              onClick={() => setSelectedMeal(meal)}
                            >
                              {meal?.name ?? '—'}
                            </button>
                            {constructorViolation && !isExportingPdf ? (
                              <div className="constraint-chip-row">
                                {flags.missingDetailed ? <span className="constraint-badge constraint-badge-missing">нет состава</span> : null}
                                {flags.allergen ? <span className="constraint-badge constraint-badge-allergen">аллерген</span> : null}
                                {flags.diet ? <span className="constraint-badge constraint-badge-diet">диета</span> : null}
                                {flags.dislike ? <span className="constraint-badge constraint-badge-dislike">нежелательный</span> : null}
                              </div>
                            ) : null}
                            {trackingEnabled && meal && !isExportingPdf ? (
                              <>
                                <div className="muted small" style={{ marginTop: 6 }}>
                                  Статус: {mealTrackLabel(day.mealStatuses[slot])}
                                </div>
                                <div className="chip-grid" style={{ marginTop: 6 }}>
                                  <button
                                    type="button"
                                    className={`allergy-chip meal-status-chip meal-status-chip-done ${
                                      day.mealStatuses[slot] === 'done' ? 'selected' : ''
                                    }`}
                                    aria-pressed={day.mealStatuses[slot] === 'done'}
                                    // Повторное нажатие снимает статус — отдельная
                                    // кнопка «Сброс» больше не нужна: три кнопки
                                    // на каждый приём (включая «Сброс») визуально
                                    // заслоняли само блюдо.
                                    onClick={() =>
                                      void setMealStatusForDay(
                                        day,
                                        slot,
                                        day.mealStatuses[slot] === 'done' ? null : 'done',
                                      )
                                    }
                                  >
                                    Съел
                                  </button>
                                  <button
                                    type="button"
                                    className={`allergy-chip meal-status-chip meal-status-chip-skipped ${
                                      day.mealStatuses[slot] === 'skipped' ? 'selected' : ''
                                    }`}
                                    aria-pressed={day.mealStatuses[slot] === 'skipped'}
                                    onClick={() =>
                                      void setMealStatusForDay(
                                        day,
                                        slot,
                                        day.mealStatuses[slot] === 'skipped' ? null : 'skipped',
                                      )
                                    }
                                  >
                                    Пропустил
                                  </button>
                                </div>
                              </>
                            ) : null}
                            {mode === 'constructor' && meal && !isExportingPdf ? (
                              <div className="chip-grid" style={{ marginTop: 6 }}>
                                <button
                                  type="button"
                                  className="allergy-chip"
                                  onClick={() => void clearMealForDay(day, slot)}
                                >
                                  Очистить
                                </button>
                              </div>
                            ) : null}
                            {mode === 'constructor' && selectedMeal && !isExportingPdf ? (
                              <div className="chip-grid" style={{ marginTop: 6 }}>
                                {!catalogSlotMatchesDish(selectedMeal, slot) ? (
                                  <p className="muted small" style={{ gridColumn: '1 / -1', margin: 0 }}>
                                    В каталоге: «{slotTitle[selectedMeal.category]}» · ячейка: «{slotTitle[slot]}»
                                  </p>
                                ) : null}
                                <button
                                  type="button"
                                  className="allergy-chip selected"
                                  onClick={() => selectedMeal && tryPlaceDish(day.day, slot, selectedMeal)}
                                >
                                  Подставить
                                </button>
                              </div>
                            ) : null}
                            {mode === 'constructor' && !selectedMeal && !isExportingPdf ? (
                              <div className="chip-grid" style={{ marginTop: 6 }}>
                                {dishLibrary
                                  .filter((dish) => dishMatchesPlanSlot(dish.category, dish.name, slot))
                                  .slice(0, 3)
                                  .map((dish) => (
                                    <button
                                      key={`${day.day}-${slot}-${dish.id}`}
                                      type="button"
                                      className="allergy-chip"
                                      onClick={() => tryPlaceDish(day.day, slot, dish)}
                                    >
                                      + {dish.name.slice(0, 18)}
                                    </button>
                                  ))}
                              </div>
                            ) : null}
                          </DroppableCell>
                        </td>
                      )})}
                      <td>
                        <strong className={calorieStatusClass(dayCalories)}>{Math.round(dayCalories)}</strong>
                        {!isExportingPdf ? (
                        <div className="progress-track" style={{ marginTop: 6 }}>
                          <span
                            style={{
                              width: `${Math.min(100, Math.round((dayCalories / dailyCalories) * 100))}%`,
                            }}
                          />
                        </div>
                        ) : null}
                      </td>
                      <td className="muted small">
                        {Math.round(mac.p)} / {Math.round(mac.f)} / {Math.round(mac.c)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
      </section>

      {selectedMeal ? (
        <div className="modal-backdrop">
          <div className="modal-window">
            <h3>{selectedMeal.name}</h3>
            <DishThumb
              imageUrl={selectedMeal.imageUrl}
              name={selectedMeal.name}
              slot={inferSlotFromName(selectedMeal.name)}
              size="fill"
              className="meal-detail-modal-photo"
            />
            <p className="macro-line">
              <CalorieValue calories={selectedMeal.calories} />
              <MacroRow
                protein={selectedMeal.protein}
                fat={selectedMeal.fat}
                carbs={selectedMeal.carbs}
              />
            </p>
            <p>
              Аллергены:{' '}
              {selectedMeal.allergens.length
                ? selectedMeal.allergens.map((a) => (
                    <span key={a} className={allergies.includes(a.toLowerCase()) ? 'error' : 'muted'}>
                      {a}{' '}
                    </span>
                  ))
                : 'нет'}
            </p>
            {selectedMeal.note ? <p className="muted small">Почему выбрано: {selectedMeal.note}</p> : null}
            {Array.isArray(selectedMeal.alternatives) && (selectedMeal.alternatives?.length ?? 0) > 0 ? (
              <p className="muted small">
                Альтернативы: {selectedMeal.alternatives?.join(', ')}
              </p>
            ) : null}
            <div className="meal-ingredients-block">
              <strong>Ингредиенты:</strong>
              {selectedMealIngredients.length ? (
                <ul className="muted small meal-ingredients-list">
                  {selectedMealIngredients.map((row, idx) => (
                    <li key={`${row}-${idx}`}>{row}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted small meal-ingredients-empty">
                  Нет данных по ингредиентам
                </p>
              )}

              {fridgeMissing.length > 0 ? (
                <p className="meal-fridge-missing">
                  <ShoppingBasket size={14} /> Докупить:{' '}
                  <span className="meal-fridge-missing-list">{fridgeMissing.join(', ')}</span>
                </p>
              ) : selectedMealIngredients.length > 0 ? (
                <p className="meal-fridge-ok">
                  Все продукты есть в холодильнике
                </p>
              ) : null}
            </div>
            <button type="button" onClick={() => setSelectedMeal(null)}>
              Закрыть
            </button>
          </div>
        </div>
      ) : null}
      </div>
    </DndContext>
  );
};
