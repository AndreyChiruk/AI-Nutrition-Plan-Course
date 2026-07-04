import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ref_lunch_pairs', timestamps: false })
export class RefLunchPair extends Model<RefLunchPair> {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(200), allowNull: false, field: 'protein_part' })
  declare proteinPart: string;

  @Column({ type: DataType.STRING(200), allowNull: false, field: 'garnish_part' })
  declare garnishPart: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_index' })
  declare sortIndex: number;
}
