#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_DIR="$(cd "$BACKEND_DIR/.." && pwd)"
OUTPUT_DIR="${EVIDENCE_DIR:-$REPO_DIR/_review/hike-run-client-backend-closure}"
EXPO_URL="${EXPO_URL:-http://127.0.0.1:8098}"
HARNESS_SCENARIO="${HARNESS_SCENARIO:-full}"
RUN_ID="${HARNESS_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
SAFE_RUN_ID="$(printf '%s' "$RUN_ID" | tr -cd 'A-Za-z0-9_')"
CONTAINER="cairn-hike-client-mysql-${SAFE_RUN_ID}"
DB_NAME="cairn_hike_client_${SAFE_RUN_ID}"
DB_PASSWORD="hike-client-${SAFE_RUN_ID}-local-only"
JWT_SECRET="hike-client-closure-${SAFE_RUN_ID}-only-64-characters-long-secret"
MYSQL_IMAGE="${HARNESS_MYSQL_IMAGE:-mysql:8.0.36}"
MYSQL_READY_ATTEMPTS="${HARNESS_MYSQL_READY_ATTEMPTS:-180}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cairn-hike-client.XXXXXX")"
API_PID=""

mkdir -p "$OUTPUT_DIR"
mkdir -p "$TEMP_DIR/mysql-data"

