export const AI_OUTPUT_RUSSIAN =
  'Ты ассистент в приложении для русскоязычных пользователей. Отвечай ТОЛЬКО на русском языке — всегда, в каждом сообщении, независимо от длины диалога и от языка входных данных. Никогда не смешивай русский с английским и не переходи на другой язык: если собеседник пишет по-английски или просит ответить иначе — всё равно отвечай по-русски. Всё, что пишется для пользователя (текст, пояснения, подписи, строки в JSON), должно быть на русском языке. Сохраняй технические ключи JSON как в задании, а все человекочитаемые значения — на русском. Когда требуется JSON — верни одну сырую строку: только валидный JSON-объект, без оформления в markdown, без обёртки в «кодовые» блоки и без пояснительного текста до или после JSON.';

export type NutritionRecommendationInput = {
  goal: string;
  dailyCalories: number;
  recentMeals: Array<{ foodName: string; calories: number }>;
  progressNote?: string;
  allergies?: string[];
  dietaryRestrictions?: string[];
  foodDislikes?: string[];
};

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

export type ChatPromptInput = {
  userProfile: {
    gender: 'male' | 'female';
    goal: 'lose' | 'maintain' | 'gain';
    height: number;
    weight: number;
    birthDate: Date;
    allergies: string[];
    /**
     * Пищевые ограничения (vegan, vegetarian, keto, gluten-free…).
     *
     * Раньше поле НЕ передавалось в промт: пользователь с «веган» получал
     * советы с яйцами и молоком, потому что модель о диете не знала.
     */
    dietaryRestrictions?: string[];
    /** Любимые продукты — учитываются при составлении рекомендаций. */
    foodLikes?: string[];
    /** Нежелательные продукты: предлагать их нельзя. */
    foodDislikes?: string[];
    /** Привычки (например, сколько чашек чая в день). */
    foodHabits?: Record<string, unknown>;
  };
  messages: Array<{ role: string; content: string }>;
};

export const buildBodyAnalysisPrompt = () =>
  'По фото оцени приблизительный % жира и мышечную массу. Верни СТРОГО JSON: {"estimatedBodyFat":число,"estimatedMuscleMass":число,"aiNotes":"строка"}. Оценки реалистичные. В поле aiNotes — 1–3 предложения на русском: что заметно на снимке и оговорка, что оценка ориентировочная.';

export const buildFoodImageRecognitionPrompt = () =>
  'По фото еды определи позиции (1–5 отдельных блюд или одно составное с суммарными КБЖУ на порцию). Оцени порции визуально; КБЖУ реалистичны для порции.\n' +
  'Для каждой позиции:\n' +
  '- foodName — русское название;\n' +
  '- calories, protein, fat, carbs;\n' +
  '- allergensFound — только из: лактоза, глютен, арахис, орехи, морепродукты, яйца, соя, рыба (или []);\n' +
  '- dietaryTags — только ключи: vegetarian, vegan, lactose-free, gluten-free, keto, paleo, low-carb, high-protein (или []);\n' +
  '- ingredients — [{ name (рус.), grams }] основные ингредиенты с массой в граммах (3–20);\n' +
  '- ingredientsDetailed — [{ name, grams, amount?, unit? }], без markdown.\n' +
  'Верни СТРОГО JSON одной строкой:\n' +
  '{"confidence":0.85,"items":[{"foodName":"Салат с курицей","calories":320,"protein":28,"fat":12,"carbs":18,"allergensFound":[],"dietaryTags":[],"ingredients":[{"name":"курица","grams":120}],"ingredientsDetailed":[{"name":"курица","grams":120,"amount":120,"unit":"г"}]}]}\n' +
  'confidence 0–1; dietaryTags на англ., остальные строки на русском.';

