#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ID="${HARNESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
SAFE_RUN_ID="$(printf '%s' "$RUN_ID" | tr -cd 'A-Za-z0-9_')"
CONTAINER="cairn-public-mysql-${SAFE_RUN_ID}"
DB_NAME="cairn_public_${SAFE_RUN_ID}"
DB_PASSWORD="public-${SAFE_RUN_ID}-local-only"
JWT_SECRET="public-cairn-harness-${SAFE_RUN_ID}-only-32-chars"
MYSQL_IMAGE="${HARNESS_MYSQL_IMAGE:-mysql:8.0.36}"
MYSQL_READY_ATTEMPTS="${HARNESS_MYSQL_READY_ATTEMPTS:-60}"
TEMP_DIR=""
API_PID=""

HARNESS_MODE="${HARNESS_MODE:-api}"
API_NODE_ENV="test"
API_REALM="isolated_review"
API_ISOLATED_SOURCE_CONTRACT="1"
PUBLIC_USER_IDS=""
case "$HARNESS_MODE" in
  api)
    HARNESS_SCRIPT="api-mysql.js"
    PUBLIC_CAIRN_FLAG="1"
    PUBLIC_ZONE_POLICY='[]'
    ;;
  endurance)
    HARNESS_SCRIPT="endurance.js"
    PUBLIC_CAIRN_FLAG="1"
    PUBLIC_ZONE_POLICY='[]'
    ;;
  disabled)
    HARNESS_SCRIPT="disabled-api-mysql.js"
    PUBLIC_CAIRN_FLAG="0"
    PUBLIC_ZONE_POLICY='[]'
    ;;
  missing-policy)
    HARNESS_SCRIPT="disabled-api-mysql.js"
    PUBLIC_CAIRN_FLAG="1"
    PUBLIC_ZONE_POLICY=''
    ;;
  malformed-policy)
    HARNESS_SCRIPT="disabled-api-mysql.js"
    PUBLIC_CAIRN_FLAG="1"
    PUBLIC_ZONE_POLICY='{bad'
    ;;
  memory-public-gate)
    HARNESS_SCRIPT="public-viewer-gate-api-mysql.js"
    PUBLIC_CAIRN_FLAG="1"
    PUBLIC_ZONE_POLICY='[{"lat":0,"lng":0,"radius_m":1}]'
    API_NODE_ENV="production"
    API_REALM="production"
    API_ISOLATED_SOURCE_CONTRACT="0"
    PUBLIC_USER_IDS="1001,1004"
    ;;
  *)
    echo "unsupported HARNESS_MODE: $HARNESS_MODE" >&2
    exit 2
    ;;
esac

# A directly executable, side-effect-free preflight proves mode preservation
# and mode-to-script selection without starting Docker, MySQL or the API.
if [ "${HARNESS_PREFLIGHT_ONLY:-0}" = "1" ]; then
  if [ "$HARNESS_MODE" = "memory-public-gate" ]; then
    HARNESS_PATH="$SCRIPT_DIR/cairn-memory-harness/$HARNESS_SCRIPT"
  else
    HARNESS_PATH="$SCRIPT_DIR/public-cairn-harness/$HARNESS_SCRIPT"
  fi
  if [ ! -f "$HARNESS_PATH" ]; then
    echo "missing harness script: $HARNESS_PATH" >&2
    exit 3
  fi
  node --check "$HARNESS_PATH"
  printf '{"preflight":true,"mode":"%s","script":"%s","public_enabled":"%s"}\n' \
    "$HARNESS_MODE" "$HARNESS_SCRIPT" "$PUBLIC_CAIRN_FLAG"
  exit 0
fi

TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cairn-public-harness.XXXXXX")"

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
  if [ -n "$TEMP_DIR" ]; then rm -rf "$TEMP_DIR"; fi
}
trap cleanup EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "refusing to reuse existing container $CONTAINER" >&2
  exit 1
fi

