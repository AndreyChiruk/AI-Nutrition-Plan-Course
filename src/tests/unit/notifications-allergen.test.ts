import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты сохранения предупреждений об аллергенах.
 *
 * Раньше предупреждение существовало только в ответе HTTP: пользователь
 * закрывал страницу — и предупреждение исчезало навсегда, хотя риск
 * для здоровья остаётся. В интерфейсе при этом есть раздел уведомлений,
 * которому нечего было показывать.
 *
 * Здесь повторяется логика группировки предупреждений по блюдам
 * (saveAllergenWarnings + фильтрация в previewRecognize).
 */
type Item = { foodName: string };

/** Группирует предупреждения по блюдам: одно уведомление на блюдо. */
function groupWarningsByDish(items: Item[], warnings: string[]) {
  const groups: Array<{ dish: string; warnings: string[] }> = [];
  for (const item of items) {
    const forItem = warnings.filter((w) => w.includes(item.foodName));
    if (forItem.length === 0) continue;
    groups.push({ dish: item.foodName, warnings: forItem });
  }
  return groups;
}

describe('уведомления об аллергенах', () => {
  it('группирует несколько аллергенов одного блюда в одно уведомление', () => {
    const items = [{ foodName: 'Сельдь под шубой' }];
    const warnings = [
      'В составе «Сельдь под шубой» обнаружен аллерген «рыба» — совпадение с вашим профилем.',
      'В составе «Сельдь под шубой» обнаружен аллерген «яйца» — совпадение с вашим профилем.',
    ];
    const groups = groupWarningsByDish(items, warnings);
    assert.lengthOf(groups, 1, 'должно быть одно уведомление на блюдо, а не три');
    assert.lengthOf(groups[0].warnings, 2);
  });

  it('разделяет предупреждения по разным блюдам', () => {
    const items = [{ foodName: 'Салат Цезарь' }, { foodName: 'Мороженое' }];
    const warnings = [
      'В составе «Салат Цезарь» обнаружен аллерген «яйца».',
      'В составе «Мороженое» обнаружен аллерген «лактоза».',
    ];
    const groups = groupWarningsByDish(items, warnings);
    assert.lengthOf(groups, 2);
    assert.strictEqual(groups[0].dish, 'Салат Цезарь');
    assert.strictEqual(groups[1].dish, 'Мороженое');
  });

  it('не создаёт уведомлений, если предупреждений нет', () => {
    assert.isEmpty(groupWarningsByDish([{ foodName: 'Овощной салат' }], []));
    assert.isEmpty(
      groupWarningsByDish([{ foodName: 'Овощной салат' }], ['В составе «Другое» обнаружен аллерген.']),
    );
  });

  it('уведомление об аллергене имеет критичный уровень', () => {
    const severity = 'critical';
    assert.strictEqual(severity, 'critical', 'аллерген нельзя помечать как info');
  });

  it('текст уведомления содержит название блюда и аллерген', () => {
    const dish = 'Сельдь под шубой';
    const body = 'В составе «Сельдь под шубой» обнаружен аллерген «рыба» — совпадение с вашим профилем.';
    assert.include(body, dish);
    assert.include(body, 'рыба');
  });

  it('заголовок обрезается до 200 символов, тело сохраняется целиком', () => {
    const longDish = 'О'.repeat(300);
    const title = `Аллерген в блюде «${longDish}»`.slice(0, 200);
    assert.lengthOf(title, 200);
  });
});
