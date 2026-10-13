#!/usr/bin/env bash
set -euo pipefail

DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

query() {
  if command -v mysql >/dev/null 2>&1; then
    MYSQL_PWD="$DB_PASSWORD" mysql --batch --skip-column-names \
      -h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME" -e "$1"
  elif [ -n "${MYSQL_DOCKER_CONTAINER:-}" ]; then
    docker exec -e MYSQL_PWD="$DB_PASSWORD" "$MYSQL_DOCKER_CONTAINER" \
      mysql --batch --skip-column-names -u"$DB_USER" "$DB_NAME" -e "$1"
  else
    echo "mysql client unavailable" >&2
    return 127
  fi
}

fail() {
  echo "045 verify failed: $1" >&2
  exit 1
}

expected_tables="$(printf '%s\n' \
  cairn_acquisition_events \
  cairn_acquisitions \
  cairn_collections \
  cairn_local_visit_acquisitions \
  cairn_local_visits \
  cairn_presentation_groups \
  cairn_review_audit \
  cairn_review_cases \
  cairn_revisions \
  cairn_source_moderation \
  memory_projection_preferences)"
actual_tables="$(query "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name IN ('cairn_acquisition_events','cairn_acquisitions','cairn_collections','cairn_local_visit_acquisitions','cairn_local_visits','cairn_presentation_groups','cairn_review_audit','cairn_review_cases','cairn_revisions','cairn_source_moderation','memory_projection_preferences') ORDER BY table_name" || true)"
[ "$actual_tables" = "$expected_tables" ] || fail "one or more Memory/Cairn contract tables are missing"

column_contract="$(query "SELECT CONCAT(table_name,'.',column_name,'|',column_type,'|',is_nullable) FROM information_schema.columns WHERE table_schema=DATABASE() AND ((table_name='markers' AND column_name='content_changed_at') OR (table_name='memory_points' AND column_name='received_at') OR (table_name='memory_share_grants' AND column_name IN ('coverage_scope','consent_version')) OR (table_name='friend_requests' AND column_name IN ('requester_memory_share','accepter_memory_share'))) ORDER BY table_name,column_name" || true)"
expected_column_contract="$(printf '%s\n' \
  'friend_requests.accepter_memory_share|tinyint(1)|NO' \
  'friend_requests.requester_memory_share|tinyint(1)|NO' \
  'markers.content_changed_at|datetime(3)|NO' \
  'memory_points.received_at|datetime(3)|NO' \
  "memory_share_grants.consent_version|smallint unsigned|NO" \
  "memory_share_grants.coverage_scope|enum('legacy_activity_since_grant','full_history_delayed_v1')|NO")"
[ "$column_contract" = "$expected_column_contract" ] || fail "added-column contract mismatch"

friend_delay_index="$(query "SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='memory_points' AND index_name='idx_memory_friend_delay' GROUP BY index_name" || true)"
[ "$friend_delay_index" = "user_id,evidence_source,continuity_state,received_at,ts" ] || fail "friend-delay index mismatch"

new_trigger="$(query "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name='trg_memory_subscription_friend' AND event_object_table='memory_subscriptions' AND action_timing='BEFORE' AND event_manipulation='INSERT'" || true)"
[ "$new_trigger" = "1" ] || fail "friend-pair trigger missing"
old_trigger="$(query "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema=DATABASE() AND trigger_name='trg_memory_subscription_cap'" || true)"
[ "$old_trigger" = "0" ] || fail "obsolete subscription-cap trigger still exists"

unique_contracts="$(query "SELECT COUNT(DISTINCT CONCAT(table_name,':',index_name)) FROM information_schema.statistics WHERE table_schema=DATABASE() AND non_unique=0 AND CONCAT(table_name,':',index_name) IN ('cairn_revisions:uk_cairn_revision_source','cairn_acquisitions:uk_cairn_acquisition_revision','cairn_acquisitions:uk_cairn_acquisition_logical_revision','cairn_local_visits:uk_cairn_local_visit_token','cairn_local_visit_acquisitions:uk_cairn_visit_acquisition','cairn_local_visit_acquisitions:uk_cairn_visit_marker','cairn_presentation_groups:uk_cairn_presentation_group_token','cairn_acquisition_events:uk_cairn_acquisition_event','cairn_review_cases:uk_cairn_case_client','cairn_review_cases:uk_cairn_case_revision_type')" || true)"
[ "$unique_contracts" = "10" ] || fail "idempotency/revision unique-key contract incomplete"

null_frontiers="$(query "SELECT (SELECT COUNT(*) FROM markers WHERE content_changed_at IS NULL) + (SELECT COUNT(*) FROM memory_points WHERE received_at IS NULL)" || true)"
[ "$null_frontiers" = "0" ] || fail "content/receipt frontier backfill incomplete"

echo "045 postconditions verified"