export const buildNutritionRecommendationPrompt = (
  input: NutritionRecommendationInput,
) => {
  const allergies = (input.allergies ?? []).filter(Boolean);
  const dietary = (input.dietaryRestrictions ?? []).filter(Boolean);
  const dislikes = (input.foodDislikes ?? []).filter(Boolean);
  const allergyLine = allergies.length > 0 ? allergies.join(', ') : 'не указаны';
  const dietLine = dietary.length > 0 ? dietary.join(', ') : 'не указаны';
  const dislikesLine = dislikes.length > 0 ? dislikes.join(', ') : 'не указаны';

  return `Цель пользователя: ${input.goal}
Целевая калорийность в день: ${input.dailyCalories}
Недавние приёмы пищи (лог распознавания, возможны ошибки): ${JSON.stringify(input.recentMeals)}
Доп. заметка: ${input.progressNote ?? 'нет'}

Профиль ограничений пользователя (обязательно учитывать в summary и в каждом пункте actions):
- Аллергены: ${allergyLine}
- Диета и пищевые ограничения: ${dietLine}
- Нежелательные продукты: ${dislikesLine}

Правила ответа:
- Не рекомендуй блюда и ингредиенты, которые нарушают аллергии, диету или список нежелательного.
- Не описывай и не процитируй в summary названия недавних блюд, если в названии явно фигурирует аллерген пользователя, мясо/рыбу при вегетарианстве/веганстве и т.п. — пиши обобщённо («перекус», «основной приём», «высокобелковый перекус без орехов») или только безопасные ориентиры.
- Не поощряй и не нормализуй употребление продуктов из списка аллергенов; при необходимости мягко напомни проверять состав и избегать триггеров.
- Советы по калориям и белку давай только в рамках указанных ограничений.

Верни СТРОГО JSON (все строки на русском):
{"summary":"2–4 предложения: цель, калорийность, общий ориентир питания с учётом ограничений; без небезопасных отсылок к недавней еде","actions":["конкретный безопасный шаг 1","шаг 2",...]}`;
};

type MealPlanCatalogInput = MealPlanInput & { dishNames: string[] };

/**
 * Собирает блок со списком допустимых блюд.
 *
 * Раньше список обрезался по 12 000 символов, и при большом каталоге
 * часть названий не попадала в промпт: модель их не видела, предлагала
 * блюда «по памяти», и они не проходили проверку — отсюда десятки замен
 * и заглушки в плане.
 *
 * Ограничение теперь считается в количестве блюд, а не символов, и
 * задаётся переменной AI_CATALOG_MAX_NAMES.
 */
const catalogNameLimit = () =>
  Math.max(50, Number(process.env.AI_CATALOG_MAX_NAMES ?? 700) || 700);

export const buildMealPlanFromCatalogPrompt = (input: MealPlanCatalogInput) => {
  const limit = catalogNameLimit();
  const used = input.dishNames.slice(0, limit);
  const listBlock = used.join('\n');
  return `Составь план питания на ${input.days} дней. Используй ТОЛЬКО названия блюд из списка ниже (копируй строку точно, без выдуманных блюд).

Полный список допустимых названий (каждая строка — одно блюдо):
${listBlock}

Параметры человека:
- Пол: ${input.gender}
- Возраст: ${input.age}
- Вес: ${input.weight} кг
- Рост: ${input.height} см
- Цель: ${input.goal}
- Дневная норма калорий: ${input.calories} ккал
- Аллергии (исключить любые блюда с этими ингредиентами): ${input.allergies.join(', ') || 'нет'}
- Диетические ограничения (строго соблюдать при выборе из списка): ${input.dietaryRestrictions?.join(', ') || 'нет'}
- Любимые продукты (предпочитать при прочих равных): ${input.foodLikes?.join(', ') || 'нет'}
- Нежелательные продукты (строго не использовать): ${input.foodDislikes?.join(', ') || 'нет'}
- Продукты пользователя в холодильнике (предпочитать): ${input.fridgeProducts?.join(', ') || 'нет'}

Правила:
- Каждый приём пищи — название из списка dishNames.
- Завтрак ~25%, обед ~35%, ужин ~25%, перекусы ~15% калорий суммарно.
- Поле "snacks" — массив из 0–2 названий перекусов из списка (категория snack в БД).
- Не добавляй блюда вне списка.
- Если в названии блюда встречается любой из перечисленных нежелательных продуктов, не используй это блюдо.
- Если указаны любимые продукты: в каждом дне для КАЖДОГО из перечисленных любимых ключевых слов должно быть хотя бы одно блюдо (в любом слоте), в названии которого есть это слово или очевидный вариант (для «суп» — борщ, уха, суп-пюре, рамен, том ям и т.п.). Разные любимые слова закрывай разными блюдами того же дня.
- Алкоголь (вино, крепкое, коктейли, ликёры) не использовать в завтраках, обедах и ужинах; в перекусах — не чаще одного раза за семь дней плана.
- Для плана на неделю избегай повторов: одно и то же блюдо не чаще 2 раз за 7 дней и не в один и тот же слот два дня подряд.

Верни СТРОГО JSON:
{
  "days": [
    {
      "day": 1,
      "meals": {
        "breakfast": "точное название из списка",
        "lunch": "",
        "dinner": "",
        "snack": "",
        "snacks": []
      }
    }
  ]
}`;
};

