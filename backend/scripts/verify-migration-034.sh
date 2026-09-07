#!/usr/bin/env bash
set -euo pipefail

# Verify every durable postcondition of migration 034. This script is safe to
# run repeatedly and performs SELECT-only information_schema/data checks.
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
    echo "034 verify failed: $label (expected 1, got ${actual:-empty})" >&2
    exit 1
  fi
}

require_zero() {
  local label="$1"
  local query="$2"
  local actual
  actual="$(mysql_value "$query")"
  if [ "$actual" != "0" ]; then
    echo "034 verify failed: $label (expected 0, got ${actual:-empty})" >&2
    exit 1
  fi
}

require_one "sessions.client_activity_id" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sessions' AND column_name='client_activity_id' AND column_type='char(36)' AND is_nullable='YES'"
require_one "sessions.abandoned_at" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sessions' AND column_name='abandoned_at' AND data_type='datetime' AND is_nullable='YES'"
require_one "sessions.abandon_reason" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sessions' AND column_name='abandon_reason' AND column_type='varchar(64)' AND is_nullable='YES'"
require_one "sessions.active_slot generated" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sessions' AND column_name='active_slot' AND column_type='tinyint' AND extra LIKE '%STORED GENERATED%' AND generation_expression LIKE '%finalized_at%' AND generation_expression LIKE '%abandoned_at%' AND generation_expression LIKE '%end_time%' AND generation_expression NOT LIKE '%distance_m%' AND generation_expression NOT LIKE '%duration_s%'"

require_one "unique Activity business identity" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='sessions' AND index_name='uk_sessions_user_client_activity' AND non_unique=0 GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)=\"user_id,client_activity_id\") AS verified"
require_one "unique unfinished slot" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='sessions' AND index_name='uk_sessions_user_active_slot' AND non_unique=0 GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)=\"user_id,active_slot\") AS verified"
require_zero "multiple underlying unfinished Activities" "SELECT COUNT(*) FROM (SELECT user_id FROM sessions WHERE finalized_at IS NULL AND abandoned_at IS NULL AND end_time=start_time GROUP BY user_id HAVING COUNT(*)>1) AS duplicates"
require_zero "active_slot expression mismatch" "SELECT COUNT(*) FROM sessions WHERE NOT (active_slot <=> IF(finalized_at IS NULL AND abandoned_at IS NULL AND end_time=start_time, 1, NULL))"

require_one "activity tombstone table" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='activity_client_tombstones' AND engine='InnoDB'"
require_one "marker tombstone table" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='marker_client_tombstones' AND engine='InnoDB'"
require_one "activity tombstone identity shape" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='activity_client_tombstones' AND column_name='client_activity_id' AND column_type='char(36)' AND is_nullable='NO' AND character_set_name='utf8mb4' AND collation_name='utf8mb4_unicode_ci'"
require_one "marker tombstone identity shape" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='marker_client_tombstones' AND column_name='client_cairn_id' AND column_type='char(36)' AND is_nullable='NO' AND character_set_name='utf8mb4' AND collation_name='utf8mb4_unicode_ci'"
require_one "activity tombstone composite primary key" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='activity_client_tombstones' AND index_name='PRIMARY' GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='user_id,client_activity_id' AND COUNT(*)=2) expected"
require_one "marker tombstone composite primary key" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='marker_client_tombstones' AND index_name='PRIMARY' GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)='user_id,client_cairn_id' AND COUNT(*)=2) expected"
require_one "activity tombstone user FK" "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='activity_client_tombstones' AND constraint_name='fk_activity_tombstone_user' AND delete_rule='CASCADE'"
require_one "marker tombstone user FK" "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='marker_client_tombstones' AND constraint_name='fk_marker_tombstone_user' AND delete_rule='CASCADE'"

require_one "markers.client_cairn_id" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='markers' AND column_name='client_cairn_id' AND column_type='char(36)' AND is_nullable='YES'"
require_one "markers.origin_activity_client_id" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='markers' AND column_name='origin_activity_client_id' AND column_type='char(36)' AND is_nullable='YES'"
require_one "markers.origin_session_id" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='markers' AND column_name='origin_session_id' AND column_type='bigint unsigned' AND is_nullable='YES'"
require_one "unique Cairn business identity" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='markers' AND index_name='uk_markers_user_client_cairn' AND non_unique=0 GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)=\"user_id,client_cairn_id\") AS verified"
require_one "Cairn Activity provenance index" "SELECT COUNT(*) FROM (SELECT index_name FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='markers' AND index_name='idx_markers_origin_activity' GROUP BY index_name HAVING GROUP_CONCAT(column_name ORDER BY seq_in_index)=\"user_id,origin_activity_client_id\") AS verified"
require_one "Cairn origin FK" "SELECT COUNT(*) FROM information_schema.referential_constraints WHERE constraint_schema=DATABASE() AND table_name='markers' AND constraint_name='fk_markers_origin_session' AND delete_rule='SET NULL'"

echo "034 postconditions verified"
