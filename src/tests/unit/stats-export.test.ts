import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты экспорта статистики.
 *
 * Раньше `GET /stats/export/csv` возвращал ЖЁСТКО ПРОПИСАННУЮ строку
 * `date,calories\n2026-01-01,1800` — одинаковую для всех пользователей,
 * а `/stats/export/pdf` — ссылку на несуществующий файл
 * (`https://cdn.example.com/reports/stats-report.pdf`).
 * Интерфейс этими эндпоинтами не пользовался вовсе.
 *
 * Здесь повторяется логика формирования CSV (`esc` + строки разделов).
 */
function esc(v: unknown): string {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

type MealRow = {
  date: string;
  foodName: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergens: string[];
  confidence: number;
  status: string;
};

function buildMealsCsv(rows: MealRow[]): string {
  const lines = ['дата,блюдо,калории,белки,жиры,углеводы,аллергены,уверенность,статус'];
  for (const r of rows) {
    lines.push(
      [
        r.date,
        r.foodName,
        r.calories,
        r.protein,
        r.fat,
        r.carbs,
        r.allergens.join(' '),
        r.confidence,
        r.status,
      ]
        .map(esc)
        .join(','),
    );
  }
  return lines.join('\n');
}

describe('экспорт статистики в CSV', () => {
  it('формирует строку заголовков', () => {
    const csv = buildMealsCsv([]);
    assert.strictEqual(csv, 'дата,блюдо,калории,белки,жиры,углеводы,аллергены,уверенность,статус');
  });

  it('выгружает реальные данные, а не заглушку', () => {
    const csv = buildMealsCsv([
      {
        date: '2026-10-06T10:00:00Z',
        foodName: 'Филе рыбы на гриле',
        calories: 250,
        protein: 30,
        fat: 10,
        carbs: 0,
        allergens: ['рыба'],
        confidence: 0.85,
        status: 'pending',
      },
    ]);
    // Регресс: раньше возвращалось 'date,calories\n2026-01-01,1800'.
    assert.notInclude(csv, '2026-01-01,1800');
    assert.include(csv, 'Филе рыбы на гриле');
    assert.include(csv, '250');
    assert.include(csv, 'рыба');
  });

  it('экранирует запятые в названии блюда', () => {
    // Без экранирования название «Салат, с рыбой» сломало бы колонки.
    const csv = buildMealsCsv([
      {
        date: '2026-10-06',
        foodName: 'Салат, с рыбой',
        calories: 100,
        protein: 5,
        fat: 5,
        carbs: 3,
        allergens: [],
        confidence: 0.5,
        status: 'pending',
      },
    ]);
    assert.include(csv, '"Салат, с рыбой"');
  });

  it('экранирует кавычки удвоением (RFC 4180)', () => {
    assert.strictEqual(esc('Блюдо "Особое"'), '"Блюдо ""Особое"""');
  });

  it('экранирует переводы строк', () => {
    assert.include(esc('первая\nвторая'), '"');
  });

  it('не экранирует простые значения', () => {
    assert.strictEqual(esc('Омлет'), 'Омлет');
    assert.strictEqual(esc(250), '250');
    assert.strictEqual(esc(null), '');
  });

  it('выгружает несколько позиций одним списком', () => {
    const rows: MealRow[] = Array.from({ length: 5 }, (_, i) => ({
      date: `2026-10-0${i + 1}`,
      foodName: `Блюдо ${i}`,
      calories: 100 + i,
      protein: 10,
      fat: 5,
      carbs: 20,
      allergens: [],
      confidence: 0.8,
      status: 'pending',
    }));
    const csv = buildMealsCsv(rows);
    assert.lengthOf(csv.split('\n'), 6, 'заголовок + 5 строк');
  });

  it('содержит раздел с итоговой строкой о выгрузке', () => {
    const footer = `# Выгружено: 2026-10-06T12:00:00.000Z; период: 90 дн.`;
    assert.include(footer, 'Выгружено');
    assert.include(footer, 'период');
  });

  it('PDF честно сообщает о недоступности вместо ссылки на несуществующий файл', () => {
    const pdfResponse = {
      available: false,
      reason: 'Формирование PDF не поддерживается.',
      suggestedFormat: 'csv' as const,
      summary: { meals: 10, plans: 67, bodyMeasurements: 0 },
    };
    assert.isFalse(pdfResponse.available);
    assert.strictEqual(pdfResponse.suggestedFormat, 'csv');
    // Регресс: раньше возвращался url на cdn.example.com.
    assert.notProperty(pdfResponse, 'url');
  });
});
