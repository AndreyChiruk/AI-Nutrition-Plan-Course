import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  computeDishNutrition,
  isNonMassIngredient,
  lookupNutrition,
} from '../../admin/nutrition-facts.util';

/**
 * Тесты на расчёт КБЖУ блюд.
 *
 * Раньше калорийность считалась как «сумма всех граммов ингредиентов × 1.2»,
 * а белки/жиры/углеводы — фиксированными долями 22/28/50 % от неё. Вода и соль
 * учитывались наравне с мясом, поэтому в каталоге были блюда по 5394 ккал,
 * а средняя калорийность составляла 1115 ккал на «порцию».
 */
describe('nutrition-facts: справочник и расчёт КБЖУ', () => {
  it('находит калорийность основных продуктов', () => {
    const cases: Array<[string, number]> = [
      ['Куриная грудка', 165],
      ['Рис', 350],
      ['Оливковое масло', 884],
      ['Масло сливочное', 717],
      ['Сливочное масло', 717],
      ['Соль', 0],
      ['Фасоль', 330],
      ['Яйцо', 155],
      ['Молоко', 60],
      ['Сахар', 380],
      ['Помидор', 20],
      ['Соевый соус', 80],
      ['Гречка', 340],
    ];
    for (const [name, expected] of cases) {
      assert.strictEqual(lookupNutrition(name).kcal, expected, name);
    }
  });

  it('вода и бульон дают 0 ккал', () => {
    assert.strictEqual(lookupNutrition('Вода').kcal, 0);
    // Бульон содержит немного калорий от мяса, но не 165 ккал как курица.
    assert.isBelow(lookupNutrition('Куриный бульон').kcal, 30);
  });

  it('«соль» не ловится внутри «фасоль» (защита от подстрок)', () => {
    assert.strictEqual(lookupNutrition('Фасоль').kcal, 330);
    assert.strictEqual(lookupNutrition('Консервированная фасоль').kcal, 330);
  });

  it('соль и вода дают строго 0 ккал', () => {
    // Раньше соль попадала в правило специй и давала 30 ккал, хотя
    // калорий не содержит вовсе. Это искажало расчёт блюд,
    // где соль указана в граммах.
    assert.strictEqual(lookupNutrition('Соль').kcal, 0);
    assert.strictEqual(lookupNutrition('соль поваренная').kcal, 0);
    assert.strictEqual(lookupNutrition('Вода').kcal, 0);
    assert.strictEqual(lookupNutrition('Лёд').kcal, 0);
  });

  it('яйцо не путается с курицей (порядок правил)', () => {
    // «Яйцо куриное» содержит «курин», и правило курицы перехватывало
    // его, выдавая 165 ккал и Б31 — данные куриной грудки.
    const egg = lookupNutrition('Яйцо куриное');
    assert.strictEqual(egg.kcal, 155);
    assert.strictEqual(egg.protein, 13);
    // Курица по-прежнему определяется как мясо.
    assert.strictEqual(lookupNutrition('Куриная грудка').protein, 31);
  });

  it('молочный шоколад не путается с молоком', () => {
    assert.strictEqual(lookupNutrition('Молочный шоколад').kcal, 540);
    assert.strictEqual(lookupNutrition('Молоко').kcal, 60);
  });

  it('сырники не путаются с сыром', () => {
    // «Сырники» содержат «сыр», но это творожное блюдо на 220 ккал,
    // а не твёрдый сыр на 350.
    assert.strictEqual(lookupNutrition('Сырники').kcal, 220);
  });

  it('банан отличается от лёгких фруктов', () => {
    assert.strictEqual(lookupNutrition('Банан').kcal, 89);
    assert.strictEqual(lookupNutrition('Яблоко').kcal, 55);
  });

  it('различает виды масла (порядок слов не важен)', () => {
    assert.strictEqual(lookupNutrition('Оливковое масло').kcal, 884);
    assert.strictEqual(lookupNutrition('Масло оливковое экстра вирджин').kcal, 884);
    assert.strictEqual(lookupNutrition('Растительное масло').kcal, 884);
    assert.strictEqual(lookupNutrition('Сливочное масло').kcal, 717);
  });

  it('определяет невесомые ингредиенты', () => {
    for (const n of ['Вода', 'Соль', 'Перец чёрный', 'Специи для кабсы', 'Бульон']) {
      assert.isTrue(isNonMassIngredient(n), n);
    }
    assert.isFalse(isNonMassIngredient('Курица'));
  });

  it('считает КБЖУ блюда по составу', () => {
    // 200 г курицы (165/100) + 80 г сухого риса (350/100) + 10 г масла (884/100)
    const r = computeDishNutrition([
      { name: 'Куриная грудка', grams: 200 },
      { name: 'Рис', grams: 80 },
      { name: 'Оливковое масло', grams: 10 },
    ]);
    const expected = Math.round(165 * 2 + 350 * 0.8 + 884 * 0.1);
    assert.approximately(r.calories, expected, 2);
    assert.approximately(r.protein, 31 * 2 + 7 * 0.8, 1);
    assert.strictEqual(r.totalGrams, 290);
  });

  it('вода и соль не раздувают массу и калории', () => {
    const r = computeDishNutrition([
      { name: 'Вода', grams: 1000 },
      { name: 'Соль', grams: 10 },
    ]);
    assert.strictEqual(r.calories, 0);
    assert.strictEqual(r.totalGrams, 0);
  });

  it('делит КБЖУ на число порций', () => {
    const one = computeDishNutrition([{ name: 'Курица', grams: 400 }], 1);
    const four = computeDishNutrition([{ name: 'Курица', grams: 400 }], 4);
    assert.approximately(four.calories, Math.round(one.calories / 4), 1);
    assert.strictEqual(Math.round(one.totalGrams / 4), four.totalGrams);
  });

  it('не даёт абсурдных значений для реального рецепта', () => {
    // Регресс: «600 шт» яиц из-за неверного разбора давали 30 кг и десятки тысяч ккал.
    const r = computeDishNutrition([
      { name: 'Картофель', grams: 250 },
      { name: 'Яйца', grams: 330 },
      { name: 'Лук', grams: 75 },
      { name: 'Соль', grams: 0.5 },
    ]);
    // Было 47 877 ккал из-за «600 шт» яиц по 50 г каждое.
    assert.isBelow(r.calories, 1200, 'калорийность порции должна быть правдоподобной');
    assert.isBelow(r.totalGrams, 1000);
  });

  it('устойчив к пустому и некорректному составу', () => {
    assert.strictEqual(computeDishNutrition([]).calories, 0);
    assert.strictEqual(computeDishNutrition([{ name: 'Курица', grams: 0 }]).calories, 0);
    assert.strictEqual(
      computeDishNutrition([{ name: 'Курица', grams: NaN }]).calories,
      0,
    );
  });

  it('считает число нераспознанных ингредиентов', () => {
    const r = computeDishNutrition([
      { name: 'Курица', grams: 100 },
      { name: 'Неведомыйпродуктxyz', grams: 100 },
    ]);
    assert.strictEqual(r.unrecognized, 1);
  });
});
