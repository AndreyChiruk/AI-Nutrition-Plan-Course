import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op, Transaction } from 'sequelize';
import { TrainingBlock } from '../models/TrainingBlock';
import { User } from '../models/User';
import { WorkoutPlan } from '../models/WorkoutPlan';
import { WorkoutPlanDay } from '../models/WorkoutPlanDay';
import { recoverDeep } from '../common/text-recovery.util';
import { MAX_PLAN_DAYS } from '../meal-plan/meal-plan.service';

export type WorkoutSessionSnapshot = {
  blockId?: string;
  title: string;
  description: string;
  durationMin: number;
  exercises: string[];
  slot: 'session1' | 'session2' | 'session3' | 'session4';
};

export type SaveWorkoutDayDto = {
  dayNumber: number;
  session1: WorkoutSessionSnapshot | null;
  session2: WorkoutSessionSnapshot | null;
  session3: WorkoutSessionSnapshot | null;
  session4: WorkoutSessionSnapshot | null;
};

const SESSION_KEYS = ['session1', 'session2', 'session3', 'session4'] as const;
export type WorkoutSessionKey = (typeof SESSION_KEYS)[number];
export type WorkoutSessionTrackStatus = 'done' | 'skipped';

@Injectable()
export class WorkoutPlanService {
  constructor(
    @InjectModel(WorkoutPlan) private readonly workoutPlanModel: typeof WorkoutPlan,
    @InjectModel(WorkoutPlanDay) private readonly workoutPlanDayModel: typeof WorkoutPlanDay,
    @InjectModel(User) private readonly userModel: typeof User,
    @InjectModel(TrainingBlock) private readonly trainingBlockModel: typeof TrainingBlock,
  ) {}

  private uid(userId: string) {
    return Number(userId);
  }

  private minskDateYmd(date = new Date()): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Minsk',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  }

  private minskDayStart(date = new Date()): Date {
    return new Date(`${this.minskDateYmd(date)}T00:00:00+03:00`);
  }

  private formatRuDateTimeMinsk(date = new Date()): string {
    const fmt = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Minsk',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = fmt.formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`;
  }

  private sanitizePlanBaseName(raw: string | null | undefined): string {
    let s = (raw ?? '').trim();
    if (!s) return 'Без названия';
    for (let i = 0; i < 8; i++) {
      const before = s;
      s = s
        .replace(/^копия\s+от\s\d{1,2}\.\d{1,2}\.\d{4}\s+\d{1,2}:\d{2}\s*[—\-]\s*/i, '')
        .replace(/^копия\s*:\s*/i, '')
        .trim();
      if (s === before) break;
    }
    return s || 'Без названия';
  }

  private clonePlanDisplayName(srcName: string | null | undefined, createdAt: Date): string {
    const base = this.sanitizePlanBaseName(srcName ?? undefined);
    return `Копия от ${this.formatRuDateTimeMinsk(createdAt)} — ${base}`;
  }

  private async runInTx<T>(fn: (t?: Transaction) => Promise<T>): Promise<T> {
    const seq = this.workoutPlanModel.sequelize;
    if (seq?.transaction) {
      return seq.transaction(fn);
    }
    return fn(undefined);
  }

  private async cancelActive(userId: string, t?: Transaction) {
    await this.workoutPlanModel.update(
      { status: 'cancelled' },
      { where: { userId: this.uid(userId), status: 'active' }, ...(t ? { transaction: t } : {}) },
    );
  }

  snapshotFromBlock(b: TrainingBlock): WorkoutSessionSnapshot {
    // Восстанавливаем текст, если он пришёл с нарушенной кодировкой.
    // Раньше снапшоты сохранялись как есть, поэтому в session2 попадали
    // строки вида «╨б╤В╨░╨▒╨╕╨╗╤М╨╜╨╛╤Б╤В╤М ╨║╨╛╨╗╨╡╨╜╨░» вместо
    // «Стабильность колена». Функция безопасна: корректный текст не меняется.
    return recoverDeep({
      blockId: b.id,
      title: b.title,
      description: b.description,
      durationMin: b.durationMin,
      exercises: b.exercises ?? [],
      slot: b.slot as WorkoutSessionSnapshot['slot'],
    });
  }

  async listBlocks(slot?: WorkoutSessionSnapshot['slot']) {
    const where = slot ? { slot } : {};
    return this.trainingBlockModel.findAll({
      where,
      order: [['title', 'ASC']],
    });
  }

