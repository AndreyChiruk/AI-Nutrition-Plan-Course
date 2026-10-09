/**
 * Восстановление текста, повреждённого перекодированием UTF-8 ↔ CP866.
 *
 * Как возникает: при выгрузке/загрузке дампа БД клиент `psql` работал в кодировке
 * CP866. Байты UTF-8 были прочитаны как CP866 и заново сохранены как UTF-8,
 * поэтому в базе вместо «Аризонский жала» лежит «╨Р╤А╨╕╨╖╨╛╨╜╤Б╨║╨╕╨╣ ╨╢╨░╨╗╨░».
 *
 * Восстановление — обратная операция: символы кодируются обратно в CP866,
 * полученные байты читаются как UTF-8.
 *
 * Без внешних зависимостей: таблица CP866 встроена ниже. Использовать
 * `iconv-lite` нельзя — он присутствует только транзитивно (через body-parser)
 * и может исчезнуть при обновлении зависимостей.
 */

/**
 * CP866, байты 0x80–0xFF в порядке следования.
 * Индекс в массиве = код_байта − 0x80.
 */
const CP866_TABLE: string[] = [
  // 0x80–0x8F
  'А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'Й', 'К', 'Л', 'М', 'Н', 'О', 'П',
  // 0x90–0x9F
  'Р', 'С', 'Т', 'У', 'Ф', 'Х', 'Ц', 'Ч', 'Ш', 'Щ', 'Ъ', 'Ы', 'Ь', 'Э', 'Ю', 'Я',
  // 0xA0–0xAF
  'а', 'б', 'в', 'г', 'д', 'е', 'ж', 'з', 'и', 'й', 'к', 'л', 'м', 'н', 'о', 'п',
  // 0xB0–0xBF
  '░', '▒', '▓', '│', '┤', '╡', '╢', '╖', '╕', '╣', '║', '╗', '╝', '╜', '╛', '┐',
  // 0xC0–0xCF
  '└', '┴', '┬', '├', '─', '┼', '╞', '╟', '╚', '╔', '╩', '╦', '╠', '═', '╬', '╧',
  // 0xD0–0xDF
  '╨', '╤', '╥', '╙', '╘', '╒', '╓', '╫', '╪', '┘', '┌', '█', '▄', '▌', '▐', '▀',
  // 0xE0–0xEF
  'р', 'с', 'т', 'у', 'ф', 'х', 'ц', 'ч', 'ш', 'щ', 'ъ', 'ы', 'ь', 'э', 'ю', 'я',
  // 0xF0–0xFF
  'Ё', 'ё', 'Є', 'є', 'Ї', 'ї', 'Ў', 'ў', '°', '∙', '·', '√', '№', '¤', '■', '\u00a0',
];

/** Unicode-символ → байт CP866. */
const TO_CP866 = new Map<string, number>();
for (let i = 0; i < CP866_TABLE.length; i++) {
  const ch = CP866_TABLE[i];
  // Первое вхождение имеет приоритет; дубликатов в корректной таблице быть не должно.
  if (!TO_CP866.has(ch)) TO_CP866.set(ch, 0x80 + i);
}
// ASCII-диапазон совпадает побайтово.
for (let c = 0x00; c < 0x80; c++) {
  TO_CP866.set(String.fromCharCode(c), c);
}

/**
 * Символы, которые появляются ТОЛЬКО при такой порче.
 * Наличие хотя бы одного — надёжный признак повреждения.
 */
const MOJIBAKE_MARKERS = /[╨╤╥╙╘╒╓╫╪╬░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╧┘┌█▄▌▐▀]/;

export function looksLikeMojibake(value: unknown): boolean {
  return MOJIBAKE_MARKERS.test(String(value ?? ''));
}

/**
 * Восстанавливает строку, испорченную перекодированием UTF-8 ↔ CP866.
 * Возвращает `null`, если восстановление невозможно (символ отсутствует
 * в CP866 или результат не является валидным UTF-8).
 */
export function recoverMojibake(input: unknown): string | null {
  const src = String(input ?? '');
  if (!src) return src;

  const bytes = new Uint8Array(src.length);
  let n = 0;
  for (const ch of src) {
    const b = TO_CP866.get(ch);
    if (b === undefined) return null;
    bytes[n++] = b;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, n));
  } catch {
    return null;
  }
}

/**
 * Восстанавливает значение только при явных признаках порчи,
 * иначе возвращает исходную строку без изменений.
 */
export function recoverIfMojibake(input: unknown): string {
  const src = String(input ?? '');
  if (!looksLikeMojibake(src)) return src;
  return recoverMojibake(src) ?? src;
}

/**
 * Рекурсивно восстанавливает все строковые значения внутри JSON-значения
 * (поля `ingredients`, `ingredients_detailed`, снапшоты дней планов).
 */
export function recoverDeep<T>(value: T): T {
  if (typeof value === 'string') return recoverIfMojibake(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => recoverDeep(v)) as unknown as T;

  // Особые объекты нельзя пересобирать через Object.entries: у Date нет
  // собственных перечислимых свойств, поэтому вместо даты получался
  // пустой объект. При записи в БД это давало ошибку
  // `invalid input syntax for type timestamp: "Invalid date"`.
  if (value instanceof Date) return value;
  if (value instanceof RegExp || value instanceof Error) return value;
  if (Buffer.isBuffer(value)) return value;

  if (value && typeof value === 'object') {
    // Сохраняем прототип: для экземпляров классов (модели Sequelize,
    // вложенные объекты) обычный литерал потерял бы их поведение.
    const proto = Object.getPrototypeOf(value);
    const out: Record<string, unknown> =
      proto === Object.prototype || proto === null
        ? {}
        : (Object.create(proto) as Record<string, unknown>);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = recoverDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
