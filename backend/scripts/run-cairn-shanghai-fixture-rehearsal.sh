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
CLEANUP_BATCH_MODE="${SHANGHAI_CLEANUP_BATCH_MODE:-explicit-expired}"
OUTPUT_DIR="${EVIDENCE_DIR:-$(mktemp -d "${TMPDIR:-/tmp}/cairn-shanghai-rehearsal.XXXXXX")}"
TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/cairn-shanghai-runtime.XXXXXX")"
MANIFEST="$SCRIPT_DIR/cairn-shanghai-fixtures/manifest.o88.json"
TOOL="$SCRIPT_DIR/cairn-shanghai-field-test.js"

case "$CLEANUP_BATCH_MODE" in
  explicit-expired|active-elapsed|active-valid) ;;
  *) echo "unsupported SHANGHAI_CLEANUP_BATCH_MODE: $CLEANUP_BATCH_MODE" >&2; exit 2 ;;
esac

cleanup() {
  # mysql:8 declares /var/lib/mysql as an anonymous volume. Remove that
  # disposable volume with the isolated rehearsal container on every exit.
  docker rm -fv "$CONTAINER" >/dev/null 2>&1 || true
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
node -e "require('fs').writeFileSync(process.argv[1],JSON.stringify({schema_version:2,approved_targets:[{server_uuid:process.argv[2],database:process.argv[3],realm:'isolated',apply_allowed:true,cleanup_allowed:true,approval_note:'Disposable local rehearsal only'}]},null,2))" \
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
  'cairn_acquisition_events:approved_fixture_marker_ids',
  'cairn_acquisitions:approved_fixture_marker_ids', 'cairn_revisions:approved_fixture_marker_ids',
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
CLEANUP_AUTHORIZATION="$TEMP_DIR/cleanup-authorization.json"
node - "$FIELD_REVIEW" "$MANIFEST" "$CLEANUP_AUTHORIZATION" "$OWNER_APPROVAL" <<'NODE'
const fs = require('fs');
const [fieldReviewFile, manifestFile, output, expectedActivationApproval] = process.argv.slice(2);
const review = JSON.parse(fs.readFileSync(fieldReviewFile));
const now = Date.now();
const manifest = JSON.parse(fs.readFileSync(manifestFile));
fs.writeFileSync(output, JSON.stringify({
  schema_version: 2, purpose: 'cleanup-only', batch_id: review.batch_id,
  manifest_sha256: review.manifest_sha256, target_fingerprint: review.target_fingerprint,
  target_realm: review.target_realm, target_allowlist_sha256: review.target_allowlist_sha256,
  expected_activation_approval: expectedActivationApproval,
  fixture_keys: manifest.fixtures.map(item => item.key),
  reader_ids: review.reader_ids, public_author_ids: review.public_author_ids,
  friend_author_ids: review.friend_author_ids,
  cleanup_scope: review.cleanup_scope, authorized_by: 'disposable-mysql-rehearsal',
  authorized_at: new Date(now).toISOString(),
  cleanup_approval_expires_at: new Date(now + (2 * 86400000)).toISOString(),
  reason: 'Remove only this isolated disposable fixture batch, including after activation expiry.',
}, null, 2));
NODE
run_tool cleanup-plan --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" --cleanup-authorization="$CLEANUP_AUTHORIZATION" \
  > "$OUTPUT_DIR/03b-cleanup-plan.json"
CLEANUP_OWNER_APPROVAL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1])).cleanup_owner_approval)" "$OUTPUT_DIR/03b-cleanup-plan.json")"
run_tool apply --manifest="$MANIFEST" --environment=isolated \
  --reader-ids=9101,9102 --public-author-ids=9201,9202 --friend-author-ids=9301,9302 \
  --field-review="$FIELD_REVIEW" --confirm-batch=o88-shanghai-encounter-20261020 \
  --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/04-apply.json"
