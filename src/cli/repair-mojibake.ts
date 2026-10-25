/**
 * Восстановление данных, повреждённых перекодированием UTF-8 ↔ CP866
 * при переносе проекта через дамп БД с неверной кодировкой клиента.
 *
 * Запуск:
 *   npm run repair:mojibake            # применить исправления
 *   npm run repair:mojibake -- --dry-run   # только показать, что будет изменено
 *
 * Скрипт идемпотентен: повторный запуск не меняет уже исправленные данные.
 */
import { Sequelize } from 'sequelize';
import {
  looksLikeMojibake,
  recoverDeep,
  recoverIfMojibake,
} from '../common/text-recovery.util';

type RepairTarget = {
  label: string;
  table: string;
  column: string;
  /** Колонка с первичным ключом. */
  pk: string;
  /** Поле имеет тип JSONB — восстанавливаем рекурсивно. */
  json?: boolean;
  /** Поле имеет тип TEXT[] (массив строк) — восстанавливаем поэлементно. */
  array?: boolean;
  /**
   * Если восстановленное значение совпадает с уже существующей строкой,
   * удалить дубликат вместо обновления (иначе нарушится UNIQUE).
   * Для этого нужно знать таблицы связей, которые ссылаются на дубликат.
   */
  merge?: {
    /** Уникальная колонка, по которой определяется конфликт (обычно name). */
    uniqueColumn: string;
    /** Таблицы связей: куда перенаправить ссылки перед удалением дубликата. */
    references?: Array<{ table: string; column: string; onConflict?: 'ignore' | 'delete' }>;
  };
};

const TARGETS: RepairTarget[] = [
  { label: 'products.name', table: 'products', column: 'name', pk: 'id' },
  { label: 'products.ingredients', table: 'products', column: 'ingredients', pk: 'id', json: true },
  {
    label: 'products.ingredients_detailed',
    table: 'products',
    column: 'ingredients_detailed',
    pk: 'id',
    json: true,
  },
  { label: 'products.allergens', table: 'products', column: 'allergens', pk: 'id', array: true },
  { label: 'products.meal_types', table: 'products', column: 'meal_types', pk: 'id', json: true },
  { label: 'ingredients.name', table: 'ingredients', column: 'name', pk: 'id' },
  {
    label: 'allergens.name',
    table: 'allergens',
    column: 'name',
    pk: 'id',
    // В справочнике аллергенов есть и корректные, и повреждённые дубликаты
    // (8 + 8). Восстановленное имя совпадёт с существующим, поэтому
    // дубликат нужно не переименовать, а слить: перенаправить ссылки
    // в user_allergies и удалить лишнюю запись.
    merge: {
      uniqueColumn: 'name',
      references: [
        { table: 'user_allergies', column: 'allergenId', onConflict: 'ignore' },
      ],
    },
  },
  {
    label: 'base_recommendations.title',
    table: 'base_recommendations',
    column: 'title',
    pk: 'id',
  },
  {
    label: 'base_recommendations.description',
    table: 'base_recommendations',
    column: 'description',
    pk: 'id',
  },
  { label: 'meal_items.foodName', table: 'meal_items', column: 'foodName', pk: 'id' },
  {
    label: 'meal_items.allergensFound',
    table: 'meal_items',
    column: 'allergensFound',
    pk: 'id',
    array: true,
  },
  { label: 'meal_items.ingredients', table: 'meal_items', column: 'ingredients', pk: 'id', json: true },
  {
    label: 'meal_items.ingredients_detailed',
    table: 'meal_items',
    column: 'ingredients_detailed',
    pk: 'id',
    json: true,
  },
  { label: 'body_analyses.aiNotes', table: 'body_analyses', column: 'aiNotes', pk: 'id' },
  { label: 'meals.adminNote', table: 'meals', column: 'adminNote', pk: 'id' },
  { label: 'meal_plans.name', table: 'meal_plans', column: 'name', pk: 'id' },
  { label: 'suggestions.content', table: 'suggestions', column: 'content', pk: 'id', json: true },
  { label: 'chat_messages.content', table: 'chat_messages', column: 'content', pk: 'id' },
  { label: 'allergens.icon', table: 'allergens', column: 'icon', pk: 'id' },
  { label: 'ingredients.category', table: 'ingredients', column: 'category', pk: 'id' },
  // session2–session4 раньше отсутствовали в списке: снапшоты второй
  // тренировки дня оставались с битой кодировкой (140 записей).
  // Прогнозы тела и заметки анализа: пользователь видит их как текст.
  { label: 'body_analyses.aiNotes', table: 'body_analyses', column: 'aiNotes', pk: 'id' },
  // Прогноз тела хранится у пользователя (в body_analyses такой колонки нет).
  { label: 'users.bodyForecastPayload', table: 'users', column: 'bodyForecastPayload', pk: 'id', json: true },
  { label: 'users.bodyForecastIllustrationUrl', table: 'users', column: 'bodyForecastIllustrationUrl', pk: 'id' },
  {
    label: 'meal_plan_days.breakfast',
    table: 'meal_plan_days',
    column: 'breakfast',
    pk: 'id',
    json: true,
  },
  {
    label: 'meal_plan_days.lunch',
    table: 'meal_plan_days',
    column: 'lunch',
    pk: 'id',
    json: true,
  },
  {
    label: 'meal_plan_days.dinner',
    table: 'meal_plan_days',
    column: 'dinner',
    pk: 'id',
    json: true,
  },
  {
    label: 'meal_plan_days.snacks',
    table: 'meal_plan_days',
    column: 'snacks',
    pk: 'id',
    json: true,
  },
  {
    label: 'meal_plan_days.extra_snacks',
    table: 'meal_plan_days',
    column: 'extra_snacks',
    pk: 'id',
    json: true,
  },
];

