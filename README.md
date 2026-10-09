# Интернет-сервис для составления плана питания

Курсовой проект. Клиент-серверное SPA: персональные планы питания с учётом цели,
аллергий и пищевых ограничений, распознавание еды по фото, AI-рекомендации,
анализ параметров тела и админ-панель модерации.

## Стек

| Слой | Технологии |
|---|---|
| Backend | NestJS (Node.js), REST API, асинхронное программирование |
| БД | PostgreSQL + Sequelize ORM |
| Frontend | React 19 + Vite (SPA), React Router, axios, recharts |
| Прокси | Nginx (HTTPS, reverse proxy) |
| Внешние API | OpenRouter (распознавание еды, анализ тела, AI-планы, чат), TheMealDB / TheCocktailDB (каталог блюд), Stripe (подписка) |
| Развёртывание | Docker + Docker Compose |
| Почта | SMTP (коды подтверждения e-mail) |

## Быстрый старт (Docker)

```bash
cp .env.example .env      # заполнить переменные, см. раздел ниже
./scripts/docker-gencerts.sh   # сгенерировать самоподписанные TLS-сертификаты
docker compose up -d --build
```

После запуска:

- приложение — https://localhost (сертификат самоподписанный, браузер покажет предупреждение)
- API — https://localhost/api

## Документация API

Полное описание эндпоинтов — в [docs/API.md](docs/API.md). Файл **генерируется
из исходного кода** контроллеров, поэтому не расходится с реализацией:

```bash
npm run docs:api
```

Документ содержит методы, пути, уровень доступа (публичный / авторизация /
админ), ограничения частоты платных вызовов AI и описание эндпоинтов
проверки работоспособности.

### Проверка работоспособности

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | Процесс жив (без обращения к БД) |
| GET | `/api/health/ready` | Готовность: проверяет БД, при сбое возвращает 503 |

Docker Compose опрашивает `/api/health/ready`, поэтому контейнер `api`
считается здоровым только когда база данных реально отвечает.

## Переменные окружения

Все значения задаются в `.env` (в git не попадает). Полный список с комментариями —
в `.env.example`. Реальные ключи в репозиторий не коммитятся.

Обязательные для запуска:

| Переменная | Назначение |
|---|---|
| `JWT_SECRET` | подпись access/refresh токенов. Уникальная длинная случайная строка |
| `DB_*` | подключение к PostgreSQL (для локального запуска без Docker) |
| `OPENROUTER_API_KEY` | ключ OpenRouter: распознавание еды, анализ тела, AI-планы, чат. Получить: https://openrouter.ai/keys |

Опциональные:

| Переменная | Назначение |
|---|---|
| `SMTP_*` | отправка кодов подтверждения. Для Gmail — пароль приложения |
| `MAIL_DEBUG` | `true` возвращает код подтверждения в ответе API. Только для локальной отладки, в production недопустимо |
| `OPENROUTER_BASE_URL` | адрес шлюза, по умолчанию `https://openrouter.ai/api/v1` |
| `APP_URL` | адрес приложения — уходит в `HTTP-Referer` для статистики OpenRouter |
| `AI_MODEL_*` | модели по задачам в формате `провайдер/модель` (см. `.env.example`). По умолчанию `openai/gpt-4o-mini` |
| `OPENAI_TIMEOUT_MS`, `OPENAI_MAX_TOKENS` | таймаут и лимит токенов для AI-запросов |
| `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_ID_MONTHLY` | подписка Stripe (тестовый режим) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | первичный администратор, создаётся при первом старте на пустой БД |

## Скрипты

```bash
# Backend (из корня проекта)
npm run start:dev      # запуск с горячей перезагрузкой
npm run build          # сборка в dist/
npm run start:prod     # запуск собранного приложения
npm run lint           # ESLint с автоисправлением
npm test               # unit-тесты (mocha)
npm run test:coverage  # покрытие (nyc)

# Frontend (из каталога frontend/)
npm run dev            # dev-сервер Vite
npm run build          # production-сборка
npm run lint           # ESLint
```

## Структура

```
src/                 backend (NestJS)
  auth/              регистрация, вход, JWT-гарды, роли
  users/             профиль, аллергии, холодильник
  meal-plan/         генерация и хранение планов питания, каталог блюд
  food-recognition/  распознавание еды по фото, аллергены
  body-analysis/     анализ параметров тела, прогноз фигуры
  recommendation/    AI-рекомендации
  workout-plan/      планы тренировок
  admin/             модерация, управление каталогом, статистика
  models/            модели Sequelize
frontend/src/        React SPA
database/migrations/ SQL-миграции
docker/nginx/        конфигурация reverse proxy и TLS
scripts/             вспомогательные скрипты развёртывания
```
