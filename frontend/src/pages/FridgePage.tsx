import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarClock, ImageOff, ImagePlus, Loader2, Package, Pencil, Plus, Trash2, X } from '../components/icons';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { mealPlanApi, userApi } from '../api/services';
import { getApiErrorInfo } from '../api/errors';
import { ProductImage } from '../components/ProductImage';

/**
 * Страница «Мой холодильник».
 *
 * Раньше это был небольшой блок внутри профиля: название вводилось свободным
 * текстом, единица измерения выбиралась из списка, а редактировать количество
 * можно было только удалив продукт и добавив заново. Не было группировки
 * по категориям и поиска по справочнику.
 *
 * Теперь это отдельная страница:
 *   - добавление через поиск по справочнику ингредиентов (автокомплит);
 *   - группировка по категориям (молочное, мясо, овощи, крупы…);
 *   - изменение количества прямо в списке;
 *   - срок годности с подсветкой «истекает» и «просрочен»;
 *   - сводка: сколько продуктов и сколько скоро испортится.
 */

type FridgeUnit = 'г' | 'кг' | 'мл' | 'л' | 'шт';

type FridgeItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  expiresAt?: string | null;
  category?: string;
  matchedInCatalog?: boolean;
  /** Фотография из каталога или загруженная пользователем. */
  imageUrl?: string | null;
  imageSource?: 'user' | 'catalog' | 'placeholder';
};

/**
 * Единицы для жидкостей и для еды.
 *
 * Раньше в списке всегда были все пять единиц сразу, и для «молока»
 * предлагались граммы, а для «гречки» — миллилитры. Теперь набор
 * зависит от категории продукта: объём для питья, «шт» для штучных,
 * масса для всего остального (крупы, мука, мясо).
 */
const LIQUID_UNITS: FridgeUnit[] = ['мл', 'л'];
/** Сыпучее и весовое: крупы, мука, мясо — «шт» не предлагаем. */
const SOLID_UNITS: FridgeUnit[] = ['г', 'кг'];
/** Еда, которую считают штуками (яйца, фрукты) — без «г» и «кг». */
const COUNTABLE_UNITS: FridgeUnit[] = ['шт'];

/**
 * Похоже ли, что продукт — жидкость.
 *
 * Ориентируемся на категорию из справочника, а если её нет (пользователь
 * ввёл название руками) — на характерные слова в названии. Проверяем
 * сначала «напитки», чтобы «молочный коктейль» не считался едой.
 */
const LIQUID_CATEGORY_RE = /напит|жидкост|вода|сок|молок|кефир|бульон|соус|масло/i;
const LIQUID_NAME_RE = /молок|молочн|кефир|ряженк|сок|вода|чай|кофе|компот|бульон|напит|сироп|уксус|вино|пиво|сливк|йогурт/i;
/**
 * Считают ли продукт штуками.
 *
 * Раньше «шт» предлагалось всем: гречку или муку можно было «взять
 * 3 штуки», что бессмысленно. Штуки оставлены там, где продукт реально
 * считают поштучно — яйца, фрукты, овощи, выпечка.
 *
 * Составные блюда («каша», «суп») в штуках тоже не измеряют,
 * поэтому проверяем и категорию, и название.
 */
const COUNTABLE_CATEGORY_RE = /яйц|фрукт|овощ|ягод|бахчев|гриб|зелень|орех|сухофрукт|хлеб|выпечк|кондитер/i;
const COUNTABLE_NAME_RE = /\bяйц|яблок|банан|апельсин|мандарин|груш|лимон|лайм|киви|авокадо|томат|помидор|огурец|перец|лук|морков|картоф|кабачок|баклажан|свекл|капуст|редис|виноград|слив|персик|абрикос|вишн|черешн|гранат|манго|ананас|хлеб|батон|булочк|лаваш|яйцо|яйца|зубчик/i;

