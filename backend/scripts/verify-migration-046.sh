#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

query() {
  if command -v mysql >/dev/null 2>&1; then
    MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
      -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
  elif [ -n "${MYSQL_DOCKER_CONTAINER:-}" ]; then
    docker exec -e MYSQL_PWD="$DB_PASSWORD" "$MYSQL_DOCKER_CONTAINER" \
      mysql --batch --skip-column-names -u"$DB_USER" "$DB_NAME" -e "$1"
  else
    echo "mysql client unavailable" >&2
    return 127
  fi
}

fail() {
  echo "046 verify failed: $1" >&2
  exit 1
}

route_columns="$(query "SELECT CONCAT(column_name,'|',column_type,'|',is_nullable,IFNULL(CONCAT('|',column_default),'')) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name IN ('ordered_draft','resolution_state') ORDER BY ordinal_position" || true)"
expected_route_columns="$(printf '%s\n' \
  'ordered_draft|json|YES' \
  "resolution_state|enum('continuous','unresolved_gaps')|NO|continuous")"
[ "$route_columns" = "$expected_route_columns" ] || fail "Route ordered-draft columns mismatch"

delivery_table="$(query "SELECT CONCAT(engine,'|',table_collation) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='shared_route_deliveries'" || true)"
[ "$delivery_table" = "InnoDB|utf8mb4_unicode_ci" ] || fail "shared-route delivery table missing or storage contract mismatch"

delivery_columns="$(query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='shared_route_deliveries' AND column_name IN ('id','sender_id','recipient_id','source_route_id','source_route_key','source_content_revision','content_hash','idempotency_key','route_snapshot','delivered_at','removed_at')" || true)"
[ "$delivery_columns" = "11" ] || fail "shared-route delivery columns incomplete"

unique_contracts="$(query "SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='shared_route_deliveries' AND non_unique=0 AND index_name IN ('PRIMARY','uk_route_delivery_content','uk_route_delivery_attempt')" || true)"
[ "$unique_contracts" = "3" ] || fail "delivery idempotency keys incomplete"

foreign_keys="$(query "SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='shared_route_deliveries' AND referenced_table_name IS NOT NULL AND column_name IN ('sender_id','recipient_id','source_route_id')" || true)"
[ "$foreign_keys" = "3" ] || fail "delivery ownership/source foreign keys incomplete"

check_constraint="$(query "SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema=DATABASE() AND table_name='shared_route_deliveries' AND constraint_name='chk_route_delivery_distinct' AND constraint_type='CHECK'" || true)"
[ "$check_constraint" = "1" ] || fail "sender/recipient distinctness check missing"

legacy_state="$(query "SELECT COUNT(*) FROM routes WHERE ordered_draft IS NOT NULL OR resolution_state <> 'continuous'" || true)"
[ "$legacy_state" = "0" ] || fail "legacy Route rows were unexpectedly rewritten"

echo "046 postconditions verified"
