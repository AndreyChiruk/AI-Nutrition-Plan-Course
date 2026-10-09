import {
  BelongsToMany,
  Column,
  DataType,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { BodyAnalysis } from './BodyAnalysis';
import { ChatMessage } from './ChatMessage';
import { Meal } from './Meal';
import { MealPlan } from './MealPlan';
import { Suggestion } from './Suggestion';
import { UserAllergy } from './UserAllergy';
import { Allergen } from './Allergen';
import { FridgeItem } from './FridgeItem';

export type BodyForecastPayloadDb = {
  durationWeeks: number;
  summary: string;
  milestones: Array<{ week: number; note: string }>;
  visualDescription: string;
  disclaimer: string;
  illustrationSource: 'ai' | 'stock';
  lastAnalysisPhotoUrl: string | null;
};

export type UserRole = 'guest' | 'user' | 'admin';
export type Gender = 'male' | 'female';
export type Goal = 'lose' | 'maintain' | 'gain';
export type ActivityLevel =
  | 'sedentary'
  | 'light'
  | 'moderate'
  | 'active'
  | 'very_active';

@Table({
  tableName: 'users',
  timestamps: true,
})
export class User extends Model<User> {
  @Column({
    type: DataType.INTEGER,
    autoIncrement: true,
    primaryKey: true,
  })
  declare id: number;

  /**
   * Имя пользователя.
   *
   * Раньше поля не было вовсе: фронтенд хранил имя в localStorage,
   * поэтому оно не синхронизировалось между устройствами и терялось
   * при очистке хранилища. Отображаемое имя нужно серверу также для
   * писем, уведомлений и админ-панели.
   */
  @Column({
    type: DataType.STRING(120),
    allowNull: true,
  })
  declare name: string | null;

  @Column({
    type: DataType.STRING,
    unique: true,
    allowNull: false,
  })
  declare email: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare password: string;

  @Column({
    type: DataType.ENUM('guest', 'user', 'admin'),
    allowNull: false,
    defaultValue: 'user',
  })
  declare role: UserRole;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 170,
  })
  declare height: number;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 70,
  })
  declare weight: number;

  @Column({
    type: DataType.ENUM('male', 'female'),
    allowNull: false,
    defaultValue: 'male',
  })
  declare gender: Gender;

  @Column({
    type: DataType.DATE,
    allowNull: false,
  })
  declare birthDate: Date;

  @Column({
    type: DataType.ENUM('lose', 'maintain', 'gain'),
    allowNull: false,
    defaultValue: 'maintain',
  })
  declare goal: Goal;

  @Column({
    type: DataType.FLOAT,
    allowNull: true,
  })
  declare targetWeight?: number;

  @Column({
    type: DataType.ENUM(
      'sedentary',
      'light',
      'moderate',
      'active',
      'very_active',
    ),
    allowNull: false,
    defaultValue: 'moderate',
  })
  declare activityLevel: ActivityLevel;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isBlocked: boolean;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare blockedAt?: Date;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare avatarUrl?: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare refreshTokenHash?: string;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'last_active_at',
  })
  declare lastActiveAt?: Date;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'target_calories',
  })
  declare targetCalories?: number;

  @BelongsToMany(() => Allergen, () => UserAllergy)
  declare allergens: Allergen[];

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'dietary_restrictions',
  })
  declare dietaryRestrictions: string[];

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'food_likes',
  })
  declare foodLikes: string[];

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'food_dislikes',
  })
  declare foodDislikes: string[];

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: {},
    field: 'food_habits',
  })
  declare foodHabits: Record<string, unknown>;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'calorie_mode',
  })
  declare calorieMode?: 'precise' | 'approximate' | null;

  @Column({
    type: DataType.STRING,
    allowNull: true,
    field: 'calorie_band',
  })
  declare calorieBand?: 'low' | 'medium' | 'high' | 'sport' | null;

  @Column({ type: DataType.TEXT, allowNull: true, field: 'body_forecast_illustration_url' })
  declare bodyForecastIllustrationUrl?: string | null;

  @Column({ type: DataType.JSONB, allowNull: true, field: 'body_forecast_payload' })
  declare bodyForecastPayload?: BodyForecastPayloadDb | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'body_forecast_at' })
  declare bodyForecastAt?: Date | null;

  @HasMany(() => Meal)
  declare meals: Meal[];

  @HasMany(() => MealPlan)
  declare mealPlans: MealPlan[];

  @HasMany(() => BodyAnalysis)
  declare bodyAnalyses: BodyAnalysis[];

  @HasMany(() => Suggestion)
  declare suggestions: Suggestion[];

  @HasMany(() => ChatMessage)
  declare chatMessages: ChatMessage[];

  @HasMany(() => FridgeItem)
  declare fridgeItems: FridgeItem[];
}
