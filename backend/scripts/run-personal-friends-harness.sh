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

stable_mysql_checks=0
for attempt in $(seq 1 60); do
  if docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse 'SELECT 1' >/dev/null 2>&1; then
    stable_mysql_checks=$((stable_mysql_checks + 1))
    if [ "$stable_mysql_checks" -ge 2 ]; then break; fi
  else
    stable_mysql_checks=0
  fi
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
  044_public_cairn_moderation_audit.sql \
  045_memory_friends_cairn_contract.sql \
  046_ordered_routes_and_deliveries.sql \
  047_friend_request_lifecycle.sql \
  048_friends_memory_history_repair.sql; do
  docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/$migration" >/dev/null
done

# Exercise 049 against populated legacy and current contracts. Empty-schema
# application cannot prove its enum value, selective subscription cleanup, or
# preservation of valid full-history subscriptions.
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e "
  INSERT INTO users (id,name,email) VALUES
    (990001,'Migration owner','migration-owner@example.invalid'),
    (990002,'Legacy viewer','migration-legacy@example.invalid'),
    (990003,'Current viewer','migration-current@example.invalid');
  INSERT INTO friends (user_id,friend_id,created_at) VALUES
    (990001,990002,UTC_TIMESTAMP(3)),(990002,990001,UTC_TIMESTAMP(3)),
    (990001,990003,UTC_TIMESTAMP(3)),(990003,990001,UTC_TIMESTAMP(3));
  INSERT INTO friendship_episodes (episode_id,user_low_id,user_high_id,started_at) VALUES
    (UUID(),990001,990002,UTC_TIMESTAMP(3)),(UUID(),990001,990003,UTC_TIMESTAMP(3));
  INSERT INTO memory_share_policies (owner_id,enabled,enabled_at) VALUES
    (990001,1,UTC_TIMESTAMP(3));
  INSERT INTO memory_share_grants
    (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,coverage_scope,consent_version)
  SELECT 990001,990002,id,UUID(),UTC_TIMESTAMP(3),'legacy_activity_since_grant',0
    FROM friendship_episodes WHERE user_low_id=990001 AND user_high_id=990002;
  INSERT INTO memory_share_grants
    (owner_id,viewer_id,friendship_episode_id,grant_epoch,effective_at,coverage_scope,consent_version)
  SELECT 990001,990003,id,UUID(),UTC_TIMESTAMP(3),'full_history_delayed_v1',1
    FROM friendship_episodes WHERE user_low_id=990001 AND user_high_id=990003;
  INSERT INTO memory_subscriptions (user_id,friend_id) VALUES (990002,990001),(990003,990001);
" >/dev/null
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/049_retire_legacy_memory_sharing.sql" >/dev/null
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/050_complete_legacy_memory_retirement.sql" >/dev/null
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/051_memory_coverage_read_model.sql" >/dev/null
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/052_cairn_placement_provenance.sql" >/dev/null
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/053_cairn_qa_fixture_cohorts.sql" >/dev/null
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/054_memory_hit_push_explicit_opt_in.sql" >/dev/null
docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" < "$BACKEND_DIR/src/migrations/055_notification_delivery_outbox.sql" >/dev/null
legacy_fixture_state="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse "
  SELECT CONCAT(
    (SELECT COUNT(*) FROM $DB_NAME.memory_share_grants WHERE owner_id=990001 AND viewer_id=990002 AND status='revoked' AND revoked_reason='legacy_contract_retired'), ':',
    (SELECT COUNT(*) FROM $DB_NAME.memory_subscriptions WHERE user_id=990002 AND friend_id=990001), ':',
    (SELECT COUNT(*) FROM $DB_NAME.memory_share_grants WHERE owner_id=990001 AND viewer_id=990003 AND status='active' AND coverage_scope='full_history_delayed_v1'), ':',
    (SELECT COUNT(*) FROM $DB_NAME.memory_subscriptions WHERE user_id=990003 AND friend_id=990001), ':',
    (SELECT enabled FROM $DB_NAME.memory_share_policies WHERE owner_id=990001));
