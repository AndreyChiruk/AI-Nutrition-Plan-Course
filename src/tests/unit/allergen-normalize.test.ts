import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  normalizeAllergensExpanding,
  normalizeCatalogAllergenList,
} from '../../meal-plan/catalog-ai-normalize';

/**
 * Тесты «расширяющей» нормализации аллергенов.
 *
 * Проблема: `normalizeCatalogAllergenList` пропускает только значения из
 * справочника, остальные МОЛЧА отбрасывает. Для ответа модели распознавания
 * это опасная ложная безопасность: если модель вернула «майонез» или «сыр»,
 * значение исчезало, и пользователь с аллергией на яйца или лактозу
 * НЕ получал предупреждения, хотя вещество в блюде есть.
 */
describe('normalizeAllergensExpanding', () => {
  it('сохраняет неизвестные аллергены вместо их отбрасывания', () => {
    const input = ['молоко', 'сыр', 'майонез', 'яйцо', 'орехи', 'сельдь'];
    const result = normalizeAllergensExpanding(input);

    // Старое поведение теряло «сыр», «майонез», «сельдь».
    const old = normalizeCatalogAllergenList(input);
    assert.notInclude(old, 'майонез', 'старый нормализатор терял значение');

    // Новое — ничего не теряет.
    assert.include(result.unrecognized, 'майонез');
    assert.include(result.unrecognized, 'сыр');
    assert.include(result.unrecognized, 'сельдь');
  });

  it('распознаёт значения из справочника', () => {
    const r = normalizeAllergensExpanding(['молоко', 'рыба', 'nuts', 'яйца']);
    assert.include(r.recognized, 'лактоза');
    assert.include(r.recognized, 'рыба');
    assert.include(r.recognized, 'орехи');
    assert.include(r.recognized, 'яйца');
    assert.isEmpty(r.unrecognized);
  });

  it('all содержит и распознанные, и сохранённые значения', () => {
    const r = normalizeAllergensExpanding(['молоко', 'майонез']);
    assert.include(r.all, 'лактоза');
    assert.include(r.all, 'майонез');
    assert.lengthOf(r.all, 2);
  });

  it('приводит неизвестные значения к нижнему регистру и обрезает длину', () => {
    const r = normalizeAllergensExpanding(['  МАЙОНЕЗ  ', 'x'.repeat(200)]);
    assert.include(r.unrecognized, 'майонез');
    assert.isTrue(r.unrecognized.every((v) => v.length <= 64));
  });

  it('убирает пустые значения и дубликаты', () => {
    const r = normalizeAllergensExpanding(['', '  ', 'молоко', 'МОЛОКО', 'молоко']);
    assert.lengthOf(r.recognized, 1);
    assert.isEmpty(r.unrecognized);
  });

  it('устойчив к не-массиву', () => {
    assert.deepEqual(normalizeAllergensExpanding(null), { recognized: [], unrecognized: [], all: [] });
    assert.deepEqual(normalizeAllergensExpanding('молоко'), { recognized: [], unrecognized: [], all: [] });
    assert.deepEqual(normalizeAllergensExpanding(undefined), { recognized: [], unrecognized: [], all: [] });
  });
});
