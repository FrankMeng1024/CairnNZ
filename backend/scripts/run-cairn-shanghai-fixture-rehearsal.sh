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
  055_notification_delivery_outbox.sql 056_notification_target_receipt_reliability.sql; do
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

run_tool() {
  DB_HOST=127.0.0.1 DB_PORT="$DB_PORT" DB_USER=root DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" \
    NODE_ENV=test CAIRN_REALM=isolated_review ALLOW_ISOLATED_QA_SOURCE_CONTRACT=1 \
    PUBLIC_CAIRN_PILOT_ENABLED=1 PUBLIC_CAIRN_PILOT_USER_IDS=9101,9102,9201,9202 \
    PUBLIC_CAIRN_SENSITIVE_ZONES_JSON='[]' node "$TOOL" "$@"
}

run_tool plan --manifest="$MANIFEST" > "$OUTPUT_DIR/01-plan.json"
run_tool inspect-target --manifest="$MANIFEST" > "$OUTPUT_DIR/02-inspect-target.json"
MANIFEST_SHA="$(node -e "const fs=require('fs'),c=require('crypto');const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash('sha256').update(b).digest('hex'))" "$MANIFEST")"
SERVER_UUID="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1])).serverUuid)" "$OUTPUT_DIR/02-inspect-target.json")"
TARGET="mysql:${SERVER_UUID}:${DB_NAME}"
TARGET_ALLOWLIST="$TEMP_DIR/target-allowlist.json"
node -e "require('fs').writeFileSync(process.argv[1],JSON.stringify({schema_version:1,approved_targets:[{server_uuid:process.argv[2],database:process.argv[3],realm:'isolated',mutation_allowed:true,approval_note:'Disposable local rehearsal only'}]},null,2))" \
  "$TARGET_ALLOWLIST" "$SERVER_UUID" "$DB_NAME"
ALLOWLIST_SHA="$(node -e "const fs=require('fs'),c=require('crypto');const b=fs.readFileSync(process.argv[1]);process.stdout.write(c.createHash('sha256').update(b).digest('hex'))" "$TARGET_ALLOWLIST")"
FIELD_REVIEW="$TEMP_DIR/field-review.json"
node - "$MANIFEST" "$MANIFEST_SHA" "$FIELD_REVIEW" "$TARGET" "$ALLOWLIST_SHA" <<'NODE'
const fs = require('fs');
const [manifestFile, manifestSha, output, target, allowlistSha] = process.argv.slice(2);
const manifest = JSON.parse(fs.readFileSync(manifestFile));
const cleanupScope = [
  'cairn_qa_fixture_batches:batch_id', 'cairn_qa_fixture_readers:batch_id',
  'cairn_qa_fixtures:batch_id', 'markers:approved_fixture_marker_ids',
  'cairn_review_cases:approved_fixture_marker_ids', 'cairn_collections:approved_fixture_marker_ids',
  'marker_audience_epochs:approved_fixture_marker_ids',
  'notification_log:orphaned_fixture_only_presentation_groups',
  'cairn_presentation_groups:orphaned_fixture_only_groups',
];
const now = Date.now();
fs.writeFileSync(output, JSON.stringify({
  schema_version: 2, batch_id: manifest.batch_id, manifest_sha256: manifestSha,
  coordinate_system: 'WGS84', reviewer: 'disposable-mysql-rehearsal',
  reviewed_at: new Date(now).toISOString(), target_fingerprint: target,
  target_realm: 'isolated', target_allowlist_sha256: allowlistSha,
  reader_ids: ['9101', '9102'], public_author_ids: ['9201', '9202'],
  friend_author_ids: ['9301', '9302'], ttl_days: 14,
  approval_expires_at: new Date(now + 86400000).toISOString(),
  batch_expires_at: new Date(now + (13 * 86400000)).toISOString(), cleanup_scope: cleanupScope,
  field_verified_fixture_keys: manifest.fixtures.map(item => item.key),
  notes: 'Synthetic disposable rehearsal only; this is not physical field approval.',
}, null, 2));
NODE
run_tool approval-plan --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" --field-review="$FIELD_REVIEW" \
  > "$OUTPUT_DIR/03-approval-plan.json"
