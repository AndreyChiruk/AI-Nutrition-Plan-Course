import { assert } from 'chai';
import { describe, it } from 'mocha';
import { sanitize, ValidationError } from '../../common/sanitize';

/**
 * Регрессионные тесты на защиту от массового присвоения полей.
 *
 * Ключевой сценарий: `POST /auth/register` раньше принимал `role` из тела запроса,
 * и любой мог зарегистрировать себе администратора.
 */
describe('sanitize: whitelist полей', () => {
  it('отбрасывает поля, которых нет в схеме (role, isBlocked, id)', () => {
    const out = sanitize(
      {
        email: 'user@example.com',
        password: 'secret123',
        role: 'admin',
        isBlocked: false,
        id: 999,
        refreshTokenHash: 'x',
      },
      {
        email: { type: 'string', required: true, email: true },
        password: { type: 'string', required: true, minLength: 6 },
      },
    );
    assert.deepEqual(Object.keys(out).sort(), ['email', 'password']);
    assert.notProperty(out, 'role');
    assert.notProperty(out, 'isBlocked');
    assert.notProperty(out, 'refreshTokenHash');
  });

  it('нормализует e-mail к нижнему регистру', () => {
    const out = sanitize({ email: '  User@Example.COM ' }, {
      email: { type: 'string', required: true, email: true },
    });
    assert.strictEqual(out.email, 'user@example.com');
  });

  it('отклоняет невалидный e-mail', () => {
    assert.throws(
      () => sanitize({ email: 'not-an-email' }, { email: { type: 'string', required: true, email: true } }),
      ValidationError,
    );
  });

  it('отклоняет пустой обязательный пароль и слишком короткий', () => {
    assert.throws(
      () => sanitize({ email: 'a@b.co' }, { email: { type: 'string', required: true, email: true }, password: { type: 'string', required: true } }),
      ValidationError,
    );
    assert.throws(
      () =>
        sanitize(
          { email: 'a@b.co', password: '123' },
          { email: { type: 'string', required: true, email: true }, password: { type: 'string', required: true, minLength: 6 } },
        ),
      ValidationError,
    );
  });

  it('приводит строковые числа к number и проверяет границы', () => {
    const out = sanitize({ durationDays: '7' }, { durationDays: { type: 'number', min: 1, max: 30 } });
    assert.strictEqual(out.durationDays, 7);
    assert.throws(() => sanitize({ durationDays: '0' }, { durationDays: { type: 'number', min: 1 } }), ValidationError);
    assert.throws(() => sanitize({ durationDays: '999' }, { durationDays: { type: 'number', max: 30 } }), ValidationError);
  });

  it('отклоняет NaN и нечисловые значения', () => {
    assert.throws(() => sanitize({ n: 'abc' }, { n: { type: 'number' } }), ValidationError);
    assert.throws(() => sanitize({ n: {} }, { n: { type: 'number' } }), ValidationError);
  });

  it('проверяет enum и дату', () => {
    assert.throws(() => sanitize({ goal: 'bulk' }, { goal: { type: 'string', enum: ['lose', 'maintain', 'gain'] } }), ValidationError);
    const ok = sanitize({ goal: 'gain' }, { goal: { type: 'string', enum: ['lose', 'maintain', 'gain'] } });
    assert.strictEqual(ok.goal, 'gain');
    assert.throws(() => sanitize({ birthDate: 'not-a-date' }, { birthDate: { type: 'date' } }), ValidationError);
    const d = sanitize({ birthDate: '1995-01-01' }, { birthDate: { type: 'date' } });
    assert.instanceOf(d.birthDate, Date);
  });

  it('подставляет значения по умолчанию для отсутствующих полей', () => {
    const out = sanitize({}, { height: { type: 'number', default: 170 }, goal: { type: 'string', default: 'maintain' } });
    assert.strictEqual(out.height, 170);
    assert.strictEqual(out.goal, 'maintain');
  });

  it('отклоняет не-объект в теле запроса', () => {
    assert.throws(() => sanitize('string', {}), ValidationError);
    assert.throws(() => sanitize([], {}), ValidationError);
    assert.throws(() => sanitize(null, {}), ValidationError);
  });

  it('фильтрует нестроковые элементы массива аллергенов', () => {
    const out = sanitize({ allergenIds: ['a', 1, null, 'b', '  '] }, { allergenIds: { type: 'array', arrayOfStrings: true } });
    assert.deepEqual(out.allergenIds, ['a', 'b']);
  });
});
