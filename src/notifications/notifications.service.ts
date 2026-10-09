import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { Notification, NotificationSeverity, NotificationType } from '../models/Notification';

/**
 * Уведомления пользователя.
 *
 * Ключевой сценарий — предупреждение об аллергене, обнаруженном при
 * распознавании еды. Раньше такое предупреждение жило только в ответе HTTP:
 * пользователь закрывал страницу, и предупреждение исчезало, хотя риск
 * для здоровья никуда не девался.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @InjectModel(Notification)
    private readonly notificationModel: typeof Notification,
  ) {}

  async create(input: {
    userId: number;
    type: NotificationType;
    title: string;
    body: string;
    severity?: NotificationSeverity;
    relatedMealId?: string | null;
    relatedDishName?: string | null;
  }): Promise<Notification | null> {
    try {
      return await this.notificationModel.create({
        userId: input.userId,
        type: input.type,
        title: input.title.slice(0, 200),
        body: input.body,
        severity: input.severity ?? 'info',
        relatedMealId: input.relatedMealId ?? null,
        relatedDishName: input.relatedDishName?.slice(0, 200) ?? null,
        isRead: false,
      } as never);
    } catch (e) {
      // Неудача в уведомлениях не должна ломать основной сценарий
      // (распознавание еды уже выполнено).
      this.logger.warn(
        `Не удалось сохранить уведомление: ${e instanceof Error ? e.message : String(e)}`,
      );
      return null;
    }
  }

  /**
   * Сохраняет предупреждения об аллергенах, полученные при распознавании.
   *
   * Одно уведомление на блюдо, а не на каждое совпадение: иначе при 3 аллергенах
   * пользователь получал 3 почти одинаковых записи.
   */
  async saveAllergenWarnings(
    userId: number,
    warnings: string[],
    dishName?: string,
    mealId?: string | null,
  ): Promise<number> {
    if (!Array.isArray(warnings) || warnings.length === 0) return 0;

    const list = warnings.filter((w) => String(w ?? '').trim());
    if (list.length === 0) return 0;

    const title = dishName
      ? `Аллерген в блюде «${dishName}»`
      : 'Обнаружен аллерген в распознанном блюде';

    const created = await this.create({
      userId,
      type: 'allergen',
      severity: 'critical',
      title,
      body: list.join('\n'),
      relatedMealId: mealId ?? null,
      relatedDishName: dishName ?? null,
    });

    return created ? 1 : 0;
  }

  async list(
    userId: number,
    opts?: { onlyUnread?: boolean; limit?: number; type?: NotificationType },
  ): Promise<{ items: Notification[]; unreadCount: number }> {
    const where: Record<string, unknown> = { userId };
    if (opts?.onlyUnread) where.isRead = false;
    if (opts?.type) where.type = opts.type;

    const limit = Math.min(Math.max(Number(opts?.limit) || 50, 1), 200);

    const [items, unreadCount] = await Promise.all([
      this.notificationModel.findAll({
        where,
        order: [
          // Сначала критичные, затем свежие.
          ['isRead', 'ASC'],
          ['createdAt', 'DESC'],
        ],
        limit,
      }),
      this.notificationModel.count({ where: { userId, isRead: false } }),
    ]);

    return { items, unreadCount };
  }

  async markRead(userId: number, id: string): Promise<Notification> {
    const row = await this.notificationModel.findOne({ where: { id, userId } });
    if (!row) throw new NotFoundException('Уведомление не найдено');
    if (!row.isRead) {
      await row.update({ isRead: true, readAt: new Date() } as never);
    }
    return row;
  }

  async markAllRead(userId: number): Promise<{ updated: number }> {
    const [updated] = await this.notificationModel.update(
      { isRead: true, readAt: new Date() } as never,
      { where: { userId, isRead: false } },
    );
    return { updated };
  }

  async remove(userId: number, id: string): Promise<{ ok: true }> {
    const deleted = await this.notificationModel.destroy({ where: { id, userId } });
    if (deleted === 0) throw new NotFoundException('Уведомление не найдено');
    return { ok: true };
  }

  /** Удаляет старые прочитанные уведомления (старше 90 дней). */
  async cleanupOld(days = 90): Promise<{ removed: number }> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const removed = await this.notificationModel.destroy({
      where: {
        isRead: true,
        createdAt: { [Op.lt]: cutoff },
      },
    });
    return { removed };
  }
}
