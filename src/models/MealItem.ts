import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { Meal } from './Meal';
import type { ProductIngredient, ProductIngredientDetailed } from './Product';

@Table({
  tableName: 'meal_items',
  timestamps: true,
})
export class MealItem extends Model<MealItem> {
  @Column({
    type: DataType.UUID,
    defaultValue: DataType.UUIDV4,
    primaryKey: true,
  })
  declare id: string;

  @ForeignKey(() => Meal)
  @Column({
    type: DataType.UUID,
    allowNull: false,
  })
  declare mealId: string;

  @Column({
    type: DataType.STRING,
    allowNull: false,
  })
  declare foodName: string;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0 })
  declare calories: number;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0 })
  declare protein: number;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0 })
  declare fat: number;

  @Column({ type: DataType.FLOAT, allowNull: false, defaultValue: 0 })
  declare carbs: number;

  @Column({
    type: DataType.FLOAT,
    allowNull: true,
  })
  declare weight?: number;

  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: false,
    defaultValue: [],
  })
  declare allergensFound: string[];

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
  })
  declare ingredients: ProductIngredient[];

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'ingredients_detailed',
  })
  declare ingredientsDetailed: ProductIngredientDetailed[];

  /** Ключи dietary_tags каталога (англ.) */
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'dietary_tags',
  })
  declare dietaryTags: string[];

  @BelongsTo(() => Meal, { onDelete: 'CASCADE' })
  declare meal: Meal;
}
