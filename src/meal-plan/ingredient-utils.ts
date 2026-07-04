
export type DishIngredient = {
  name: string;
  grams: number;
};

const DEFAULT_GRAMS = 120;

export function guessGramsForToken(tokenLower: string): number {
  const t = tokenLower.trim();
  if (!t) return DEFAULT_GRAMS;
  const rules: Array<[RegExp, number]> = [
    [/рис|гречк|греча|макарон|паста|каша|овсян/i, 180],
    [/rice|pasta|noodle|oat|quinoa/i, 180],
    [/куриц|индейк|утк|утин|козлят|козл|говядин|свинин|рыб|лосос|треск|краб|лобстер|морепродукт/i, 160],
    [/chicken|turkey|duck|goat|beef|pork|salmon|tuna|fish|seafood|shrimp|prawn|crab|lobster|steak/i, 160],
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
  return DEFAULT_GRAMS;
}

export function tokenizeDishTitle(title: string): string[] {
  const noPortion = title.replace(/\s·[SML]$/i, '').trim();
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

export function inferIngredientsFromDishTitle(title: string): DishIngredient[] {
  const tokens = tokenizeDishTitle(title);
  const out: DishIngredient[] = [];
  for (const raw of tokens) {
    const tl = raw.toLowerCase();
    const grams = guessGramsForToken(tl);
    const name = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
    out.push({ name, grams });
  }
  return out;
}