run_tool apply --manifest="$MANIFEST" --environment=isolated \
  --reader-ids=9101,9102 --public-author-ids=9201,9202 --friend-author-ids=9301,9302 \
  --field-review="$FIELD_REVIEW" --confirm-batch=o88-shanghai-encounter-20261020 \
  --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/04b-exact-reapply.json"
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
MIXED_PROBE_JSON="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
  "USE ${DB_NAME};
   INSERT INTO markers (user_id,type,text,lat,lng,permission,created_at,updated_at)
     VALUES (9301,'free','Ordinary non-fixture Cairn',31.2148,121.4992,'group',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
   SET @ordinary_marker=LAST_INSERT_ID();
   INSERT INTO cairn_revisions
     (marker_id,owner_id,content_revision,content_type,content_text,lat,lng,approximate,content_sha256,
      source_audience,audience_epoch,identity_policy,friend_author_name_snapshot)
     VALUES (@ordinary_marker,9301,1,'free','Ordinary non-fixture Cairn',31.2148,121.4992,0,
       SHA2('ordinary-non-fixture-cairn',256),'friends',1,'friends_acquired','O88 Friend Author A');
   SET @ordinary_revision=LAST_INSERT_ID();
   SET @fixture_mixed_marker=(SELECT marker_id FROM cairn_qa_fixtures WHERE fixture_key='O88-JK-P01');
   SET @fixture_only_marker=(SELECT marker_id FROM cairn_qa_fixtures WHERE fixture_key='O88-JK-P02');
   SET @fixture_mixed_revision=(SELECT id FROM cairn_revisions WHERE marker_id=@fixture_mixed_marker ORDER BY content_revision DESC,id DESC LIMIT 1);
   SET @fixture_only_revision=(SELECT id FROM cairn_revisions WHERE marker_id=@fixture_only_marker ORDER BY content_revision DESC,id DESC LIMIT 1);
   INSERT INTO cairn_acquisitions
     (viewer_id,marker_id,cairn_revision_id,content_revision,acquired_via,evidence_kind,evidence_id,evidence_observed_at)
     VALUES (9101,@ordinary_marker,@ordinary_revision,1,'friends','presence_witness',880001,UTC_TIMESTAMP(3));
   SET @ordinary_acquisition=LAST_INSERT_ID();
   INSERT INTO cairn_acquisitions
     (viewer_id,marker_id,cairn_revision_id,content_revision,acquired_via,evidence_kind,evidence_id,evidence_observed_at)
     VALUES (9101,@fixture_mixed_marker,@fixture_mixed_revision,2,'public','presence_witness',880002,UTC_TIMESTAMP(3));
   SET @fixture_mixed_acquisition=LAST_INSERT_ID();
   INSERT INTO cairn_acquisitions
     (viewer_id,marker_id,cairn_revision_id,content_revision,acquired_via,evidence_kind,evidence_id,evidence_observed_at)
     VALUES (9101,@fixture_only_marker,@fixture_only_revision,1,'public','presence_witness',880003,UTC_TIMESTAMP(3));
   SET @fixture_only_acquisition=LAST_INSERT_ID();
   INSERT INTO cairn_presentation_groups
     (viewer_id,group_token,merge_started_at,merge_until,announced_at)
     VALUES (9101,'88888888-8888-4888-8888-888888888881',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
   SET @mixed_group=LAST_INSERT_ID();
   INSERT INTO cairn_acquisition_events (viewer_id,acquisition_id,presentation_group_id,announced_at)
     VALUES (9101,@ordinary_acquisition,@mixed_group,UTC_TIMESTAMP(3)),
            (9101,@fixture_mixed_acquisition,@mixed_group,UTC_TIMESTAMP(3));
   INSERT INTO notification_log (recipient_user_id,actor_user_id,kind,related_id,title,body,status,dedupe_key)
     VALUES (9101,9301,'memory_hit',@mixed_group,'Mixed probe','Disposable rehearsal','queued','o88-mixed-probe');
   INSERT INTO cairn_presentation_groups
     (viewer_id,group_token,merge_started_at,merge_until,announced_at)
     VALUES (9101,'88888888-8888-4888-8888-888888888882',UTC_TIMESTAMP(3),UTC_TIMESTAMP(3),UTC_TIMESTAMP(3));
   SET @fixture_group=LAST_INSERT_ID();
   INSERT INTO cairn_acquisition_events (viewer_id,acquisition_id,presentation_group_id,announced_at)
     VALUES (9101,@fixture_only_acquisition,@fixture_group,UTC_TIMESTAMP(3));
   INSERT INTO notification_log (recipient_user_id,actor_user_id,kind,related_id,title,body,status,dedupe_key)
     VALUES (9101,9301,'memory_hit',@fixture_group,'Fixture probe','Disposable rehearsal','queued','o88-fixture-probe');
   SELECT JSON_OBJECT('ordinaryMarkerId',@ordinary_marker,'mixedGroupId',@mixed_group,'fixtureOnlyGroupId',@fixture_group);" 2>/dev/null)"
printf '%s\n' "$MIXED_PROBE_JSON" > "$OUTPUT_DIR/08b-mixed-groups-created.json"
FIXTURE_MARKER_IDS="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
  "SELECT GROUP_CONCAT(marker_id ORDER BY marker_id) FROM ${DB_NAME}.cairn_qa_fixtures WHERE batch_id='o88-shanghai-encounter-20261020'")"
# Exercise each schema-valid cleanup starting state in an independent disposable
# database. Expiry must block creation/update but must never strand the exact
# batch from a current cleanup-only authorization.
case "$CLEANUP_BATCH_MODE" in
  explicit-expired)
    BATCH_STATE_SQL="state='expired',expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)"
    EXPECTED_BATCH_STATE="expired"
    EXPECTED_BATCH_EXPIRED="true"
    ;;
  active-elapsed)
    BATCH_STATE_SQL="state='active',expires_at=DATE_SUB(UTC_TIMESTAMP(3),INTERVAL 1 DAY)"
    EXPECTED_BATCH_STATE="active"
    EXPECTED_BATCH_EXPIRED="true"
    ;;
  active-valid)
    BATCH_STATE_SQL="state='active',expires_at=DATE_ADD(UTC_TIMESTAMP(3),INTERVAL 1 DAY)"
    EXPECTED_BATCH_STATE="active"
    EXPECTED_BATCH_EXPIRED="false"
    ;;
