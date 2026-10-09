-- 025_plan_restriction_snapshot.sql
--
-- Снимок ограничений пользователя на момент генерации плана.
--
-- Зачем: если пользователь сгенерировал план, а затем изменил аллергии,
-- тип диеты или нежелательные продукты, старый план всё ещё можно было
-- назначить текущим — хотя он не соответствует новым ограничениям.
-- Например, в плане оставались блюда с рыбой после того, как у
-- пользователя появилась аллергия на рыбу.
--
-- Теперь при генерации сохраняется копия ограничений:
--   {
--     "allergies": ["рыба", "яйца"],
--     "diet": "vegan",
--     "dislikes": ["грибы"],
--     "goal": "lose",
--     "age": 17
--   }
--
-- При попытке сделать план текущим ограничения сравниваются со снимком.
-- Если они различаются — интерфейс предупреждает и предлагает
-- пересоздать план.
--
-- Формат JSONB (а не отдельные колонки): набор ограничений может
-- расширяться, а сравнивать нужно снимок целиком.

ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS restrictions_snapshot JSONB;

-- Признак того, что план требует пересоздания из-за изменившихся
-- ограничений. Вычисляется на сервере при чтении плана, хранится, чтобы
-- интерфейс мог показать метку без повторного расчёта.
ALTER TABLE meal_plans
  ADD COLUMN IF NOT EXISTS restrictions_changed BOOLEAN NOT NULL DEFAULT false;

-- Индекс для быстрого поиска планов, требующих внимания пользователя.
CREATE INDEX IF NOT EXISTS meal_plans_restrictions_changed_idx
  ON meal_plans (user_id, restrictions_changed)
  WHERE restrictions_changed = true;

DO $$
DECLARE
  total int;
  with_snapshot int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE restrictions_snapshot IS NOT NULL)
    INTO total, with_snapshot
    FROM meal_plans;
  RAISE NOTICE 'Планов всего: %, со снимком ограничений: %', total, with_snapshot;
END $$;
