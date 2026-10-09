-- 019_single_active_meal_plan.sql
--
-- Гарантия на уровне БД: у пользователя не может быть более одного активного плана.
--
-- Причина: `saveUserPlan` выполнял архивацию, создание плана и запись дней
-- тремя независимыми запросами. Два параллельных вызова (двойной клик по
-- «Сгенерировать», одновременный вызов /duration) могли создать два активных
-- плана, а `getActivePlan` использовал findOne без сортировки — какой план
-- увидит пользователь, зависело от порядка строк в таблице.
--
-- Сначала приводим данные в порядок: если активных планов несколько,
-- оставляем самый свежий, остальные помечаем завершёнными.

WITH ranked AS (
  SELECT id,
         ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt" DESC, id DESC) AS rn
  FROM meal_plans
  WHERE status = 'active'
)
UPDATE meal_plans
SET status = 'completed'
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Частичный уникальный индекс: ограничение действует только на активные планы.
CREATE UNIQUE INDEX IF NOT EXISTS meal_plans_one_active_per_user_idx
  ON meal_plans ("userId")
  WHERE status = 'active';

-- Индекс для выборки планов пользователя (используется в listUserPlans/getActivePlan).
CREATE INDEX IF NOT EXISTS meal_plans_user_status_idx
  ON meal_plans ("userId", status);

-- Диагностика: после миграции не должно остаться пользователей с >1 активным планом.
DO $$
DECLARE
  dupes int;
BEGIN
  SELECT count(*) INTO dupes FROM (
    SELECT "userId" FROM meal_plans WHERE status = 'active'
    GROUP BY "userId" HAVING count(*) > 1
  ) x;
  IF dupes > 0 THEN
    RAISE WARNING 'Найдено % пользователей с несколькими активными планами', dupes;
  ELSE
    RAISE NOTICE 'Инвариант «один активный план на пользователя» соблюдён';
  END IF;
END $$;

-- Индексы для часто используемых выборок (ранее отсутствовали).
CREATE INDEX IF NOT EXISTS meals_user_idx ON meals ("userId");
CREATE INDEX IF NOT EXISTS meals_status_idx ON meals (status);
CREATE INDEX IF NOT EXISTS meal_items_meal_idx ON meal_items ("mealId");
CREATE INDEX IF NOT EXISTS body_analyses_user_idx ON body_analyses ("userId");
CREATE INDEX IF NOT EXISTS chat_messages_user_idx ON chat_messages ("userId");
CREATE INDEX IF NOT EXISTS suggestions_user_idx ON suggestions ("userId");
CREATE INDEX IF NOT EXISTS workout_plans_user_idx ON workout_plans ("userId");
CREATE INDEX IF NOT EXISTS email_verification_codes_lookup_idx
  ON email_verification_codes (email, purpose);
CREATE INDEX IF NOT EXISTS fridge_items_user_idx2 ON fridge_items ("userId");