esac
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "UPDATE cairn_qa_fixture_batches SET ${BATCH_STATE_SQL}
    WHERE batch_id='o88-shanghai-encounter-20261020';" >/dev/null
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
  "SELECT JSON_OBJECT('batchExpired',expires_at<=UTC_TIMESTAMP(3),'state',state)
     FROM ${DB_NAME}.cairn_qa_fixture_batches WHERE batch_id='o88-shanghai-encounter-20261020'" \
  > "$OUTPUT_DIR/08c-expired-batch-before-cleanup.json"
if [ "$CLEANUP_BATCH_MODE" != "active-valid" ]; then
  if run_tool apply --manifest="$MANIFEST" --environment=isolated \
    --reader-ids=9101,9102 --public-author-ids=9201,9202 --friend-author-ids=9301,9302 \
    --field-review="$FIELD_REVIEW" --confirm-batch=o88-shanghai-encounter-20261020 \
    --target-allowlist="$TARGET_ALLOWLIST" --owner-approval="$OWNER_APPROVAL" \
    --confirm-target="$TARGET" > "$OUTPUT_DIR/08d-expired-reapply-unexpected.json" 2> "$OUTPUT_DIR/08d-expired-reapply-rejected.txt"; then
    echo 'expired batch was unexpectedly reactivated' >&2
    exit 1
  fi
else
  printf '%s\n' 'active valid batch: creation/update expiry rejection is not applicable' \
    > "$OUTPUT_DIR/08d-expired-reapply-rejected.txt"
fi

# Real connected negative matrix. Each command reaches the isolated MySQL
# identity, then fails closed before a delete can commit.
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$CLEANUP_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 \
  --confirm-target="mysql:aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee:wrong" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08f-wrong-target-unexpected.json" 2> "$OUTPUT_DIR/08f-wrong-target-rejected.txt"; then
  echo 'wrong cleanup target was unexpectedly accepted' >&2
  exit 1
