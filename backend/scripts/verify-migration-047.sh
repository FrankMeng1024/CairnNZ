#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

query() {
  # The disposable review harness exports the exact container identity. Prefer
  # querying inside it so a host client cannot silently fall back to a local
  # Unix socket on Docker Desktop.
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

fail() { echo "047 verify failed: $1" >&2; exit 1; }

status_type="$(query "SELECT column_type FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='friend_requests' AND column_name='status'" || true)"
[ "$status_type" = "enum('pending','accepted','rejected','cancelled','blocked')" ] || fail "status enum mismatch"

columns="$(query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='friend_requests' AND column_name IN ('sender_dismissed_at','pair_key','active_pair_slot')" || true)"
[ "$columns" = "3" ] || fail "lifecycle columns incomplete"

active_unique="$(query "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='friend_requests' AND index_name='uk_friend_requests_active_pair' AND non_unique=0" || true)"
[ "$active_unique" = "2" ] || fail "active-pair unique key missing"

triggers="$(query "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND event_object_table='friend_requests' AND trigger_name IN ('trg_friend_requests_o84_insert','trg_friend_requests_o84_update')" || true)"
[ "$triggers" = "2" ] || fail "pair-invariant triggers missing"

legacy_unique="$(query "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='friend_requests' AND index_name='unique_request'" || true)"
[ "$legacy_unique" = "0" ] || fail "legacy directional unique key still present"

duplicate_active="$(query "SELECT COUNT(*) FROM (SELECT pair_key,COUNT(*) n FROM friend_requests WHERE status='pending' GROUP BY pair_key HAVING n>1) d" || true)"
[ "$duplicate_active" = "0" ] || fail "duplicate active pair exists"

echo "047 postconditions verified"
