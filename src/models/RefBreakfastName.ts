import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ref_breakfast_names', timestamps: false })
export class RefBreakfastName extends Model<RefBreakfastName> {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(240), allowNull: false, field: 'base_name' })
  declare baseName: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_index' })
  declare sortIndex: number;
}
