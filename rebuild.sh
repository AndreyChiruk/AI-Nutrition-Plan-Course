#!/bin/zsh
SERVICE=${1:-}
cd "$(dirname "$0")"

if [ -z "$SERVICE" ]; then
  docker compose up -d --build 2>&1 | tail -30
else
  docker compose up -d --build "$SERVICE" 2>&1 | tail -30
fi

echo "---"
echo "STATUS:"
docker compose ps --format "table {{.Name}}\t{{.Status}}"