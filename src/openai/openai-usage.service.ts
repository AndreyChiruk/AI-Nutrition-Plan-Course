import { Injectable, Logger } from '@nestjs/common';

/**
 * Учёт расхода токенов и стоимости запросов к OpenAI.
 *
 * Зачем: `responses.create` возвращает объект `usage` (input/output/total
 * токены), но он нигде не сохранялся. Расход и стоимость вызовов были
 * неизвестны: нельзя ни посчитать бюджет, ни заметить аномалию
 * (например, промпт с огромным каталогом).
 *
 * Здесь ведётся накопительная статистика в памяти процесса плюс запись
 * в лог на уровне info. Этого достаточно для контроля расходов
 * в рамках учебного проекта, без отдельной таблицы.
 */

/** Стоимость за 1M токенов, USD. Ключи — префиксы имён моделей. */
const PRICING_PER_MILLION: Array<{ prefix: string; input: number; output: number }> = [
  { prefix: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { prefix: 'gpt-4o', input: 2.5, output: 10 },
  { prefix: 'gpt-4.1-mini', input: 0.4, output: 1.6 },
  { prefix: 'gpt-4.1', input: 2.0, output: 8.0 },
  { prefix: 'o4-mini', input: 1.1, output: 4.4 },
  { prefix: 'o3-mini', input: 1.1, output: 4.4 },
];

export type UsageRecord = {
  /** Логическое имя операции: food_recognition, meal_plan, body_analysis… */
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  /** Длительность запроса, мс. */
  durationMs: number;
  at: Date;
  ok: boolean;
};

@Injectable()
export class OpenAiUsageService {
  private readonly logger = new Logger('OpenAiUsage');

  private readonly records: UsageRecord[] = [];
  private readonly totals = {
    requests: 0,
    failedRequests: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCostUsd: 0,
  };

  /** Максимальное число хранимых записей, чтобы память не росла бесконечно. */
  private readonly maxRecords = 1000;

  /** Считает стоимость по модели и количеству токенов. */
  estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
    const m = String(model ?? '').toLowerCase();
    const pricing =
      PRICING_PER_MILLION.find((p) => m.startsWith(p.prefix)) ??
      // Неизвестная модель: считаем по тарифу самой дешёвой, чтобы не завышать.
      PRICING_PER_MILLION[0];

    const cost =
      (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
    // Округляем до 6 знаков: суммы за один запрос очень малы.
    return Math.round(cost * 1_000_000) / 1_000_000;
  }

  /**
   * Извлекает `usage` из ответа OpenAI.
   * Поддерживает формат Responses API (`input_tokens`/`output_tokens`)
   * и Chat Completions (`prompt_tokens`/`completion_tokens`).
   */
  extractUsage(response: unknown): { inputTokens: number; outputTokens: number } {
    const u = (response as { usage?: Record<string, unknown> } | null)?.usage;
    if (!u || typeof u !== 'object') return { inputTokens: 0, outputTokens: 0 };

    const num = (...keys: string[]): number => {
      for (const k of keys) {
        const v = Number((u as Record<string, unknown>)[k]);
        if (Number.isFinite(v) && v > 0) return v;
      }
      return 0;
    };

    return {
      inputTokens: num('input_tokens', 'prompt_tokens'),
      outputTokens: num('output_tokens', 'completion_tokens'),
    };
  }

  record(input: {
    operation: string;
    model: string;
    response?: unknown;
    durationMs?: number;
    ok?: boolean;
    inputTokens?: number;
    outputTokens?: number;
  }): UsageRecord {
    let inputTokens = Number(input.inputTokens) || 0;
    let outputTokens = Number(input.outputTokens) || 0;

    if (input.response && inputTokens === 0 && outputTokens === 0) {
      const extracted = this.extractUsage(input.response);
      inputTokens = extracted.inputTokens;
      outputTokens = extracted.outputTokens;
    }

    const totalTokens = inputTokens + outputTokens;
    const estimatedCostUsd = this.estimateCostUsd(input.model, inputTokens, outputTokens);
    const ok = input.ok !== false;

    const rec: UsageRecord = {
      operation: input.operation,
      model: input.model,
      inputTokens,
      outputTokens,
      totalTokens,
      estimatedCostUsd,
      durationMs: Math.max(0, Math.round(Number(input.durationMs) || 0)),
      at: new Date(),
      ok,
    };

    this.records.push(rec);
    if (this.records.length > this.maxRecords) this.records.splice(0, this.records.length - this.maxRecords);

    this.totals.requests += 1;
    if (!ok) this.totals.failedRequests += 1;
    this.totals.inputTokens += inputTokens;
    this.totals.outputTokens += outputTokens;
    this.totals.totalTokens += totalTokens;
    this.totals.estimatedCostUsd = Math.round((this.totals.estimatedCostUsd + estimatedCostUsd) * 1_000_000) / 1_000_000;

    this.logger.log(
      `OpenAI ${rec.operation}: ${inputTokens}+${outputTokens} токенов, ` +
        `~$${estimatedCostUsd.toFixed(6)}, ${rec.durationMs} мс${ok ? '' : ' (ошибка)'}`,
    );

    return rec;
  }

  /** Сводка по операциям за всё время работы процесса. */
  summary(): {
    totals: typeof this.totals;
    byOperation: Array<{
      operation: string;
      requests: number;
      inputTokens: number;
      outputTokens: number;
      estimatedCostUsd: number;
      avgDurationMs: number;
    }>;
    recent: UsageRecord[];
  } {
    const byOp = new Map<
      string,
      { requests: number; inputTokens: number; outputTokens: number; cost: number; duration: number }
    >();

    for (const r of this.records) {
      const cur = byOp.get(r.operation) ?? {
        requests: 0,
        inputTokens: 0,
        outputTokens: 0,
        cost: 0,
        duration: 0,
      };
      cur.requests += 1;
      cur.inputTokens += r.inputTokens;
      cur.outputTokens += r.outputTokens;
      cur.cost += r.estimatedCostUsd;
      cur.duration += r.durationMs;
      byOp.set(r.operation, cur);
    }

    return {
      totals: { ...this.totals },
      byOperation: [...byOp.entries()].map(([operation, v]) => ({
        operation,
        requests: v.requests,
        inputTokens: v.inputTokens,
        outputTokens: v.outputTokens,
        estimatedCostUsd: Math.round(v.cost * 1_000_000) / 1_000_000,
        avgDurationMs: v.requests ? Math.round(v.duration / v.requests) : 0,
      })),
      recent: this.records.slice(-20).reverse(),
    };
  }

  reset(): void {
    this.records.length = 0;
    this.totals.requests = 0;
    this.totals.failedRequests = 0;
    this.totals.inputTokens = 0;
    this.totals.outputTokens = 0;
    this.totals.totalTokens = 0;
    this.totals.estimatedCostUsd = 0;
  }
}
