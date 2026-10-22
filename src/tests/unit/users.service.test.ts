import { NotFoundException } from '@nestjs/common';
import { assert } from 'chai';
import { describe, it } from 'mocha';
import { UsersService } from '../../users/users.service';
import { verifyPassword } from '../../common/password.util';

const sha = (value: string) => {
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(value).digest('hex');
};

describe('UsersService unit', () => {
  const fridgeModel = {
    findAll: async () => [],
    create: async () => ({}),
    findOne: async () => null,
  };
  const ingredientModel = {
    findAll: async () => [],
    findOne: async () => null,
  };
  const fridgeImageStorage = {
    save: async () => ({ url: '/uploads/fridge/test.webp', bytes: 10 }),
    removeByUrl: async () => {},
  };

  it('updateProfile: выбрасывает исключение, когда пользователь не найден', async () => {
    const userModel = { findByPk: async () => null };
    const allergenModel = {} as Record<string, unknown>;
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );

    try {
      await service.updateProfile('42', { weight: 80 } as never);
      assert.fail('Ожидалось исключение NotFoundException');
    } catch (error) {
      assert.instanceOf(error, NotFoundException);
    }
  });

  it('updateProfile: обновляет и возвращает пользователя', async () => {
    const user = {
      id: 5,
      weight: 70,
      update: async (payload: Record<string, unknown>) => Object.assign(user, payload),
    };
    const userModel = { findByPk: async () => user };
    const allergenModel = {} as Record<string, unknown>;
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );

    const result = await service.updateProfile('5', { weight: 77 } as never);

    assert.equal(result.weight, 77);
  });

  it('setAllergies: выбрасывает исключение, когда пользователь не найден', async () => {
    const userModel = { findByPk: async () => null };
    const allergenModel = { findAll: async () => [] };
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );

    try {
      await service.setAllergies('1', ['a1', 'a2']);
      assert.fail('Ожидалось исключение NotFoundException');
    } catch (error) {
      assert.instanceOf(error, NotFoundException);
    }
  });

  it('setAllergies: привязывает аллергены и возвращает профиль', async () => {
    let linkedCount = 0;
    const user = {
      id: 1,
      $set: async (_name: string, allergens: Array<Record<string, unknown>>) => {
        linkedCount = allergens.length;
      },
    };
    const userModel = { findByPk: async () => user };
    const allergenModel = {
      findAll: async () => [{ id: 'a1' }, { id: 'a2' }],
    };
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );
    const originalGetById = service.getById.bind(service);
    service.getById = async () => ({ id: 1, allergens: [{ id: 'a1' }, { id: 'a2' }] }) as never;

    const result = await service.setAllergies('1', ['a1', 'a2']);

    assert.equal(linkedCount, 2);
    assert.deepEqual((result as { allergens: Array<{ id: string }> }).allergens, [
      { id: 'a1' },
      { id: 'a2' },
    ]);
    service.getById = originalGetById;
  });

  it('calculateBmrAndCalories: возвращает ожидаемые округлённые числа', async () => {
    const userModel = {
      findByPk: async () => ({
        birthDate: new Date('1995-01-01'),
        weight: 80,
        height: 180,
        gender: 'male',
        activityLevel: 'moderate',
        goal: 'maintain',
      }),
    };
    const allergenModel = {} as Record<string, unknown>;
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );

    const result = await service.calculateBmrAndCalories('1');

    assert.isNumber(result.bmr);
    assert.isNumber(result.dailyCalories);
    assert.isAtLeast(result.dailyCalories, result.bmr);
  });

  it('changePassword: выбрасывает исключение, когда старый пароль не совпадает', async () => {
    const userModel = {
      findByPk: async () => ({
        id: 3,
        password: sha('correct'),
        update: async () => ({}),
      }),
    };
    const allergenModel = {} as Record<string, unknown>;
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );

    try {
      await service.changePassword('3', 'wrong', 'new-password');
      assert.fail('Ожидалось исключение NotFoundException');
    } catch (error) {
      assert.instanceOf(error, NotFoundException);
    }
  });

  it('changePassword: обновляет хешированный пароль при успехе', async () => {
    let savedHash = '';
    const userModel = {
      findByPk: async () => ({
        id: 3,
        password: sha('old-password'),
        update: async (payload: { password: string }) => {
          savedHash = payload.password;
        },
      }),
    };
    const allergenModel = {} as Record<string, unknown>;
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );

    const result = await service.changePassword('3', 'old-password', 'new-password');

    assert.deepEqual(result, { ok: true });
    // Раньше ожидался SHA-256 без соли. Теперь пароль хешируется scrypt
    // со случайной солью — проверяем механизм и отсутствие открытого текста.
    const stored = String(savedHash ?? '');
    assert.match(stored, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
    assert.notInclude(stored, 'new-password');
    assert.isTrue(await verifyPassword('new-password', stored));
  });
});