DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'products'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'products'
      AND column_name = 'category'
  ) THEN
    ALTER TABLE products ADD COLUMN category VARCHAR(24) NOT NULL DEFAULT 'other';
  END IF;
END $$;