OWNER_APPROVAL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1])).owner_approval)" "$OUTPUT_DIR/03-approval-plan.json")"
run_tool apply --manifest="$MANIFEST" --environment=isolated \
  --reader-ids=9101,9102 --public-author-ids=9201,9202 --friend-author-ids=9301,9302 \
  --field-review="$FIELD_REVIEW" --confirm-batch=o88-shanghai-encounter-20261020 \
  --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/04-apply.json"
run_tool verify --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/05-verify-active.json"
if run_tool apply --manifest="$MANIFEST" --environment=isolated \
  --reader-ids=9101,9102,9103 --public-author-ids=9201,9202 --friend-author-ids=9301,9302 \
  --field-review="$FIELD_REVIEW" --confirm-batch=o88-shanghai-encounter-20261020 \
  --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/06-cohort-expansion-unexpected.json" 2> "$OUTPUT_DIR/06-cohort-expansion-rejected.txt"; then
  echo 'cohort expansion was unexpectedly accepted' >&2
  exit 1
fi
PARTIAL_MARKER_ID="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse "SELECT marker_id FROM ${DB_NAME}.cairn_qa_fixtures WHERE fixture_key='O88-JK-P01'")"
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "DELETE FROM cairn_qa_fixtures WHERE fixture_key='O88-JK-P01'; DELETE FROM markers WHERE id=${PARTIAL_MARKER_ID};" >/dev/null
run_tool apply --manifest="$MANIFEST" --environment=isolated \
  --reader-ids=9101,9102 --public-author-ids=9201,9202 --friend-author-ids=9301,9302 \
  --field-review="$FIELD_REVIEW" --confirm-batch=o88-shanghai-encounter-20261020 \
  --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/07-partial-recovery.json"
run_tool advance-revision --manifest="$MANIFEST" --environment=isolated \
  --field-review="$FIELD_REVIEW" --keys=O88-JK-P01,O88-SH-F01 \
  --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  > "$OUTPUT_DIR/08-advance-revision.json"
run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --field-review="$FIELD_REVIEW" --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 > "$OUTPUT_DIR/09-cleanup.json"
run_tool verify --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/10-verify-cleaned.json"

node - "$OUTPUT_DIR" <<'NODE'
const fs = require('fs');
const path = require('path');
const dir = process.argv[2];
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const plan = read('01-plan.json');
const inspected = read('02-inspect-target.json');
const approval = read('03-approval-plan.json');
const applied = read('04-apply.json');
const active = read('05-verify-active.json');
const recovered = read('07-partial-recovery.json');
const advanced = read('08-advance-revision.json');
const cleanup = read('09-cleanup.json');
const cleaned = read('10-verify-cleaned.json');
const activeLive = active.counts.reduce((sum, row) => sum + Number(row.live_markers || 0), 0);
const cleanedLive = cleaned.counts.reduce((sum, row) => sum + Number(row.live_markers || 0), 0);
const checks = {
  plan_is_read_only: plan.writePerformed === false && plan.totals.fixtures === 60,
  actual_target_inspected_read_only: inspected.writePerformed === false && Boolean(inspected.serverUuid),
  approval_plan_read_only: approval.writePerformed === false && Boolean(approval.owner_approval),
  applied_exactly_60: applied.applied === true && applied.rows === 60,
  active_manifest_and_rows: active.exactManifest === true && active.batch?.state === 'active' && activeLive === 60,
  changed_cohort_rejected: fs.readFileSync(path.join(dir, '06-cohort-expansion-rejected.txt'), 'utf8').includes('do not match'),
  exact_partial_recovery: recovered.applied === true && recovered.rows === 60,
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
