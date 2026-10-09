/**
 * Отображение БЖУ одной строкой без переносов.
 *
 * Проблема: значения выводились как «Б: 20 / Ж: 15 / У: 30» обычным текстом
 * внутри абзаца. При узкой колонке или длинном числе строка переносилась
 * в неожиданном месте («У:» оставалось на одной строке, значение — на другой),
 * и таблица выглядела неаккуратно.
 *
 * Решение: каждое значение — отдельный блок с `white-space: nowrap` и
 * моноширинным шрифтом для цифр. Перенос между подписью и числом невозможен.
 */

type MacroValues = {
  protein?: number | null;
  fat?: number | null;
  carbs?: number | null;
};

/** Округление до одного знака: в БД бывают значения вида 1245.7999999999997. */
export function round1(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 10) / 10);
}

/**
 * Компактный вывод макросов.
 *
 * @param variant `inline` — для абзацев и таблиц; `stacked` — для карточек,
 *        где подписи стоят над числами (числа выравниваются по ширине).
 */
export function MacroRow({
  protein,
  fat,
  carbs,
  variant = 'inline',
  className = '',
}: MacroValues & { variant?: 'inline' | 'stacked'; className?: string }) {
  const items = [
    { key: 'Б', value: round1(protein), title: 'Белки, г' },
    { key: 'Ж', value: round1(fat), title: 'Жиры, г' },
    { key: 'У', value: round1(carbs), title: 'Углеводы, г' },
  ];

  if (variant === 'stacked') {
    return (
      <div className={`macro-stack ${className}`}>
        {items.map((i) => (
          <div key={i.key} className="macro-stack-item" title={i.title}>
            <span className="macro-label">{i.key}</span>
            <span className="macro-value">{i.value}</span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <span className={`macro-row ${className}`}>
      {items.map((i) => (
        <span key={i.key} className="macro-cell" title={i.title}>
          <span className="macro-label">{i.key}</span>
          <span className="macro-value">{i.value}</span>
        </span>
      ))}
    </span>
  );
}

/** Калории отдельным блоком — тоже без переноса. */
export function CalorieValue({ calories, unit = 'ккал' }: { calories?: number | null; unit?: string }) {
  const n = Number(calories);
  const text = Number.isFinite(n) ? String(Math.round(n)) : '0';
  return (
    <span className="calorie-value" title="Калорийность">
      <span className="macro-value">{text}</span>
      <span className="calorie-unit">{unit}</span>
    </span>
  );
}