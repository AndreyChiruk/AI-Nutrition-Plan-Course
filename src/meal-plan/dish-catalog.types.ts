export type DishSeedRow = {
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergens: string[];
  category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
};
