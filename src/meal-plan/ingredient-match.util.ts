

function addWordVariants(w: string, into: Set<string>) {
  const t = String(w)
    .toLowerCase()
    .trim()
    .replace(/ё/g, 'е');
  if (t.length < 2) return;
  into.add(t);
  if (t.length >= 6) into.add(t.slice(0, Math.min(5, t.length)));

  const endings3 = ['ами', 'ями', 'ого', 'его', 'ому', 'ему'];
  const endings2 = [
    'ом',
    'ем',
    'ам',
    'ям',
    'ах',
    'ях',
    'ов',
    'ев',
    'ий',
    'ый',
    'ая',
    'ое',
    'ые',
    'ую',
    'юю',
    'ой',
    'ей',
  ];
  if (t.length > 4) {
    for (const e of endings3) {
      if (t.endsWith(e)) {
        const stem = t.slice(0, -e.length);
        if (stem.length >= 2) into.add(stem);
      }
    }
  }
  if (t.length > 3) {
    for (const e of endings2) {
      if (t.endsWith(e)) {
        const stem = t.slice(0, -e.length);
        if (stem.length >= 2) into.add(stem);
      }
    }
  }
}

export function collectIngredientMatchRoots(
  ingredients: Array<{ name: string }>,
  storedKeywords: unknown,
): string[] {
  const set = new Set<string>();
  if (Array.isArray(storedKeywords)) {
    for (const x of storedKeywords) addWordVariants(String(x), set);
  }
  for (const ing of ingredients ?? []) {
    const raw = String(ing?.name ?? '')
      .toLowerCase()
      .trim()
      .replace(/ё/g, 'е')
      .replace(/[,.;:()«»\-]/g, ' ');
    for (const w of raw.split(/\s+/)) {
      if (w.length < 2) continue;
      addWordVariants(w, set);
    }
  }
  return [...set];
}
