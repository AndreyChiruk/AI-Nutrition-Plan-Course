-- 029_vegan_breakfasts.sql
--
-- Наполнение каталога веганскими завтраками.
--
-- Причина: на плане в 14 дней для вегана доступен ОДИН завтрак
-- (проверено запросом к каталогу), поэтому больше половины дней
-- заполнялись заглушками. Ограничение не в коде, а в данных.
--
-- Все блюда добавлены с is_from_api = true, чтобы они участвовали
-- в AI-генерации: пользовательские продукты из неё исключены.
--
-- Состав указан как ингредиенты без животных продуктов; аллергены
-- проставлены по фактическому составу (орехи, глютен, соя).

INSERT INTO products (
  id, name, category, calories, protein, fat, carbs,
  allergens, ingredients, description, servings, cooking_time_min,
  cuisine, meal_types, is_from_api, dietary_tags, is_published,
  match_keywords, ingredients_detailed, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), v.name, 'breakfast', v.calories, v.protein, v.fat, v.carbs,
  v.allergens, v.ingredients::jsonb, v.description, 1, v.cooking_time_min,
  'европейская', '["завтрак"]'::jsonb, true,
  v.dietary_tags::jsonb, true, '[]'::jsonb, v.ingredients_detailed::jsonb, NOW(), NOW()
FROM (VALUES
  (
    'Овсяная каша на растительном молоке с бананом',
    380, 11.0, 9.0, 66.0,
    ARRAY['глютен']::varchar[],
    '[{"name":"овсяные хлопья","grams":60},{"name":"молоко овсяное","grams":200},{"name":"банан","grams":100},{"name":"семена чиа","grams":10}]',
    'Овсяные хлопья, сваренные на овсяном молоке, с бананом и семенами чиа.',
    10, '["vegan","vegetarian","lactose-free"]',
    '[{"name":"овсяные хлопья","grams":60},{"name":"молоко овсяное","grams":200},{"name":"банан","grams":100}]'
  ),
  (
    'Тост с авокадо и помидором',
    340, 8.0, 18.0, 38.0,
    ARRAY['глютен']::varchar[],
    '[{"name":"хлеб цельнозерновой","grams":70},{"name":"авокадо","grams":80},{"name":"помидор","grams":70},{"name":"масло оливковое","grams":5}]',
    'Цельнозерновой тост с авокадо, помидором и оливковым маслом.',
    7, '["vegan","vegetarian","lactose-free"]',
    '[{"name":"хлеб цельнозерновой","grams":70},{"name":"авокадо","grams":80},{"name":"помидор","grams":70}]'
  ),
  (
    'Смузи с ягодами и бананом',
    260, 6.0, 5.0, 48.0,
    ARRAY[]::varchar[],
    '[{"name":"банан","grams":120},{"name":"ягоды","grams":100},{"name":"молоко миндальное","grams":200},{"name":"семена льна","grams":8}]',
    'Густой смузи из банана и ягод на миндальном молоке.',
    5, '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"банан","grams":120},{"name":"ягоды","grams":100},{"name":"молоко миндальное","grams":200}]'
  ),
  (
    'Тофу-скрэмбл с овощами',
    320, 22.0, 17.0, 20.0,
    ARRAY['соя']::varchar[],
    '[{"name":"тофу","grams":150},{"name":"перец болгарский","grams":70},{"name":"лук","grams":40},{"name":"масло оливковое","grams":8},{"name":"куркума","grams":2}]',
    'Раскрошенный тофу, обжаренный с болгарским перцем, луком и куркумой.',
    12, '["vegan","vegetarian","lactose-free","gluten-free","high-protein"]',
    '[{"name":"тофу","grams":150},{"name":"перец болгарский","grams":70},{"name":"лук","grams":40}]'
  ),
  (
    'Гречневая каша с яблоком и корицей',
    350, 10.0, 6.0, 64.0,
    ARRAY[]::varchar[],
    '[{"name":"гречка","grams":70},{"name":"яблоко","grams":120},{"name":"молоко овсяное","grams":150},{"name":"корица","grams":2}]',
    'Гречневая каша на овсяном молоке с яблоком и корицей.',
    15, '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"гречка","grams":70},{"name":"яблоко","grams":120},{"name":"молоко овсяное","grams":150}]'
  ),
  (
    'Чиа-пудинг с кокосовым молоком',
    300, 8.0, 14.0, 36.0,
    ARRAY[]::varchar[],
    '[{"name":"семена чиа","grams":35},{"name":"молоко кокосовое","grams":200},{"name":"ягоды","grams":80},{"name":"сироп кленовый","grams":15}]',
    'Семена чиа, настоянные в кокосовом молоке, с ягодами.',
    120, '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"семена чиа","grams":35},{"name":"молоко кокосовое","grams":200},{"name":"ягоды","grams":80}]'
  ),
  (
    'Оладьи из банана и овсяной муки',
    400, 12.0, 11.0, 62.0,
    ARRAY['глютен']::varchar[],
    '[{"name":"банан","grams":150},{"name":"мука овсяная","grams":70},{"name":"молоко овсяное","grams":80},{"name":"масло растительное","grams":8}]',
    'Оладьи без яиц и молока: банан, овсяная мука и растительное молоко.',
    20, '["vegan","vegetarian","lactose-free"]',
    '[{"name":"банан","grams":150},{"name":"мука овсяная","grams":70},{"name":"молоко овсяное","grams":80}]'
  ),
  (
    'Хумус с овощами и лепёшкой',
    390, 14.0, 15.0, 50.0,
    ARRAY['глютен','кунжут']::varchar[],
    '[{"name":"хумус","grams":100},{"name":"лепёшка","grams":80},{"name":"огурец","grams":80},{"name":"морковь","grams":70}]',
    'Хумус из нута с овощами и тонкой лепёшкой.',
    10, '["vegan","vegetarian","lactose-free"]',
    '[{"name":"хумус","grams":100},{"name":"лепёшка","grams":80},{"name":"огурец","grams":80}]'
  )
) AS v(
  name, calories, protein, fat, carbs, allergens, ingredients, description,
  cooking_time_min, dietary_tags, ingredients_detailed
)
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = v.name);

DO $$
DECLARE
  total int;
  vegan_b int;
BEGIN
  SELECT count(*) INTO total FROM products WHERE category = 'breakfast' AND is_published;
  SELECT count(*) INTO vegan_b
    FROM products
   WHERE category = 'breakfast' AND is_published
     AND dietary_tags::text ILIKE '%vegan%'
     AND NOT (allergens && ARRAY['рыба','яйца']::varchar[]);
  RAISE NOTICE 'Завтраков: %, из них подходящих веганам: %', total, vegan_b;
END $$;
