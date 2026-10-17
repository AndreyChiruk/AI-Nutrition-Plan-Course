# Промпт для передачи контекста: полное тестирование курсового проекта

Скопируйте всё, что ниже горизонтальной линии, в новую сессию.

---

## ЗАДАЧА

Провести полное тестирование курсового проекта — интернет-сервиса для составления плана питания. Найти и исправить ошибки. Работать автономно, без уточняющих вопросов.

Рабочая директория: `/Users/andrey/Documents/course_project/course/course`

---

## СТЕК И СТРУКТУРА

| Слой | Технологии |
|---|---|
| Backend | NestJS 11, Sequelize 6 (`sequelize-typescript`), Node 22 |
| БД | PostgreSQL 16 |
| Frontend | React 19, Vite, React Router, axios |
| ИИ | OpenRouter (шлюз), `openai/gpt-4o-mini` + `google/gemini-3.1-flash-image` |
| Платежи | Stripe (тестовый режим) |
| Инфра | Nginx (HTTPS), Docker Compose |

```
src/                  — backend (112 маршрутов)
  config/             — openrouter.ts, ai-models.ts, stripe.ts
  meal-plan/          — генерация планов, dietary-rules.ts
  subscription/       — подписка, вебхуки Stripe
  users/              — профиль, холодильник
  models/             — 28 моделей Sequelize
frontend/src/         — SPA (13 маршрутов)
database/migrations/  — 30 файлов, применено 32
```

**Текущее состояние:** коммит `50f18e9`, **537 тестов passing**, TSC чист, контейнеры healthy, 764 продукта в каталоге.

---

## ТРИ ПРАВИЛА, БЕЗ КОТОРЫХ НИЧЕГО НЕ РАБОТАЕТ

### 1. Docker — только через скрипт

**НИКОГДА не запускайте `docker build`, `docker compose up/down`.**

```bash
./rebuild.sh          # всё
./rebuild.sh api      # только backend
./rebuild.sh web      # только frontend
```

Разрешены read-only: `docker compose ps`, `docker compose logs --tail=20 <svc>`, `curl`.

**ВАЖНО:** у агента в песочнице **заблокирована запись в `~/.docker/buildx/`**. Если увидите:
```
failed to update builder last activity time: open ~/.docker/buildx/activity/...: operation not permitted
```
— значит пересборка **не применилась**. Код в контейнере останется старым. Сообщите пользователю и попросите выполнить `./rebuild.sh` вручную. **Не пытайтесь обойти это** — это ограничение среды.

**Всегда проверяйте, что пересборка дошла до контейнера:**
```bash
docker compose exec -T api sh -c "grep -c 'искомый текст' /app/dist/<путь>.js"
docker compose exec -T web sh -c "grep -c 'искомый текст' /usr/share/nginx/html/assets/*.js"
```
Половина «неисправленных» багов в прошлых сессиях оказывалась старым бандлом.

### 2. Браузер: сайт на HTTPS не открывается

Приложение живёт на **`https://localhost`** (Nginx). Браузер агента блокируется самоподписанным сертификатом:
```
ERR_CERT_AUTHORITY_INVALID
```

`http://localhost:3000` — это **NestJS API**, а не приложение: отдаёт `{"message":"Cannot GET /"}`.

**Обход — поднять статику на HTTP с проксированием API:**
```bash
cd frontend && ./node_modules/.bin/vite build
cat > /tmp/serve.cjs <<'EOF'
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT='/Users/andrey/Documents/course_project/course/course/frontend/dist';
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.woff2':'font/woff2'};
http.createServer((req,res)=>{
  if(req.url.startsWith('/api')){
    const p=http.request({hostname:'localhost',port:3000,path:req.url,method:req.method,headers:{...req.headers,host:'localhost:3000'}},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    p.on('error',()=>{res.writeHead(502);res.end('api down');}); req.pipe(p); return;
  }
  let f=path.join(ROOT,req.url.split('?')[0]);
  if(!fs.existsSync(f)||fs.statSync(f).isDirectory()){f=path.join(ROOT,'index.html');}
  res.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});
  fs.createReadStream(f).pipe(res);
}).listen(5173,'127.0.0.1',()=>console.log('http://127.0.0.1:5173'));
EOF
nohup node /tmp/serve.cjs > /tmp/serve.log 2>&1 &
```

