const STOPWORDS = new Set([
  'и',
  'с',
  'во',
  'в',
  'на',
  'по',
  'из',
  'к',
  'ко',
  'для',
  'без',
  'или',
  'как',
  'от',
  'до',
  'же',
  'ли',
]);

const WEAK_HEADS = new Set([
  'лук',
  'перец',
  'сыр',
  'масло',
  'молоко',
  'курица',
  'курицы',
  'курицей',
  'томат',
  'огурец',
  'картофель',
  'морковь',
  'рис',
  'риса',
  'фарш',
  'яйцо',
  'яйца',
  'сахар',
  'соль',
  'мука',
  'хлеб',
  'лапша',
  'макароны',
  'гречка',
  'греча',
  'кабачок',
  'кабачки',
  'баклажан',
  'баклажаны',
  'рыба',
  'рыбы',
]);


const TOKEN_SYNONYM: Record<string, string> = {
  помидор: 'томат',
  помидора: 'томат',
  помидоры: 'томат',
  помидоров: 'томат',
  томата: 'томат',
  томаты: 'томат',
  томатов: 'томат',
  черри: 'черри',
  картошка: 'картофель',
  картошки: 'картофель',
  картофеля: 'картофель',
  огурцы: 'огурец',
  огурцов: 'огурец',
  огурцом: 'огурец',
  огурца: 'огурец',
  коровье: 'коровий',
  коровьего: 'коровий',
  коровья: 'коровий',
  куриное: 'курица',
  куриная: 'курица',
  куриный: 'курица',
  куриного: 'курица',
  курочка: 'курица',
  цыпленок: 'курица',
  цыпленка: 'курица',
  яиц: 'яйцо',
  яйца: 'яйцо',
  яйцом: 'яйцо',
  пармезан: 'пармезан',
  моцарелла: 'моцарелла',
  моцареллы: 'моцарелла',
};

const ruWordRegexCache = new Map<string, RegExp>();

export function normalizeRuFoodText(s: string): string {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

export function ruWordRegex(literal: string): RegExp {
  const key = normalizeRuFoodText(literal);
  if (!key) return /(?!)/;
  let r = ruWordRegexCache.get(key);
  if (!r) {
    const inner = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    r = new RegExp(`(?<![\\p{L}\\p{N}_])${inner}(?![\\p{L}\\p{N}_])`, 'iu');
    ruWordRegexCache.set(key, r);
  }
  return r;
}

export function ruHaystackMatchesKeyword(haystack: string, keywordRaw: string): boolean {
  const hay = normalizeRuFoodText(haystack);
  const kw = normalizeRuFoodText(keywordRaw);
  if (!hay || !kw) return false;
  const parts = kw.split(/\s+/).filter((p) => p.length > 0);
  return parts.every((part) => ruWordRegex(part).test(hay));
}

export function splitRuFoodTokens(s: string): string[] {
  return normalizeRuFoodText(s)
    .replace(/[^a-zа-я0-9\s]/gi, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^[^a-zа-я0-9]+|[^a-zа-я0-9]+$/gi, ''))
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
}

function applySynonym(token: string): string {
  return TOKEN_SYNONYM[token] ?? token;
}

function classifyTokens(tokens: string[]): { weakKey: string; strongKey: string } {
  const mapped = tokens.map(applySynonym).filter((t) => !STOPWORDS.has(t));
  const weak: string[] = [];
  const strong: string[] = [];
  for (const t of mapped) {
    if (WEAK_HEADS.has(t)) weak.push(t);
    else strong.push(t);
  }
  weak.sort();
  strong.sort();
  return { weakKey: weak.join('|'), strongKey: strong.join('|') };
}

