import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './User';

export type ChatRole = 'user' | 'assistant' | 'system';

@Table({
  tableName: 'chat_messages',
  timestamps: true,
  updatedAt: false,
})
export class ChatMessage extends Model<ChatMessage> {
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
    type: DataType.ENUM('user', 'assistant', 'system'),
    allowNull: false,
  })
  declare role: ChatRole;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare content: string;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  declare user: User;
}
