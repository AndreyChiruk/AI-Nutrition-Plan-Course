import { ForbiddenException } from '@nestjs/common';
import { assert } from 'chai';
import { describe, it } from 'mocha';
import { assertUserAccess } from '../../auth/request-access.util';

describe('assertUserAccess utility', () => {
  it('пропускает, когда пользователь обращается к своим данным', () => {
    assertUserAccess({ sub: 15, role: 'user' }, '15');
    assert.ok(true);
  });

  it('пропускает администратора для любого userId', () => {
    assertUserAccess({ sub: 1, role: 'admin' }, '99');
    assert.ok(true);
  });

  it('блокирует доступ к чужому userId', () => {
    try {
      assertUserAccess({ sub: 15, role: 'user' }, '21');
      assert.fail('Ожидалось исключение ForbiddenException');
    } catch (error) {
      assert.instanceOf(error, ForbiddenException);
    }
  });
});
