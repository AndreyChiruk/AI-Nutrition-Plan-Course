-- 026_dish_alcohol_flag.sql
--
-- Признак того, что блюдо содержит алкоголь.
--
-- Зачем: в каталоге есть коктейли и блюда с вином, пивом и сидром
-- («Коктейль с водкой и джином», «Тушёная свинина с сидром»,
-- «Мохито с черникой»). Они попадали в план питания несовершеннолетним:
-- ограничения по возрасту нигде не проверялись, хотя `users.birth_date`
-- заполняется в профиле.
--
-- Флаг ставится:
--   1. автоматически при импорте и пересчёте каталога — по составу
--      и названию (см. `detectAlcohol` в catalog-nutrition.util.ts);
--   2. вручную администратором в карточке блюда.
--
-- Значение по умолчанию `false`: существующие блюда не считаются
-- алкогольными, пока не пройдёт разметка.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS contains_alcohol BOOLEAN NOT NULL DEFAULT false;

-- Индекс нужен для фильтрации каталога и выбора пулов планировщика.
CREATE INDEX IF NOT EXISTS products_alcohol_idx
  ON products (contains_alcohol)
  WHERE contains_alcohol = true;

-- Первичная разметка: явные алкогольные напитки в названии.
-- Список намеренно узкий — ложные срабатывания хуже пропусков,
-- поэтому «виноград», «сыр», «Маргарита» (пицца) сюда не входят.
-- ВАЖНО: проверка идёт по границам слов.
-- Простая подстрока давала ложные срабатывания: «виноградные листья»
-- содержит «вино», из-за чего долма попадала в алкогольные блюда.
UPDATE products
SET contains_alcohol = true
WHERE
  -- 1. Алкоголь прямо в названии блюда.
  name ~* '(?<![а-яё])(водка|виски|коньяк|бренди|ликёр|ликер|настойка|текила|абсент|вермут|джин|саке|кампари|апероль|просекко|шампанск|мартини|мохито|дайкири|сангрия|глинтвейн|пунш|грог|сидр|пиво|лагер|коктейл|вино|ром|эль|порто|херес|шерри)(?![а-яё])'
  -- 2. Алкоголь в описании (текст может быть русским или английским).
  OR description ~* '(?<![а-яё])(водка|виски|коньяк|бренди|ликёр|ликер|ром|вино|пиво|сидр|джин|текила|абсент|вермут|саке|кампари|просекко|шампанское|мартини)(?![а-яё])'
  OR description ~* '(?<![a-z])(vodka|whisky|whiskey|brandy|rum|wine|beer|cider|gin|tequila|absinthe|vermouth|sake|liqueur|champagne|martini|prosecco)(?![a-z])'
  -- 3. Алкоголь как отдельный ингредиент состава.
  OR EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(ingredients, '[]'::jsonb)) AS _ai
    WHERE (_ai->>'name') ~* '(?<![а-яё])(водка|виски|коньяк|бренди|ликёр|ликер|ром|вино|пиво|сидр|джин|текила|абсент|вермут|саке|кампари|просекко|шампанское|мартини|херес|порто)(?![а-яё])'
       OR (_ai->>'name') ~* '(?<![a-z])(vodka|whisky|whiskey|brandy|rum|wine|beer|cider|gin|tequila|absinthe|vermouth|sake|liqueur|champagne|martini|prosecco)(?![a-z])'
  );

-- Снимаем флаг там, где сработало ложное совпадение:
-- «виноградные листья», «виноград», «сыр» и подобное.
UPDATE products
SET contains_alcohol = false
WHERE contains_alcohol = true
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(ingredients, '[]'::jsonb)) AS _ai
    WHERE (_ai->>'name') ~* '(?<![а-яё])(водка|виски|коньяк|бренди|ликёр|ликер|ром|вино|пиво|сидр|джин|текила|абсент|вермут|саке|кампари|просекко|шампанское|мартини|херес|порто)(?![а-яё])'
       OR (_ai->>'name') ~* '(?<![a-z])(vodka|whisky|whiskey|brandy|rum|wine|beer|cider|gin|tequila|absinthe|vermouth|sake|liqueur|champagne|martini|prosecco)(?![a-z])'
  )
  AND name !~* '(?<![а-яё])(водка|виски|коньяк|бренди|ликёр|ликер|настойка|текила|абсент|вермут|джин|саке|кампари|апероль|просекко|шампанск|мартини|мохито|дайкири|сангрия|глинтвейн|пунш|грог|сидр|пиво|лагер|коктейл)(?![а-яё])';

DO $$
DECLARE
  alcohol int;
  minors int;
BEGIN
  SELECT count(*) INTO alcohol FROM products WHERE contains_alcohol;
  SELECT count(*) INTO minors FROM users WHERE "birthDate" IS NOT NULL
    AND "birthDate" > (CURRENT_DATE - INTERVAL '18 years');
  RAISE NOTICE 'Блюд с алкоголем: %, пользователей младше 18: %', alcohol, minors;
END $$;
