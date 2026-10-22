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
 * Типы уведомлений.
 * `allergen` — обнаружен аллерген в распознанном блюде (самый важный тип:
 * его нельзя терять, даже если пользователь закрыл страницу).
 */
export type NotificationType = 'allergen' | 'moderation' | 'plan' | 'system';

/** Уровень важности — влияет на оформление в интерфейсе. */
export type NotificationSeverity = 'info' | 'warning' | 'critical';

@Table({
  tableName: 'notifications',
  timestamps: true,
})
export class Notification extends Model<Notification> {
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
    field: 'userId',
  })
  declare userId: number;

  @Column({
    type: DataType.STRING(32),
    allowNull: false,
  })
  declare type: NotificationType;

  @Column({
    type: DataType.STRING(16),
    allowNull: false,
    defaultValue: 'info',
  })
  declare severity: NotificationSeverity;

  @Column({
    type: DataType.STRING(200),
    allowNull: false,
  })
  declare title: string;

  @Column({
    type: DataType.TEXT,
    allowNull: false,
  })
  declare body: string;

  /** Связанное блюдо/приём пищи — чтобы перейти к деталям. */
  @Column({
    type: DataType.UUID,
    allowNull: true,
    field: 'relatedMealId',
  })
  declare relatedMealId: string | null;

  /** Название блюда, к которому относится уведомление. */
  @Column({
    type: DataType.STRING(200),
    allowNull: true,
    field: 'relatedDishName',
  })
  declare relatedDishName: string | null;

  /** Прочитано ли уведомление. */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
  })
  declare isRead: boolean;

  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'readAt',
  })
  declare readAt: Date | null;

  @BelongsTo(() => User, { foreignKey: 'userId', onDelete: 'CASCADE' })
  declare user?: User;
}
