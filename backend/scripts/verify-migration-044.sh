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

table_count="$(query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='public_cairn_moderation_audit'" || true)"
[ "$table_count" = "1" ] || { echo "044 verify failed: audit table missing" >&2; exit 1; }

policy_column="$(query "SELECT CONCAT(column_type,'|',is_nullable,'|',character_set_name,'|',collation_name) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='public_cairn_publications' AND column_name='snapshot_location_policy_version'" || true)"
[ "$policy_column" = "varchar(128)|YES|ascii|ascii_bin" ] || {
  echo "044 verify failed: publication policy-version column mismatch" >&2
  exit 1
}

encounter_evidence_columns="$(query "SELECT CONCAT(column_name,'|',column_type,'|',is_nullable) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='public_cairn_encounters' AND column_name IN ('evidence_lat','evidence_lng','evidence_observed_at_ms','evidence_segment_id','evidence_source','evidence_horizontal_accuracy_m') ORDER BY ordinal_position" || true)"
expected_encounter_evidence_columns="$(printf '%s\n' \
  'evidence_lat|double|YES' \
  'evidence_lng|double|YES' \
  'evidence_observed_at_ms|bigint unsigned|YES' \
  'evidence_segment_id|varchar(80)|YES' \
  'evidence_source|varchar(32)|YES' \
  'evidence_horizontal_accuracy_m|double|YES')"
[ "$encounter_evidence_columns" = "$expected_encounter_evidence_columns" ] || {
  echo "044 verify failed: immutable encounter evidence columns mismatch" >&2
  exit 1
}

engine="$(query "SELECT engine FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='public_cairn_moderation_audit'" || true)"
[ "$engine" = "InnoDB" ] || { echo "044 verify failed: audit table must use InnoDB" >&2; exit 1; }

collation="$(query "SELECT table_collation FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='public_cairn_moderation_audit'" || true)"
[ "$collation" = "utf8mb4_unicode_ci" ] || { echo "044 verify failed: audit table collation mismatch" >&2; exit 1; }

actual_columns="$(query "SELECT CONCAT(column_name,'|',column_type,'|',is_nullable,'|',extra) FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='public_cairn_moderation_audit' ORDER BY ordinal_position" || true)"
expected_columns="$(printf '%s\n' \
  'id|bigint unsigned|NO|auto_increment' \
  'event_type|varchar(48)|NO|' \
  'actor_user_id|bigint unsigned|YES|' \
  'owner_user_id|bigint unsigned|YES|' \
  'marker_id|bigint unsigned|YES|' \
  'publication_id|bigint unsigned|YES|' \
  'report_id|bigint unsigned|YES|' \
  'publication_epoch|bigint unsigned|YES|' \
  'content_revision|bigint unsigned|YES|' \
  'from_state|varchar(32)|YES|' \
  'to_state|varchar(32)|YES|' \
  'reason|varchar(240)|YES|' \
  'metadata_json|json|YES|' \
  'created_at|datetime(3)|NO|DEFAULT_GENERATED')"
[ "$actual_columns" = "$expected_columns" ] || {
  echo "044 verify failed: column contract mismatch" >&2
  diff -u <(printf '%s\n' "$expected_columns") <(printf '%s\n' "$actual_columns") >&2 || true
  exit 1
}

primary_key="$(query "SELECT GROUP_CONCAT(column_name ORDER BY seq_in_index) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='public_cairn_moderation_audit' AND index_name='PRIMARY' GROUP BY index_name" || true)"
[ "$primary_key" = "id" ] || { echo "044 verify failed: primary key must be id" >&2; exit 1; }

actual_indexes="$(query "SELECT CONCAT(index_name,':',GROUP_CONCAT(column_name ORDER BY seq_in_index)) FROM information_schema.statistics WHERE table_schema=DATABASE() AND table_name='public_cairn_moderation_audit' AND index_name<>'PRIMARY' GROUP BY index_name ORDER BY index_name" || true)"
expected_indexes="$(printf '%s\n' \
  'fk_public_audit_actor:actor_user_id' \
  'idx_public_audit_created:created_at,id' \
  'idx_public_audit_marker:marker_id,id' \
  'idx_public_audit_publication:publication_id,id' \
  'idx_public_audit_report:report_id,id')"
[ "$actual_indexes" = "$expected_indexes" ] || { echo "044 verify failed: index contract mismatch" >&2; exit 1; }

subject_fk_count="$(query "SELECT COUNT(*) FROM information_schema.key_column_usage WHERE table_schema=DATABASE() AND table_name='public_cairn_moderation_audit' AND referenced_table_name IS NOT NULL AND column_name IN ('owner_user_id','marker_id','publication_id','report_id')" || true)"
[ "$subject_fk_count" = "0" ] || { echo "044 verify failed: Public subject IDs must not have foreign keys" >&2; exit 1; }

actor_rule="$(query "SELECT CONCAT(kcu.referenced_table_name,':',rc.delete_rule) FROM information_schema.referential_constraints rc JOIN information_schema.key_column_usage kcu ON kcu.constraint_schema=rc.constraint_schema AND kcu.constraint_name=rc.constraint_name WHERE kcu.table_schema=DATABASE() AND kcu.table_name='public_cairn_moderation_audit' AND kcu.column_name='actor_user_id' LIMIT 1" || true)"
[ "$actor_rule" = "users:SET NULL" ] || { echo "044 verify failed: actor FK must retain audit via ON DELETE SET NULL" >&2; exit 1; }

echo "044 postconditions verified"
