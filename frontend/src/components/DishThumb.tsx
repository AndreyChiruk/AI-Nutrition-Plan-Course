import { useState } from 'react';
import { CookingPot, Coffee, Salad, Soup } from '../components/icons';

/**
 * Миниатюра блюда с запасным SVG-изображением.
 *
 * Зачем: картинки блюд берутся с TheMealDB (`strMealThumb`). Если внешний
 * ресурс недоступен (нет сети, блокировка, устаревший URL), браузер
 * показывал «битую» иконку — пользователь видел сломанный список блюд.
 *
 * Здесь при ошибке загрузки показывается локальная SVG-иконка по категории
 * блюда: она всегда доступна, не требует сети и не ломает вёрстку.
 * При отсутствии URL сразу рисуется запасной вариант.
 */

/**
 * Размеры превью.
 *
 * Увеличены по сравнению с первой версией (36/48/64): в каталоге
 * фотографии были меньше читаемого размера и не давали понять,
 * что за блюдо на картинке.
 *
 * `fill` — особый режим для описания блюда: картинка занимает всю
 * ширину карточки, высота задаётся через CSS (не меньше 400px).
 */
const SIZE = {
  sm: 64,
  md: 96,
  lg: 132,
} as const;

export type DishThumbSize = keyof typeof SIZE | 'fill';

/** Иконка и цвет зависят от приёма пищи — визуально отличает категории. */
function iconForSlot(slot?: string | null) {
  switch (slot) {
    case 'breakfast':
      return { Icon: Coffee, tone: 'thumb-breakfast', label: 'Завтрак' };
    case 'lunch':
      return { Icon: Soup, tone: 'thumb-lunch', label: 'Обед' };
    case 'dinner':
      return { Icon: CookingPot, tone: 'thumb-dinner', label: 'Ужин' };
    case 'snack':
      return { Icon: Salad, tone: 'thumb-snack', label: 'Перекус' };
    default:
      return { Icon: CookingPot, tone: 'thumb-default', label: 'Блюдо' };
  }
}

export function DishThumb({
  imageUrl,
  name,
  slot,
  size = 'sm',
  className = '',
}: {
  imageUrl?: string | null;
  name?: string | null;
  slot?: string | null;
  size?: DishThumbSize;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const { Icon, tone, label } = iconForSlot(slot);
  const isFill = size === 'fill';
  const px = isFill ? 0 : SIZE[size];

  // Проверяем именно непустую строку: `Boolean('   ')` даёт true,
  // и пробельный URL приводил к попытке загрузить пустое изображение.
  const hasImage = String(imageUrl ?? '').trim().length > 0 && !failed;

  // В режиме `fill` размеры задаёт CSS: ширина по контейнеру,
  // высота — не меньше 400px, чтобы фото в описании было крупным.
  const fillClass = isFill ? 'dish-thumb-fill' : '';
  // Высота — от соотношения 4:3, а не равна ширине: иначе неквадратные
  // фотографии сжимались по горизонтали.
  const sizeStyle = isFill
    ? undefined
    : { width: px, height: Math.round((px * 3) / 4) };

  if (!hasImage) {
    return (
      <span
        className={`dish-thumb-fallback ${tone} ${fillClass} ${className}`}
        style={sizeStyle}
        role="img"
        aria-label={name ? `${label}: ${name}` : label}
        title={name ?? label}
      >
        <Icon size={isFill ? 72 : Math.round(px * 0.5)} strokeWidth={1.75} />
      </span>
    );
  }

  return (
    <img
      src={String(imageUrl)}
      alt={name ? `Фото блюда «${name}»` : ''}
      className={`catalog-dish-thumb ${fillClass} ${className}`}
      style={sizeStyle}
      loading="lazy"
      decoding="async"
      // При ошибке загрузки переключаемся на SVG-заглушку,
      // а не показываем сломанное изображение.
      onError={() => setFailed(true)}
    />
  );
}