docker run -d --name "$CONTAINER" --security-opt seccomp=unconfined \
  -e MYSQL_ROOT_PASSWORD="$DB_PASSWORD" -e MYSQL_DATABASE="$DB_NAME" \
  -p 127.0.0.1::3306 "$MYSQL_IMAGE" >/dev/null

for attempt in $(seq 1 "$MYSQL_READY_ATTEMPTS"); do
  if docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse 'SELECT 1' >/dev/null 2>&1; then break; fi
  if [ "$attempt" = "$MYSQL_READY_ATTEMPTS" ]; then docker logs "$CONTAINER" >&2; exit 1; fi
  sleep 1
done

DB_PORT="$(docker port "$CONTAINER" 3306/tcp | sed -E 's/.*:([0-9]+)$/\1/' | head -1)"

apply_sql_file() {
  local sql_file="$1"
  for attempt in $(seq 1 30); do
    if docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$sql_file" >/dev/null 2>"$TEMP_DIR/mysql-apply.err"; then
      return 0
    fi
    if [ "$attempt" = 30 ]; then
      cat "$TEMP_DIR/mysql-apply.err" >&2
      docker logs "$CONTAINER" >&2 || true
      return 1
    fi
    sleep 1
  done
}

apply_sql_file "$SCRIPT_DIR/personal-friends-harness/current-schema-fixture.sql"
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
  045_memory_friends_cairn_contract.sql; do
  apply_sql_file "$BACKEND_DIR/src/migrations/$migration"
done

# Rehearse 045 -> 046 against a populated legacy Route. The rollback leg is
# isolated to this disposable database and intentionally contains no delivery
# snapshots, because the real rollback is destructive once deliveries exist.
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "INSERT INTO users (name,email,password_hash,date_of_birth)
     VALUES ('Pre-046 Route Owner','pre-046-${SAFE_RUN_ID}@example.invalid','test-only','1990-01-01');
   SET @route_owner=LAST_INSERT_ID();
   INSERT INTO routes (user_id,name,points,waypoints,distance_m,elevation_gain_m,permission)
     VALUES (@route_owner,'Harness pre-046 legacy route',
       JSON_ARRAY(JSON_OBJECT('lat',-41.0,'lng',174.0),JSON_OBJECT('lat',-41.001,'lng',174.001)),
       JSON_ARRAY(),140,10,'personal');" >/dev/null
apply_sql_file "$BACKEND_DIR/src/migrations/046_ordered_routes_and_deliveries.sql"
if [ "${HARNESS_REHEARSE_046_RECOVERY:-0}" = "1" ]; then
  legacy_state="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -Nse \
    "SELECT CONCAT(COUNT(*),':',MIN(resolution_state),':',SUM(ordered_draft IS NULL))
       FROM routes WHERE name='Harness pre-046 legacy route'" 2>/dev/null)"
  [ "$legacy_state" = "1:continuous:1" ]
  apply_sql_file "$BACKEND_DIR/src/migrations/rollback/046_ordered_routes_and_deliveries_down.sql"
  legacy_rows="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -Nse \
    "SELECT COUNT(*) FROM routes WHERE name='Harness pre-046 legacy route'" 2>/dev/null)"
  [ "$legacy_rows" = "1" ]
  apply_sql_file "$BACKEND_DIR/src/migrations/046_ordered_routes_and_deliveries.sql"
fi
apply_sql_file "$BACKEND_DIR/src/migrations/047_friend_request_lifecycle.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/048_friends_memory_history_repair.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/049_retire_legacy_memory_sharing.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/050_complete_legacy_memory_retirement.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/051_memory_coverage_read_model.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/052_cairn_placement_provenance.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/053_cairn_qa_fixture_cohorts.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/054_memory_hit_push_explicit_opt_in.sql"
apply_sql_file "$BACKEND_DIR/src/migrations/055_notification_delivery_outbox.sql"

MYSQL_DOCKER_CONTAINER="$CONTAINER" DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" \
  DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
  "$SCRIPT_DIR/verify-migration-044.sh"
