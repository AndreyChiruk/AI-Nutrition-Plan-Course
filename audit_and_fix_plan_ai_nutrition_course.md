# Архитектурный аудит и план правок: AI-Nutrition-Plan-Course

## Часть 1. Резюме

По результатам статического аудита кодовой базы (`src/`, `frontend/src/`, `database/migrations/`, `docker-compose.yml`, `Dockerfile`) выявлено **28 подтверждённых дефектов**:

* **BLOCKER:** 7 (порча данных при каждом рестарте сервера, бесконечный цикл списания токенов OpenRouter, обход платной подписки и rate-limit на дорогих AI-маршрутах, ложные критические уведомления об аллергенах, падение удаления пользователя по FK, поломка снимка аллергий плана, отсутствие `isPublished`-фильтра в генераторе планов).

* **MAJOR:** 12 (пропуск аллергенов и ложные срабатывания в `productHasUserAllergen`, потеря масштабирования калорий в AI-ветке, отсутствие транзакций в `WorkoutPlanService` / `activatePlan` / `submitMealForModeration` / `confirmMeal`, гонка и потеря вебхуков Stripe, списание бесплатных сообщений чата при сбое AI, сохранение фейковых AI-заглушек в БД, выгрузка base64-фото в `StatsService`/`AdminService`, учёт отклонённых блюд в статистике КБЖУ, баг `split('—')` в проверке холодильника, потеря имени при регистрации `displayName` vs `name`, отсутствие серверного `logout` на клиенте).

* **MINOR:** 7 (неиспользуемый `@nestjs/cache-manager`, 13-кратная выгрузка `products` за один запрос, статика чанка >2.4 МБ из-за `import * as Lucide` и `html2pdf.js`, ошибка компиляции `users.service.test.ts`, 38 из 74 unit-тестов без импорта кода проекта, монолиты `meal-plan.service.ts` и `MealPlanPage.tsx`/`AdminPage.tsx`).

* **NIT:** 2 (порядок `@UseGuards` в `RecommendationController`, неполный список `models` в `AppModule`).

**Сильные стороны архитектуры:**

1. Централизованная валидация `JWT_SECRET` (`src/common/jwt.config.ts`) и хэширование паролей через `scrypt` с ленивой миграцией со старого SHA-256 (`src/common/password.util.ts`).

2. Проверка владельца ресурса через `assertUserAccess` во всех пользовательских контроллерах (защита от горизонтального IDOR) и проверка зображений по magic bytes через `sharp` (`src/common/image-validation.util.ts`).

3. Все 40 вызовов `sequelize.query` в runtime-коде используют именованные параметры `replacements` без SQL-инъекций.

**Главные риски перед защитой:**

1. При каждом рестарте контейнера `api` функция `ensureMealPlannerSchema()` повторно накатывает миграции `013` и `031`, перезаписывая единицы измерения в холодильнике (`л`/`шт` → `г` → `мл`/`шт`).

2. Три конкурирующих механизма схемы (`synchronize: true`, `runMigrations`, `ensure*Schema`) создают таблицы без `ON DELETE CASCADE`, из-за чего удаление пользователя в админке падает с HTTP 500.

3. Половина unit-тестов (38 из 74) тестирует скопированные локальные функции внутри `.test.ts`, а `users.service.test.ts` не проходит проверку типов TypeScript (`Expected 5 arguments, but got 3`).

## Часть 2. Реестр найденных проблем

