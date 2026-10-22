import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { Sequelize } from 'sequelize';

/**
 * Проверка работоспособности сервиса.
 *
 * Зачем: у контейнера `api` не было healthcheck — Docker считал его здоровым
 * сразу после запуска процесса, даже если база недоступна и запросы падают.
 * Оркестратор (и `depends_on: condition: service_healthy`) не мог дождаться
 * реальной готовности, а мониторинг не замечал отказ БД.
 *
 * Эндпоинт намеренно НЕ требует авторизации: его опрашивает инфраструктура.
 * Наружу отдаётся минимум сведений — без версий, путей и конфигурации.
 */
@Controller('health')
export class HealthController {
  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  /** Быстрая проверка: процесс жив и отвечает. */
  @Get()
  @HttpCode(HttpStatus.OK)
  live() {
    return { status: 'ok', uptimeSec: Math.round(process.uptime()) };
  }

  private statsCache: { data: { dishes: number; categories: number; withAlcohol: number }; expiresAt: number } | null = null;

  /**
   * Публичные показатели каталога.
   *
   * Нужны для главной страницы: она показывает количество блюд
   * и категорий, чтобы у нового пользователя было понимание,
   * что внутри. Персональные данные здесь не отдаются.
   *
   * Кэширование на 5 минут: значения меняются только при импорте
   * каталога, а главную открывают часто.
   */
  @Get('catalog-stats')
  @HttpCode(HttpStatus.OK)
  async catalogStats() {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.statsCache.data;
    }
    const [rows] = await this.sequelize.query(
      `SELECT
         count(*) FILTER (WHERE is_published) AS dishes,
         count(DISTINCT category) FILTER (WHERE is_published) AS categories,
         count(*) FILTER (WHERE is_published AND contains_alcohol) AS with_alcohol
       FROM products`,
    );
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};

    const data = {
      dishes: Number(row.dishes ?? 0),
      categories: Number(row.categories ?? 0),
      withAlcohol: Number(row.with_alcohol ?? 0),
    };
    this.statsCache = { data, expiresAt: now + 5 * 60_000 };
    return data;
  }

  /**
   * Несколько блюд каталога с фотографиями — для блока «Что в каталоге»
   * на главной странице.
   *
   * Зачем отдельный эндпоинт: в макете этого блока есть фото блюд,
   * а список на главной был захардкожен, и у трёх из четырёх блюд
   * фотографий в базе нет (проверено запросом к products).
   * Поэтому блюда берём из базы и только те, у которых есть image_url —
   * иначе на главной появлялись бы пустые заглушки.
   *
   * Отдаётся только публичное: название, тип приёма, калории и ссылка
   * на фото. Без ингредиентов, аллергенов и служебных полей.
   */
  @Get('catalog-samples')
  @HttpCode(HttpStatus.OK)
  async catalogSamples() {
    /* ORDER BY random() даёт разный набор при каждом обновлении
       главной — витрина не выглядит застывшей. LIMIT 4 совпадает
       с числом карточек в макете. */
    const [rows] = await this.sequelize.query(
      `SELECT id, name, category, calories, meal_types, image_url
         FROM products
        WHERE is_published
          /* Только http(s)-ссылки: в базе есть две тестовые записи,
             где в image_url лежит data:image/...;base64 — это раздувает
             ответ в десятки килобайт и показывает тестовое блюдо
             на витрине главной. */
          AND image_url LIKE 'http%'
          /* Без алкоголя: на витрину попадали «Коктейль А1», «Пиратская
             закуска» и другие напитки — неуместно для страницы о питании.
             Флаг contains_alcohol надёжнее поиска по названию: он ловит
             и блюда с алкоголем в составе (тушёные с сидром, с хересом). */
          AND NOT contains_alcohol
          /* Только основные приёмы: перекусы и напитки на витрину
             не ставим — там нужны полноценные блюда. */
          AND meal_types ?| array['breakfast','lunch','dinner','завтрак','обед','ужин']
        ORDER BY random()
        LIMIT 4`,
    );

    /* В базе meal_types хранятся и латиницей (lunch/dinner), и русскими
       словами (ужин/обед) — встречаются оба варианта, поэтому словарь
       покрывает обе формы. */
    const MEAL_LABELS: Record<string, string> = {
      breakfast: 'Завтрак',
      lunch: 'Обед',
      dinner: 'Ужин',
      snack: 'Перекус',
      snack2: 'Перекус',
      гарнир: 'Гарнир',
      завтрак: 'Завтрак',
      обед: 'Обед',
      ужин: 'Ужин',
      перекус: 'Перекус',
    };

    return (rows as Array<Record<string, unknown>>).map((r) => {
      const types = Array.isArray(r.meal_types) ? (r.meal_types as string[]) : [];
      const first = types[0] ?? '';
      return {
        id: String(r.id),
        name: String(r.name ?? ''),
        slot: MEAL_LABELS[first] ?? MEAL_LABELS[String(r.category ?? '')] ?? 'Блюдо',
        kcal: Math.round(Number(r.calories ?? 0)),
        imageUrl: String(r.image_url ?? ''),
      };
    });
  }

  /**
   * Полная проверка готовности: доступна ли база данных.
   * При недоступности возвращается 503 — именно это увидят Docker и мониторинг.
   */
  @Get('ready')
  async ready() {
    const startedAt = Date.now();
    try {
      await this.sequelize.query('SELECT 1');
    } catch (e) {
      throw new ServiceUnavailableException({
        status: 'unavailable',
        database: 'down',
        message: 'База данных недоступна',
        detail: e instanceof Error ? e.message : String(e),
      });
    }

    return {
      status: 'ok',
      database: 'up',
      dbLatencyMs: Date.now() - startedAt,
      uptimeSec: Math.round(process.uptime()),
    };
  }
}
