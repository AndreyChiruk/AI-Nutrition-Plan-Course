-- 021_notifications.sql
--
-- Уведомления пользователя.
--
-- Зачем: предупреждение об аллергене, обнаруженном при распознавании еды,
-- существовало только в ответе HTTP. Пользователь закрывал страницу —
-- и предупреждение исчезало навсегда, хотя риск для здоровья остаётся.
-- В интерфейсе при этом есть раздел уведомлений, которому нечего показывать.
--
-- Таблица хранит уведомления, чтобы критичные предупреждения (аллергены)
-- не терялись между сессиями.

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(32) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'info',
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  "relatedMealId" UUID REFERENCES meals(id) ON DELETE SET NULL,
  "relatedDishName" VARCHAR(200),
  "isRead" BOOLEAN NOT NULL DEFAULT false,
  "readAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Основная выборка: непрочитанные уведомления пользователя, свежие сверху.
CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications ("userId", "createdAt" DESC);

-- Счётчик непрочитанных.
CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications ("userId")
  WHERE "isRead" = false;

-- Критичные уведомления (аллергены) ищем отдельно.
CREATE INDEX IF NOT EXISTS notifications_type_idx
  ON notifications (type, "createdAt" DESC);

COMMENT ON TABLE notifications IS
  'Уведомления пользователя, включая предупреждения об аллергенах';