function isCountableProduct(name: string, category?: string | null): boolean {
  const text = String(name ?? '').toLowerCase();
  if (COUNTABLE_CATEGORY_RE.test(category ?? '')) return true;
  return COUNTABLE_NAME_RE.test(text);
}

/**
 * Итоговый список единиц для продукта.
 *
 * Жидкости — объём, штучные продукты — только «шт», остальная еда —
 * масса. Список никогда не пустой: интерфейс всегда показывает хотя бы
 * одну единицу.
 */
function unitsForFridge(name: string, category?: string | null): FridgeUnit[] {
  const hay = `${category ?? ''} ${name}`.toLowerCase();
  if (LIQUID_CATEGORY_RE.test(category ?? '') || LIQUID_NAME_RE.test(hay)) return LIQUID_UNITS;
  if (isCountableProduct(name, category)) return COUNTABLE_UNITS;
  return SOLID_UNITS;
}

/** Порядок категорий: сначала самые используемые при готовке. */
const CATEGORY_ORDER = [
  'Овощи',
  'Фрукты',
  'Мясо',
  'Рыба и морепродукты',
  'Молочные продукты',
  'Яйца',
  'Крупы и мучное',
  'Бобовые',
  'Орехи и сухофрукты',
  'Соусы и масла',
  'Специи',
  'Напитки',
  'Прочее',
];

