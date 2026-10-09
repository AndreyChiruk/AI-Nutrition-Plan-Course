import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import type Stripe from 'stripe';
import { Subscription, type SubscriptionStatus } from '../models/Subscription';
import { AiChatUsage } from '../models/AiChatUsage';
import { User } from '../models/User';
import {
  stripe,
  stripePriceIdMonthly,
  stripeConfigError,
  appUrl,
} from '../config/stripe';

/** Сколько сообщений в AI-чате доступно без подписки за день. */
export const FREE_CHAT_MESSAGES_PER_DAY = 3;

/** Снимок состояния подписки для интерфейса. */
export type SubscriptionSnapshot = {
  status: SubscriptionStatus;
  isActive: boolean;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  /** Остаток бесплатных сообщений в чате (для пользователей без подписки). */
  chatMessagesLeft: number | null;
};

@Injectable()
export class SubscriptionService {
  private readonly logger = new Logger(SubscriptionService.name);

  constructor(
    @InjectModel(Subscription)
    private readonly subscriptionModel: typeof Subscription,
    @InjectModel(AiChatUsage)
    private readonly chatUsageModel: typeof AiChatUsage,
    @InjectModel(User)
    private readonly userModel: typeof User,
  ) {}

  /** Запись подписки пользователя или null. */
  private find(userId: number | string): Promise<Subscription | null> {
    return this.subscriptionModel.findOne({
      where: { userId: Number(userId) },
    });
  }

  /**
   * Состояние подписки для интерфейса.
   *
   * Если записи нет, возвращается `none` — так выглядит пользователь,
   * который ещё не оформлял подписку. Создавать запись заранее не нужно.
   */
  async snapshot(userId: number | string): Promise<SubscriptionSnapshot> {
    const sub = await this.find(userId);
    const isActive = Boolean(sub?.isActive());

    return {
      status: sub?.status ?? 'none',
      isActive,
      currentPeriodEnd: sub?.currentPeriodEnd
        ? new Date(sub.currentPeriodEnd).toISOString()
        : null,
      cancelAtPeriodEnd: Boolean(sub?.cancelAtPeriodEnd),
      chatMessagesLeft: isActive ? null : await this.chatMessagesLeft(userId),
    };
  }

  /** Действует ли подписка — используется middleware. */
  async isActive(userId: number | string): Promise<boolean> {
    const sub = await this.find(userId);
    return Boolean(sub?.isActive());
  }

  /**
   * Находит или создаёт покупателя в Stripe.
   *
   * `metadata.userId` позволяет восстановить связь, если вебхук
   * придёт раньше, чем мы сохраним `stripeCustomerId`.
   */
  private async ensureCustomer(user: User): Promise<string> {
    const existing = await this.find(user.id);
    if (existing?.stripeCustomerId) return existing.stripeCustomerId;

    if (!stripe) throw new BadRequestException('Платежи недоступны.');

    const customer = await stripe.customers.create({
      email: user.email,
      metadata: { userId: String(user.id) },
    });

    await this.subscriptionModel.upsert({
      userId: user.id,
      stripeCustomerId: customer.id,
      status: 'none',
    } as never);

    return customer.id;
  }

