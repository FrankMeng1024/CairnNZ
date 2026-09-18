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
    echo "038 verify failed: $label (expected 1, got ${actual:-empty})" >&2
    exit 1
  fi
}

require_one "presence witness table" "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='memory_presence_witnesses' AND engine='InnoDB'"
require_one "presence identity uniqueness" "SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_presence_witnesses' AND index_name='uk_presence_user_client' AND non_unique=0"
require_one "presence encounter index" "SELECT COUNT(DISTINCT index_name) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_presence_witnesses' AND index_name='idx_presence_encounter'"
require_one "encounter evidence kind" "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='friend_cairn_encounters' AND column_name='evidence_kind'"
require_one "presence Activity identity collation" "SELECT COUNT(*) FROM information_schema.columns witness JOIN information_schema.columns session ON session.table_schema=witness.table_schema AND session.table_name='sessions' AND session.column_name='client_activity_id' AND session.collation_name=witness.collation_name WHERE witness.table_schema=DATABASE() AND witness.table_name='memory_presence_witnesses' AND witness.column_name='source_activity_client_id'"

echo "038 postconditions verified"
