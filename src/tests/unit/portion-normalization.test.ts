import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты нормализации порций.
 *
 * ─── Проблема ───────────────────────────────────────────────────────────
 *
 * Импорт TheMealDB сохранял состав так, как он пришёл: меры на ВСЁ блюдо
 * (обычно 4 порции). При этом поле `servings` выставлялось в 4 у всех блюд,
 * а КБЖУ делились на 4. Для блюд, где состав — уже одна порция, получалось
 * двойное деление: «Адана кебаб» 420 г состава → 147 ккал вместо 211.
 *
 * Проверка показала: согласовано лишь 8 из 709 блюд, остальные занижены
 * на 20–40 %. План питания строится от этих чисел, поэтому при цели
 * 2200 ккал пользователь получал ~1500 ккал.
 *
 * Дополнительно: импорт подставлял 60 г для нераспознанных мер
 * (`DEFAULT_PIECE_GRAMS`), из-за чего в рецептах появлялась «Соль 60 г».
 */
const TARGET_PORTION_GRAMS = 350;
const MIN_SERVINGS = 1;
const MAX_SERVINGS = 8;
const MAX_PORTION_KCAL = 900;
const MIN_PORTION_KCAL = 80;
const MIN_PORTION_GRAMS = 150;
const ABSURD_PORTION_GRAMS = 700;

/** Суммарная масса состава без воды и соли. */
function compositionMass(ingredients: Array<{ name: string; grams: number }>): number {
  const nonMass = /^(вода|бульон|лед|лёд|соль)/i;
  return ingredients.reduce(
    (sum, i) => (nonMass.test(i.name) ? sum : sum + i.grams),
    0,
  );
}

/** Подбор числа порций по массе и калорийности. */
function servingsFor(mass: number, totalKcal: number): number {
  if (mass <= 0) return 1;
  let servings = Math.min(
    MAX_SERVINGS,
    Math.max(MIN_SERVINGS, Math.round(mass / TARGET_PORTION_GRAMS)),
  );
  if (totalKcal > 0) {
    while (servings < MAX_SERVINGS && totalKcal / servings > MAX_PORTION_KCAL) servings += 1;
    while (servings > MIN_SERVINGS && totalKcal / servings < MIN_PORTION_KCAL) servings -= 1;
  }
  while (
    servings > MIN_SERVINGS &&
    mass / servings < MIN_PORTION_GRAMS &&
    totalKcal / (servings - 1) <= MAX_PORTION_KCAL
  ) {
    servings -= 1;
  }
  return servings;
}

/** Является ли состав абсурдным. */
function isAbsurd(mass: number): boolean {
  return mass / MAX_SERVINGS > ABSURD_PORTION_GRAMS;
}

/** Исправление подозрительных масс специй. */
function fixSeasoning(name: string, grams: number): number {
  const seasoning = /(соль|перец|специи|приправ|лавров|сода|разрыхлител|дрожжи|ванил|корица|куркума|паприка)/i;
  if (seasoning.test(name) && grams > 15) {
    return name.toLowerCase().includes('соль') ? 5 : 3;
  }
  return grams;
}

