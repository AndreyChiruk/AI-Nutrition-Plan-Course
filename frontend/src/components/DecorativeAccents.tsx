/** Лёгкие inline-SVG для оживления карточек (без внешних ассетов) */

export const AccentMealSvg = () => (
  <svg
    className="decorative-accent-svg"
    viewBox="0 0 120 80"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <defs>
      <linearGradient id="a1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#4ade80" stopOpacity="0.35" />
        <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.2" />
      </linearGradient>
    </defs>
    <ellipse cx="60" cy="44" rx="48" ry="22" fill="url(#a1)" />
    <path
      d="M20 50 Q60 20 100 50"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className="decorative-stroke"
    />
    <circle cx="32" cy="32" r="4" fill="#4ade80" opacity="0.7" />
    <circle cx="88" cy="28" r="3" fill="#fbbf24" opacity="0.7" />
  </svg>
);

export const AccentActivitySvg = () => (
  <svg
    className="decorative-accent-svg"
    viewBox="0 0 120 80"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      d="M12 55 L32 40 L50 50 L70 30 L90 45 L108 35"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="decorative-stroke"
    />
    <circle cx="32" cy="40" r="3" fill="#4ade80" />
    <circle cx="70" cy="30" r="3" fill="#3b82f6" />
    <circle cx="90" cy="45" r="3" fill="#fbbf24" />
  </svg>
);

export const AccentWellnessSvg = () => (
  <svg
    className="decorative-accent-svg"
    viewBox="0 0 120 80"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden
  >
    <path
      d="M60 18 C40 18 25 32 25 50 C25 60 32 66 40 66 L80 66 C88 66 95 60 95 50 C95 32 80 18 60 18 Z"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      className="decorative-stroke"
    />
    <path
      d="M45 50 Q60 35 75 50"
      fill="none"
      stroke="#4ade80"
      strokeWidth="2"
      strokeLinecap="round"
      opacity="0.6"
    />
  </svg>
);
