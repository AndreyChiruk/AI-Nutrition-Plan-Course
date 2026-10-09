import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join, resolve, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  detectImageMime,
  MAX_IMAGE_BYTES,
  optimizeImageBuffer,
} from '../common/image-validation.util';

/**
 * Хранилище фотографий продуктов холодильника.
 *
 * Файлы лежат на диске в каталоге `UPLOAD_DIR` (по умолчанию
 * `/app/uploads`), который монтируется как том Docker — иначе
 * фотографии исчезали бы при каждой пересборке контейнера.
 *
 * Изображения нормализуются перед записью: уменьшаются до разумного
 * размера и перекодируются в WebP. Это важно, потому что пользователь
 * может загрузить фотографию с телефона на 5–8 МБ, а показывать её
 * нужно в списке размером 40×40.
 *
 * Имена файлов генерируются (`uuid.webp`), а не берутся из запроса:
 * имя от пользователя могло бы содержать `../` и вывести запись
 * за пределы каталога.
 */

/** Каталог для загрузок. */
const UPLOAD_DIR = process.env.UPLOAD_DIR?.trim() || '/app/uploads';

/** Подкаталог для фотографий продуктов. */
const FRIDGE_SUBDIR = 'fridge';

/** Публичный префикс, по которому файлы отдаёт Nginx. */
export const UPLOAD_PUBLIC_PREFIX = '/uploads';

/** Сколько пикселей достаточно для миниатюры продукта. */
const TARGET_MAX_DIMENSION = 800;

export type StoredImage = {
  /** Относительный путь, который сохраняется в БД (`/uploads/fridge/x.webp`). */
  url: string;
  /** Размер файла после обработки. */
  bytes: number;
};

@Injectable()
export class FridgeImageStorage {
  private readonly logger = new Logger(FridgeImageStorage.name);

  /** Абсолютный путь к каталогу фотографий. */
  private get dir(): string {
    return join(UPLOAD_DIR, FRIDGE_SUBDIR);
  }

  /**
   * Проверяет, что итоговый путь остаётся внутри каталога загрузок.
   *
   * Защита от обхода каталога: даже если имя файла будет подставлено
   * извне, запись не выйдет за пределы `UPLOAD_DIR`.
   */
  private assertInside(filePath: string): void {
    const root = resolve(UPLOAD_DIR);
    const target = resolve(filePath);
    if (!target.startsWith(root)) {
      throw new BadRequestException('Недопустимый путь к файлу.');
    }
  }

  /** Создаёт каталог, если его ещё нет. */
  private async ensureDir(): Promise<void> {
    await fs.mkdir(this.dir, { recursive: true });
  }

  /**
   * Сохраняет загруженный файл.
   *
   * Возвращает публичный URL для записи в БД.
   */
  async save(buffer: Buffer, originalName?: string): Promise<StoredImage> {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Файл пустой.');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new BadRequestException(
        `Файл больше ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} МБ.`,
      );
    }

    // Тип определяется по содержимому, а не по расширению или заголовку
    // от клиента: их легко подделать.
    const mime = detectImageMime(buffer);
    if (!mime) {
      throw new BadRequestException('Поддерживаются JPEG, PNG и WebP.');
    }

    // Уменьшаем и перекодируем в WebP. Если обработка не удалась,
    // сохраняем исходный формат — лучше показать фото, чем отказать.
    let data = buffer;
    let ext = extname(originalName ?? '').toLowerCase() || '.jpg';
    try {
      const optimized = await optimizeImageBuffer(buffer, TARGET_MAX_DIMENSION);
      if (optimized && optimized.length > 0) {
        data = optimized;
        ext = '.webp';
      }
    } catch (e) {
      this.logger.warn(`Не удалось оптимизировать изображение: ${String(e)}`);
    }

    const fileName = `${randomUUID()}${ext}`;
    await this.ensureDir();
    const filePath = join(this.dir, fileName);
    this.assertInside(filePath);

    await fs.writeFile(filePath, data);

    return {
      url: `${UPLOAD_PUBLIC_PREFIX}/${FRIDGE_SUBDIR}/${fileName}`,
      bytes: data.length,
    };
  }

  /**
   * Удаляет файл по публичному URL.
   *
   * Ошибки удаления не пробрасываются: если файла уже нет, запись
   * в БД всё равно должна обновиться.
   */
  async removeByUrl(url: string | null | undefined): Promise<void> {
    const value = String(url ?? '').trim();
    if (!value.startsWith(`${UPLOAD_PUBLIC_PREFIX}/`)) return;

    const relative = value.slice(UPLOAD_PUBLIC_PREFIX.length + 1);
    const filePath = join(UPLOAD_DIR, relative);
    this.assertInside(filePath);

    try {
      await fs.unlink(filePath);
    } catch (e) {
      this.logger.warn(`Не удалось удалить файл ${filePath}: ${String(e)}`);
    }
  }
}