export type ConstructorRefinementCatalogInput = MealPlanCatalogInput & {
  currentPlanLines: string[];
  auditHint?: string;
};

export const buildConstructorRefinementPrompt = (input: ConstructorRefinementCatalogInput) => {
  const limit = catalogNameLimit();
  const used = input.dishNames.slice(0, limit);
  const listBlock = used.join('\n');
  const planBlock = input.currentPlanLines.join('\n');
  const audit = (input.auditHint ?? '').trim();
  const compactMode = input.days >= 14;
  const overviewRule = compactMode
    ? '1–2 коротких предложения'
    : '2–5 предложений';
  const reasonRule = compactMode
    ? 'до 60 символов, без длинных пояснений'
    : 'кратко и по делу (обычно до 100 символов)';

  return `Пользователь собирает план питания ВРУЧНУЮ в конструкторе. Нужно ДОРАБОТАТЬ план с помощью ИИ, не выкидывая его работу без причины.

ДОСТУПНЫЕ БЛЮДА (копируй название ТОЧНО, одна строка = одно блюдо):
${listBlock}

ТЕКУЩИЙ ПЛАН (null или «пусто» = слот не заполнен; второй перекус — snack2):
${planBlock}

Профиль:
- Пол: ${input.gender}, возраст: ${input.age}, вес: ${input.weight} кг, рост: ${input.height} см
- Цель: ${input.goal}, целевая калорийность в день: ${input.calories} ккал
- Аллергии: ${input.allergies.join(', ') || 'нет'}
- Диеты: ${input.dietaryRestrictions?.join(', ') || 'нет'}
- Любимое в еде: ${input.foodLikes?.join(', ') || 'нет'}
- Нежелательное: ${input.foodDislikes?.join(', ') || 'нет'}
- Продукты в холодильнике: ${input.fridgeProducts?.join(', ') || 'нет'}

Подсказка автоматического анализа конструктора (может быть пустой):
${audit || 'нет'}

Правила (строго):
1) Сохраняй блюда пользователя через action "keep", если они безопасны по аллергиям/диете/нежелательным продуктам и калорийность дня в целом может быть выровнена за счёт других слотов.
2) Заменяй ("replace") ТОЛЬКО если есть конфликт с аллергией, диетой, явным нежелательным продуктом, или блюдо явно не подходит по категории слота; в поле "reason" ОБЯЗАТЕЛЬНО объясни замену человеческим языком, ${reasonRule}.
3) Пустые слоты заполни ("fill") блюдами из списка; dishName — точное название из каталога; в "reason" объясни кратко (напр. «слот был пуст», «баланс белка», «учёт холодильника»), ${reasonRule}.
4) Алкогольные напитки и коктейли не предлагать.
5) Для каждого дня от 1 до ${input.days} и для КАЖДОГО из слотов breakfast, lunch, dinner, snack, snack2 должна быть РОВНО одна запись в массиве "changes".
6) slot только латиницей: breakfast | lunch | dinner | snack | snack2
7) Возвращай только JSON, без markdown, без code fences, без комментариев.

Верни СТРОГО JSON:
{
  "overview": "${overviewRule}: что сделано в целом и на что обратить внимание пользователю",
  "changes": [
    {
      "day": 1,
      "slot": "breakfast",
      "action": "keep",
      "dishName": "",
      "previousDishName": "как было у пользователя или пусто",
      "reason": "почему оставляем или что улучшили рядом"
    }
  ]
}`;
};