fi

if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$CLEANUP_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-wrong-batch --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08f2-wrong-confirm-batch-unexpected.json" 2> "$OUTPUT_DIR/08f2-wrong-confirm-batch-rejected.txt"; then
  echo 'wrong confirmed cleanup batch was unexpectedly accepted' >&2
  exit 1
fi

if run_tool cleanup --manifest="$MANIFEST" --environment=production \
  --cleanup-authorization="$CLEANUP_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08f3-wrong-environment-unexpected.json" 2> "$OUTPUT_DIR/08f3-wrong-environment-rejected.txt"; then
  echo 'wrong cleanup environment was unexpectedly accepted' >&2
  exit 1
fi

WRONG_REALM_AUTHORIZATION="$TEMP_DIR/wrong-realm-cleanup-authorization.json"
node - "$CLEANUP_AUTHORIZATION" "$WRONG_REALM_AUTHORIZATION" <<'NODE'
const fs = require('fs');
const [input, output] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(input));
value.target_realm = 'production';
fs.writeFileSync(output, JSON.stringify(value, null, 2));
NODE
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$WRONG_REALM_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08f4-wrong-realm-unexpected.json" 2> "$OUTPUT_DIR/08f4-wrong-realm-rejected.txt"; then
  echo 'wrong cleanup realm was unexpectedly accepted' >&2
  exit 1
fi

WRONG_BATCH_AUTHORIZATION="$TEMP_DIR/wrong-batch-cleanup-authorization.json"
node - "$CLEANUP_AUTHORIZATION" "$WRONG_BATCH_AUTHORIZATION" <<'NODE'
const fs = require('fs');
const [input, output] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(input));
value.batch_id = 'o88-wrong-batch';
fs.writeFileSync(output, JSON.stringify(value, null, 2));
NODE
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$WRONG_BATCH_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08f5-wrong-authorization-batch-unexpected.json" 2> "$OUTPUT_DIR/08f5-wrong-authorization-batch-rejected.txt"; then
  echo 'wrong cleanup authorization batch was unexpectedly accepted' >&2
  exit 1
fi

EXPIRED_CLEANUP_AUTHORIZATION="$TEMP_DIR/expired-cleanup-authorization.json"
node - "$CLEANUP_AUTHORIZATION" "$EXPIRED_CLEANUP_AUTHORIZATION" <<'NODE'
const fs = require('fs');
const [input, output] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(input));
value.cleanup_approval_expires_at = '2000-01-01T00:00:00.000Z';
fs.writeFileSync(output, JSON.stringify(value, null, 2));
NODE
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$EXPIRED_CLEANUP_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08g-expired-cleanup-grant-unexpected.json" 2> "$OUTPUT_DIR/08g-expired-cleanup-grant-rejected.txt"; then
  echo 'expired cleanup grant was unexpectedly accepted' >&2
  exit 1
fi

make_cleanup_variant() {
  local input="$1" output="$2" field="$3" value="$4"
  node - "$input" "$output" "$field" "$value" <<'NODE'
const fs = require('fs');
const [input, output, field, raw] = process.argv.slice(2);
const value = JSON.parse(fs.readFileSync(input));
value[field] = JSON.parse(raw);
fs.writeFileSync(output, JSON.stringify(value, null, 2));
NODE
}

WRONG_COHORT_AUTHORIZATION="$TEMP_DIR/wrong-cohort-cleanup-authorization.json"
make_cleanup_variant "$CLEANUP_AUTHORIZATION" "$WRONG_COHORT_AUTHORIZATION" reader_ids '["9101","9103"]'
run_tool cleanup-plan --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" --cleanup-authorization="$WRONG_COHORT_AUTHORIZATION" \
  > "$TEMP_DIR/wrong-cohort-plan.json"
