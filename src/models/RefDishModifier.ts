import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ref_dish_modifiers', timestamps: false })
export class RefDishModifier extends Model<RefDishModifier> {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare suffix: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_index' })
  declare sortIndex: number;
}
