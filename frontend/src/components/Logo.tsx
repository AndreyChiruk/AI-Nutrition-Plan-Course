/**
 * Логотип приложения.
 *
 * Концепция знака: тарелка (круг) с галочкой внутри — питание плюс
 * выполненный план. Две простые формы читаются в 16×16 и не теряют
 * смысл в монохроме.
 *
 * Компонент рисует SVG инлайном, а не подключает файл: так цвет
 * задаётся через `currentColor` и автоматически подстраивается
 * под светлую и тёмную тему без отдельных файлов.
 */

/**
 * В обычном режиме знак не рисуется: остаётся только название.
 * Флаг тот же, что и для остальных иконок (см. components/icons.tsx).
 */
const PLAIN = true;

/** Знак без подписи. */
function LogoMark({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      aria-hidden
      focusable="false"
    >
      <circle cx="32" cy="32" r="26" stroke="currentColor" strokeWidth="6" />
      <path
        d="M21 33.5 L28.5 41 L44 24.5"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Logo({
  variant = 'full',
  size,
  className = '',
}: {
  /** `full` — знак с названием, `icon` — только знак. */
  variant?: 'full' | 'icon';
  /** Размер знака в пикселях. По умолчанию 28 для полного, 32 для знака. */
  size?: number;
  className?: string;
}) {
  const px = size ?? (variant === 'full' ? 28 : 32);

  if (variant === 'icon') {
    // Без знака отдельная иконка не нужна — показываем название.
    if (PLAIN) {
      return <span className={`logo logo-full ${className}`}><span className="logo-text">Планировщик питания</span></span>;
    }
    return (
      <span className={`logo logo-icon ${className}`} aria-label="Планировщик питания" role="img">
        <LogoMark size={px} />
      </span>
    );
  }

  return (
    <span className={`logo logo-full ${className}`}>
      {PLAIN ? null : (
        <span className="logo-mark" aria-hidden>
          <LogoMark size={px} />
        </span>
      )}
      <span className="logo-text">Планировщик питания</span>
    </span>
  );
}
