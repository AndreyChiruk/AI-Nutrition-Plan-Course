-- 022_performance_indexes.sql
--
-- Индексы для внешних ключей и частых выборок.
--
-- Зачем: PostgreSQL НЕ создаёт индексы автоматически для внешних ключей.
-- При удалении родительской строки СУБД проверяет дочерние таблицы полным
-- сканированием, а соединения (JOIN) по этим колонкам работают медленно.
--
-- Найдено запросом по pg_constraint: колонки внешних ключей без индекса.

-- План -> дни плана: используется при каждом чтении плана (include: [MealPlanDay]).
CREATE INDEX IF NOT EXISTS meal_plan_days_plan_idx
  ON meal_plan_days ("mealPlanId");

-- Тренировочный план -> дни.
CREATE INDEX IF NOT EXISTS workout_plan_days_plan_idx
  ON workout_plan_days ("workoutPlanId");

-- Уведомления -> приём пищи (связь для перехода к деталям).
CREATE INDEX IF NOT EXISTS notifications_meal_idx
  ON notifications ("relatedMealId")
  WHERE "relatedMealId" IS NOT NULL;

-- Кто исправил распознавание (для аудита действий администраторов).
CREATE INDEX IF NOT EXISTS meals_corrected_by_idx
  ON meals ("correctedByAdminId")
  WHERE "correctedByAdminId" IS NOT NULL;

-- Частые выборки по статусу и времени: очередь модерации и лента.
CREATE INDEX IF NOT EXISTS meals_status_recognized_idx
  ON meals (status, "recognizedAt" DESC);

-- Поиск блюд по названию (ILIKE '%...%') — помогает при сортировке/фильтрах.
CREATE INDEX IF NOT EXISTS products_name_lower_idx
  ON products (lower(name));

-- Связь пользователя с аллергенами: проверка профиля при каждом распознавании.
CREATE INDEX IF NOT EXISTS user_allergies_user_idx
  ON user_allergies ("userId");
CREATE INDEX IF NOT EXISTS user_allergies_allergen_idx
  ON user_allergies ("allergenId");

-- Элементы приёма пищи: подтягиваются при модерации и в статистике.
CREATE INDEX IF NOT EXISTS meal_items_meal_idx2
  ON meal_items ("mealId");

-- Диагностика: сколько внешних ключей всё ещё без индекса.
DO $$
DECLARE
  missing int;
  names text;
BEGIN
  SELECT count(*), string_agg(c.relname || '.' || a.attname, ', ')
  INTO missing, names
  FROM pg_constraint con
  JOIN pg_class c ON c.oid = con.conrelid
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
  WHERE con.contype = 'f'
    AND c.relname NOT LIKE 'pg_%'
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND a.attnum = ANY(i.indkey)
    );

  IF missing = 0 THEN
    RAISE NOTICE 'Все внешние ключи покрыты индексами';
  ELSE
    RAISE NOTICE 'Внешних ключей без индекса: % (%)', missing, names;
  END IF;
END $$;