")"
[ "$legacy_fixture_state" = "1:0:1:1:0" ]
echo "049 populated fixture verified: $legacy_fixture_state"
docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" -e \
  "DELETE FROM users WHERE id IN (990001,990002,990003)" >/dev/null

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
export MYSQL_DOCKER_CONTAINER="$CONTAINER"
HARNESS_PROGRAM="${HARNESS_PROGRAM:-$SCRIPT_DIR/personal-friends-harness/abcdn-api-mysql.js}"
if [ -n "${EVIDENCE_DIR:-}" ]; then
  mkdir -p "$EVIDENCE_DIR"
  "$SCRIPT_DIR/verify-migration-047.sh" | tee "$EVIDENCE_DIR/migration-047.txt"
  "$SCRIPT_DIR/verify-migration-048.sh" | tee "$EVIDENCE_DIR/migration-048.txt"
  "$SCRIPT_DIR/verify-migration-049.sh" | tee "$EVIDENCE_DIR/migration-049.txt"
  "$SCRIPT_DIR/verify-migration-050.sh" | tee "$EVIDENCE_DIR/migration-050.txt"
  "$SCRIPT_DIR/verify-migration-051.sh" | tee "$EVIDENCE_DIR/migration-051.txt"
  node "$HARNESS_PROGRAM" | tee "$EVIDENCE_DIR/result.json"
else
  "$SCRIPT_DIR/verify-migration-047.sh"
  "$SCRIPT_DIR/verify-migration-048.sh"
  "$SCRIPT_DIR/verify-migration-049.sh"
  "$SCRIPT_DIR/verify-migration-050.sh"
  "$SCRIPT_DIR/verify-migration-051.sh"
  node "$HARNESS_PROGRAM"
fi

if [ "${HARNESS_REHEARSE_047_ROLLBACK:-0}" = "1" ]; then
  rehearse_047_rollback() {
    local before archive after status lifecycle_columns legacy_unique
    before="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
      "SELECT COUNT(*) FROM $DB_NAME.friend_requests")"
    docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" \
      < "$BACKEND_DIR/src/migrations/rollback/047_friend_request_lifecycle.down.sql" >/dev/null
    archive="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
      "SELECT COUNT(*) FROM $DB_NAME.friend_requests_o84_rollback_archive")"
    after="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
      "SELECT COUNT(*) FROM $DB_NAME.friend_requests")"
    status="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
      "SELECT column_type FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='friend_requests' AND column_name='status'")"
    lifecycle_columns="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
      "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema='$DB_NAME' AND table_name='friend_requests' AND column_name IN ('sender_dismissed_at','pair_key','active_pair_slot')")"
    legacy_unique="$(docker exec "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" -Nse \
      "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema='$DB_NAME' AND table_name='friend_requests' AND index_name='unique_request' AND non_unique=0")"
    [ "$archive" = "$before" ]
    [ "$after" -le "$before" ]
    [ "$status" = "enum('pending','accepted','rejected')" ]
    [ "$lifecycle_columns" = "0" ]
    [ "$legacy_unique" = "2" ]
    echo "047 rollback verified: archived=$archive live_before=$before legacy_live=$after"
    docker exec -i "$CONTAINER" mysql -uroot -p"$DB_PASSWORD" "$DB_NAME" \
      < "$BACKEND_DIR/src/migrations/047_friend_request_lifecycle.sql" >/dev/null
    "$SCRIPT_DIR/verify-migration-047.sh"
    echo "047 forward reapply verified after rollback"
  }
  if [ -n "${EVIDENCE_DIR:-}" ]; then
    rehearse_047_rollback | tee "$EVIDENCE_DIR/migration-047-rollback.txt"
  else
    rehearse_047_rollback
  fi
fi
