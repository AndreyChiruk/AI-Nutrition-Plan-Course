import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from '@nestjs/sequelize';
import { randomUUID } from 'crypto';
import { QueryTypes, Sequelize } from 'sequelize';
import { hashPassword } from '../common/password.util';
import { ensureProductsSchema } from '../database/ensure-products-schema';
import { ensureMealPlannerSchema } from '../database/ensure-meal-planner-schema';
import { ensureUserDietarySchema } from '../database/ensure-user-dietary-schema';
import { ensureUserLastActiveSchema } from '../database/ensure-user-last-active-schema';
import { ensureBodyAnalysisWeightSchema } from '../database/ensure-body-analysis-weight-schema';
import { ensurePhotoUrlTextSchema } from '../database/ensure-photo-url-text-schema';
import { ensureBodyForecastSchema } from '../database/ensure-body-forecast-schema';
import { runMigrations } from '../database/migration-runner';

@Injectable()
export class AuthBootstrapService implements OnModuleInit {
  private readonly logger = new Logger(AuthBootstrapService.name);

  constructor(@InjectConnection() private readonly sequelize: Sequelize) {}

  async onModuleInit() {
    // Единый прогон SQL-миграций с учётом применённых.
    // Раньше миграции из database/migrations применялись только вручную,
    // поэтому на чистой базе схема не соответствовала коду.
    // allowChecksumMismatch нужен для существующих баз, где схема уже
    // создана вручную: таблица учёта пуста, и проверка контрольных сумм
    // не должна блокировать запуск.
    try {
      const res = await runMigrations(this.sequelize, {
        logger: this.logger,
        allowChecksumMismatch: process.env.MIGRATIONS_ALLOW_CHECKSUM_MISMATCH === '1',
      });
      if (res.failed.length > 0) {
        this.logger.error(
          `Не применены миграции: ${res.failed.map((f) => f.file).join(', ')}. ` +
            'Приложение запущено, но схема может не соответствовать коду.',
        );
      }
    } catch (e) {
      this.logger.error(
        `Прогон миграций не удался: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await ensureProductsSchema(this.sequelize);
    await ensureMealPlannerSchema(this.sequelize);
    await ensureUserDietarySchema(this.sequelize);
    await ensureUserLastActiveSchema(this.sequelize);
    await ensureBodyAnalysisWeightSchema(this.sequelize);
    await ensurePhotoUrlTextSchema(this.sequelize);
    await ensureBodyForecastSchema(this.sequelize);

    const isProd = process.env.NODE_ENV === 'production';
    const adminEmail = (process.env.ADMIN_EMAIL ?? 'admin@example.com').trim().toLowerCase();
    const adminPassword = process.env.ADMIN_PASSWORD?.trim();

    // Безопасность: пароль администратора задаётся только явно.
    // Раньше при отсутствии ADMIN_PASSWORD создавался admin@example.com / admin123,
    // то есть предсказуемый полный доступ к админ-панели.
    if (!adminPassword && !isProd) {
      this.logger.warn(
        'ADMIN_PASSWORD не задан — первичный администратор не создан. ' +
          'Задайте ADMIN_EMAIL и ADMIN_PASSWORD в .env и перезапустите приложение.',
      );
    }

    // Демо-пользователи создаются только вне production и только при явном флаге.
    const demoUsers =
      !isProd && process.env.SEED_DEMO_USERS === 'true'
        ? [
            {
              email: 'user1@example.com',
              password: 'user123',
              role: 'user',
              birthDate: '1998-05-12',
            },
            {
              email: 'user2@example.com',
              password: 'user123',
              role: 'user',
              birthDate: '1992-11-03',
            },
          ]
        : [];
    const popularAllergens = [
      'лактоза',
      'глютен',
      'арахис',
      'орехи',
      'морепродукты',
      'яйца',
      'соя',
      'рыба',
    ];
    const baseRecommendations = [
      {
        title: 'Пейте воду в течение дня',
        description: 'Поддерживайте уровень гидратации: 30 мл на кг веса.',
        category: 'nutrition',
      },
      {
        title: 'Регулярные приемы пищи',
        description: 'Старайтесь есть 3-4 раза в день с равными интервалами.',
        category: 'habits',
      },
    ];
    const products = [
      { name: 'Куриная грудка', category: 'lunch', calories: 165, protein: 31, fat: 3.6, carbs: 0 },
      { name: 'Овсянка', category: 'breakfast', calories: 352, protein: 12, fat: 6, carbs: 61 },
      { name: 'Греческий йогурт', category: 'snack', calories: 73, protein: 10, fat: 2, carbs: 4 },
    ];

    const bootstrapUsers = [
      ...(adminPassword
        ? [
            {
              email: adminEmail,
              password: adminPassword,
              role: 'admin',
              birthDate: '1990-01-01',
            },
          ]
        : []),
      ...demoUsers,
    ];

    for (const entry of bootstrapUsers) {
      const existing = await this.sequelize.query<{ id: number }>(
        'SELECT id FROM users WHERE email = :email LIMIT 1',
        {
          replacements: { email: entry.email },
          type: QueryTypes.SELECT,
        },
      );
      if (existing.length > 0) continue;

      await this.sequelize.query(
        'INSERT INTO users (email, password, role, "birthDate", "createdAt", "updatedAt") VALUES (:email, :password, :role, :birthDate, NOW(), NOW())',
        {
          replacements: {
            email: entry.email,
            password: await hashPassword(entry.password),
            role: entry.role,
            birthDate: entry.birthDate,
          },
        },
      );
      this.logger.log(`Пользователь создан: ${entry.email}`);
    }

    for (const allergenName of popularAllergens) {
      await this.sequelize.query(
        `INSERT INTO allergens (id, name, severity, "createdAt")
         SELECT CAST(:id AS uuid), :name, 'moderate', NOW()
         WHERE NOT EXISTS (SELECT 1 FROM allergens WHERE name = :name)`,
        {
          replacements: { id: randomUUID(), name: allergenName },
        },
      );
    }

    for (const rec of baseRecommendations) {
      await this.sequelize.query(
        `INSERT INTO base_recommendations (id, title, description, category, audience, "createdAt", "updatedAt")
         SELECT :id, :title, :description, :category, 'all', NOW(), NOW()
         WHERE NOT EXISTS (SELECT 1 FROM base_recommendations WHERE title = :title)`,
        { replacements: { ...rec, id: randomUUID() } },
      );
    }

    const countRows = await this.sequelize.query<{ cnt: number }>(
      'SELECT COUNT(*)::int AS cnt FROM products',
      { type: QueryTypes.SELECT },
    );
    const productCount = Number(countRows[0]?.cnt ?? 0);
    if (productCount === 0) {
      for (const product of products) {
        await this.sequelize.query(
          `INSERT INTO products (id, name, category, calories, protein, fat, carbs, allergens, "createdAt", "updatedAt")
           SELECT :id, :name, :category, :calories, :protein, :fat, :carbs, ARRAY[]::varchar[], NOW(), NOW()
           WHERE NOT EXISTS (SELECT 1 FROM products WHERE name = :name)`,
          { replacements: { ...product, id: randomUUID() } },
        );
      }
    }
  }
}
