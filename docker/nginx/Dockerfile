# Строку `# syntax=docker/dockerfile:N` здесь СОЗНАТЕЛЬНО не ставим.
#
# Она заставляет BuildKit скачивать с Docker Hub образ
# docker/dockerfile:1.7 ради одного лишь парсера — лишняя сетевая
# зависимость. При недоступном registry сборка падала ещё до
# начала работы («failed to authorize: TLS handshake timeout»),
# хотя сам --mount=type=cache локальный BuildKit (v0.31.2)
# поддерживает без неё.
FROM node:22-alpine AS frontend-build
WORKDIR /frontend
COPY frontend/package*.json ./
# Кэш npm между сборками — вторая сборка не ходит в registry.
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

FROM nginx:1.27-alpine
COPY docker/nginx/default.conf /etc/nginx/conf.d/default.conf
# Общие заголовки безопасности подключаются через include, так как
# add_header не наследуется в location-блоки.
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
# Второй server-блок (порт 8080) — для доступа через туннель.
# Он отдаёт приложение по HTTP без редиректа на HTTPS: туннель сам
# терминирует TLS, а наш редирект уводил бы посетителя по кругу.
COPY docker/nginx/tunnel.conf /etc/nginx/conf.d/tunnel.conf
COPY --from=frontend-build /frontend/dist /usr/share/nginx/html
