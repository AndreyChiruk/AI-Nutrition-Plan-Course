import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Search, X } from '../components/icons';
import { mealPlanApi } from '../api/services';

/**
 * Выбор любимых и нежелательных продуктов через поиск по каталогу.
 *
 * Раньше это были текстовые поля со значениями через запятую. Пользователь
 * писал «курица», тогда как в каталоге было «Куриная грудка», и предпочтение
 * не срабатывало: планировщик искал подстроку и ничего не находил.
 *
 * Теперь значение выбирается из реальных записей БД (ингредиенты и блюда),
 * поэтому планировщик гарантированно его распознаёт.
 */

export type PreferenceItem = {
  name: string;
  type: 'ingredient' | 'dish';
};

type Suggestion = {
  type: 'ingredient' | 'dish';
  name: string;
  category?: string | null;
};

export function FoodPreferencePicker({
  label,
  hint,
  values,
  onChange,
  placeholder = 'Начните вводить название…',
  tone = 'neutral',
  disabled = false,
}: {
  label: string;
  hint?: string;
  values: PreferenceItem[];
  onChange: (next: PreferenceItem[]) => void;
  placeholder?: string;
  /** `like` — зелёный акцент, `dislike` — красный. */
  tone?: 'like' | 'dislike' | 'neutral';
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  /** Отменяет устаревшие ответы: без этого при быстром вводе
   *  результат старого запроса мог перезаписать новый. */
  const requestId = useRef(0);

  const selectedNames = useMemo(
    () => new Set(values.map((v) => v.name.toLowerCase())),
    [values],
  );

  // Поиск с задержкой: не отправляем запрос на каждую букву.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    const id = ++requestId.current;
    setLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const found = (await mealPlanApi.catalogSearch(q, 12)) as Suggestion[];
        if (id !== requestId.current) return; // ответ устарел
        setSuggestions(Array.isArray(found) ? found : []);
        setActiveIndex(0);
      } catch {
        if (id === requestId.current) setSuggestions([]);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [query]);

  // Закрываем список при клике вне компонента.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, []);

  const add = (item: Suggestion) => {
    const name = item.name.trim();
    if (!name || selectedNames.has(name.toLowerCase())) {
      setQuery('');
      setOpen(false);
      return;
    }
    onChange([...values, { name, type: item.type }]);
    setQuery('');
    setSuggestions([]);
    setOpen(false);
  };

  const remove = (name: string) => {
    onChange(values.filter((v) => v.name !== name));
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, Math.max(0, suggestions.length - 1)));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const pick = suggestions[activeIndex];
      if (pick) add(pick);
      return;
    }
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Backspace' && !query && values.length > 0) {
      // Быстрое удаление последнего выбранного значения.
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div className={`pref-picker pref-picker-${tone}`} ref={boxRef}>
      <label className="pref-picker-label">
        {label}
        {hint ? <span className="pref-picker-hint">{hint}</span> : null}
      </label>

      {/* Выбранные значения */}
      {values.length > 0 ? (
        <ul className="pref-chips">
          {values.map((v) => (
            <li key={v.name} className="pref-chip">
              <span className="pref-chip-type" title={v.type === 'dish' ? 'Блюдо' : 'Продукт'}>
                {v.type === 'dish' ? 'Б' : 'П'}
              </span>
              <span className="pref-chip-name">{v.name}</span>
              <button
                type="button"
                className="pref-chip-remove"
                onClick={() => remove(v.name)}
                disabled={disabled}
                aria-label={`Убрать «${v.name}»`}
                title="Убрать"
              >
                <X size={12} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small pref-empty">Ничего не выбрано</p>
      )}

      {/* Поле поиска */}
      <div className="pref-search">
        <Search size={15} className="pref-search-icon" aria-hidden />
        <input
          type="text"
          value={query}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          aria-autocomplete="list"
          aria-expanded={open && suggestions.length > 0}
          role="combobox"
        />
        {loading ? <Loader2 size={15} className="pref-spinner" aria-hidden /> : null}
      </div>

      {/* Подсказки */}
      {open && query.trim().length >= 2 ? (
        <div className="pref-suggest" role="listbox">
          {suggestions.length === 0 && !loading ? (
            <p className="pref-suggest-empty">
              Ничего не найдено. Попробуйте другое слово.
            </p>
          ) : null}
          {suggestions.map((s, idx) => {
            const already = selectedNames.has(s.name.toLowerCase());
            return (
              <button
                key={`${s.type}-${s.name}`}
                type="button"
                role="option"
                aria-selected={idx === activeIndex}
                className={`pref-suggest-item ${idx === activeIndex ? 'is-active' : ''} ${
                  already ? 'is-selected' : ''
                }`}
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => add(s)}
              >
                <span className="pref-suggest-name">{s.name}</span>
                <span className="pref-suggest-meta">
                  {s.type === 'dish' ? 'блюдо' : 'продукт'}
                  {s.category ? ` · ${s.category}` : ''}
                  {already ? ' · уже выбрано' : ''}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}