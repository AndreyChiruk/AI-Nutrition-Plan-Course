import { BelongsTo, Column, DataType, ForeignKey, Model, Table } from 'sequelize-typescript';
import { User } from './User';
import { Ingredient } from './Ingredient';

@Table({
  tableName: 'fridge_items',
  timestamps: true,
})
export class FridgeItem extends Model<FridgeItem> {
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
    type: DataType.STRING(120),
    allowNull: false,
  })
  declare name: string;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 100,
  })
  declare quantity: number;

  @Column({
    type: DataType.STRING(24),
    allowNull: false,
    defaultValue: 'г',
  })
  declare unit: string;

  @ForeignKey(() => Ingredient)
  @Column({
    type: DataType.UUID,
    allowNull: true,
    field: 'ingredient_id',
  })
  declare ingredientId: string | null;

  @Column({
    type: DataType.DATE,
    allowNull: true,
  })
  declare expiresAt: Date | null;

  @BelongsTo(() => User)
  declare user: User;

  @BelongsTo(() => Ingredient)
  declare ingredient: Ingredient | null;
}
