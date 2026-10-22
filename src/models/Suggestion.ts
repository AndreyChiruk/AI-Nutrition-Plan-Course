import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './User';

export type SuggestionType = 'meal' | 'workout' | 'general';

@Table({
  tableName: 'suggestions',
  timestamps: true,
  updatedAt: false,
})
export class Suggestion extends Model<Suggestion> {
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
    type: DataType.ENUM('meal', 'workout', 'general'),
    allowNull: false,
  })
  declare type: SuggestionType;

  @Column({
    type: DataType.JSONB,
    allowNull: false,
  })
  declare content: Record<string, unknown>;

  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isRead: boolean;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  declare user: User;
}
