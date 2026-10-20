#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_ID="${SHANGHAI_REHEARSAL_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
SAFE_RUN_ID="$(printf '%s' "$RUN_ID" | tr -cd 'A-Za-z0-9_')"
CONTAINER="cairn-shanghai-o88-${SAFE_RUN_ID}"
DB_NAME="cairn_shanghai_${SAFE_RUN_ID}"
DB_PASSWORD="shanghai-${SAFE_RUN_ID}-local-only"
MYSQL_IMAGE="${HARNESS_MYSQL_IMAGE:-mysql:8.0.36}"
OUTPUT_DIR="${EVIDENCE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/cairn-shanghai-rehearsal.XXXXXX")}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cairn-shanghai-runtime.XXXXXX")"
MANIFEST="$SCRIPT_DIR/cairn-shanghai-fixtures/manifest.o88.json"
TOOL="$SCRIPT_DIR/cairn-shanghai-field-test.js"

cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$TEMP_DIR"
}
trap cleanup EXIT INT TERM

if docker ps -a --format '{{.Names}}' | grep -Fxq "$CONTAINER"; then
  echo "refusing to reuse existing container $CONTAINER" >&2
  exit 1
fi
mkdir -p "$OUTPUT_DIR"
docker run -d --name "$CONTAINER" --security-opt seccomp=unconfined \
  -e MYSQL_ROOT_PASSWORD="$DB_PASSWORD" -e MYSQL_DATABASE="$DB_NAME" \
  -p 127.0.0.1::3306 "$MYSQL_IMAGE" >/dev/null
for attempt in $(seq 1 60); do
  if docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse 'SELECT 1' >/dev/null 2>&1; then break; fi
  if [ "$attempt" = 60 ]; then docker logs "$CONTAINER" >&2; exit 1; fi
  sleep 1
done
DB_PORT="$(docker port "$CONTAINER" 3306/tcp | sed -E 's/.*:([0-9]+)$/\1/' | head -1)"
TARGET="isolated:127.0.0.1:${DB_PORT}:${DB_NAME}"

apply_sql() {
  docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$1" >/dev/null
}
apply_sql "$SCRIPT_DIR/personal-friends-harness/current-schema-fixture.sql"
for migration in \
  035_settings_correctness.sql 036_route_origin_identity.sql 037_personal_friends_v1.sql \
  038_memory_presence_witnesses.sql 039_borrowed_route_terminal_ack.sql \
  040_resource_content_revision.sql 041_public_cairn_pilot.sql 042_v1_closure_authority.sql \
  043_friend_discovery_marker_location.sql 044_public_cairn_moderation_audit.sql \
  045_memory_friends_cairn_contract.sql 046_ordered_routes_and_deliveries.sql \
  047_friend_request_lifecycle.sql 048_friends_memory_history_repair.sql \
  049_retire_legacy_memory_sharing.sql 050_complete_legacy_memory_retirement.sql \
  051_memory_coverage_read_model.sql 052_cairn_placement_provenance.sql \
  053_cairn_qa_fixture_cohorts.sql 054_memory_hit_push_explicit_opt_in.sql \
  055_notification_delivery_outbox.sql; do
  apply_sql "$BACKEND_DIR/src/migrations/$migration"
done

docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "INSERT INTO users (id,name,email,password_hash,date_of_birth,activity_source_realm) VALUES
    (9101,'O88 Reader A','o88-reader-a@example.invalid','test-only','1990-01-01','isolated_qa'),
    (9102,'O88 Reader B','o88-reader-b@example.invalid','test-only','1990-01-01','isolated_qa'),
    (9201,'O88 Public Author A','o88-public-a@example.invalid','test-only','1990-01-01','isolated_qa'),
    (9202,'O88 Public Author B','o88-public-b@example.invalid','test-only','1990-01-01','isolated_qa'),
    (9301,'O88 Friend Author A','o88-friend-a@example.invalid','test-only','1990-01-01','isolated_qa'),
    (9302,'O88 Friend Author B','o88-friend-b@example.invalid','test-only','1990-01-01','isolated_qa');
   INSERT INTO friends (user_id,friend_id,created_at) VALUES
    (9101,9301,UTC_TIMESTAMP(3)),(9301,9101,UTC_TIMESTAMP(3)),
    (9101,9302,UTC_TIMESTAMP(3)),(9302,9101,UTC_TIMESTAMP(3)),
    (9102,9301,UTC_TIMESTAMP(3)),(9301,9102,UTC_TIMESTAMP(3)),
    (9102,9302,UTC_TIMESTAMP(3)),(9302,9102,UTC_TIMESTAMP(3));
   INSERT INTO friendship_episodes (episode_id,user_low_id,user_high_id,started_at) VALUES
    (UUID(),9101,9301,UTC_TIMESTAMP(3)),(UUID(),9101,9302,UTC_TIMESTAMP(3)),
    (UUID(),9102,9301,UTC_TIMESTAMP(3)),(UUID(),9102,9302,UTC_TIMESTAMP(3));" >/dev/null