  async generatePlan(userId: string, durationDays: number) {
    this.assertDuration(durationDays);
    const user = await this.userModel.findByPk(this.uid(userId));
    if (!user) throw new NotFoundException('User not found');

    const [s1, s2, s3, s4] = await Promise.all([
      this.trainingBlockModel.findAll({ where: { slot: 'session1' } }),
      this.trainingBlockModel.findAll({ where: { slot: 'session2' } }),
      this.trainingBlockModel.findAll({ where: { slot: 'session3' } }),
      this.trainingBlockModel.findAll({ where: { slot: 'session4' } }),
    ]);

    const pick = (blocks: TrainingBlock[], i: number) => {
      if (blocks.length === 0) {
        return null;
      }
      return this.snapshotFromBlock(blocks[i % blocks.length]);
    };

    const days: SaveWorkoutDayDto[] = Array.from({ length: durationDays }).map((_, index) => ({
      dayNumber: index + 1,
      session1: pick(s1, index),
      session2: pick(s2, index + 1),
      session3: pick(s3, index + 2),
      session4: pick(s4, index + 3),
    }));

    const label = `Автотрен ${this.formatRuDateTimeMinsk(new Date())}`;
    return this.saveUserPlan(userId, { durationDays, days, name: label });
  }

  /**
   * Тот же предел, что и у плана питания.
   *
   * Раньше длительность приходила из тела запроса без проверки вообще:
   * `durationDays: 100000` создавал план с сотней тысяч строк дней,
   * а отрицательное значение ломало endDate. Проверка стоит до
   * `cancelActive`, чтобы отклонённый запрос не снял текущий план.
   */
  private assertDuration(durationDays: number) {
    if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > MAX_PLAN_DAYS) {
      throw new BadRequestException(`Длительность плана должна быть от 1 до ${MAX_PLAN_DAYS} дней`);
    }
  }

  async saveUserPlan(
    userId: string,
    dto: { durationDays: number; days: SaveWorkoutDayDto[]; name?: string },
  ) {
    const user = await this.userModel.findByPk(this.uid(userId));
    this.assertDuration(dto.durationDays);
    if (!user) throw new NotFoundException('User not found');

    const startDate = this.minskDayStart();
    const endDate = new Date(startDate);
    endDate.setUTCDate(endDate.getUTCDate() + dto.durationDays - 1);
    const defaultName = `План тренировок ${this.formatRuDateTimeMinsk(new Date())}`;

    await this.runInTx(async (t) => {
      await this.cancelActive(userId, t);

      const plan = await this.workoutPlanModel.create(
        {
          userId: this.uid(userId),
          startDate,
          endDate,
          durationDays: dto.durationDays,
          name: dto.name ?? defaultName,
          trackingStartedAt: null,
          status: 'active',
        } as never,
        t ? { transaction: t } : {},
      );

      const rows = dto.days.map((d) => {
        const date = new Date(startDate);
        date.setUTCDate(date.getUTCDate() + d.dayNumber - 1);
        return {
          workoutPlanId: plan.id,
          dayNumber: d.dayNumber,
          date,
          session1: d.session1,
          session2: d.session2,
          session3: d.session3,
          session4: d.session4,
          sessionStatuses: {},
        };
      });

      // Страховка на запись: восстанавливаем кодировку во всех снапшотах дня.
      await this.workoutPlanDayModel.bulkCreate(
        recoverDeep(rows) as never,
        t ? { transaction: t } : {},
      );
    });

    return this.getActivePlan(userId);
  }

  getActivePlan(userId: string) {
    return this.workoutPlanModel.findOne({
      where: { userId: this.uid(userId), status: 'active' },
      include: [WorkoutPlanDay],
      order: [['days', 'dayNumber', 'ASC']],
    });
  }

  async listUserPlans(userId: string) {
    return this.workoutPlanModel.findAll({
      where: {
        userId: this.uid(userId),
        status: { [Op.in]: ['active', 'completed', 'cancelled'] },
      },
      order: [['updatedAt', 'DESC']],
      attributes: [
        'id',
        'name',
        'startDate',
        'endDate',
        'durationDays',
        'status',
        'trackingStartedAt',
        'createdAt',
        'updatedAt',
      ],
    });
  }

  async getPlanById(userId: string, planId: string) {
    const plan = await this.workoutPlanModel.findOne({
      where: { id: planId, userId: this.uid(userId) },
      include: [WorkoutPlanDay],
      order: [['days', 'dayNumber', 'ASC']],
    });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async deletePlan(userId: string, planId: string) {
    const plan = await this.workoutPlanModel.findOne({
      where: { id: planId, userId: this.uid(userId) },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    await this.runInTx(async (t) => {
      await this.workoutPlanDayModel.destroy({
        where: { workoutPlanId: planId },
        ...(t ? { transaction: t } : {}),
      });
      await plan.destroy(t ? { transaction: t } : {});
    });
    return { ok: true };
  }

  async activatePlan(userId: string, planId: string) {
    const plan = await this.getPlanById(userId, planId);
    if (plan.status === 'active') {
      return this.getPlanById(userId, planId);
    }
    await this.runInTx(async (t) => {
      await this.cancelActive(userId, t);
      await plan.update({ status: 'active' } as never, t ? { transaction: t } : {});
    });
    return this.getPlanById(userId, planId);
  }

  async clonePlan(userId: string, planId: string, startDateIso?: string) {
    const src = await this.getPlanById(userId, planId);
    const start = startDateIso ? this.minskDayStart(new Date(startDateIso)) : this.minskDayStart();
    const createdStamp = new Date();
    const name = this.clonePlanDisplayName(src.name, createdStamp);
    const endDate = new Date(start);
    endDate.setUTCDate(endDate.getUTCDate() + src.durationDays - 1);

    const newPlanId = await this.runInTx(async (t) => {
      const plan = await this.workoutPlanModel.create(
        {
          userId: this.uid(userId),
          startDate: start,
          endDate,
          durationDays: src.durationDays,
          name,
          trackingStartedAt: null,
          status: 'cancelled',
        } as never,
        t ? { transaction: t } : {},
      );

      const rows = (src.days ?? []).map((row) => {
        const date = new Date(start);
        date.setUTCDate(date.getUTCDate() + row.dayNumber - 1);
        return {
          workoutPlanId: plan.id,
          dayNumber: row.dayNumber,
          date,
          session1: row.session1,
          session2: row.session2,
          session3: row.session3,
          session4: row.session4,
          sessionStatuses: {},
        };
      });
      // Страховка на запись: восстанавливаем кодировку во всех снапшотах дня.
      await this.workoutPlanDayModel.bulkCreate(
        recoverDeep(rows) as never,
        t ? { transaction: t } : {},
      );
      return plan.id;
    });

    return this.getPlanById(userId, newPlanId);
  }

  async startTracking(userId: string, planId: string) {
    const plan = await this.getPlanById(userId, planId);
    if (plan.status !== 'active') {
      throw new NotFoundException('Сначала выберите план как активный');
    }
    await plan.update({ trackingStartedAt: new Date() } as never);
    return this.getPlanById(userId, planId);
  }

  async updateDaySessionStatuses(
    userId: string,
    dayId: string,
    body: Partial<Record<WorkoutSessionKey, WorkoutSessionTrackStatus | null>>,
  ) {
    const day = await this.workoutPlanDayModel.findOne({
      where: { id: dayId },
      include: [
        { model: WorkoutPlan, as: 'workoutPlan', where: { userId: this.uid(userId) }, required: true },
      ],
    });
    if (!day) {
      throw new NotFoundException('Day not found');
    }
    const raw = (day.sessionStatuses ?? {}) as Record<string, 'done' | 'skipped'>;
    const next: Record<string, 'done' | 'skipped'> = { ...raw };
    for (const k of SESSION_KEYS) {
      if (!(k in body)) continue;
      const v = body[k];
      if (v === null || v === undefined) {
        delete next[k];
      } else if (v === 'done' || v === 'skipped') {
        next[k] = v;
      }
    }
    await day.update({ sessionStatuses: next } as never);
    return day;
  }

  private allScheduledSlotsMarked(plan: WorkoutPlan & { days?: WorkoutPlanDay[] }): boolean {
    if (!plan.days?.length) return true;
    for (const d of plan.days) {
      const st = (d.sessionStatuses ?? {}) as Record<string, 'done' | 'skipped'>;
      for (const key of SESSION_KEYS) {
        const col = d[key] as { title?: string } | null | undefined;
        if (col == null || typeof col !== 'object' || !String(col.title ?? '').trim()) {
          continue;
        }
        if (st[key] !== 'done' && st[key] !== 'skipped') {
          return false;
        }
      }
    }
    return true;
  }

  async completeTracking(userId: string, planId: string, early: boolean) {
    const plan = await this.getPlanById(userId, planId);
    if (plan.status !== 'active') {
      throw new BadRequestException('Можно завершить только активный план');
    }
    if (!plan.trackingStartedAt) {
      throw new BadRequestException('Сначала начните учёт тренировок');
    }
    if (!early && !this.allScheduledSlotsMarked(plan)) {
      throw new BadRequestException(
        'Не все тренировки отмечены. Отметьте каждую (выполнено/пропуск) или используйте «Завершить досрочно».',
      );
    }
    await plan.update({ status: 'completed' } as never);
    return this.getPlanById(userId, planId);
  }

  buildTrackingSummary(
    plan: { endDate: Date; days?: WorkoutPlanDay[]; status: string } | null,
  ) {
    if (!plan?.days?.length) {
      return { done: 0, skipped: 0, scheduled: 0, planEnded: false, planCompleted: false };
    }
    const end = new Date(plan.endDate);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);
    const planEnded = end < today;
    let done = 0;
    let skipped = 0;
    let scheduled = 0;
    for (const d of plan.days) {
      const st = (d.sessionStatuses ?? {}) as Record<string, 'done' | 'skipped'>;
      for (const key of SESSION_KEYS) {
        const col = d[key] as { title?: string } | null | undefined;
        if (col == null || typeof col !== 'object' || !String(col.title ?? '').trim()) {
          continue;
        }
        scheduled += 1;
        if (st[key] === 'done') done += 1;
        else if (st[key] === 'skipped') skipped += 1;
      }
    }
    return { done, skipped, scheduled, planEnded, planCompleted: plan.status === 'completed' || planEnded };
  }
}
