import { assert } from 'chai';
import { BadRequestException } from '@nestjs/common';
import { describe, it } from 'mocha';
import { parseAndValidateImageDataUrl } from '../../common/image-validation.util';

/**
 * Тесты валидации фотографий.
 *
 * Раньше `photoUrl` был произвольной строкой: ни MIME, ни «магические байты»,
 * ни размер не проверялись. Последствия:
 *   - в БД писался base64 до 35 МБ;
 *   - произвольная строка (`file:///etc/passwd`, `javascript:`, внешний URL)
 *     уходила в OpenAI как `image_url`;
 *   - файл мог быть вовсе не изображением.
 */
describe('валидация фотографий', () => {
  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const webpBytes = Buffer.concat([
    Buffer.from('RIFF'),
    Buffer.from([0, 0, 0, 0]),
    Buffer.from('WEBP'),
    Buffer.from([0, 0, 0, 0]),
  ]);
  const gifBytes = Buffer.from('GIF89a....................', 'binary');

  const asDataUrl = (mime: string, buf: Buffer) =>
    `data:${mime};base64,${buf.toString('base64')}`;

  it('принимает корректный JPEG', () => {
    const r = parseAndValidateImageDataUrl(asDataUrl('image/jpeg', jpegBytes));
    assert.strictEqual(r.mime, 'image/jpeg');
    assert.isAbove(r.buffer.length, 0);
  });

  it('принимает корректный PNG и WebP', () => {
    assert.strictEqual(parseAndValidateImageDataUrl(asDataUrl('image/png', pngBytes)).mime, 'image/png');
    assert.strictEqual(parseAndValidateImageDataUrl(asDataUrl('image/webp', webpBytes)).mime, 'image/webp');
  });

  it('отклоняет строку, которая не является data URL', () => {
    // Важно именно отклонение: раньше такая строка уходила в OpenAI как image_url.
    for (const bad of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'http://evil.com/x.jpg',
      'просто текст',
    ]) {
      assert.throws(() => parseAndValidateImageDataUrl(bad), BadRequestException);
    }
  });

  it('сообщение объясняет ожидаемый формат', () => {
    try {
      parseAndValidateImageDataUrl('file:///etc/passwd');
      assert.fail('должно было выбросить исключение');
    } catch (e) {
      assert.instanceOf(e, BadRequestException);
      assert.include((e as BadRequestException).message, 'data URL');
    }
  });

  it('отклоняет пустое значение', () => {
    assert.throws(() => parseAndValidateImageDataUrl(''), BadRequestException);
    assert.throws(() => parseAndValidateImageDataUrl(null), BadRequestException);
    assert.throws(() => parseAndValidateImageDataUrl(undefined), BadRequestException);
  });

  it('отклоняет неподдерживаемый MIME (SVG, GIF)', () => {
    assert.throws(
      () => parseAndValidateImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='),
      BadRequestException,
    );
    assert.throws(
      () => parseAndValidateImageDataUrl(asDataUrl('image/gif', gifBytes)),
      BadRequestException,
    );
  });

  it('отклоняет подмену формата (GIF под видом JPEG)', () => {
    // Заявлен JPEG, а «магические байты» — GIF.
    assert.throws(
      () => parseAndValidateImageDataUrl(asDataUrl('image/jpeg', gifBytes)),
      BadRequestException,
    );
  });

  it('отклоняет содержимое, не являющееся изображением', () => {
    const notImage = Buffer.from('это вовсе не картинка, а обычный текст');
    assert.throws(
      () => parseAndValidateImageDataUrl(asDataUrl('image/jpeg', notImage)),
      BadRequestException,
    );
  });

  it('отклоняет слишком большую строку', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(13 * 1024 * 1024)}`;
    assert.throws(() => parseAndValidateImageDataUrl(huge), BadRequestException);
  });

  it('сообщение об ошибке содержит имя поля', () => {
    try {
      parseAndValidateImageDataUrl('мусор', 'avatar');
      assert.fail('должно было выбросить исключение');
    } catch (e) {
      assert.instanceOf(e, BadRequestException);
      assert.include((e as BadRequestException).message, 'avatar');
    }
  });
});
