import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  HasMany,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './User';
import { MealItem } from './MealItem';

export type MealStatus = 'pending' | 'confirmed' | 'rejected' | 'corrected';

@Table({
  tableName: 'meals',
  timestamps: true,
})
export class Meal extends Model<Meal> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
  })
  declare userId: number;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare photoUrl: string;

  @Column({
    type: DataType.DATE,
    allowNull: false,
    defaultValue: DataType.NOW,
  })
  declare recognizedAt: Date;

  @Column({
    type: DataType.ENUM('pending', 'confirmed', 'rejected', 'corrected'),
    allowNull: false,
    defaultValue: 'pending',
  })
  declare status: MealStatus;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 0,
  })
  declare confidence: number;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: true,
  })
  declare correctedByAdminId?: number;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare adminNote?: string;

  @BelongsTo(() => User, 'userId')
  declare user: User;

  @BelongsTo(() => User, 'correctedByAdminId')
  declare correctedByAdmin?: User;

  @HasMany(() => MealItem)
  declare items: MealItem[];
}