function createSequelize(): Sequelize {
  return new Sequelize(
    process.env.POSTGRES_DB ?? process.env.DB_DATABASE ?? 'course',
    process.env.POSTGRES_USER ?? process.env.DB_USERNAME ?? 'course',
    process.env.POSTGRES_PASSWORD ?? process.env.DB_PASSWORD ?? 'course',
    {
      host: process.env.POSTGRES_HOST ?? process.env.DB_HOST ?? 'localhost',
      port: Number(process.env.POSTGRES_PORT ?? process.env.DB_PORT ?? 5432),
      dialect: 'postgres',
      logging: false,
    },
  );
}

/** Проверяет, повреждено ли значение (для строк и JSON рекурсивно). */
function isDamaged(value: unknown, json: boolean, array: boolean): boolean {
  if (value == null) return false;
  if (json || array) return JSON.stringify(value).length > 0 && hasDamageDeep(value);
  return looksLikeMojibake(value);
}

function hasDamageDeep(value: unknown): boolean {
  if (typeof value === 'string') return looksLikeMojibake(value);
  if (Array.isArray(value)) return value.some(hasDamageDeep);
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).some(hasDamageDeep);
  }
  return false;
}

async function repairTarget(
  sequelize: Sequelize,
  target: RepairTarget,
  dryRun: boolean,
): Promise<{ scanned: number; damaged: number; repaired: number }> {
  const { table, column, pk, json, array } = target;

  let rows: Array<Record<string, unknown>>;
  try {
    const [result] = await sequelize.query(
      `SELECT "${pk}" AS pk, "${column}" AS value FROM "${table}" WHERE "${column}" IS NOT NULL`,
    );
    rows = result as Array<Record<string, unknown>>;
  } catch (e) {
    console.log(`  ${target.label.padEnd(32)} пропущено (${(e as Error).message.slice(0, 60)})`);
    return { scanned: 0, damaged: 0, repaired: 0 };
  }

  let damaged = 0;
  let repaired = 0;
  let merged = 0;
  const updates: Array<{ pk: unknown; value: unknown }> = [];
  const merges: Array<{ pk: unknown; keepPk: unknown; value: unknown }> = [];

  // Существующие значения уникальной колонки — для обнаружения конфликтов слияния.
  const existingByValue = new Map<string, unknown>();
  if (target.merge) {
    const [existing] = await sequelize.query(
      `SELECT "${pk}" AS pk, "${target.merge.uniqueColumn}" AS v FROM "${table}"`,
    );
    for (const row of existing as Array<{ pk: unknown; v: unknown }>) {
      const key = String(row.v ?? '');
      if (key && !existingByValue.has(key)) existingByValue.set(key, row.pk);
    }
  }

  for (const row of rows) {
    if (!isDamaged(row.value, Boolean(json), Boolean(array))) continue;
    damaged += 1;

    const fixed = json || array ? recoverDeep(row.value) : recoverIfMojibake(row.value);
    if (JSON.stringify(fixed) === JSON.stringify(row.value)) continue;

    if (target.merge && !json && !array) {
      const key = String(fixed ?? '');
      const keepPk = existingByValue.get(key);
      if (keepPk !== undefined && String(keepPk) !== String(row.pk)) {
        // Восстановленное значение уже существует — сливаем с ним.
        merges.push({ pk: row.pk, keepPk, value: fixed });
        continue;
      }
      // Значения ещё нет — после обновления оно станет уникальным.
      existingByValue.set(key, row.pk);
    }

    updates.push({ pk: row.pk, value: fixed });
  }

  if (!dryRun) {
    await sequelize.transaction(async (t) => {
      // 1. Слияние дубликатов: перенаправляем ссылки и удаляем лишнюю строку.
      for (const m of merges) {
        for (const ref of target.merge?.references ?? []) {
          if (ref.onConflict === 'ignore') {
            // Ссылка может уже существовать — тогда просто удаляем дублирующую связь.
            await sequelize.query(
              `DELETE FROM "${ref.table}"
               WHERE "${ref.column}" = :dup
                 AND EXISTS (
                   SELECT 1 FROM "${ref.table}" x
                   WHERE x."${ref.column}" = :keep
                     AND x.ctid <> "${ref.table}".ctid
                 )`,
              { replacements: { dup: m.pk, keep: m.keepPk }, transaction: t },
            );
          }
          await sequelize.query(
            `UPDATE "${ref.table}" SET "${ref.column}" = :keep WHERE "${ref.column}" = :dup`,
            { replacements: { keep: m.keepPk, dup: m.pk }, transaction: t },
          );
        }
        await sequelize.query(`DELETE FROM "${table}" WHERE "${pk}" = :pk`, {
          replacements: { pk: m.pk },
          transaction: t,
        });
      }

      // 2. Обновление остальных значений.
      for (const u of updates) {
        // Для TEXT[]/VARCHAR[] постгресу нужен явный литерал массива,
        // иначе драйвер разбирает его как список значений.
        const value = array
          ? `{${(u.value as string[])
              .map((v) => '"' + String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"')
              .join(',')}}`
          : json
            ? JSON.stringify(u.value)
            : u.value;
        await sequelize.query(
          `UPDATE "${table}" SET "${column}" = :value WHERE "${pk}" = :pk`,
          { replacements: { value, pk: u.pk }, transaction: t },
        );
      }
    });
  }

  merged = merges.length;
  repaired = updates.length;

  console.log(
    `  ${target.label.padEnd(32)} всего=${String(rows.length).padEnd(6)} ` +
      `битых=${String(damaged).padEnd(6)} ${dryRun ? 'к исправлению' : 'исправлено'}=${repaired}` +
      (merged > 0 ? ` слияний=${merged}` : ''),
  );
  return { scanned: rows.length, damaged, repaired: repaired + merged };
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sequelize = createSequelize();

  console.log(
    `\nВосстановление повреждённых данных${dryRun ? ' (DRY-RUN, изменения не применяются)' : ''}\n`,
  );

  try {
    await sequelize.authenticate();
  } catch (e) {
    console.error(`Не удалось подключиться к БД: ${(e as Error).message}`);
    process.exitCode = 1;
    return;
  }

  let totalDamaged = 0;
  let totalRepaired = 0;

  try {
    for (const target of TARGETS) {
      const r = await repairTarget(sequelize, target, dryRun);
      totalDamaged += r.damaged;
      totalRepaired += r.repaired;
    }

    // Продукты с пустым/отсутствующим ingredients_detailed не восстановить —
    // сообщаем, чтобы было видно объём последующего бэкфилла.
    const [missing] = await sequelize.query(
      `SELECT count(*)::int AS n FROM products
       WHERE ingredients_detailed IS NULL
          OR ingredients_detailed::text IN ('[]','null')`,
    );
    const missingCount = (missing as Array<{ n: number }>)[0]?.n ?? 0;
    if (missingCount > 0) {
      console.log(
        `\n  Внимание: у ${missingCount} блюд отсутствует состав — их состав нужно дозаполнить отдельно.`,
      );
    }

    console.log(
      `\nИтого: битых значений ${totalDamaged}, ${dryRun ? 'будет исправлено' : 'исправлено'} ${totalRepaired}.`,
    );
    if (dryRun && totalRepaired > 0) {
      console.log('Запустите без --dry-run, чтобы применить изменения.\n');
    } else if (totalRepaired === 0) {
      console.log('Повреждённых данных не найдено — БД в порядке.\n');
    } else {
      console.log('Готово. Перезапустите приложение для переклассификации каталога.\n');
    }
  } finally {
    await sequelize.close();
  }
}

void main();
