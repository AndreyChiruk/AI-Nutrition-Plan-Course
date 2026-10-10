import { Injectable, Logger } from '@nestjs/common';
import { OpenAiUsageService } from '../openai/openai-usage.service';

const OPENAI_API_BASE = 'https://api.openai.com';

export type OpenAiBillingSnapshot = {
  fetchedAt: string;
  apiKeyConfigured: boolean;
  costs7d?: BillingSection & {
    totalUsdApprox?: number;
    bucketCount?: number;
  };
  /**
   * Расход токенов и стоимость вызовов, посчитанные САМИМ приложением
   * по полю `usage` из ответов OpenAI. В отличие от `costs7d` (данные
   * организации, доступные только с admin-ключом), эта статистика
   * работает всегда и разбита по операциям.
   */
  localUsage?: ReturnType<OpenAiUsageService['summary']>;
  /**
   * Расходы в OpenRouter: реальные списания по ключу.
   *
   * Данные берутся из `/api/v1/credits` (общий расход и пополнения)
   * и `/api/v1/key` (лимит ключа). Это фактическая сумма, списанная
   * провайдером, а не оценка по токенам.
   */
  openRouter?: OpenRouterBilling | null;
};

/** Состояние средств в OpenRouter. */
export type OpenRouterBilling = {
  /** Сколько всего израсходовано, USD. */
  totalUsageUsd: number;
  /** Всего пополнено, USD. */
  totalCreditsUsd: number | null;
  /** Остаток на счете, USD. */
  remainingUsd: number | null;
  /** Лимит ключа, если задан. */
  keyLimitUsd: number | null;
  /** Остаток лимита ключа. */
  keyLimitRemainingUsd: number | null;
  /** Метка ключа — по ней видно, какой именно ключ используется. */
  keyLabel: string | null;
  error?: string;
};

type BillingSection = {
  ok: boolean;
  status: number;
  message?: string;
};

@Injectable()
export class OpenAiBillingService {
  private readonly logger = new Logger(OpenAiBillingService.name);

  constructor(private readonly usage: OpenAiUsageService) {}