MYSQL_DOCKER_CONTAINER="$CONTAINER" DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" \
  DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
  "$SCRIPT_DIR/verify-migration-045.sh"
MYSQL_DOCKER_CONTAINER="$CONTAINER" DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" \
  DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
  "$SCRIPT_DIR/verify-migration-046.sh"
MYSQL_DOCKER_CONTAINER="$CONTAINER" DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" \
  DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
  "$SCRIPT_DIR/verify-migration-049.sh"

API_PORT=$((33000 + ($$ % 1000)))
while nc -z 127.0.0.1 "$API_PORT" >/dev/null 2>&1; do API_PORT=$((API_PORT + 1)); done
(
  cd "$BACKEND_DIR"
  DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
    JWT_SECRET="$JWT_SECRET" NONCE_SECRET="$JWT_SECRET" PORT="$API_PORT" \
    NODE_ENV="$API_NODE_ENV" TRUST_PROXY=false DISABLE_CRON=1 PUBLIC_CAIRN_PILOT_ENABLED="$PUBLIC_CAIRN_FLAG" \
    PUBLIC_CAIRN_PILOT_USER_IDS="$PUBLIC_USER_IDS" \
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON="$PUBLIC_ZONE_POLICY" \
    CAIRN_REALM="$API_REALM" ALLOW_ISOLATED_QA_SOURCE_CONTRACT="$API_ISOLATED_SOURCE_CONTRACT" \
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
export JWT_SECRET="$JWT_SECRET" CAIRN_REALM="$API_REALM"
export ALLOW_ISOLATED_QA_SOURCE_CONTRACT="$API_ISOLATED_SOURCE_CONTRACT"
export NODE_ENV="$API_NODE_ENV" PUBLIC_CAIRN_PILOT_ENABLED="$PUBLIC_CAIRN_FLAG"
export HARNESS_EXPECT_PRE046_ROUTE=1
export PUBLIC_CAIRN_PILOT_USER_IDS="$PUBLIC_USER_IDS"
export PUBLIC_CAIRN_SENSITIVE_ZONES_JSON="$PUBLIC_ZONE_POLICY"
if [ "$HARNESS_MODE" = "memory-public-gate" ]; then
  if [ -n "${EVIDENCE_DIR:-}" ]; then
    mkdir -p "$EVIDENCE_DIR"
    node "$SCRIPT_DIR/cairn-memory-harness/$HARNESS_SCRIPT" | tee "$EVIDENCE_DIR/public-viewer-gate-result.json"
  else
    node "$SCRIPT_DIR/cairn-memory-harness/$HARNESS_SCRIPT"
  fi
  exit 0
fi
if [ "${SKIP_API_BASELINE:-0}" != "1" ]; then
  if [ -n "${EVIDENCE_DIR:-}" ]; then
    mkdir -p "$EVIDENCE_DIR"
    node "$SCRIPT_DIR/public-cairn-harness/$HARNESS_SCRIPT" | tee "$EVIDENCE_DIR/result.json"
  else
    node "$SCRIPT_DIR/public-cairn-harness/$HARNESS_SCRIPT"
  fi
fi

if [ "$HARNESS_MODE" = "api" ]; then
  if [ -n "${EVIDENCE_DIR:-}" ]; then
    mkdir -p "$EVIDENCE_DIR"
    node "$SCRIPT_DIR/cairn-memory-harness/api-mysql.js" | tee "$EVIDENCE_DIR/cairn-memory-result.json"
  else
    node "$SCRIPT_DIR/cairn-memory-harness/api-mysql.js"
  fi
fi

if [ "$HARNESS_MODE" = "api" ] && [ -n "${CONNECTED_QA_DIR:-}" ]; then
  mkdir -p "$CONNECTED_QA_DIR"
  node "$SCRIPT_DIR/public-cairn-harness/connected-loaded.js" | tee "$CONNECTED_QA_DIR/runner-output.json"
fi
