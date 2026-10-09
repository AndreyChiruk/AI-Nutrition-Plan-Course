import { useState } from 'react';

/**
 * Изображение продукта с заглушкой по категории.
 *
 * Продукты в холодильнике могут не иметь фотографии: пользователь
 * добавил название вручную, или в справочнике нет картинки. Раньше
 * в списке показывался только текст — по названию не всегда понятно,
 * что это за продукт.
 *
 * Здесь три источника изображения, по приоритету:
 *   1. `src` — фотография из каталога или загруженная пользователем;
 *   2. заглушка по категории — локальный SVG, если фото нет
 *      или оно не загрузилось;
 *   3. универсальная заглушка `other`, если категория неизвестна.
 *
 * Заглушки векторные и используют `currentColor`, поэтому корректно
 * выглядят в светлой и тёмной теме без отдельных файлов.
 */

/** Категории, для которых есть отдельные заглушки. */
const KNOWN_CATEGORIES = new Set([
  'dairy',
  'meat',
  'vegetables',
  'fruits',
  'grains',
  'drinks',
  'other',
]);

export type ProductImageSize = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<ProductImageSize, number> = {
  sm: 40,
  md: 80,
  lg: 160,
};

/**
 * Приводит название категории из БД к имени файла заглушки.
 *
 * В справочнике категории записаны по-русски («Молочные продукты»,
 * «Крупы и мучное»), поэтому нужен маппинг, а не прямое совпадение.
 */
export function normalizeCategory(raw?: string | null): string {
  const value = String(raw ?? '').trim().toLowerCase();
  if (!value) return 'other';
  if (KNOWN_CATEGORIES.has(value)) return value;

  if (/молоч|сыр|творог|кефир|йогурт|сливк|масло сливочн/.test(value)) return 'dairy';
  if (/мяс|птиц|курин|говя|свинин|баранин|фарш|колбас|рыб|морепрод|субпродукт/.test(value)) return 'meat';
  if (/овощ|зелень|корнеплод|капуст|картоф|морков|лук|помидор|огур/.test(value)) return 'vegetables';
  if (/фрукт|ягод|яблок|банан|цитрус|сухофрукт/.test(value)) return 'fruits';
  if (/круп|мучн|макарон|хлеб|зерн|бобов|рис|греч/.test(value)) return 'grains';
  if (/напит|сок|вода|чай|кофе|компот|морс/.test(value)) return 'drinks';
  return 'other';
}

export function ProductImage({
  src,
  category,
  alt,
  size = 'sm',
  className = '',
}: {
  /** Адрес фотографии. Может отсутствовать. */
  src?: string | null;
  /** Категория продукта — по ней выбирается заглушка. */
  category?: string | null;
  /** Название продукта: идёт в alt и подсказку. */
  alt?: string | null;
  size?: ProductImageSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const px = SIZE_PX[size];
  const cat = normalizeCategory(category);

  // Проверяем непустую строку: пробельный URL не должен запускать загрузку.
  const hasPhoto = String(src ?? '').trim().length > 0 && !failed;
  const label = String(alt ?? '').trim();

  if (!hasPhoto) {
    return (
      <span
        className={`product-image product-image-placeholder product-cat-${cat} ${className}`}
        style={{ width: px, height: px }}
        role="img"
        aria-label={label ? `${label} (изображение отсутствует)` : 'Изображение отсутствует'}
        title={label || undefined}
      >
        <img
          src={`/placeholders/fridge/${cat}.svg`}
          alt=""
          width={Math.round(px * 0.55)}
          height={Math.round(px * 0.55)}
          loading="lazy"
          decoding="async"
        />
      </span>
    );
  }

  return (
    <img
      src={String(src)}
      alt={label ? `Фото: ${label}` : ''}
      className={`product-image product-image-photo ${className}`}
      style={{ width: px, height: px }}
      loading="lazy"
      decoding="async"
      // При ошибке загрузки показываем заглушку, а не сломанную иконку.
      onError={() => setFailed(true)}
    />
  );
}