WRONG_COHORT_APPROVAL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1])).cleanup_owner_approval)" "$TEMP_DIR/wrong-cohort-plan.json")"
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$WRONG_COHORT_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$WRONG_COHORT_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08h-wrong-cohort-unexpected.json" 2> "$OUTPUT_DIR/08h-wrong-cohort-rejected.txt"; then
  echo 'wrong cleanup cohort was unexpectedly accepted' >&2
  exit 1
fi

WRONG_AUTHOR_AUTHORIZATION="$TEMP_DIR/wrong-author-cleanup-authorization.json"
make_cleanup_variant "$CLEANUP_AUTHORIZATION" "$WRONG_AUTHOR_AUTHORIZATION" public_author_ids '["9201","9203"]'
run_tool cleanup-plan --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" --cleanup-authorization="$WRONG_AUTHOR_AUTHORIZATION" \
  > "$TEMP_DIR/wrong-author-plan.json"
WRONG_AUTHOR_APPROVAL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1])).cleanup_owner_approval)" "$TEMP_DIR/wrong-author-plan.json")"
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$WRONG_AUTHOR_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$WRONG_AUTHOR_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08h2-wrong-author-unexpected.json" 2> "$OUTPUT_DIR/08h2-wrong-author-rejected.txt"; then
  echo 'wrong cleanup author cohort was unexpectedly accepted' >&2
  exit 1
fi

WRONG_ACTIVATION_AUTHORIZATION="$TEMP_DIR/wrong-activation-cleanup-authorization.json"
make_cleanup_variant "$CLEANUP_AUTHORIZATION" "$WRONG_ACTIVATION_AUTHORIZATION" \
  expected_activation_approval '"o88-shanghai-encounter-20261020:0000000000000000000000000000000000000000000000000000000000000000"'
run_tool cleanup-plan --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" --cleanup-authorization="$WRONG_ACTIVATION_AUTHORIZATION" \
  > "$TEMP_DIR/wrong-activation-plan.json"
WRONG_ACTIVATION_APPROVAL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1])).cleanup_owner_approval)" "$TEMP_DIR/wrong-activation-plan.json")"
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$WRONG_ACTIVATION_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$WRONG_ACTIVATION_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08i-wrong-activation-unexpected.json" 2> "$OUTPUT_DIR/08i-wrong-activation-rejected.txt"; then
  echo 'wrong original activation approval was unexpectedly accepted' >&2
  exit 1
fi

WRONG_MANIFEST="$TEMP_DIR/wrong-manifest.json"
cp "$MANIFEST" "$WRONG_MANIFEST"
printf '\n' >> "$WRONG_MANIFEST"
WRONG_MANIFEST_SHA="$(node -e "const fs=require('fs'),c=require('crypto');process.stdout.write(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "$WRONG_MANIFEST")"
WRONG_MANIFEST_AUTHORIZATION="$TEMP_DIR/wrong-manifest-cleanup-authorization.json"
make_cleanup_variant "$CLEANUP_AUTHORIZATION" "$WRONG_MANIFEST_AUTHORIZATION" manifest_sha256 "\"${WRONG_MANIFEST_SHA}\""
run_tool cleanup-plan --manifest="$WRONG_MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" --cleanup-authorization="$WRONG_MANIFEST_AUTHORIZATION" \
  > "$TEMP_DIR/wrong-manifest-plan.json"
WRONG_MANIFEST_APPROVAL="$(node -e "process.stdout.write(JSON.parse(require('fs').readFileSync(process.argv[1])).cleanup_owner_approval)" "$TEMP_DIR/wrong-manifest-plan.json")"
if run_tool cleanup --manifest="$WRONG_MANIFEST" --environment=isolated \
  --cleanup-authorization="$WRONG_MANIFEST_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$WRONG_MANIFEST_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08j-wrong-manifest-unexpected.json" 2> "$OUTPUT_DIR/08j-wrong-manifest-rejected.txt"; then
  echo 'wrong cleanup manifest was unexpectedly accepted' >&2
  exit 1
fi

