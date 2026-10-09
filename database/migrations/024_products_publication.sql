-- 024_products_publication.sql
--
-- Признак публикации блюда в каталоге.
--
-- Зачем: часть блюд, импортированных из TheMealDB, имеет безнадёжно
-- испорченный состав. Например, «Хлеб Хобз эл Дар» — 6274 г на одну порцию,
-- «Крокеты из хамона» — 3850 г. Причина в том, что источник отдаёт меры
-- в свободной форме («1 ½ tbsp», «to taste»), а импорт подставлял значение
-- по умолчанию (`DEFAULT_PIECE_GRAMS = 60`).
--
-- Показывать такие блюда в планировщике нельзя: они попадают в план
-- с калорийностью в тысячи килокалорий.
--
-- Раньше возможности «скрыть блюдо» не было вовсе — приходилось либо
-- удалять запись, теряя данные, либо мириться с ней.
--
-- Значение по умолчанию `true`: все существующие блюда остаются видимыми,
-- скрываются только те, что явно отбракованы проверкой.

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS is_published BOOLEAN NOT NULL DEFAULT true;

-- Причина снятия с публикации: показывается администратору,
-- чтобы было понятно, что именно не так с блюдом.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS unpublished_reason VARCHAR(300);

-- Индекс для фильтрации каталога: выборки почти всегда идут
-- только по опубликованным блюдам.
CREATE INDEX IF NOT EXISTS products_published_idx
  ON products (is_published)
  WHERE is_published = true;

DO $$
DECLARE
  total int;
  hidden int;
BEGIN
  SELECT count(*), count(*) FILTER (WHERE NOT is_published) INTO total, hidden FROM products;
  RAISE NOTICE 'Блюд всего: %, скрыто: %', total, hidden;
END $$;
