import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'platform_stats',
  timestamps: false,
})
export class PlatformStats extends Model<PlatformStats> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
  })
  declare date: Date;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare totalUsers: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare activeUsers: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare totalMealsRecognized: number;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 0 })
  declare totalMealPlansGenerated: number;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0 })
  declare avgConfidenceScore: number;
}
