/**
 * Подготовка изображения к отправке на сервер.
 *
 * Зачем сжимать в браузере:
 *   - сервер принимает data URL до 8 МБ, а снимок с телефона весит
 *     6–10 МБ и в base64 становится примерно на треть больше —
 *     запрос отклонялся с ошибкой 400;
 *   - камера телефона снимает 12 Мп, тогда как для анализа фигуры
 *     достаточно 1600 px по длинной стороне.
 *
 * Дополнительно решается проблема форматов: iPhone сохраняет снимки
 * в HEIC, который сервер не принимает. Canvas перекодирует любое
 * изображение, которое умеет открыть браузер, в JPEG.
 */

/** Максимальная сторона после уменьшения, px. */
const MAX_DIMENSION = 1600;

/** Качество JPEG: 0.82 сохраняет детали и заметно уменьшает вес. */
const JPEG_QUALITY = 0.82;

/** Если после сжатия файл всё ещё больше — снижаем качество. */
const MAX_RESULT_BYTES = 6 * 1024 * 1024;

/**
 * Загружает файл в HTMLImageElement.
 *
 * `createImageBitmap` не используется: он не поддерживает часть
 * форматов в Safari, а тег img с object URL работает везде.
 */
function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Не удалось открыть изображение'));
    };
    img.src = url;
  });
}

/**
 * Уменьшает изображение и возвращает data URL в JPEG.
 *
 * Если браузер не смог обработать файл (например, повреждён),
 * функция пробрасывает ошибку — вызывающий код показывает сообщение.
 *
 * @param file выбранный пользователем файл
 * @returns data URL вида `data:image/jpeg;base64,...`
 */
export async function prepareImage(file: File): Promise<string> {
  const img = await loadImage(file);

  // Вписываем в квадрат MAX_DIMENSION, сохраняя пропорции.
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    // Canvas недоступен — отдаём исходный файл, пусть решает сервер.
    return readAsDataUrl(file);
  }

  // Белый фон: прозрачные PNG при перекодировании в JPEG иначе
  // становятся чёрными.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  let quality = JPEG_QUALITY;
  let dataUrl = canvas.toDataURL('image/jpeg', quality);

  // Если файл всё ещё велик, снижаем качество ступенями.
  while (dataUrl.length > MAX_RESULT_BYTES && quality > 0.5) {
    quality -= 0.1;
    dataUrl = canvas.toDataURL('image/jpeg', quality);
  }

  return dataUrl;
}

/** Читает файл как data URL без обработки. */
function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Пустой результат чтения'));
    };
    reader.onerror = () => reject(new Error('Ошибка чтения файла'));
    reader.readAsDataURL(file);
  });
}
