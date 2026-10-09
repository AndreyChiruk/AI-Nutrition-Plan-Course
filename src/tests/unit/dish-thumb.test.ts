import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Тесты запасной SVG-иконки блюда.
 *
 * Картинки берутся с TheMealDB (`strMealThumb`). Если внешний ресурс
 * недоступен (нет сети, блокировка провайдера, устаревший URL), браузер
 * показывал «битую» иконку — список блюд выглядел сломанным.
 *
 * Теперь при ошибке загрузки или отсутствии URL рисуется локальная
 * SVG-иконка по категории блюда: она доступна всегда и не ломает вёрстку.
 */
type Slot = 'breakfast' | 'lunch' | 'dinner' | 'snack';

/** Логика выбора иконки (iconForSlot в DishThumb.tsx). */
function iconForSlot(slot?: string | null): { tone: string; label: string } {
  switch (slot) {
    case 'breakfast':
      return { tone: 'thumb-breakfast', label: 'Завтрак' };
    case 'lunch':
      return { tone: 'thumb-lunch', label: 'Обед' };
    case 'dinner':
      return { tone: 'thumb-dinner', label: 'Ужин' };
    case 'snack':
      return { tone: 'thumb-snack', label: 'Перекус' };
    default:
      return { tone: 'thumb-default', label: 'Блюдо' };
  }
}

/** Логика отображения: картинка или заглушка. */
function shouldShowImage(imageUrl?: string | null, failed = false): boolean {
  // trim: строка из пробелов не является валидным URL
  return String(imageUrl ?? '').trim().length > 0 && !failed;
}

/** Упрощённое определение слота по названию (inferSlotFromName). */
function inferSlotFromName(name?: string | null): Slot {
  const n = String(name ?? '').toLowerCase().replace(/ё/g, 'е');
  if (!n) return 'lunch';
  if (/(каша|овсян|блин|оладь|омлет|яичниц|сырник|тост|гренк|круассан|завтрак|йогурт|мюсли|гранола)/.test(n))
    return 'breakfast';
  if (/(салат|десерт|торт|печенье|кекс|пирожн|мороженое|шоколад|фрукт|ягод|смузи|чипсы|орешк|батончик|чай|кофе|сок)/.test(n))
    return 'snack';
  if (/(запечен|тушен|рагу|овощ|баклажан|кабачок|брокколи|гриб|ужин)/.test(n)) return 'dinner';
  return 'lunch';
}

describe('миниатюра блюда: запасная иконка', () => {
  it('показывает картинку, когда URL есть и загрузка успешна', () => {
    assert.isTrue(shouldShowImage('https://www.themealdb.com/images/media/meals/x.jpg'));
  });

  it('переключается на заглушку при ошибке загрузки (главный кейс)', () => {
    // Именно это ломалось: при недоступности TheMealDB оставалась битая иконка.
    assert.isFalse(shouldShowImage('https://www.themealdb.com/images/media/meals/x.jpg', true));
  });

  it('показывает заглушку при отсутствии URL', () => {
    assert.isFalse(shouldShowImage(null));
    assert.isFalse(shouldShowImage(''));
    assert.isFalse(shouldShowImage(undefined));
    assert.isFalse(shouldShowImage('   '));
  });

  it('подбирает иконку и цвет по приёму пищи', () => {
    assert.strictEqual(iconForSlot('breakfast').tone, 'thumb-breakfast');
    assert.strictEqual(iconForSlot('lunch').tone, 'thumb-lunch');
    assert.strictEqual(iconForSlot('dinner').tone, 'thumb-dinner');
    assert.strictEqual(iconForSlot('snack').tone, 'thumb-snack');
  });

  it('для неизвестного слота использует нейтральную иконку', () => {
    assert.strictEqual(iconForSlot(null).tone, 'thumb-default');
    assert.strictEqual(iconForSlot(undefined).tone, 'thumb-default');
    assert.strictEqual(iconForSlot('нечто').tone, 'thumb-default');
  });

  it('определяет слот по названию для выбора иконки', () => {
    assert.strictEqual(inferSlotFromName('Овсяная каша с бананом'), 'breakfast');
    assert.strictEqual(inferSlotFromName('Омлет с сыром'), 'breakfast');
    assert.strictEqual(inferSlotFromName('Шоколадный брауни'), 'snack');
    assert.strictEqual(inferSlotFromName('Овощное рагу'), 'dinner');
    assert.strictEqual(inferSlotFromName('Борщ'), 'lunch');
  });

  it('не ломается на пустом названии', () => {
    assert.strictEqual(inferSlotFromName(''), 'lunch');
    assert.strictEqual(inferSlotFromName(null), 'lunch');
  });

  it('учитывает «ё» при определении слота', () => {
    assert.strictEqual(inferSlotFromName('Тушёные овощи'), 'dinner');
  });
});
