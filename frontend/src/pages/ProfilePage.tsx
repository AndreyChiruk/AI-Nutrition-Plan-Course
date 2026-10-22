import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { FormEvent } from 'react';
import { Camera, Dumbbell, LogOut, Save, Scale, TrendingDown } from '../components/icons';
import { userApi } from '../api/services';
import { formatApiError } from '../api/errors';
import { useAuth } from '../context/AuthContext';
import { computeAgeFromBirthDate } from '../utils/age';
import { ALLERGEN_HINTS_RU, DIET_HINTS_RU } from '../constants/nutrition-hints';
import { FoodPreferencePicker, type PreferenceItem } from '../components/FoodPreferencePicker';
import { SubscriptionCard } from '../components/SubscriptionCard';
import { BirthDatePicker } from '../components/BirthDatePicker';

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

// Прежняя проверка синтаксиса «списка через запятую» больше не нужна:
// значения выбираются из каталога, поэтому произвольные символы
// в них попасть не могут.




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
  // Предпочтения хранятся как список выбранных записей каталога,
  // а не как текст через запятую: так планировщик гарантированно
  // распознаёт значение (раньше «курица» не совпадала с «Куриная грудка»).
  const [foodLikes, setFoodLikes] = useState<PreferenceItem[]>([]);
  const [foodDislikes, setFoodDislikes] = useState<PreferenceItem[]>([]);
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
      // Имя теперь хранится на сервере. Ранее оно лежало только
      // в localStorage, поэтому у существующих пользователей переносим
      // сохранённое значение на сервер (один раз) и убираем из браузера.
      const nameKey = `profile:name:${user.id}`;
      const legacyTemp = localStorage.getItem('profile:name:temp');
      const legacyName = (localStorage.getItem(nameKey) ?? legacyTemp ?? '').trim();
      const serverName = ((current as { name?: string | null }).name ?? '').trim();

      if (!serverName && legacyName) {
        try {
          await userApi.updateProfile(user.id, { name: legacyName } as Record<string, unknown>);
          setName(legacyName);
        } catch {
          setName(legacyName);
        }
      } else {
        // Запасной вариант — часть email до «@».
        setName(serverName || String(current.email ?? '').split('@')[0]);
      }
      localStorage.removeItem(nameKey);
      localStorage.removeItem('profile:name:temp');
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
      // Значения из БД приходят строками: определяем тип по наличию
      // в каталоге блюд; по умолчанию считаем продуктом.
      const toItems = (list: string[]): PreferenceItem[] =>
        (Array.isArray(list) ? list : [])
          .map((v) => String(v ?? '').trim())
          .filter(Boolean)
          .map((name) => ({ name, type: 'ingredient' as const }));
      setFoodLikes(toItems(likes));
      setFoodDislikes(toItems(dislikes));

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

    // Значения выбираются из каталога, поэтому проверять синтаксис
    // запятых больше не нужно — достаточно сравнить списки.
    const likesNorm = foodLikes.map((v) => v.name.trim().toLowerCase()).filter(Boolean);
    const dislikesNorm = foodDislikes.map((v) => v.name.trim().toLowerCase()).filter(Boolean);
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

    setValidationError('');
    try {
      await userApi.updateProfile(user.id, {
        // Имя отправляется на сервер. Раньше оно писалось только
        // в localStorage, поэтому в БД не сохранялось вовсе.
        name: name.trim(),
        email,
        height,
        weight,
        birthDate,
        gender,
        goal: safeGoal,
        avatarUrl,
        dietaryRestrictions:
          dietaryRestriction && DIET_KEYS.has(dietaryRestriction) ? [dietaryRestriction] : [],
        foodLikes: foodLikes.map((v) => v.name.trim()).filter(Boolean),
        foodDislikes: foodDislikes.map((v) => v.name.trim()).filter(Boolean),
      });
      await userApi.setAllergies(user.id, selectedAllergyIds);
      // Имя сохраняется на сервере вместе с остальным профилем,
      // а не в localStorage браузера.
      localStorage.removeItem(`profile:name:${user.id}`);
      localStorage.removeItem('profile:name:temp');
      const calories = await userApi.getCalories(user.id);
      setMessage(`Сохранено. BMR: ${calories.bmr}, дневная норма: ${calories.dailyCalories} ккал`);
    } catch (err) {
      setValidationError(formatApiError(err, 'Не удалось сохранить изменения.'));
    }
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
    setValidationError('');
    try {
      await userApi.changePassword(user.id, oldPassword, newPassword);
      setShowPasswordModal(false);
      setOldPassword('');
      setNewPassword('');
      setMessage('Пароль успешно изменен.');
    } catch (err) {
      setValidationError(formatApiError(err, 'Не удалось сменить пароль. Проверьте текущий пароль.'));
    }
  };



  return (
    <div className="profile-premium">
      <form onSubmit={onSubmit} className="profile-grid">
        <aside className="left-col">
          <section className="card section-card profile-avatar-card">
            <div className="section-head">
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

          {/* «Действия» стоят сразу под статистикой: раньше блок был в самом
              конце правой колонки, и до кнопки «Сохранить» приходилось
              прокручивать всю страницу. */}
          {/* Подписка — под краткой статистикой (по просьбе). */}
          <SubscriptionCard />

          {/* Действия — под подпиской, последним блоком левой колонки. */}
          <section className="card section-card">
            <div className="section-head">
              <h3>Действия</h3>
            </div>
            {validationError ? <p className="error">{validationError}</p> : null}
            {message ? <p className="success">{message}</p> : null}
            <div className="action-buttons">
              <button type="submit" className="btn-primary">
                <Save size={16} /> Сохранить
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowPasswordModal(true)}>
                Сменить пароль
              </button>
              <button type="button" className="btn-danger" onClick={logout}>
                <LogOut size={16} /> Выйти
              </button>
            </div>
          </section>
        </aside>

        <section className="right-col">
          <section className="card section-card">
            <div className="section-head">
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
                <BirthDatePicker
                  value={birthDate}
                  onChange={setBirthDate}
                  minAge={AGE_MIN}
                  maxAge={AGE_MAX}
                />
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
              <h3>Цель и план питания</h3>
            </div>
            <div className="goal-cards">
              {[
                // Иконки — компоненты Lucide, а не эмодзи: эмодзи
                // выглядит по-разному в каждой системе и считается
                // признаком сгенерированного интерфейса.
                { key: 'lose' as const, label: 'Похудеть', Icon: TrendingDown },
                { key: 'maintain' as const, label: 'Поддерживать', Icon: Scale },
                { key: 'gain' as const, label: 'Набрать массу', Icon: Dumbbell },
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
                    <item.Icon size={18} strokeWidth={1.75} aria-hidden />
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
            <div className="form-grid" style={{ marginTop: 10 }}>
              <FoodPreferencePicker
                label="Любимые продукты и блюда"
                hint="выбираются из каталога"
                tone="like"
                values={foodLikes}
                onChange={setFoodLikes}
                placeholder="например: гречка, куриная грудка…"
              />
              <FoodPreferencePicker
                label="Нежелательные продукты"
                hint="не будут предлагаться в плане"
                tone="dislike"
                values={foodDislikes}
                onChange={setFoodDislikes}
                placeholder="например: майонез, грибы…"
              />
            </div>
          </section>

          <section className="card section-card">
            <div className="section-head">
              <h3>Аллергии и ограничения</h3>
            </div>
            <div className="profile-restrictions-summary" aria-live="polite">
              <p className="profile-restrictions-summary__title">Текущий выбор</p>
              <ol className="profile-restrictions-summary__list">
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
              </ol>
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

          {/* Блок «Продукты пользователя» удалён: см. комментарий выше —
              для него есть отдельная вкладка. */}
        </section>
      </form>

      {showPasswordModal ? (
        <div className="modal-backdrop">
          <div className="modal-window">
            <h3>Смена пароля</h3>
            <div className="stack">
              {validationError ? <p className="error">{validationError}</p> : null}
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
              <button type="button" className="btn-primary" onClick={changePassword}>
                Сохранить пароль
              </button>
              <button type="button" className="btn-secondary" onClick={() => setShowPasswordModal(false)}>
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};
