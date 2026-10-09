import { assert } from 'chai';
import { createHash } from 'crypto';
import { describe, it } from 'mocha';
import {
  hashPassword,
  hashPasswordSync,
  needsRehash,
  verifyPassword,
} from '../../common/password.util';

describe('password.util', () => {
  it('scrypt: верный пароль проходит, неверный — нет', async () => {
    const h = await hashPassword('secret123');
    assert.isTrue(h.startsWith('scrypt$'));
    assert.isTrue(await verifyPassword('secret123', h));
    assert.isFalse(await verifyPassword('secret124', h));
  });

  it('соль: одинаковые пароли дают разные хэши', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    assert.notStrictEqual(a, b);
    assert.isTrue(await verifyPassword('same', a));
    assert.isTrue(await verifyPassword('same', b));
  });

  it('ленивая миграция: старый sha256-хэш проверяется и требует перехэширования', async () => {
    const legacy = createHash('sha256').update('oldpass').digest('hex');
    assert.isTrue(await verifyPassword('oldpass', legacy));
    assert.isFalse(await verifyPassword('other', legacy));
    assert.isTrue(needsRehash(legacy));
  });

  it('новый формат не требует перехэширования', async () => {
    assert.isFalse(needsRehash(await hashPassword('x')));
  });

  it('битые значения не проходят проверку и не падают', async () => {
    assert.isFalse(await verifyPassword('x', ''));
    assert.isFalse(await verifyPassword('x', 'scrypt$bad'));
    assert.isFalse(await verifyPassword('x', 'scrypt$1$2$3$zz$zz'));
  });

  it('синхронный вариант совместим с асинхронной проверкой', async () => {
    assert.isTrue(await verifyPassword('syncpass', hashPasswordSync('syncpass')));
  });
});
