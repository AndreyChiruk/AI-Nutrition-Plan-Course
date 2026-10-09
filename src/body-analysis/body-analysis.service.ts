import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/sequelize';
import { BodyAnalysis } from '../models/BodyAnalysis';
import type { BodyForecastPayloadDb } from '../models/User';
import { OpenAiService } from '../openai/openai.service';
import { User } from '../models/User';
import { normalizeGoalByWeight } from '../common/weight-goal.util';
import { validateAndNormalizePhoto } from '../common/image-validation.util';
import { recoverDeep } from '../common/text-recovery.util';
import { isOpenRouterConfigured } from '../config/openrouter';

export type BodyAnalysisPageState = {
  latestAnalysis: { photoUrl: string; analyzedAt: string; aiNotes?: string } | null;
  savedForecast: {
    userId: string;
    durationWeeks: number;
    summary: string;
    milestones: Array<{ week: number; note: string }>;
    visualDescription: string;
    disclaimer: string;
    illustrationUrl: string;
    illustrationSource?: 'ai' | 'stock';
    lastAnalysisPhotoUrl: string | null;
  } | null;
  savedForecastWeeks: number | null;
  forecastUpdatedAt: string | null;
};

@Injectable()
export class BodyAnalysisService {
  constructor(
    @InjectModel(BodyAnalysis)
    private readonly bodyAnalysisModel: typeof BodyAnalysis,
    @InjectModel(User)
    private readonly userModel: typeof User,
    private readonly openAiService: OpenAiService,
  ) {}

