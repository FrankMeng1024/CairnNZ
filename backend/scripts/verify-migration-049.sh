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
  else
    MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
      --protocol=TCP -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
  fi
}

[ "$(query "SELECT COUNT(*) FROM memory_share_policies WHERE enabled=1")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_share_grants WHERE status='active' AND coverage_scope='legacy_activity_since_grant'")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM memory_subscriptions subscription WHERE EXISTS (SELECT 1 FROM memory_share_grants legacy WHERE legacy.owner_id=subscription.friend_id AND legacy.viewer_id=subscription.user_id AND legacy.status='revoked' AND legacy.revoked_reason='legacy_contract_retired') AND NOT EXISTS (SELECT 1 FROM memory_share_grants current_grant WHERE current_grant.owner_id=subscription.friend_id AND current_grant.viewer_id=subscription.user_id AND current_grant.status='active' AND current_grant.revoked_at IS NULL AND current_grant.coverage_scope='full_history_delayed_v1')")" = "0" ]
[ "$(query "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$DB_NAME' AND TABLE_NAME='memory_share_grants' AND COLUMN_NAME='revoked_reason' AND COLUMN_TYPE LIKE '%legacy_contract_retired%'")" = "1" ]
echo "049 postconditions verified"
