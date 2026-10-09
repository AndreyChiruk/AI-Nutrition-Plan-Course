import { assert } from 'chai';
import { describe, it } from 'mocha';
import { CURATED_CIS_DISHES } from '../../data/curated-cis-dishes';

/**
 * Тесты курируемого списка блюд СНГ-кухни.
 *
 * Каталог из 670 позиций почти полностью состоял из иностранных блюд
 * («Алжирский хлеб», «Сирийские спагетти»), поэтому план был непривычен.
 * Список составлен вручную: у TheMealDB русской кухни почти нет, а USDA —
 * база ингредиентов, а не готовых блюд.
 *
 * КБЖУ в данных НЕ указаны намеренно: они вычисляются из состава, чтобы
 * не повторять ошибки импорта («Котлеты 1464 ккал»).
 */
describe('курируемые блюда СНГ-кухни', () => {
  it('список не пустой и содержит достаточно блюд', () => {
    assert.isAtLeast(CURATED_CIS_DISHES.length, 30, 'нужно не меньше 30 блюд');
  });

  it('названия уникальны', () => {
    const names = CURATED_CIS_DISHES.map((d) => d.name.toLowerCase());
    assert.strictEqual(new Set(names).size, names.length, 'есть дубликаты названий');
  });

  it('у каждого блюда корректная категория', () => {
    const allowed = ['breakfast', 'lunch', 'dinner', 'snack'];
    for (const d of CURATED_CIS_DISHES) {
      assert.include(allowed, d.category, `${d.name}: неверная категория`);
    }
  });

  it('у каждого блюда есть состав с положительными граммовками', () => {
    for (const d of CURATED_CIS_DISHES) {
      assert.isAtLeast(d.ingredients.length, 2, `${d.name}: слишком мало ингредиентов`);
      for (const ing of d.ingredients) {
        assert.isAbove(ing.grams, 0, `${d.name} / ${ing.name}: граммовка должна быть > 0`);
        assert.isBelow(ing.grams, 1000, `${d.name} / ${ing.name}: граммовка подозрительно велика`);
      }
    }
  });

  it('у каждого блюда есть описание и время приготовления', () => {
    for (const d of CURATED_CIS_DISHES) {
      assert.isAbove(d.description.trim().length, 10, `${d.name}: описание слишком короткое`);
      assert.isAbove(d.cookingTimeMin, 0, `${d.name}: время приготовления не задано`);
    }
  });

  it('порции реалистичны: масса одной порции 70–600 г', () => {
    // Первая версия списка содержала порции по 400–800 г (двойные),
    // из-за чего калорийность блюда оказывалась вдвое выше реальной.
    //
    // Вода и соль исключаются из массы: суп содержит 300 г воды,
    // которые не являются «продуктом» порции.
    const nonMass = /вода|соль|специи|лавровый|корица|сода/i;
    for (const d of CURATED_CIS_DISHES) {
      const mass =
        d.ingredients
          .filter((i) => !nonMass.test(i.name))
          .reduce((sum, i) => sum + i.grams, 0) / d.servings;
      // Гарниры из крупы весят меньше: 70 г сухой гречки — нормальная порция.
      assert.isAtLeast(mass, 70, `${d.name}: порция ${Math.round(mass)} г — слишком мала`);
      assert.isAtMost(mass, 600, `${d.name}: порция ${Math.round(mass)} г — слишком велика`);
    }
  });

  it('представлены все приёмы пищи', () => {
    const byCat = new Map<string, number>();
    for (const d of CURATED_CIS_DISHES) {
      byCat.set(d.category, (byCat.get(d.category) ?? 0) + 1);
    }
    for (const cat of ['breakfast', 'lunch', 'dinner', 'snack']) {
      assert.isAtLeast(byCat.get(cat) ?? 0, 3, `категория «${cat}» представлена слабо`);
    }
  });

  it('представлены разные кухни', () => {
    const cuisines = new Set(CURATED_CIS_DISHES.map((d) => d.cuisine));
    assert.isAtLeast(cuisines.size, 3, 'должны быть разные кухни');
    assert.include([...cuisines], 'russian', 'русская кухня обязательна');
  });

  it('содержит узнаваемые блюда из повседневного рациона', () => {
    const names = CURATED_CIS_DISHES.map((d) => d.name.toLowerCase());
    for (const expected of ['борщ', 'сырники', 'пельмени', 'окрошка', 'винегрет', 'гречневая']) {
      assert.isTrue(
        names.some((n) => n.includes(expected)),
        `ожидалось блюдо со словом «${expected}»`,
      );
    }
  });

  it('не содержит КБЖУ в данных (вычисляются из состава)', () => {
    for (const d of CURATED_CIS_DISHES) {
      assert.notProperty(d, 'calories', `${d.name}: калории должны вычисляться`);
      assert.notProperty(d, 'protein');
      assert.notProperty(d, 'fat');
      assert.notProperty(d, 'carbs');
    }
  });

  it('блюда с мясом не попадут в вегетарианские', () => {
    // Проверяем, что в составе таких блюд есть мясной компонент —
    // это гарантирует корректность автотегирования.
    const meaty = CURATED_CIS_DISHES.filter((d) =>
      /котлет|пельмен|голубц|шашлык|бефстроганов|солянк|ёжик|ежик|манты|самса|долма|бешбармак|харчо|лагман|жаркое|зразы|запеканка/.test(
        d.name.toLowerCase(),
      ),
    );
    assert.isAtLeast(meaty.length, 4);
    for (const d of meaty) {
      // «Куриная грудка» не содержит «куриц», поэтому проверяем корень «курин».
      const hasMeat = d.ingredients.some((i) =>
        /фарш|свинин|говядин|куриц|курин|баранин|мяс|грудка|сельд|рыб/i.test(i.name),
      );
      assert.isTrue(hasMeat, `${d.name}: не найден мясной компонент в составе`);
    }
  });
});