export function isIngredientMatch(a: string, b: string): boolean {
  const na = normalizeRuFoodText(a);
  const nb = normalizeRuFoodText(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const ta = splitRuFoodTokens(a);
  const tb = splitRuFoodTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  const ca = classifyTokens(ta);
  const cb = classifyTokens(tb);
  if (ca.strongKey !== cb.strongKey) return false;
  return ca.weakKey === cb.weakKey;
}

function tokenJaccard(a: string, b: string): number {
  const ta = splitRuFoodTokens(a).map(applySynonym).filter((t) => !STOPWORDS.has(t));
  const tb = splitRuFoodTokens(b).map(applySynonym).filter((t) => !STOPWORDS.has(t));
  const sa = new Set(ta);
  const sb = new Set(tb);
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter += 1;
  const uni = sa.size + sb.size - inter;
  return uni > 0 ? inter / uni : 0;
}

function strongTokenOverlap(a: string, b: string): boolean {
  const sa = new Set(
    splitRuFoodTokens(a)
      .map(applySynonym)
      .filter((t) => !STOPWORDS.has(t) && !WEAK_HEADS.has(t)),
  );
  const sb = new Set(
    splitRuFoodTokens(b)
      .map(applySynonym)
      .filter((t) => !STOPWORDS.has(t) && !WEAK_HEADS.has(t)),
  );
  for (const t of sa) if (sb.has(t)) return true;
  return false;
}

/**
 * Находит блюдо/ингредиент каталога по названию, полученному от модели.
 *
 * Раньше функция умела только точное совпадение и `isIngredientMatch`, который
 * требует строгого равенства strong/weak-ключей. Поскольку базовые продукты
 * («лук», «сыр», «курица», «яйцо», «хлеб», «рис») отнесены к WEAK_HEADS,
 * обобщённые названия не находились вовсе:
 *     resolveCatalogProductByName('лук',   [Лук репчатый]) -> null
 *     resolveCatalogProductByName('курица',[Куриная грудка]) -> null
 *     resolveCatalogProductByName('сыр',   [Сыр чеддер])   -> null
 *
 * Последствие было тяжёлым: в AI-ветке нераспознанные блюда превращались
 * в снапшот с `calories: 0`, и такой план сохранялся в базу.
 *
 * Теперь используется последовательность стратегий от строгой к мягкой,
 * с обязательной проверкой «однозначности» на каждом шаге.
 */
export function resolveCatalogProductByName<T extends { name: string }>(
  rawName: string,
  candidates: T[],
): T | null {
  const n = normalizeRuFoodText(rawName);
  if (!n || candidates.length === 0) return null;

  // 1. Точное совпадение после нормализации.
  const byNorm = new Map<string, T>();
  for (const p of candidates) {
    const k = normalizeRuFoodText(p.name);
    if (k && !byNorm.has(k)) byNorm.set(k, p);
  }
  const exact = byNorm.get(n);
  if (exact) return exact;

  // 2. Совпадение «голова + модификатор» (старый isIngredientMatch).
  const strictHits = candidates.filter((p) => isIngredientMatch(p.name, rawName));
  if (strictHits.length >= 1) return pickBest(strictHits, n);

  // 3. Обобщённое название: запрос является головным словом кандидата
  //    («лук» в «Лук репчатый», «курица» в «Куриная грудка»).
  const headHits = candidates.filter((p) => headWordMatches(rawName, p.name));
  if (headHits.length >= 1) return pickBest(headHits, n);

  // 4. Высокое лексическое сходство (Jaccard по токенам).
  const jaccardScored = candidates
    .map((p) => ({ p, j: tokenJaccard(rawName, p.name) }))
    .filter((x) => x.j >= 0.5)
    .sort((a, b) => b.j - a.j);
  if (jaccardScored.length >= 1) return jaccardScored[0].p;

  // 5. Последний шанс: название кандидата содержит запрос как слово
  //    (или наоборот) — но только при однозначном результате.
  const contained = candidates.filter(
    (p) => containsDietWord(p.name, rawName) || containsDietWord(rawName, p.name),
  );
  if (contained.length === 1) return contained[0];
  if (contained.length > 1) return pickBest(contained, n);

  return null;
}

/** Проверяет, что запрос является головным словом названия кандидата. */
function headWordMatches(rawName: string, candidateName: string): boolean {
  const reqTokens = splitRuFoodTokens(rawName)
    .map(applySynonym)
    .filter((t) => !STOPWORDS.has(t));
  if (reqTokens.length === 0) return false;

  const candTokens = splitRuFoodTokens(candidateName).map(applySynonym);
  if (candTokens.length === 0) return false;

  // Все значимые слова запроса должны присутствовать в кандидате.
  return reqTokens.every((t) => candTokens.includes(t));
}

/** Проверяет вхождение искомого слова в название по границам слов. */
function containsDietWord(haystack: string, needle: string): boolean {
  const hay = normalizeRuFoodText(haystack);
  const words = splitRuFoodTokens(needle).map(applySynonym).filter((t) => !STOPWORDS.has(t));
  if (words.length === 0) return false;
  const hayWords = splitRuFoodTokens(hay).map(applySynonym);
  return words.every((w) => hayWords.includes(w));
}

/**
 * Из нескольких кандидатов выбирает наиболее подходящий.
 *
 * Приоритет: название, которое НАЧИНАЕТСЯ с искомого слова
 * («лук» → «Лук репчатый», а не «Зелёный лук»), затем — ближайшее по длине.
 * Так обобщённый запрос попадает на основной продукт, а не на его вариант.
 */
function pickBest<T extends { name: string }>(hits: T[], normalizedQuery: string): T {
  if (hits.length === 1) return hits[0];
  const queryHead = splitRuFoodTokens(normalizedQuery).map(applySynonym)[0] ?? '';
  return [...hits].sort((x, y) => {
    const xn = normalizeRuFoodText(x.name);
    const yn = normalizeRuFoodText(y.name);
    // Кандидат, начинающийся с искомого слова, предпочтительнее.
    const xStarts = queryHead && xn.startsWith(queryHead) ? 0 : 1;
    const yStarts = queryHead && yn.startsWith(queryHead) ? 0 : 1;
    if (xStarts !== yStarts) return xStarts - yStarts;
    // Затем — минимальная разница по длине названия.
    return (
      Math.abs(xn.length - normalizedQuery.length) -
      Math.abs(yn.length - normalizedQuery.length)
    );
  })[0];
}

