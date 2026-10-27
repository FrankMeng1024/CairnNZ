#!/usr/bin/env bash
set -euo pipefail

: "${DB_HOST:?DB_HOST required}" "${DB_PORT:?DB_PORT required}" "${DB_USER:?DB_USER required}"
: "${DB_PASSWORD:?DB_PASSWORD required}" "${DB_NAME:?DB_NAME required}"

query() {
  if [ -n "${MYSQL_DOCKER_CONTAINER:-}" ]; then
    docker exec -e MYSQL_PWD="$DB_PASSWORD" "$MYSQL_DOCKER_CONTAINER" \
      mysql --batch --skip-column-names -u"$DB_USER" "$DB_NAME" -e "$1"
  else
    MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
      --protocol=TCP -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
  fi
}

[ "$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='memory_subscription_intent_heads'")" = "1" ]
[ "$(query "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='memory_subscription_intent_heads' AND column_name IN ('viewer_id','friend_id','selection_chain_id','selection_sequence','selection_request_id','selected','grant_epoch','friendship_episode_id','authorization_version','coverage_scope')")" = "10" ]
[ "$(query "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_subscription_intent_heads' AND index_name='PRIMARY' AND column_name IN ('viewer_id','friend_id')")" = "2" ]

echo 'migration 058 verified: causal Memory selection head is present'
