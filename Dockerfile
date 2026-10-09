FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund --loglevel=error && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/database ./database
# Каталог для загруженных фотографий. При запуске сюда монтируется том,
# но каталог создаём заранее: если том не подключён, приложение всё равно
# должно иметь куда писать.
RUN mkdir -p /app/uploads/fridge
EXPOSE 3000
CMD ["node", "dist/main.js"]
