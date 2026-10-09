-- 027_fridge_item_images.sql
--
-- Изображения продуктов в холодильнике.
--
-- Зачем: список холодильника состоял только из названий и количества.
-- Пользователь не мог ни увидеть, что за продукт, ни загрузить своё фото.
--
-- Источники изображения:
--   'catalog'     — взято из справочника ингредиентов или каталога блюд
--                   при добавлении продукта;
--   'user'        — загружено пользователем;
--   'placeholder' — заглушка по категории (значение по умолчанию).
--
-- Заглушки не хранятся в БД: они выбираются на клиенте по категории,
-- поэтому в `image_url` для них остаётся NULL.

ALTER TABLE fridge_items
  ADD COLUMN IF NOT EXISTS image_url VARCHAR(500);

-- Источник изображения: определяет, можно ли его удалить
-- (пользовательское — да, каталожное — только заменить).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'enum_fridge_items_image_source') THEN
    CREATE TYPE enum_fridge_items_image_source AS ENUM ('user', 'catalog', 'placeholder');
  END IF;
END $$;

ALTER TABLE fridge_items
  ADD COLUMN IF NOT EXISTS image_source enum_fridge_items_image_source
  NOT NULL DEFAULT 'placeholder';

-- Индекс для выборок «только с фото» — используется в интерфейсе,
-- чтобы показать продукты с загруженными изображениями.
-- Колонки в этой таблице именованы в camelCase (Sequelize без underscored).
CREATE INDEX IF NOT EXISTS fridge_items_image_idx
  ON fridge_items ("userId")
  WHERE image_url IS NOT NULL;

DO $$
DECLARE
  total int;
  with_image int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE image_url IS NOT NULL)
    INTO total, with_image
    FROM fridge_items;
  RAISE NOTICE 'Продуктов в холодильниках: %, с изображением: %', total, with_image;
END $$;
