#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

actual="$(MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
  -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e \
  "SELECT COUNT(*) FROM (
     SELECT index_name
       FROM information_schema.statistics
      WHERE table_schema=DATABASE()
        AND table_name='markers'
        AND index_name='idx_markers_location'
        AND non_unique=1
      GROUP BY index_name
     HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='lat,lng'
        AND COUNT(*)=2
   ) AS verified")"

if [ "$actual" != "1" ]; then
  echo "043 verify failed: markers.idx_markers_location must be exactly (lat,lng) (expected 1, got ${actual:-empty})" >&2
  exit 1
fi

echo "043 postconditions verified"
