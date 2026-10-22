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
 * Подписка пользователя на ИИ-функции.
 *
 * Одна запись на пользователя (ограничение UNIQUE в БД): повторная
 * оплата обновляет существующую подписку, а не создаёт вторую.
 *
 * Поля `stripeCustomerId` и `stripeSubscriptionId` нужны для связи
 * с Stripe: вебхук приходит с объектом Stripe, и по этим полям
 * находится наш пользователь.
 */

/** Статусы подписки: значения Stripe плюс `none` для отсутствующей. */
export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'incomplete'
  | 'trialing'
  | 'unpaid'
  | 'none';

/** Статусы, дающие доступ к функциям (при непросроченном периоде). */
const ACTIVE_STATUSES: SubscriptionStatus[] = ['active', 'trialing'];

/**
 * Действует ли подписка прямо сейчас.
 *
 * Вынесено отдельной функцией, а не только методом модели: логику
 * нужно тестировать без инициализации Sequelize, а экземпляр модели
 * нельзя создать вне подключения к БД.
 *
 * Одного статуса `active` недостаточно: Stripe может не прислать
 * вебхук об окончании периода, поэтому проверяется ещё и дата.
 */
export function isSubscriptionActive(
  status: SubscriptionStatus,
  currentPeriodEnd: Date | string | null,
  now: Date = new Date(),
): boolean {
  if (!ACTIVE_STATUSES.includes(status)) return false;
  if (!currentPeriodEnd) return true;
  const end = new Date(currentPeriodEnd);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() > now.getTime();
}

@Table({
  tableName: 'subscriptions',
  timestamps: true,
  createdAt: 'created_at',
  updatedAt: 'updated_at',
})
export class Subscription extends Model<Subscription> {
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
    unique: true,
    field: 'user_id',
  })
  declare userId: number;

  /** Идентификатор покупателя в Stripe (`cus_...`). */
  @Column({
    type: DataType.STRING(120),
    allowNull: true,
    field: 'stripe_customer_id',
  })
  declare stripeCustomerId: string | null;

  /** Идентификатор подписки в Stripe (`sub_...`). */
  @Column({
    type: DataType.STRING(120),
    allowNull: true,
    field: 'stripe_subscription_id',
  })
  declare stripeSubscriptionId: string | null;

  @Column({
    type: DataType.STRING(20),
    allowNull: false,
    defaultValue: 'none',
  })
  declare status: SubscriptionStatus;

  /** Дата окончания оплаченного периода. */
  @Column({
    type: DataType.DATE,
    allowNull: true,
    field: 'current_period_end',
  })
  declare currentPeriodEnd: Date | null;

  /** Отменит ли Stripe подписку в конце периода. */
  @Column({
    type: DataType.BOOLEAN,
    allowNull: false,
    defaultValue: false,
    field: 'cancel_at_period_end',
  })
  declare cancelAtPeriodEnd: boolean;

  @BelongsTo(() => User, { onDelete: 'CASCADE' })
  declare user: User;

  /**
   * Действует ли подписка прямо сейчас.
   *
   * Одного статуса `active` недостаточно: Stripe может не прислать
   * вебхук об окончании периода, поэтому дополнительно проверяем дату.
   */
  isActive(now: Date = new Date()): boolean {
    return isSubscriptionActive(this.status, this.currentPeriodEnd, now);
  }
}
