ALTER TABLE fridge_items
  ALTER COLUMN quantity SET DEFAULT 100,
  ALTER COLUMN unit SET DEFAULT 'г';

UPDATE fridge_items
SET unit = 'г'
WHERE lower(trim(coalesce(unit, ''))) NOT IN ('г', 'кг', 'g', 'kg', 'гр', 'gram', 'grams', 'kilo', 'kilos');
