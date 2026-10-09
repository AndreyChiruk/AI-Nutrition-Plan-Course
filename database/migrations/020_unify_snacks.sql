-- 020_unify_snacks.sql
--
-- Единое представление перекусов дня.
--
-- Было две колонки: `snacks` (массив) и `extra_snacks` (массив), при этом:
--   - генератор плана создаёт до 3 перекусов (`snack` + `extraSnacks`);
--   - `saveUserPlan` писал в `snacks` ровно ОДИН элемент (`[d.snack]`),
--     остальные — в `extra_snacks`;
--   - чтение брало только `snacks[0]`, а `extra_snacks` подхватывалось
--     не везде — при клонировании плана второй перекус терялся.
--
-- Итог: пользователь видел день на ~2200 ккал вместо 3000.
--
-- Приводим данные к единому виду: ВСЕ перекусы лежат в `snacks`.
-- `extra_snacks` оставляем как «то же без первого элемента» — это нужно
-- старому фронтенду, который читает оба поля.

-- 1. Дни, где в extra_snacks есть данные, а в snacks только один элемент:
--    объединяем оба массива в snacks.
UPDATE meal_plan_days
SET snacks = COALESCE(snacks, '[]'::jsonb) || COALESCE(extra_snacks, '[]'::jsonb)
WHERE jsonb_typeof(COALESCE(extra_snacks, '[]'::jsonb)) = 'array'
  AND jsonb_array_length(COALESCE(extra_snacks, '[]'::jsonb)) > 0
  AND jsonb_typeof(COALESCE(snacks, '[]'::jsonb)) = 'array';

-- 2. Дни, где snacks пуст, а extra_snacks заполнен (обратный случай).
UPDATE meal_plan_days
SET snacks = COALESCE(extra_snacks, '[]'::jsonb)
WHERE jsonb_typeof(COALESCE(snacks, '[]'::jsonb)) <> 'array'
  AND jsonb_typeof(COALESCE(extra_snacks, '[]'::jsonb)) = 'array';

-- 3. Приводим extra_snacks к «всё, кроме первого элемента snacks».
UPDATE meal_plan_days
SET extra_snacks = COALESCE(
      (SELECT jsonb_agg(elem)
       FROM jsonb_array_elements(snacks) WITH ORDINALITY AS t(elem, ord)
       WHERE ord > 1),
      '[]'::jsonb
    )
WHERE jsonb_typeof(COALESCE(snacks, '[]'::jsonb)) = 'array';

-- 4. Диагностика.
DO $$
DECLARE
  total int;
  multi int;
BEGIN
  SELECT count(*) INTO total FROM meal_plan_days;
  SELECT count(*) INTO multi FROM meal_plan_days
    WHERE jsonb_typeof(snacks) = 'array' AND jsonb_array_length(snacks) > 1;
  RAISE NOTICE 'Дней всего: %, с несколькими перекусами: %', total, multi;
END $$;
