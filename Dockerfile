# syntax=docker/dockerfile:1.7
# Директива syntax= обязана быть первой строкой файла — иначе BuildKit
# её игнорирует и --mount=type=cache ниже не сработает.
# Она включает BuildKit-фичи: без BuildKit сборка падает с ошибкой
# «the --mount option requires BuildKit».
FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
# --mount=type=cache кэширует /root/.npm между сборками: повторный
# npm ci берёт пакеты из локального кэша вместо сети (registry
# отвечает ~6с на запрос, поэтому это основная экономия времени).
RUN --mount=type=cache,target=/root/.npm npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# Второй npm ci не запускаем: копируем готовый node_modules из
# builder и удаляем dev-зависимости уже на месте («npm prune
# --omit=dev»). Это экономит целую установку (~2 минуты).
# Кэш npm сохранён — prune при необходимости дозагрузит пакеты.
COPY --from=builder /app/node_modules ./node_modules
RUN --mount=type=cache,target=/root/.npm npm prune --omit=dev --no-audit --no-fund --loglevel=error
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/database ./database
# Каталог для загруженных фотографий. При запуске сюда монтируется том,
# но каталог создаём заранее: если том не подключён, приложение всё равно
# должно иметь куда писать.
RUN mkdir -p /app/uploads/fridge
EXPOSE 3000
CMD ["node", "dist/main.js"]
