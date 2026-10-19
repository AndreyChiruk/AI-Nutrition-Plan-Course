import { Injectable, Logger } from '@nestjs/common';

/**
 * Курс доллара к белорусскому рублю.
 *
 * Цена подписки хранится в долларах (так настроено в Stripe), но
 * пользователю нужно видеть сумму в BYN. Курс берём динамически —
 * официальный курс Национального банка Республики Беларусь
 * (`api.nbrb.by`), он обновляется раз в сутки.
 *
 * Если внешний сервис недоступен, отдаём последний удачный курс из
 * кэша, а если и его нет — запасное значение `FALLBACK_RATE`, чтобы
 * карточка подписки не осталась без цены. Признак `isFallback`
 * позволяет интерфейсу честно пометить, что курс ориентировочный.
 */
export const FALLBACK_USD_BYN = 3.0;

/** Курс живёт сутки: НБРБ публикует новое значение раз в день. */
const CACHE_TTL_MS = 12 * 60 * 60 * 1000;

/** Дольше этого ждать внешний сервис не имеет смысла — карточка ждёт ответ. */
const REQUEST_TIMEOUT_MS = 5000;

export type UsdBynRate = {
  /** Сколько белорусских рублей стоит 1 доллар. */
  rate: number;
  /** Дата курса в формате YYYY-MM-DD (если сервис её отдал). */
  date: string | null;
  /** Источник курса — для прозрачности в интерфейсе. */
  source: 'nbrb' | 'fallback';
  /** Курс не удалось получить, используется запасное значение. */
  isFallback: boolean;
};

@Injectable()
export class CurrencyService {
  private readonly logger = new Logger(CurrencyService.name);

  private cached: { value: UsdBynRate; fetchedAt: number } | null = null;

  /** Текущий курс USD → BYN (с кэшем). */
  async usdToByn(): Promise<UsdBynRate> {
    const now = Date.now();
    if (this.cached && now - this.cached.fetchedAt < CACHE_TTL_MS) {
      return this.cached.value;
    }

    const fresh = await this.fetchFromNbrb();
    if (fresh) {
      this.cached = { value: fresh, fetchedAt: now };
      return fresh;
    }

    // Внешний сервис недоступен: лучше отдать устаревший курс, чем ничего.
    if (this.cached) {
      this.logger.warn('НБРБ недоступен, отдаю последний удачный курс из кэша.');
      return this.cached.value;
    }

    this.logger.warn('НБРБ недоступен и кэша нет — использую запасной курс.');
    return {
      rate: FALLBACK_USD_BYN,
      date: null,
      source: 'fallback',
      isFallback: true,
    };
  }

  /** Запрос к API Национального банка Беларуси. */
  private async fetchFromNbrb(): Promise<UsdBynRate | null> {
    const url = 'https://api.nbrb.by/exrates/rates/USD?parammode=2';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);

      if (!res.ok) {
        this.logger.warn(`НБРБ ответил ${res.status}`);
        return null;
      }

      const data = (await res.json()) as {
        Cur_OfficialRate?: unknown;
        Cur_Scale?: unknown;
        Date?: unknown;
      };

      const scale = Number(data.Cur_Scale ?? 1);
      const official = Number(data.Cur_OfficialRate);
      if (!Number.isFinite(official) || official <= 0 || !Number.isFinite(scale) || scale <= 0) {
        this.logger.warn('НБРБ вернул неожиданный формат курса.');
        return null;
      }

      // НБРБ отдаёт цену за `Cur_Scale` единиц (для USD это 1, но проверяем).
      const rate = official / scale;
      return {
        rate: Number(rate.toFixed(4)),
        date: typeof data.Date === 'string' ? data.Date.slice(0, 10) : null,
        source: 'nbrb',
        isFallback: false,
      };
    } catch (e) {
      this.logger.warn(`Не удалось получить курс НБРБ: ${String(e)}`);
      return null;
    }
  }
}
