import { Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { Allergen } from './Allergen';
import { User } from './User';

@Table({
  tableName: 'user_allergies',
  timestamps: false,
})
export class UserAllergy extends Model<UserAllergy> {
  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare userId: number;

  @ForeignKey(() => Allergen)
  @Column
  declare allergenId: string;
}
