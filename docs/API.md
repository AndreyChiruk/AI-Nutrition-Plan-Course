# API

Документация сгенерирована из исходного кода контроллеров командой `npm run docs:api`. При изменении маршрутов файл нужно перегенерировать — это исключает расхождения между кодом и описанием.

Всего эндпоинтов: **117**, из них без авторизации: **11**.

Базовый префикс: `/api` (задаётся переменной `GLOBAL_API_PREFIX`).

## Заголовки

| Заголовок | Назначение |
|---|---|
| `Authorization: Bearer <accessToken>` | Доступ к защищённым маршрутам |
| `Content-Type: application/json` | Тело запроса |

## Ограничения

- Платные вызовы OpenAI (распознавание еды, анализ тела) ограничены по частоте: защита бюджета от массовых запросов.
- Тело запроса — не более 12 МБ; изображения проверяются и сжимаются на сервере.

## Проверка работоспособности

| Метод | Путь | Назначение |
|---|---|---|
| GET | `/api/health` | Процесс жив (без обращения к БД) |
| GET | `/api/health/ready` | Готовность: проверяет доступность БД, при сбое 503 |

## Эндпоинты по разделам

| Раздел | Эндпоинтов |
|---|---|
| admin | 34 |
| auth | 6 |
| body-analysis | 4 |
| chat | 2 |
| food-recognition | 2 |
| health | 4 |
| meal-plan | 17 |
| notifications | 4 |
| recommendation | 2 |
| stats | 7 |
| stripe-webhook | 1 |
| subscription | 4 |
| users | 18 |
| workout-plan | 12 |

### admin

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/admin/base-recommendations` | админ | — |
| POST | `/admin/base-recommendations` | админ | — |
| PUT | `/admin/base-recommendations/:id` | админ | — |
| DELETE | `/admin/base-recommendations/:id` | админ | — |
| GET | `/admin/ingredients` | админ | — |
| GET | `/admin/meals/:id` | админ | — |
| POST | `/admin/meals/:id/confirm` | админ | — |
| PUT | `/admin/meals/:id/correct` | админ | — |
| DELETE | `/admin/meals/:id/reject` | админ | — |
| GET | `/admin/meals/pending` | админ | — |
| GET | `/admin/openai/billing` | админ | — |
| GET | `/admin/products` | админ | — |
| POST | `/admin/products` | админ | — |
| PUT | `/admin/products/:id` | админ | — |
| DELETE | `/admin/products/:id` | админ | — |
| POST | `/admin/products/:id/ai-localize` | админ | — |
| POST | `/admin/products/ai-localize-all` | админ | — |
| POST | `/admin/products/ai-localize-batch` | админ | — |
| POST | `/admin/products/backfill-ingredients` | админ | — |
| GET | `/admin/products/count` | админ | Общее число продуктов — для постраничной навигации. |
| POST | `/admin/products/import-public` | админ | — |
| POST | `/admin/products/localize-catalog-ru` | админ | — |
| POST | `/admin/products/replace-catalog-themealdb` | админ | — |
| GET | `/admin/stats/meals` | админ | — |
| GET | `/admin/stats/overview` | админ | — |
| GET | `/admin/stats/recognition` | админ | — |
| GET | `/admin/stats/users` | админ | — |
| GET | `/admin/users` | админ | — |
| POST | `/admin/users` | админ | — |
| GET | `/admin/users/:id` | админ | — |
| PATCH | `/admin/users/:id` | админ | — |
| DELETE | `/admin/users/:id` | админ | — |
| POST | `/admin/users/:id/block` | админ | — |
| POST | `/admin/users/:id/unblock` | админ | — |

### auth

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | `/auth/email/send-code` | публичный | _Ограничение: 5 запросов / 60 с_ |
| POST | `/auth/login` | публичный | _Ограничение: 10 запросов / 60 с_ |
| POST | `/auth/logout` | авторизация | Серверный выход: аннулирует refresh-токен в БД. _Ограничение: 20 запросов / 60 с_ |
| POST | `/auth/password-reset` | публичный | _Ограничение: 5 запросов / 60 с_ |
| POST | `/auth/refresh` | публичный | _Ограничение: 20 запросов / 60 с_ |
| POST | `/auth/register` | публичный | _Ограничение: 10 запросов / 60 с_ |

### body-analysis

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | `/body-analysis/analyze` | пользователь | _Ограничение: 5 запросов / 60 с_ |
| GET | `/body-analysis/basic-recommendations/:userId` | пользователь | — |
| POST | `/body-analysis/forecast` | пользователь | _Ограничение: 3 запросов / 60 с_ |
| GET | `/body-analysis/page-state/:userId` | пользователь | — |

### chat

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/chat/history/:userId` | пользователь | — |
| POST | `/chat/message` | пользователь | Отправка сообщения ассистенту. _Ограничение: 15 запросов / 60 с_ |

### food-recognition

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | `/food-recognition/analyze` | авторизация | _Ограничение: 10 запросов / 60 с_ |
| POST | `/food-recognition/submit-meal` | авторизация | _Ограничение: 10 запросов / 60 с_ |

