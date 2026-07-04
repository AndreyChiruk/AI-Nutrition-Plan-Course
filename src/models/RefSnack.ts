import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ref_snacks', timestamps: false })
export class RefSnack extends Model<RefSnack> {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(300), allowNull: false })
  declare name: string;

  @Column({ type: DataType.ARRAY(DataType.STRING), allowNull: false, defaultValue: [] })
  declare allergens: string[];

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_index' })
  declare sortIndex: number;
}
