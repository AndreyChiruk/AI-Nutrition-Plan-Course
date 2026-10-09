import { assert } from 'chai';
import { describe, it } from 'mocha';
import { recoverDeep } from '../../common/text-recovery.util';

/**
 * Тесты рекурсивного восстановления текста.
 *
 * Регрессия: `recoverDeep` пересобирал объекты через `Object.entries`,
 * а у `Date` нет собственных перечислимых свойств — дата превращалась
 * в пустой объект `{}`. При записи плана тренировок в БД это давало
 * `invalid input syntax for type timestamp: "Invalid date"` и 500.
 */
describe('recoverDeep: сохранение типов', () => {
  it('Date не превращается в пустой объект', () => {
    // Основная регрессия: раньше здесь получался {} вместо даты.
    const d = new Date('2026-10-09T00:00:00+03:00');
    const result = recoverDeep({ date: d });

    assert.instanceOf(result.date, Date, 'дата должна остаться датой');
    assert.strictEqual(result.date.getTime(), d.getTime(), 'момент времени не изменился');
  });

  it('даты внутри массивов сохраняются', () => {
    const rows = [
      { dayNumber: 1, date: new Date('2026-10-09T00:00:00+03:00') },
      { dayNumber: 2, date: new Date('2026-10-10T00:00:00+03:00') },
    ];
    const result = recoverDeep(rows);

    assert.instanceOf(result[0].date, Date);
    assert.instanceOf(result[1].date, Date);
    assert.strictEqual(result[0].dayNumber, 1);
  });

  it('вложенные объекты и числа не портятся', () => {
    const row = {
      dayNumber: 3,
      date: new Date('2026-10-11T00:00:00+03:00'),
      session1: { title: 'Силовая', durationMin: 45, exercises: ['Жим', 'Тяга'] },
      sessionStatuses: {},
    };
    const result = recoverDeep(row);

    assert.strictEqual(result.session1.title, 'Силовая');
    assert.strictEqual(result.session1.durationMin, 45);
    assert.deepStrictEqual(result.session1.exercises, ['Жим', 'Тяга']);
    assert.instanceOf(result.date, Date);
  });

  it('обычные значения возвращаются как есть', () => {
    assert.strictEqual(recoverDeep(42), 42);
    assert.strictEqual(recoverDeep(true), true);
    assert.strictEqual(recoverDeep(null), null);
    assert.strictEqual(recoverDeep(undefined), undefined);
  });

  it('буферы не пересобираются в объекты', () => {
    // Buffer — тоже объект; без явной проверки он стал бы словарём.
    const buf = Buffer.from('тест', 'utf8');
    const result = recoverDeep({ data: buf });

    assert.isTrue(Buffer.isBuffer(result.data));
    assert.strictEqual(result.data.toString('utf8'), 'тест');
  });

  it('строки проходят через восстановление кодировки', () => {
    // Обычная строка не должна измениться.
    assert.strictEqual(recoverDeep({ name: 'Овсянка' }).name, 'Овсянка');
  });
});
