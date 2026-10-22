import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { Op } from 'sequelize';
import { BodyAnalysis } from '../models/BodyAnalysis';
import { Meal } from '../models/Meal';
import { MealItem } from '../models/MealItem';
import { MealPlan } from '../models/MealPlan';
import { User } from '../models/User';
import { WorkoutPlan } from '../models/WorkoutPlan';

@Injectable()
export class StatsService {
  constructor(
    @InjectModel(Meal) private readonly mealModel: typeof Meal,
    @InjectModel(MealPlan) private readonly mealPlanModel: typeof MealPlan,
    @InjectModel(WorkoutPlan) private readonly workoutPlanModel: typeof WorkoutPlan,
    @InjectModel(BodyAnalysis) private readonly bodyAnalysisModel: typeof BodyAnalysis,
    @InjectModel(User) private readonly userModel: typeof User,
  ) {}

  private uid(userId: string) {
    return Number(userId);
  }

  private bmiFrom(weightKg: number, heightCm: number): number | null {
    if (!heightCm || heightCm <= 0) return null;
    return Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10;
  }

  async userStatsSummary(userId: string) {
    const uid = this.uid(userId);
    const [mealPlansCount, workoutPlansCount, foodRecognitionCount] = await Promise.all([
      this.mealPlanModel.count({ where: { userId: uid } }),
      this.workoutPlanModel.count({ where: { userId: uid } }),
      this.mealModel.count({ where: { userId: uid } }),
    ]);
    return { mealPlansCount, workoutPlansCount, foodRecognitionCount };
  }

  async bodyMetricsTimeline(userId: string) {
    const uid = this.uid(userId);
    const rows = await this.bodyAnalysisModel.findAll({
      where: { userId: uid },
      order: [['analyzedAt', 'ASC']],
      attributes: ['analyzedAt', 'weightKg', 'heightCm', 'bmi'],
    });

    const points: Array<{ sortAt: string; date: string; weight: number; bmi: number }> = [];

    for (const r of rows) {
      if (r.weightKg == null || r.heightCm == null) continue;
      const w = Number(r.weightKg);
      const h = Number(r.heightCm);
      const bmi = r.bmi != null ? Number(r.bmi) : (this.bmiFrom(w, h) ?? 0);
      const sortAt = new Date(r.analyzedAt).toISOString();
      const date = sortAt.slice(0, 10);
      points.push({
        sortAt,
        date,
        weight: Math.round(w * 10) / 10,
        bmi,
      });
    }

    const user = await this.userModel.findByPk(uid, { attributes: ['height', 'weight'] });

    if (user) {
      const w = Number(user.weight);
      const h = Number(user.height);
      const bmi = this.bmiFrom(w, h);
      if (bmi != null) {
        const today = new Date().toISOString().slice(0, 10);
        const profileSortAt = `${today}T15:00:00.000Z`;
        const profilePoint = {
          sortAt: profileSortAt,
          date: today,
          weight: Math.round(w * 10) / 10,
          bmi,
        };
        const dupIdx = points.findIndex((p) => p.sortAt === profileSortAt);
        if (dupIdx >= 0) {
          points[dupIdx] = profilePoint;
        } else {
          points.push(profilePoint);
        }
      }
    }

    if (points.length === 0 && user) {
      const w = Number(user.weight);
      const h = Number(user.height);
      const bmi = this.bmiFrom(w, h);
      if (bmi != null) {
        const today = new Date().toISOString().slice(0, 10);
        points.push({
          sortAt: `${today}T15:00:00.000Z`,
          date: today,
          weight: Math.round(w * 10) / 10,
          bmi,
        });
      }
    }

    return points.sort((a, b) => a.sortAt.localeCompare(b.sortAt));
  }

