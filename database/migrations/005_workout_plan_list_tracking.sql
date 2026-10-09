ALTER TABLE workout_plans ADD COLUMN IF NOT EXISTS name VARCHAR(200);
ALTER TABLE workout_plans ADD COLUMN IF NOT EXISTS tracking_started_at TIMESTAMPTZ;
ALTER TABLE workout_plan_days ADD COLUMN IF NOT EXISTS session_statuses JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE workout_plans SET name = 'План тренировок' WHERE name IS NULL OR name = '';