**Порт обязан быть 5173** — только он есть в `CORS_ORIGINS`. На другом порту API вернёт `Vary: Origin` без `Access-Control-Allow-Origin`, и запросы заблокируются.

Затем `browser_navigate` на `http://127.0.0.1:5173`.

**Скриншоты не работают** — падают с `FATAL: base/path_service.cc:264`. Проверяйте через `browser_eval`: читайте DOM, вычисляйте цвета, вызывайте API.

### 3. Вход в приложение

```js
await fetch('http://localhost:3000/api/auth/login', {
  method:'POST', headers:{'Content-Type':'application/json'},
  body: JSON.stringify({email:'admin@example.com', password:'Adminpass123'})
}).then(r=>r.json()).then(d=>{
  localStorage.setItem('accessToken', d.accessToken);
  localStorage.setItem('refreshToken', d.refreshToken);
  localStorage.setItem('user', JSON.stringify(d.user));
});
```

Или через форму на `/login` — вводите значения и жмите «Войти».

**Аккаунты:**

| Роль | Логин | Пароль |
|---|---|---|
| Админ | `admin@example.com` | `Adminpass123` |
| Пользователь | `user1@example.com` | `Testpass123` |
| Гость | `guest@test.local` | `Guestpass123` |

---

## ЧТО ТЕСТИРОВАТЬ

### Приоритет 1: план питания (главная функция)

**Тестовый пользователь `user1`:** диета `vegan`, аллергия `лактоза`, любимое `тофу`, нежелательное `грибы`.

**Режимы** (все требуют активной подписки):

| Режим | Эндпоинт |
|---|---|
| Автоплан | `POST /api/meal-plan/generate` |
| Автоплан (авто) | `POST /api/meal-plan/generate-auto` |
| AI-план | `POST /api/meal-plan/generate-ai-catalog` |
| Конструктор | `POST /api/meal-plan/save` |
| Уточнение AI | `POST /api/meal-plan/refine-constructor-ai` |

Тело: `{"userId":"2","durationDays":7}`

**Проверять для каждой генерации:**
- количество дней совпадает с запрошенным
- **0 заглушек** (блюдо с именем вида `Блюдо (breakfast)`)
- **0 нарушений аллергенов** — в снапшоте смотреть поле `allergens`
- **0 нежелательных** продуктов (грибы)
- разнообразие: доля уникальных блюд

**Готовый скрипт проверки:**
```python
import json, collections
d = json.load(open('plan.json'))
names, bad, fill = [], 0, 0
for day in d['days']:
    for s in ['breakfast','lunch','dinner','snacks']:
        v = day.get(s)
        if not v: continue
        for it in (v if isinstance(v, list) else [v]):
            nm = it.get('name',''); names.append(nm)
            if 'Блюдо (' in nm: fill += 1
            for a in it.get('allergens', []):
                if a.lower() in ('лактоза','рыба','яйца','молоко'): bad += 1
c = collections.Counter(names)
print(f'блюд {len(names)} | уникальных {len(c)} | заглушек {fill} | нарушений {bad}')
print('чаще всего:', c.most_common(3))
```

**Сроки:** 1, 7, 14, 30 дней (30 — максимум; 90/180 в интерфейсе больше нет).

**Проверка лимита срока:** запрос на `durationDays = 31` (и 90, 180) должен отклоняться с 400: «Длительность плана должна быть от 1 до 30 дней». Лимит действует и на сохранение плана, и на все режимы генерации.

