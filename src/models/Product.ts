import { Column, DataType, Model, Table } from 'sequelize-typescript';

export type ProductIngredient = {
  name: string;
  grams: number;
};

export type ProductIngredientDetailed = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  grams: number;
  originalString?: string;
  ingredientId?: string;
};

export type ProductMatchKeyword = string;

@Table({
  tableName: 'products',
  timestamps: true,
})
export class Product extends Model<Product> {
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
    type: DataType.STRING(24),
    allowNull: false,
    defaultValue: 'other',
  })
  declare category: string;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 0,
  })
  declare calories: number;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 0,
  })
  declare protein: number;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 0,
  })
  declare fat: number;

  @Column({
    type: DataType.FLOAT,
    allowNull: false,
    defaultValue: 0,
  })
  declare carbs: number;

  @Column({
    type: DataType.ARRAY(DataType.STRING),
    allowNull: false,
    defaultValue: [],
  })
  declare allergens: string[];

 
  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'dietary_tags',
  })
  declare dietaryTags: string[];

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
    field: 'match_keywords',
  })
  declare matchKeywords: ProductMatchKeyword[];

  @Column({
    type: DataType.TEXT,
    allowNull: true,
    field: 'image_url',
  })
  declare imageUrl: string | null;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
  })
  declare description: string | null;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 1,
  })
  declare servings: number;

  @Column({
    type: DataType.INTEGER,
    allowNull: true,
    field: 'cooking_time_min',
  })
  declare cookingTimeMin: number | null;

  @Column({
    type: DataType.STRING(80),
    allowNull: true,
  })
  declare cuisine: string | null;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'meal_types',
  })
  declare mealTypes: string[];

  /**
   * Содержит ли блюдо алкоголь.
   *
   * Нужно для правила «не предлагать алкоголь пользователям младше 18».
   * В каталоге есть коктейли и блюда с вином или пивом: без этого признака
   * они попадали в план несовершеннолетним.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'contains_alcohol',
  })
  declare containsAlcohol: boolean;

  /**
   * Признак публикации блюда в каталоге.
   *
   * `false` — блюдо отбраковано (например, испорченный состав даёт
   * тысячи килокалорий на порцию). Такие блюда не попадают в планы
   * и не показываются в списке, но остаются в БД для разбора.
   */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: true,
    field: 'is_published',
  })
  declare isPublished: boolean;

  /** Причина снятия с публикации (для администратора). */
  @Column({
    type: DataType.STRING(300),
    allowNull: true,
    field: 'unpublished_reason',
  })
  declare unpublishedReason: string | null;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'is_from_api',
  })
  declare isFromApi: boolean;

  @Column({
    type: DataType.TEXT,
    allowNull: true,
    field: 'source_url',
  })
  declare sourceUrl: string | null;

  @Column({
    type: DataType.STRING(40),
    allowNull: true,
    field: 'source_meal_id',
  })
  declare sourceMealId: string | null;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
    defaultValue: [],
    field: 'ingredients_detailed',
  })
  declare ingredientsDetailed: ProductIngredientDetailed[];
}