/** Сколько дней осталось до конца срока годности (null — срока нет). */
function daysLeft(iso?: string | null): number | null {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export function FridgePage() {
  const { user } = useAuth();

  const [items, setItems] = useState<FridgeItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Форма добавления
  const [draftName, setDraftName] = useState('');
  const [draftQty, setDraftQty] = useState('100');
  const [draftUnit, setDraftUnit] = useState<FridgeUnit>('г');
  /** Категория выбранного продукта — от неё зависят единицы. */
  const [draftCategory, setDraftCategory] = useState<string | null>(null);

  /** Единицы, допустимые для текущего продукта (масса или объём). */
  const effectiveUnits = unitsForFridge(draftName, draftCategory);

  /**
   * Держит единицу внутри допустимого списка.
   * Без этого после смены «молоко» → «гречка» в состоянии осталось бы
   * «мл», хотя такого варианта в списке уже нет.
   */
  useEffect(() => {
    if (!effectiveUnits.includes(draftUnit)) setDraftUnit(effectiveUnits[0]);
  }, [effectiveUnits, draftUnit]);

  const [draftExpiry, setDraftExpiry] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  // Подсказки из справочника
  const [suggestions, setSuggestions] = useState<Array<{ name: string; category?: string | null }>>([]);
  const [suggestOpen, setSuggestOpen] = useState(false);

  // Редактирование количества
  const [editingId, setEditingId] = useState<string | null>(null);
  /** Идентификатор продукта, для которого сейчас грузится фото. */
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editQty, setEditQty] = useState('');

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const rows = (await userApi.listUserProducts(user.id)) as FridgeItem[];
      setItems(Array.isArray(rows) ? rows : []);
      setError('');
    } catch (err) {
      setError(getApiErrorInfo(err, 'Не удалось загрузить холодильник.').message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  // Поиск по справочнику с задержкой
  useEffect(() => {
    const q = draftName.trim();
    if (q.length < 2) {
      setSuggestions([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const found = await mealPlanApi.catalogSearch(q, 8);
        setSuggestions(
          (Array.isArray(found) ? found : []).map((f) => ({
            name: String((f as { name: string }).name),
            category: (f as { category?: string | null }).category,
          })),
        );
      } catch {
        setSuggestions([]);
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [draftName]);

  /** Группировка по категориям с сохранением порядка. */
  const grouped = useMemo(() => {
    const map = new Map<string, FridgeItem[]>();
    for (const item of items) {
      const cat = item.category && item.category.trim() ? item.category : 'Прочее';
      const list = map.get(cat) ?? [];
      list.push(item);
      map.set(cat, list);
    }
    return [...map.entries()].sort((a, b) => {
      const ia = CATEGORY_ORDER.indexOf(a[0]);
      const ib = CATEGORY_ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a[0].localeCompare(b[0], 'ru');
    });
  }, [items]);

  /** Ближайший срок годности — для сводки. */
  const expiringSoon = useMemo(
    () => items.filter((i) => {
      const d = daysLeft(i.expiresAt);
      return d !== null && d <= 2;
    }).length,
    [items],
  );

  const addItem = async () => {
    if (!user) return;
    const name = draftName.trim();
    if (!name) {
      setFormError('Укажите название продукта.');
      return;
    }
    const qty = Number(draftQty.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      setFormError('Количество должно быть положительным числом.');
      return;
    }

    setSaving(true);
    setFormError('');
    try {
      await userApi.addUserProduct(user.id, {
        name,
        quantity: qty,
        unit: draftUnit,
        expiresAt: draftExpiry.trim() || null,
      });
      setDraftName('');
      setDraftQty('100');
      setDraftExpiry('');
      setSuggestions([]);
      setSuggestOpen(false);
      await load();
    } catch (err) {
      setFormError(getApiErrorInfo(err, 'Не удалось добавить продукт.').message);
    } finally {
      setSaving(false);
    }
  };

  const saveQuantity = async (item: FridgeItem) => {
    if (!user) return;
    const qty = Number(editQty.replace(',', '.'));
    if (!Number.isFinite(qty) || qty <= 0) {
      setError('Количество должно быть положительным числом.');
      return;
    }
    try {
      await userApi.updateUserProduct(user.id, item.id, { quantity: qty });
      setEditingId(null);
      await load();
    } catch (err) {
      setError(getApiErrorInfo(err, 'Не удалось изменить количество.').message);
    }
  };

  /**
   * Загружает фотографию продукта.
   *
   * Проверка размера и формата на клиенте — только для быстрой
   * обратной связи; сервер проверяет тип по содержимому файла.
   */
  const uploadPhoto = async (item: FridgeItem, file: File | undefined) => {
    if (!user || !file) return;

    if (!file.type.startsWith('image/')) {
      setError('Можно загрузить только изображение (JPEG, PNG или WebP).');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('Файл больше 5 МБ. Уменьшите фотографию и попробуйте снова.');
      return;
    }

    setError('');
    setUploadingId(item.id);
    try {
      const result = await userApi.uploadUserProductImage(user.id, item.id, file);
      // Обновляем только изменившийся продукт, чтобы не перезагружать
      // весь список и не терять позицию прокрутки.
      setItems((prev) =>
        prev.map((p) =>
          p.id === item.id
            ? { ...p, imageUrl: result.imageUrl, imageSource: result.imageSource }
            : p,
        ),
      );
    } catch (err) {
      setError(getApiErrorInfo(err, 'Не удалось загрузить фотографию.').message);
    } finally {
      setUploadingId(null);
    }
  };

  /** Удаляет фотографию — остаётся заглушка по категории. */
  const removePhoto = async (item: FridgeItem) => {
    if (!user) return;
    setError('');
    try {
      await userApi.deleteUserProductImage(user.id, item.id);
      setItems((prev) =>
        prev.map((p) =>
          p.id === item.id ? { ...p, imageUrl: null, imageSource: 'placeholder' } : p,
        ),
      );
    } catch (err) {
      setError(getApiErrorInfo(err, 'Не удалось удалить фотографию.').message);
    }
  };

  const removeItem = async (item: FridgeItem) => {
    if (!user) return;
    try {
      await userApi.deleteUserProduct(user.id, item.id);
      await load();
    } catch (err) {
      setError(getApiErrorInfo(err, 'Не удалось удалить продукт.').message);
    }
  };

  return (
    <div className="fridge-page">
      <header className="fridge-head">
        <div>
          <p className="eyebrow">Продукты</p>
          <h1>Мой холодильник</h1>
          <p className="muted">
            Продукты, которые уже есть дома. Планировщик отдаёт им приоритет, а на странице
            плана видно, чего не хватает для готовки.
          </p>
        </div>
        <Link to="/meal-plan" className="btn-secondary">
          К плану питания
        </Link>
      </header>

      {/* Сводка */}
      <section className="fridge-summary">
        <div className="fridge-stat">
          <span className="fridge-stat-value">{items.length}</span>
          <span className="fridge-stat-label">продуктов</span>
        </div>
        <div className="fridge-stat">
          <span className="fridge-stat-value">{grouped.length}</span>
          <span className="fridge-stat-label">категорий</span>
        </div>
        <div className={`fridge-stat ${expiringSoon > 0 ? 'is-warn' : ''}`}>
          <span className="fridge-stat-value">{expiringSoon}</span>
          <span className="fridge-stat-label">скоро истекает</span>
        </div>
      </section>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {/* Добавление */}
      <section className="card stack fridge-add">
        <div className="fridge-add-head">
          <Plus size={16} />
          <strong>Добавить продукт</strong>
        </div>

        <div className="fridge-add-grid">
          <div className="fridge-name-field">
            <input
              type="text"
              value={draftName}
              placeholder="Начните вводить: гречка, куриная грудка…"
              onChange={(e) => {
                const next = e.target.value;
                setDraftName(next);
                // Категория больше не соответствует новому названию:
                // единицы пересчитываются по тексту, а не по старой категории.
                setDraftCategory(null);
                setSuggestOpen(true);
              }}
              onFocus={() => setSuggestOpen(true)}
              onBlur={() => window.setTimeout(() => setSuggestOpen(false), 150)}
            />
            {suggestOpen && suggestions.length > 0 ? (
              <div className="pref-suggest">
                {suggestions.map((s) => (
                  <button
                    key={s.name}
                    type="button"
                    className="pref-suggest-item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setDraftName(s.name);
                      // Из справочника знаем категорию — подбираем единицы под неё.
                      setDraftCategory(s.category ?? null);
                      setDraftUnit(unitsForFridge(s.name, s.category)[0]);
                      setSuggestOpen(false);
                    }}
                  >
                    <span className="pref-suggest-name">{s.name}</span>
                    {s.category ? <span className="pref-suggest-meta">{s.category}</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <input
            type="text"
            inputMode="decimal"
            value={draftQty}
            onChange={(e) => setDraftQty(e.target.value)}
            aria-label="Количество"
          />

          <select
            value={draftUnit}
            onChange={(e) => setDraftUnit(e.target.value as FridgeUnit)}
            aria-label="Единица измерения"
          >
            {effectiveUnits.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>

          <input
            type="date"
            value={draftExpiry}
            onChange={(e) => setDraftExpiry(e.target.value)}
            aria-label="Срок годности"
            title="Срок годности (необязательно)"
          />

          <button
            type="button"
            className="btn-primary"
            disabled={saving}
            aria-busy={saving}
            onClick={() => void addItem()}
          >
            {saving ? <Loader2 size={16} className="btn-spinner" /> : <Plus size={16} />}
            Добавить
          </button>
        </div>

        {formError ? <p className="form-error">{formError}</p> : null}
      </section>

      {/* Список по категориям */}
      {loading ? (
        <p className="muted">
          <Loader2 size={15} className="pref-spinner" /> Загрузка…
        </p>
      ) : items.length === 0 ? (
        <div className="card fridge-empty">
          <Package size={28} strokeWidth={1.5} />
          <p>
            Холодильник пуст. Добавьте продукты — план питания начнёт учитывать то,
            что у вас уже есть.
          </p>
        </div>
      ) : (
        <div className="fridge-groups">
          {grouped.map(([category, list]) => (
            <section key={category} className="fridge-group">
              <h2 className="fridge-group-title">
                {category}
                <span className="fridge-group-count">{list.length}</span>
              </h2>
              <ul className="fridge-items">
                {list.map((item) => {
                  const left = daysLeft(item.expiresAt);
                  const state = left === null ? '' : left < 0 ? 'is-expired' : left <= 2 ? 'is-expiring' : '';
                  return (
                    <li key={item.id} className={`fridge-item ${state}`}>
                      <ProductImage
                        src={item.imageUrl}
                        category={item.category ?? category}
                        alt={item.name}
                        size="sm"
                      />
                      <div className="fridge-item-main">
                        <span className="fridge-item-name">{item.name}</span>
                        {item.matchedInCatalog === false ? (
                          <span
                            className="fridge-item-flag"
                            title="Продукт не найден в справочнике — планировщик может не учесть его"
                          >
                            нет в справочнике
                          </span>
                        ) : null}
                      </div>

                      {editingId === item.id ? (
                        <div className="fridge-item-edit">
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editQty}
                            autoFocus
                            onChange={(e) => setEditQty(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') void saveQuantity(item);
                              if (e.key === 'Escape') setEditingId(null);
                            }}
                          />
                          <span className="muted small">{item.unit}</span>
                          <button type="button" className="btn-secondary" onClick={() => void saveQuantity(item)}>
                            Ок
                          </button>
                          <button type="button" className="btn-secondary" onClick={() => setEditingId(null)}>
                            <X size={14} /> Отмена
                          </button>
                        </div>
                      ) : (
                        <div className="fridge-item-qty">
                          <span className="macro-value">{item.quantity}</span>
                          <span className="muted small">{item.unit}</span>
                          <button
                            type="button"
                            className="fridge-item-btn"
                            title="Изменить количество"
                            onClick={() => {
                              setEditingId(item.id);
                              setEditQty(String(item.quantity));
                            }}
                          >
                            <Pencil size={13} />
                            <span className="fridge-item-btn-text">Изменить</span>
                          </button>
                        </div>
                      )}

                      {left !== null ? (
                        <span className="fridge-item-expiry" title={String(item.expiresAt).slice(0, 10)}>
                          <CalendarClock size={13} />
                          {left < 0 ? 'просрочен' : left === 0 ? 'истекает сегодня' : `${left} дн.`}
                        </span>
                      ) : null}

                      {/* Фотография: загрузка и удаление. */}
                      <label
                        className="fridge-item-btn fridge-photo-btn"
                        title="Загрузить фотографию"
                      >
                        {uploadingId === item.id ? (
                          <Loader2 size={14} className="pref-spinner" />
                        ) : (
                          <ImagePlus size={14} />
                        )}
                        <span className="fridge-item-btn-text">Фото</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="visually-hidden"
                          disabled={uploadingId === item.id}
                          onChange={(e) => {
                            void uploadPhoto(item, e.target.files?.[0]);
                            // Сбрасываем значение, иначе повторный выбор
                            // того же файла не вызовет onChange.
                            e.target.value = '';
                          }}
                        />
                      </label>

                      {item.imageSource === 'user' ? (
                        <button
                          type="button"
                          className="fridge-item-btn"
                          title="Удалить фотографию"
                          onClick={() => void removePhoto(item)}
                        >
                          <ImageOff size={14} />
                          <span className="fridge-item-btn-text">Без фото</span>
                        </button>
                      ) : null}

                      {/* Подпись, а не только иконка: без неё кнопку
                          удаления было просто не найти в списке. */}
                      <button
                        type="button"
                        className="fridge-item-btn is-danger"
                        title="Удалить продукт"
                        aria-label={`Удалить «${item.name}»`}
                        onClick={() => void removeItem(item)}
                      >
                        <Trash2 size={14} />
                        <span className="fridge-item-btn-text">Удалить</span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}