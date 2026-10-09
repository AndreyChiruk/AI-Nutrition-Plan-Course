import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { toFile } from 'openai';
import type OpenAI from 'openai';
import {
  openrouter,
  isOpenRouterConfigured,
  OPENROUTER_MISSING_KEY_MESSAGE,
} from '../config/openrouter';
import { AI_MODELS, normalizeModelId } from '../config/ai-models';
import type { ImagesResponse } from 'openai/resources/images';
import { FOOD_RECOGNITION_JSON_SCHEMA, jsonSchemaFormat } from './openai.schemas';
import { OpenAiUsageService } from './openai-usage.service';
import {
  AI_OUTPUT_RUSSIAN,
  buildBodyAnalysisPrompt,
  buildFoodImageRecognitionPrompt,
  buildBodyForecastImagePrompt,
  buildBodyForecastImagePromptMinimal,
  buildBodyForecastPrompt,
  buildChatPrompt,
  type ChatPromptInput,
  buildConstructorRefinementPrompt,
  buildMealPlanFromCatalogPrompt,
  buildNutritionRecommendationPrompt,
  type ConstructorRefinementCatalogInput,
  type NutritionRecommendationInput,
} from './openai.prompts';
import {
  parseBodyAnalysisResponse,
  parseFoodImageRecognitionResponse,
  parseBodyForecastResponse,
  type ConstructorRefinementChange,
  parseConstructorRefinementResponse,
  parseMealPlanCatalogResponse,
  parseNutritionRecommendationResponse,
} from './openai.validators';
import {
  bufferToPngForImageEdit,
  getNormalizedImageSize,
  parseDataUrlToBuffer,
  resizePngToFitInside,
} from './forecast-image.util';
import {
  CATALOG_ALLERGEN_VALUES,
  CATALOG_DIETARY_TAG_VALUES,
  normalizeCatalogAllergenList,
  normalizeCatalogDietaryTagList,
} from '../meal-plan/catalog-ai-normalize';

type MealPlanInput = {
  days: number;
  gender: 'male' | 'female';
  age: number;
  weight: number;
  height: number;
  goal: 'lose' | 'maintain' | 'gain';
  calories: number;
  allergies: string[];
  dietaryRestrictions?: string[];
  foodLikes?: string[];
  foodDislikes?: string[];
  fridgeProducts?: string[];
};

type MealPlanCatalogInput = MealPlanInput & { dishNames: string[] };

/**
 * Входные данные для ответа ассистента.
 *
 * Тип берётся из построителя промта, чтобы описание профиля было
 * описано в ОДНОМ месте: раньше здесь была копия, из-за которой новые
 * поля (диета, предпочтения) не доходили до промта.
 */
type ChatReplyInput = ChatPromptInput;

type BodyForecastInput = {
  durationWeeks: number;
  goal: 'lose' | 'maintain' | 'gain';
  gender: 'male' | 'female';
  weight: number;
  height: number;
  bodyFat: number;
  muscle: number;
};

type DishLocalizationInput = {
  name: string;
  category?: string;
  ingredientsSeed?: Array<{ name: string; grams?: number }>;
};

/**
 * Короткое описание ошибки AI-запроса для логов.
 *
 * `String(error)` у ошибок SDK даёт «Error», без кода и текста ответа.
 * Здесь собираем то, что помогает понять причину: код HTTP, сообщение
 * провайдера и тип ошибки.
 */
function describeAiError(error: unknown): string {
  const e = error as {
    status?: number;
    code?: string;
    message?: string;
    response?: { data?: { error?: { message?: string } } };
  };
  const parts: string[] = [];
  if (e?.status) parts.push(`HTTP ${e.status}`);
  if (e?.code) parts.push(String(e.code));
  const providerMessage = e?.response?.data?.error?.message;
  if (providerMessage) parts.push(providerMessage);
  else if (e?.message) parts.push(e.message);
  return parts.join(' | ') || 'неизвестная ошибка';
}

/** Код ошибки для ответа клиенту. */
function aiErrorCode(error: unknown): string {
  const e = error as { status?: number; code?: string };
  if (e?.status) return `http_${e.status}`;
  if (e?.code) return String(e.code);
  return 'ai_request_failed';
}

