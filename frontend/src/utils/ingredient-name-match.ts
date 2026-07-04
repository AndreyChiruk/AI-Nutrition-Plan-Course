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

export function resolveCatalogProductByName<T extends { name: string }>(
  rawName: string,
  candidates: T[],
): T | null {
  const n = normalizeRuFoodText(rawName);
  if (!n || candidates.length === 0) return null;

  const byNorm = new Map<string, T>();
  for (const p of candidates) {
    const k = normalizeRuFoodText(p.name);
    if (k && !byNorm.has(k)) byNorm.set(k, p);
  }
  const exact = byNorm.get(n);
  if (exact) return exact;

  const hits = candidates.filter((p) => isIngredientMatch(p.name, rawName));
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) {
    hits.sort(
      (x, y) =>
        Math.abs(normalizeRuFoodText(x.name).length - n.length) -
        Math.abs(normalizeRuFoodText(y.name).length - n.length),
    );
    return hits[0];
  }

  let best: T | null = null;
  let bestJ = -1;
  for (const p of candidates) {
    const j = tokenJaccard(rawName, p.name);
    if (j > bestJ) {
      bestJ = j;
      best = p;
    }
  }
  if (best && bestJ >= 0.45 && strongTokenOverlap(rawName, best.name)) return best;
  return null;
}

export const RU_ONION_WORD_RE = ruWordRegex('лук');
export const RU_PEPPER_WORD_RE = ruWordRegex('перец');
