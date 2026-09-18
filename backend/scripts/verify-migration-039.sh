#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

mysql_value() {
  MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
    -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
}

for column in start_acknowledged_at end_acknowledged_at terminal_reason; do
  actual="$(mysql_value "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='shared_route_leases' AND column_name='$column'")"
  if [ "$actual" != "1" ]; then
    echo "039 verify failed: shared_route_leases.$column (expected 1, got ${actual:-empty})" >&2
    exit 1
  fi
done

echo "039 postconditions verified"
