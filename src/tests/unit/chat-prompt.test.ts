import { assert } from 'chai';
import { describe, it } from 'mocha';
import { buildChatPrompt } from '../../openai/openai.prompts';

/**
 * Тесты системного промта AI-чата.
 *
 * Проблема: в промт передавались только аллергии, цель и антропометрия.
 * `dietaryRestrictions` (веган, кето и т.п.), нежелательные продукты и
 * привычки НЕ передавались, поэтому пользователь с типом питания «веган»
 * получал советы с яйцами и молоком — модель просто не знала о диете.
 *
 * Дополнительно: тип профиля был продублирован в openai.service.ts копией,
 * из-за чего новые поля не доходили до промта. Теперь источник один.
 */
function prompt(overrides: Partial<Record<string, unknown>> = {}) {
  return buildChatPrompt({
    userProfile: {
      gender: 'male',
      goal: 'lose',
      height: 180,
      weight: 82,
      birthDate: new Date('1994-02-01'),
      allergies: [],
      dietaryRestrictions: [],
      foodLikes: [],
      foodDislikes: [],
      foodHabits: {},
      ...overrides,
    },
    messages: [{ role: 'user', content: 'Что съесть на завтрак?' }],
  });
}

describe('промт AI-чата: учёт профиля', () => {
  it('передаёт тип питания (главный кейс)', () => {
    const p = prompt({ dietaryRestrictions: ['vegan'] });
    assert.include(p, 'Тип питания: vegan');
    assert.include(p, 'ОГРАНИЧЕНИЯ ПИТАНИЯ');
    // Модель должна знать конкретные запреты, а не только ярлык.
    assert.include(p, 'молоко', 'нужно перечислить запрещённое при vegan');
    assert.include(p, 'яйца');
  });

  it('передаёт аллергии с требованием не предлагать их', () => {
    const p = prompt({ allergies: ['рыба', 'яйца'] });
    assert.include(p, 'АЛЛЕРГИИ: рыба, яйца');
    assert.include(p, 'опасны');
  });

  it('передаёт нежелательные продукты как запрет', () => {
    const p = prompt({ foodDislikes: ['грибы', 'лук'] });
    assert.include(p, 'НЕ ПРЕДЛАГАЙ: грибы, лук');
  });

  it('передаёт любимые продукты как пожелание', () => {
    const p = prompt({ foodLikes: ['тофу', 'гречка'] });
    assert.include(p, 'тофу');
    assert.include(p, 'гречка');
  });

  it('передаёт привычки (чашки чая и число приёмов пищи)', () => {
    const p = prompt({ foodHabits: { teaCupsPerDay: 2, mealsPerDay: 4 } });
    assert.include(p, '2 чашк');
    assert.include(p, '4 приёма пищи');
  });

  it('игнорирует мусорные значения привычек', () => {
    const p = prompt({ foodHabits: { teaCupsPerDay: 'abc', mealsPerDay: 99 } });
    assert.notInclude(p, 'ПРИВЫЧКИ');
  });

  it('без ограничений явно сообщает об этом', () => {
    const p = prompt();
    assert.include(p, 'Особых ограничений нет');
    assert.include(p, 'Тип питания: без ограничений');
  });

  it('содержит историю диалога и язык ответа', () => {
    const p = prompt();
    assert.include(p, 'USER: Что съесть на завтрак?');
    assert.include(p, 'только на русском');
  });

  it('запрещает предлагать аллергены при любых обстоятельствах', () => {
    const p = prompt({ allergies: ['арахис'] });
    assert.include(p, 'ни при каких обстоятельствах');
  });

  it('пустые строки в списках не ломают промт', () => {
    const p = prompt({ dietaryRestrictions: ['', '  '], allergies: [''] });
    assert.include(p, 'Тип питания: без ограничений');
  });
});
