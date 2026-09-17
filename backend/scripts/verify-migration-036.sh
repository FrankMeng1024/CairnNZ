#!/usr/bin/env bash
set -euo pipefail

# SELECT-only verification for migration 036. The deployment runner uses this
# to record an already-complete migration and to recover safely after MySQL's
# non-transactional DDL partially applied on a previous invocation.
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

mysql_value() {
  MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
    -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
}

require_one() {
  local label="$1"
  local query="$2"
  local actual
  actual="$(mysql_value "$query")"
  if [ "$actual" != "1" ]; then
    echo "036 verify failed: $label (expected 1, got ${actual:-empty})" >&2
    exit 1
  fi
}

require_one "routes.client_route_id" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='client_route_id' AND column_type='char(36)' AND is_nullable='YES'"
require_one "routes.creation_origin" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='creation_origin' AND column_type=\"enum('activity','manual')\" AND is_nullable='YES'"
require_one "routes.source_activity_client_id" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='source_activity_client_id' AND column_type='char(36)' AND is_nullable='YES'"
require_one "routes.source_session_id" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='source_session_id' AND column_type='bigint unsigned' AND is_nullable='YES'"
require_one "routes.origin_geometry_hash" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='origin_geometry_hash' AND column_type='char(64)' AND is_nullable='YES'"
require_one "routes.created_geometry_hash" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='created_geometry_hash' AND column_type='char(64)' AND is_nullable='YES'"
require_one "routes.geometry edit flag" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='geometry_edited_since_creation' AND column_type='tinyint(1)' AND is_nullable='NO' AND column_default='0'"
require_one "routes Gap reconnect flag" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='routes' AND column_name='origin_gap_reconnected' AND column_type='tinyint(1)' AND is_nullable='NO' AND column_default='0'"

require_one "unique owner/client Route identity" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='routes' AND index_name='uk_routes_user_client_route' AND non_unique=0 GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='user_id,client_route_id') verified"
require_one "Route Activity provenance index" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='routes' AND index_name='idx_routes_source_activity' GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='user_id,source_activity_client_id') verified"
require_one "Route source FK" "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='routes' AND constraint_name='fk_routes_source_session' AND delete_rule='SET NULL'"

require_one "Route tombstone table" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='route_client_tombstones' AND engine='InnoDB'"
require_one "Route tombstone composite primary key" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='route_client_tombstones' AND index_name='PRIMARY' GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='user_id,client_route_id' AND COUNT(*)=2) expected"
require_one "Route tombstone user FK" "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='route_client_tombstones' AND constraint_name='fk_route_tombstone_user' AND delete_rule='CASCADE'"

echo "036 postconditions verified"