cleanup() {
  local api_stopped=false container_removed=false
  if [ -n "$API_PID" ]; then
    kill "$API_PID" >/dev/null 2>&1 || true
    api_stopped=true
  fi
  cp "$TEMP_DIR/backend.log" "$OUTPUT_DIR/backend.log" 2>/dev/null || true
  if [ "${HARNESS_KEEP_CONTAINER:-0}" != "1" ]; then
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
    container_removed=true
  fi
  node -e '
    const fs=require("fs"),path=require("path");
    const out=process.argv[1];
    fs.writeFileSync(path.join(out,"TEST_DATABASE_TEARDOWN.json"),JSON.stringify({
      schema:"cairn.hike-run.test-database-teardown.v1",
      recordedAt:new Date().toISOString(),
      apiProcessStopped:process.argv[2]==="true",
      disposableContainerRemoved:process.argv[3]==="true",
      serverActivityDeletionWasNotProductCleanup:true,
      teardownScope:"entire disposable MySQL container after evidence capture"
    },null,2)+"\n");
  ' "$OUTPUT_DIR" "$api_stopped" "$container_removed"
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "refusing to reuse existing container $CONTAINER" >&2
  exit 1
fi

docker run -d --name "$CONTAINER" --security-opt seccomp=unconfined \
  -v "$TEMP_DIR/mysql-data:/var/lib/mysql" \
  -e MYSQL_ROOT_PASSWORD="$DB_PASSWORD" \
  -e MYSQL_DATABASE="$DB_NAME" \
  -p 127.0.0.1::3306 "$MYSQL_IMAGE" >/dev/null

stable_mysql_checks=0
for attempt in $(seq 1 "$MYSQL_READY_ATTEMPTS"); do
  if docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse 'SELECT 1' >/dev/null 2>&1; then
    stable_mysql_checks=$((stable_mysql_checks + 1))
    if [ "$stable_mysql_checks" -ge 2 ]; then break; fi
  else
    stable_mysql_checks=0
  fi
  if [ "$attempt" = "$MYSQL_READY_ATTEMPTS" ]; then
    docker logs "$CONTAINER" >&2 || true
    exit 1
  fi
  sleep 1
done

# The disposable fixture predates the optional client diagnostic ingestion
# table. Create only the schema already expected by /api/edit-diag so unrelated
# 500s cannot contaminate this isolated browser proof.
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e "
  CREATE TABLE IF NOT EXISTS debug_events_v2 (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    user_id BIGINT UNSIGNED NULL,
    session_instance_id VARCHAR(64) NOT NULL,
    phase VARCHAR(64) NOT NULL,
    step VARCHAR(64) NOT NULL,
    seq BIGINT UNSIGNED NOT NULL,
    timestamp_unix_ms BIGINT NOT NULL,
    outcome VARCHAR(32) NOT NULL DEFAULT '',
    diagnostic VARCHAR(1024) NOT NULL DEFAULT '',
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
" >/dev/null

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
  051_memory_coverage_read_model.sql; do
  docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" \
    < "$BACKEND_DIR/src/migrations/$migration" >/dev/null
done

API_PORT=$((34000 + ($$ % 1000)))
while nc -z 127.0.0.1 "$API_PORT" >/dev/null 2>&1; do API_PORT=$((API_PORT + 1)); done
(
  cd "$BACKEND_DIR"
  DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
    JWT_SECRET="$JWT_SECRET" NONCE_SECRET="$JWT_SECRET" PORT="$API_PORT" \
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

SOURCE_HEAD="$(git -C "$REPO_DIR" rev-parse HEAD)"
SOURCE_TREE="$(git -C "$REPO_DIR" rev-parse HEAD^{tree})"
node "$REPO_DIR/app/scripts/hike-run-client-backend-closure-qa.mjs" \
  --api "http://127.0.0.1:$API_PORT" \
  --url "$EXPO_URL" \
  --output "$OUTPUT_DIR" \
  --head "$SOURCE_HEAD" \
  --tree "$SOURCE_TREE" \
  --scenario "$HARNESS_SCENARIO"

docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse "
  SELECT client_activity_id, COUNT(*), MIN(id), MAX(id),
         SUM(finalized_at IS NOT NULL),
         SUM(JSON_LENGTH(route_points)),
         SUM(JSON_LENGTH(route_points_raw)),
         SUM(JSON_LENGTH(route_points_canonical))
  FROM $DB_NAME.sessions
  WHERE client_activity_id LIKE '82000000-0000-4000-8000-%'
  GROUP BY client_activity_id ORDER BY client_activity_id;
" > "$OUTPUT_DIR/DB_ACTIVITY_ASSERTIONS.tsv"
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse "
  SELECT source_activity_client_id, COUNT(*), COUNT(DISTINCT CONCAT(lat,':',lng,':',ts))
  FROM $DB_NAME.memory_points
  WHERE source_activity_client_id LIKE '82000000-0000-4000-8000-%'
  GROUP BY source_activity_client_id ORDER BY source_activity_client_id;
" > "$OUTPUT_DIR/DB_MEMORY_ASSERTIONS.tsv"
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse "
  SELECT COUNT(*), COUNT(DISTINCT op_id), COUNT(DISTINCT status_code)
  FROM $DB_NAME.idempotency_keys;
" > "$OUTPUT_DIR/DB_IDEMPOTENCY_ASSERTIONS.tsv"

node -e '
  const fs=require("fs"),path=require("path"),crypto=require("crypto");
  const out=process.argv[1];
  const read=name=>fs.readFileSync(path.join(out,name),"utf8").trim().split(/\n/).filter(Boolean).map(line=>line.split("\t"));
  const activities=read("DB_ACTIVITY_ASSERTIONS.tsv");
  const memory=read("DB_MEMORY_ASSERTIONS.tsv");
  const idempotency=read("DB_IDEMPOTENCY_ASSERTIONS.tsv")[0]??[];
  const scenario=process.argv[2];
  const result={
    schema:"cairn.hike-run.client-backend-db-assertions.v1",
    capturedAt:new Date().toISOString(),
    beforeTestDatabaseTeardown:true,
    activityRows:activities.map(row=>({clientActivityId:row[0],rowCount:Number(row[1]),minId:Number(row[2]),maxId:Number(row[3]),finalizedRows:Number(row[4]),routePoints:Number(row[5]),rawPoints:Number(row[6]),canonicalPoints:Number(row[7])})),
    memoryRows:memory.map(row=>({clientActivityId:row[0],rowCount:Number(row[1]),distinctFacts:Number(row[2])})),
    idempotency:{rowCount:Number(idempotency[0]??0),distinctOperationIds:Number(idempotency[1]??0),distinctStatuses:Number(idempotency[2]??0)},
  };
  const seeded=result.activityRows.filter(row=>!row.clientActivityId.endsWith("000000000005"));
  const recorder=result.activityRows.find(row=>row.clientActivityId.endsWith("000000000005"));
  const recorderMemory=result.memoryRows.find(row=>row.clientActivityId.endsWith("000000000005"));
  const heldAckDeletedMemory=result.memoryRows.find(row=>row.clientActivityId.endsWith("000000000006"));
  result.scenario=scenario;
  const expectedActivityRows=scenario==="focused-review"?1:5;
  const expectedSeededRows=scenario==="focused-review"?0:4;
  // Activity deletion wins over a late Save ACK, while independently recorded
  // physical Memory remains. The focused case therefore requires exactly one
  // six-fact set for the deleted Activity rather than requiring its removal.
  const expectedMemoryRows=scenario==="focused-review"?2:5;
  result.passed=result.activityRows.length===expectedActivityRows
    && seeded.length===expectedSeededRows
    && seeded.every(row=>row.rowCount===1&&row.finalizedRows===1&&row.routePoints===6&&row.rawPoints===6&&row.canonicalPoints===6)
    && !!recorder&&recorder.rowCount===1&&recorder.finalizedRows===1
    && recorder.routePoints>=2&&recorder.rawPoints>=2&&recorder.canonicalPoints>=2
    && result.memoryRows.length===expectedMemoryRows
    && result.memoryRows.filter(row=>!row.clientActivityId.endsWith("000000000005")).every(row=>row.rowCount===6&&row.distinctFacts===6)
    && !!recorderMemory&&recorderMemory.rowCount>=2&&recorderMemory.rowCount===recorderMemory.distinctFacts
    && (scenario!=="focused-review"||(
      !!heldAckDeletedMemory
      && heldAckDeletedMemory.rowCount===6
      && heldAckDeletedMemory.distinctFacts===6
    ));
  fs.writeFileSync(path.join(out,"DB_ASSERTIONS.json"),JSON.stringify(result,null,2)+"\n");
  if(!result.passed)process.exitCode=1;
' "$OUTPUT_DIR" "$HARNESS_SCENARIO"

echo "client/backend closure evidence: $OUTPUT_DIR"
