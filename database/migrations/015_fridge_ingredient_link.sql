ALTER TABLE fridge_items ADD COLUMN IF NOT EXISTS ingredient_id UUID REFERENCES ingredients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS fridge_items_ingredient_idx ON fridge_items(ingredient_id);
