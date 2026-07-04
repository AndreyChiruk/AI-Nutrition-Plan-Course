import { assert } from 'chai';
import { describe, it } from 'mocha';
import {
  detectWeightBand,
  idealWeightRangeByHeight,
  normalizeGoalByWeight,
} from '../../common/weight-goal.util';

describe('weight-goal.util', () => {
  it('idealWeightRangeByHeight даёт разумный диапазон для роста 180 см', () => {
    const r = idealWeightRangeByHeight(180);
    assert.isBelow(r.min, r.max);
    assert.approximately(r.min, 60, 5);
    assert.approximately(r.max, 81, 5);
  });

  it('detectWeightBand: normal при весе внутри диапазона', () => {
    assert.equal(detectWeightBand(75, 180), 'normal');
  });

  it('normalizeGoalByWeight: при недостатке веса запретить цель lose → gain', () => {
    const band = detectWeightBand(50, 180);
    assert.equal(band, 'under');
    assert.equal(normalizeGoalByWeight('lose', 50, 180), 'gain');
    assert.equal(normalizeGoalByWeight('maintain', 50, 180), 'maintain');
  });

  it('normalizeGoalByWeight: при избытке веса запретить цель gain → lose', () => {
    const band = detectWeightBand(110, 180);
    assert.equal(band, 'over');
    assert.equal(normalizeGoalByWeight('gain', 110, 180), 'lose');
    assert.equal(normalizeGoalByWeight('maintain', 110, 180), 'maintain');
  });

  it('normalizeGoalByWeight: в норме сохраняет выбранную цель', () => {
    assert.equal(normalizeGoalByWeight('lose', 75, 180), 'lose');
    assert.equal(normalizeGoalByWeight('gain', 75, 180), 'gain');
  });
});
