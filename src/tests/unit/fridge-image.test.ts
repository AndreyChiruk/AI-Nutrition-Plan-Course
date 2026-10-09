import { assert } from 'chai';
import { describe, it } from 'mocha';
import { detectImageMime, MAX_IMAGE_BYTES } from '../../common/image-validation.util';

/**
 * Тесты загрузки фотографий продуктов.
 *
 * Формат файла определяется по СОДЕРЖИМОМУ, а не по расширению или
 * заголовку `Content-Type` от клиента: и то, и другое легко подделать.
 * Поэтому проверяем определение по сигнатуре файла.
 */

/** Собирает буфер с заданной сигнатурой в начале. */
function bufWith(signature: number[], size = 64): Buffer {
  const buf = Buffer.alloc(size);
  signature.forEach((byte, i) => {
    buf[i] = byte;
  });
  return buf;
}

describe('загрузка фото: определение формата', () => {
  it('распознаёт JPEG по сигнатуре FF D8 FF', () => {
    assert.strictEqual(detectImageMime(bufWith([0xff, 0xd8, 0xff])), 'image/jpeg');
  });

  it('распознаёт PNG по сигнатуре 89 50 4E 47', () => {
    assert.strictEqual(
      detectImageMime(bufWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
      'image/png',
    );
  });

  it('распознаёт WebP по RIFF....WEBP', () => {
    const buf = Buffer.alloc(32);
    buf.write('RIFF', 0, 'ascii');
    buf.write('WEBP', 8, 'ascii');
    assert.strictEqual(detectImageMime(buf), 'image/webp');
  });

  it('отклоняет посторонние данные', () => {
    // Текстовый файл не должен приниматься как изображение,
    // даже если клиент прислал Content-Type: image/png.
    assert.isNull(detectImageMime(Buffer.from('это не картинка')));
    assert.isNull(detectImageMime(bufWith([0x25, 0x50, 0x44, 0x46]))); // PDF
  });

  it('отклоняет слишком короткий буфер', () => {
    assert.isNull(detectImageMime(Buffer.from([0xff])));
    assert.isNull(detectImageMime(Buffer.alloc(0)));
  });

  it('исполняемый файл не проходит проверку', () => {
    // ELF-заголовок: подмена расширения на .jpg не поможет.
    assert.isNull(detectImageMime(bufWith([0x7f, 0x45, 0x4c, 0x46])));
  });
});

describe('загрузка фото: ограничения', () => {
  it('лимит размера равен 8 МБ', () => {
    assert.strictEqual(MAX_IMAGE_BYTES, 8 * 1024 * 1024);
  });

  it('лимит достаточен для фото с телефона', () => {
    // Типичный снимок 12 Мп — 3–5 МБ, поэтому 8 МБ хватает с запасом.
    assert.isAtLeast(MAX_IMAGE_BYTES, 5 * 1024 * 1024);
  });
});
