import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './User';

@Table({
  tableName: 'body_analyses',
  timestamps: true,
})
export class BodyAnalysis extends Model<BodyAnalysis> {
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

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare photoUrl: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare analyzedAt: Date;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare estimatedBodyFat?: number;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare estimatedMuscleMass?: number;

  /** Снимок с профиля на момент анализа (для графиков). */
  @Column({ type: DataType.FLOAT, allowNull: true, field: 'weight_kg' })
  declare weightKg?: number;

  @Column({ type: DataType.FLOAT, allowNull: true, field: 'height_cm' })
  declare heightCm?: number;

  @Column({ type: DataType.FLOAT, allowNull: true })
  declare bmi?: number;

  @Column({ type: DataType.TEXT, allowNull: true })
  declare aiNotes?: string;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  declare user: User;
}
