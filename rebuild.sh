#!/bin/zsh
# Пересборка сервисов.
#
#   ./rebuild.sh        → web ( фронтенд; это самый частый сценарий)
#   ./rebuild.sh api    → api   (NestJS-бэкенд)
#   ./rebuild.sh all    → оба сервиса
#
# Почему по умолчанию именно web: правки в интерфейсе занимают большую
# часть времени, а раньше без аргумента собирались ОБА сервиса — то есть
# каждый прогон тянул ещё и полную установку зависимостей для api
# (~2 минуты). Теперь по умолчанию собирается только фронт.
set -e
cd "$(dirname "$0")"

SERVICE=${1:-web}

if [ "$SERVICE" = "all" ]; then
  # Без списка сервисов compose собирает всё, что есть.
  echo "==> Сборка всех сервисов"
  docker compose up -d --build 2>&1 | tail -30
else
  echo "==> Сборка сервиса: $SERVICE"
  docker compose up -d --build "$SERVICE" 2>&1 | tail -30
fi

START=$(date +%s)


END=$(date +%s)
echo "---"
echo "Время сборки: $((END - START)) с"
echo "---"
echo "STATUS:"
docker compose ps --format "table {{.Name}}\t{{.Status}}"
