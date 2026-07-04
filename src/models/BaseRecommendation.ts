import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'base_recommendations',
  timestamps: true,
})
export class BaseRecommendation extends Model<BaseRecommendation> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare title: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare description: string;

  @Column({
    type: DataType.ENUM('nutrition', 'activity', 'habits', 'sleep'),
    allowNull: false,
    defaultValue: 'nutrition',
  })
  declare category: 'nutrition' | 'activity' | 'habits' | 'sleep';

  @Column({
    type: DataType.STRING,
    allowNull: false,
    defaultValue: 'all',
  })
  declare audience: string;
}
