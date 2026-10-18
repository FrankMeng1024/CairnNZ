#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD required}"

query() {
  if [ -n "${MYSQL_DOCKER_CONTAINER:-}" ]; then
    docker exec -e MYSQL_PWD="$DB_PASSWORD" "$MYSQL_DOCKER_CONTAINER" \
      mysql --batch --skip-column-names -u"$DB_USER" "$DB_NAME" -e "$1"
  else
    MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
      --protocol=TCP -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
  fi
}

[ "$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('memory_coverage_evidence','memory_coverage_tiles','memory_coverage_source_state','memory_coverage_regions')")" = "4" ]
[ "$(query "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_coverage_evidence' AND index_name='idx_memory_coverage_owner_ready_tile'")" -ge "1" ]
[ "$(query "SELECT COUNT(*) FROM memory_coverage_evidence evidence LEFT JOIN memory_points point ON point.id=evidence.memory_point_id WHERE point.id IS NULL")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_coverage_evidence WHERE coverage_rule_version<>4")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_coverage_regions mapped LEFT JOIN memory_coverage_evidence evidence ON evidence.memory_point_id=mapped.memory_point_id WHERE evidence.memory_point_id IS NULL")" = "0" ]

echo "migration 051 verified"
