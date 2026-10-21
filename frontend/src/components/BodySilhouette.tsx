import { useEffect, useState } from 'react';

/**
 * Силуэт тела с подсветкой целиком.
 *
 * Источник графики — Wikimedia Commons, «Human body silhouette.svg»,
 * лицензия Public domain (атрибуция не требуется). Файл хранится
 * в `public/silhouettes/body-front.svg` (один замкнутый контур).
 *
 * ─── Почему подсветка целиком, а не по зонам ────────────────────────────
 *
 * Прежний компонент (`BodyZonesFigure`) красил отдельные области.
 * Но обхваты в приложении не измеряются — они оцениваются по весу,
 * росту и ИМТ. Такая оценка сопоставима по точности только для фигуры
 * в целом, а «обхват плеча», выведенный из ИМТ, создавал ложное
 * впечатление измерения по зонам.
 *
 * ─── Почему SVG вставляется inline, а не через CSS-маску ────────────────
 *
 * Первая версия красила силуэт через `mask-image: url(...)` на пустом
 * элементе. Это оказалось ненадёжным: если маска не применилась,
 * элемент оставался ПУСТЫМ — на странице не было ничего. Диагностировать
 * такое сложно: в разметке элемент есть, а визуально его нет.
 *
 * Теперь SVG загружается и вставляется в DOM напрямую, а цвет задаётся
 * через `fill` контура — это не зависит от поддержки масок. Если файл
 * не загрузился, рисуется запасная схема из простых форм: блок никогда
 * не остаётся пустым.
 */

export type SilhouetteState = 'low' | 'normal' | 'high' | 'unknown';

/** Подпись состояния для интерфейса. */
export const SILHOUETTE_STATE_LABEL: Record<SilhouetteState, string> = {
  low: 'ниже нормы',
  normal: 'норма',
  high: 'выше нормы',
  unknown: 'нет данных',
};

/** Заливка силуэта по состоянию (значения — из дизайн-токенов). */
const STATE_FILL: Record<SilhouetteState, string> = {
  low: 'var(--zone-low)',
  normal: 'var(--zone-normal)',
  high: 'var(--zone-high)',
  unknown: 'var(--zone-unknown)',
};

/** Состояние по ИМТ: границы соответствуют медицинским ориентирам. */
export function stateFromBmi(bmi: number): SilhouetteState {
  if (!Number.isFinite(bmi) || bmi <= 0) return 'unknown';
  if (bmi < 18.5) return 'low';
  if (bmi < 25) return 'normal';
  return 'high';
}

/** Адрес контура. Один файл на оба пола — пропорции задаёт CSS. */
const SILHOUETTE_SRC = '/silhouettes/body-front.svg';

/** Размеры в пикселях: без явных размеров SVG может схлопнуться в 0. */
const SIZE_PX = { sm: 90, md: 140, lg: 200 } as const;

/** Пропорции исходного контура. */
const RATIO = 2195 / 960;

/**
 * Загружает SVG один раз и кэширует результат между экземплярами:
 * на странице силуэт может встречаться несколько раз, а файл весит ~11 КБ.
 */
let cachedMarkup: string | null = null;
let pendingRequest: Promise<string | null> | null = null;

function loadSilhouette(): Promise<string | null> {
  if (cachedMarkup !== null) return Promise.resolve(cachedMarkup);
  if (pendingRequest) return pendingRequest;

  pendingRequest = fetch(SILHOUETTE_SRC)
    .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
    .then((text) => {
      cachedMarkup = text;
      return text;
    })
    .catch(() => null)
    .finally(() => {
      pendingRequest = null;
    });

  return pendingRequest;
}

export function BodySilhouette({
  gender,
  bmi,
  note,
  size = 'md',
}: {
  gender: 'male' | 'female';
  /** ИМТ — по нему определяется состояние силуэта. */
  bmi: number;
  /** Пояснение под силуэтом. */
  note?: string;
  size?: 'sm' | 'md' | 'lg';
}) {
  const [markup, setMarkup] = useState<string | null>(cachedMarkup);
  const state = stateFromBmi(bmi);
  const fill = STATE_FILL[state];
  const px = SIZE_PX[size];

  useEffect(() => {
    if (markup !== null) return;
    let alive = true;
    void loadSilhouette().then((text) => {
      if (alive && text) setMarkup(text);
    });
    return () => {
      alive = false;
    };
  }, [markup]);

  return (
    <figure className={`silhouette silhouette-${size} silhouette-gender-${gender}`}>
      <span
        className="silhouette-frame"
        style={{ width: px, height: Math.round(px * RATIO) }}
        role="img"
        aria-label={`Силуэт: ${SILHOUETTE_STATE_LABEL[state]} (по ИМТ)`}
      >
        {markup ? (
          /*
            Разметка приходит из статического файла сборки, а не от
            пользователя, поэтому вставка безопасна. Цвет применяем
            к контуру через fill: сам файл о состояниях не знает.
          */
          <span
            className="silhouette-svg"
            style={{ color: fill }}
            dangerouslySetInnerHTML={{ __html: markup }}
          />
        ) : (
          /*
            Запасная схема: если файл не загрузился, рисуем упрощённые
            формы. Блок не должен оставаться пустым — иначе непонятно,
            сломалась загрузка или так и задумано.
          */
          <svg viewBox="0 0 100 200" className="silhouette-fallback" aria-hidden>
            <circle cx="50" cy="22" r="16" fill={fill} />
            <rect x="44" y="36" width="12" height="10" rx="3" fill={fill} />
            <path d="M50 44 L24 58 Q20 80 26 96 L50 100 L74 96 Q80 80 76 58 Z" fill={fill} />
            <rect x="12" y="58" width="10" height="70" rx="5" fill={fill} />
            <rect x="78" y="58" width="10" height="70" rx="5" fill={fill} />
            {/* Нижняя часть туловища. В исходном пути было
                `Q30 122 Z` — у квадратичной кривой Q должно быть
                ЧЕТЫРЕ числа (контрольная точка + конец), а дано два.
                Браузер ругался в консоли «Expected number» и этот
                фрагмент не рисовался; заменено на корректное L. */}
            <path d="M26 96 L50 100 L74 96 Q70 122 68 132 L32 132 L30 122 Z" fill={fill} />
            <rect x="32" y="132" width="14" height="66" rx="7" fill={fill} />
            <rect x="54" y="132" width="14" height="66" rx="7" fill={fill} />
          </svg>
        )}
      </span>

      <figcaption className="silhouette-caption">
        <span className="silhouette-current">
          <span className="silhouette-dot" style={{ backgroundColor: fill }} aria-hidden />
          <strong>{SILHOUETTE_STATE_LABEL[state]}</strong>
        </span>
        {note ? <span className="muted small">{note}</span> : null}
      </figcaption>

      {/* Легенда шкалы: без неё цвет силуэта непонятен. */}
      <ul className="silhouette-legend" aria-label="Расшифровка состояний">
        {(['low', 'normal', 'high'] as const).map((s) => (
          <li key={s} className={s === state ? 'is-active' : ''}>
            <span className="silhouette-dot" style={{ backgroundColor: STATE_FILL[s] }} aria-hidden />
            {SILHOUETTE_STATE_LABEL[s]}
          </li>
        ))}
      </ul>
    </figure>
  );
}
