import { useMemo } from 'react';

export type BodyFigureBmiState = 'normal' | 'deviation' | 'problem' | 'deficit';

type Props = {
  gender: 'male' | 'female';
  bmi: number;
};

function bmiToState(bmi: number): BodyFigureBmiState {
  if (bmi < 18.5) return 'deficit';
  if (bmi < 25) return 'normal';
  if (bmi < 30) return 'deviation';
  return 'problem';
}

const TINT: Record<BodyFigureBmiState, { className: string; label: string }> = {
  normal: { className: 'body-figure-asset__tint--normal', label: 'Норма' },
  deficit: { className: 'body-figure-asset__tint--deficit', label: 'Дефицит веса' },
  deviation: { className: 'body-figure-asset__tint--deviation', label: 'Отклонение' },
  problem: { className: 'body-figure-asset__tint--problem', label: 'Проблемная зона' },
};

const LEGEND: Array<{ state: BodyFigureBmiState; className: string; emoji: string; text: string }> = [
  { state: 'normal', className: 'bmi-legend--normal', emoji: '●', text: 'Норма' },
  { state: 'deficit', className: 'bmi-legend--deficit', emoji: '●', text: 'Дефицит веса' },
  { state: 'deviation', className: 'bmi-legend--deviation', emoji: '●', text: 'Отклонение' },
  { state: 'problem', className: 'bmi-legend--problem', emoji: '●', text: 'Проблемная зона' },
];

export const BodyFigureWithTint = ({ gender, bmi }: Props) => {
  const state = useMemo(() => bmiToState(bmi), [bmi]);
  const { className: tintClass, label } = TINT[state];
  const src = gender === 'male' ? '/body-figure-male.svg' : '/body-figure-female.svg';
  const alt = gender === 'male' ? 'Силуэт (мужской)' : 'Силуэт (женский)';

  return (
    <div className="body-figure-asset">
      <div className="body-figure-asset__frame" aria-label={`Подсветка: ${label}`}>
        <img src={src} alt={alt} className="body-figure-asset__img" width={280} height="auto" loading="lazy" />
        <div className={'body-figure-asset__tint ' + tintClass} aria-hidden />
      </div>
      <p className="body-figure-asset__caption muted small">
        Текущий статус: <strong className="body-figure-asset__status">{label}</strong> (по ИМТ)
      </p>
      <ul className="bmi-legend" aria-label="Расшифровка зон">
        {LEGEND.map((item) => (
          <li
            key={item.state}
            className={
              'bmi-legend__item' +
              (item.state === state ? ' bmi-legend__item--active' : '') +
              ' ' +
              item.className
            }
          >
            <span className="bmi-legend__dot" aria-hidden>
              {item.emoji}
            </span>
            {item.text}
          </li>
        ))}
      </ul>
    </div>
  );
};
