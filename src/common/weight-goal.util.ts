export type Goal = 'lose' | 'maintain' | 'gain';

export type WeightBand = 'under' | 'normal' | 'over';

export function idealWeightRangeByHeight(heightCm: number): { min: number; max: number } {
  const h = Math.max(0.5, Number(heightCm) / 100);
  return {
    min: 18.5 * h * h,
    max: 24.9 * h * h,
  };
}

export function detectWeightBand(weightKg: number, heightCm: number): WeightBand {
  const { min, max } = idealWeightRangeByHeight(heightCm);
  if (Number(weightKg) < min) return 'under';
  if (Number(weightKg) > max) return 'over';
  return 'normal';
}


export function normalizeGoalByWeight(
  requestedGoal: Goal,
  weightKg: number,
  heightCm: number,
): Goal {
  const band = detectWeightBand(weightKg, heightCm);
  if (band === 'under') return requestedGoal === 'lose' ? 'gain' : requestedGoal;
  if (band === 'over') return requestedGoal === 'gain' ? 'lose' : requestedGoal;
  return requestedGoal;
}
