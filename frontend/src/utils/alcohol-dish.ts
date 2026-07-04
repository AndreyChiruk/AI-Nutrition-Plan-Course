export type AlcoholProbeMeal = {
  name?: string;
  sourceMealId?: string | null;
  cuisine?: string | null;
  description?: string | null;
  ingredients?: Array<{ name?: string; grams?: number }>;
  ingredientsDetailed?: Array<{ name?: string; originalString?: string }>;
  allergens?: string[];
};

const lc = (s: string) => s.toLowerCase();

export function mealLooksLikeAlcoholic(meal: AlcoholProbeMeal): boolean {
  const sid = lc(String(meal.sourceMealId ?? '').trim());
  if (sid.startsWith('cocktaildb:')) return true;

  const blobs: string[] = [];
  const detailed = meal.ingredientsDetailed ?? [];
  for (const x of detailed) {
    const n = lc(String(x?.name ?? '').trim());
    if (n) blobs.push(n);
    const os = lc(String(x?.originalString ?? '').trim());
    if (os) blobs.push(os);
  }
  const simple = meal.ingredients ?? [];
  for (const x of simple) {
    const n = lc(String(x?.name ?? '').trim());
    if (n) blobs.push(n);
  }
  const title = lc(String(meal.name ?? '').trim());
  if (title) blobs.push(title);
  for (const a of meal.allergens ?? []) {
    const n = lc(String(a ?? '').trim());
    if (n) blobs.push(n);
  }
  const desc = lc(String(meal.description ?? '').trim());
  if (desc) blobs.push(desc);
  if (lc(String(meal.cuisine ?? '').trim()) === 'напитки') blobs.push('напитки');

  const tokenSplit = (b: string) => b.split(/[^a-zа-яё0-9]+/i).filter(Boolean);
  const alcoholWords = new Set(
    [
      'водка',
      'коньяк',
      'шампанское',
      'пиво',
      'сидр',
      'эль',
      'лагер',
      'портер',
      'ром',
      'джин',
      'виски',
      'бренди',
      'ликёр',
      'ликер',
      'текила',
      'абсент',
      'вермут',
      'граппа',
      'настойка',
      'глинтвейн',
      'алкоголь',
      'кагор',
      'херес',
      'портвейн',
      'мартини',
      'вино',
      'эпплджек',
      'wine',
      'champagne',
      'cognac',
      'vodka',
      'beer',
      'cider',
      'rum',
      'gin',
      'whiskey',
      'whisky',
      'brandy',
      'liqueur',
      'tequila',
      'prosecco',
      'sherry',
      'martini',
      'cocktail',
      'коктейль',
      'sake',
      'просекко',
      'игристое',
      'спиртное',
      'applejack',
      'stout',
      'porter',
      'pilsner',
      'ipa',
      'корона',
      'мохито',
      'маргарита',
      'дайкири',
      'сангрия',
      'aperol',
      'апероль',
      'беллини',
      'bellini',
      'шот',
      'shot',
      'фizzes',
      'физз',
    ].map((x) => x.toLowerCase()),
  );

  const phraseHints = [
    'шампан',
    'игрист',
    'алкогол',
    'спиртное',
    'портвейн',
    'белое вино',
    'красное вино',
    'сухое вино',
    'port wine',
    'коктейль',
    'лимонная корона',
    'lime corona',
    ' lemon corona',
    'corona extra',
    'джин-тоник',
    'gin tonic',
    'gin and tonic',
    'vodka tonic',
    'bloody mary',
    'бренди сауэр',
    'irish cream',
    'баилейс',
    'baileys',
    'крепость напитка',
    'spirits',
    'liquor',
    'hard cider',
  ];

  for (const raw of blobs) {
    const b = raw;
    if (/безалкоголь|mocktail|soft\s+drink|без\s+алкогол|non-alcoholic|non alcoholic/i.test(b)) continue;
    if (phraseHints.some((h) => b.includes(h))) return true;
    for (const t of tokenSplit(b)) {
      const tl = t.toLowerCase();
      if (alcoholWords.has(tl)) return true;
    }
  }
  return false;
}

export const MINOR_ALCOHOL_BLOCK_MSG =
  'Для пользователей до 18 лет нельзя добавлять алкогольные напитки и коктейли в план.';
