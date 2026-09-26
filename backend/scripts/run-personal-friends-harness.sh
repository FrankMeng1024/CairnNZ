#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ID="${HARNESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
SAFE_RUN_ID="$(printf '%s' "$RUN_ID" | tr -cd 'A-Za-z0-9_')"
CONTAINER="cairn-pf-mysql-${SAFE_RUN_ID}"
DB_NAME="cairn_pf_${SAFE_RUN_ID}"
DB_PASSWORD="pf-${SAFE_RUN_ID}-local-only"
JWT_SECRET="personal-friends-harness-${SAFE_RUN_ID}-only-32-characters"
MYSQL_IMAGE="${HARNESS_MYSQL_IMAGE:-mysql:8.0.36}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cairn-pf-harness.XXXXXX")"
API_PID=""

cleanup() {
  if [ -n "$API_PID" ]; then kill "$API_PID" >/dev/null 2>&1 || true; fi
  if [ "${HARNESS_KEEP_CONTAINER:-0}" != "1" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  else
    echo "retained debug container: $CONTAINER" >&2
  fi
  if [ -n "${EVIDENCE_DIR:-}" ]; then
    mkdir -p "$EVIDENCE_DIR"
    cp "$TEMP_DIR/backend.log" "$EVIDENCE_DIR/backend.log" 2>/dev/null || true
  fi
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "refusing to reuse existing container $CONTAINER" >&2
  exit 1
fi

docker run -d --name "$CONTAINER" --security-opt seccomp=unconfined \
  -e MYSQL_ROOT_PASSWORD="$DB_PASSWORD" \
  -e MYSQL_DATABASE="$DB_NAME" \
  -p 127.0.0.1::3306 "$MYSQL_IMAGE" >/dev/null

for attempt in $(seq 1 60); do
  if docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse 'SELECT 1' >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then
    echo "MySQL did not become ready from image $MYSQL_IMAGE" >&2
    docker logs "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 1
done

DB_PORT="$(docker port "$CONTAINER" 3306/tcp | sed -E 's/.*:([0-9]+)$/\1/' | head -1)"
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$SCRIPT_DIR/personal-friends-harness/current-schema-fixture.sql" >/dev/null
for migration in \
  035_settings_correctness.sql \
  036_route_origin_identity.sql \
  037_personal_friends_v1.sql \
  038_memory_presence_witnesses.sql \
  039_borrowed_route_terminal_ack.sql \
  040_resource_content_revision.sql \
  041_public_cairn_pilot.sql \
  042_v1_closure_authority.sql \
  043_friend_discovery_marker_location.sql \
  044_public_cairn_moderation_audit.sql; do
  docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/$migration" >/dev/null
done

API_PORT=$((32000 + ($$ % 1000)))
while nc -z 127.0.0.1 "$API_PORT" >/dev/null 2>&1; do API_PORT=$((API_PORT + 1)); done
(
  cd "$BACKEND_DIR"
  DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
    JWT_SECRET="$JWT_SECRET" NONCE_SECRET="$JWT_SECRET" PORT="$API_PORT" \
    PUBLIC_API_BASE_URL="https://api.yiiling.cn/pf-review-o60" \
    CAIRN_REALM=isolated_review ALLOW_ISOLATED_QA_SOURCE_CONTRACT=1 \
    NODE_ENV=test TRUST_PROXY=false DISABLE_CRON=1 \
    node src/index.js
) >"$TEMP_DIR/backend.log" 2>&1 &
API_PID=$!

for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then cat "$TEMP_DIR/backend.log" >&2; exit 1; fi
  sleep 1
done

export HARNESS_API_URL="http://127.0.0.1:$API_PORT" HARNESS_RUN_ID="$RUN_ID"
export DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME"
export JWT_SECRET="$JWT_SECRET" CAIRN_REALM=isolated_review ALLOW_ISOLATED_QA_SOURCE_CONTRACT=1
if [ -n "${EVIDENCE_DIR:-}" ]; then
  mkdir -p "$EVIDENCE_DIR"
  node "$SCRIPT_DIR/personal-friends-harness/abcdn-api-mysql.js" | tee "$EVIDENCE_DIR/result.json"
else
  node "$SCRIPT_DIR/personal-friends-harness/abcdn-api-mysql.js"
fi