@Injectable()
export class OpenAiService {
  private readonly logger = new Logger(OpenAiService.name);
  private readonly client: OpenAI | null;
  private readonly model: string;
  private readonly maxOutputTokens: number;

  constructor(private readonly usage: OpenAiUsageService) {
    this.maxOutputTokens = Number(process.env.OPENAI_MAX_TOKENS ?? 700);
    // Модель приводится к формату OpenRouter (`провайдер/модель`):
    // в существующих .env значение может быть без префикса.
    this.model = normalizeModelId(
      process.env.OPENAI_MODEL ?? AI_MODELS.PLAN_GENERATION,
    );
    // Клиент общий для всего приложения (см. config/openrouter.ts).
    this.client = openrouter;
  }

  async analyzeBodyFromPhoto(photoUrl: string) {
    if (!this.client) {
      return {
        estimatedBodyFat: 20,
        estimatedMuscleMass: 40,
        aiNotes:
          'API-ключ OpenAI не настроен. Показаны ориентировочные значения; для разбора фото настройте ключ в .env',
      };
    }

    try {
      const response = await this.client.responses.create({
        model: AI_MODELS.BODY_ANALYSIS,
        instructions: AI_OUTPUT_RUSSIAN,
        input: [
          {
            role: 'user',
            content: [
              {
                type: 'input_text',
                text: buildBodyAnalysisPrompt(),
              },
              {
                type: 'input_image',
                image_url: photoUrl,
                detail: 'auto',
              },
            ],
          },
        ],
        max_output_tokens: this.maxOutputTokens,
      });

      const text = response.output_text?.trim();
      if (!text) throw new Error('OpenAI returned empty response text');
      return parseBodyAnalysisResponse(text);
    } catch (error) {
      this.logger.warn(`Body analysis fallback used: ${String(error)}`);
      return {
        estimatedBodyFat: 20,
        estimatedMuscleMass: 40,
        aiNotes: 'Не удалось разобрать ответ AI. Показаны ориентировочные значения.',
      };
    }
  }

  async recognizeFoodFromPhoto(photoUrl: string) {
    if (!this.client) {
      return null;
    }
    const startedAt = Date.now();
    try {
      // Structured Outputs: модель обязана вернуть JSON по схеме,
      // а не свободный текст, который потом вырезается регуляркой.
      const response = await this.client.responses.create({
        model: AI_MODELS.FOOD_RECOGNITION,
        instructions: AI_OUTPUT_RUSSIAN,
        input: [
          {
            role: 'user',
            content: [
              { type: 'input_text', text: buildFoodImageRecognitionPrompt() },
              { type: 'input_image', image_url: photoUrl, detail: 'high' },
            ],
          },
        ],
        max_output_tokens: Math.max(this.maxOutputTokens, 2200),
        text: { format: jsonSchemaFormat('food_recognition', FOOD_RECOGNITION_JSON_SCHEMA) as never },
      });

      this.usage.record({
        operation: 'food_recognition',
        model: AI_MODELS.FOOD_RECOGNITION,
        response,
        durationMs: Date.now() - startedAt,
      });

      const text = response.output_text?.trim();
      if (!text) throw new Error('OpenAI returned empty food recognition text');
      return parseFoodImageRecognitionResponse(text);
    } catch (error) {
      this.usage.record({
        operation: 'food_recognition',
        model: AI_MODELS.FOOD_RECOGNITION,
        durationMs: Date.now() - startedAt,
        ok: false,
      });
      this.logger.warn(`Food recognition failed: ${String(error)}`);
      throw error;
    }
  }

  /**
   * Модель по умолчанию — для отображения в интерфейсе и отчётах
   * об использовании. Конкретные вызовы используют свои модели
   * (см. `AI_MODELS`), поэтому это значение носит справочный характер.
   */
  getModelLabel() {
    return this.model;
  }

  isConfigured() {
    return Boolean(this.client);
  }

