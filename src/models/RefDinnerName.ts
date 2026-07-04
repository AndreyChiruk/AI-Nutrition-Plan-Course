import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ref_dinner_names', timestamps: false })
export class RefDinnerName extends Model<RefDinnerName> {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(300), allowNull: false })
  declare name: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_index' })
  declare sortIndex: number;
}
