import { BadRequestException } from '@nestjs/common';
import sharp from 'sharp';

/**
 * Валидация и нормализация фотографий, приходящих от клиента.
 *
 * Зачем: `photoUrl` приходил как произвольная строка — data URL без проверки
 * MIME, размера и содержимого. Последствия:
 *   - в БД писался base64 до 35 МБ (лимит тела запроса), раздувая таблицы
 *     и ответы админки (список модерации рендерил эти строки как <img>);
 *   - произвольная строка уходила в OpenAI как `image_url`;
 *   - файл больше не проверялся ни по magic bytes, ни по разрешению.
 *
 * Теперь: проверяем формат по «магическим байтам», ограничиваем размер,
 * при необходимости уменьшаем и перекодируем в JPEG — во внешний API и
 * в хранилище уходит уже нормализованное изображение.
 */

/** Разрешённые MIME-типы изображений. */
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Максимальный размер декодированного изображения, байт. */
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Максимальная длина строки data URL, символов (~11 МБ base64). */
export const MAX_DATA_URL_LENGTH = 12 * 1024 * 1024;

/** Максимальная сторона после нормализации, px. */
const MAX_DIMENSION = 1600;

export type ParsedImage = {
  buffer: Buffer;
  mime: string;
  /** Исходный data URL (для обратной совместимости с полем photoUrl). */
  dataUrl: string;
};

/** Определяет формат по первым байтам файла. */
export function detectImageMime(buf: Buffer): string | null {
  if (buf.length < 4) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png';
  }
  // WebP: RIFF....WEBP
  if (
    buf.length >= 12 &&
    buf.toString('ascii', 0, 4) === 'RIFF' &&
    buf.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Разбирает и проверяет data URL с изображением.
 * Бросает BadRequestException с понятным сообщением при любой проблеме.
 */
export function parseAndValidateImageDataUrl(raw: unknown, fieldName = 'photoUrl'): ParsedImage {
  const dataUrl = String(raw ?? '').trim();
  if (!dataUrl) {
    throw new BadRequestException(`Поле «${fieldName}»: изображение не передано`);
  }
  if (dataUrl.length > MAX_DATA_URL_LENGTH) {
    throw new BadRequestException(
      `Поле «${fieldName}»: изображение слишком большое (лимит ~8 МБ)`,
    );
  }
  if (!/^data:image\/[a-z0-9.+-]+;base64,/i.test(dataUrl)) {
    throw new BadRequestException(
      `Поле «${fieldName}»: ожидается изображение в формате data URL (data:image/...;base64,...)`,
    );
  }

  const m = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (!m) {
    throw new BadRequestException(`Поле «${fieldName}»: некорректный data URL`);
  }

  const declaredMime = m[1].toLowerCase();
  if (!ALLOWED_MIME.has(declaredMime)) {
    throw new BadRequestException(
      `Поле «${fieldName}»: поддерживаются только JPEG, PNG и WebP`,
    );
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(m[2].replace(/\s/g, ''), 'base64');
  } catch {
    throw new BadRequestException(`Поле «${fieldName}»: не удалось декодировать base64`);
  }

  if (buffer.length === 0) {
    throw new BadRequestException(`Поле «${fieldName}»: пустое изображение`);
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException(
      `Поле «${fieldName}»: изображение слишком большое (${Math.round(buffer.length / 1024 / 1024)} МБ, лимит 8 МБ)`,
    );
  }

  // Проверка содержимого, а не только заявленного MIME.
  const actualMime = detectImageMime(buffer);
  if (!actualMime) {
    throw new BadRequestException(
      `Поле «${fieldName}»: файл не является изображением JPEG/PNG/WebP`,
    );
  }
  if (actualMime !== declaredMime) {
    throw new BadRequestException(
      `Поле «${fieldName}»: формат файла (${actualMime}) не совпадает с заявленным (${declaredMime})`,
    );
  }

  return { buffer, mime: actualMime, dataUrl };
}

/**
 * Нормализует изображение: поворачивает по EXIF, уменьшает до разумного
 * размера и перекодирует в JPEG. Возвращает новый data URL.
 *
 * Благодаря этому в БД и во внешний API уходит компактное изображение
 * предсказуемого формата, а не исходный «сырой» base64.
 */
export async function normalizeImageDataUrl(
  image: ParsedImage,
  maxDimension = MAX_DIMENSION,
  quality = 82,
): Promise<{ dataUrl: string; bytes: number; width: number; height: number }> {
  try {
    const pipeline = sharp(image.buffer, { limitInputPixels: 50_000_000 }).rotate();
    const meta = await pipeline.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const resized = await pipeline
      .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality, mozjpeg: true })
      .toBuffer();

    const outMeta = await sharp(resized).metadata();
    return {
      dataUrl: `data:image/jpeg;base64,${resized.toString('base64')}`,
      bytes: resized.length,
      width: outMeta.width ?? width,
      height: outMeta.height ?? height,
    };
  } catch (e) {
    throw new BadRequestException(
      `Не удалось обработать изображение: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

/** Полный цикл: проверить, нормализовать, вернуть готовый data URL. */
export async function validateAndNormalizePhoto(
  raw: unknown,
  fieldName = 'photoUrl',
): Promise<{ dataUrl: string; bytes: number; width: number; height: number }> {
  const parsed = parseAndValidateImageDataUrl(raw, fieldName);
  return normalizeImageDataUrl(parsed);
}

/**
 * Уменьшает изображение и перекодирует в WebP.
 *
 * Нужно для фотографий продуктов: снимок с телефона весит 5–8 МБ,
 * а показывается в списке размером 40×40. Хранить оригинал в полном
 * размере расточительно, тем более что такой файл уходит в том.
 *
 * @param buffer исходные данные
 * @param maxDimension максимальная сторона после уменьшения
 * @returns данные в WebP или null, если sharp недоступен
 */
export async function optimizeImageBuffer(
  buffer: Buffer,
  maxDimension = 800,
): Promise<Buffer | null> {
  try {
    const sharpModule = await import('sharp');
    const sharp = sharpModule.default;
    return await sharp(buffer)
      .rotate() // учитываем EXIF-ориентацию: иначе фото с телефона ляжет набок
      .resize(maxDimension, maxDimension, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toBuffer();
  } catch {
    // Если sharp не смог обработать файл (повреждён, неизвестный формат),
    // возвращаем null — вызывающий код сохранит исходные данные.
    return null;
  }
}
