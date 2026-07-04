import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
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
      where: { userId: this.uid(userId) },
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
      where: { userId: this.uid(userId) },
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
      where: { userId: uid },
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

  exportCsv() {
    return 'date,calories\n2026-01-01,1800';
  }

  exportPdf() {
    return {
      fileName: 'stats-report.pdf',
      url: 'https://cdn.example.com/reports/stats-report.pdf',
    };
  }
}
