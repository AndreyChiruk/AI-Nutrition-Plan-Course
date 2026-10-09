import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты масштабирования дня под целевую калорийность.
 *
 * Два дефекта:
 * 1. Изменялись только КБЖУ, а граммовки ингредиентов оставались исходными:
 *    пользователь видел «Омлет 270 г» и «1100 ккал» одновременно, а при
 *    закупке по граммовкам получал вдвое меньше калорий, чем в плане.
 * 2. Финальная подмена слотов (`finalizeGeneratedPlanDays`) выполнялась
 *    ПОСЛЕ масштабирования, из-за чего 36 из 472 дней выходили за ±10 %
 *    от цели (максимум +82 %).
 *
 * Здесь повторяется логика `scaleSnap` из meal-plan.service.ts.
 */
type Ingredient = { name: string; grams?: number; amount?: number };
type Snapshot = {
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  ingredients?: Ingredient[];
  ingredientsDetailed?: Ingredient[];
};

function scaleSnap(snap: Snapshot, factor: number): Snapshot {
  const c = Number(snap.calories) || 0;
  if (c <= 0) return { ...snap, calories: 0 };
  const round1 = (v: number) => Math.round(v * 10) / 10;
  const scaleGrams = (v: unknown) => {
    const g = Number(v) || 0;
    return g > 0 ? round1(g * factor) : g;
  };
  const mapIngredient = (row: Ingredient): Ingredient => {
    const next: Ingredient = { ...row };
    if (row.grams !== undefined && row.grams !== null) next.grams = scaleGrams(row.grams);
    if (row.amount !== undefined && row.amount !== null) next.amount = scaleGrams(row.amount);
    return next;
  };
  return {
    ...snap,
    calories: Math.max(0, Math.round(c * factor)),
    protein: round1(snap.protein * factor),
    fat: round1(snap.fat * factor),
    carbs: round1(snap.carbs * factor),
    ...(Array.isArray(snap.ingredients) ? { ingredients: snap.ingredients.map(mapIngredient) } : {}),
    ...(Array.isArray(snap.ingredientsDetailed)
      ? { ingredientsDetailed: snap.ingredientsDetailed.map(mapIngredient) }
      : {}),
  };
}

/** Согласованный снапшот: 500 ккал = Б45×4 + Ж20×9 + У35×4. */
const consistent: Snapshot = {
  name: 'Омлет',
  calories: 500,
  protein: 45,
  fat: 20,
  carbs: 35,
  ingredients: [
    { name: 'Яйцо', grams: 200 },
    { name: 'Масло', grams: 100 },
  ],
  ingredientsDetailed: [
    { name: 'Яйцо', grams: 200, amount: 200 },
    { name: 'Масло', grams: 100, amount: 100 },
  ],
};

describe('масштабирование дня под целевую калорийность', () => {
  it('масштабирует граммовки ингредиентов вместе с калориями', () => {
    const factor = 2.2;
    const scaled = scaleSnap(consistent, factor);
    const before = consistent.ingredients!.reduce((a, i) => a + (i.grams ?? 0), 0);
    const after = scaled.ingredients!.reduce((a, i) => a + (i.grams ?? 0), 0);
    assert.approximately(after / before, factor, 0.01, 'масса должна масштабироваться тем же коэффициентом');
  });

  it('масштабирует ingredientsDetailed и поле amount', () => {
    const scaled = scaleSnap(consistent, 2);
    assert.strictEqual(scaled.ingredientsDetailed![0].grams, 400);
    assert.strictEqual(scaled.ingredientsDetailed![0].amount, 400);
  });

  it('сохраняет согласованность КБЖУ и калорий', () => {
    for (const factor of [0.5, 1, 1.5, 2.2, 3]) {
      const scaled = scaleSnap(consistent, factor);
      const kcal = scaled.protein * 4 + scaled.fat * 9 + scaled.carbs * 4;
      assert.approximately(kcal, scaled.calories, scaled.calories * 0.02, `коэффициент ${factor}`);
    }
  });

  it('уменьшение работает так же, как увеличение', () => {
    const scaled = scaleSnap(consistent, 0.5);
    assert.approximately(scaled.calories, 250, 1);
    assert.strictEqual(scaled.ingredients![0].grams, 100, 'граммовки должны уменьшиться');
  });

  it('не трогает снапшот с нулевой калорийностью', () => {
    const zero: Snapshot = { name: 'Пусто', calories: 0, protein: 0, fat: 0, carbs: 0 };
    assert.strictEqual(scaleSnap(zero, 2).calories, 0);
  });

  it('переживает снапшот без ингредиентов', () => {
    const noIng: Snapshot = { name: 'X', calories: 300, protein: 20, fat: 10, carbs: 30 };
    const scaled = scaleSnap(noIng, 2);
    assert.strictEqual(scaled.calories, 600);
    assert.isUndefined(scaled.ingredients);
  });

  it('не создаёт нулевых граммовок', () => {
    const scaled = scaleSnap(consistent, 0.001);
    for (const i of scaled.ingredients!) {
      assert.isAbove(i.grams ?? 0, 0, 'масса не должна обнуляться');
    }
  });
});
