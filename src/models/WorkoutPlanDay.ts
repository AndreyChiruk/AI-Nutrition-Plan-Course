import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { WorkoutPlan } from './WorkoutPlan';

@Table({
  tableName: 'workout_plan_days',
  timestamps: true,
})
export class WorkoutPlanDay extends Model<WorkoutPlanDay> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => WorkoutPlan)
  @Column({ type: DataType.UUID, allowNull: false })
  declare workoutPlanId: string;

  @Column({ type: DataType.INTEGER, allowNull: false })
  declare dayNumber: number;

  @Column({ type: DataType.DATE, allowNull: false })
  declare date: Date;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare session1?: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare session2?: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare session3?: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: true })
  declare session4?: Record<string, unknown> | null;

  @Column({ type: DataType.JSONB, allowNull: false, defaultValue: {}, field: 'session_statuses' })
  declare sessionStatuses: Record<string, 'done' | 'skipped'>;

  @BelongsTo(() => WorkoutPlan, { onDelete: 'CASCADE' })
  declare workoutPlan: WorkoutPlan;
}