  private responsesOutputPlainText(output: unknown): string {
    if (!Array.isArray(output)) return '';
    const chunks: string[] = [];
    for (const item of output) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      if (o.type !== 'message') continue;
      const content = o.content;
      if (!Array.isArray(content)) continue;
      for (const part of content) {
        if (!part || typeof part !== 'object') continue;
        const p = part as Record<string, unknown>;
        if (p.type === 'output_text' && typeof p.text === 'string') chunks.push(p.text);
      }
    }
    return chunks.join('');
  }

  private refinementMaxOutputTokens(): number {
    const n = Number(process.env.OPENAI_REFINEMENT_MAX_TOKENS ?? 12000);
    if (!Number.isFinite(n) || n < 2048) return 12000;
    return Math.min(40000, n);
  }

  async localizeDishForCatalog(input: DishLocalizationInput): Promise<{
    nameRu: string;
    ingredients: Array<{ name: string; amount?: number; unit?: string }>;
    allergens?: string[];
    dietaryTags?: string[];
  } | null> {
    if (!this.client) return null;
    const seed = (input.ingredientsSeed ?? [])
      .slice(0, 25)
      .map((row) => `${row.name}${row.grams ? ` (${row.grams} г)` : ''}`)
      .join(', ');
    const prompt = `Ты помощник локализации кулинарного каталога.
Верни строго JSON (без markdown):
{
  "nameRu": "русское название блюда",
  "ingredients": [{"name":"ингредиент на русском","amount": 1, "unit":"шт"}],
  "allergens": ["лактоза","глютен","арахис"],
  "dietaryTags": ["vegetarian","lactose-free"]
}

Правила:
- Переведи название блюда "${input.name}" на русский.
- Используй естественное кулинарное название на русском, а НЕ дословный машинный перевод.
- Если это известный коктейль/блюдо, используй распространённое русское наименование.
- Категория слота: "${input.category ?? 'unknown'}".
- Если есть исходные ингредиенты, используй их как основу: ${seed || 'не указано'}.
- ingredients: 3-15 позиций, все названия на русском.
- unit: одно из ["г","кг","мл","л","шт","ч.л.","ст.л.","щепотка"].
- amount: положительное число.
- allergens: массив ТОЛЬКО из значений ${JSON.stringify([...CATALOG_ALLERGEN_VALUES])}.
- dietaryTags: массив ТОЛЬКО из ключей ${JSON.stringify([...CATALOG_DIETARY_TAG_VALUES])}.
- ВАЖНО: укажи ПОЛНЫЙ набор всех подходящих значений для этого блюда в allergens и dietaryTags (без пропусков и без лишних значений).
- Если подходит несколько значений, верни все подходящие значения сразу.
- Не возвращай "примерный" или "частичный" набор — только максимально полный и точный список по составу блюда.
- Если значение неизвестно, верни пустой массив.`;
    const retries = 2;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await this.client.responses.create({
          model: AI_MODELS.FOOD_RECOGNITION,
          instructions: AI_OUTPUT_RUSSIAN,
          input: prompt,
          max_output_tokens: Math.max(this.maxOutputTokens, 900),
        });
        const text = response.output_text?.trim();
        if (!text) {
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
            continue;
          }
          return null;
        }
        const cleaned = text.replace(/^```json\s*/i, '').replace(/^```/, '').replace(/```$/, '').trim();
        const parsed = JSON.parse(cleaned) as {
          nameRu?: unknown;
          ingredients?: Array<{ name?: unknown; amount?: unknown; unit?: unknown }>;
          allergens?: unknown;
          dietaryTags?: unknown;
        };
        const nameRu = String(parsed.nameRu ?? '').trim();
        const ingredients = Array.isArray(parsed.ingredients)
          ? parsed.ingredients
              .map((row) => ({
                name: String(row?.name ?? '').trim(),
                amount: Number(row?.amount),
                unit: String(row?.unit ?? '').trim(),
              }))
              .filter((row) => row.name.length > 0)
          : [];
        const allergens = normalizeCatalogAllergenList(parsed.allergens);
        const dietaryTags = normalizeCatalogDietaryTagList(parsed.dietaryTags);
        if (!nameRu || ingredients.length === 0) {
          if (attempt < retries) {
            await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
            continue;
          }
          return null;
        }
        return { nameRu, ingredients, allergens, dietaryTags };
      } catch (error) {
        const msg = String(error);
        const retriable = /timeout|timed out|connection|rate|429|overloaded|network/i.test(msg);
        if (attempt < retries && retriable) {
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
          continue;
        }
        this.logger.warn(`Dish localization failed: ${msg}`);
        return null;
      }
    }
    return null;
  }

  async generateNutritionRecommendation(input: NutritionRecommendationInput) {
    if (!this.client) {
      const hasRestrictions =
        (input.allergies?.length ?? 0) > 0 ||
        (input.dietaryRestrictions?.length ?? 0) > 0 ||
        (input.foodDislikes?.length ?? 0) > 0;
      return {
        summary: hasRestrictions
          ? 'Ключ OpenAI не настроен. Ниже общие ориентиры; приём пищи подбирайте с учётом аллергий и диеты из профиля.'
          : 'Ключ OpenAI не настроен; ниже базовые советы без персонализации.',
        actions: [
          'Добавьте белок в каждый основной приём пищи в рамках ваших ограничений',
          'Пейте не меньше 1,5–2 л воды в день, если нет противопоказаний',
          ...(hasRestrictions
            ? ['Не употребляйте продукты с аллергенами из профиля; проверяйте состав готовых блюд']
            : []),
        ],
      };
    }

    try {
      const prompt = buildNutritionRecommendationPrompt(input);

      const response = await this.client.responses.create({
        model: AI_MODELS.RECOMMENDATIONS,
        instructions: AI_OUTPUT_RUSSIAN,
        input: prompt,
        max_output_tokens: this.maxOutputTokens,
      });
      const text = response.output_text?.trim();
      if (!text) throw new Error('OpenAI returned empty response text');
      return parseNutritionRecommendationResponse(text);
    } catch (error) {
      this.logger.warn(`Recommendation fallback used: ${String(error)}`);
      return {
        summary: 'Не удалось разобрать рекомендацию AI. Ниже общие ориентиры.',
        actions: [
          'Старайтесь укладываться в целевую калорийность',
          'Добавляйте овощи в обед и ужин',
        ],
      };
    }
  }

  async generateMealPlanFromCatalog(input: MealPlanCatalogInput) {
    if (!this.client || input.dishNames.length === 0) {
      const first = input.dishNames[0] ?? 'Овсянка';
      return {
        days: Array.from({ length: input.days }).map((_, index) => ({
          day: index + 1,
          meals: {
            breakfast: first,
            lunch: first,
            dinner: first,
            snack: first,
            snacks: [] as string[],
          },
        })),
      };
    }

    const prompt = buildMealPlanFromCatalogPrompt(input);
    try {
      const response = await this.client.responses.create({
        model: AI_MODELS.PLAN_GENERATION,
        instructions: AI_OUTPUT_RUSSIAN,
        input: prompt,
        max_output_tokens: Math.min(4000, this.maxOutputTokens * 4),
      });
      const text = response.output_text?.trim();
      if (!text) throw new Error('Empty AI catalog meal plan');
      return parseMealPlanCatalogResponse(text);
    } catch (error) {
      this.logger.warn(`Catalog meal plan fallback: ${String(error)}`);
      const pick = (i: number) => input.dishNames[i % input.dishNames.length];
      return {
        days: Array.from({ length: input.days }).map((_, index) => ({
          day: index + 1,
          meals: {
            breakfast: pick(index),
            lunch: pick(index + 1),
            dinner: pick(index + 2),
            snack: pick(index + 3),
            snacks: [] as string[],
          },
        })),
      };
    }
  }

  async refineConstructorPlanFromCatalog(
    input: ConstructorRefinementCatalogInput,
  ): Promise<{ overview: string; changes: ConstructorRefinementChange[] }> {
    if (!this.client || input.dishNames.length === 0) {
      return {
        overview:
          input.dishNames.length === 0
            ? 'В каталоге нет блюд с учётом ваших ограничений. Заполните слоты вручную или пополните каталог.'
            : 'Ключ OpenAI не настроен на сервере. Пустые ячейки можно заполнить автоматически из каталога или вручную.',
        changes: [],
      };
    }

    const prompt = buildConstructorRefinementPrompt(input);
    const maxOut = this.refinementMaxOutputTokens();

    const parseRefinement = (label: string, raw: string) => {
      const text = raw.trim();
      if (!text) throw new Error(`${label}: empty text`);
      return parseConstructorRefinementResponse(text);
    };

    try {
      const response = await this.client.responses.create({
        model: AI_MODELS.PLAN_GENERATION,
        instructions: AI_OUTPUT_RUSSIAN,
        input: prompt,
        max_output_tokens: maxOut,
      });
      if (response.incomplete_details?.reason === 'max_output_tokens') {
        this.logger.warn(
          'Constructor refinement: response truncated at max_output_tokens — JSON may be incomplete',
        );
      }
      let text = (response.output_text ?? '').trim();
      if (!text) text = this.responsesOutputPlainText(response.output).trim();
      if (!text) throw new Error('Empty AI constructor refinement (output_text and output items)');
      return parseRefinement('responses', text);
    } catch (error) {
      this.logger.warn(`Constructor refinement Responses API: ${String(error)}`);
    }

    try {
      const completion = await this.client.chat.completions.create({
        model: AI_MODELS.PLAN_GENERATION,
        messages: [
          { role: 'system', content: AI_OUTPUT_RUSSIAN },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: maxOut,
      });
      const text = completion.choices[0]?.message?.content?.trim();
      return parseRefinement('chat.completions', text ?? '');
    } catch (error) {
      this.logger.warn(`Constructor refinement fallback: ${String(error)}`);
      return {
        overview:
          '',
        changes: [],
      };
    }
  }

  async generateChatReply(input: ChatReplyInput) {
    if (!this.client) {
      return 'Ключ API не настроен. Кратко: придерживайтесь режима питания, отслеживайте калории и учитывайте аллергии.';
    }

    const prompt = buildChatPrompt(input);
    try {
      const response = await this.client.responses.create({
        model: AI_MODELS.CHAT,
        instructions: AI_OUTPUT_RUSSIAN,
        input: prompt,
        max_output_tokens: this.maxOutputTokens,
      });
      const text = response.output_text?.trim();
      if (text) return text;
    } catch (error) {
      this.logger.warn(
        `Chat responses API failed: ${describeAiError(error)}. Пробуем chat.completions.`,
      );
    }
    try {
      const completion = await this.client.chat.completions.create({
        model: AI_MODELS.CHAT,
        messages: [
          { role: 'system', content: AI_OUTPUT_RUSSIAN },
          { role: 'user', content: prompt },
        ],
        max_completion_tokens: this.maxOutputTokens,
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (text) return text;
    } catch (error) {
      this.logger.error(`Chat fallback failed: ${describeAiError(error)}`);
      // Ошибку пробрасываем наверх: вызывающий код вернёт пользователю
      // понятный ответ со статусом 502, а не текст-заглушку, по которому
      // невозможно понять, что именно сломалось.
      throw new ServiceUnavailableException({
        error: 'ai_unavailable',
        message: 'AI временно недоступен. Попробуйте позже.',
        details: aiErrorCode(error),
      });
    }
    return 'Не удалось получить ответ AI. Попробуйте переформулировать вопрос или повторите позже.';
  }

  async generateBodyForecast(input: BodyForecastInput) {
    const baseMilestones = Array.from({ length: Math.min(input.durationWeeks, 8) }, (_, i) => ({
      week: i + 1,
      note:
        input.goal === 'lose'
          ? 'Удержание дефицита калорий и белка, контроль порций'
          : input.goal === 'gain'
            ? 'Постепенное увеличение калорий и нагрузки в зале'
            : 'Стабильное питание и активность без резких скачков',
    }));

    if (!this.client) {
      return {
        summary:
          'Ключ API не настроен. Ориентир: при стабильном питании и тренировках изменения фигуры обычно заметны через несколько недель.',
        milestones: baseMilestones,
        visualDescription:
          'При снижении веса обычно первыми меняются талия и лицо; при наборе — плечи и бёдра при заметном калорийном профиците.',
        disclaimer:
          'Индивидуальный результат зависит от генетики и здоровья; при болезнях обратитесь к врачу.',
      };
    }

    try {
      const prompt = buildBodyForecastPrompt({
        durationWeeks: input.durationWeeks,
        goal: input.goal,
        gender: input.gender,
        weight: input.weight,
        height: input.height,
        bodyFat: input.bodyFat,
        muscle: input.muscle,
      });
      const response = await this.client.responses.create({
        model: AI_MODELS.BODY_ANALYSIS,
        instructions: AI_OUTPUT_RUSSIAN,
        input: prompt,
        max_output_tokens: this.maxOutputTokens,
      });
      const text = response.output_text?.trim();
      if (!text) throw new Error('Empty body forecast');
      return parseBodyForecastResponse(text);
    } catch (error) {
      this.logger.warn(`Body forecast fallback used: ${String(error)}`);
      return {
        summary: 'Не удалось разобрать ответ AI. Ниже ориентиры без детализации.',
        milestones: baseMilestones,
        visualDescription:
          'Визуально прогресс проявляется неравномерно по зонам; талия и верх тела часто реагируют быстрее.',
        disclaimer:
          'Прогноз ориентировочный; для персонального плана обратитесь к специалисту.',
      };
    }
  }

  async generateBodyForecastIllustration(
    photoDataUrl: string,
    input: {
      weeks: number;
      goal: 'lose' | 'maintain' | 'gain';
      gender: 'male' | 'female';
    },
  ): Promise<string | null> {
    if (!this.client) return null;
    const raw = parseDataUrlToBuffer(photoDataUrl);
    if (!raw) {
      this.logger.warn('Forecast image: photo is not a data URL');
      return null;
    }
    let png: Buffer;
    let sourceSize: { width: number; height: number } | null = null;
    try {
      sourceSize = await getNormalizedImageSize(raw);
      png = await bufferToPngForImageEdit(raw);
    } catch (e) {
      this.logger.warn(`Forecast image: decode/resize failed: ${String(e)}`);
      return null;
    }
    if (png.length > 25 * 1024 * 1024) {
      this.logger.warn('Forecast image: PNG too large after processing');
      return null;
    }

    const modelEnv = normalizeModelId(
      process.env.OPENAI_IMAGE_MODEL ?? AI_MODELS.IMAGE,
    );
    const isMini = modelEnv.includes('mini');

    const editSize: '1024x1024' | '1024x1536' | '1536x1024' | 'auto' = (() => {
      const s = process.env.OPENAI_FORECAST_IMAGE_SIZE;
      if (s === '1024x1024' || s === '1024x1536' || s === '1536x1024' || s === 'auto') return s;
      return '1024x1536';
    })();

    const runEdit = async (prompt: string, fidelity: 'high' | 'low') => {
      const file = await toFile(png, 'body.png', { type: 'image/png' });
      return this.client!.images.edit(
        {
          model: modelEnv,
          image: file,
          prompt,
          n: 1,
          size: editSize,
          stream: false,
          ...(isMini ? {} : { input_fidelity: fidelity }),
        } as Parameters<OpenAI['images']['edit']>[0],
        { timeout: 180_000 },
      ) as Promise<ImagesResponse>;
    };

    const attempts: Array<{ prompt: string; fidelity: 'high' | 'low' }> = [
      { prompt: buildBodyForecastImagePrompt(input), fidelity: isMini ? 'low' : 'high' },
      { prompt: buildBodyForecastImagePromptMinimal(input), fidelity: isMini ? 'low' : 'high' },
    ];

    for (let i = 0; i < attempts.length; i++) {
      const { prompt, fidelity } = attempts[i]!;
      try {
        const res = await runEdit(prompt, fidelity);
        const b64 = res.data?.[0]?.b64_json;
        if (!b64) {
          this.logger.warn(`Forecast image: empty data (attempt ${i + 1})`);
        } else {
          if (!sourceSize) {
            return `data:image/png;base64,${b64}`;
          }
          try {
            const generated = Buffer.from(b64, 'base64');
            const fitted = await resizePngToFitInside(
              generated,
              Math.max(1, sourceSize.width),
              Math.max(1, sourceSize.height),
            );
            return `data:image/png;base64,${fitted.toString('base64')}`;
          } catch (resizeErr) {
            this.logger.warn(`Forecast image: post-resize failed, use raw result. ${String(resizeErr)}`);
            return `data:image/png;base64,${b64}`;
          }
        }
      } catch (e) {
        const msg = String(e);
        this.logger.warn(`Forecast image attempt ${i + 1}: ${msg}`);
        const isSafety = /safety|safety_violations|rejected by the safety/i.test(msg);
        if (i === 0 && isSafety) {
          this.logger.log('Forecast image: retrying with minimal prompt');
          continue;
        }
        return null;
      }
    }
    return null;
  }
}
