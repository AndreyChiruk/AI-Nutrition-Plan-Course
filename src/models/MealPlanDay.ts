import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { MealPlan } from './MealPlan';

export type MealSlotSnapshot = {
  dishId?: string;
  name: string;
  calories: number;
  protein: number;
  fat: number;
  carbs: number;
  allergens: string[];
  dietaryTags?: string[];
  category: 'breakfast' | 'lunch' | 'dinner' | 'snack';
  ingredients?: Array<{ name: string; grams: number }>;
  ingredientsDetailed?: Array<{
    id: string;
    name: string;
    amount: number;
    unit: string;
    grams: number;
    originalString?: string;
    ingredientId?: string;
  }>;
  matchKeywords?: string[];
  imageUrl?: string | null;
  note?: string;
  alternatives?: string[];
};

export type MealTrackSlot = 'breakfast' | 'lunch' | 'dinner' | 'snack' | 'snack2';
export type MealTrackStatus = 'done' | 'skipped';

@Table({
  tableName: 'meal_plan_days',
  timestamps: true,
})
export class MealPlanDay extends Model<MealPlanDay> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => MealPlan)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare mealPlanId: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare dayNumber: number;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare date: Date;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare breakfast: MealSlotSnapshot | Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare lunch: MealSlotSnapshot | Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare dinner: MealSlotSnapshot | Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true, field: 'snacks' })
  declare snacks: MealSlotSnapshot[] | null;

  @Column({ type: DataType.JSONB, allowNull: true, field: 'extra_snacks' })
  declare extraSnacks: MealSlotSnapshot[] | null;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'meal_statuses' })
  declare mealStatuses: Record<MealTrackSlot, MealTrackStatus> | Record<string, MealTrackStatus>;

  @BelongsTo(() => MealPlan, { onDelete: 'CASCADE' })
  declare mealPlan: MealPlan;
}
