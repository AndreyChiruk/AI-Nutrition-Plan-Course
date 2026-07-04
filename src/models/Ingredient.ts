import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({
  tableName: 'ingredients',
  timestamps: true,
})
export class Ingredient extends Model<Ingredient> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING(160),
    allowNull: false,
    unique: true,
  })
  declare name: string;

  @Column({
    type: DataType.STRING(80),
    allowNull: false,
    defaultValue: 'Прочее',
  })
  declare category: string;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'г',
    field: 'default_unit',
  })
  declare defaultUnit: string;

  @Column({
    type: DataType.FLOAT,
    allowNull: true,
    field: 'calories_per_unit',
  })
  declare caloriesPerUnit: number | null;
}