**Что проверить в конфигурациях:**
- много аллергенов одновременно
- экстремальные списки: 20 любимых + 30 нежелательных (это лимиты; 21 и 31 должны отклоняться с 400)
- генерация с непустым холодильником — продукты должны влиять на состав

### Приоритет 2: остальной функционал

| Сценарий | Что проверять |
|---|---|
| Регистрация → вход | письмо-код (SMTP недоступен → 503, это среда) |
| **Модерация еды** (админка) | подтвердить → `status=confirmed` + блюдо в каталоге; отклонить → `status=rejected` |
| Холодильник | добавление, изменение, удаление, загрузка фото |
| Распознавание еды | фото → блюдо; битый файл → 400 |
| Анализ тела | загрузка фото, прогноз фигуры |
| Чат | 3 сообщения/день без подписки, без лимита с ней |
| Подписка | checkout → активация → доступ к ИИ |
| Админка | расходы на ИИ, пользователи, каталог |

**Проверка прав:** без токена → `401`, роль `user`/`guest` на админских маршрутах → `403`.

### Приоритет 3: визуальные проверки

Оба навыка установлены, но **их инструменты (`browser_take_screenshot`, `browser_wait_for`) в наборе отсутствуют** — применять через `browser_eval`.

Контраст считайте программно:
```js
function parse(c){const m=String(c).match(/rgba?\(([^)]+)\)/);if(!m)return null;
  const p=m[1].split(',').map(Number);return {r:p[0],g:p[1],b:p[2],a:p.length>3?p[3]:1};}
function lum(c){const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
  return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);}
function ratio(a,b){const l1=lum(a),l2=lum(b),hi=Math.max(l1,l2),lo=Math.min(l1,l2);
  return (hi+0.05)/(lo+0.05);}
// Переключение темы: document.documentElement.setAttribute('data-theme','dark'|'light')
// Норма WCAG AA: 4.5:1 для обычного текста
```

**Обязательно учитывайте полупрозрачные слои** — смешивайте фон предка с фоном элемента, иначе получите ложные срабатывания.

**Известный класс ошибок:** токен `--line` (цвет границ) использован как цвет текста → контраст 1.1:1, текст невидим. Искать:
```bash
grep -rn "color: var(--line)" frontend/src/*.css
```

**Второй класс:** элементы с `animation: ... both` остаются `opacity: 0`, если анимации отключены (а они отключены в `plain-theme.css`). Искать:
```bash
grep -rn "animation:.*both" frontend/src/*.css
```

---

## ОСОБЕННОСТИ БАЗЫ ДАННЫХ

**Колонки в camelCase** — Sequelize работает без `underscored`:

```sql
-- правильно
SELECT * FROM meal_plans WHERE "userId" = 2;

-- упадёт: column "user_id" does not exist
SELECT * FROM meal_plans WHERE user_id = 2;
```

Эта ошибка дважды ломала миграции (025, 027).

**Разный язык у полей каталога:**
- `meal_types` — **по-русски**: `["завтрак"]`, `["ужин"]`, `["перекус"]`
- `dietary_tags` — **по-английски**: `vegan`, `vegetarian`, `gluten-free`

**Ключевые таблицы:**
```
products           — каталог блюд (is_published, is_from_api, dietary_tags, allergens)
meal_plans         — планы
meal_plan_days     — дни (ячейки в JSONB: breakfast, lunch, dinner, snacks)
users              — профиль (dietary_restrictions, food_likes, food_dislikes)
meals              — распознанные блюда для модерации (status)
subscriptions      — подписки
```

**Только проверенный каталог идёт в AI-генерацию:** `is_from_api = true`. Пользовательские продукты (75 штук) исключены — среди них записи вида «Тест модерации t6».

**Проверка целостности:**
```sql
-- планы без дней (сироты)
SELECT count(*) FROM meal_plans p
 WHERE NOT EXISTS (SELECT 1 FROM meal_plan_days d WHERE d."mealPlanId" = p.id);

-- дубли email
SELECT count(*) FROM (SELECT email FROM users GROUP BY email HAVING count(*) > 1) t;
```

