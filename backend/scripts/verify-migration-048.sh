#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

query() {
  if [ -n "${MYSQL_DOCKER_CONTAINER:-}" ]; then
    docker exec -e MYSQL_PWD="$DB_PASSWORD" "$MYSQL_DOCKER_CONTAINER" \
      mysql --batch --skip-column-names -u"$DB_USER" "$DB_NAME" -e "$1"
  elif command -v mysql >/dev/null 2>&1; then
    MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
      --protocol=TCP -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
  else
    echo "mysql client unavailable" >&2
    return 127
  fi
}

fail() { echo "048 verify failed: $1" >&2; exit 1; }

table_contract="$(query "SELECT CONCAT(engine,'|',table_collation) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='memory_activity_backfill_audit'" || true)"
[ "$table_contract" = "InnoDB|utf8mb4_unicode_ci" ] || fail "backfill audit table missing"

columns="$(query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='memory_activity_backfill_audit' AND column_name IN ('session_id','user_id','backfill_version','decision','strategy','reason','original_source_provenance','input_route_points','input_raw_points','recovered_points','upgraded_points','inserted_points','evidence_sha256','applied_at')" || true)"
[ "$columns" = "14" ] || fail "backfill audit columns incomplete"

foreign_keys="$(query "SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='memory_activity_backfill_audit' AND referenced_table_name IS NOT NULL AND column_name IN ('session_id','user_id')" || true)"
[ "$foreign_keys" = "2" ] || fail "backfill audit ownership constraints missing"

active_private_places="$(query "SELECT COUNT(*) FROM memory_private_places WHERE active=1" || true)"
[ "$active_private_places" = "0" ] || fail "obsolete protected places remain active"

echo "048 postconditions verified"