  /**
   * Создаёт сессию оплаты.
   *
   * Возвращает адрес, на который нужно перенаправить пользователя.
   */
  async createCheckoutSession(userId: number | string): Promise<{ url: string }> {
    const configError = stripeConfigError();
    if (configError || !stripe) {
      throw new BadRequestException(configError ?? 'Платежи недоступны.');
    }

    const user = await this.userModel.findByPk(Number(userId));
    if (!user) throw new NotFoundException('Пользователь не найден');

    const customerId = await this.ensureCustomer(user);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: stripePriceIdMonthly, quantity: 1 }],
      success_url: `${appUrl}/profile?subscription=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/profile?subscription=canceled`,
      subscription_data: { metadata: { userId: String(user.id) } },
      // Номер налога не запрашиваем: для тестового режима это лишний шаг.
      allow_promotion_codes: true,
    });

    if (!session.url) {
      throw new BadRequestException('Stripe не вернул ссылку на оплату.');
    }
    return { url: session.url };
  }

  /**
   * Синхронизирует подписку напрямую со Stripe.
   *
   * Нужно, потому что вебхук может не дойти: при локальной разработке
   * `stripe listen` не всегда запущен, а в проде событие может потеряться
   * при сетевой ошибке. Без этой проверки пользователь оплачивал
   * подписку, но доступ не открывался — именно так и происходило.
   *
   * Вызывается при возврате со Stripe (`?subscription=success`)
   * и из статуса, если подписки ещё нет.
   */
  async syncFromStripe(userId: number | string): Promise<SubscriptionSnapshot> {
    if (!stripe) return this.snapshot(userId);

    const sub = await this.find(userId);
    if (!sub?.stripeCustomerId) return this.snapshot(userId);

    try {
      // Берём все подписки покупателя: у пользователя может быть
      // несколько попыток оплаты, активной окажется только одна.
      const list = await stripe.subscriptions.list({
        customer: sub.stripeCustomerId,
        status: 'all',
        limit: 10,
      });

      const active =
        list.data.find((s) => s.status === 'active' || s.status === 'trialing') ??
        list.data[0];

      if (!active) return this.snapshot(userId);

      await this.upsertForUser(Number(userId), {
        stripeSubscriptionId: active.id,
        status: this.normalizeStatus(active.status),
        currentPeriodEnd: this.periodEndOf(active),
        cancelAtPeriodEnd: Boolean(active.cancel_at_period_end),
      });
    } catch (e) {
      // Ошибка Stripe не должна ломать страницу: отдаём текущее
      // состояние из БД и логируем причину.
      this.logger.warn(`Не удалось синхронизировать подписку: ${String(e)}`);
    }

    return this.snapshot(userId);
  }

  /** Ссылка на портал управления подпиской (отмена, смена карты). */
  async createPortalSession(userId: number | string): Promise<{ url: string }> {
    if (!stripe) throw new BadRequestException('Платежи недоступны.');

    const sub = await this.find(userId);
    if (!sub?.stripeCustomerId) {
      throw new BadRequestException('Подписка ещё не оформлена.');
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: sub.stripeCustomerId,
      return_url: `${appUrl}/profile`,
    });
    return { url: session.url };
  }

  // ─── Учёт бесплатных сообщений в чате ───────────────────────────────────

  /** Сколько сообщений осталось сегодня. */
  private async chatMessagesLeft(userId: number | string): Promise<number> {
    const row = await this.chatUsageModel.findOne({
      where: { userId: Number(userId), date: this.today() },
    });
    const used = row?.messagesCount ?? 0;
    return Math.max(0, FREE_CHAT_MESSAGES_PER_DAY - used);
  }

  /** Сегодняшняя дата в формате YYYY-MM-DD. */
  private today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  /**
   * Проверяет и расходует бесплатное сообщение.
   *
   * Для активной подписки лимита нет. Иначе счётчик за сегодня
   * увеличивается; при исчерпании возвращается false.
   *
   * Инкремент идёт атомарным запросом, иначе два одновременных
   * сообщения могли бы прочитать одно значение и оба пройти.
   */
  async consumeChatMessage(
    userId: number | string,
  ): Promise<{ allowed: boolean; left: number }> {
    if (await this.isActive(userId)) {
      return { allowed: true, left: -1 };
    }

    const uid = Number(userId);
    const date = this.today();

    const [row] = await this.chatUsageModel.findOrCreate({
      where: { userId: uid, date },
      defaults: { userId: uid, date, messagesCount: 0 } as never,
    });

    if ((row.messagesCount ?? 0) >= FREE_CHAT_MESSAGES_PER_DAY) {
      return { allowed: false, left: 0 };
    }

    // Атомарное увеличение: условие в WHERE не даёт превысить лимит
    // при параллельных запросах.
    const [affected] = await this.chatUsageModel.update(
      { messagesCount: (row.messagesCount ?? 0) + 1 } as never,
      {
        where: {
          userId: uid,
          date,
          messagesCount: { [Op.lt]: FREE_CHAT_MESSAGES_PER_DAY },
        },
      },
    );

    if (affected === 0) return { allowed: false, left: 0 };

    const used = (row.messagesCount ?? 0) + 1;
    return { allowed: true, left: Math.max(0, FREE_CHAT_MESSAGES_PER_DAY - used) };
  }

  // ─── Обработка вебхуков ─────────────────────────────────────────────────

  /** Приводит статус Stripe к нашему набору значений. */
  private normalizeStatus(raw: string): SubscriptionStatus {
    const allowed: SubscriptionStatus[] = [
      'active',
      'past_due',
      'canceled',
      'incomplete',
      'trialing',
      'unpaid',
    ];
    const value = String(raw ?? '').toLowerCase() as SubscriptionStatus;
    return allowed.includes(value) ? value : 'none';
  }

  /**
   * Применяет событие Stripe к подписке пользователя.
   *
   * Возвращает true, если запись найдена и обновлена. События
   * неизвестных покупателей игнорируются: Stripe может прислать
   * события из другого окружения.
   */
  async applyStripeEvent(event: Stripe.Event): Promise<boolean> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId = String(session.customer ?? '');
        if (!customerId) return false;

        const userId = await this.resolveUserId(customerId, session.metadata?.userId);
        if (!userId) return false;

        // Дата окончания приходит только в объекте подписки.
        let periodEnd: Date | null = null;
        let status: SubscriptionStatus = 'active';
        const subId = String(session.subscription ?? '');

        if (subId && stripe) {
          try {
            const sub = await stripe.subscriptions.retrieve(subId);
            periodEnd = this.periodEndOf(sub);
            status = this.normalizeStatus(sub.status);
          } catch (e) {
            this.logger.warn(`Не удалось получить подписку ${subId}: ${String(e)}`);
          }
        }

        await this.upsertForUser(userId, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: subId || null,
          status,
          currentPeriodEnd: periodEnd,
        });
        return true;
      }

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const customerId = String(sub.customer ?? '');
        const userId = await this.resolveUserId(customerId, sub.metadata?.userId);
        if (!userId) return false;

        const deleted = event.type === 'customer.subscription.deleted';
        await this.upsertForUser(userId, {
          stripeCustomerId: customerId,
          stripeSubscriptionId: sub.id,
          status: deleted ? 'canceled' : this.normalizeStatus(sub.status),
          currentPeriodEnd: deleted ? null : this.periodEndOf(sub),
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        });
        return true;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = String(invoice.customer ?? '');
        const userId = await this.resolveUserId(customerId);
        if (!userId) return false;

        await this.upsertForUser(userId, { status: 'past_due' });
        return true;
      }

      default:
        // Остальные события не влияют на доступ к функциям.
        return false;
    }
  }

  /**
   * Дата окончания периода.
   *
   * В разных версиях API поле лежит либо в самой подписке, либо
   * в первом элементе `items`. Проверяем оба варианта.
   */
  private periodEndOf(sub: Stripe.Subscription): Date | null {
    const direct = (sub as unknown as { current_period_end?: number }).current_period_end;
    const fromItem = sub.items?.data?.[0] as unknown as
      | { current_period_end?: number }
      | undefined;
    const seconds = direct ?? fromItem?.current_period_end;
    return seconds ? new Date(seconds * 1000) : null;
  }

  /** Находит нашего пользователя по покупателю Stripe. */
  private async resolveUserId(
    customerId: string,
    metaUserId?: string | null,
  ): Promise<number | null> {
    if (customerId) {
      const row = await this.subscriptionModel.findOne({
        where: { stripeCustomerId: customerId },
        attributes: ['userId'],
      });
      if (row) return row.userId;
    }

    // Запасной путь: идентификатор из метаданных. Нужен, если вебхук
    // пришёл раньше, чем мы успели сохранить customerId.
    const fromMeta = Number(metaUserId);
    if (Number.isFinite(fromMeta) && fromMeta > 0) {
      const user = await this.userModel.findByPk(fromMeta, { attributes: ['id'] });
      if (user) return user.id;
    }
    return null;
  }

  /** Обновляет или создаёт запись подписки. */
  private async upsertForUser(
    userId: number,
    patch: Partial<{
      stripeCustomerId: string;
      stripeSubscriptionId: string | null;
      status: SubscriptionStatus;
      currentPeriodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }>,
  ): Promise<void> {
    const existing = await this.find(userId);
    if (existing) {
      await existing.update({ ...patch } as never);
      return;
    }
    await this.subscriptionModel.create({ userId, status: 'none', ...patch } as never);
  }
}
