import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { MealPlanDay } from './MealPlanDay';
import { User } from './User';

export type MealPlanStatus = 'active' | 'completed' | 'cancelled';

@Table({
  tableName: 'meal_plans',
  timestamps: true,
})
export class MealPlan extends Model<MealPlan> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare userId: number;

  @Column({ type: DataType.DATE, allowNull: false })
  declare startDate: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare endDate: Date;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare durationDays: number;

  @Column({ type: DataType.FLOAT, allowNull: false })
  declare targetCalories: number;

  @Column({ type: DataType.STRING(200), allowNull: true })
  declare name?: string | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'total_calories' })
  declare totalCalories?: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'total_protein' })
  declare totalProtein?: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'total_fat' })
  declare totalFat?: number | null;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'total_carbs' })
  declare totalCarbs?: number | null;

  @Column({
    type: DataType.ENUM('active', 'completed', 'cancelled'),
    allowNull: false,
    defaultValue: 'active',
  })
  declare status: MealPlanStatus;

  @BelongsTo(() => User)
  declare user: User;

  @HasMany(() => MealPlanDay)
  declare days: MealPlanDay[];
}
