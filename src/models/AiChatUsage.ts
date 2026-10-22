import {
  BelongsTo,
  Column,
  DataType,
  ForeignKey,
  Model,
  Table,
} from 'sequelize-typescript';
import { User } from './User';

/**
 * Учёт бесплатных сообщений в AI-чате.
 *
 * Пользователям без подписки доступно ограниченное число сообщений
 * в день. Счётчик хранится по дням, поэтому одна запись на пару
 * (пользователь, дата) — ограничение UNIQUE в БД.
 *
 * Отдельная таблица, а не поле в `users`: нужна история по дням,
 * иначе сброс счётчика потребовал бы фоновой задачи по расписанию.
 */
@Table({
  tableName: 'ai_chat_usage',
  timestamps: false,
  indexes: [
    {
      name: 'ai_chat_usage_user_date_key',
      unique: true,
      fields: ['user_id', 'date'],
    },
  ],
})
export class AiChatUsage extends Model<AiChatUsage> {
  @Column({
    type: DataType.UUID,
    primaryKey: true,
    defaultValue: DataType.UUIDV4,
  })
  declare id: string;

  @ForeignKey(() => User)
  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    field: 'user_id',
  })
  declare userId: number;

  @Column({
    type: DataType.DATEONLY,
    allowNull: false,
    field: 'date',
  })
  declare date: string;

  @Column({
    type: DataType.INTEGER,
    allowNull: false,
    defaultValue: 0,
    field: 'messages_count',
  })
  declare messagesCount: number;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  declare user: User;
}
