#!/bin/sh
set -e
cd "$(dirname "$0")/.."
for f in $(ls database/migrations/*.sql | sort); do
  echo ">>> $(basename "$f")"
  docker compose exec -T postgres psql -U course -d course < "$f"
done
echo "Done."
