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
const SOLID_UNITS: FridgeUnit[] = ["г", "кг"];

const LIQUID_CATEGORY_RE = /напит|жидкост|вода|сок|молок|кефир|бульон|соус|масло/i;
const LIQUID_NAME_RE = /молок|молочн|кефир|ряженк|сок|вода|чай|кофе|компот|бульон|напит|сироп|уксус|вино|пиво|сливк|йогурт/i;

const COUNTABLE_UNITS: FridgeUnit[] = ['шт'];
const COUNTABLE_CATEGORY_RE = /яйц|фрукт|овощ|ягод|бахчев|гриб|зелень|орех|сухофрукт|хлеб|выпечк|кондитер/i;
const COUNTABLE_NAME_RE = /\bяйц|яблок|банан|апельсин|мандарин|груш|лимон|лайм|киви|авокадо|томат|помидор|огурец|перец|лук|морков|картоф|кабачок|баклажан|свекл|капуст|редис|виноград|слив|персик|абрикос|вишн|черешн|гранат|манго|ананас|хлеб|батон|булочек|лаваш|яйцо|яйца|зубчик/i;

function isCountableProduct(name: string, category?: string | null): boolean {
  if (COUNTABLE_CATEGORY_RE.test(category ?? '')) return true;
  return COUNTABLE_NAME_RE.test(String(name ?? '').toLowerCase());
}

function unitsForFridge(name: string, category?: string | null): FridgeUnit[] {
  const hay = `${category ?? ''} ${name}`.toLowerCase();
  if (LIQUID_CATEGORY_RE.test(category ?? '') || LIQUID_NAME_RE.test(hay)) return LIQUID_UNITS;
  if (isCountableProduct(name, category)) return COUNTABLE_UNITS;
  return SOLID_UNITS;
}

describe('холодильник: единицы измерения по категории', () => {
  it('для жидкостей предлагает только объём', () => {
    for (const name of ['молоко', 'кефир', 'апельсиновый сок', 'вода', 'куриный бульон']) {
      const units = unitsForFridge(name);
      assert.deepEqual(units, LIQUID_UNITS, `${name}: ожидались мл/л`);
    }
  });

  it('для сыпучих и мяса предлагает только массу', () => {
    // «шт» здесь бессмысленно: гречку и муку не считают штуками.
    for (const name of ['гречка', 'куриная грудка', 'рис', 'мука', 'сахар', 'фарш']) {
      const units = unitsForFridge(name);
      assert.deepEqual(units, SOLID_UNITS, `${name}: ожидались г/кг`);
      assert.include(units, 'г');
      assert.include(units, 'кг');
      assert.notInclude(units, 'шт', `${name}: штуки для сыпучего не предлагаем`);
    }
  });

  it('для штучных продуктов оставляет только «шт»', () => {
    for (const name of ['яйцо', 'яблоко', 'банан', 'апельсин', 'огурец', 'помидор', 'картофель']) {
      assert.deepEqual(unitsForFridge(name), COUNTABLE_UNITS, `${name}: ожидались только шт`);
    }
  });

  it('штучные продукты не предлагают граммы и килограммы', () => {
    const units = unitsForFridge('яйцо');
    assert.notInclude(units, 'г');
    assert.notInclude(units, 'кг');
  });

  it('категория «Фрукты» переводит продукт в штуки', () => {
    assert.deepEqual(unitsForFridge('нечто', 'Фрукты'), COUNTABLE_UNITS);
    assert.deepEqual(unitsForFridge('нечто', 'Овощи'), COUNTABLE_UNITS);
  });

  it('жидкость остаётся жидкостью даже в штучной категории', () => {
    assert.deepEqual(unitsForFridge('сок', 'Напитки'), LIQUID_UNITS);
  });

  it('для жидкостей не предлагает граммы и килограммы', () => {
    const units = unitsForFridge('молоко');
    assert.notInclude(units, 'г');
    assert.notInclude(units, 'кг');
  });

  it('категория из справочника важнее названия', () => {
    // Пользователь мог ввести название неточно, но категория известна.
    assert.deepEqual(unitsForFridge('что-то', 'Напитки'), LIQUID_UNITS);
    assert.deepEqual(unitsForFridge('что-то', 'Крупы и макароны'), SOLID_UNITS);
  });

  it('«молочный коктейль» считается жидкостью', () => {
    assert.deepEqual(unitsForFridge('молочный коктейль'), LIQUID_UNITS);
  });

  it('не распознанный продукт получает массу — безопасный вариант по умолчанию', () => {
    // Неизвестное название не должно предлагать объём: взвесить можно всё.
    assert.deepEqual(unitsForFridge('нечто загадочное'), SOLID_UNITS);
    assert.deepEqual(unitsForFridge(''), SOLID_UNITS);
  });

  it('у каждого типа ровно свой набор единиц', () => {
    assert.lengthOf(unitsForFridge('молоко'), 2, 'жидкость — мл и л');
    assert.lengthOf(unitsForFridge('гречка'), 2, 'сыпучее — г и кг');
    assert.lengthOf(unitsForFridge('яйцо'), 1, 'штучное — только шт');
  });
});