  private billingHeaders(apiKey: string): HeadersInit {
    const h: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    };
    const org = process.env.OPENAI_ORGANIZATION_ID?.trim();
    if (org) {
      h['OpenAI-Organization'] = org;
    }
    const project = process.env.OPENAI_PROJECT_ID?.trim();
    if (project) {
      h['OpenAI-Project'] = project;
    }
    return h;
  }

  /**
   * Запрашивает расходы в OpenRouter.
   *
   * Ошибка сети или неверный ключ не должны ломать панель: в этом
   * случае возвращаем объект с текстом ошибки, а интерфейс показывает
   * его вместо сумм.
   */
  private async fetchOpenRouterBilling(apiKey: string): Promise<OpenRouterBilling> {
    const headers = { Authorization: `Bearer ${apiKey}` };
    const timeout = AbortSignal.timeout(15_000);

    try {
      const [creditsRes, keyRes] = await Promise.all([
        fetch('https://openrouter.ai/api/v1/credits', { headers, signal: timeout }),
        fetch('https://openrouter.ai/api/v1/key', { headers, signal: timeout }),
      ]);

      if (!creditsRes.ok) {
        return {
          totalUsageUsd: 0,
          totalCreditsUsd: null,
          remainingUsd: null,
          keyLimitUsd: null,
          keyLimitRemainingUsd: null,
          keyLabel: null,
          error: `OpenRouter вернул ${creditsRes.status}`,
        };
      }

      const credits = (await creditsRes.json()) as {
        data?: { total_credits?: number; total_usage?: number };
      };
      const key = keyRes.ok
        ? ((await keyRes.json()) as {
            data?: {
              label?: string;
              usage?: number;
              limit?: number | null;
              limit_remaining?: number | null;
            };
          })
        : {};

      const totalUsage = Number(credits.data?.total_usage ?? 0);
      const totalCredits =
        credits.data?.total_credits != null ? Number(credits.data.total_credits) : null;
      const keyData = key.data ?? {};

      return {
        totalUsageUsd: totalUsage,
        totalCreditsUsd: totalCredits,
        // Остаток считаем от пополнений; если их не было — null.
        remainingUsd: totalCredits != null ? Math.max(0, totalCredits - totalUsage) : null,
        keyLimitUsd: keyData.limit != null ? Number(keyData.limit) : null,
        keyLimitRemainingUsd:
          keyData.limit_remaining != null ? Number(keyData.limit_remaining) : null,
        keyLabel: keyData.label ?? null,
      };
    } catch (e) {
      this.logger.warn(`Не удалось получить расходы OpenRouter: ${String(e)}`);
      return {
        totalUsageUsd: 0,
        totalCreditsUsd: null,
        remainingUsd: null,
        keyLimitUsd: null,
        keyLimitRemainingUsd: null,
        keyLabel: null,
        error: 'Сервис OpenRouter недоступен',
      };
    }
  }

  async getSnapshot(): Promise<OpenAiBillingSnapshot> {
    const fetchedAt = new Date().toISOString();
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    const usageAdminKey = process.env.OPENAI_USAGE_ADMIN_KEY?.trim();

    // Основной режим — OpenRouter. Расходы запрашиваются у него напрямую:
    // раньше панель лишь предлагала посмотреть их в личном кабинете.
    const openRouterKey = process.env.OPENROUTER_API_KEY?.trim();
    if (openRouterKey) {
      return {
        fetchedAt,
        apiKeyConfigured: true,
        openRouter: await this.fetchOpenRouterBilling(openRouterKey),
        localUsage: this.usage.summary(),
      };
    }

    // Прямой ключ OpenAI — прежний путь через биллинг организации.
    if (!openAiKey && !usageAdminKey) {
      return {
        fetchedAt,
        apiKeyConfigured: false,
        localUsage: this.usage.summary(),
      };
    }

    const costsKey = usageAdminKey ?? openAiKey ?? '';
    const endUnix = Math.floor(Date.now() / 1000);
    const startUnix = endUnix - 7 * 24 * 3600;

    const costs7d = await this.fetchOrganizationCosts(costsKey, startUnix, endUnix);

    return {
      fetchedAt,
      apiKeyConfigured: true,
      costs7d,
      localUsage: this.usage.summary(),
    };
  }

  private async fetchOrganizationCosts(
    apiKey: string,
    startTime: number,
    endTime: number,
  ): Promise<OpenAiBillingSnapshot['costs7d']> {
    const query = `start_time=${startTime}&end_time=${endTime}&bucket_width=1d&limit=14`;
    const paths = [`/v1/organization/costs?${query}`, `/organization/costs?${query}`];
    for (const path of paths) {
      const r = await this.getJson(apiKey, path);
      if (r.status === 404) continue;
      if (!r.ok) {
        return {
          ok: false,
          status: r.status,
          message: this.humanBillingError(r.bodyText, r.json),
        };
      }
      const { total, buckets } = sumOrganizationCosts(r.json);
      return {
        ok: true,
        status: r.status,
        totalUsdApprox: total,
        bucketCount: buckets,
      };
    }
    return {
      ok: false,
      status: 404,
      message:
        'Эндпоинт organization/costs недоступен. Задайте OPENAI_USAGE_ADMIN_KEY (scope api.usage.read) и при необходимости OPENAI_ORGANIZATION_ID.',
    };
  }

  private async getJson(
    apiKey: string,
    path: string,
  ): Promise<{ ok: boolean; status: number; json?: unknown; bodyText: string }> {
    const url = path.startsWith('http') ? path : `${OPENAI_API_BASE}${path}`;
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: this.billingHeaders(apiKey),
      });
      const bodyText = await res.text();
      let json: unknown;
      try {
        json = JSON.parse(bodyText) as unknown;
      } catch {
        json = undefined;
      }
      return { ok: res.ok, status: res.status, json, bodyText };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`OpenAI billing fetch failed ${path}: ${msg}`);
      return { ok: false, status: 0, bodyText: msg };
    }
  }

  private humanBillingError(bodyText: string, json?: unknown): string {
    let raw = '';
    if (json && typeof json === 'object' && 'error' in json) {
      const errVal = (json as { error?: unknown }).error;
      if (typeof errVal === 'string') {
        raw = errVal;
      } else if (errVal && typeof errVal === 'object' && errVal !== null && 'message' in errVal) {
        const m = (errVal as { message?: unknown }).message;
        if (typeof m === 'string') raw = m;
      }
    }
    if (!raw) raw = bodyText.slice(0, 600);

    if (/session key/i.test(raw)) {
      return 'Эндпоинт недоступен для этого типа ключа.';
    }
    if (/api\.usage\.read/i.test(raw) && /insufficient permissions/i.test(raw)) {
      return 'Нужен ключ с областью api.usage.read: задайте OPENAI_USAGE_ADMIN_KEY и при необходимости OPENAI_ORGANIZATION_ID.';
    }
    return raw.slice(0, 600);
  }
}

function sumOrganizationCosts(json: unknown): { total: number | undefined; buckets: number } {
  if (!json || typeof json !== 'object') return { total: undefined, buckets: 0 };
  const root = json as Record<string, unknown>;
  let sum = 0;
  let buckets = 0;
  const data = root.data;
  if (!Array.isArray(data)) return { total: undefined, buckets: 0 };

  for (const bucket of data) {
    if (!bucket || typeof bucket !== 'object') continue;
    const b = bucket as Record<string, unknown>;
    const results = b.results;
    if (!Array.isArray(results)) continue;
    buckets += 1;
    for (const row of results) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const amt = r.amount ?? r.cost;
      const val = extractUsdAmount(amt);
      if (val !== undefined) sum += val;
    }
  }

  return { total: buckets ? Number(sum.toFixed(6)) : undefined, buckets };
}

function extractUsdAmount(amt: unknown): number | undefined {
  if (typeof amt === 'number') return amt;
  if (amt && typeof amt === 'object') {
    const o = amt as Record<string, unknown>;
    const v = o.value ?? o.amount;
    if (typeof v === 'string') {
      const n = Number(v);
      return Number.isNaN(n) ? undefined : n;
    }
    if (typeof v === 'number') return v;
  }
  return undefined;
}
