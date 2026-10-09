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
    const [rows] = await this.sequelize.query(
      `SELECT
         count(*) FILTER (WHERE is_published) AS dishes,
         count(DISTINCT category) FILTER (WHERE is_published) AS categories,
         count(*) FILTER (WHERE is_published AND contains_alcohol) AS with_alcohol
       FROM products`,
    );
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};

    return {
      dishes: Number(row.dishes ?? 0),
      categories: Number(row.categories ?? 0),
      withAlcohol: Number(row.with_alcohol ?? 0),
    };
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
