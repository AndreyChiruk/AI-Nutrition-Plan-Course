import { randomUUID } from 'crypto';
import type { CatalogAllergenValue, CatalogDietaryTagValue } from '../meal-plan/catalog-ai-normalize';
import {
  normalizeAllergensExpanding,
  normalizeCatalogDietaryTagList,
} from '../meal-plan/catalog-ai-normalize';

type JsonRecord = Record<string, unknown>;

export function extractModelJsonString(raw: string): string {
  let s = raw.trim();
  if (!s) throw new Error('Пустой ответ модели');

  if (s.includes('```')) {
    const block = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
    if (block?.[1]) {
      s = block[1].trim();
    } else {
      s = s
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/```\s*$/g, '')
        .trim();
    }
  }

  s = s.trim();
  if (s.startsWith('{') || s.startsWith('[')) return s;

  const o0 = s.indexOf('{');
  const c0 = s.lastIndexOf('}');
  if (o0 >= 0 && c0 > o0) return s.slice(o0, c0 + 1);

  const a0 = s.indexOf('[');
  const a1 = s.lastIndexOf(']');
  if (a0 >= 0 && a1 > a0) return s.slice(a0, a1 + 1);

  return s;
}

const parseJsonRecord = (text: string): JsonRecord => {
  const jsonStr = extractModelJsonString(text);
  const parsed = JSON.parse(jsonStr) as unknown;
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('OpenAI response is not a JSON object');
  }
  return parsed as JsonRecord;
};

export function extractFirstBalancedJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inStr) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return raw.slice(start, i + 1);
    }
  }
  return null;
}

const parseJsonRecordLenient = (text: string): JsonRecord => {
  try {
    return parseJsonRecord(text);
  } catch {
    const balanced = extractFirstBalancedJsonObject(text);
    if (!balanced) throw new Error('No balanced JSON object in model output');
    const parsed = JSON.parse(balanced) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('OpenAI response is not a JSON object');
    }
    return parsed as JsonRecord;
  }
};

export const parseBodyAnalysisResponse = (text: string) => {
  const parsed = parseJsonRecord(text);
  return {
    estimatedBodyFat: Number(parsed.estimatedBodyFat ?? 20),
    estimatedMuscleMass: Number(parsed.estimatedMuscleMass ?? 40),
    aiNotes:
      typeof parsed.aiNotes === 'string'
        ? parsed.aiNotes
        : 'Анализ по снимку сгенерирован; уточните данные у специалиста при сомнениях.',
  };
};

export type FoodAiIngredient = {
  name: string;
  grams: number;
};

export type FoodAiIngredientDetailed = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  grams: number;
  originalString?: string;
  ingredientId?: string;
};

export type FoodAiItem = {
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  /** Аллергены: значения справочника + возможные нераспознанные от модели. */
  allergensFound: string[];
  dietaryTags: CatalogDietaryTagValue[];
  ingredients: FoodAiIngredient[];
  ingredientsDetailed: FoodAiIngredientDetailed[];
};

export const parseFoodImageRecognitionResponse = (text: string): { confidence: number; items: FoodAiItem[] } => {
  const parsed = parseJsonRecord(text);
  const confidence = Math.min(1, Math.max(0, Number(parsed.confidence ?? 0.6)));
  const raw = parsed.items;
  if (!Array.isArray(raw)) {
    throw new Error('Food recognition: items[] missing');
  }
  if (raw.length === 0) {
    return { confidence: 0, items: [] };
  }
  const slugBase = (name: string, idx: number) =>
    String(name)
      .toLowerCase()
      .replace(/[^a-zа-яё0-9]+/gi, '')
      .slice(0, 16) || `item-${idx}`;

  const items: FoodAiItem[] = raw.slice(0, 8).map((row: unknown, idx: number) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Food recognition: invalid item');
    }
    const r = row as Record<string, unknown>;
    const foodName = typeof r.foodName === 'string' ? r.foodName.trim() : 'Блюдо';
    const slug = slugBase(foodName, idx);

    const rawAllergens =
      Array.isArray(r.allergensFound) && r.allergensFound.length
        ? r.allergensFound
        : Array.isArray(r.allergens)
          ? r.allergens
          : [];
    // Сохраняем и нераспознанные значения: если модель вернула «майонез»
    // или «сыр», потерять их нельзя — иначе пропадёт предупреждение об аллергене.
    const allergensFound = normalizeAllergensExpanding(rawAllergens).all;

    const rawDiets = Array.isArray(r.dietaryTags) ? r.dietaryTags : [];
    const dietaryTags = normalizeCatalogDietaryTagList(rawDiets);

    const ingRaw = Array.isArray(r.ingredients) ? r.ingredients : [];
    const ingredients: FoodAiIngredient[] = ingRaw
      .map((it: unknown) => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
        const x = it as Record<string, unknown>;
        const name = typeof x.name === 'string' ? x.name.trim() : '';
        const grams = Math.max(0, Number(x.grams ?? 0));
        if (!name) return null;
        return { name, grams };
      })
      .filter((x): x is FoodAiIngredient => x != null)
      .slice(0, 24);

    const detRaw = Array.isArray(r.ingredientsDetailed) ? r.ingredientsDetailed : [];
    const ingredientsDetailed: FoodAiIngredientDetailed[] = detRaw
      .map((it: unknown, j: number): FoodAiIngredientDetailed | null => {
        if (!it || typeof it !== 'object' || Array.isArray(it)) return null;
        const x = it as Record<string, unknown>;
        const name = typeof x.name === 'string' ? x.name.trim() : '';
        if (!name) return null;
        const grams = Math.max(0, Number(x.grams ?? x.weightGrams ?? 0));
        const unit = typeof x.unit === 'string' && x.unit.trim() ? x.unit.trim() : 'г';
        const amountRaw = Number(x.amount ?? grams ?? 0);
        const amount = Number.isFinite(amountRaw) && amountRaw >= 0 ? amountRaw : grams || 1;
        const g = grams > 0 ? grams : amount;
        const id =
          typeof x.id === 'string' && x.id.trim()
            ? x.id.trim()
            : `${slug}-det-${j}-${randomUUID().slice(0, 8)}`;
        const originalString =
          typeof x.originalString === 'string' && x.originalString.trim()
            ? x.originalString.trim()
            : undefined;
        const ingredientId =
          typeof x.ingredientId === 'string' && x.ingredientId.trim() ? x.ingredientId.trim() : undefined;
        const out: FoodAiIngredientDetailed = {
          id,
          name,
          amount,
          unit,
          grams: g,
        };
        if (originalString) out.originalString = originalString;
        if (ingredientId) out.ingredientId = ingredientId;
        return out;
      })
      .filter((x): x is FoodAiIngredientDetailed => x != null)
      .slice(0, 30);

    return {
      foodName,
      calories: Math.max(0, Number(r.calories ?? 0)),
      protein: Math.max(0, Number(r.protein ?? 0)),
      fat: Math.max(0, Number(r.fat ?? 0)),
      carbs: Math.max(0, Number(r.carbs ?? 0)),
      allergensFound,
      dietaryTags,
      ingredients,
      ingredientsDetailed,
    };
  });
  return { confidence, items };
};

export const parseNutritionRecommendationResponse = (text: string) => {
  const parsed = parseJsonRecord(text);
  const actions = Array.isArray(parsed.actions)
    ? parsed.actions.filter((item): item is string => typeof item === 'string')
    : [];

  return {
    summary:
      typeof parsed.summary === 'string'
        ? parsed.summary
        : 'Персональные рекомендации сформированы. Следите за балансом КБЖУ и реакцией организма.',
    actions:
      actions.length > 0
        ? actions
        : [
            'Сохраняйте стабильный режим питания',
            'Контролируйте калории и порции ежедневно',
          ],
  };
};

export const parseMealPlanCatalogResponse = (text: string) => {
  const parsed = parseJsonRecord(text);
  if (!Array.isArray(parsed.days)) {
    throw new Error('Meal plan catalog response does not contain days[]');
  }
  return parsed;
};

export type ConstructorRefinementChange = {
  day: number;
  slot: 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'snack2';
  action: 'keep' | 'fill' | 'replace';
  dishName?: string;
  previousDishName?: string;
  reason: string;
};

export const parseConstructorRefinementResponse = (text: string): {
  overview: string;
  changes: ConstructorRefinementChange[];
} => {
  const parsed = parseJsonRecordLenient(text);
  const overview =
    typeof parsed.overview === 'string'
      ? parsed.overview
      : 'План доработан по вашим ограничениям и текущей сетке.';
  const raw = Array.isArray(parsed.changes) ? parsed.changes : [];
  const slots = new Set(['breakfast', 'lunch', 'dinner', 'snack', 'snack2']);
  const changes: ConstructorRefinementChange[] = [];
  for (const row of raw) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) continue;
    const r = row as JsonRecord;
    const day = Number(r.day);
    const slot = String(r.slot ?? '').trim();
    const action = String(r.action ?? '').trim().toLowerCase();
    const reason = typeof r.reason === 'string' ? r.reason.trim() : '';
    if (!Number.isFinite(day) || day < 1 || !slots.has(slot)) continue;
    if (action !== 'keep' && action !== 'fill' && action !== 'replace') continue;
    changes.push({
      day,
      slot: slot as ConstructorRefinementChange['slot'],
      action: action as ConstructorRefinementChange['action'],
      dishName: typeof r.dishName === 'string' ? r.dishName.trim() : '',
      previousDishName: typeof r.previousDishName === 'string' ? r.previousDishName.trim() : '',
      reason: reason || 'Без пояснения модели.',
    });
  }
  return { overview, changes };
};

export const parseBodyForecastResponse = (text: string) => {
  const parsed = parseJsonRecord(text);
  const milestones = Array.isArray(parsed.milestones)
    ? parsed.milestones.filter((m): m is { week: number; note: string } => {
        if (!m || typeof m !== 'object' || Array.isArray(m)) return false;
        const row = m as JsonRecord;
        return typeof row.note === 'string' && Number.isFinite(Number(row.week));
      })
    : [];
  return {
    summary:
      typeof parsed.summary === 'string'
        ? parsed.summary
        : 'Прогноз рассчитан по цели и текущим показателям.',
    milestones: milestones.map((m) => ({
      week: Number((m as JsonRecord).week),
      note: String((m as JsonRecord).note),
    })),
    visualDescription:
      typeof parsed.visualDescription === 'string'
        ? parsed.visualDescription
        : 'Распределение нагрузки по тренировкам и питанию повлияет на контуры тела ровнее всего при постоянстве режима.',
    disclaimer:
      typeof parsed.disclaimer === 'string'
        ? parsed.disclaimer
        : 'Результат зависит от режима, сна и медицинских ограничений.',
  };
};