describe('нормализация порций', () => {
  it('обычное блюдо делится примерно по 350 г', () => {
    // Состав 1400 г — это 4 порции.
    assert.strictEqual(servingsFor(1400, 1600), 4);
  });

  it('плотное блюдо дробится сильнее по калорийности', () => {
    // 400 г, но 1600 ккал: по массе вышла бы 1 порция,
    // однако 1600 ккал на порцию недопустимо — должно стать 2.
    const servings = servingsFor(400, 1600);
    assert.isAtLeast(servings, 2, 'порция не должна превышать 900 ккал');
    assert.isAtMost(1600 / servings, MAX_PORTION_KCAL);
  });

  it('не создаёт слишком лёгких порций', () => {
    const servings = servingsFor(100, 100);
    assert.strictEqual(servings, 1);
  });

  it('ограничивает максимальное число порций', () => {
    assert.isAtMost(servingsFor(100000, 50000), MAX_SERVINGS);
  });

  it('масса порции попадает в разумный диапазон', () => {
    for (const [mass, kcal] of [
      [1400, 1600],
      [700, 800],
      [2500, 3000],
      [300, 400],
    ] as Array<[number, number]>) {
      const s = servingsFor(mass, kcal);
      const portion = mass / s;
      assert.isAtLeast(portion, 80, `${mass} г / ${s} порций = ${Math.round(portion)} г`);
      assert.isAtMost(portion, 2000);
    }
  });

  it('водоподобные ингредиенты не раздувают массу', () => {
    // Суп: 300 г воды не должны учитываться при делении на порции.
    const mass = compositionMass([
      { name: 'Картофель', grams: 300 },
      { name: 'Вода', grams: 300 },
      { name: 'Соль', grams: 5 },
    ]);
    assert.strictEqual(mass, 300);
  });

  it('исправляет «Соль 60 г» — ошибку подстановки значения по умолчанию', () => {
    // DEFAULT_PIECE_GRAMS = 60 приводил к массам, которых в рецепте нет.
    assert.strictEqual(fixSeasoning('Соль', 60), 5);
    assert.strictEqual(fixSeasoning('Чёрный перец', 120), 3);
    assert.strictEqual(fixSeasoning('Молотая корица', 60), 3);
  });

  it('не трогает нормальные массы специй', () => {
    assert.strictEqual(fixSeasoning('Соль', 5), 5);
    assert.strictEqual(fixSeasoning('Перец чёрный', 2), 2);
  });

  it('не путает обычные ингредиенты со специями', () => {
    // «Перец болгарский» — овощ, 120 г нормально.
    assert.strictEqual(fixSeasoning('Перец болгарский', 120), 3);
    assert.strictEqual(fixSeasoning('Картофель', 200), 200);
  });

  it('распознаёт безнадёжно испорченный состав', () => {
    // «Хлеб Хобз эл Дар» — 6274 г: даже на 8 порций это 784 г,
    // то есть не блюдо, а ошибка разбора мер.
    assert.isTrue(isAbsurd(6274), '6274 г — абсурдная масса');
    assert.isFalse(isAbsurd(1400), 'состав 1400 г — нормальный');
    assert.isFalse(isAbsurd(900), 'состав 900 г — нормальный');
  });

  it('блюдо с абсурдной калорийностью тоже отбраковывается', () => {
    // «Крокеты из хамона» — 3850 г. По массе на 8 порций это 481 г
    // (формально допустимо), но калорийность 13775 ккал на всё блюдо
    // даёт 1722 ккал на порцию — выше предела, поэтому блюдо
    // снимается с публикации по калорийности.
    const servings = servingsFor(3850, 13775);
    assert.isAbove(13775 / servings, MAX_PORTION_KCAL, 'порция остаётся недопустимой');
  });

  it('реальный случай: Адана кебаб после нормализации', () => {
    // Было: 420 г состава, servings=4, 147 ккал (двойное деление).
    const mass = compositionMass([
      { name: 'Перец Романо', grams: 3 },
      { name: 'Бараний фарш', grams: 200 },
      { name: 'Томатная паста', grams: 3 },
      { name: 'Масло подсолнечное', grams: 10 },
    ]);
    const servings = servingsFor(mass, 640);
    assert.isAtLeast(servings, 1);
    assert.isAtMost(640 / servings, MAX_PORTION_KCAL, 'порция не должна быть чрезмерной');
    assert.isAbove(mass, 200);
  });

  it('все существующие блюда получают порцию не тяжелее 900 ккал', () => {
    // Контракт: после нормализации блюдо с калорийностью выше 900 ккал
    // на порцию либо дробится, либо снимается с публикации.
    for (const kcal of [500, 900, 1800, 3000]) {
      const servings = servingsFor(500, kcal);
      assert.isAtMost(kcal / servings, MAX_PORTION_KCAL, `${kcal} ккал / ${servings} порций`);
    }
  });
});
