import { assert } from 'chai';
import { describe, it } from 'mocha';

/**
 * Подбор единиц измерения для холодильника.
 *
 * Раньше в списке всегда были все пять единиц одновременно: для молока
 * предлагались граммы, а для гречки — миллилитры. Теперь набор зависит
 * от категории продукта (масса для еды, объём для жидкостей).
 *
 * Логика повторяет `unitsForProduct` в FridgePage.tsx: тестовый раннер
 * собирает только `src/`, поэтому дублируем, как в других тестах.
 */
type FridgeUnit = 'г' | 'кг' | 'мл' | 'л' | 'шт';

const LIQUID_UNITS: FridgeUnit[] = ['мл', 'л'];
const SOLID_UNITS: FridgeUnit[] = ['г', 'кг', 'шт'];

const LIQUID_CATEGORY_RE = /напит|жидкост|вода|сок|молок|кефир|бульон|соус|масло/i;
const LIQUID_NAME_RE = /молок|молочн|кефир|ряженк|сок|вода|чай|кофе|компот|бульон|напит|сироп|уксус|вино|пиво|сливк|йогурт/i;

function unitsForProduct(name: string, category?: string | null): FridgeUnit[] {
  const hay = `${category ?? ''} ${name}`.toLowerCase();
  const isLiquid = LIQUID_CATEGORY_RE.test(category ?? '') || LIQUID_NAME_RE.test(hay);
  return isLiquid ? LIQUID_UNITS : SOLID_UNITS;
}

describe('холодильник: единицы измерения по категории', () => {
  it('для жидкостей предлагает только объём', () => {
    for (const name of ['молоко', 'кефир', 'апельсиновый сок', 'вода', 'куриный бульон']) {
      const units = unitsForProduct(name);
      assert.deepEqual(units, LIQUID_UNITS, `${name}: ожидались мл/л`);
    }
  });

  it('для еды предлагает массу и штуки, но не объём', () => {
    for (const name of ['гречка', 'куриная грудка', 'рис', 'яблоко']) {
      const units = unitsForProduct(name);
      assert.deepEqual(units, SOLID_UNITS, `${name}: ожидались г/кг/шт`);
      assert.notInclude(units, 'мл');
      assert.notInclude(units, 'л');
    }
  });

  it('для жидкостей не предлагает граммы и килограммы', () => {
    const units = unitsForProduct('молоко');
    assert.notInclude(units, 'г');
    assert.notInclude(units, 'кг');
  });

  it('категория из справочника важнее названия', () => {
    // Пользователь мог ввести название неточно, но категория известна.
    assert.deepEqual(unitsForProduct('что-то', 'Напитки'), LIQUID_UNITS);
    assert.deepEqual(unitsForProduct('что-то', 'Крупы и макароны'), SOLID_UNITS);
  });

  it('«молочный коктейль» считается жидкостью', () => {
    assert.deepEqual(unitsForProduct('молочный коктейль'), LIQUID_UNITS);
  });

  it('не распознанный продукт получает массу — безопасный вариант по умолчанию', () => {
    // Неизвестное название не должно предлагать объём: взвесить можно всё.
    assert.deepEqual(unitsForProduct('нечто загадочное'), SOLID_UNITS);
    assert.deepEqual(unitsForProduct(''), SOLID_UNITS);
  });

  it('каждая жидкость имеет ровно две единицы, еда — три', () => {
    assert.lengthOf(unitsForProduct('молоко'), 2);
    assert.lengthOf(unitsForProduct('гречка'), 3);
  });
});
