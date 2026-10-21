# syntax=docker/dockerfile:1.7
# Директива syntax= — первой строкой: она включает BuildKit-фичи
# (--mount=type=cache ниже). Без BuildKit сборка падает с ошибкой
# «the --mount option requires BuildKit».
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
COPY --from=frontend-build /frontend/dist /usr/share/nginx/html
