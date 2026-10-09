-- 028_subscriptions.sql
--
-- Подписки на ИИ-функции и учёт бесплатных сообщений в чате.
--
-- Модель монетизации: ИИ-функции (анализ тела, генерация плана,
-- распознавание еды, рекомендации) доступны по подписке; диалог
-- с ассистентом — 3 сообщения в день бесплатно.
--
-- Таблица `subscriptions` хранит состояние подписки пользователя.
-- Одна запись на пользователя (UNIQUE), потому что повторная оплата
-- обновляет существующую подписку, а не создаёт вторую.
--
-- Таблица `ai_chat_usage` считает бесплатные сообщения по дням.
-- Отдельная таблица, а не поле в users: нужна история за каждый день
-- и уникальность пары (пользователь, дата).

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id VARCHAR(120),
  stripe_subscription_id VARCHAR(120),
  status VARCHAR(20) NOT NULL DEFAULT 'none',
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Статусы Stripe плюс собственный `none` для пользователей без подписки.
  CONSTRAINT subscriptions_status_check CHECK (
    status IN ('active', 'past_due', 'canceled', 'incomplete', 'trialing', 'unpaid', 'none')
  )
);

-- Поиск подписки по идентификатору в Stripe: нужен при обработке вебхуков,
-- когда известен только объект Stripe, а не наш пользователь.
CREATE INDEX IF NOT EXISTS subscriptions_customer_idx
  ON subscriptions (stripe_customer_id);

CREATE INDEX IF NOT EXISTS subscriptions_stripe_sub_idx
  ON subscriptions (stripe_subscription_id);

-- Проверка активности подписки идёт по статусу и дате окончания.
CREATE INDEX IF NOT EXISTS subscriptions_active_idx
  ON subscriptions (user_id, status)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS ai_chat_usage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  messages_count INTEGER NOT NULL DEFAULT 0,

  -- Одна запись на пользователя в день: позволяет одним запросом
  -- получить счётчик и увеличить его.
  CONSTRAINT ai_chat_usage_user_date_key UNIQUE (user_id, date),
  CONSTRAINT ai_chat_usage_count_check CHECK (messages_count >= 0)
);

CREATE INDEX IF NOT EXISTS ai_chat_usage_user_date_idx
  ON ai_chat_usage (user_id, date DESC);

DO $$
DECLARE
  subs int;
  usage int;
BEGIN
  SELECT count(*) INTO subs FROM subscriptions;
  SELECT count(*) INTO usage FROM ai_chat_usage;
  RAISE NOTICE 'Подписок: %, записей об использовании чата: %', subs, usage;
END $$;