  async userProgress(userId: string) {
    const meals = await this.mealModel.findAll({
      where: { userId: this.uid(userId), status: { [Op.ne]: 'rejected' } },
      attributes: ['id', 'recognizedAt', 'createdAt', 'confidence', 'status'],
      include: [{ model: MealItem }],
      order: [['recognizedAt', 'ASC']],
    });

    const byDay = new Map<string, { date: string; calories: number; mealsCount: number }>();
    for (const meal of meals) {
      const day = new Date(meal.recognizedAt).toISOString().slice(0, 10);
      let cal = 0;
      for (const item of meal.items ?? []) {
        cal += Number(item.calories) || 0;
      }
      const prev = byDay.get(day) ?? { date: day, calories: 0, mealsCount: 0 };
      prev.calories += cal;
      prev.mealsCount += 1;
      byDay.set(day, prev);
    }

    return [...byDay.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((row) => ({
        ...row,
        calories: Math.round(row.calories * 10) / 10,
      }));
  }

  async kbjuStats(userId: string) {
    const meals = await this.mealModel.findAll({
      where: { userId: this.uid(userId), status: { [Op.ne]: 'rejected' } },
      attributes: ['id', 'recognizedAt', 'createdAt', 'confidence', 'status'],
      include: [{ model: MealItem }],
    });

    let protein = 0;
    let fat = 0;
    let carbs = 0;
    let calories = 0;
    let itemsCount = 0;
    for (const meal of meals) {
      for (const item of meal.items ?? []) {
        itemsCount += 1;
        protein += Number(item.protein) || 0;
        fat += Number(item.fat) || 0;
        carbs += Number(item.carbs) || 0;
        calories += Number(item.calories) || 0;
      }
    }

    return {
      itemsCount,
      protein: Math.round(protein * 10) / 10,
      fat: Math.round(fat * 10) / 10,
      carbs: Math.round(carbs * 10) / 10,
      calories: Math.round(calories * 10) / 10,
    };
  }

  async comparePlanVsFact(userId: string) {
    const uid = this.uid(userId);
    const activePlan = await this.mealPlanModel.findOne({
      where: { userId: uid, status: 'active' },
    });

    const meals = await this.mealModel.findAll({
      where: { userId: uid, status: { [Op.ne]: 'rejected' } },
      attributes: ['id', 'recognizedAt', 'createdAt', 'confidence', 'status'],
      include: [{ model: MealItem }],
    });

    let totalCalories = 0;
    const daysSet = new Set<string>();
    for (const meal of meals) {
      daysSet.add(new Date(meal.recognizedAt).toISOString().slice(0, 10));
      for (const item of meal.items ?? []) {
        totalCalories += Number(item.calories) || 0;
      }
    }

    const daysWithMeals = Math.max(1, daysSet.size);
    const avgDailyFact = totalCalories / daysWithMeals;
    const targetDaily = activePlan?.targetCalories ?? null;

    return {
      targetDailyCalories: targetDaily,
      totalLoggedCalories: Math.round(totalCalories * 10) / 10,
      daysWithMealsLogged: daysWithMeals,
      avgDailyFactCalories: Math.round(avgDailyFact * 10) / 10,
      deltaVsTargetDaily:
        targetDaily != null ? Math.round((avgDailyFact - targetDaily) * 10) / 10 : null,
      planId: activePlan?.id ?? null,
    };
  }

  /**
   * Экспорт статистики пользователя в CSV.
   *
   * Раньше метод возвращал ЗАГЛУШКУ — жёстко прописанную строку
   * `date,calories\n2026-01-01,1800`, одинаковую для всех пользователей.
   * Скачанный файл не имел отношения к реальным данным.
   *
   * Теперь выгружаются фактические приёмы пищи, планы и замеры тела.
   */
  async exportCsv(userId: string, days = 90): Promise<string> {
    const uid = this.uid(userId);
    const since = new Date();
    since.setDate(since.getDate() - Math.max(1, Math.min(365, days)));

    const [meals, plans, body] = await Promise.all([
      this.mealModel.findAll({
        where: { userId: uid },
        attributes: ['id', 'recognizedAt', 'createdAt', 'confidence', 'status'],
        include: [{ model: MealItem }],
        order: [['recognizedAt', 'DESC']],
        limit: 2000,
      }),
      this.mealPlanModel.findAll({
        where: { userId: uid },
        order: [['createdAt', 'DESC']],
        limit: 500,
      }),
      this.bodyAnalysisModel.findAll({
        where: { userId: uid },
        order: [['analyzedAt', 'DESC']],
        limit: 500,
      }),
    ]);

    const esc = (v: unknown): string => {
      const s = String(v ?? '');
      // Экранирование по RFC 4180: кавычки удваиваются, поле оборачивается.
      return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const lines: string[] = [];

    lines.push('# Приёмы пищи (распознавание по фото)');
    lines.push('дата,блюдо,калории,белки,жиры,углеводы,аллергены,уверенность,статус');
    for (const meal of meals) {
      const date = meal.recognizedAt ?? meal.createdAt;
      const items = (meal.items ?? []) as MealItem[];
      if (items.length === 0) {
        lines.push(
          [date?.toISOString?.() ?? '', '', 0, 0, 0, 0, '', meal.confidence ?? 0, meal.status]
            .map(esc)
            .join(','),
        );
        continue;
      }
      for (const it of items) {
        lines.push(
          [
            date?.toISOString?.() ?? '',
            it.foodName,
            Number(it.calories) || 0,
            Number(it.protein) || 0,
            Number(it.fat) || 0,
            Number(it.carbs) || 0,
            Array.isArray(it.allergensFound) ? it.allergensFound.join(' ') : '',
            Number(meal.confidence) || 0,
            meal.status,
          ]
            .map(esc)
            .join(','),
        );
      }
    }

    lines.push('');
    lines.push('# Планы питания');
    lines.push('создан,название,дней,цель ккал,итого ккал,белки,жиры,углеводы,статус');
    for (const p of plans) {
      lines.push(
        [
          p.createdAt?.toISOString?.() ?? '',
          p.name,
          p.durationDays,
          p.targetCalories,
          p.totalCalories,
          p.totalProtein,
          p.totalFat,
          p.totalCarbs,
          p.status,
        ]
          .map(esc)
          .join(','),
      );
    }

    lines.push('');
    lines.push('# Замеры тела');
    lines.push('дата,вес,рост,ИМТ');
    for (const b of body) {
      lines.push(
        [b.analyzedAt?.toISOString?.() ?? '', b.weightKg, b.heightCm, b.bmi ?? '']
          .map(esc)
          .join(','),
      );
    }

    lines.push('');
    lines.push(`# Выгружено: ${new Date().toISOString()}; период: ${days} дн.`);
    return lines.join('\n');
  }

  /**
   * Описание PDF-отчёта.
   *
   * Раньше возвращалась ссылка на несуществующий внешний файл
   * (`https://cdn.example.com/reports/...`) — при скачивании пользователь
   * получал 404. Генерация PDF в проекте не реализована, поэтому честно
   * сообщаем об этом и предлагаем CSV как рабочий формат выгрузки.
   */
  async exportPdf(userId: string): Promise<{
    available: false;
    reason: string;
    suggestedFormat: 'csv';
    summary: {
      meals: number;
      plans: number;
      bodyMeasurements: number;
    };
  }> {
    const uid = this.uid(userId);
    const [meals, plans, bodyMeasurements] = await Promise.all([
      this.mealModel.count({ where: { userId: uid } }),
      this.mealPlanModel.count({ where: { userId: uid } }),
      this.bodyAnalysisModel.count({ where: { userId: uid } }),
    ]);

    return {
      available: false,
      reason:
        'Формирование PDF не поддерживается. Используйте выгрузку в CSV — она содержит те же данные.',
      suggestedFormat: 'csv',
      summary: { meals, plans, bodyMeasurements },
    };
  }
}
