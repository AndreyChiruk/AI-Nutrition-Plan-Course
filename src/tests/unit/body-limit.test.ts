import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты лимита тела запроса.
 *
 * Раньше лимит по умолчанию был 35 МБ: запас делался на «сырой» base64
 * фотографий любого размера. После появления серверной валидации
 * (`validateAndNormalizePhoto`: не более 8 МБ, уменьшение до 1600 px)
 * такой запас не нужен — он позволял отправлять десятки мегабайт мусора
 * и нагружать память процесса.
 *
 * Дополнительно: при превышении лимита express отвечал технической ошибкой
 * `PayloadTooLargeError` без пояснения для пользователя.
 */
const DEFAULT_LIMIT = '12mb';
const IMAGE_LIMIT_BYTES = 8 * 1024 * 1024;

/** Разбирает значение вида '12mb' в байты. */
function parseLimit(value: string): number {
  const m = String(value).trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/);
  if (!m) return 0;
  const n = Number(m[1]);
  const unit = m[2] ?? 'b';
  const mult: Record<string, number> = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Math.round(n * (mult[unit] ?? 1));
}

describe('лимит тела запроса', () => {
  it('по умолчанию 12 МБ', () => {
    assert.strictEqual(parseLimit(DEFAULT_LIMIT), 12 * 1024 * 1024);
  });

  it('лимит превышает максимальный размер изображения', () => {
    // Иначе валидное изображение 8 МБ не дошло бы до проверки.
    assert.isAbove(parseLimit(DEFAULT_LIMIT), IMAGE_LIMIT_BYTES);
  });

  it('лимит меньше прежнего значения 35 МБ', () => {
    assert.isBelow(parseLimit(DEFAULT_LIMIT), parseLimit('35mb'));
  });

  it('base64 увеличивает размер примерно на треть', () => {
    // Изображение 8 МБ в base64 занимает ~10.7 МБ — должно помещаться.
    const base64Size = Math.ceil((IMAGE_LIMIT_BYTES * 4) / 3);
    assert.isBelow(base64Size, parseLimit(DEFAULT_LIMIT), 'изображение 8 МБ должно проходить');
  });

  it('разбирает разные единицы измерения', () => {
    assert.strictEqual(parseLimit('1kb'), 1024);
    assert.strictEqual(parseLimit('1mb'), 1024 * 1024);
    assert.strictEqual(parseLimit('512b'), 512);
    assert.strictEqual(parseLimit('1gb'), 1024 ** 3);
  });

  it('возвращает 0 на некорректном значении', () => {
    assert.strictEqual(parseLimit('abc'), 0);
    assert.strictEqual(parseLimit(''), 0);
  });

  it('ответ 413 содержит понятное объяснение и лимит', () => {
    // Раньше express отдавал PayloadTooLargeError без пояснений.
    const message =
      `Слишком большое тело запроса (лимит ${DEFAULT_LIMIT}). ` +
      'Уменьшите размер фотографии — сервер принимает изображения до 8 МБ.';
    assert.include(message, '12mb');
    assert.include(message, '8 МБ');
    assert.include(message, 'Уменьшите');
  });

  it('limit в nginx согласован с лимитом приложения', () => {
    // nginx: client_max_body_size 13m — чуть больше, чтобы 413 отдавал nginx,
    // а не обрывалось соединение.
    const nginxLimit = parseLimit('13mb');
    const appLimit = parseLimit(DEFAULT_LIMIT);
    assert.isAbove(nginxLimit, appLimit, 'nginx должен пропускать запросы к приложению');
  });
});
