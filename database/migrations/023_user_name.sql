-- 023_user_name.sql
--
-- Имя пользователя.
--
-- Проблема: поля `name` не было ни в модели User, ни в таблице users.
-- Фронтенд хранил имя в localStorage браузера (`profile:name:<id>`),
-- поэтому:
--   - имя не синхронизировалось между устройствами и браузерами;
--   - после очистки хранилища оно терялось безвозвратно;
--   - сервер не знал имени пользователя (в письмах, уведомлениях,
--     админ-панели оно было недоступно);
--   - эндпоинт обновления профиля это поле просто игнорировал.
--
-- Колонка необязательная: существующие пользователи продолжат работать,
-- а интерфейс подставит имя из email.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS name VARCHAR(120);

-- Ограничение длины на уровне БД: защищает от случайной записи
-- огромной строки в обход валидации приложения.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_name_length_check'
  ) THEN
    ALTER TABLE users
      ADD CONSTRAINT users_name_length_check
      CHECK (name IS NULL OR char_length(name) <= 120);
  END IF;
END $$;

-- Заполняем имя у существующих записей из части email до «@»,
-- чтобы в интерфейсе не было пустых имён.
UPDATE users
SET name = initcap(split_part(email, '@', 1))
WHERE name IS NULL
  AND email IS NOT NULL
  AND split_part(email, '@', 1) <> '';

DO $$
DECLARE
  with_name int;
  total int;
BEGIN
  SELECT count(*) FILTER (WHERE name IS NOT NULL), count(*) INTO with_name, total FROM users;
  RAISE NOTICE 'Имя заполнено у % из % пользователей', with_name, total;
END $$;
