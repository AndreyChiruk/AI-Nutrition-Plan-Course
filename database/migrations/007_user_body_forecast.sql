ALTER TABLE users ADD COLUMN IF NOT EXISTS body_forecast_illustration_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS body_forecast_payload JSONB;
ALTER TABLE users ADD COLUMN IF NOT EXISTS body_forecast_at TIMESTAMPTZ;
