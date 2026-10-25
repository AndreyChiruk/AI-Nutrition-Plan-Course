#!/bin/zsh
# Пересборка сервисов.
#
#   ./rebuild.sh        → web (фронтенд; это самый частый сценарий)
#   ./rebuild.sh api    → api   (NestJS-бэкенд)
#   ./rebuild.sh all    → оба сервиса
set -e
cd "$(dirname "$0")"

SERVICE=${1:-web}

START=$(date +%s)

if [ "$SERVICE" = "all" ]; then
  echo "==> Сборка всех сервисов"
  docker compose up -d --build 2>&1 | tail -30
else
  echo "==> Сборка сервиса: $SERVICE"
  docker compose up -d --build "$SERVICE" 2>&1 | tail -30
fi

END=$(date +%s)
echo "---"
echo "Время сборки: $((END - START)) с"
echo "---"
echo "STATUS:"
docker compose ps --format "table {{.Name}}\t{{.Status}}"
