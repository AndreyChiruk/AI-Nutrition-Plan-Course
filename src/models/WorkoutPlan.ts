import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './User';
import { WorkoutPlanDay } from './WorkoutPlanDay';

export type WorkoutPlanStatus = 'active' | 'completed' | 'cancelled';

@Table({
  tableName: 'workout_plans',
  timestamps: true,
})
export class WorkoutPlan extends Model<WorkoutPlan> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({ type: DataType.INTEGER, allowNull: false })
  declare userId: number;

  @Column({ type: DataType.DATE, allowNull: false })
  declare startDate: Date;

  @Column({ type: DataType.DATE, allowNull: false })
  declare endDate: Date;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare durationDays: number;

  @Column({ type: DataType.STRING(200), allowNull: true })
  declare name: string | null;

  @Column({ type: DataType.DATE, allowNull: true, field: 'tracking_started_at' })
  declare trackingStartedAt: Date | null;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'active',
  })
  declare status: WorkoutPlanStatus;

  @BelongsTo(() => User)
  declare user: User;

  @HasMany(() => WorkoutPlanDay)
  declare days: WorkoutPlanDay[];
}