---

## ИНСТРУМЕНТЫ

**Навыки** (только эти два):
- `dark-mode-bug-finder` — аудит тем
- `playwright-screenshot-inspector` — ожидание отрисовки React

**Плагинов `dsh-postgres-expert` и `dsh-better-edit` НЕТ.** SQL — через `docker compose exec -T postgres psql`. Правки — инструментом `edit` с 3-символьными хэш-анкорами из `read`.

**Экономия:** не пересказывайте файлы, не выводите код целиком, отчёт ≤ 5 строк на задачу.

---

## ПРАВИЛА РАБОТЫ С КОДОМ

**Правки только точечные** — через `edit` с хэш-анкорами. Не переписывайте файлы целиком.

**Порядок при правке:**
1. `read` нужных строк → получить анкоры вида `aB3│содержимое`
2. `edit` с `anchor_from: "aB3"`, `anchor_to: "aB3"`, `replace_with: "новый текст"`
3. Анкоры — **ровно 3 символа**, без `│` и содержимого

**Git: коммитьте только те файлы, которые меняли**, не `git add -A`. Иначе в коммит попадут незакоммиченные правки пользователя.

**После правок:**
```bash
npm test                                    # ожидается ≥ 537 passing
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
cd frontend && ./node_modules/.bin/tsc -b --noEmit
```

**Если меняли БД — восстановите данные после теста.** В прошлой сессии тестовые значения попали в профиль пользователя.

---

## ЧТО УЖЕ ИСПРАВЛЕНО (не ищите заново)

| Проблема | Решение |
|---|---|
| Кириллица в HTTP-заголовке `X-Title` ломала **все** ИИ-вызовы | ASCII-заголовок |
| OpenRouter не отдаёт `output_text` | Чтение `output[].content[]` |
| Генерация изображений через `/images/edits` не поддерживается | Через `chat/completions` + `gemini-3.1-flash-image` |
| Список блюд обрезался по 12 000 символов | Лимит по количеству (`AI_CATALOG_MAX_NAMES=700`) |
| `recoverDeep` уничтожал объекты `Date` | Сохранение `Date`/`Buffer`/прототипов |
| Токены `--sand`/`--paper` не были заданы для тёмной темы | 23 нарушения контраста → 0 |
| Базовый URL API без префикса `/api` | `'/api'` |
| Нет лимитов на списки предпочтений | `foodLikes ≤ 20`, `foodDislikes ≤ 30` |
| Молчаливые повторы на длинных планах | Предупреждение о нехватке блюд |

---

## НЕЗАКРЫТЫЕ ВОПРОСЫ

- ~~180-дневные планы~~ — **закрыто**: максимальный срок ограничен 30 днями (бэкенд `MAX_PLAN_DAYS`, фронтенд `DURATIONS`)
- **75 пользовательских продуктов** исключены из AI-генерации, но видны в каталоге
- **Цена подписки** в USD ($9.90), в ТЗ указаны рубли
- **Ключ Stripe** `rkcs_test_...` — claimable sandbox с урезанными правами
- **SMTP недоступен** — регистрация требует кода из письма, отправка даёт 503

---

## ФОРМАТ ОТЧЁТА

После тестирования:

```markdown
## Дизайн-баги
| Селектор | Проблема | Контраст | Причина |

## Функциональные баги
| Сценарий | Ожидалось | Получено | Причина |

## Исправлено
| № | Файл | Что изменено |

## Проверка
тесты / TSC / контраст
```

---

## ПЕРВЫЕ ШАГИ

```bash
cd /Users/andrey/Documents/course_project/course/course
docker compose ps                    # все три healthy?
npm test                             # 537 passing?
git log --oneline -3                 # последний коммит 50f18e9?
```

Затем поднимите сервер на 5173 (см. правило 2) и начинайте с плана питания.

**Приоритет по важности:** план питания → модерация → права доступа → визуальные проверки.
