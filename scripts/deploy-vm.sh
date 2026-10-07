#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
relay_host="${1:-}"
relay_port="${2:-8080}"
if [[ ! "$relay_host" =~ ^[a-zA-Z0-9.-]+$ || ! "$relay_port" =~ ^[0-9]+$ ]] || (( relay_port < 1 || relay_port > 65535 )); then
  echo 'Использование: bash scripts/deploy-vm.sh IP_ИЛИ_ДОМЕН [ПОРТ]'
  exit 1
fi
docker compose version >/dev/null
if [[ ! -f .env ]]; then
  relay_password="$(od -An -N24 -tx1 /dev/urandom | tr -d ' \n')"
  cp .env.example .env
  sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$relay_password/" .env
fi
# Configure the browser origin plus packaged mobile and desktop origins.
sed -i "s|^ALLOWED_ORIGINS=.*|ALLOWED_ORIGINS=http://$relay_host:$relay_port,http://localhost:$relay_port,http://127.0.0.1:$relay_port,capacitor://localhost,http://localhost,https://localhost,relay://app|" .env
sed -i "s/^WEB_PORT=.*/WEB_PORT=$relay_port/" .env
chmod 600 .env
relay_compose_args=(-f compose.yaml)
if [[ "${3:-}" == '--search' ]]; then relay_compose_args+=(-f compose.search.yaml); fi
docker compose "${relay_compose_args[@]}" up -d --build --wait
echo "Relay Chat: http://$relay_host:$relay_port"
echo "Проверка: curl http://$relay_host:$relay_port/api/health"