export const buildChatPrompt = (input: ChatPromptInput) => {
  const p = input.userProfile;
  // trim + filter: строки из одних пробелов не должны попадать в промт
  // (иначе «Тип питания:   » выглядит как заданное ограничение).
  const clean = (list?: string[]) =>
    (list ?? []).map((v) => String(v ?? '').trim()).filter((v) => v.length > 0);
  const diet = clean(p.dietaryRestrictions);
  const dislikes = clean(p.foodDislikes);
  const likes = clean(p.foodLikes);
  const allergies = clean(p.allergies);

  const profileBlock = `Профиль пользователя:
- Пол: ${p.gender}
- Цель: ${p.goal}
- Рост: ${p.height}
- Вес: ${p.weight}
- Дата рождения: ${p.birthDate}
- Аллергии: ${allergies.join(', ') || 'нет'}
- Тип питания: ${diet.join(', ') || 'без ограничений'}
- Нежелательные продукты: ${dislikes.join(', ') || 'нет'}
- Предпочтения: ${likes.join(', ') || 'нет'}`;

  const historyBlock = input.messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join('\n');

  // Жёсткие правила формируются отдельным блоком: модель надёжнее следует
  // явным запретам, чем общему указанию «учитывай ограничения».
  const rules: string[] = [];

  // Возрастное ограничение: алкоголь запрещён до 18 лет.
  // В профиле хранится дата рождения, поэтому возраст считаем здесь.
  const ageFromBirthDate = (raw: unknown): number | null => {
    if (!raw) return null;
    const d = new Date(String(raw));
    if (Number.isNaN(d.getTime())) return null;
    const now = new Date();
    let years = now.getFullYear() - d.getFullYear();
    const m = now.getMonth() - d.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years -= 1;
    return years >= 0 && years < 130 ? years : null;
  };
  const userAge = ageFromBirthDate(p.birthDate);

  if (userAge !== null && userAge < 18) {
    rules.push(
      'Пользователю меньше 18 лет: НИКОГДА не предлагай алкоголь, ' +
        'алкогольные коктейли и блюда с вином, пивом или сидром ' +
        '(например, «Бигос» содержит красное вино). ' +
        'Если пользователь просит такой рецепт — откажи и предложи безалкогольную замену.',
    );
  }

  if (diet.length > 0) {
    rules.push(
      `ОГРАНИЧЕНИЯ ПИТАНИЯ: ${diet.join(', ')}. ` +
        'Не предлагай продукты и блюда, которые им противоречат. ' +
        'Например, при vegan нельзя молоко, яйца, мясо, рыбу, мёд и желатин; ' +
        'при vegetarian — мясо, рыбу и морепродукты; при keto — сахар, крупы и хлеб; ' +
        'при gluten-free — пшеницу, хлеб, макароны.',
    );
  }
  if (allergies.length > 0) {
    rules.push(
      `АЛЛЕРГИИ: ${allergies.join(', ')}. ` +
        'Эти продукты опасны: не предлагай их даже как «небольшое исключение». ' +
        'При упоминании состава блюда проверяй, нет ли там аллергена (например, ' +
        'майонез содержит яйца, а соевый соус — сою).',
    );
  }
  if (dislikes.length > 0) {
    rules.push(`НЕ ПРЕДЛАГАЙ: ${dislikes.join(', ')} — пользователь их не любит.`);
  }
  if (likes.length > 0) {
    rules.push(`ЖЕЛАТЕЛЬНО УЧЕСТЬ: ${likes.join(', ')} — пользователь это любит.`);
  }
  const habits = p.foodHabits ?? {};
  const habitParts: string[] = [];
  const tea = Number((habits as { teaCupsPerDay?: unknown }).teaCupsPerDay);
  if (Number.isFinite(tea) && tea > 0) habitParts.push(`выпивает ${tea} чашк(и) чая/кофе в день`);
  const meals = Number((habits as { mealsPerDay?: unknown }).mealsPerDay);
  if (Number.isFinite(meals) && meals >= 3 && meals <= 5) habitParts.push(`предпочитает ${meals} приёма пищи в день`);
  if (habitParts.length > 0) {
    rules.push(`ПРИВЫЧКИ: пользователь ${habitParts.join(', ')}.`);
  }

  return `${profileBlock}

Правила, которые обязательно соблюдать:
${rules.length > 0 ? rules.map((r) => `- ${r}`).join('\n') : '- Особых ограничений нет.'}

История диалога:
${historyBlock}

Ты персональный ассистент по питанию. Дай краткий, безопасный и практический ответ на последнюю реплику пользователя.
Если запрос противоречит ограничениям питания или аллергиям, честно скажи об этом и предложи подходящую замену.
Не предлагай блюда с аллергенами пользователя ни при каких обстоятельствах.
Пиши ответ только на русском языке, даже если в истории встречаются иностранные слова.`;
};


