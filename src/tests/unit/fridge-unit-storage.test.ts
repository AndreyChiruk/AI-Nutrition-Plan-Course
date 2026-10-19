import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Нормализация единиц измерения в холодильнике.
 *
 * Регрессия: `normalizeMassUnit` знал только «г» и «кг», а всё
 * остальное молча превращал в «г». Пользователь выбирал «мл» для
 * молока или «шт» для яиц, но в базе и в списке оказывались граммы —
 * именно поэтому в холодильнике молоко было в граммах, а яйца в
 * граммах вместо штук. Миграция 013 дополнительно переписала все
 * существующие единицы в «г».
 *
 * Логика повторяет MASS_UNIT_MAP в users.service.ts.
 */
type FridgeUnit = 'г' | 'кг' | 'мл' | 'л' | 'шт';

const MASS_UNIT_MAP: Record<string, FridgeUnit> = {
  г: 'г', gram: 'г', grams: 'г', g: 'г', гр: 'г', грамм: 'г', грамма: 'г', граммов: 'г',
  кг: 'кг', kg: 'кг', kilo: 'кг', kilos: 'кг', килограмм: 'кг', килограмма: 'кг', килограммов: 'кг',
  мл: 'мл', ml: 'мл', millilitre: 'мл', millilitres: 'мл', milliliter: 'мл', миллилитр: 'мл', миллилитров: 'мл',
  л: 'л', l: 'л', litre: 'л', litres: 'л', liter: 'л', liters: 'л', литр: 'л', литра: 'л', литров: 'л',
  шт: 'шт', штука: 'шт', штуки: 'шт', штук: 'шт', pcs: 'шт', pc: 'шт', piece: 'шт', pieces: 'шт',
};

function normalizeMassUnit(raw?: string): FridgeUnit {
  const key = String(raw ?? '').trim().toLowerCase();
  return MASS_UNIT_MAP[key] ?? 'г';
}

describe('холодильник: сохранение выбранной единицы', () => {
  it('сохраняет миллилитры и литры — раньше превращались в граммы', () => {
    assert.strictEqual(normalizeMassUnit('мл'), 'мл');
    assert.strictEqual(normalizeMassUnit('л'), 'л');
    assert.strictEqual(normalizeMassUnit('ml'), 'мл');
    assert.strictEqual(normalizeMassUnit('литров'), 'л');
  });

  it('сохраняет штуки — раньше яйца становились граммами', () => {
    assert.strictEqual(normalizeMassUnit('шт'), 'шт');
    assert.strictEqual(normalizeMassUnit('штук'), 'шт');
    assert.strictEqual(normalizeMassUnit('pcs'), 'шт');
  });

  it('по-прежнему понимает массу', () => {
    for (const [input, expected] of [
      ['г', 'г'], ['g', 'г'], ['грамм', 'г'], ['гр', 'г'],
      ['кг', 'кг'], ['kg', 'кг'], ['килограмм', 'кг'],
    ] as const) {
      assert.strictEqual(normalizeMassUnit(input), expected, `${input} → ${expected}`);
    }
  });

  it('не путает регистр и пробелы', () => {
    assert.strictEqual(normalizeMassUnit(' МЛ '), 'мл');
    assert.strictEqual(normalizeMassUnit('ШТ'), 'шт');
    assert.strictEqual(normalizeMassUnit('Кг'), 'кг');
  });

  it('неизвестное значение даёт граммы как безопасный запасной вариант', () => {
    assert.strictEqual(normalizeMassUnit('barrel'), 'г');
    assert.strictEqual(normalizeMassUnit(''), 'г');
    assert.strictEqual(normalizeMassUnit(undefined), 'г');
  });

  it('все пять единиц интерфейса поддерживаются', () => {
    for (const unit of ['г', 'кг', 'мл', 'л', 'шт'] as const) {
      assert.strictEqual(normalizeMassUnit(unit), unit, `${unit} должна сохраняться как есть`);
    }
  });
});
