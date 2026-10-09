import axios from 'axios';
import { useRef, useState } from 'react';
import { AlertTriangle, Camera, Save, UtensilsCrossed } from '../components/icons';
import { foodRecognitionApi } from '../api/services';
import { useAuth } from '../context/AuthContext';
import type { FoodPreviewResponse } from '../types';
import { CalorieValue, MacroRow } from '../components/MacroRow';
import { SubscriptionGate } from '../components/SubscriptionGate';

export const FoodRecognitionPage = () => {
  const { user } = useAuth();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [photoUrl, setPhotoUrl] = useState('');
  const [result, setResult] = useState<FoodPreviewResponse | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedInfo, setSavedInfo] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') setPhotoUrl(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const analyze = async () => {
    if (!user) return;
    if (!photoUrl) {
      setError('Загрузите фото блюда.');
      return;
    }
    setLoading(true);
    setError('');
    setResult(null);
    setSavedInfo('');
    setSubmitted(false);
    try {
      const data = await foodRecognitionApi.analyze(user.id, photoUrl);
      setResult(data);
      let toastMsg = 'Распознавание выполнено. При необходимости сохраните запись для модерации.';
      if (data.allergenWarnings.length > 0) {
        toastMsg = data.allergenWarnings[0] ?? 'Обратите внимание на аллергены в блюде.';
      } else if (data.hasDetectedAllergensInDish) {
        toastMsg = 'В блюде отмечены потенциальные аллергены (сверьтесь с профилем).';
      }
      setToast(toastMsg);
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string } | undefined)?.message
        : undefined;
      setError(msg ?? 'Не удалось распознать блюдо.');
    } finally {
      setLoading(false);
    }
  };

  const saveForModeration = async () => {
    if (!user || !result || !photoUrl) return;
    setSaving(true);
    setError('');
    setSavedInfo('');
    try {
      const res = await foodRecognitionApi.submitMeal(user.id, {
        photoUrl,
        confidence: result.confidence,
        items: result.items,
      });
      setSavedInfo(res.message);
      setToast('Отправлено администратору.');
      setSubmitted(true);
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string } | undefined)?.message
        : undefined;
      setError(msg ?? 'Не удалось сохранить запись.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="profile-premium">
      <section className="card section-card">
        <div className="section-head">
          <UtensilsCrossed size={18} />
          <h2>Распознавание еды по фото</h2>
        </div>
        <p className="muted small">
          Сначала получите КБЖУ и подсказки по аллергенам — в базу ничего не пишется. Чтобы зафиксировать блюдо у себя в
          истории и в общем каталоге после проверки, нажмите «Сохранить» — администратор подтвердит или отклонит запись в
          админке.
        </p>

        <div
          className="dropzone"
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          Перетащите фото или нажмите для выбора
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden-file-input"
          aria-label="Фото блюда"
          onChange={(e) => onFile(e.target.files?.[0])}
        />
        <div className="food-recognition-preview-col">
          {photoUrl ? <img src={photoUrl} alt="Блюдо" className="food-recognition-preview" /> : null}
          <SubscriptionGate description="Распознавание блюд по фотографии использует модель зрения и доступно по подписке.">
            <button type="button" className="btn-primary ripple" disabled={loading} onClick={analyze}>
              <Camera size={16} /> {loading ? 'Анализ…' : 'Распознать блюдо'}
            </button>
          </SubscriptionGate>
        </div>

        {error ? <p className="error">{error}</p> : null}
        {toast ? <p className="success">{toast}</p> : null}
        {savedInfo ? <p className="muted small" style={{ marginTop: 8 }}>{savedInfo}</p> : null}

        {result && (result.allergenWarnings.length > 0 || result.hasAllergenMatchInProfile) ? (
          <div className="alert allergen-banner allergen-banner--strong" role="alert">
            <AlertTriangle size={22} />
            <div>
              <strong>
                {result.hasAllergenMatchInProfile
                  ? 'Внимание: пересечение с аллергиями в профиле'
                  : 'Возможный аллерген в блюде'}
              </strong>
              {result.allergenWarnings.length > 0 ? (
                <ul className="recommend-list">
                  {result.allergenWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : (
                <p className="small" style={{ margin: '0.5rem 0 0' }}>
                  В распознанных продуктах отмечены ингредиенты, совпадающие с каталогом; проверьте состав и профиль
                  аллергий.
                </p>
              )}
            </div>
          </div>
        ) : null}

        {result ? (
          <div className="card inner-result">
            <h4>Результат</h4>
            <p className="muted small">Уверенность модели: {(result.confidence * 100).toFixed(0)}%</p>
            <p className="muted small">
              Распознавание только для просмотра. {result.provider}
            </p>
            <div className="food-save-actions">
              <button
                type="button"
                className="btn-secondary ripple"
                disabled={saving || !photoUrl || submitted}
                onClick={() => void saveForModeration()}
              >
                <Save size={16} />{' '}
                {submitted ? 'Уже отправлено' : saving ? 'Отправка…' : 'Сохранить (на модерацию)'}
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Блюдо</th>
                  <th>ккал</th>
                  <th>Б/Ж/У</th>
                  <th>Аллергены</th>
                  <th>Диета</th>
                  <th>Состав (оценка)</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((row, idx) => (
                  <tr key={`${row.foodName}-${idx}`}>
                    <td>{row.foodName}</td>
                    <td>
                      <CalorieValue calories={row.calories} />
                    </td>
                    <td>
                      <MacroRow protein={row.protein} fat={row.fat} carbs={row.carbs} />
                    </td>
                    <td>{row.allergensFound.join(', ') || '—'}</td>
                    <td className="small muted">
                      {row.dietaryTags?.length ? row.dietaryTags.join(', ') : '—'}
                    </td>
                    <td className="small muted">
                      {row.ingredients?.length
                        ? row.ingredients.map((i) => `${i.name} ~${i.grams} г`).join('; ')
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
};
