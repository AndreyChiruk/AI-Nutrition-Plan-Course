
export type MealSlotKeyInfer = 'breakfast' | 'lunch' | 'dinner' | 'snack';

export function inferMealSlotFromDishName(name: string): MealSlotKeyInfer {
  const n = String(name ?? '').toLowerCase();
  if (!n.trim()) return 'dinner';

  if (
    /\b(salad|smoothie|cake|tea\b|snack|dessert)\b/i.test(n) ||
    /салат|смузи|перекус|десерт|торт(?:ик)?|печенье|йогурт\b|мусли|гранола/i.test(n)
  ) {
    return 'snack';
  }
  if (
    /\b(breakfast|oatmeal|pancake|waffle|toast)\b/i.test(n) ||
    /завтрак|каша|овсян|блин|омлет|яичниц|гренк|тост|сырник|вафл/i.test(n)
  ) {
    return 'breakfast';
  }
  if (
    /\b(soup|pasta|rice\b|beef|chicken|pork|lunch|burger|pizza|seafood|salmon|tuna)\b/i.test(n) ||
    /суп|борщ|бульон|солянк|похлеб|паста|лапша|спагетти|рис\b|гречк|булгур|кускус|плов|лазань|котлет|курин|говяд|индейк|свинин|рыба|треск|лосос|тунец|миди|кревет|стейк|бургер|пицц|обед/i.test(
      n,
    )
  ) {
    return 'lunch';
  }
  return 'dinner';
}

export function dishStoredOrInferredMatchesSlot(
  storedCategory: string,
  dishName: string,
  slot: MealSlotKeyInfer,
): boolean {
  const s = String(storedCategory ?? '').toLowerCase();
  if (s === slot) return true;
  return inferMealSlotFromDishName(dishName) === slot;
}
