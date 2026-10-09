-- 030_more_vegan_meals.sql
--
-- Расширение каталога веганскими блюдами.
--
-- Причина: из 32 завтраков 23 содержат яйца, веганских всего 4.
-- На план в 14 дней этого мало — при нехватке вариантов часть дней
-- заполнялась повторами, а до этого заглушками.
--
-- Блюда добавлены с is_from_api = true: только проверенный каталог
-- участвует в AI-генерации.
--
-- Аллергены проставлены по фактическому составу. Все блюда без
-- продуктов животного происхождения, поэтому тег vegan корректен:
-- веганская диета проверяется именно по этому тегу.

INSERT INTO products (
  id, name, category, calories, protein, fat, carbs,
  allergens, ingredients, description, servings, cooking_time_min,
  cuisine, meal_types, is_from_api, dietary_tags, is_published,
  match_keywords, ingredients_detailed, "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(), v.name, v.category, v.calories, v.protein, v.fat, v.carbs,
  v.allergens, v.ingredients::jsonb, v.description, 1, v.cooking_time_min,
  'европейская', v.meal_types::jsonb, true,
  v.dietary_tags::jsonb, true, '[]'::jsonb, v.ingredients_detailed::jsonb, NOW(), NOW()
FROM (VALUES
  -- ─── Завтраки ───────────────────────────────────────────────────────
  (
    'Пшённая каша с тыквой', 'breakfast', 330, 9.0, 6.0, 60.0,
    ARRAY[]::varchar[],
    '[{"name":"пшено","grams":70},{"name":"тыква","grams":150},{"name":"молоко овсяное","grams":150}]',
    'Пшённая каша с запечённой тыквой на овсяном молоке.',
    25, '["завтрак"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"пшено","grams":70},{"name":"тыква","grams":150},{"name":"молоко овсяное","grams":150}]'
  ),
  (
    'Рисовая каша с кокосом и манго', 'breakfast', 360, 7.0, 11.0, 58.0,
    ARRAY[]::varchar[],
    '[{"name":"рис","grams":70},{"name":"молоко кокосовое","grams":180},{"name":"манго","grams":100},{"name":"семена чиа","grams":8}]',
    'Рисовая каша на кокосовом молоке с манго.',
    25, '["завтрак"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"рис","grams":70},{"name":"молоко кокосовое","grams":180},{"name":"манго","grams":100}]'
  ),
  (
    'Кукурузная каша с яблоком', 'breakfast', 320, 8.0, 5.0, 62.0,
    ARRAY[]::varchar[],
    '[{"name":"крупа кукурузная","grams":70},{"name":"яблоко","grams":120},{"name":"молоко овсяное","grams":150}]',
    'Кукурузная каша на овсяном молоке с яблоком.',
    20, '["завтрак"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"крупа кукурузная","grams":70},{"name":"яблоко","grams":120},{"name":"молоко овсяное","grams":150}]'
  ),
  (
    'Гранола с растительным йогуртом', 'breakfast', 390, 12.0, 14.0, 55.0,
    ARRAY['глютен','орехи']::varchar[],
    '[{"name":"гранола","grams":60},{"name":"йогурт соевый","grams":150},{"name":"ягоды","grams":80}]',
    'Гранола с соевым йогуртом и свежими ягодами.',
    5, '["завтрак"]', '["vegan","vegetarian","lactose-free"]',
    '[{"name":"гранола","grams":60},{"name":"йогурт соевый","grams":150},{"name":"ягоды","grams":80}]'
  ),
  (
    'Смузи-боул с киноа', 'breakfast', 350, 11.0, 10.0, 54.0,
    ARRAY[]::varchar[],
    '[{"name":"киноа","grams":50},{"name":"банан","grams":100},{"name":"ягоды","grams":80},{"name":"молоко миндальное","grams":150}]',
    'Киноа с ягодами и бананом, залитое миндальным молоком.',
    15, '["завтрак"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"киноа","grams":50},{"name":"банан","grams":100},{"name":"ягоды","grams":80}]'
  ),
  (
    'Тости с фасолью и томатами', 'breakfast', 370, 15.0, 9.0, 56.0,
    ARRAY['глютен']::varchar[],
    '[{"name":"хлеб цельнозерновой","grams":70},{"name":"фасоль белая","grams":120},{"name":"помидор","grams":80},{"name":"масло оливковое","grams":6}]',
    'Поджаренный хлеб с тушёной белой фасолью в томатах.',
    15, '["завтрак"]', '["vegan","vegetarian","lactose-free"]',
    '[{"name":"хлеб цельнозерновой","grams":70},{"name":"фасоль белая","grams":120},{"name":"помидор","grams":80}]'
  ),
  (
    'Овсяноблин с тофу и зеленью', 'breakfast', 340, 18.0, 13.0, 36.0,
    ARRAY['глютен','соя']::varchar[],
    '[{"name":"овсяная мука","grams":50},{"name":"тофу","grams":120},{"name":"шпинат","grams":50},{"name":"масло растительное","grams":6}]',
    'Тонкий блин из овсяной муки с тофу и шпинатом.',
    20, '["завтрак"]', '["vegan","vegetarian","lactose-free","high-protein"]',
    '[{"name":"овсяная мука","grams":50},{"name":"тофу","grams":120},{"name":"шпинат","grams":50}]'
  ),
  (
    'Яблочный крамбл с овсянкой', 'breakfast', 380, 8.0, 12.0, 62.0,
    ARRAY['глютен','орехи']::varchar[],
    '[{"name":"яблоко","grams":150},{"name":"овсяные хлопья","grams":50},{"name":"мука миндальная","grams":20},{"name":"масло кокосовое","grams":10}]',
    'Запечённые яблоки под овсяно-миндальной крошкой.',
    30, '["завтрак"]', '["vegan","vegetarian","lactose-free"]',
    '[{"name":"яблоко","grams":150},{"name":"овсяные хлопья","grams":50},{"name":"мука миндальная","grams":20}]'
  ),
  (
    'Панкейки из киноа и банана', 'breakfast', 400, 13.0, 12.0, 60.0,
    ARRAY[]::varchar[],
    '[{"name":"киноа","grams":60},{"name":"банан","grams":120},{"name":"молоко овсяное","grams":100},{"name":"масло растительное","grams":8}]',
    'Панкейки из киноа с бананом, без яиц и молока.',
    25, '["завтрак"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"киноа","grams":60},{"name":"банан","grams":120},{"name":"молоко овсяное","grams":100}]'
  ),
  (
    'Сэндвич с хумусом и огурцом', 'breakfast', 330, 12.0, 13.0, 42.0,
    ARRAY['глютен','кунжут']::varchar[],
    '[{"name":"хлеб цельнозерновой","grams":70},{"name":"хумус","grams":80},{"name":"огурец","grams":80},{"name":"морковь","grams":50}]',
    'Сэндвич с хумусом, свежим огурцом и морковью.',
    10, '["завтрак"]', '["vegan","vegetarian","lactose-free"]',
    '[{"name":"хлеб цельнозерновой","grams":70},{"name":"хумус","grams":80},{"name":"огурец","grams":80}]'
  ),
  -- ─── Обеды ──────────────────────────────────────────────────────────
  (
    'Чечевичный суп с овощами', 'lunch', 340, 20.0, 7.0, 48.0,
    ARRAY['сельдерей']::varchar[],
    '[{"name":"чечевица","grams":90},{"name":"морковь","grams":70},{"name":"лук","grams":50},{"name":"сельдерей","grams":40},{"name":"помидор","grams":80}]',
    'Густой суп из красной чечевицы с корнеплодами.',
    40, '["обед"]', '["vegan","vegetarian","lactose-free","gluten-free","high-protein"]',
    '[{"name":"чечевица","grams":90},{"name":"морковь","grams":70},{"name":"лук","grams":50}]'
  ),
  (
    'Булгур с овощами и нутом', 'lunch', 420, 16.0, 10.0, 66.0,
    ARRAY['глютен']::varchar[],
    '[{"name":"булгур","grams":80},{"name":"нут","grams":100},{"name":"перец болгарский","grams":80},{"name":"масло оливковое","grams":8}]',
    'Булгур с нутом и запечённым болгарским перцем.',
    30, '["обед"]', '["vegan","vegetarian","lactose-free"]',
    '[{"name":"булгур","grams":80},{"name":"нут","grams":100},{"name":"перец болгарский","grams":80}]'
  ),
  (
    'Карри из нута с рисом', 'lunch', 480, 17.0, 14.0, 70.0,
    ARRAY[]::varchar[],
    '[{"name":"нут","grams":120},{"name":"рис","grams":80},{"name":"молоко кокосовое","grams":100},{"name":"лук","grams":50},{"name":"куркума","grams":3}]',
    'Пряное карри из нута на кокосовом молоке с рисом.',
    35, '["обед"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"нут","grams":120},{"name":"рис","grams":80},{"name":"молоко кокосовое","grams":100}]'
  ),
  (
    'Тушёная капуста с фасолью', 'lunch', 360, 18.0, 9.0, 52.0,
    ARRAY[]::varchar[],
    '[{"name":"капуста","grams":200},{"name":"фасоль красная","grams":120},{"name":"морковь","grams":60},{"name":"масло растительное","grams":8}]',
    'Тушёная капуста с красной фасолью и морковью.',
    40, '["обед"]', '["vegan","vegetarian","lactose-free","gluten-free","high-protein"]',
    '[{"name":"капуста","grams":200},{"name":"фасоль красная","grams":120},{"name":"морковь","grams":60}]'
  ),
  (
    'Гречка с грибами и луком', 'lunch', 380, 14.0, 9.0, 62.0,
    ARRAY[]::varchar[],
    '[{"name":"гречка","grams":90},{"name":"шампиньоны","grams":120},{"name":"лук","grams":60},{"name":"масло растительное","grams":8}]',
    'Гречневая каша с обжаренными шампиньонами и луком.',
    30, '["обед"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"гречка","grams":90},{"name":"шампиньоны","grams":120},{"name":"лук","grams":60}]'
  ),
  -- ─── Ужины ──────────────────────────────────────────────────────────
  (
    'Овощное рагу с тофу', 'dinner', 380, 22.0, 18.0, 30.0,
    ARRAY['соя']::varchar[],
    '[{"name":"тофу","grams":150},{"name":"кабачок","grams":120},{"name":"перец болгарский","grams":80},{"name":"помидор","grams":80}]',
    'Рагу из кабачка и перца с обжаренным тофу.',
    30, '["ужин"]', '["vegan","vegetarian","lactose-free","gluten-free","high-protein"]',
    '[{"name":"тофу","grams":150},{"name":"кабачок","grams":120},{"name":"перец болгарский","grams":80}]'
  ),
  (
    'Киноа с запечёнными овощами', 'dinner', 400, 14.0, 13.0, 58.0,
    ARRAY[]::varchar[],
    '[{"name":"киноа","grams":80},{"name":"баклажан","grams":120},{"name":"кабачок","grams":100},{"name":"масло оливковое","grams":10}]',
    'Киноа с запечёнными баклажаном и кабачком.',
    35, '["ужин"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"киноа","grams":80},{"name":"баклажан","grams":120},{"name":"кабачок","grams":100}]'
  ),
  (
    'Фаршированный перец рисом и овощами', 'dinner', 390, 13.0, 11.0, 60.0,
    ARRAY[]::varchar[],
    '[{"name":"перец болгарский","grams":200},{"name":"рис","grams":70},{"name":"морковь","grams":60},{"name":"лук","grams":50}]',
    'Болгарский перец, фаршированный рисом с овощами.',
    50, '["ужин"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"перец болгарский","grams":200},{"name":"рис","grams":70},{"name":"морковь","grams":60}]'
  ),
  (
    'Чечевичная запеканка', 'dinner', 410, 21.0, 12.0, 54.0,
    ARRAY[]::varchar[],
    '[{"name":"чечевица","grams":120},{"name":"картофель","grams":120},{"name":"морковь","grams":60},{"name":"масло растительное","grams":8}]',
    'Запеканка из чечевицы с картофелем и морковью.',
    50, '["ужин"]', '["vegan","vegetarian","lactose-free","gluten-free","high-protein"]',
    '[{"name":"чечевица","grams":120},{"name":"картофель","grams":120},{"name":"морковь","grams":60}]'
  ),
  (
    'Тушёные баклажаны с нутом', 'dinner', 370, 16.0, 14.0, 44.0,
    ARRAY[]::varchar[],
    '[{"name":"баклажан","grams":200},{"name":"нут","grams":110},{"name":"помидор","grams":100},{"name":"масло оливковое","grams":10}]',
    'Баклажаны, тушённые с нутом и помидорами.',
    40, '["ужин"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"баклажан","grams":200},{"name":"нут","grams":110},{"name":"помидор","grams":100}]'
  ),
  -- ─── Перекусы ───────────────────────────────────────────────────────
  (
    'Яблоко с ореховой пастой', 'snack', 220, 6.0, 13.0, 22.0,
    ARRAY['орехи']::varchar[],
    '[{"name":"яблоко","grams":150},{"name":"паста ореховая","grams":25}]',
    'Свежее яблоко с ложкой ореховой пасты.',
    3, '["перекус"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"яблоко","grams":150},{"name":"паста ореховая","grams":25}]'
  ),
  (
    'Хумус с морковными палочками', 'snack', 190, 8.0, 10.0, 20.0,
    ARRAY['кунжут']::varchar[],
    '[{"name":"хумус","grams":80},{"name":"морковь","grams":120}]',
    'Хумус из нута с палочками моркови.',
    5, '["перекус"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"хумус","grams":80},{"name":"морковь","grams":120}]'
  ),
  (
    'Энергетические шарики из фиников', 'snack', 240, 5.0, 10.0, 36.0,
    ARRAY['орехи']::varchar[],
    '[{"name":"финики","grams":60},{"name":"миндаль","grams":25},{"name":"какао","grams":8}]',
    'Шарики из фиников, миндаля и какао без сахара.',
    15, '["перекус"]', '["vegan","vegetarian","lactose-free","gluten-free"]',
    '[{"name":"финики","grams":60},{"name":"миндаль","grams":25},{"name":"какао","grams":8}]'
  ),
  (
    'Соевый йогурт с семенами', 'snack', 180, 10.0, 8.0, 18.0,
    ARRAY['соя']::varchar[],
    '[{"name":"йогурт соевый","grams":150},{"name":"семена тыквы","grams":15}]',
    'Соевый йогурт с тыквенными семенами.',
    2, '["перекус"]', '["vegan","vegetarian","lactose-free","gluten-free","high-protein"]',
    '[{"name":"йогурт соевый","grams":150},{"name":"семена тыквы","grams":15}]'
  )
) AS v(
  name, category, calories, protein, fat, carbs, allergens, ingredients,
  description, cooking_time_min, meal_types, dietary_tags, ingredients_detailed
)
WHERE NOT EXISTS (SELECT 1 FROM products p WHERE p.name = v.name);

DO $$
DECLARE
  vegan_b int;
  vegan_l int;
  vegan_d int;
  vegan_s int;
BEGIN
  SELECT count(*) INTO vegan_b FROM products WHERE category='breakfast' AND is_published
    AND dietary_tags::text ILIKE '%vegan%' AND NOT (allergens && ARRAY['рыба','яйца']::varchar[]);
  SELECT count(*) INTO vegan_l FROM products WHERE category='lunch' AND is_published
    AND dietary_tags::text ILIKE '%vegan%' AND NOT (allergens && ARRAY['рыба','яйца']::varchar[]);
  SELECT count(*) INTO vegan_d FROM products WHERE category='dinner' AND is_published
    AND dietary_tags::text ILIKE '%vegan%' AND NOT (allergens && ARRAY['рыба','яйца']::varchar[]);
  SELECT count(*) INTO vegan_s FROM products WHERE category='snack' AND is_published
    AND dietary_tags::text ILIKE '%vegan%' AND NOT (allergens && ARRAY['рыба','яйца']::varchar[]);
  RAISE NOTICE 'Веганских без рыбы и яиц — завтраки: %, обеды: %, ужины: %, перекусы: %',
    vegan_b, vegan_l, vegan_d, vegan_s;
END $$;
