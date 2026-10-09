ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS ingredients JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS ingredients_detailed JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE meal_items ADD COLUMN IF NOT EXISTS dietary_tags JSONB NOT NULL DEFAULT '[]'::jsonb;
