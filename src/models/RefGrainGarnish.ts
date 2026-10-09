import { Column, DataType, Model, Table } from 'sequelize-typescript';

@Table({ tableName: 'ref_grain_garnishes', timestamps: false })
export class RefGrainGarnish extends Model<RefGrainGarnish> {
  @Column({ type: DataType.INTEGER, primaryKey: true, autoIncrement: true })
  declare id: number;

  @Column({ type: DataType.STRING(120), allowNull: false })
  declare name: string;

  @Column({ type: DataType.INTEGER, allowNull: false, field: 'sort_index' })
  declare sortIndex: number;
}
