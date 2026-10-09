/**
 * Приведение названий ингредиентов к русскому языку.
 *
 * Модель иногда вставляет английские слова в состав блюда
 * («в blueberries ~15 г»), хотя промпт требует русский. Ошибка
 * заметна пользователю и выглядит как сбой перевода.
 *
 * Полностью полагаться на промпт нельзя: модель недетерминирована.
 * Поэтому после ответа прогоняем названия через словарь частых
 * продуктов. Незнакомые слова остаются как есть — выдумывать
 * перевод хуже, чем показать оригинал.
 */

/** Словарь: английское название (в нижнем регистре) → русское. */
const INGREDIENT_RU: Record<string, string> = {
  blueberries: 'голубика',
  blueberry: 'голубика',
  strawberry: 'клубника',
  strawberries: 'клубника',
  raspberry: 'малина',
  raspberries: 'малина',
  blackberry: 'ежевика',
  blackberries: 'ежевика',
  cranberry: 'клюква',
  cherry: 'вишня',
  cherries: 'вишня',
  apple: 'яблоко',
  apples: 'яблоки',
  banana: 'банан',
  bananas: 'бананы',
  orange: 'апельсин',
  lemon: 'лимон',
  pear: 'груша',
  peach: 'персик',
  grapes: 'виноград',
  raisins: 'изюм',

  oats: 'овсяные хлопья',
  oatmeal: 'овсяная каша',
  'oat flakes': 'овсяные хлопья',
  rice: 'рис',
  buckwheat: 'гречка',
  flour: 'мука',
  bread: 'хлеб',
  pasta: 'макароны',
  sugar: 'сахар',
  honey: 'мёд',
  salt: 'соль',
  butter: 'сливочное масло',
  oil: 'масло',
  'olive oil': 'оливковое масло',

  milk: 'молоко',
  cream: 'сливки',
  cheese: 'сыр',
  yogurt: 'йогурт',
  yoghurt: 'йогурт',
  kefir: 'кефир',
  cottage: 'творог',
  'cottage cheese': 'творог',
  egg: 'яйцо',
  eggs: 'яйца',

  chicken: 'курица',
  beef: 'говядина',
  pork: 'свинина',
  fish: 'рыба',
  salmon: 'лосось',
  tuna: 'тунец',
  shrimp: 'креветки',

  potato: 'картофель',
  potatoes: 'картофель',
  tomato: 'помидор',
  tomatoes: 'помидоры',
  cucumber: 'огурец',
  onion: 'лук',
  garlic: 'чеснок',
  carrot: 'морковь',
  cabbage: 'капуста',
  broccoli: 'брокколи',
  spinach: 'шпинат',
  mushroom: 'грибы',
  mushrooms: 'грибы',
  nuts: 'орехи',
  walnuts: 'грецкие орехи',
  almonds: 'миндаль',
  peanuts: 'арахис',
  tofu: 'тофу',
  water: 'вода',
  chocolate: 'шоколад',
  cinnamon: 'корица',
  vanilla: 'ваниль',
};

/**
 * Переводит название ингредиента на русский, если оно английское.
 *
 * Учитывает регистр и лишние пробелы. Если слово уже на русском
 * или отсутствует в словаре — возвращает исходное значение.
 */
export function normalizeIngredientName(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  if (!value) return '';

  // Уже содержит кириллицу — переводить не нужно.
  if (/[а-яё]/i.test(value)) return value;

  const key = value.toLowerCase().replace(/\s+/g, ' ');
  const translated = INGREDIENT_RU[key];
  if (translated) return translated;

  // Пробуем перевести отдельные слова («fresh blueberries»).
  const words = key.split(' ');
  if (words.length > 1) {
    const mapped = words.map((w) => INGREDIENT_RU[w] ?? w);
    if (mapped.some((w, i) => w !== words[i])) return mapped.join(' ');
  }

  // Незнакомое слово оставляем как есть: неверный перевод хуже оригинала.
  return value;
}

/**
 * Приводит список ингредиентов к русским названиям.
 * Возвращает новый массив, исходный не изменяет.
 */
export function normalizeIngredients<T extends { name?: string | null }>(
  list: T[] | null | undefined,
): T[] {
  if (!Array.isArray(list)) return [];
  return list.map((item) => ({
    ...item,
    name: normalizeIngredientName(item?.name),
  }));
}