ORIGINAL_FIXTURE_AUDIENCE="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
  "SELECT audience FROM ${DB_NAME}.cairn_qa_fixtures WHERE fixture_key='O88-JK-P01'")"
WRONG_FIXTURE_AUDIENCE="friends"
if [ "$ORIGINAL_FIXTURE_AUDIENCE" = "friends" ]; then WRONG_FIXTURE_AUDIENCE="public"; fi
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "UPDATE cairn_qa_fixtures SET audience='${WRONG_FIXTURE_AUDIENCE}' WHERE fixture_key='O88-JK-P01';" >/dev/null
if run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$CLEANUP_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 \
  > "$OUTPUT_DIR/08k-wrong-object-unexpected.json" 2> "$OUTPUT_DIR/08k-wrong-object-rejected.txt"; then
  echo 'wrong cleanup object was unexpectedly accepted' >&2
  exit 1
fi
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "UPDATE cairn_qa_fixtures SET audience='${ORIGINAL_FIXTURE_AUDIENCE}' WHERE fixture_key='O88-JK-P01';" >/dev/null
# Model a partial prior cleanup without inventing a new fixture identity: remove
# one exact fixture marker while retaining its batch row. The FK sets marker_id
# to NULL, so the authorized cleanup must safely finish only the remaining rows.
PARTIAL_CLEANUP_MARKER_ID="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
  "SELECT marker_id FROM ${DB_NAME}.cairn_qa_fixtures WHERE fixture_key='O88-WD-F01'")"
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "DELETE event FROM cairn_acquisition_events event
     JOIN cairn_acquisitions acquisition ON acquisition.id=event.acquisition_id
    WHERE acquisition.marker_id=${PARTIAL_CLEANUP_MARKER_ID};
   DELETE FROM cairn_acquisitions WHERE marker_id=${PARTIAL_CLEANUP_MARKER_ID};
   DELETE FROM cairn_revisions WHERE marker_id=${PARTIAL_CLEANUP_MARKER_ID};
   DELETE FROM cairn_review_cases WHERE marker_id=${PARTIAL_CLEANUP_MARKER_ID};
   DELETE FROM cairn_collections WHERE marker_id=${PARTIAL_CLEANUP_MARKER_ID};
   DELETE FROM marker_audience_epochs WHERE marker_id=${PARTIAL_CLEANUP_MARKER_ID};
   DELETE FROM markers WHERE id=${PARTIAL_CLEANUP_MARKER_ID};" >/dev/null
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
  "SELECT JSON_OBJECT(
     'fixtureRows',(SELECT COUNT(*) FROM ${DB_NAME}.cairn_qa_fixtures WHERE fixture_key='O88-WD-F01'),
     'nullMarkerReferences',(SELECT COUNT(*) FROM ${DB_NAME}.cairn_qa_fixtures WHERE fixture_key='O88-WD-F01' AND marker_id IS NULL),
     'deletedMarkerRows',(SELECT COUNT(*) FROM ${DB_NAME}.markers WHERE id=${PARTIAL_CLEANUP_MARKER_ID}))" \
  > "$OUTPUT_DIR/08e-partial-cleanup-state.json"