  async getPageState(userId: string): Promise<BodyAnalysisPageState> {
    const uid = Number(userId);
    const latest = await this.bodyAnalysisModel.findOne({
      where: { userId: uid },
      order: [
        ['analyzedAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
    const user = await this.userModel.findByPk(uid, {
      attributes: ['bodyForecastIllustrationUrl', 'bodyForecastPayload', 'bodyForecastAt'],
    });

    let savedForecast: BodyAnalysisPageState['savedForecast'] = null;
    let savedForecastWeeks: number | null = null;
    const p = user?.bodyForecastPayload as BodyForecastPayloadDb | null | undefined;
    const ill = user?.bodyForecastIllustrationUrl;
    if (p && ill) {
      savedForecast = {
        userId: String(uid),
        durationWeeks: p.durationWeeks,
        summary: p.summary,
        milestones: p.milestones,
        visualDescription: p.visualDescription,
        disclaimer: p.disclaimer,
        illustrationUrl: ill,
        illustrationSource: p.illustrationSource,
        lastAnalysisPhotoUrl: p.lastAnalysisPhotoUrl,
      };
      savedForecastWeeks = p.durationWeeks;
    }

    return {
      latestAnalysis: latest
        ? {
            photoUrl: latest.photoUrl,
            analyzedAt: (latest.analyzedAt ?? latest.createdAt).toISOString(),
            aiNotes:
              typeof latest.aiNotes === 'string' && latest.aiNotes.trim().length > 0
                ? latest.aiNotes.trim()
                : undefined,
          }
        : null,
      savedForecast,
      savedForecastWeeks,
      forecastUpdatedAt: user?.bodyForecastAt
        ? new Date(user.bodyForecastAt).toISOString()
        : null,
    };
  }

  async uploadAndAnalyze(userId: string, photoUrlRaw: string) {
    const uid = Number(userId);

    // Проверяем и нормализуем фото (magic bytes, размер, уменьшение до 1600 px).
    const photo = await validateAndNormalizePhoto(photoUrlRaw, 'photoUrl');

    const result = await this.openAiService.analyzeBodyFromPhoto(photo.dataUrl);
    const user = await this.userModel.findByPk(uid, {
      attributes: ['height', 'weight'],
    });
    const heightCm = user?.height ?? 170;
    const weightKg = user?.weight ?? 70;
    const bmi = heightCm > 0 ? Math.round((weightKg / (heightCm / 100) ** 2) * 10) / 10 : null;
    const row = await this.bodyAnalysisModel.create(
      recoverDeep({
        userId: uid,
        photoUrl: photo.dataUrl,
        analyzedAt: new Date(),
        weightKg,
        heightCm,
        bmi: bmi ?? undefined,
        ...result,
      }) as never,
    );

    await this.userModel.update(
      {
        bodyForecastIllustrationUrl: null,
        bodyForecastPayload: null,
        bodyForecastAt: null,
      } as never,
      { where: { id: uid } },
    );

    return row;
  }

  async generateVisualForecast(userId: string, durationWeeks?: number) {
    const weeks = Math.min(52, Math.max(1, Math.floor(durationWeeks ?? 4)));
    const uid = Number(userId);
    const user = await this.userModel.findByPk(uid);
    if (!user) {
      throw new Error('User not found');
    }
    const analysis = await this.bodyAnalysisModel.findOne({
      where: { userId: uid },
      order: [
        ['analyzedAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
    const bodyFat = analysis?.estimatedBodyFat ?? 20;
    const muscle = analysis?.estimatedMuscleMass ?? 40;

    const safeGoal = normalizeGoalByWeight(
      (user?.goal ?? 'maintain') as 'lose' | 'maintain' | 'gain',
      Number(user?.weight ?? 70),
      Number(user?.height ?? 170),
    );

    const forecast = await this.openAiService.generateBodyForecast({
      durationWeeks: weeks,
      goal: safeGoal,
      gender: user?.gender ?? 'male',
      weight: user?.weight ?? 70,
      height: user?.height ?? 170,
      bodyFat,
      muscle,
    });

    const stockByGoal =
      safeGoal === 'lose'
        ? 'https://images.unsplash.com/photo-1571019614242-c5c5dee9f50b?auto=format&fit=crop&w=1200&q=80'
        : safeGoal === 'gain'
          ? 'https://images.unsplash.com/photo-1532384748854-8d54e8a52b96?auto=format&fit=crop&w=1200&q=80'
          : 'https://images.unsplash.com/photo-1518611012118-696072aa579a?auto=format&fit=crop&w=1200&q=80';

    const g = safeGoal;
    const ge = user?.gender === 'female' ? 'female' : 'male';
    let illustrationUrl = stockByGoal;
    let illustrationSource: 'ai' | 'stock' = 'stock';
    const photo = analysis?.photoUrl;
    if (
      photo &&
      photo.startsWith('data:') &&
      isOpenRouterConfigured &&
      process.env.OPENAI_FORECAST_ILLUSTRATION !== 'false'
    ) {
      const generated = await this.openAiService.generateBodyForecastIllustration(photo, {
        weeks,
        goal: g,
        gender: ge,
      });
      if (generated) {
        illustrationUrl = generated;
        illustrationSource = 'ai';
      }
    }

    // Восстанавливаем кодировку текстов прогноза. Модель и внешние
    // источники иногда отдают текст в неверной кодировке, и он сохранялся
    // в базу как «╨Э╨░╤З╨░╨╗╨╛» вместо «Начало». Корректный текст
    // функция не изменяет.
    const payload: BodyForecastPayloadDb = recoverDeep({
      durationWeeks: weeks,
      summary: forecast.summary,
      milestones: forecast.milestones,
      visualDescription: forecast.visualDescription,
      disclaimer: forecast.disclaimer,
      illustrationSource,
      lastAnalysisPhotoUrl: analysis?.photoUrl ?? null,
    });

    await user.update({
      bodyForecastIllustrationUrl: illustrationUrl,
      bodyForecastPayload: payload as never,
      bodyForecastAt: new Date(),
    } as never);

    return {
      userId: String(userId),
      durationWeeks: weeks,
      summary: forecast.summary,
      milestones: forecast.milestones,
      visualDescription: forecast.visualDescription,
      disclaimer: forecast.disclaimer,
      illustrationUrl,
      illustrationSource,
      lastAnalysisPhotoUrl: analysis?.photoUrl ?? null,
    };
  }

  async getBasicRecommendations(userId: string) {
    const analysis = await this.bodyAnalysisModel.findOne({
      where: { userId: Number(userId) },
      order: [
        ['analyzedAt', 'DESC'],
        ['createdAt', 'DESC'],
      ],
    });
    const user = await this.userModel.findByPk(Number(userId));

    const bodyFat = analysis?.estimatedBodyFat ?? 20;
    const muscle = analysis?.estimatedMuscleMass ?? 40;
    const goal = normalizeGoalByWeight(
      (user?.goal ?? 'maintain') as 'lose' | 'maintain' | 'gain',
      Number(user?.weight ?? 70),
      Number(user?.height ?? 170),
    );

    const recommendations: string[] = [];
    if (bodyFat > 28) {
      recommendations.push('Снизьте быстрые углеводы и добавьте 25-30 минут кардио 4 раза в неделю.');
    } else if (bodyFat < 14) {
      recommendations.push('Поддерживайте калорийность на уровне нормы и избегайте резких дефицитов.');
    } else {
      recommendations.push('Текущий процент жира в норме, удерживайте стабильный режим питания.');
    }

    if (muscle < 35) {
      recommendations.push('Увеличьте белок до 1.6-2 г/кг и добавьте силовые тренировки 3 раза в неделю.');
    } else {
      recommendations.push('Мышечная масса достаточная, фокусируйтесь на восстановлении и сне.');
    }

    if (goal === 'lose') {
      recommendations.push('Для снижения веса держите дефицит 300-400 ккал от поддержки.');
    }
    if (goal === 'gain') {
      recommendations.push('Для набора держите профицит 200-300 ккал и прогрессивную нагрузку.');
    }
    recommendations.push('Пейте не менее 30 мл воды на 1 кг веса ежедневно.');

    return {
      photoUrl: analysis?.photoUrl ?? null,
      estimatedBodyFat: bodyFat,
      estimatedMuscleMass: muscle,
      recommendations: recommendations.slice(0, 5),
      type: 'basic',
    };
  }
}