MANIFEST_SHA="$(node -e "const fs=require('fs'),c=require('crypto');const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash('sha256').update(b).digest('hex'))" "$MANIFEST")"
FIELD_REVIEW="$TEMP_DIR/field-review.json"
node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1]));fs.writeFileSync(process.argv[3],JSON.stringify({batch_id:m.batch_id,manifest_sha256:process.argv[2],coordinate_system:'WGS84',reviewer:'disposable-mysql-rehearsal',reviewed_at:new Date().toISOString(),field_verified_fixture_keys:m.fixtures.map(x=>x.key),notes:'Synthetic rehearsal only; this is not physical field approval.'},null,2))" \
  "$MANIFEST" "$MANIFEST_SHA" "$FIELD_REVIEW"

run_tool() {
  DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
    NODE_ENV=test CAIRN_REALM=isolated_review ALLOW_ISOLATED_QA_SOURCE_CONTRACT=1 \
    PUBLIC_CAIRN_PILOT_ENABLED=1 PUBLIC_CAIRN_PILOT_USER_IDS=9101,9102,9201,9202 \
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON='[]' node "$TOOL" "$@"
}

run_tool plan --manifest="$MANIFEST" > "$OUTPUT_DIR/01-plan.json"
run_tool apply --manifest="$MANIFEST" --environment=isolated \
  --reader-ids=9101,9102 --public-author-ids=9201,9202 --friend-author-ids=9301,9302 \
  --field-review="$FIELD_REVIEW" --confirm-batch=o88-shanghai-encounter-20261020 \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/02-apply.json"
run_tool verify --manifest="$MANIFEST" --environment=isolated \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/03-verify-active.json"
run_tool advance-revision --manifest="$MANIFEST" --environment=isolated \
  --field-review="$FIELD_REVIEW" --keys=O88-JK-P01,O88-SH-F01 \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  > "$OUTPUT_DIR/04-advance-revision.json"
run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 > "$OUTPUT_DIR/05-cleanup.json"
run_tool verify --manifest="$MANIFEST" --environment=isolated \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/06-verify-cleaned.json"

node - "$OUTPUT_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const plan = read('01-plan.json');
const applied = read('02-apply.json');
const active = read('03-verify-active.json');
const advanced = read('04-advance-revision.json');
const cleanup = read('05-cleanup.json');
const cleaned = read('06-verify-cleaned.json');
const activeLive = active.counts.reduce((sum, row) => sum + Number(row.live_markers || 0), 0);
const cleanedLive = cleaned.counts.reduce((sum, row) => sum + Number(row.live_markers || 0), 0);
const checks = {
  plan_is_read_only: plan.writePerformed === false && plan.totals.fixtures === 60,
  applied_exactly_60: applied.applied === true && applied.rows === 60,
  active_manifest_and_rows: active.exactManifest === true && active.batch?.state === 'active' && activeLive === 60,
  advanced_exactly_2: advanced.advanced?.length === 2,
  cleanup_exactly_60: cleanup.deletedMarkers === 60,
  cleaned_has_no_live_markers: cleaned.batch?.state === 'cleaned' && cleanedLive === 0,
};
const summary = { schema: 'cairnnz.o88-shanghai-rehearsal.v1', checks, passed: Object.values(checks).every(Boolean) };
fs.writeFileSync(path.join(dir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
if (!summary.passed) throw new Error(JSON.stringify(summary));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
NODE

echo "Evidence: $OUTPUT_DIR"