export const buildBodyForecastImagePrompt = (input: {
  weeks: number;
  goal: 'lose' | 'maintain' | 'gain';
  gender: 'male' | 'female';
}) => {
  const goalLine =
    input.goal === 'lose'
      ? 'Body edit only: modestly leaner silhouette, slightly softer volume where fat would reduce; realistic, not extreme.'
      : input.goal === 'gain'
        ? 'Body edit only: modestly more muscle/definition under the same clothes; realistic natural training look, not bodybuilder.'
        : 'Body edit only: slightly more toned/defined; realistic recomposition, subtle change.';

  const genderNote =
    input.gender === 'female'
      ? 'Adult woman: keep clearly female body proportions and the same facial identity; do not masculinize.'
      : 'Adult man: keep clearly male body proportions and the same facial identity.';

  return `Workplace-safe photo edit for a fitness/wellness app. You receive ONE reference photo — edit it in place. Do NOT invent a new location or scene.

NON-NEGOTIABLE — match the reference except body mass distribution:
- Background: keep exactly what is in the photo (plain white studio, wall, room, outdoor, etc.). Do not add gym equipment, mirrors, machines, or change the environment.
- Lighting and shadows: stay consistent with the source image.
- Clothing: keep the same garments, colors, neckline, and coverage. Do not swap to gym/sport uniform unless the person already wears that in the photo.
- Pose and camera: same stance, limb positions, crop, and perspective (full-length stays full-length).
- Face and hair: same individual — preserve facial features, expression direction, hairstyle, hair color, and skin tone so the person is clearly recognizable. No face swap, no different person.

ONLY adjust: ${goalLine} Subtle "${input.weeks}-week program" look; photorealistic, one person. ${genderNote}

Fully clothed, non-sensual, no swimwear/underwear as outfit. No text or logos. Output: single photorealistic image.`;
};

export const buildBodyForecastImagePromptMinimal = (input: {
  weeks: number;
  goal: 'lose' | 'maintain' | 'gain';
  gender: 'male' | 'female';
}) =>
  `SFW photo edit: same background, light, pose, clothes, face and hair as input — only slightly change body shape for ${input.weeks} weeks, goal ${input.goal}, adult ${input.gender}, realistic, do not add gym or new room, one person, photorealistic, no text.`;

export const buildBodyForecastPrompt = (input: {
  durationWeeks: number;
  goal: string;
  gender: string;
  weight: number;
  height: number;
  bodyFat: number;
  muscle: number;
}) =>
  `Ты фитнес-коуч (общие ориентиры, не мед.диагноз). Пользователь хочет видеть ожидаемую динамику фигуры за ${input.durationWeeks} недель.
Данные: пол ${input.gender}, вес ${input.weight} кг, рост ${input.height} см, цель ${input.goal}, примерный % жира ${input.bodyFat}, мышечная масса ~${input.muscle} кг.

Верни СТРОГО JSON; все значения-строки на русском:
{"summary":"2–4 предложения","milestones":[{"week":1,"note":"кратко по неделе на русском"}],"visualDescription":"какие зоны тела/силуэт будут заметнее при соблюдении режима","disclaimer":"о питании, тренировках и при необходимости консультации специалиста"}`;
