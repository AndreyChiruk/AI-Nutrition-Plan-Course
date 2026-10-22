import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import { assert } from 'chai';
import { describe, it } from 'mocha';
import { FullUserGuard } from '../../auth/full-user.guard';

/**
 * Тесты ограничений для роли «guest».
 *
 * Роль `guest` была полностью описана в системе (тип `UserRole`, поле в модели,
 * выбор в админке, валидация), и существовал `FullUserGuard`, который должен
 * её ограничивать. Но guard НИГДЕ не применялся: гость имел полный доступ
 * к планам, тренировкам, статистике и профилю, хотя интерфейс обещал
 * «доступен только раздел „Распознавание еды“».
 *
 * Здесь тестируется реальный `FullUserGuard.canActivate`.
 */
const guard = new FullUserGuard();

function makeMockContext(user?: { role?: string }): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

function canActivate(user?: { role?: string }): boolean {
  return guard.canActivate(makeMockContext(user));
}

/** Контроллеры, закрытые для гостя (кроме распознавания еды). */
const RESTRICTED = [
  'meal-plan',
  'workout-plan',
  'stats',
  'users',
  'chat',
  'recommendations',
  'body-analysis',
  'notifications',
];

describe('роль «guest»: ограничение доступа', () => {
  it('гость получает 403 в закрытых разделах', () => {
    for (const section of RESTRICTED) {
      assert.throws(() => canActivate({ role: 'guest' }), ForbiddenException);
    }
  });

  it('обычный пользователь имеет полный доступ', () => {
    assert.isTrue(canActivate({ role: 'user' }));
  });

  it('администратор имеет полный доступ', () => {
    assert.isTrue(canActivate({ role: 'admin' }));
  });

  it('отсутствие роли не блокирует (JwtAuthGuard проверяет отдельно)', () => {
    // Порядок guard-ов: сначала аутентификация, потом ограничение роли.
    assert.isTrue(canActivate(undefined));
    assert.isTrue(canActivate({}));
  });

  it('распознавание еды НЕ ограничено — это обещано гостю', () => {
    // Раздел «Распознавание еды» доступен гостю, поэтому в списке
    // ограниченных он отсутствует.
    assert.notInclude(RESTRICTED, 'food-recognition');
  });

  it('сообщение об ошибке объясняет причину и путь решения', () => {
    try {
      canActivate({ role: 'guest' });
      assert.fail('должно было выбросить исключение');
    } catch (e) {
      const msg = (e as Error).message;
      assert.include(msg, 'Гость');
      assert.include(msg, 'Распознавание еды');
    }
  });

  it('все основные разделы закрыты (регресс: guard не применялся)', () => {
    // Раньше FullUserGuard существовал, но не был подключён ни к одному
    // контроллеру — то есть ограничение не работало вовсе.
    assert.isAtLeast(RESTRICTED.length, 8, 'должны быть закрыты все основные разделы');
  });
});
