import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'training_blocks',
  timestamps: true,
})
export class TrainingBlock extends Model<TrainingBlock> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(12),
    allowNull: false,
  })
  declare slot: string;

  @Column({ type: DataType.STRING, allowNull: false })
  declare title: string;

  @Column({ type: DataType.TEXT, allowNull: false })
  declare description: string;

  @Column({ type: DataType.INTEGER, allowNull: false, defaultValue: 30 })
  declare durationMin: number;

  @Column({ type: DataType.ARRAY(DataType.STRING), allowNull: false, defaultValue: [] })
  declare exercises: string[];
}