run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$CLEANUP_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 > "$OUTPUT_DIR/09-cleanup.json"
run_tool cleanup --manifest="$MANIFEST" --environment=isolated \
  --cleanup-authorization="$CLEANUP_AUTHORIZATION" --target-allowlist="$TARGET_ALLOWLIST" \
  --cleanup-owner-approval="$CLEANUP_OWNER_APPROVAL" \
  --confirm-batch=o88-shanghai-encounter-20261020 --confirm-target="$TARGET" \
  --confirm-cleanup=o88-shanghai-encounter-20261020 > "$OUTPUT_DIR/09a-cleanup-idempotent.json"
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
  "USE ${DB_NAME}; SELECT JSON_OBJECT(
    'mixedGroup', (SELECT COUNT(*) FROM cairn_presentation_groups WHERE group_token='88888888-8888-4888-8888-888888888881'),
    'mixedEvents', (SELECT COUNT(*) FROM cairn_acquisition_events event JOIN cairn_presentation_groups presentation ON presentation.id=event.presentation_group_id WHERE presentation.group_token='88888888-8888-4888-8888-888888888881'),
    'mixedNotification', (SELECT COUNT(*) FROM notification_log WHERE dedupe_key='o88-mixed-probe'),
    'fixtureOnlyGroup', (SELECT COUNT(*) FROM cairn_presentation_groups WHERE group_token='88888888-8888-4888-8888-888888888882'),
    'fixtureOnlyNotification', (SELECT COUNT(*) FROM notification_log WHERE dedupe_key='o88-fixture-probe'),
    'ordinaryMarkers', (SELECT COUNT(*) FROM markers WHERE text='Ordinary non-fixture Cairn'),
    'fixtureAcquisitions', (SELECT COUNT(*) FROM cairn_acquisitions WHERE marker_id IN (${FIXTURE_MARKER_IDS})),
    'fixtureRevisions', (SELECT COUNT(*) FROM cairn_revisions WHERE marker_id IN (${FIXTURE_MARKER_IDS}))
  );" 2>/dev/null > "$OUTPUT_DIR/09b-cleanup-isolation.json"
run_tool verify --manifest="$MANIFEST" --environment=isolated \
  --target-allowlist="$TARGET_ALLOWLIST" \
  --confirm-target="$TARGET" > "$OUTPUT_DIR/10-verify-cleaned.json"

