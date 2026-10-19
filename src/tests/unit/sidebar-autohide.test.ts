import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Логика автоскрытия бокового меню.
 *
 * Меню сворачивается за левый край, оставляя полоску шириной 14px;
 * наведение на полоску выдвигает панель, уход курсора — убирает.
 * Классы в AppLayout собираются по одной и той же схеме, и здесь
 * проверяется, что состояния не конфликтуют: свёрнутое меню не может
 * одновременно быть раскрытым, а «выезд» возможен только у свёрнутого.
 */

/** Ширина полоски, которая остаётся видимой у свёрнутого меню. */
const PEEK_WIDTH_PX = 14;
/** Ширина развёрнутого меню — как в grid-template-columns. */
const EXPANDED_WIDTH_PX = 220;

/** Повторяет сборку className в AppLayout. */
function shellClassName(opts: { navOpen: boolean; collapsed: boolean; navHovered: boolean }): string {
  const { navOpen, collapsed, navHovered } = opts;
  return (
    'app-shell' +
    (navOpen ? ' app-shell--nav-open' : '') +
    (collapsed ? ' app-shell--nav-collapsed' : '') +
    (collapsed && navHovered ? ' app-shell--nav-peek' : '')
  );
}

/** Ширина колонки меню для текущего состояния. */
function sidebarWidth(collapsed: boolean): number {
  return collapsed ? PEEK_WIDTH_PX : EXPANDED_WIDTH_PX;
}

/** Видна ли панель меню (а не только полоска). */
function panelVisible(opts: { collapsed: boolean; navHovered: boolean }): boolean {
  return !opts.collapsed || opts.navHovered;
}

describe('боковое меню: автоскрытие за левый край', () => {
  it('развёрнутое меню показывает полную ширину', () => {
    assert.strictEqual(sidebarWidth(false), EXPANDED_WIDTH_PX);
    assert.isTrue(panelVisible({ collapsed: false, navHovered: false }));
  });

  it('свёрнутое меню оставляет только узкую полоску', () => {
    assert.strictEqual(sidebarWidth(true), PEEK_WIDTH_PX);
    assert.isBelow(PEEK_WIDTH_PX, EXPANDED_WIDTH_PX, 'полоска должна быть заметно уже меню');
    assert.isTrue(PEEK_WIDTH_PX >= 10 && PEEK_WIDTH_PX <= 15, 'полоска 10–15px по требованию');
  });

  it('свёрнутое меню без наведения панель не показывает', () => {
    assert.isFalse(panelVisible({ collapsed: true, navHovered: false }));
  });

  it('наведение на полоску выдвигает панель', () => {
    assert.isTrue(panelVisible({ collapsed: true, navHovered: true }));
    assert.include(
      shellClassName({ navOpen: false, collapsed: true, navHovered: true }),
      'app-shell--nav-peek',
    );
  });

  it('уход курсора прячет панель обратно', () => {
    const hovered = shellClassName({ navOpen: false, collapsed: true, navHovered: true });
    const left = shellClassName({ navOpen: false, collapsed: true, navHovered: false });
    assert.include(hovered, 'app-shell--nav-peek');
    assert.notInclude(left, 'app-shell--nav-peek');
    assert.include(left, 'app-shell--nav-collapsed', 'меню остаётся свёрнутым');
  });

  it('выезд невозможен у несвёрнутого меню', () => {
    // Флаг наведения не должен добавлять класс, если меню и так раскрыто:
    // иначе состояние «выезда» висело бы постоянно.
    const cls = shellClassName({ navOpen: false, collapsed: false, navHovered: true });
    assert.notInclude(cls, 'app-shell--nav-peek');
    assert.notInclude(cls, 'app-shell--nav-collapsed');
  });

  it('состояния не конфликтуют между собой', () => {
    const cls = shellClassName({ navOpen: false, collapsed: true, navHovered: false });
    assert.include(cls, 'app-shell--nav-collapsed');
    assert.notInclude(cls, 'app-shell--nav-peek');
    // «Свёрнуто» и «раскрыто» одновременно невозможны.
    assert.isFalse(cls.includes('--nav-peek') && !cls.includes('--nav-collapsed'));
  });

  it('мобильное меню и автоскрытие работают независимо', () => {
    // Открытие мобильного меню не должно отменять свёрнутость.
    const cls = shellClassName({ navOpen: true, collapsed: true, navHovered: false });
    assert.include(cls, 'app-shell--nav-open');
    assert.include(cls, 'app-shell--nav-collapsed');
  });
});
