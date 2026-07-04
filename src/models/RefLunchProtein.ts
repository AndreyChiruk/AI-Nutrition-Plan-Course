import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ref_lunch_proteins', timestamps: false })
export class RefLunchProtein extends Model<RefLunchProtein> {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(200), allowNull: false })
  declare name: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_index' })
  declare sortIndex: number;
}