### health

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/health` | публичный | Быстрая проверка: процесс жив и отвечает. |
| GET | `/health/catalog-samples` | публичный | Несколько блюд каталога с фотографиями — для блока «Что в каталоге» на главной странице. |
| GET | `/health/catalog-stats` | публичный | Публичные показатели каталога. |
| GET | `/health/ready` | публичный | Полная проверка готовности: доступна ли база данных. |

### meal-plan

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/meal-plan/active/:userId` | пользователь | — |
| GET | `/meal-plan/catalog-search` | пользователь | Поиск по каталогу для автокомплита предпочтений. |
| GET | `/meal-plan/dishes` | пользователь | — |
| POST | `/meal-plan/duration` | пользователь | — |
| POST | `/meal-plan/generate` | пользователь | — |
| POST | `/meal-plan/generate-ai-catalog` | пользователь | _Ограничение: 5 запросов / 60 с_ |
| POST | `/meal-plan/generate-auto` | пользователь | — |
| GET | `/meal-plan/plans/:userId` | пользователь | — |
| GET | `/meal-plan/plans/:userId/:planId` | пользователь | — |
| DELETE | `/meal-plan/plans/:userId/:planId` | пользователь | — |
| POST | `/meal-plan/plans/:userId/:planId/activate` | пользователь | Делает план текущим. |
| POST | `/meal-plan/plans/:userId/:planId/clone` | пользователь | — |
| GET | `/meal-plan/plans/:userId/:planId/download` | пользователь | — |
| GET | `/meal-plan/plans/:userId/:planId/restrictions-diff` | пользователь | Отличаются ли ограничения плана от текущего профиля. |
| POST | `/meal-plan/plans/:userId/days/:dayId/meals` | пользователь | — |
| POST | `/meal-plan/refine-constructor-ai` | пользователь | _Ограничение: 5 запросов / 60 с_ |
| POST | `/meal-plan/save` | пользователь | — |

### notifications

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/notifications/:userId` | пользователь | Список уведомлений пользователя + счётчик непрочитанных. |
| DELETE | `/notifications/:userId/:id` | пользователь | — |
| PATCH | `/notifications/:userId/:id/read` | пользователь | — |
| PATCH | `/notifications/:userId/read-all` | пользователь | — |

### recommendation

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/recommendations/base` | публичный | — |
| POST | `/recommendations/generate` | пользователь | _Ограничение: 10 запросов / 60 с_ |

### stats

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/stats/body-metrics/:userId` | пользователь | — |
| GET | `/stats/export/csv/:userId` | пользователь | Выгрузка статистики в CSV. |
| GET | `/stats/export/pdf/:userId` | пользователь | Честный ответ о недоступности PDF вместо ссылки на несуществующий файл. |
| GET | `/stats/kbju/:userId` | пользователь | — |
| GET | `/stats/plan-vs-fact/:userId` | пользователь | — |
| GET | `/stats/progress/:userId` | пользователь | — |
| GET | `/stats/summary/:userId` | пользователь | — |

### stripe-webhook

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | `/stripe/webhook` | публичный | — |

### subscription

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| POST | `/subscription/checkout` | авторизация | Создаёт сессию оплаты и возвращает ссылку на Stripe Checkout. |
| POST | `/subscription/portal` | авторизация | Ссылка на портал управления подпиской. |
| GET | `/subscription/status` | авторизация | Текущее состояние подписки для интерфейса. |
| POST | `/subscription/sync` | авторизация | Перепроверяет подписку напрямую в Stripe. |

### users

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/users/:id` | пользователь | — |
| PATCH | `/users/:id/allergies` | пользователь | — |
| POST | `/users/:id/avatar` | пользователь | — |
| POST | `/users/:id/block` | пользователь | — |
| GET | `/users/:id/calories` | пользователь | — |
| POST | `/users/:id/change-password` | пользователь | — |
| GET | `/users/:id/fridge` | пользователь | — |
| POST | `/users/:id/fridge` | пользователь | — |
| PATCH | `/users/:id/fridge/:itemId` | пользователь | — |
| DELETE | `/users/:id/fridge/:itemId` | пользователь | — |
| POST | `/users/:id/fridge/:itemId/image` | пользователь | Загрузка фотографии продукта. |
| DELETE | `/users/:id/fridge/:itemId/image` | пользователь | Удаление фотографии: возвращает заглушку по категории. |
| POST | `/users/:id/fridge/missing` | пользователь | Каких продуктов из рецепта не хватает в холодильнике. |
| PATCH | `/users/:id/profile` | пользователь | — |
| POST | `/users/allergens` | пользователь | — |
| PATCH | `/users/allergens/:id` | пользователь | — |
| DELETE | `/users/allergens/:id` | пользователь | — |
| GET | `/users/allergens/list` | пользователь | — |

### workout-plan

| Метод | Путь | Доступ | Описание |
|---|---|---|---|
| GET | `/workout-plan/active/:userId` | пользователь | — |
| GET | `/workout-plan/blocks` | пользователь | — |
| POST | `/workout-plan/generate` | пользователь | — |
| GET | `/workout-plan/plans/:userId` | пользователь | — |
| GET | `/workout-plan/plans/:userId/:planId` | пользователь | — |
| DELETE | `/workout-plan/plans/:userId/:planId` | пользователь | — |
| POST | `/workout-plan/plans/:userId/:planId/clone` | пользователь | — |
| PATCH | `/workout-plan/plans/:userId/days/:dayId/sessions` | пользователь | — |
| POST | `/workout-plan/plans/activate` | пользователь | — |
| POST | `/workout-plan/plans/tracking-complete` | пользователь | — |
| POST | `/workout-plan/plans/tracking-start` | пользователь | — |
| POST | `/workout-plan/save` | пользователь | — |
