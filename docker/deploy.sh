#!/bin/bash
# Cairn one-shot deploy — runs on the target server.
# Usage:
#   1. ssh into server
#   2. git clone the repo
#   3. cd Cairn/docker
#   4. cp .env.example .env  &&  edit .env (set DB_PASSWORD + telemetry key)
#   5. (one-time) Make sure the `cairn` database + migrations exist on the
#      shared MySQL — run init.sql against it if this is a fresh install:
#          docker exec -i ainews-db mysql -uroot -p"$DB_PASSWORD" < init.sql
#   6. ./deploy.sh
#
# What this does:
#   - Builds the cairn-backend image
#   - Starts only the backend container (connects to existing MySQL on host)
#   - Waits for healthcheck
#   - Prints the smoke-test command

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Sanity checks
if [ ! -f .env ]; then
  echo "❌ .env not found. Copy .env.example to .env and edit it first."
  exit 1
fi

if ! command -v docker &> /dev/null; then
  echo "❌ Docker not found. Install Docker first."
  exit 1
fi

if ! docker compose version &> /dev/null && ! command -v docker-compose &> /dev/null; then
  echo "❌ docker compose not found."
  exit 1
fi

# Use docker compose (v2) if available, else fall back to docker-compose (v1).
# Use array form for the compose command so the space in "docker compose" is preserved.
if docker compose version &> /dev/null; then
  COMPOSE=(docker compose)
else
  COMPOSE=(docker-compose)
fi

echo "→ Building backend image..."
"${COMPOSE[@]}" build backend

echo "→ Starting services..."
"${COMPOSE[@]}" up -d

echo "→ Waiting for backend health (up to 90s)..."
for i in {1..30}; do
  STATUS=$(curl -fsS http://localhost:3001/health 2>/dev/null | grep -o '"status":"[^"]*"' || echo '')
  if [ "$STATUS" = '"status":"ok"' ]; then
    echo "✓ Backend healthy."
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Backend did not become healthy in 90s. Check logs:"
    "${COMPOSE[@]}" logs --tail=80 backend
    exit 1
  fi
  sleep 3
done

echo ""
echo "✓ Cairn backend is running:"
echo "    Health: http://localhost:3001/health"
echo "    Telemetry POST: http://localhost:3001/api/telemetry/sessions"
echo ""
echo "Telemetry test:"
echo "  curl -X POST http://localhost:3001/api/telemetry/sessions \\"
echo "    -H 'X-API-Key: \$CAIRN_TELEMETRY_API_KEY' \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"session_id\":\"smoke-$(date +%s)\",\"events\":[]}'"
echo ""
echo "Tail logs with: ${COMPOSE[*]} logs -f backend"
