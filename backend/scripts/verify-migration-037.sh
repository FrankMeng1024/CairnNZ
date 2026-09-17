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

require_one() {
  local label="$1"
  local query="$2"
  local actual
  actual="$(mysql_value "$query")"
  if [ "$actual" != "1" ]; then
    echo "037 verify failed: $label (expected 1, got ${actual:-empty})" >&2
    exit 1
  fi
}

for column in evidence_source source_activity_client_id horizontal_accuracy_m continuity_state; do
  require_one "memory_points.$column" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='memory_points' AND column_name='$column'"
done

for table in friendship_episodes memory_share_policies memory_share_grants memory_private_places marker_audience_epochs route_audience_epochs friend_cairn_encounters shared_route_leases; do
  require_one "$table table" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='$table' AND engine='InnoDB'"
done

require_one "memory evidence index" "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_points' AND index_name='idx_memory_share_evidence'"
require_one "active friendship uniqueness" "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='friendship_episodes' AND index_name='uk_friendship_active_pair' AND non_unique=0"
require_one "active grant uniqueness" "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_share_grants' AND index_name='uk_memory_grant_active' AND non_unique=0"

require_one "marker audience backfill" "SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM markers m LEFT JOIN marker_audience_epochs a ON a.marker_id=m.id AND a.audience_epoch=m.audience_epoch WHERE a.marker_id IS NULL"
require_one "route audience backfill" "SELECT CASE WHEN COUNT(*)=0 THEN 1 ELSE 0 END FROM routes r LEFT JOIN route_audience_epochs a ON a.route_id=r.id AND a.audience_epoch=r.audience_epoch WHERE a.route_id IS NULL"

echo "037 postconditions verified"
