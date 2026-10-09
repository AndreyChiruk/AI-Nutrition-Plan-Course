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

  /**
   * Изображение продукта.
   *
   * Заполняется из каталога при добавлении, либо загружается
   * пользователем. Для заглушек остаётся NULL — клиент выбирает
   * картинку по категории продукта.
   */
  @Column({
    type: DataType.STRING(500),
    allowNull: true,
    field: 'image_url',
  })
  declare imageUrl: string | null;

  /**
   * Источник изображения: `user`, `catalog` или `placeholder`.
   * Определяет, можно ли удалить картинку и что показать вместо неё.
   */
  @Column({
    type: DataType.ENUM('user', 'catalog', 'placeholder'),
    allowNull: false,
    defaultValue: 'placeholder',
    field: 'image_source',
  })
  declare imageSource: 'user' | 'catalog' | 'placeholder';

  @BelongsTo(() => User)
  declare user: User;

  @BelongsTo(() => Ingredient)
  declare ingredient: Ingredient | null;
}
