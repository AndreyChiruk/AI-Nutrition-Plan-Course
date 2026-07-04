import {
  BelongsToMany,
  Column,
  DataType,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './User';
import { UserAllergy } from './UserAllergy';

export type AllergenSeverity = 'mild' | 'moderate' | 'severe';

@Table({
  tableName: 'allergens',
  timestamps: true,
  createdAt: true,
  updatedAt: false,
})
export class Allergen extends Model<Allergen> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
    unique: true,
  })
  declare name: string;

  @Column({
    type: DataType.STRING,
    allowNull: true,
  })
  declare icon?: string;

  @Column({
    type: DataType.ENUM('mild', 'moderate', 'severe'),
    allowNull: false,
    defaultValue: 'moderate',
  })
  declare severity: AllergenSeverity;

  @BelongsToMany(() => User, () => UserAllergy)
  declare users: User[];
}