node - "$OUTPUT_DIR" "$CLEANUP_BATCH_MODE" "$EXPECTED_BATCH_STATE" "$EXPECTED_BATCH_EXPIRED" <<'NODE'
const fs = require('fs');
const path = require('path');
const [dir, cleanupBatchMode, expectedBatchState, expectedBatchExpiredRaw] = process.argv.slice(2);
const expectedBatchExpired = expectedBatchExpiredRaw === 'true';
const read = name => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const plan = read('01-plan.json');
const inspected = read('02-inspect-target.json');
const approval = read('03-approval-plan.json');
const cleanupPlan = read('03b-cleanup-plan.json');
const applied = read('04-apply.json');
const reapplied = read('04b-exact-reapply.json');
const active = read('05-verify-active.json');
const recovered = read('07-partial-recovery.json');
const advanced = read('08-advance-revision.json');
const cleanup = read('09-cleanup.json');
const cleanupAgain = read('09a-cleanup-idempotent.json');
const expiredBatch = read('08c-expired-batch-before-cleanup.json');
const partialCleanup = read('08e-partial-cleanup-state.json');
const cleanupIsolation = read('09b-cleanup-isolation.json');
const cleaned = read('10-verify-cleaned.json');
const activeLive = active.counts.reduce((sum, row) => sum + Number(row.live_markers || 0), 0);
const cleanedLive = cleaned.counts.reduce((sum, row) => sum + Number(row.live_markers || 0), 0);
const checks = {
  plan_is_read_only: plan.writePerformed === false && plan.totals.fixtures === 60,
  actual_target_inspected_read_only: inspected.writePerformed === false && Boolean(inspected.serverUuid),
  approval_plan_read_only: approval.writePerformed === false && Boolean(approval.owner_approval),
  cleanup_plan_is_separate_and_read_only: cleanupPlan.writePerformed === false
    && Boolean(cleanupPlan.cleanup_owner_approval)
    && !('owner_approval' in cleanupPlan),
  applied_exactly_60: applied.applied === true && applied.rows === 60,
  exact_reapply_is_idempotent: reapplied.applied === true && reapplied.rows === 60,
  active_manifest_and_rows: active.exactManifest === true && active.batch?.state === 'active' && activeLive === 60,
  changed_cohort_rejected: fs.readFileSync(path.join(dir, '06-cohort-expansion-rejected.txt'), 'utf8').includes('do not match'),
  exact_partial_recovery: recovered.applied === true && recovered.rows === 60,
  advanced_exactly_2: advanced.advanced?.length === 2,
  expired_batch_cannot_reactivate: expectedBatchExpired
    ? fs.readFileSync(path.join(dir, '08d-expired-reapply-rejected.txt'), 'utf8').includes('exact active approval plan')
    : fs.readFileSync(path.join(dir, '08d-expired-reapply-rejected.txt'), 'utf8').includes('not applicable'),
  wrong_target_rejected: fs.readFileSync(path.join(dir, '08f-wrong-target-rejected.txt'), 'utf8').includes('Exact --confirm-target'),
  wrong_confirmed_batch_rejected: fs.readFileSync(path.join(dir, '08f2-wrong-confirm-batch-rejected.txt'), 'utf8').includes('exact batch id twice'),
  wrong_environment_rejected: fs.readFileSync(path.join(dir, '08f3-wrong-environment-rejected.txt'), 'utf8').includes('does not match approved realm'),
  wrong_realm_rejected: fs.readFileSync(path.join(dir, '08f4-wrong-realm-rejected.txt'), 'utf8').includes('does not bind the connected approved target'),
  wrong_authorization_batch_rejected: fs.readFileSync(path.join(dir, '08f5-wrong-authorization-batch-rejected.txt'), 'utf8').includes('does not bind this exact batch'),
  expired_cleanup_grant_rejected: fs.readFileSync(path.join(dir, '08g-expired-cleanup-grant-rejected.txt'), 'utf8').includes('has expired'),
  wrong_cohort_rejected: fs.readFileSync(path.join(dir, '08h-wrong-cohort-rejected.txt'), 'utf8').includes('reader cohort'),
  wrong_author_cohort_rejected: fs.readFileSync(path.join(dir, '08h2-wrong-author-rejected.txt'), 'utf8').includes('unrelated fixture'),
  wrong_original_activation_rejected: fs.readFileSync(path.join(dir, '08i-wrong-activation-rejected.txt'), 'utf8').includes('cleanup-only authorization'),
  wrong_manifest_rejected: fs.readFileSync(path.join(dir, '08j-wrong-manifest-rejected.txt'), 'utf8').includes('cleanup-only authorization'),
  wrong_object_rejected: fs.readFileSync(path.join(dir, '08k-wrong-object-rejected.txt'), 'utf8').includes('unrelated fixture'),
  partial_cleanup_state_is_exact: partialCleanup.fixtureRows === 1
    && partialCleanup.nullMarkerReferences === 1 && partialCleanup.deletedMarkerRows === 0,
  requested_batch_state_cleanup_authorized_separately: expiredBatch.batchExpired === expectedBatchExpired
    && expiredBatch.state === expectedBatchState
    && cleanup.deletedMarkers === 59 && cleanup.cleanedMarkerReferences === 59,
  cleanup_retry_is_idempotent: cleanupAgain.alreadyCleaned === true
    && cleanupAgain.deletedMarkers === 0 && cleanupAgain.cleanedMarkerReferences === 0,
  mixed_group_cleanup_isolated: cleanupIsolation.mixedGroup === 1
    && cleanupIsolation.mixedEvents === 1 && cleanupIsolation.mixedNotification === 1
    && cleanupIsolation.fixtureOnlyGroup === 0 && cleanupIsolation.fixtureOnlyNotification === 0
    && cleanupIsolation.ordinaryMarkers === 1 && cleanupIsolation.fixtureAcquisitions === 0
    && cleanupIsolation.fixtureRevisions === 0,
  cleaned_has_no_live_markers: cleaned.batch?.state === 'cleaned' && cleanedLive === 0,
};
const summary = {
  schema: 'cairnnz.o88-shanghai-rehearsal.v2',
  cleanupBatchMode,
  observedBatchBeforeCleanup: expiredBatch,
  checks,
  passed: Object.values(checks).every(Boolean),
};
fs.writeFileSync(path.join(dir, 'SUMMARY.json'), JSON.stringify(summary, null, 2));
if (!summary.passed) throw new Error(JSON.stringify(summary));
process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
NODE

echo "Evidence: $OUTPUT_DIR"
