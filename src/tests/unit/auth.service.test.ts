import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { assert } from 'chai';
import { describe, it } from 'mocha';
import { AuthService } from '../../auth/auth.service';

type MockUser = {
  id: number;
  email: string;
  role: 'user' | 'admin' | 'guest';
  password?: string;
  update: (payload: Record<string, unknown>) => Promise<unknown>;
};

const hash = (value: string) => {
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(value).digest('hex');
};

const mailServiceStub = {
  sendVerificationCode: async () => {},
};

/** Мок записи кода для verifyAndConsume (register / login / reset). */
function makeValidCodeRecord(plainCode: string) {
  const h = hash(plainCode);
  return {
    codeHash: h,
    expiresAt: new Date(Date.now() + 60_000),
    destroy: async () => {},
  };
}

const emailCodeUnused = {
  findOne: async () => null,
  destroy: async () => {},
};

describe('AuthService модульные тесты', () => {
  it('register: выбрасывает исключение, если пользователь уже существует', async () => {
    const code = '111111';
    const emailCodeModel = {
      findOne: async () => makeValidCodeRecord(code),
      destroy: async () => {},
    };
    const userModel = {
      findOne: async () => ({ id: 1, email: 'existing@mail.com' }),
      create: async () => null,
    };
    const jwtService = {
      sign: () => 'token',
      verify: () => ({ sub: 1 }),
    };
    const service = new AuthService(
      userModel as never,
      emailCodeModel as never,
      jwtService as never,
      mailServiceStub as never,
    );

    try {
      await service.register({
        email: 'existing@mail.com',
        password: '123456',
        emailCode: code,
        height: 170,
        weight: 70,
        gender: 'male',
        birthDate: new Date('1995-01-01'),
        goal: 'maintain',
        activityLevel: 'moderate',
      });
      assert.fail('Ожидалось исключение BadRequestException');
    } catch (error) {
      assert.instanceOf(error, BadRequestException);
    }
  });

  it('register: создаёт пользователя и возвращает auth-данные', async () => {
    const code = '654321';
    let createdPayload: Record<string, unknown> = {};
    const mockUser: MockUser = {
      id: 2,
      email: 'new@mail.com',
      role: 'user',
      update: async () => ({}),
    };
    const emailCodeModel = {
      findOne: async () => makeValidCodeRecord(code),
      destroy: async () => {},
    };
    const userModel = {
      findOne: async () => null,
      create: async (payload: Record<string, unknown>) => {
        createdPayload = payload;
        return mockUser;
      },
    };
    const jwtService = {
      sign: (_payload: Record<string, unknown>, options: { expiresIn: string }) =>
        options.expiresIn === '15m' ? 'access' : 'refresh',
      verify: () => ({ sub: 2 }),
    };
    const service = new AuthService(
      userModel as never,
      emailCodeModel as never,
      jwtService as never,
      mailServiceStub as never,
    );

    const result = await service.register({
      email: 'new@mail.com',
      password: '123456',
      emailCode: code,
      height: 180,
      weight: 82,
      gender: 'male',
      birthDate: new Date('1994-02-01'),
      goal: 'gain',
      activityLevel: 'active',
    });

    assert.equal(result.accessToken, 'access');
    assert.equal(result.refreshToken, 'refresh');
    assert.equal(result.user.email, 'new@mail.com');
    assert.equal(createdPayload.email, 'new@mail.com');
    assert.equal(createdPayload.password, hash('123456'));
    assert.equal(createdPayload.goal, 'gain');
  });

  it('login: выбрасывает исключение при неверном пароле', async () => {
    const userModel = {
      findOne: async () => ({
        id: 1,
        email: 'admin@example.com',
        role: 'admin',
        isBlocked: false,
        password: hash('correct-password'),
        update: async () => ({}),
      }),
    };
    const jwtService = { sign: () => 'token', verify: () => ({ sub: 1 }) };
    const service = new AuthService(
      userModel as never,
      emailCodeUnused as never,
      jwtService as never,
      mailServiceStub as never,
    );

    try {
      await service.login('admin@example.com', 'wrong-password');
      assert.fail('Ожидалось исключение UnauthorizedException');
    } catch (error) {
      assert.instanceOf(error, UnauthorizedException);
    }
  });

  it('login: возвращает токены и данные пользователя', async () => {
    const userModel = {
      findOne: async () => ({
        id: 9,
        email: 'u@mail.com',
        role: 'user',
        isBlocked: false,
        password: hash('secret'),
        update: async () => ({}),
      }),
    };
    const jwtService = {
      sign: (_payload: Record<string, unknown>, options: { expiresIn: string }) =>
        options.expiresIn === '15m' ? 'access-9' : 'refresh-9',
      verify: () => ({ sub: 9 }),
    };
    const service = new AuthService(
      userModel as never,
      emailCodeUnused as never,
      jwtService as never,
      mailServiceStub as never,
    );

    const result = await service.login('u@mail.com', 'secret');

    assert.equal(result.accessToken, 'access-9');
    assert.equal(result.refreshToken, 'refresh-9');
    assert.deepEqual(result.user, { id: 9, email: 'u@mail.com', role: 'user' });
  });

  it('refresh: выбрасывает исключение, когда пользователь не найден', async () => {
    const userModel = {
      findByPk: async () => null,
    };
    const jwtService = {
      sign: () => 'x',
      verify: () => ({ sub: 777, type: 'refresh' }),
    };
    const service = new AuthService(
      userModel as never,
      emailCodeUnused as never,
      jwtService as never,
      mailServiceStub as never,
    );

    try {
      await service.refresh('bad-refresh-token');
      assert.fail('Ожидалось исключение UnauthorizedException');
    } catch (error) {
      assert.instanceOf(error, UnauthorizedException);
    }
  });

  it('refresh: работает даже при ошибке обновления refreshTokenHash', async () => {
    const token = 'token';
    const userModel = {
      findByPk: async () => ({
        id: 4,
        email: 'legacy@mail.com',
        role: 'user',
        isBlocked: false,
        refreshTokenHash: hash(token),
        update: async () => {
          throw new Error('legacy schema without refreshTokenHash');
        },
      }),
    };
    const jwtService = {
      sign: (_payload: Record<string, unknown>, options: { expiresIn: string }) =>
        options.expiresIn === '15m' ? 'access-legacy' : 'refresh-legacy',
      verify: () => ({ sub: 4, type: 'refresh' }),
    };
    const service = new AuthService(
      userModel as never,
      emailCodeUnused as never,
      jwtService as never,
      mailServiceStub as never,
    );

    const result = await service.refresh(token);
    assert.equal(result.accessToken, 'access-legacy');
    assert.equal(result.refreshToken, 'refresh-legacy');
    assert.equal(result.user.id, 4);
  });

  it('login: блокирует пользователя с isBlocked', async () => {
    const userModel = {
      findOne: async () => ({
        id: 8,
        email: 'blocked@mail.com',
        role: 'user',
        isBlocked: true,
        password: hash('secret'),
        update: async () => ({}),
      }),
    };
    const jwtService = { sign: () => 'token', verify: () => ({ sub: 8 }) };
    const service = new AuthService(
      userModel as never,
      emailCodeUnused as never,
      jwtService as never,
      mailServiceStub as never,
    );

    try {
      await service.login('blocked@mail.com', 'secret');
      assert.fail('Ожидалось исключение о блокировке');
    } catch (error) {
      assert.equal((error as Error).name, 'ForbiddenException');
    }
  });

  it('refresh: выбрасывает исключение при несовпадении refreshTokenHash', async () => {
    const userModel = {
      findByPk: async () => ({
        id: 11,
        email: 'token@mail.com',
        role: 'user',
        isBlocked: false,
        refreshTokenHash: hash('another-token'),
        update: async () => ({}),
      }),
    };
    const jwtService = {
      sign: () => 'x',
      verify: () => ({ sub: 11, type: 'refresh' }),
    };
    const service = new AuthService(
      userModel as never,
      emailCodeUnused as never,
      jwtService as never,
      mailServiceStub as never,
    );

    try {
      await service.refresh('incoming-token');
      assert.fail('Ожидалось исключение UnauthorizedException');
    } catch (error) {
      assert.instanceOf(error, UnauthorizedException);
    }
  });
});
