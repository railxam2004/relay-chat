#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p backups
relay_backup="backups/relay-$(date -u +%Y%m%d-%H%M%S).sql.gz"
docker compose exec -T postgres pg_dump -U relay relay | gzip > "$relay_backup"
echo "Резервная копия: $relay_backup"
