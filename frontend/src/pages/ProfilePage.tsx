import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { FormEvent } from 'react';
import {
  Camera,
  CircleUserRound,
  Dumbbell,
  LogOut,
  Mail,
  Save,
  ShieldAlert,
  Target,
  UserPen,
} from 'lucide-react';
import { userApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import { computeAgeFromBirthDate } from '../utils/age';
import { ALLERGEN_HINTS_RU, DIET_HINTS_RU } from '../constants/nutrition-hints';

const PRESET_ALLERGENS = ['лактоза', 'глютен', 'арахис', 'орехи', 'морепродукты', 'яйца', 'соя', 'рыба'];

const DIETARY_OPTIONS: { value: string; label: string }[] = [
  { value: 'vegetarian', label: 'Вегетарианство' },
  { value: 'vegan', label: 'Веган' },
  { value: 'lactose-free', label: 'Безлактозная' },
  { value: 'gluten-free', label: 'Безглютеновая' },
];

const HEIGHT_MIN = 80;
const HEIGHT_MAX = 250;
const WEIGHT_MIN = 25;
const WEIGHT_MAX = 400;
const AGE_MIN = 10;
const AGE_MAX = 120;
const MASS_UNITS = ['г', 'кг'] as const;
const DIET_KEYS = new Set(DIETARY_OPTIONS.map((o) => o.value));

function ageWordRu(years: number): string {
  const abs100 = years % 100;
  if (abs100 >= 11 && abs100 <= 14) return 'лет';
  const d = years % 10;
  if (d === 1) return 'год';
  if (d >= 2 && d <= 4) return 'года';
  return 'лет';
}

function validateProfile(
  height: number,
  weight: number,
  birthDate: string,
): string | null {
  if (Number.isNaN(height) || height < HEIGHT_MIN || height > HEIGHT_MAX) {
    return `Рост: укажите значение от ${HEIGHT_MIN} до ${HEIGHT_MAX} см.`;
  }
  if (Number.isNaN(weight) || weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
    return `Вес: укажите значение от ${WEIGHT_MIN} до ${WEIGHT_MAX} кг.`;
  }
  const age = computeAgeFromBirthDate(birthDate);
  if (age === null) {
    return 'Укажите корректную дату рождения.';
  }
  if (age < AGE_MIN || age > AGE_MAX) {
    return `По дате рождения возраст получается ${age} ${
      age % 10 === 1 && age % 100 !== 11
        ? 'год'
        : age % 10 >= 2 && age % 10 <= 4 && (age % 100 < 10 || age % 100 >= 20)
          ? 'года'
          : 'лет'
    }. Допустимый диапазон: от ${AGE_MIN} до ${AGE_MAX} лет.`;
  }
  return null;
}

const FOOD_LIST_CHARS_RE = /^[\p{L}\s,]+$/u;

function validateFoodCommaList(raw: string, fieldLabel: string): string | null {
  if (!raw.trim()) return null;
  if (!FOOD_LIST_CHARS_RE.test(raw)) {
    return `${fieldLabel}: только буквы (в т.ч. кириллица), пробелы и запятые — без цифр, скобок, «/» и прочих символов.`;
  }
  return null;
}

function daysUntil(dateIso: string | null | undefined): number | null {
  if (!dateIso) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return Math.ceil((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function validateProductExpiryYmd(ymd: string): string | null {
  const t = ymd.trim();
  if (!t) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    return 'Срок годности: укажите дату в формате ГГГГ-ММ-ДД.';
  }
  const d = new Date(`${t}T12:00:00`);
  if (Number.isNaN(d.getTime())) {
    return 'Срок годности: некорректная дата.';
  }
  const min = new Date('2000-01-01T12:00:00');
  const max = new Date();
  max.setFullYear(max.getFullYear() + 20);
  if (d < min || d > max) {
    return 'Срок годности: укажите реалистичную дату (2000 год — не более чем через 20 лет).';
  }
  return null;
}

function parseMassQuantity(raw: string): number | null {
  const s = raw.trim().replace(',', '.');
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export const ProfilePage = () => {
  const { pathname } = useLocation();
  const { user, logout } = useAuth();
  const [height, setHeight] = useState(170);
  const [weight, setWeight] = useState(70);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [gender, setGender] = useState('male');
  const [birthDate, setBirthDate] = useState('1990-01-01');
  const [goal, setGoal] = useState('maintain');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [allergens, setAllergens] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedAllergyIds, setSelectedAllergyIds] = useState<string[]>([]);
  const [dietaryRestriction, setDietaryRestriction] = useState<string>('');
  const [foodLikesText, setFoodLikesText] = useState('');
  const [foodDislikesText, setFoodDislikesText] = useState('');
  const [fridgeItems, setFridgeItems] = useState<
    Array<{ id: string; name: string; quantity: number; unit: string; expiresAt?: string | null }>
  >([]);
  const [fridgeName, setFridgeName] = useState('');
  const [fridgeQtyInput, setFridgeQtyInput] = useState('100');
  const [fridgeUnit, setFridgeUnit] = useState<(typeof MASS_UNITS)[number]>('г');
  const [fridgeExpire, setFridgeExpire] = useState('');
  const [fridgeFormError, setFridgeFormError] = useState('');
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const [validationError, setValidationError] = useState('');

  const displayAge = useMemo(() => computeAgeFromBirthDate(birthDate), [birthDate]);

  const selectedAllergenNames = useMemo(
    () =>
      allergens
        .filter((a) => selectedAllergyIds.includes(a.id))
        .map((a) => a.name)
        .sort((a, b) => a.localeCompare(b, 'ru')),
    [allergens, selectedAllergyIds],
  );

  const selectedDietLabel = useMemo(() => {
    if (!dietaryRestriction || !DIET_KEYS.has(dietaryRestriction)) return '';
    return DIETARY_OPTIONS.find((o) => o.value === dietaryRestriction)?.label ?? dietaryRestriction;
  }, [dietaryRestriction]);

  const bmi = Number((weight / ((height / 100) * (height / 100))).toFixed(1));
  const idealWeightRange = useMemo(() => {
    const h = Math.max(0.5, height / 100);
    return {
      min: Number((18.5 * h * h).toFixed(1)),
      max: Number((24.9 * h * h).toFixed(1)),
    };
  }, [height]);
  const weightBand = useMemo<'under' | 'normal' | 'over'>(() => {
    if (weight < idealWeightRange.min) return 'under';
    if (weight > idealWeightRange.max) return 'over';
    return 'normal';
  }, [weight, idealWeightRange.min, idealWeightRange.max]);
  const safeGoal = useMemo<'lose' | 'maintain' | 'gain'>(() => {
    if (weightBand === 'under' && goal === 'lose') return 'gain';
    if (weightBand === 'over' && goal === 'gain') return 'lose';
    return goal as 'lose' | 'maintain' | 'gain';
  }, [goal, weightBand]);
  const goalHint = useMemo(() => {
    if (weightBand === 'under') {
      return `Вес ниже нижней границы нормы (${idealWeightRange.min} кг), поэтому снижение веса не рекомендуется.`;
    }
    if (weightBand === 'over') {
      return `Вес выше верхней границы нормы (${idealWeightRange.max} кг), поэтому набор веса не рекомендуется.`;
    }
    return `Вес в пределах нормы (${idealWeightRange.min}–${idealWeightRange.max} кг).`;
  }, [weightBand, idealWeightRange.min, idealWeightRange.max]);
  const targetWeight =
    safeGoal === 'lose' ? Math.max(weight - 8, 45) : safeGoal === 'gain' ? weight + 6 : weight;
  const progress = Math.min(
    100,
    Math.max(0, Math.round((1 - Math.abs(targetWeight - weight) / Math.max(targetWeight, 1)) * 100)),
  );

  useEffect(() => {
    const load = async () => {
      if (!user) return;
      const [current, allergenList] = await Promise.all([userApi.getById(user.id), userApi.getAllergens()]);
      setAllergens(allergenList);
      setEmail(current.email ?? '');
      const nameKey = `profile:name:${user.id}`;
      const legacyTemp = localStorage.getItem('profile:name:temp');
      let storedName = localStorage.getItem(nameKey) ?? '';
      if (!storedName && legacyTemp?.trim()) {
        storedName = legacyTemp.trim();
        localStorage.setItem(nameKey, storedName);
        localStorage.removeItem('profile:name:temp');
      }
      setName(storedName);
      if (current.height) setHeight(current.height);
      if (current.weight) setWeight(current.weight);
      if (current.birthDate) setBirthDate(String(current.birthDate).slice(0, 10));
      if (current.gender) setGender(current.gender);
      if (current.goal) setGoal(current.goal);
      if (current.avatarUrl) setAvatarUrl(current.avatarUrl);
      const selectedIds = (current.allergens ?? []).map((item: { id: string }) => item.id);
      setSelectedAllergyIds(selectedIds);

      const dr = (current as { dietaryRestrictions?: string[] }).dietaryRestrictions;
      if (Array.isArray(dr)) {
        const first = dr.map((v) => String(v).trim()).find((v) => DIET_KEYS.has(v));
        setDietaryRestriction(first ?? '');
      } else {
        setDietaryRestriction('');
      }
      const likes = (current as { foodLikes?: string[] }).foodLikes ?? [];
      const dislikes = (current as { foodDislikes?: string[] }).foodDislikes ?? [];
      setFoodLikesText(Array.isArray(likes) ? likes.join(', ') : '');
      setFoodDislikesText(Array.isArray(dislikes) ? dislikes.join(', ') : '');
      const fridge = await userApi.listUserProducts(user.id);
      setFridgeItems(fridge);

    };
    void load();
  }, [user, pathname]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    const err = validateProfile(height, weight, birthDate);
    if (err) {
      setValidationError(err);
      return;
    }
    setValidationError('');

    const likesSyntaxErr = validateFoodCommaList(foodLikesText, 'Любимые продукты/блюда');
    if (likesSyntaxErr) {
      setValidationError(likesSyntaxErr);
      return;
    }
    const dislikesSyntaxErr = validateFoodCommaList(foodDislikesText, 'Нежелательные продукты');
    if (dislikesSyntaxErr) {
      setValidationError(dislikesSyntaxErr);
      return;
    }

    const likesNorm = foodLikesText
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => v.toLowerCase());
    const dislikesNorm = foodDislikesText
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean)
      .map((v) => v.toLowerCase());
    for (const l of likesNorm) {
      for (const d of dislikesNorm) {
        if (!l || !d) continue;
        if (l === d || l.includes(d) || d.includes(l)) {
          setValidationError(
            `Нельзя указывать одно и то же в любимых и нелюбимых (пересечение: «${l}» и «${d}»). Уберите дубликат.`,
          );
          return;
        }
      }
    }

    await userApi.updateProfile(user.id, {
      email,
      height,
      weight,
      birthDate,
      gender,
      goal: safeGoal,
      avatarUrl,
      dietaryRestrictions:
        dietaryRestriction && DIET_KEYS.has(dietaryRestriction) ? [dietaryRestriction] : [],
      foodLikes: foodLikesText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      foodDislikes: foodDislikesText
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean),
    });
    await userApi.setAllergies(user.id, selectedAllergyIds);
    localStorage.setItem(`profile:name:${user.id}`, name);
    const calories = await userApi.getCalories(user.id);
    setMessage(`Сохранено. BMR: ${calories.bmr}, дневная норма: ${calories.dailyCalories} ккал`);
  };

  const toggleAllergy = (id: string) => {
    setSelectedAllergyIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const toggleDiet = (value: string) => {
    setDietaryRestriction((prev) => (prev === value ? '' : value));
  };

  const changePassword = async () => {
    if (!user) return;
    await userApi.changePassword(user.id, oldPassword, newPassword);
    setShowPasswordModal(false);
    setOldPassword('');
    setNewPassword('');
    setMessage('Пароль успешно изменен.');
  };

  const addFridgeItem = async () => {
    if (!user || !fridgeName.trim()) return;
    setFridgeFormError('');
    const qty = parseMassQuantity(fridgeQtyInput);
    if (qty === null) {
      setFridgeFormError('Укажите положительное количество (число, можно с десятичной запятой или точкой).');
      return;
    }
    const expErr = validateProductExpiryYmd(fridgeExpire);
    if (expErr) {
      setFridgeFormError(expErr);
      return;
    }
    await userApi.addUserProduct(user.id, {
      name: fridgeName.trim(),
      quantity: qty,
      unit: fridgeUnit,
      expiresAt: fridgeExpire.trim() || null,
    });
    const fridge = await userApi.listUserProducts(user.id);
    setFridgeItems(fridge);
    setFridgeName('');
    setFridgeQtyInput('100');
    setFridgeUnit('г');
    setFridgeExpire('');
  };

  const removeFridgeItem = async (itemId: string) => {
    if (!user) return;
    await userApi.deleteUserProduct(user.id, itemId);
    const fridge = await userApi.listUserProducts(user.id);
    setFridgeItems(fridge);
  };

  return (
    <div className="profile-premium">
      <form onSubmit={onSubmit} className="profile-grid">
        <aside className="left-col">
          <section className="card section-card profile-avatar-card">
            <div className="section-head">
              <CircleUserRound size={18} />
              <h3>Профиль</h3>
            </div>
            <div className="avatar-wrap">
              {avatarUrl ? (
                <img src={avatarUrl} alt="Аватар" className="avatar-image" />
              ) : (
                <div className="avatar-fallback">{(name || email || 'U').slice(0, 1).toUpperCase()}</div>
              )}
              <label className="avatar-overlay">
                <Camera size={16} />
                <span>Сменить фото</span>
              </label>
            </div>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="Ссылка на аватар"
            />
          </section>

          <section className="card section-card">
            <div className="section-head">
              <Dumbbell size={18} />
              <h3>Краткая статистика</h3>
            </div>
            <div className="stats-grid">
              <div>
                <span>Текущий вес</span>
                <strong>{weight} кг</strong>
              </div>
              <div>
                <span>Целевой вес</span>
                <strong>{targetWeight} кг</strong>
              </div>
              <div>
                <span>ИМТ</span>
                <strong>{bmi}</strong>
              </div>
            </div>
            <div className="progress-row">
              <div className="progress-label">Прогресс к цели</div>
              <div className="progress-track">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>
          </section>
        </aside>

        <section className="right-col">
          <section className="card section-card">
            <div className="section-head">
              <UserPen size={18} />
              <h3>Личная информация</h3>
            </div>
            <div className="form-grid">
              <label>
                Имя
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Введите имя" />
              </label>
              <label>
                Почта
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="email@example.com" />
              </label>
              <label>
                Рост (см)
                <input
                  value={height}
                  type="text"
                  inputMode="numeric"
                  onChange={(e) => {
                    const parsed = Number(e.target.value.replace(',', '.'));
                    if (Number.isFinite(parsed)) setHeight(parsed);
                  }}
                />
                <span className="muted small"> {HEIGHT_MIN}–{HEIGHT_MAX} см</span>
              </label>
              <label>
                Вес (кг)
                <input
                  value={weight}
                  type="text"
                  inputMode="decimal"
                  onChange={(e) => {
                    const parsed = Number(e.target.value.replace(',', '.'));
                    if (Number.isFinite(parsed)) setWeight(parsed);
                  }}
                />
                <span className="muted small"> {WEIGHT_MIN}–{WEIGHT_MAX} кг</span>
              </label>
              <label>
                Пол
                <select value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="male">Мужской</option>
                  <option value="female">Женский</option>
                </select>
              </label>
              <label>
                Дата рождения
                <input value={birthDate} type="date" onChange={(e) => setBirthDate(e.target.value)} required />
              </label>
              <p className="muted small" style={{ gridColumn: '1 / -1' }}>
                {displayAge !== null && displayAge >= 0 ? (
                  <>
                    Возраст: <strong>{displayAge}</strong> {ageWordRu(displayAge)}
                  </>
                ) : (
                  <>Возраст: —</>
                )}
              </p>
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <Target size={18} />
              <h3>Цель и план питания</h3>
            </div>
            <div className="goal-cards">
              {[
                { key: 'lose', label: 'Похудеть', icon: '🧘' },
                { key: 'maintain', label: 'Поддерживать', icon: '⚖️' },
                { key: 'gain', label: 'Набрать массу', icon: '💪' },
              ].map((item) => {
                const blocked =
                  (weightBand === 'under' && item.key === 'lose') ||
                  (weightBand === 'over' && item.key === 'gain');
                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`goal-card ${goal === item.key ? 'active' : ''}`}
                    disabled={blocked}
                    title={blocked ? 'Недоступно при текущей зоне веса' : undefined}
                    onClick={() => setGoal(item.key)}
                  >
                    <span>{item.icon}</span>
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              {goalHint}
              {safeGoal !== goal
                ? ` При сохранении цель будет скорректирована на «${safeGoal === 'lose' ? 'похудеть' : safeGoal === 'gain' ? 'набрать массу' : 'поддерживать'}».`
                : ''}
            </p>
            <p className="muted small" style={{ marginTop: 10 }}>
              Длительность и калорийность планов настраиваются в разделе «План питания».
            </p>
            <div className="form-grid" style={{ marginTop: 10 }}>
              <label>
                Любимые продукты/блюда (через запятую)
                <input
                  value={foodLikesText}
                  onChange={(e) => setFoodLikesText(e.target.value)}
                  placeholder="сыр, чай, краб"
                />
              </label>
              <label>
                Нежелательные продукты (через запятую)
                <input
                  value={foodDislikesText}
                  onChange={(e) => setFoodDislikesText(e.target.value)}
                  placeholder="майонез, сахар"
                />
              </label>
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <ShieldAlert size={18} />
              <h3>Аллергии и ограничения</h3>
            </div>
            <div className="profile-restrictions-summary" aria-live="polite">
              <p className="profile-restrictions-summary__title">Текущий выбор</p>
              <ul className="profile-restrictions-summary__list">
                <li>
                  <span className="profile-restrictions-summary__key">Аллергены:</span>{' '}
                  {selectedAllergenNames.length > 0 ? (
                    selectedAllergenNames.map((name, i) => (
                      <span
                        key={`${name}-${i}`}
                        className="meal-plan-hint-term"
                        title={
                          ALLERGEN_HINTS_RU[name.toLowerCase()] ??
                          `«${name}»: исключаются блюда, где этот аллерген указан в каталоге.`
                        }
                      >
                        {name}
                        {i < selectedAllergenNames.length - 1 ? ', ' : ''}
                      </span>
                    ))
                  ) : (
                    <span className="muted">не выбраны — нажмите чип ниже</span>
                  )}
                </li>
                <li>
                  <span className="profile-restrictions-summary__key">Диета:</span>{' '}
                  {selectedDietLabel ? (
                    <span
                      className="meal-plan-hint-term"
                      title={DIET_HINTS_RU[dietaryRestriction] ?? ''}
                    >
                      {selectedDietLabel}
                    </span>
                  ) : (
                    <span className="muted">не выбрана — нажмите чип ниже</span>
                  )}
                </li>
              </ul>
            </div>
            <div className="chip-grid">
              {allergens
                .filter((item) => PRESET_ALLERGENS.includes(item.name.toLowerCase()))
                .map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`allergy-chip ${selectedAllergyIds.includes(item.id) ? 'selected' : ''}`}
                    title={
                      ALLERGEN_HINTS_RU[item.name.toLowerCase()] ??
                      `Аллерген «${item.name}»: такие блюда помечаются и скрываются в каталоге плана.`
                    }
                    onClick={() => toggleAllergy(item.id)}
                  >
                    {item.name}
                  </button>
                ))}
            </div>
            <p className="muted small" style={{ marginTop: 12 }}>
              Диета для автоплана и каталога (можно выбрать только одну; нажмите снова на выбранную, чтобы снять):
            </p>
            <div className="chip-grid">
              {DIETARY_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`allergy-chip ${dietaryRestriction === opt.value ? 'selected' : ''}`}
                  title={DIET_HINTS_RU[opt.value] ?? opt.label}
                  onClick={() => toggleDiet(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <Target size={18} />
              <h3>Продукты пользователя</h3>
            </div>
            <p className="muted small">
              Эти продукты учитываются при автогенерации плана питания и подборе альтернатив, даже если не хранятся в холодильнике.
            </p>
            <p className="muted small">
              Для корректного анализа в конструкторе указывайте только массу: <strong>г</strong> или <strong>кг</strong>.
            </p>
            <div className="stack-row wrap-actions" style={{ marginTop: 8 }}>
              <input
                value={fridgeName}
                onChange={(e) => setFridgeName(e.target.value)}
                placeholder="Продукт (например, сыр)"
              />
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={fridgeQtyInput}
                onChange={(e) => setFridgeQtyInput(e.target.value)}
                placeholder="Масса (например 250 или 1.5)"
              />
              <select
                value={fridgeUnit}
                onChange={(e) => setFridgeUnit(e.target.value as (typeof MASS_UNITS)[number])}
                aria-label="Единица измерения продукта"
                title="Единица измерения"
              >
                {MASS_UNITS.map((u) => (
                  <option key={u} value={u}>
                    {u}
                  </option>
                ))}
              </select>
              <input
                type="date"
                title="Срок годности"
                value={fridgeExpire}
                onChange={(e) => setFridgeExpire(e.target.value)}
              />
              <button type="button" onClick={() => void addFridgeItem()}>
                Добавить
              </button>
            </div>
            {fridgeFormError ? <p className="error small" style={{ marginTop: 8 }}>{fridgeFormError}</p> : null}
            <div className="chip-grid" style={{ marginTop: 10 }}>
              {fridgeItems.map((item) => {
                const leftDays = daysUntil(item.expiresAt ?? null);
                const expiryClass =
                  leftDays === null
                    ? ''
                    : leftDays < 0
                      ? 'user-product-expired'
                      : leftDays <= 2
                        ? 'user-product-expiring'
                        : '';
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`allergy-chip selected ${expiryClass}`}
                    onClick={() => void removeFridgeItem(item.id)}
                    title={
                      leftDays === null
                        ? 'Без срока годности'
                        : leftDays < 0
                          ? 'Срок годности истёк'
                          : `Срок годности: ${leftDays} дн.`
                    }
                  >
                    {item.name} ({item.quantity} {item.unit})
                  </button>
                );
              })}
              {fridgeItems.length === 0 ? <span className="muted small">Пока пусто</span> : null}
            </div>
            <p className="muted small" style={{ marginTop: 8 }}>
              Оранжевый: до конца срока годности осталось 2 дня. Красный: срок годности истёк.
            </p>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <Mail size={18} />
              <h3>Действия</h3>
            </div>
            {validationError ? <p className="error">{validationError}</p> : null}
            {message ? <p className="success">{message}</p> : null}
            <div className="action-buttons">
              <button type="submit" className="btn-primary">
                <Save size={16} /> Сохранить все изменения
              </button>
              <button type="button" onClick={() => setShowPasswordModal(true)}>
                Сменить пароль
              </button>
              <button type="button" className="btn-danger" onClick={logout}>
                <LogOut size={16} /> Выйти
              </button>
            </div>
          </section>
        </section>
      </form>

      {showPasswordModal ? (
        <div className="modal-backdrop">
          <div className="modal-window">
            <h3>Смена пароля</h3>
            <div className="stack">
              <input
                type="password"
                placeholder="Текущий пароль"
                value={oldPassword}
                onChange={(e) => setOldPassword(e.target.value)}
              />
              <input
                type="password"
                placeholder="Новый пароль"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button type="button" onClick={changePassword}>
                Сохранить пароль
              </button>
              <button type="button" onClick={() => setShowPasswordModal(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
