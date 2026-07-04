DO $$
DECLARE
  udt text;
BEGIN
  SELECT c.udt_name INTO udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'meal_plan_days'
    AND c.column_name = 'snacks';

  IF udt IS NULL THEN
    ALTER TABLE meal_plan_days ADD COLUMN snacks JSONB DEFAULT '[]'::jsonb;
  ELSIF udt = 'jsonb' THEN
    NULL;
  ELSIF udt IN ('_varchar', '_text') THEN
    ALTER TABLE meal_plan_days DROP COLUMN snacks;
    ALTER TABLE meal_plan_days ADD COLUMN snacks JSONB DEFAULT '[]'::jsonb;
  ELSE
    ALTER TABLE meal_plan_days ALTER COLUMN snacks DROP DEFAULT;
    ALTER TABLE meal_plan_days
      ALTER COLUMN snacks TYPE JSONB
      USING CASE
        WHEN snacks IS NULL THEN NULL
        ELSE snacks::jsonb
      END;
    ALTER TABLE meal_plan_days ALTER COLUMN snacks SET DEFAULT '[]'::jsonb;
  END IF;
END $$;

DO $$
DECLARE
  udt text;
BEGIN
  SELECT c.udt_name INTO udt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'meal_plan_days'
    AND c.column_name = 'extra_snacks';

  IF udt IS NULL THEN
    ALTER TABLE meal_plan_days ADD COLUMN extra_snacks JSONB DEFAULT '[]'::jsonb;
  ELSIF udt = 'jsonb' THEN
    NULL;
  ELSIF udt IN ('_varchar', '_text') THEN
    ALTER TABLE meal_plan_days DROP COLUMN extra_snacks;
    ALTER TABLE meal_plan_days ADD COLUMN extra_snacks JSONB DEFAULT '[]'::jsonb;
  ELSE
    ALTER TABLE meal_plan_days ALTER COLUMN extra_snacks DROP DEFAULT;
    ALTER TABLE meal_plan_days
      ALTER COLUMN extra_snacks TYPE JSONB
      USING CASE
        WHEN extra_snacks IS NULL THEN NULL
        ELSE extra_snacks::jsonb
      END;
    ALTER TABLE meal_plan_days ALTER COLUMN extra_snacks SET DEFAULT '[]'::jsonb;
  END IF;
END $$;
