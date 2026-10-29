#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SOURCE_BACKEND_DIR="${TARGET_BACKEND_DIR:-$BACKEND_DIR}"
HARNESS_SCRIPT="${ACTIVITY_SAVE_HARNESS_SCRIPT:-$SCRIPT_DIR/activity-save-concurrency-harness.js}"
OUTPUT_FILE="${EVIDENCE_FILE:-${TMPDIR:-/tmp}/cairn-activity-save-concurrency.json}"
RUN_ID="${HARNESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
SAFE_RUN_ID="$(printf '%s' "$RUN_ID" | tr -cd 'A-Za-z0-9_')"
CONTAINER="cairn-activity-save-mysql-${SAFE_RUN_ID}"
DB_NAME="cairn_activity_save_${SAFE_RUN_ID}"
DB_PASSWORD="activity-save-${SAFE_RUN_ID}-local-only"
JWT_SECRET="activity-save-${SAFE_RUN_ID}-only-64-characters-long-secret"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cairn-activity-save.XXXXXX")"
API_PID=""

cleanup() {
  if [ -n "$API_PID" ]; then kill "$API_PID" >/dev/null 2>&1 || true; fi
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "refusing to reuse existing container $CONTAINER" >&2
  exit 1
fi

docker run -d --name "$CONTAINER" --security-opt seccomp=unconfined \
  -e MYSQL_ROOT_PASSWORD="$DB_PASSWORD" -e MYSQL_DATABASE="$DB_NAME" \
  -p 127.0.0.1::3306 mysql:8.0.36 >/dev/null

stable_mysql_checks=0
for attempt in $(seq 1 120); do
  if docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse 'SELECT 1' >/dev/null 2>&1; then
    stable_mysql_checks=$((stable_mysql_checks + 1))
    if [ "$stable_mysql_checks" -ge 2 ]; then break; fi
  else
    stable_mysql_checks=0
  fi
  if [ "$attempt" = 120 ]; then docker logs "$CONTAINER" >&2; exit 1; fi
  sleep 1
done

DB_PORT="$(docker port "$CONTAINER" 3306/tcp | sed -E 's/.*:([0-9]+)$/\1/' | head -1)"
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" \
  < "$SCRIPT_DIR/personal-friends-harness/current-schema-fixture.sql" >/dev/null
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
  044_public_cairn_moderation_audit.sql \
  045_memory_friends_cairn_contract.sql \
  046_ordered_routes_and_deliveries.sql \
  047_friend_request_lifecycle.sql \
  048_friends_memory_history_repair.sql \
  049_retire_legacy_memory_sharing.sql \
  050_complete_legacy_memory_retirement.sql \
  051_memory_coverage_read_model.sql \
  052_cairn_placement_provenance.sql \
  053_cairn_qa_fixture_cohorts.sql \
  054_memory_hit_push_explicit_opt_in.sql \
  055_notification_delivery_outbox.sql \
  056_notification_target_receipt_reliability.sql \
  057_automatic_diagnostics.sql \
  058_memory_subscription_intent_order.sql \
  059_activity_final_geometry_revision.sql; do
  docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" \
    < "$BACKEND_DIR/src/migrations/$migration" >/dev/null
done

API_PORT=$((36000 + ($$ % 1000)))
while nc -z 127.0.0.1 "$API_PORT" >/dev/null 2>&1; do API_PORT=$((API_PORT + 1)); done
(
  cd "$BACKEND_DIR"
  DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
    JWT_SECRET="$JWT_SECRET" NONCE_SECRET="$JWT_SECRET" PORT="$API_PORT" \
    CAIRN_REALM=isolated_review ALLOW_ISOLATED_QA_SOURCE_CONTRACT=1 \
    NODE_ENV=test TRUST_PROXY=false DISABLE_CRON=1 \
    NODE_PATH="${NODE_PATH:-$BACKEND_DIR/node_modules}" node "$SOURCE_BACKEND_DIR/src/index.js"
) >"$TEMP_DIR/backend.log" 2>&1 &
API_PID=$!

for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$API_PORT/health" >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then cat "$TEMP_DIR/backend.log" >&2; exit 1; fi
  sleep 1
done

DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
JWT_SECRET="$JWT_SECRET" HARNESS_API_URL="http://127.0.0.1:$API_PORT" HARNESS_RUN_ID="$RUN_ID" \
NODE_PATH="${NODE_PATH:-$BACKEND_DIR/node_modules}" node "$HARNESS_SCRIPT" > "$OUTPUT_FILE"

node -e '
  const fs=require("fs");
  const result=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
  if(!result.passed)process.exit(1);
  process.stdout.write(JSON.stringify({passed:result.passed,assertions:Array.isArray(result.assertions)?result.assertions.length:null,timings:result.timings,final:result.final},null,2)+"\n");
' "$OUTPUT_FILE"