| ID | Критичность | Область | Файл:строка | Суть проблемы | Почему это проблема | 
| ----- | ----- | ----- | ----- | ----- | ----- | 
| B-01 | **BLOCKER** | БД / Схема и данные | `src/auth/auth.bootstrap.service.ts:42-48`, `src/database/ensure-meal-planner-schema.ts:5-19`, `database/migrations/013_fridge_mass_units.sql:5-7`, `database/migrations/031_fridge_unit_variety.sql:18-38` | `ensureMealPlannerSchema()` вызывается при каждом старте приложения после `runMigrations` и заново выполняет `013_fridge_mass_units.sql` и `031_fridge_unit_variety.sql`. | На каждом рестарте контейнера `013` сбрасывает все единицы `мл`, `л`, `шт` в `г`, а затем `031` превращает `2 л` молока (ставшие `2 г`) в `2 мл`, а `500 г` винограда или капусты — в `500 шт`. Данные холодильника необратимо портятся при каждом перезапуске. | 
| B-02 | **BLOCKER** | AI / Админка | `src/admin/admin.service.ts:699-755` | Бесконечный цикл `while (true)` в `aiLocalizeCatalogAll` при `onlyMissingDetailed = true`. | В запросе `findAll` задано `offset: onlyMissingDetailed ? 0 : offset` (строка 723). Если `aiLocalizeSingleProduct(p)` возвращает `{ updated: false }` или выбрасывает ошибку, `ingredientsDetailed` у блюда остаётся `[]`. На следующей итерации `offset: 0` выбирает те же самые строки, создавая бесконечный цикл платных запросов к OpenRouter. | 
| B-03 | **BLOCKER** | Безопасность / Подписка / Rate-limit | `src/meal-plan/meal-plan.controller.ts:235-261`, `src/app.module.ts:51-56` | Эндпоинты `POST /meal-plan/generate-ai-catalog` и `POST /meal-plan/refine-constructor-ai` не защищены `RequireSubscriptionGuard` и `ThrottlerGuard`. Кроме того, `ThrottlerGuard` не зарегистрирован как `APP_GUARD`. | Любой авторизованный пользователь без подписки может бесконечно вызывать самые дорогие AI-методы (до 12 000 выходных токенов на запрос в `refineConstructorPlanFromCatalog`), расходуя баланс OpenRouter в обход оплаты. | 
| B-04 | **BLOCKER** | Алгоритмы / Планы питания | `src/meal-plan/meal-plan.service.ts:272-292`, `2106`, `2290`, `2378`, `2416` | В `restrictionSnapshot(user)` список аллергий формируется как `user.allergens.map(a => String(a))`, а в `saveUserPlan`, `clonePlan`, `activatePlan`, `planRestrictionDiff` пользователь загружается через `findByPk` без `include: [Allergen]`. | Во всех 4 методах `user.allergens` равен `undefined`, поэтому в `restrictions_snapshot` всегда пишется `allergens: []`. Даже при передаче `include: [Allergen]` вызов `String(a)` для модели Sequelize даёт `"[object object]"` вместо `a.name`. Проверка устаревания плана при смене аллергий полностью не работает. | 
| B-05 | **BLOCKER** | Алгоритмы / Распознавание еды | `src/food-recognition/food-recognition.service.ts:411-417`, `324-328` | В `buildAllergenWarnings` условие `if (allergySet.size > 0 && !allergySet.has(allergen)) continue;` инвертировано для пустого профиля (`allergySet.size === 0`). | Если у пользователя в профиле **нет ни одной аллергии** (`allergySet.size === 0`), условие пропуска не срабатывает, и для каждого ингредиента-аллергена блюда формируется ложное критическое предупреждение «совпадение с вашим профилем» с записью в таблицу `notifications` уже на этапе предпросмотра (`previewRecognize`). | 
| B-06 | **BLOCKER** | БД / Целостность / Схема | `src/app.module.ts:64`, `docker-compose.yml:36`, `src/models/*.ts`, `src/admin/admin.service.ts:144-149`, `src/users/users.service.ts:448-455` | Конфликт `DB_AUTO_SYNC: '1'` (`synchronize: true`) и миграций; ни одна модель в `src/models/*.ts` не задаёт `onDelete: 'CASCADE'` для внешних ключей на `User`, `MealPlan`, `WorkoutPlan`, `Meal`. | На базе, поднятой с `DB_AUTO_SYNC=1`, `sequelize.sync()` создаёт таблицы до миграций без `ON DELETE CASCADE` и без `UNIQUE (user_id, date)` в `ai_chat_usage`. Вызов `DELETE /admin/users/:id` падает с `ForeignKeyConstraintError` (HTTP 500), а удаление продукта холодильника (`deleteFridgeItem`) и пользователя не удаляет файлы `/app/uploads/fridge/*.webp`. | 
| B-07 | **BLOCKER** | Алгоритмы / Планы питания | `src/meal-plan/meal-plan.service.ts:949-960`, `1825-1830` | В `generatePlan` (строки 1825–1830) и `applyWeeklySnackAlcoholBudgetToPlanDays` (строка 949) выборка `productModel.findAll` не фильтрует `isPublished: { [Op.ne]: false }`, а при пустом `pools.snack` (строка 958) берёт сырой `sRaw` без фильтрации по аллергенам и диете. | Отбракованные блюда с испорченным составом (`is_published = false`, до 6000 ккал на порцию) попадают в автоплан, а при строгой диете/аллергии на перекусах фолбэк `pools.snack.length > 0 ? pools.snack : sRaw` подставляет в план перекусы с аллергенами пользователя. | 
| M-01 | **MAJOR** | Алгоритмы / Аллергены | `src/meal-plan/dietary-rules.ts:399-413`, `src/meal-plan/slovari.ts:131-147` | `productHasUserAllergen` проверяет только `ingredientsDetailed` (игнорируя `ingredients` и `name`), возвращает `true` при пустом `ingredientsDetailed`, и ищет вхождения через `ing.includes(ex)` вместо `containsDietKey(ing, ex)`. | 1) Все базовые блюда из сидера без `ingredientsDetailed` блокируются при любой выбранной аллергии. 2) Корень `'мид'` из `ALLERGEN_INGREDIENTS['морепродукты']` через `.includes('мид')` ложно блокирует все блюда с `помидорами`. 3) Регулярные выражения со скобками в `slovari.ts` (\`'соев(ый | 
| M-02 | **MAJOR** | Алгоритмы / Калории и БЖУ | `src/meal-plan/meal-plan.service.ts:619-624`, `1091-1209`, `2020-2034`, `2790-2792`, `2961-2965` | В `deduplicateAcrossDays` замена выбирается через `pool.find` (первое блюдо пула, отсортированного по `calories ASC`, т.е. \~40–80 ккал) вместо `pickClosestByCalories`, а в `generateAiPlan` и `refineConstructorPlanWithAi` после `enforceDietaryForAiDays` не вызывается повторный `scaleDaySnapshotsToTarget`. | В `generatePlan` дни масштабируются дважды (до и после `finalizeGeneratedPlanDays`), из-за чего старые слоты раздуваются в 1.5–2 раза, а заменённый слот остаётся крошечным; в `generateAiPlan` и `refineConstructorPlanWithAi` после замен и применения привычек (`mealsPerDay = 3`) суточная калорийность уходит от цели без финального масштабирования. | 
| M-03 | **MAJOR** | Алгоритмы / Перекусы при клонировании | `src/meal-plan/meal-plan.service.ts:2357-2358` | В `clonePlan` при записи дней передаётся `snacks: d.snack ? [d.snack] : []` вместо `[d.snack, ...(d.extraSnacks ?? [])].filter(Boolean)`. | Нарушается инвариант миграции `020_unify_snacks.sql` (как в `saveUserPlan:2219`): у клонированного плана в колонку `snacks` не попадает второй перекус, и при скачивании JSON (`planDownloadPayload:2445`) `snacks` оказывается неполным. | 
| M-04 | **MAJOR** | Надёжность / Транзакции | `src/meal-plan/meal-plan.service.ts:2398-2403`, `src/workout-plan/workout-plan.service.ts:144-275`, `src/food-recognition/food-recognition.service.ts:369-385`, `src/admin/admin.service.ts:288-358` | Многошаговые записи в БД в `MealPlanService.activatePlan`, всех методах `WorkoutPlanService` (`saveUserPlan`, `deletePlan`, `activatePlan`, `clonePlan`), `FoodRecognitionService.submitMealForModeration` и `AdminService.confirmMeal` выполняются без транзакций. | Сбой на втором шаге оставляет пользователя без активного плана питания/тренировок, создаёт пустые планы без дней, пустые `meals` без `meal_items` в очереди модерации или падает с `UniqueConstraintError` в `confirmMeal` на дубликатах блюд. | 
| M-05 | **MAJOR** | Надёжность / Stripe | `src/subscription/stripe-webhook.controller.ts:75-88`, `src/subscription/subscription.service.ts:166-171`, `325-445` | При исключении в `applyStripeEvent` контроллер вебхука логирует ошибку и возвращает `200 OK`; `upsertForUser` делает неатомарный `find` + `create`; в `ensureCustomer` `upsert` сбрасывает `status: 'none'`. | Если БД временно недоступна или два вебхука (`checkout.session.completed` и `customer.subscription.updated`) приходят параллельно и вызывают гонку в `upsertForUser`, сервер отвечает Stripe `200 OK`, Stripe не повторяет доставку, и оплаченная подписка теряется. | 
| M-06 | **MAJOR** | Надёжность / AI и чат | `src/chat/chat.controller.ts:56-73`, `src/chat/chat.service.ts:53-99`, `src/body-analysis/body-analysis.service.ts:102-123`, `src/openai/openai.service.ts:141-189` | В чате лимит бесплатных сообщений (`consumeChatMessage`) и сообщение пользователя списываются/сохраняются до ответа AI; в `analyzeBodyFromPhoto` при ошибке/отсутствии ключа возвращается заглушка `{ estimatedBodyFat: 20, estimatedMuscleMass: 40 }`, которая пишется в БД и стирает сохранённый прогноз. | При ошибке провайдера OpenRouter (502/503/timeout) пользователь без подписки теряет бесплатные попытки чата, а в `body_analyses` сохраняются фальшивые замеры `20% / 40%` с удалением предыдущего прогноза фигуры. | 
| M-07 | **MAJOR** | Безопасность / Валидация и Auth | `src/users/users.service.ts:107-190`, `src/users/users.controller.ts:24-42`, `src/auth/auth.service.ts:95-113` | `PATCH /users/:id/profile` позволяет менять `email` без кода подтверждения и не валидирует типы/границы `height`, `weight`, `birthDate`, `avatarUrl`; в `verifyAndConsume` нет счётчика неверных попыток ввода email-кода. | Передача нечислового `weight` или длинного `avatarUrl` вызывает необработанную ошибку БД (HTTP 500); смена `email` на чужой вызывает `UniqueConstraintError` (500) или угон сессии; 6-значный код подтверждения не сгорает при переборе. | 
| M-08 | **MAJOR** | Безопасность / Загрузка файлов | `src/fridge/fridge-image.storage.ts:56-62`, `89-105` | В `assertInside` проверка `target.startsWith(root)` не добавляет `path.sep`; при сбое `optimizeImageBuffer` расширение файла берётся из клиентского `extname(originalName)`. | Путь `/app/uploads-other` проходит проверку `startsWith('/app/uploads')`; при ошибке `sharp` файл сохраняется с произвольным расширением из `originalName` (например `.html` или `.svg`) в статический каталог Nginx `/uploads/fridge/`. | 
| M-09 | **MAJOR** | Производительность / Память и статистика | `src/admin/admin.service.ts:397-401`, `468-473`, `588-715`, `src/stats/stats.service.ts:95-169` | `AdminService.recognitionStats()` и `StatsService` (`userProgress`, `kbjuStats`, `comparePlanVsFact`) выгружают все строки `meals` вместе с многомегабайтным `photoUrl` (base64); `StatsService` суммирует даже отклонённые модератором (`status = 'rejected'`) записи; `computeDailyStats` грузит все таблицы целиком в память. | Вызов статистики перекачивает десятки мегабайт base64-картинок из Postgres в Node.js ради подсчёта суммы калорий или `AVG(confidence)`, а отклонённые модератором распознавания искажают статистику КБЖУ пользователя. | 
| M-10 | **MAJOR** | Фронтенд / API-интеграция | `frontend/src/pages/LoginPage.tsx:206-218`, `frontend/src/auth/auth.controller.ts:29-31`, `frontend/src/context/AuthContext.tsx:76-81` | При регистрации `LoginPage.tsx` отправляет поле `displayName`, тогда как `AuthController.register` принимает только `name`; при выходе `AuthContext.logout()` не вызывает `POST /auth/logout`. | Имя пользователя при регистрации отбрасывается whitelist-валидатором сервера (в БД записывается часть email до `@`), а при выходе из аккаунта `refreshTokenHash` в БД не аннулируется. | 
| M-11 | **MAJOR** | Фронтенд / Логика холодильника и админки | `frontend/src/pages/MealPlanPage.tsx:167`, `1566-1568`, `frontend/src/pages/AdminPage.tsx:359-366` | В `MealPlanPage.tsx:1567` строка ингредиента вида `"Курица - 160 г"` режется через `.split('—')` (длинное тире) вместо `.split(' - ')`; в `AdminPage.tsx:361` при начальной загрузке дашборда в `setBillingCosts` не копируется поле `openRouter`. | В `POST /users/:id/fridge/missing` уходит `"Курица - 160 г"` вместе с граммами, ломая сопоставление коротких слов (`рис`, `сыр`, `лук`) и выводя граммовки в списке покупок; в админке расходы OpenRouter не отображаются до ручного нажатия кнопки «Обновить». | 
| M-12 | **MAJOR** | Фронтенд / Обработка ошибок и SubscriptionGate | `frontend/src/pages/ProfilePage.tsx:233-275`, `frontend/src/pages/RecommendationsPage.tsx:83-109`, `frontend/src/pages/BodyAnalysisPage.tsx:239-256`, `frontend/src/pages/MealPlanPage.tsx:935-985` | В `ProfilePage` (`onSubmit`, `changePassword`), `RecommendationsPage` (`onGenerate`), `BodyAnalysisPage` (`loadDetailedRecommendation`, `loadForecast`) отсутствуют `catch`-блоки; платные кнопки ИИ (кроме `FoodRecognitionPage`) не обёрнуты в `<SubscriptionGate>`. | При ошибке 402 (нет подписки) или неверном старом пароле промисы отклоняются без перехвата — пользователь видит мигающий спиннер и полное отсутствие сообщения об ошибке. | 
| m-01 | **MINOR** | Производительность / Кэширование | `src/health/health.controller.ts:34-95`, `src/app.module.ts` | Пакет `@nestjs/cache-manager` установлен, а в комментарии к `HealthController.catalogStats` заявлено кэширование на 5 минут, но кэш нигде в проекте не подключён. | Каждое открытие главной страницы выполняет `COUNT(*) FILTER ...` и `ORDER BY random() LIMIT 4` по таблице `products`. | 
| m-02 | **MINOR** | Производительность / Повторные запросы | `src/meal-plan/meal-plan.service.ts:693-706`, `943-965`, `1091-1115`, `1825-1830`, `2719-2783`, `2845-2965` | За один вызов `refineConstructorPlanWithAi` или `generateAiPlan` таблица `products` полностью выгружается из БД от 9 до 13 раз подряд в разных приватных методах. | Лишняя нагрузка на БД и сборщик мусора при каждой генерации плана. | 
| m-03 | **MINOR** | Производительность / Бандл фронтенда | `frontend/src/App.tsx:4-17`, `frontend/src/components/icons.tsx:16`, `frontend/src/pages/MealPlanPage.tsx:13` | `import * as Lucide from 'lucide-react'` тянет все \~1500 иконок в основной бандл; `html2pdf.js` и все 14 страниц импортируются статически без `React.lazy`. | Итоговый JS-чанк превышает 2.4 МБ, замедляя первую загрузку приложения. | 
| m-04 | **MINOR** | Архитектура / Декомпозиция | `src/meal-plan/meal-plan.service.ts` (3016 строк), `frontend/src/pages/MealPlanPage.tsx` (2117 строк), `frontend/src/pages/AdminPage.tsx` (1797 строк) | Сверхкрупные файлы совмещают множество несвязанных ответственностей (генерация, добор калорий, валидация, AI-доработка, UI-модалки, CRUD всех таблиц админки). | Затрудняет поддержку, тестирование и повышает риск регрессий при правках. | 
| m-05 | **MINOR** | Тесты / Компиляция | `src/tests/unit/users.service.test.ts:21, 39, 49, 71, 97, 115, 137` | В 7 местах вызывается `new UsersService(userModel, allergenModel, fridgeModel)` с 3 аргументами вместо 5 (`ingredientModel`, `fridgeImageStorage`). | `tsc --noEmit` падает с ошибкой `TS2554: Expected 5 arguments, but got 3` (в `npm test` ошибка скрыта флагом `transpileOnly: true` в `scripts/mocha-register.cjs`). При этом `../../common/password.util` в репозитории присутствует и работает корректно. | 
| m-06 | **MINOR** | Тесты / Ложноположительные тесты | `src/tests/unit/*.test.ts` (38 файлов из 74, включая `plan-seed.test.ts`, `plan-variety.test.ts`, `guest-role.test.ts`, `meal-plan-save.validation.test.ts`) | 38 из 74 unit-тестов не импортируют ни одного файла из `src/` и проверяют локальные функции, скопированные внутрь самого теста (например, `plan-seed.test.ts` тестирует старую линейную формулу вместо FNV-1a из `MealPlanService`). | Тесты всегда зелёные, даже если удалить или сломать `MealPlanService`, `FullUserGuard`, `AdminService` или `MigrationRunner`. | 
| m-07 | **MINOR** | Алгоритмы / Валидация входа | `src/meal-plan/meal-plan.service.ts:1777`, `2802`, `src/openai/openai.validators.ts:135-137` | `generatePlan` и `generateAiPlan` проверяют `durationDays` только внутри `saveUserPlan` после обращения к БД и OpenAI; пустой массив `items: []` при распознавании не-еды бросает ошибку, превращающуюся в HTTP 503 (`ServiceUnavailableException`). | Некорректный `durationDays` тратит платный запрос к AI перед ошибкой 400; фото пустой тарелки возвращает 503 «Проверьте ключ OpenAI» вместо 400/пустого результата. | 
| N-01 | **NIT** | Архитектура / Guards | `src/recommendation/recommendation.controller.ts:18-20` | На методе `generate` висят два отдельных декоратора `@UseGuards(RequireSubscriptionGuard)` и `@UseGuards(JwtAuthGuard, FullUserGuard)` на уровне метода, а контроллер не имеет `@UseGuards` на уровне класса. | Ухудшает читаемость порядка выполнения guard-ов (хотя из-за bottom-up выполнения декораторов в TS `JwtAuthGuard` срабатывает первым). | 
| N-02 | **NIT** | Архитектура / Модели Sequelize | `src/app.module.ts:65-93` | В массиве `models` внутри `SequelizeModule.forRoot` перечислены 26 из 29 моделей (пропущены `AiChatUsage`, `Notification`, `Subscription`). | Они подхватываются только благодаря `autoLoadModels: true`, но явный список `models` в `AppModule` рассинхронизирован с `src/models/`. | 

## Часть 3. План правок для Gemini 3.8 Flash

Порядок выполнения: задачи сгруппированы по приоритету (**BLOCKER → MAJOR → MINOR**) и по общим файлам.
**Ограничения параллельности:**

* Задачи **1 и 2** править последовательно (общие файлы схемы/моделей и `auth.bootstrap.service.ts`).

* Задачи **5, 6, 7 и 21** править последовательно (все изменяют `src/meal-plan/meal-plan.service.ts`).

* Задачи **3 и 13** править последовательно (обе затрагивают `src/admin/admin.service.ts`).

* Задачи **15, 16 и 22** править последовательно (общие файлы фронтенда `MealPlanPage.tsx` и `AdminPage.tsx`).

### Задача 1. Отключить повторный прогон деструктивных SQL-миграций в `AuthBootstrapService` и `synchronize: true`

* Критичность: BLOCKER

* Файлы: `src/auth/auth.bootstrap.service.ts`, `src/database/catalog-bootstrap.service.ts`, `docker-compose.yml`

* Что сделать:

  1. В `src/auth/auth.bootstrap.service.ts` удалить вызовы `ensureProductsSchema`, `ensureMealPlannerSchema`, `ensureUserDietarySchema`, `ensureUserLastActiveSchema`, `ensureBodyAnalysisWeightSchema`, `ensurePhotoUrlTextSchema`, `ensureBodyForecastSchema` (строки 42–48) и их импорты (строки 6–12), так как `runMigrations(this.sequelize)` на строках 28–40 уже централизованно и однократно выполняет все файлы из `database/migrations/*.sql` с учётом таблицы `schema_migrations`.

  2. В `src/database/catalog-bootstrap.service.ts` удалить вызов `await ensureProductsSchema(this.refModifierModel.sequelize);` (строка 17) и его импорт (строка 6).

  3. В `docker-compose.yml` в сервисе `api` (строка 36) изменить `DB_AUTO_SYNC: "${DB_AUTO_SYNC:-0}"`, чтобы схема управлялась миграциями, либо оставить `DB_AUTO_SYNC: '1'` только после добавления `onDelete: 'CASCADE'` во все модели в Задаче 2.

* Код:

```
// ДО (src/auth/auth.bootstrap.service.ts:40-49):
    } catch (e) {
      this.logger.error(
        `Прогон миграций не удался: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    await ensureProductsSchema(this.sequelize);
    await ensureMealPlannerSchema(this.sequelize);
    await ensureUserDietarySchema(this.sequelize);
    await ensureUserLastActiveSchema(this.sequelize);
    await ensureBodyAnalysisWeightSchema(this.sequelize);
    await ensurePhotoUrlTextSchema(this.sequelize);
    await ensureBodyForecastSchema(this.sequelize);

// ПОСЛЕ (src/auth/auth.bootstrap.service.ts:40-44):
    } catch (e) {
      this.logger.error(
        `Прогон миграций не удался: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

```

* Проверка: добавить продукт в холодильник с `unit: "л"`, `quantity: 2` (`POST /api/users/:id/fridge`), перезапустить контейнер `api` (`docker compose restart api`) и вызвать `GET /api/users/:id/fridge` — единица измерения должна остаться `"л"`, а количество `2` (не `"мл"` и не `"г"`).

* Риск: на совершенно чистой БД, где базовые таблицы создаются через `synchronize: true`, `sequelize.sync()` отрабатывает до `onModuleInit`, а `runMigrations` накатывает все `000..031` ровно один раз. Откат: вернуть вызовы `ensure*`, исключив из `MEAL_PLANNER_MIGRATIONS` файлы `013_fridge_mass_units.sql` и `031_fridge_unit_variety.sql`.

### Задача 2. Добавить `onDelete: 'CASCADE'`, уникальный индекс `AiChatUsage` и очистку файлов при удалении

* Критичность: BLOCKER

* Файлы: `src/app.module.ts`, `src/models/AiChatUsage.ts`, `src/models/BodyAnalysis.ts`, `src/models/ChatMessage.ts`, `src/models/FridgeItem.ts`, `src/models/Meal.ts`, `src/models/MealItem.ts`, `src/models/MealPlan.ts`, `src/models/MealPlanDay.ts`, `src/models/Notification.ts`, `src/models/Subscription.ts`, `src/models/Suggestion.ts`, `src/models/WorkoutPlan.ts`, `src/models/WorkoutPlanDay.ts`, `src/users/users.service.ts`, `src/admin/admin.service.ts`, `src/admin/admin.module.ts`

* Что сделать:

  1. В `src/app.module.ts` добавить `AiChatUsage`, `Notification`, `Subscription` в массив `models` в `SequelizeModule.forRoot` (строки 65–93).

  2. В `src/models/AiChatUsage.ts` добавить в `@Table` индекс `indexes: [{ name: 'ai_chat_usage_user_date_key', unique: true, fields: ['user_id', 'date'] }]` и `@BelongsTo(() => User, { onDelete: 'CASCADE' })`.

  3. Во всех дочерних моделях (`BodyAnalysis`, `ChatMessage`, `FridgeItem`, `MealPlan`, `Notification`, `Subscription`, `Suggestion`, `WorkoutPlan`) заменить `@BelongsTo(() => User)` на `@BelongsTo(() => User, { onDelete: 'CASCADE' })`. В `Meal.ts` заменить `@BelongsTo(() => User, 'userId')` на `@BelongsTo(() => User, { foreignKey: 'userId', onDelete: 'CASCADE' })` и `@BelongsTo(() => User, { foreignKey: 'correctedByAdminId', onDelete: 'SET NULL' })`. В `MealItem.ts` — `@BelongsTo(() => Meal, { onDelete: 'CASCADE' })`, в `MealPlanDay.ts` — `@BelongsTo(() => MealPlan, { onDelete: 'CASCADE' })`, в `WorkoutPlanDay.ts` — `@BelongsTo(() => WorkoutPlan, { onDelete: 'CASCADE' })`.

  4. В `src/users/users.service.ts` в методе `deleteFridgeItem` (строки 448–455) перед `await row.destroy()` добавить удаление файла изображения, если `row.imageSource === 'user' && row.imageUrl`.

  5. В `src/admin/admin.service.ts` в методе `deleteUser` (строки 144–149) обернуть удаление пользователя и связанных записей в транзакцию, предварительно удалив его файлы холодильника с диска (либо удалив дочерние записи перед `user.destroy()`, чтобы удаление работало даже на старой БД, созданной без `ON DELETE CASCADE`).

* Код:

```
// ДО (src/users/users.service.ts:448-455):
  async deleteFridgeItem(userId: string, itemId: string) {
    const row = await this.fridgeItemModel.findOne({
      where: { id: itemId, userId: Number(userId) },
    });
    if (!row) throw new NotFoundException('Fridge item not found');
    await row.destroy();
    return { ok: true };
  }

// ПОСЛЕ (src/users/users.service.ts:448-458):
  async deleteFridgeItem(userId: string, itemId: string) {
    const row = await this.fridgeItemModel.findOne({
      where: { id: itemId, userId: Number(userId) },
    });
    if (!row) throw new NotFoundException('Fridge item not found');
    if (row.imageSource === 'user' && row.imageUrl) {
      await this.fridgeImageStorage.removeByUrl(row.imageUrl);
    }
    await row.destroy();
    return { ok: true };
  }

```

* Проверка: создать пользователя с планом питания и продуктом в холодильнике с загруженным фото, вызвать `DELETE /api/admin/users/:id` — ответ `200 { "ok": true }`, файл из `/app/uploads/fridge/` удалён.

* Риск: минимальный; каскадное удаление соответствует бизнес-логике. Откат: `git checkout` затронутых моделей.

### Задача 3. Устранить бесконечный цикл в `AdminService.aiLocalizeCatalogAll`

* Критичность: BLOCKER

* Файлы: `src/admin/admin.service.ts`

* Что сделать:

  1. В методе `aiLocalizeCatalogAll` (`src/admin/admin.service.ts:699-755`) убрать цикл `while (true)` с `offset: onlyMissingDetailed ? 0 : offset`.

  2. Вместо повторных `findAll` с `offset: 0` отслеживать `attemptedIds = new Set<string>()` или увеличивать `offset` на число неудачных (`failedInBatch`) позиций в текущей пачке: если в режиме `onlyMissingDetailed` позиция обновилась, она исчезает из выборки `where`, а если НЕ обновилась — она остаётся в выборке, поэтому `offset` должен увеличиваться на `batchFailed`, либо из `where` должны исключаться уже проверенные `id: { [Op.notIn]: [...attemptedIds] }`.

* Код:

```
// ДО (src/admin/admin.service.ts:717-755):
    while (true) {
      const rows = await this.productModel.findAll({
        where,
        order: [['createdAt', 'DESC'], ['id', 'ASC']],
        limit: batchSize,
        offset: onlyMissingDetailed ? 0 : offset,
      });
      if (rows.length === 0) break;
      ...
      if (!onlyMissingDetailed) offset += rows.length;
    }

// ПОСЛЕ (src/admin/admin.service.ts:717-758):
    let failedOffset = 0;
    while (true) {
      const rows = await this.productModel.findAll({
        where,
        order: [['createdAt', 'DESC'], ['id', 'ASC']],
        limit: batchSize,
        offset: onlyMissingDetailed ? failedOffset : offset,
      });
      if (rows.length === 0) break;
      batches += 1;
      let batchFailed = 0;
      for (const p of rows) {
        if (delayMs > 0) await sleep(delayMs);
        processed += 1;
        try {
          const nameBefore = p.name;
          const one = await this.aiLocalizeSingleProduct(p);
          if (!one.updated) {
            failed += 1;
            batchFailed += 1;
            errors.push(`${p.id}: ${one.error ?? 'no update'}`);
            processedItems.push({ id: p.id, nameBefore, updated: false });
            continue;
          }
          updated += 1;
          processedItems.push({ id: p.id, nameBefore, updated: true });
        } catch (e: unknown) {
          failed += 1;
          batchFailed += 1;
          errors.push(`${p.id}: ${e instanceof Error ? e.message : String(e)}`);
          processedItems.push({ id: p.id, nameBefore: p.name, updated: false });
        }
      }
      if (onlyMissingDetailed) failedOffset += batchFailed;
      else offset += rows.length;
    }

```

* Проверка: при моке `localizeDishForCatalog`, возвращающем `null`, вызвать `aiLocalizeCatalogAll({ batchSize: 5, onlyMissingDetailed: true })` — метод завершается за `ceil(totalCandidates / 5)` итераций, `processed === totalCandidates`.

* Риск: отсутствует. Откат: `git checkout src/admin/admin.service.ts`.

### Задача 4. Закрыть платные AI-эндпоинты `RequireSubscriptionGuard` и включить глобальный `ThrottlerGuard`

* Критичность: BLOCKER

* Файлы: `src/app.module.ts`, `src/meal-plan/meal-plan.controller.ts`, `src/body-analysis/body-analysis.controller.ts`, `src/chat/chat.controller.ts`, `src/recommendation/recommendation.controller.ts`

* Что сделать:

  1. В `src/app.module.ts` зарегистрировать `{ provide: APP_GUARD, useClass: ThrottlerGuard }` в `providers` модуля `AppModule`.

  2. В `src/meal-plan/meal-plan.controller.ts` на методы `@Post('generate-ai-catalog')` (строка 235) и `@Post('refine-constructor-ai')` (строка 246) добавить декораторы `@UseGuards(RequireSubscriptionGuard)` и `@Throttle({ default: { ttl: 60_000, limit: 5 } })`.

  3. В `src/body-analysis/body-analysis.controller.ts` на метод `@Post('forecast')` (строка 26) добавить `@Throttle({ default: { ttl: 60_000, limit: 3 } })`.

  4. В `src/chat/chat.controller.ts` на метод `@Post('message')` (строка 50) добавить `@Throttle({ default: { ttl: 60_000, limit: 15 } })`.

  5. В `src/recommendation/recommendation.controller.ts` (строки 9–20) вынести `@UseGuards(JwtAuthGuard, FullUserGuard, RequireSubscriptionGuard)` и `@Throttle({ default: { ttl: 60_000, limit: 10 } })` в один декоратор на `@Post('generate')`.

* Код:

```
// ДО (src/meal-plan/meal-plan.controller.ts:235-256):
  @Post('generate-ai-catalog')
  generateAiCatalog(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; durationDays: number; targetCalories?: number },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.generateAiPlan(body.userId, body.durationDays, {
      targetCalories: body.targetCalories,
    });
  }

  @Post('refine-constructor-ai')
  refineConstructorAi(

// ПОСЛЕ (src/meal-plan/meal-plan.controller.ts:235-260):
  @Post('generate-ai-catalog')
  @UseGuards(RequireSubscriptionGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  generateAiCatalog(
    @Req() req: Request & { user?: { sub?: number; role?: string } },
    @Body() body: { userId: string; durationDays: number; targetCalories?: number },
  ) {
    assertUserAccess(req.user, body.userId);
    return this.mealPlanService.generateAiPlan(body.userId, body.durationDays, {
      targetCalories: body.targetCalories,
    });
  }

  @Post('refine-constructor-ai')
  @UseGuards(RequireSubscriptionGuard)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  refineConstructorAi(

```

* Проверка: выполнить `POST /api/meal-plan/generate-ai-catalog` с токеном пользователя без подписки — должен вернуться статус `402 Payment Required` с `error: "subscription_required"`. Выполнить `npm run docs:api` для обновления `docs/API.md`.

* Риск: интеграционные или нагрузочные тесты (`k6`), отправляющие >100 запросов в минуту с одного IP, могут получить 429. Откат: убрать `APP_GUARD` из `AppModule` и оставить `ThrottlerGuard` на контроллерах.

### Задача 5. Исправить снимок ограничений плана (`restrictionSnapshot`) и загрузку аллергенов пользователя

* Критичность: BLOCKER

* Файлы: `src/meal-plan/meal-plan.service.ts`

* Что сделать:

  1. В методе `restrictionSnapshot` (`src/meal-plan/meal-plan.service.ts:272-292`) извлекать имя аллергена из объекта `Allergen`: `typeof a === 'object' && a !== null && 'name' in a ? String((a as { name: unknown }).name) : String(a)`.

  2. В методах `saveUserPlan` (строка 2106), `clonePlan` (строка 2290), `activatePlan` (строка 2378) и `planRestrictionDiff` (строка 2416) заменить `this.userModel.findByPk(this.uid(userId))` на `this.loadPlanningUser(userId)` (который включает `include: [Allergen]`).

* Код:

```
// ДО (src/meal-plan/meal-plan.service.ts:272-276):
  private restrictionSnapshot(user: User): Record<string, unknown> {
    const allergies = Array.isArray(user.allergens)
      ? [...user.allergens].map((a) => String(a).trim().toLowerCase()).filter(Boolean).sort()
      : [];

// ПОСЛЕ (src/meal-plan/meal-plan.service.ts:272-281):
  private restrictionSnapshot(user: User & { allergens?: Array<Allergen | string> }): Record<string, unknown> {
    const allergies = Array.isArray(user.allergens)
      ? [...user.allergens]
          .map((a) =>
            (typeof a === 'object' && a !== null && 'name' in a
              ? String((a as { name?: unknown }).name ?? '')
              : String(a ?? '')
            )
              .trim()
              .toLowerCase(),
          )
          .filter(Boolean)
          .sort()
      : [];

```

* Проверка: сгенерировать план, затем добавить аллерген в профиле (`PATCH /api/users/:id/allergies`) и вызвать `GET /api/meal-plan/plans/:userId/:planId/restrictions-diff` — в ответе `upToDate: false`, а массив `changed` содержит `{ field: "allergens", ... }`.

* Риск: отсутствует. Откат: `git checkout src/meal-plan/meal-plan.service.ts`.

### Задача 6. Исправить фильтрацию `isPublished` и утечку аллергенов в фолбэке `applyWeeklySnackAlcoholBudgetToPlanDays`

* Критичность: BLOCKER

* Файлы: `src/meal-plan/meal-plan.service.ts`

* Что сделать:

  1. В `applyWeeklySnackAlcoholBudgetToPlanDays` (`src/meal-plan/meal-plan.service.ts:949-960`) добавить `isPublished: { [Op.ne]: false }` в `where` и убрать небезопасный фолбэк `: (sRaw as Product[])` на строке 958 — заменить на `const snackPool = pools.snack;`. Если `mainPools` уже передан вызывающим кодом, вообще не делать повторный запрос к БД, а использовать `mainPools.snack`!

  2. В `generatePlan` (`src/meal-plan/meal-plan.service.ts:1825-1830`) добавить `isPublished: { [Op.ne]: false }` во все четыре запроса `this.productModel.findAll`.

* Код:

```
// ДО (src/meal-plan/meal-plan.service.ts:943-965):
  private async applyWeeklySnackAlcoholBudgetToPlanDays(
    days: SaveMealPlanDayDto[],
    user: User & { allergens?: Allergen[] },
    pref: PreferenceContext,
    mainPools?: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  ): Promise<SaveMealPlanDayDto[]> {
    const sRaw = await this.productModel.findAll({
      where: { category: 'snack' },
      order: [
        ['calories', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    const pools = this.buildFilteredPools(
      { breakfast: [], lunch: [], dinner: [], snack: sRaw },
      user,
    );
    const snackPool = pools.snack.length > 0 ? pools.snack : (sRaw as Product[]);
    const effectiveMain = mainPools ?? pools;
    return this.applyWeeklySnackAlcoholBudget(days, snackPool, pref, {
      breakfast: effectiveMain.breakfast,
      lunch: effectiveMain.lunch,
      dinner: effectiveMain.dinner,
    });
  }

// ПОСЛЕ (src/meal-plan/meal-plan.service.ts:943-965):
  private async applyWeeklySnackAlcoholBudgetToPlanDays(
    days: SaveMealPlanDayDto[],
    user: User & { allergens?: Allergen[] },
    pref: PreferenceContext,
    mainPools?: { breakfast: Product[]; lunch: Product[]; dinner: Product[]; snack: Product[] },
  ): Promise<SaveMealPlanDayDto[]> {
    if (mainPools) {
      return this.applyWeeklySnackAlcoholBudget(days, mainPools.snack, pref, {
        breakfast: mainPools.breakfast,
        lunch: mainPools.lunch,
        dinner: mainPools.dinner,
      });
    }
    const sRaw = await this.productModel.findAll({
      where: { category: 'snack', isPublished: { [Op.ne]: false } },
      order: [
        ['calories', 'ASC'],
        ['id', 'ASC'],
      ],
    });
    const pools = this.buildFilteredPools(
      { breakfast: [], lunch: [], dinner: [], snack: sRaw },
      user,
      pref,
    );
    return this.applyWeeklySnackAlcoholBudget(days, pools.snack, pref, {
      breakfast: pools.breakfast,
      lunch: pools.lunch,
      dinner: pools.dinner,
    });
  }

```

* Проверка: пометить блюдо в БД `is_published = false` и сгенерировать автоплан (`POST /api/meal-plan/generate-auto`) — скрытое блюдо не должно появляться в плане.

* Риск: отсутствует (плюс устраняется лишний SQL-запрос при каждом вызове `finalizeGeneratedPlanDays`).

### Задача 7. Исправить проверку аллергенов в `productHasUserAllergen` и словарь `slovari.ts`

* Критичность: MAJOR

* Файлы: `src/meal-plan/dietary-rules.ts`, `src/meal-plan/slovari.ts`

* Что сделать:

  1. В `src/meal-plan/slovari.ts` (строки 131–150) заменить строки с регулярными скобками на чистые префиксы/фразы: `'лесн(ый|ого) орех'` → `'лесной орех'`, `'лесного орех'`; `'морск(ой|ие) коктейл'` → `'морской коктейл'`, `'морские коктейл'`; `'яичн(ый|ая|ое) белок'` → `'яичный белок'`, `'яичного белка'`; `'соев(ый|ая|ое) соус'` → `'соевый соус'`.

  2. В `src/meal-plan/dietary-rules.ts` в функции `productHasUserAllergen` (строки 399–413) проверять не только `detailedIngredientNames(product)`, но и `simpleIngredientNames(product)` + `p.name` (если `detailedNames` пуст, брать `simpleIngredientNames` и название блюда), а вместо `ing.includes(key)` / `ing.includes(ex)` вызывать `containsDietKey(ing, key)` / `containsDietKey(ing, ex)`.

* Код:

```
// ДО (src/meal-plan/dietary-rules.ts:399-413):
export function productHasUserAllergen(product: Product, userAllergenNames: Set<string>): boolean {
  if (userAllergenNames.size === 0) return false;
  if (catalogAllergenHitsUser(product, userAllergenNames)) return true;

  const detailedNames = detailedIngredientNames(product);
  if (detailedNames.length === 0) return true;
  for (const userTag of userAllergenNames) {
    const raw = n(userTag);
    const key = ALLERGEN_SYNONYMS_MAP[raw] ?? raw;
    const expand = ALLERGEN_EXPANSION[key];
    if (detailedNames.some((ing) => ing.includes(key))) return true;
    if (!expand) continue;
    for (const ex of expand) {
      if (detailedNames.some((ing) => ing.includes(ex))) return true;
    }
  }
  return false;
}

// ПОСЛЕ (src/meal-plan/dietary-rules.ts:399-419):
export function productHasUserAllergen(product: Product, userAllergenNames: Set<string>): boolean {
  if (userAllergenNames.size === 0) return false;
  if (catalogAllergenHitsUser(product, userAllergenNames)) return true;

  const probes = [
    ...detailedIngredientNames(product),
    ...simpleIngredientNames(product),
    n(String(product.name ?? '').trim()),
  ].filter(Boolean);
  if (probes.length === 0) return true;

  for (const userTag of userAllergenNames) {
    const raw = n(userTag);
    const key = ALLERGEN_SYNONYMS_MAP[raw] ?? raw;
    const expand = ALLERGEN_EXPANSION[key];
    if (probes.some((ing) => containsDietKey(ing, key))) return true;
    if (!expand) continue;
    for (const ex of expand) {
      if (probes.some((ing) => containsDietKey(ing, ex))) return true;
    }
  }
  return false;
}

```

* Проверка: запустить `npx mocha --require ./scripts/mocha-register.cjs src/tests/unit/allergen-dictionary.test.ts src/tests/unit/diet-key-match.test.ts` и проверить, что блюдо с ингредиентом `Помидоры` НЕ блокируется при аллергии `морепродукты`, а блюдо с `Соевый соус` блокируется при аллергии `соя`.

* Риск: минимальный; существующие unit-тесты `allergen-dictionary.test.ts` сразу проверят регрессии.

### Задача 8. Устранить ложные предупреждения об аллергенах при пустом профиле в `FoodRecognitionService`

* Критичность: BLOCKER

* Файлы: `src/food-recognition/food-recognition.service.ts`, `src/openai/openai.validators.ts`

* Что сделать:

  1. В `src/food-recognition/food-recognition.service.ts` в методе `buildAllergenWarnings` (строка 412) заменить `if (allergySet.size > 0 && !allergySet.has(allergen)) continue;` на `if (!allergySet.has(allergen)) continue;`.

  2. В `previewRecognize` (`src/food-recognition/food-recognition.service.ts:324-328`) убрать запись уведомлений в БД (`this.notifications.saveAllergenWarnings`), оставив её только в `submitMealForModeration` (строки 381–385), чтобы предпросмотр не засорял таблицу `notifications` дубликатами.

  3. В `src/openai/openai.validators.ts:135-137` не бросать исключение при пустом `items: []` (если на фото нет еды), либо в `FoodRecognitionService.previewRecognize` выбрасывать `BadRequestException('На фотографии не удалось распознать блюда. Попробуйте другой снимок.')` вместо `ServiceUnavailableException` (503).

* Код:

```
// ДО (src/food-recognition/food-recognition.service.ts:411-417):
      const compositionAllergens = this.detectAllergensFromIngredients(item);
      for (const allergen of compositionAllergens) {
        if (allergySet.size > 0 && !allergySet.has(allergen)) continue;
        const human = ALLERGEN_LABELS_RU[allergen] ?? allergen;
        allergenWarnings.push(
          `В составе «${item.foodName}» обнаружен аллерген «${human}» — совпадение с вашим профилем.`,
        );
      }

// ПОСЛЕ (src/food-recognition/food-recognition.service.ts:411-417):
      const compositionAllergens = this.detectAllergensFromIngredients(item);
      for (const allergen of compositionAllergens) {
        if (!allergySet.has(allergen)) continue;
        const human = ALLERGEN_LABELS_RU[allergen] ?? allergen;
        allergenWarnings.push(
          `В составе «${item.foodName}» обнаружен аллерген «${human}» — совпадение с вашим профилем.`,
        );
      }

```

* Проверка: у пользователя с пустым списком аллергий (`allergens: []`) распознать блюдо с яйцом или молоком — `allergenWarnings` должен быть `[]`, `hasAllergenMatchInProfile: false`, `hasDetectedAllergensInDish: true`.

* Риск: отсутствует.

### Задача 9. Исправить расчёт калорий, дедупликацию и сохранение перекусов при клонировании в `MealPlanService`

* Критичность: MAJOR

* Файлы: `src/meal-plan/meal-plan.service.ts`

* Что сделать:

  1. В начале `generatePlan` (строка 1777) и `generateAiPlan` (строка 2802) добавить проверку `durationDays` (`!Number.isInteger(Number(durationDays)) || durationDays < 1 || durationDays > MAX_PLAN_DAYS` → `BadRequestException`), чтобы не делать запросы к OpenAI при невалидной длительности.

  2. В `deduplicateAcrossDays` (строки 618–626) выбирать не первое попавшееся блюдо (`pool.find`), а блюдо, ближайшее по калорийности к заменяемому слоту среди неиспользованных (`this.pickClosestByCalories(unusedPool, Number(snap.calories) || 300, pref)`).

  3. В `generatePlan` (строки 2020–2034) убрать двойное масштабирование: сначала выполнять `finalizeGeneratedPlanDays(days, user, pref, pools)`, а затем один раз масштабировать итоговые дни через `scaleDaySnapshotsToTarget(d, targetForDay(idx), CALORIE_TARGET_STRICT_TOLERANCE)`.

  4. В `generateAiPlan` (строка 2964) и `refineConstructorPlanWithAi` (строка 2792) вызывать `scaleDaySnapshotsToTarget` **после** `enforceDietaryForAiDays`, чтобы замены блюд и привычки (`mealsPerDay`) не сбивали целевую калорийность дня.

  5. В `clonePlan` (строка 2357) записывать `snacks: [d.snack, ...(d.extraSnacks ?? [])].filter(Boolean) as MealSlotSnapshot[]` (как в `saveUserPlan:2219`).

* Код:

```
// ДО (src/meal-plan/meal-plan.service.ts:618-625):
        const pool = pools[slot] ?? [];
        // Кандидат: не используется в этом слоте и отличается от текущего.
        const candidate = pool.find((p) => {
          const pn = String(p.name ?? '').trim().toLowerCase();
          if (!pn || pn === name) return false;
          return (map.get(pn) ?? 0) === 0;
        });

// ПОСЛЕ (src/meal-plan/meal-plan.service.ts:618-628):
        const pool = pools[slot] ?? [];
        const unusedPool = pool.filter((p) => {
          const pn = String(p.name ?? '').trim().toLowerCase();
          if (!pn || pn === name) return false;
          return (map.get(pn) ?? 0) === 0;
        });
        const candidate = this.pickClosestByCalories(
          unusedPool,
          Number(snap.calories) || 300,
          pref,
        );

```

* Проверка: сгенерировать план на 7 дней (`POST /api/meal-plan/generate-auto`) и клонировать его (`POST /api/meal-plan/plans/:userId/:planId/clone`) — сумма калорий каждого дня должна попадать в `±5%` от `targetCalories`, а в клонированном плане сохраняются все перекусы.

* Риск: изменится порядок вызовов `scaleDaySnapshotsToTarget` — проверить тесты масштабирования.

### Задача 10. Обернуть многошаговые операции в транзакции (`MealPlanService`, `WorkoutPlanService`, `FoodRecognitionService`, `AdminService`)

* Критичность: MAJOR

* Файлы: `src/meal-plan/meal-plan.service.ts`, `src/workout-plan/workout-plan.service.ts`, `src/food-recognition/food-recognition.service.ts`, `src/admin/admin.service.ts`

* Что сделать:

  1. В `MealPlanService.activatePlan` (`src/meal-plan/meal-plan.service.ts:2398-2403`) обернуть архивацию активных планов и `plan.update({ status: 'active' })` в `this.mealPlanModel.sequelize!.transaction(...)` с блокировкой `SELECT id FROM users WHERE id = :id FOR UPDATE`.

  2. В `WorkoutPlanService` (`src/workout-plan/workout-plan.service.ts`) обернуть в `this.workoutPlanModel.sequelize!.transaction(...)` методы `saveUserPlan` (строки 151–183), `deletePlan` (строки 223–225), `activatePlan` (строки 234–236) и `clonePlan` (строки 247–274).

  3. В `FoodRecognitionService.submitMealForModeration` (`src/food-recognition/food-recognition.service.ts:369-379`) обернуть `mealModel.create` и `mealItemModel.bulkCreate` в одну транзакцию.

  4. В `AdminService.confirmMeal` (`src/admin/admin.service.ts:288-358`) обернуть создание продуктов и `meal.update({ status: 'confirmed' })` в транзакцию, используя `findOrCreate` по `name: localizedName`.

* Код:

```
// ДО (src/food-recognition/food-recognition.service.ts:369-379):
    const meal = await this.mealModel.create({
      userId: uid,
      photoUrl: photo.dataUrl,
      recognizedAt: new Date(),
      confidence: c,
      status: 'pending',
    } as Meal);

    await this.mealItemModel.bulkCreate(
      sanitized.map((item) => ({ mealId: meal.id, ...item })) as MealItem[],
    );

// ПОСЛЕ (src/food-recognition/food-recognition.service.ts:369-383):
    const meal = await this.mealModel.sequelize!.transaction(async (t) => {
      const created = await this.mealModel.create(
        {
          userId: uid,
          photoUrl: photo.dataUrl,
          recognizedAt: new Date(),
          confidence: c,
          status: 'pending',
        } as Meal,
        { transaction: t },
      );
      await this.mealItemModel.bulkCreate(
        sanitized.map((item) => ({ mealId: created.id, ...item })) as MealItem[],
        { transaction: t },
      );
      return created;
    });

```

* Проверка: отправить распознанное блюдо на модерацию (`POST /api/food-recognition/submit-meal`) и подтвердить его в админке (`POST /api/admin/meals/:id/confirm`), включая блюдо с двумя одинаковыми позициями — оба запроса должны завершиться `200/201` без `UniqueConstraintError`.

* Риск: в unit-тестах, где модели мокаются вручную без `sequelize.transaction`, использовать `this.mealModel.sequelize ? this.mealModel.sequelize.transaction(fn) : fn(undefined)`.

### Задача 11. Обеспечить атомарность и надёжность обработки вебхуков Stripe

* Критичность: MAJOR

* Файлы: `src/subscription/stripe-webhook.controller.ts`, `src/subscription/subscription.service.ts`

* Что сделать:

  1. В `src/subscription/stripe-webhook.controller.ts:80-87` при ошибке внутри `this.subscription.applyStripeEvent(event)` выбрасывать `InternalServerErrorException` (HTTP 500) вместо возврата `200 OK`, чтобы Stripe повторил доставку вебхука при временном сбое БД.

  2. В `src/subscription/subscription.service.ts` в методе `ensureCustomer` (строки 166–171) не перезаписывать существующий `status` на `'none'` — если запись `existing` уже есть, выполнять `await existing.update({ stripeCustomerId: customer.id } as never)`, иначе `upsertForUser(user.id, { stripeCustomerId: customer.id, status: 'none' })`.

  3. В `src/subscription/subscription.service.ts` в методе `upsertForUser` (строки 431–445) использовать `findOrCreate` по `userId` с последующим `update(patch)`, перехватывая `UniqueConstraintError` при параллельных вебхуках.

* Код:

```
// ДО (src/subscription/stripe-webhook.controller.ts:78-88):
    try {
      const applied = await this.subscription.applyStripeEvent(event);
      this.logger.log(
        `Событие ${event.type}: ${applied ? 'применено' : 'пропущено (нет подписки)'}`,
      );
    } catch (e) {
      this.logger.error(`Не удалось обработать ${event.type}: ${redactSecrets(String(e))}`);
    }
    return { received: true };

// ПОСЛЕ (src/subscription/stripe-webhook.controller.ts:78-89):
    try {
      const applied = await this.subscription.applyStripeEvent(event);
      this.logger.log(
        `Событие ${event.type}: ${applied ? 'применено' : 'пропущено (нет подписки)'}`,
      );
    } catch (e) {
      this.logger.error(`Не удалось обработать ${event.type}: ${redactSecrets(String(e))}`);
      throw new InternalServerErrorException('Ошибка обработки события Stripe.');
    }
    return { received: true };

```

* Проверка: отправить два параллельных события `checkout.session.completed` и `customer.subscription.updated` для нового пользователя — оба должны завершиться `200 OK`, запись в `subscriptions` имеет `status = 'active'`.

* Риск: если обработчик падает из-за бага в коде, Stripe будет ретраить событие; это штатное поведение Stripe.

### Задача 12. Не списывать лимит чата и не портить БД заглушками при сбое AI

* Критичность: MAJOR

* Файлы: `src/chat/chat.controller.ts`, `src/chat/chat.service.ts`, `src/openai/openai.service.ts`, `src/body-analysis/body-analysis.service.ts`, `src/openai/openai.validators.ts`

* Что сделать:

  1. В `src/chat/chat.service.ts:53-99` сохранять сообщение пользователя в `chat_messages` только **после** успешного получения ответа `openAiService.generateChatReply` (а историю для промпта собирать в памяти: `[...chronologicalMessages, { role: 'user', content: question }]`).

  2. В `src/subscription/subscription.service.ts` добавить метод `canSendChatMessage(userId)` (проверка без инкремента) или списывать `consumeChatMessage` в `ChatController.sendMessage` после успешного ответа `chatService.sendMessage` (либо откатывать счётчик в `catch`, если `chatService.sendMessage` выбросил исключение).

  3. В `src/openai/openai.service.ts` в `analyzeBodyFromPhoto` (строки 141–189) при отсутствии `this.client` или при ошибке API выбрасывать `ServiceUnavailableException(OPENROUTER_MISSING_KEY_MESSAGE)` (как в `recognizeFoodFromPhoto`), а не возвращать заглушку `20% / 40%`.

  4. В `src/openai/openai.validators.ts` в `parseBodyAnalysisResponse` (строки 86–96) ограничить `estimatedBodyFat` диапазоном `3..65`, а `estimatedMuscleMass` — диапазоном `15..75` (с фолбэком при `NaN`).

  5. В `src/body-analysis/body-analysis.service.ts:130` заменить `throw new Error('User not found')` на `throw new NotFoundException('User not found')`.

* Код:

```
// ДО (src/body-analysis/body-analysis.service.ts:128-132):
    const user = await this.userModel.findByPk(uid);
    if (!user) {
      throw new Error('User not found');
    }

// ПОСЛЕ (src/body-analysis/body-analysis.service.ts:128-132):
    const user = await this.userModel.findByPk(uid);
    if (!user) {
      throw new NotFoundException('User not found');
    }

```

* Проверка: при отключённом `OPENROUTER_API_KEY` отправить сообщение в чат (`POST /api/chat/message`) и фото тела (`POST /api/body-analysis/analyze`) — оба возвращают `503 Service Unavailable`, счётчик бесплатных сообщений чата не уменьшается, старый прогноз тела в БД не затирается.

* Риск: проверьте, не зависят ли тесты от заглушки `analyzeBodyFromPhoto` (в текущих 74 unit-тестах `analyzeBodyFromPhoto` нигде не вызывается).

### Задача 13. Оптимизировать запросы `StatsService` и `AdminService` (убрать выгрузку base64 и отклонённых блюд)

* Критичность: MAJOR

* Файлы: `src/stats/stats.service.ts`, `src/admin/admin.service.ts`

* Что сделать:

  1. В `src/stats/stats.service.ts` в методах `userProgress` (строка 95), `kbjuStats` (строка 121), `comparePlanVsFact` (строка 150) и `exportCsv` (строка 183) добавить в `mealModel.findAll`:

     * `attributes: ['id', 'recognizedAt', 'createdAt', 'confidence', 'status']` (исключая тяжёлое поле `photoUrl` с base64);

     * в `userProgress`, `kbjuStats`, `comparePlanVsFact` фильтр `status: { [Op.ne]: 'rejected' }`, чтобы отклонённые модератором записи не считались съеденными калориями.

  2. В `src/admin/admin.service.ts` в методе `recognitionStats` (строки 468–473) исключить `photoUrl`: `await this.mealModel.findAll({ attributes: ['id', 'confidence'], raw: true })`.

  3. В `src/admin/admin.service.ts` в методе `computeDailyStats` (строки 392–439) добавить фильтр `where: { createdAt: { [Op.gte]: since } }` для `meals` и `plans`, чтобы не выгружать всю историю БД за все годы.

* Код:

```
// ДО (src/admin/admin.service.ts:468-473):
  async recognitionStats() {
    const meals = await this.mealModel.findAll();
    const avgConfidenceScore =
      meals.reduce((sum, meal) => sum + meal.confidence, 0) / (meals.length || 1);
    return { avgConfidenceScore, total: meals.length };
  }

// ПОСЛЕ (src/admin/admin.service.ts:468-475):
  async recognitionStats() {
    const meals = await this.mealModel.findAll({
      attributes: ['id', 'confidence'],
      raw: true,
    });
    const avgConfidenceScore =
      meals.reduce((sum, meal) => sum + (Number(meal.confidence) || 0), 0) / (meals.length || 1);
    return { avgConfidenceScore, total: meals.length };
  }

```

* Проверка: запустить `npx mocha --require ./scripts/mocha-register.cjs src/tests/unit/stats.service.test.ts` — все тесты проходят; запрос `GET /api/admin/stats/recognition` не читает колонку `photoUrl`.

* Риск: отсутствует.

### Задача 14. Исправить валидацию профиля (`updateProfile`), защиту от брутфорса email-кодов и `FridgeImageStorage`

* Критичность: MAJOR

* Файлы: `src/users/users.service.ts`, `src/auth/auth.service.ts`, `src/fridge/fridge-image.storage.ts`

* Что сделать:

  1. В `src/users/users.service.ts` в методе `updateProfile` (строки 107–190):

     * Убрать `email` из списка `allowed` (либо нормализовать через `normalizeEmailForStorage`, проверять формат `EMAIL_RE` и уникальность через `findOne`, выбрасывая `BadRequestException('Email уже занят')` вместо 500 `UniqueConstraintError`).

     * Добавить проверку числовых полей (`height` 50..280, `weight` 20..500, `targetWeight` 20..500, `targetCalories` 500..10000), `birthDate` (валидная дата, возраст 0..120 лет) и длины `avatarUrl` (`<= 500` символов, только `http://` или `https://`).

  2. В `src/fridge/fridge-image.storage.ts`:

     * В `assertInside` (строки 56–62) проверять `target !== root && !target.startsWith(root + sep)` (импортировав `sep` из `'node:path'`).

     * В `save` (строка 91) выбирать запасное расширение строго по `mime` (`mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg'`), не используя `extname(originalName)`.

  3. В `src/auth/auth.service.ts` в `verifyAndConsume` (строки 95–113) использовать `timingSafeEqual` для сравнения `record.codeHash` и удалять код (`await record.destroy()`) при неверной попытке (или ввести счётчик), чтобы исключить перебор 6-значного кода.

* Код:

```
// ДО (src/fridge/fridge-image.storage.ts:56-62, 91):
  private assertInside(filePath: string): void {
    const root = resolve(UPLOAD_DIR);
    const target = resolve(filePath);
    if (!target.startsWith(root)) {
      throw new BadRequestException('Недопустимый путь к файлу.');
    }
  }
...
    let ext = extname(originalName ?? '').toLowerCase() || '.jpg';

// ПОСЛЕ (src/fridge/fridge-image.storage.ts:3, 56-62, 91):
import { join, resolve, sep } from 'node:path';
...
  private assertInside(filePath: string): void {
    const root = resolve(UPLOAD_DIR);
    const target = resolve(filePath);
    if (target !== root && !target.startsWith(root + sep)) {
      throw new BadRequestException('Недопустимый путь к файлу.');
    }
  }
...
    let ext = mime === 'image/png' ? '.png' : mime === 'image/webp' ? '.webp' : '.jpg';

```

* Проверка: отправить `PATCH /api/users/:id/profile` с `{ weight: -10 }` — должен вернуться `400 BadRequestException`, а не `200` или `500`.

* Риск: при удалении `record.destroy()` на первой же опечатке в email-коде пользователю придётся запросить новый код (либо хранить в памяти `Map<string, number>` до 5 попыток на `record.id` и удалять запись на 5-й ошибке — это безопаснее для UX).

### Задача 15. Синхронизировать регистрацию (`name`) и серверный выход (`POST /auth/logout`) на фронтенде

* Критичность: MAJOR

* Файлы: `frontend/src/api/services.ts`, `frontend/src/context/AuthContext.tsx`, `frontend/src/pages/LoginPage.tsx`

* Что сделать:

  1. В `frontend/src/pages/LoginPage.tsx:216` передавать `name: name.trim()` вместо `displayName: name.trim()` при вызове `register(...)`.

  2. В `frontend/src/api/services.ts` в объект `authApi` добавить метод `logout: async () => { await api.post('/auth/logout'); }`.

  3. В `frontend/src/context/AuthContext.tsx:76-81` в функции `logout` перед очисткой `localStorage` вызывать `void authApi.logout().catch(() => {});`.

* Код:

```
// ДО (frontend/src/pages/LoginPage.tsx:206-218):
        await register({
          email: email.trim(),
          password,
          emailCode: registerEmailCode.trim(),
          role: 'user',
          height: 170,
          weight: 70,
          gender: 'male',
          birthDate: '1995-01-01',
          goal: 'maintain',
          activityLevel: 'moderate',
          displayName: name.trim(),
        });

// ПОСЛЕ (frontend/src/pages/LoginPage.tsx:206-218):
        await register({
          name: name.trim(),
          email: email.trim(),
          password,
          emailCode: registerEmailCode.trim(),
          height: 170,
          weight: 70,
          gender: 'male',
          birthDate: '1995-01-01',
          goal: 'maintain',
          activityLevel: 'moderate',
        });

```

* Проверка: зарегистрировать нового пользователя с именем «Анна», проверить `GET /api/users/:id` — поле `name` равно `"Анна"`. Нажать «Выйти» и попытаться обновить токен через `POST /api/auth/refresh` со старым `refreshToken` — должен вернуться `401 Unauthorized`.

* Риск: отсутствует.

### Задача 16. Исправить парсинг ингредиентов для холодильника в `MealPlanPage.tsx` и загрузку биллинга OpenRouter в `AdminPage.tsx`

* Критичность: MAJOR

* Файлы: `frontend/src/pages/MealPlanPage.tsx`, `frontend/src/pages/AdminPage.tsx`

* Что сделать:

  1. В `frontend/src/pages/MealPlanPage.tsx:1561-1583` в `useEffect` проверки недостающих продуктов холодильника брать чистые имена ингредиентов напрямую из `selectedMeal.ingredientsDetailed` / `selectedMeal.ingredients`, либо делить строку по `/\s+[-—]\s+/` вместо `.split('—')`.

  2. В `frontend/src/pages/AdminPage.tsx:361-365` при первичной загрузке дашборда добавить поле `openRouter: billing.openRouter as BillingCostsState['openRouter']` в вызов `setBillingCosts(...)` (аналогично строке 391).

* Код:

```
// ДО (frontend/src/pages/MealPlanPage.tsx:1565-1569):
    const names = mealIngredientsForView(selectedMeal)
      .map((row) => String(row).split('—')[0]?.trim() ?? '')
      .filter(Boolean)
      .map((name) => ({ name }));

// ПОСЛЕ (frontend/src/pages/MealPlanPage.tsx:1565-1569):
    const names = mealIngredientsForView(selectedMeal)
      .map((row) => String(row).split(/\s+[-—]\s+/)[0]?.trim() ?? '')
      .filter(Boolean)
      .map((name) => ({ name }));

```

```
// ДО (frontend/src/pages/AdminPage.tsx:361-365):
        setBillingCosts({
          fetchedAt: billing.fetchedAt as string | undefined,
          apiKeyConfigured: billing.apiKeyConfigured as boolean | undefined,
          costs7d: billing.costs7d as BillingCostsState['costs7d'],
        });

// ПОСЛЕ (frontend/src/pages/AdminPage.tsx:361-366):
        setBillingCosts({
          fetchedAt: billing.fetchedAt as string | undefined,
          apiKeyConfigured: billing.apiKeyConfigured as boolean | undefined,
          costs7d: billing.costs7d as BillingCostsState['costs7d'],
          openRouter: billing.openRouter as BillingCostsState['openRouter'],
        });

```

* Проверка: открыть карточку любого блюда на странице `/meal-plan` — в сетевом запросе `POST /api/users/:id/fridge/missing` передаются чистые названия ингредиентов без ` - 180 г`; открыть `/admin` — блок расходов OpenRouter отображается сразу без нажатия «Обновить».

* Риск: отсутствует.

### Задача 17. Добавить обработку ошибок и `<SubscriptionGate>` на страницах `ProfilePage`, `RecommendationsPage`, `BodyAnalysisPage`, `MealPlanPage`

* Критичность: MAJOR

* Файлы: `frontend/src/pages/ProfilePage.tsx`, `frontend/src/pages/RecommendationsPage.tsx`, `frontend/src/pages/BodyAnalysisPage.tsx`, `frontend/src/pages/MealPlanPage.tsx`

* Что сделать:

  1. В `frontend/src/pages/ProfilePage.tsx` обернуть тело `onSubmit` (строки 233–258) и `changePassword` (строки 267–275) в `try / catch`, выводя `setValidationError(formatApiError(err, 'Не удалось сохранить изменения.'))` (импортировав `formatApiError` из `../api/errors`).

  2. В `frontend/src/pages/RecommendationsPage.tsx` добавить состояние `const [error, setError] = useState('');`, обернуть `loadBase` (строка 75) и `onGenerate` (строка 85) в `try / catch` с `setError(formatApiError(err, 'Не удалось получить рекомендации.'))` и обернуть кнопку «Сгенерировать AI-рекомендации» в `<SubscriptionGate>`.

  3. В `frontend/src/pages/BodyAnalysisPage.tsx` обернуть `loadDetailedRecommendation` (строка 239) и `loadForecast` (строка 245) в `try / catch` с `setMessage(formatApiError(err, 'Не удалось выполнить AI-запрос.'))` и обернуть кнопки анализа тела, прогноза и AI-рекомендаций в `<SubscriptionGate>`.

* Код:

```
// ДО (frontend/src/pages/ProfilePage.tsx:267-275):
  const changePassword = async () => {
    if (!user) return;
    await userApi.changePassword(user.id, oldPassword, newPassword);
    setShowPasswordModal(false);
    setOldPassword('');
    setNewPassword('');
    setMessage('Пароль успешно изменен.');
  };

// ПОСЛЕ (frontend/src/pages/ProfilePage.tsx:267-281):
  const changePassword = async () => {
    if (!user) return;
    setValidationError('');
    try {
      await userApi.changePassword(user.id, oldPassword, newPassword);
      setShowPasswordModal(false);
      setOldPassword('');
      setNewPassword('');
      setMessage('Пароль успешно изменен.');
    } catch (err) {
      setValidationError(formatApiError(err, 'Не удалось сменить пароль. Проверьте текущий пароль.'));
    }
  };

```

* Проверка: ввести неверный текущий пароль в модалке смены пароля на `/profile` — пользователь видит понятное сообщение об ошибке; зайти без подписки на `/recommendations` и `/body-analysis` — отображается плашка `<SubscriptionGate>`.

* Риск: отсутствует.

### Задача 18. Починить компиляцию `src/tests/unit/users.service.test.ts` и заменить фиктивные unit-тесты на вызовы реального кода

* Критичность: MINOR

* Файлы: `src/tests/unit/users.service.test.ts`, `src/tests/unit/plan-seed.test.ts`, `src/tests/unit/guest-role.test.ts`

* Что сделать:

  1. В `src/tests/unit/users.service.test.ts` добавить заглушки 4-го и 5-го аргументов конструктора `UsersService`:
     `const ingredientModel = { findAll: async () => [], findOne: async () => null };`
     `const fridgeImageStorage = { save: async () => ({ url: '/uploads/fridge/x.webp', bytes: 100 }), removeByUrl: async () => {} };`
     и передать их во все 7 вызовов `new UsersService(userModel as never, allergenModel as never, fridgeModel as never, ingredientModel as never, fridgeImageStorage as never)` (строки 21, 39, 49, 71, 97, 115, 137).

  2. В `src/tests/unit/guest-role.test.ts` импортировать реальный `FullUserGuard` из `../../auth/full-user.guard` и вызывать `new FullUserGuard().canActivate(mockContext)` вместо локальной функции `canActivate`.

  3. В `src/tests/unit/plan-seed.test.ts` импортировать `MealPlanService` из `../../meal-plan/meal-plan.service` и тестировать его метод выбора блюд вместо локальной функции `pickDish`.

* Код:

```
// ДО (src/tests/unit/users.service.test.ts:12-22):
describe('UsersService unit', () => {
  const fridgeModel = {
    findAll: async () => [],
    create: async () => ({}),
    findOne: async () => null,
  };

  it('updateProfile: выбрасывает исключение, когда пользователь не найден', async () => {
    const userModel = { findByPk: async () => null };
    const allergenModel = {} as Record<string, unknown>;
    const service = new UsersService(userModel as never, allergenModel as never, fridgeModel as never);

// ПОСЛЕ (src/tests/unit/users.service.test.ts:12-27):
describe('UsersService unit', () => {
  const fridgeModel = {
    findAll: async () => [],
    create: async () => ({}),
    findOne: async () => null,
  };
  const ingredientModel = {
    findAll: async () => [],
    findOne: async () => null,
  };
  const fridgeImageStorage = {
    save: async () => ({ url: '/uploads/fridge/test.webp', bytes: 10 }),
    removeByUrl: async () => {},
  };

  it('updateProfile: выбрасывает исключение, когда пользователь не найден', async () => {
    const userModel = { findByPk: async () => null };
    const allergenModel = {} as Record<string, unknown>;
    const service = new UsersService(
      userModel as never,
      allergenModel as never,
      fridgeModel as never,
      ingredientModel as never,
      fridgeImageStorage as never,
    );

```

* Проверка: выполнить `npx tsc --noEmit -p tsconfig.test.json` и `npm test` — 0 ошибок компиляции TypeScript, все тесты зелёные.

* Риск: отсутствует.

### Задача 19. Реализовать заявленное 5-минутное кэширование в `HealthController.catalogStats`

* Критичность: MINOR

* Файлы: `src/health/health.controller.ts`

* Что сделать:

  1. В `src/health/health.controller.ts` добавить in-memory кэш с TTL 5 минут (`300_000` мс) для `catalogStats()` (аналогично тому, как реализован кэш в `CurrencyService`), чтобы комментарий в коде соответствовал фактическому поведению и главная страница не выполняла агрегацию по `products` на каждый хит.

* Код:

```
// Внутри класса HealthController (src/health/health.controller.ts:17):
  private statsCache: { data: { dishes: number; categories: number; withAlcohol: number }; expiresAt: number } | null = null;

  @Get('catalog-stats')
  @HttpCode(HttpStatus.OK)
  async catalogStats() {
    const now = Date.now();
    if (this.statsCache && this.statsCache.expiresAt > now) {
      return this.statsCache.data;
    }
    const [rows] = await this.sequelize.query(
      `SELECT
         count(*) FILTER (WHERE is_published) AS dishes,
         count(DISTINCT category) FILTER (WHERE is_published) AS categories,
         count(*) FILTER (WHERE is_published AND contains_alcohol) AS with_alcohol
       FROM products`,
    );
    const row = (rows as Array<Record<string, unknown>>)[0] ?? {};
    const data = {
      dishes: Number(row.dishes ?? 0),
      categories: Number(row.categories ?? 0),
      withAlcohol: Number(row.with_alcohol ?? 0),
    };
    this.statsCache = { data, expiresAt: now + 5 * 60_000 };
    return data;
  }

```

* Проверка: вызвать `GET /api/health/catalog-stats` дважды подряд — второй вызов возвращает результат мгновенно из памяти без SQL-запроса.

* Риск: в `src/tests/unit/health.test.ts` проверить, не мешает ли кэш повторным вызовам с разными моками (при необходимости создавать новый экземпляр `new HealthController(sequelize)` в каждом тесте).

### Задача 20. Уменьшить размер бандла фронтенда (< 500 КБ на чанк)

* Критичность: MINOR

* Файлы: `frontend/src/components/icons.tsx`, `frontend/src/pages/MealPlanPage.tsx`, `frontend/src/App.tsx`

* Что сделать:

  1. В `frontend/src/components/icons.tsx` заменить `import * as Lucide from 'lucide-react';` на именованный импорт только реально используемых иконок (`import { Activity, Apple, Dumbbell, LineChart, Refrigerator, UtensilsCrossed } from 'lucide-react';`), чтобы Rollup не включал все 1500 SVG-иконок `lucide-react` в бандл.

  2. В `frontend/src/pages/MealPlanPage.tsx` заменить статический `import html2pdf from 'html2pdf.js';` (строка 13) на динамический `const { default: html2pdf } = await import('html2pdf.js');` внутри функции `exportPdf` (строка 1033).

  3. В `frontend/src/App.tsx` перевести тяжелые страницы (`MealPlanPage`, `AdminPage`, `StatsPage`, `WorkoutPlanPage`, `BodyAnalysisPage`) на `React.lazy(() => import(...))` с обёрткой `<Suspense fallback={<p className="muted">Загрузка…</p>}>`.

* Код:

```
// ДО (frontend/src/pages/MealPlanPage.tsx:13, 1050):
import html2pdf from 'html2pdf.js';
...
      await html2pdf()
        .set(options as never)
        .from(pdfRef.current)
        .save();

// ПОСЛЕ (frontend/src/pages/MealPlanPage.tsx:1050):
      const { default: html2pdf } = await import('html2pdf.js');
      await html2pdf()
        .set(options as never)
        .from(pdfRef.current)
        .save();

```

* Проверка: выполнить `cd frontend && npm run build` — предупреждение Vite о чанке `> 2.4 MB` исчезает, основной входной чанк уменьшается в 3–4 раза.

* Риск: минимальный; при динамическом импорте `html2pdf.js` подгружается только в момент нажатия кнопки «PDF».

### Задача 21. Декомпозиция `src/meal-plan/meal-plan.service.ts` (3016 строк) без изменения публичного API

* Критичность: MINOR

* Файлы: `src/meal-plan/meal-plan.service.ts`, новые файлы `src/meal-plan/meal-plan-preferences.helper.ts`, `src/meal-plan/meal-plan-scaling.helper.ts`, `src/meal-plan/meal-plan-constructor.helper.ts`

* Что сделать:

  1. Сохранить класс `MealPlanService` и сигнатуры всех его публичных методов (`searchCatalogForPreferences`, `listDishes`, `generatePlan`, `saveUserPlan`, `getActivePlan`, `listUserPlans`, `getPlanById`, `deletePlan`, `clonePlan`, `activatePlan`, `planRestrictionDiff`, `planDownloadPayload`, `changeDuration`, `updateDayMealStatuses`, `refineConstructorPlanWithAi`, `generateAiPlan`) неизменными.

  2. Вынести чистые функции работы с предпочтениями, привычками и снимками ограничений (строки 203–491, 650–691, 735–798) в `src/meal-plan/meal-plan-preferences.helper.ts`.

  3. Вынести чистые функции расчёта КБЖУ, масштабирования порций, диверсификации и добора до целевой калорийности (`snacksFromDb`, `primarySnackFromDb`, `daySnapshotsTotal`, `scaleDaySnapshotsToTarget`, `computeTotalsFromDbDays`, `computePlanTotals`, `diversifyCatalogDays`, `pickFromPool`, `refineProductsToTarget`, строки 57–86, 1211–1594) в `src/meal-plan/meal-plan-scaling.helper.ts`.

  4. Вынести чистые функции слияния и заполнения слотов конструктора (`isPlaceholderConstructorSnapshot`, `getConstructorSlotSnapshot`, `setConstructorSlotSnapshot`, `formatConstructorPlanLine`, `mergeConstructorRefinementAi`, `fillEmptyConstructorSlots`, `buildConstructorFallbackChanges`, строки 2507–2652) в `src/meal-plan/meal-plan-constructor.helper.ts`.

* Проверка: выполнить `npm run build` и `npm test` — сборка и все тесты проходят без изменений в контроллерах и модулях.

* Риск: если какой-то тест обращается к приватному методу `MealPlanService` через `(service as any).methodName`, оставить в `MealPlanService` тонкий метод-делегат в 1 строку.

### Задача 22. Декомпозиция `MealPlanPage.tsx` (2117 строк) и `AdminPage.tsx` (1797 строк)

* Критичность: MINOR

* Файлы: `frontend/src/pages/MealPlanPage.tsx`, `frontend/src/pages/AdminPage.tsx`, новые файлы в `frontend/src/pages/meal-plan/` и `frontend/src/pages/admin/`

* Что сделать:

  1. Из `frontend/src/pages/MealPlanPage.tsx` вынести:

     * чистые утилиты и константы (`mealDetailedTextBlob`, `getDietWarningsForMeal`, `snapshotToMeal`, `mealToSnapshot`, `emptyDays`, `inferIngredientsClientFromTitle`, `stockGramsForIngredient`, строки 75–355 и 453–678) в `frontend/src/pages/meal-plan/meal-plan.utils.ts`;

     * компоненты `DraggableDish` и `DroppableCell` (строки 357–451) в `frontend/src/pages/meal-plan/MealPlanDndCells.tsx`;

     * модальное окно деталей блюда (`selectedMeal`, строки 2002–2074) в `frontend/src/pages/meal-plan/MealDetailModal.tsx`.

  2. Из `frontend/src/pages/AdminPage.tsx` вынести:

     * функции парсинга форм и типов (`parseStringListField`, `parseIngredientsSimpleJson`, `parseIngredientsDetailedJson`, `renderProductIngredients`, строки 26–239) в `frontend/src/pages/admin/admin.utils.ts`;

     * секции вкладок (`section === 'dashboard'`, `'base'`, `'products'`, `'users'`, `'moderation'`) в отдельные подкомпоненты `AdminDashboardSection.tsx`, `AdminBaseRecsSection.tsx`, `AdminProductsSection.tsx`, `AdminUsersSection.tsx`, `AdminModerationSection.tsx`.

* Проверка: выполнить `cd frontend && npm run build && npm run lint` — сборка проходит без ошибок.

* Риск: при переносе JSX важно сохранить все `aria-label` и имена CSS-классов.

## Часть 4. Что проверить отдельно

Следующие аспекты отсутствуют в архиве исходного кода или требуют запущенного окружения (Docker + PostgreSQL + ключи API):

1. **Конфигурация Nginx (`docker/nginx/Dockerfile` и `nginx.conf`) и корневые `package.json` / `tsconfig.json`:**

   * В предоставленном архиве отсутствуют каталог `docker/nginx/` и файлы `package.json`, `frontend/package.json`, `tsconfig.json` (есть только `Dockerfile` и `docker-compose.yml`).

   * **Что проверить вручную:** убедиться, что в `nginx.conf`:

     * для `location /uploads/` задан `add_header Content-Disposition "inline"` и запрещено исполнение скриптов/HTML (`types { image/webp webp; image/jpeg jpg jpeg; image/png png; } default_type application/octet-stream;`), а также добавлен заголовок `X-Content-Type-Options: nosniff`;

     * для `location /api/` задан `client_max_body_size 15m;` (согласованно с `BODY_LIMIT = '12mb'` в `src/main.ts:30`) и `proxy_read_timeout 180s;` (так как генерация иллюстрации прогноза тела в `OpenAiService.generateBodyForecastIllustration` ждёт ответ OpenRouter до `180_000` мс, а дефолтный `proxy_read_timeout` в Nginx равен 60 с и оборвёт соединение с 504 Gateway Timeout);

     * присутствуют заголовки безопасности `Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`.

2. **Фактическое состояние таблицы `pg_constraint` в рабочей БД PostgreSQL:**

   * **Как проверить:** выполнить в контейнере `postgres`:

     ```
     SELECT conname, conrelid::regclass AS table_name, confdeltype
     FROM pg_constraint
     WHERE contype = 'f' AND confrelid = 'users'::regclass;
     
     ```

   * **Ожидаемый результат:** у всех внешних ключей на `users(id)` значение `confdeltype` должно быть `'c'` (`CASCADE`), кроме `meals.correctedByAdminId` (`'n'` — `SET NULL`). Если там `'a'` (`NO ACTION`), таблицы были созданы через `synchronize: true` до миграций, и потребуется миграция для пересоздания FK с `ON DELETE CASCADE`.

3. **Реальная работа вебхуков Stripe и расхождения цены `SUBSCRIPTION_PRICE_USD`:**

   * В `src/subscription/subscription.service.ts:55` захардкожено `export const SUBSCRIPTION_PRICE_USD = 9.9;`.

   * **Как проверить:** сверить в панели Stripe свойства цены `STRIPE_PRICE_ID_MONTHLY` (`unit_amount` и `currency`) — если в Stripe задана другая сумма, отображаемая на фронтенде цена в USD и пересчёт в BYN будут расходиться со списанием в Stripe Checkout.

4. **Поддержка Structured Outputs (`json_schema`) выбранной моделью в OpenRouter:**

   * В `src/openai/openai.service.ts:207` метод `recognizeFoodFromPhoto` передаёт `text: { format: jsonSchemaFormat('food_recognition', FOOD_RECOGNITION_JSON_SCHEMA) }` через `client.responses.create`.

   * **Как проверить:** убедиться на реальном ключе `OPENROUTER_API_KEY`, что модель из `AI_MODEL_FOOD_RECOGNITION` в вашем `.env` поддерживает Responses API + `json_schema` в шлюзе OpenRouter (некоторые провайдеры внутри OpenRouter игнорируют `text.format` или возвращают 400 при `strict: true`).