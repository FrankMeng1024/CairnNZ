#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

load_env
require_env DEPLOY_ROOT DB_NAME MYSQL_ROOT_PASSWORD
require_command mysql
ledger_file="${MIGRATION_LEDGER_FILE:-$DEPLOY_ROOT/state/migrations_applied}"
[[ -f "$ledger_file" ]] || die "migration ledger is absent; restore a production backup and its ledger instead of replaying historical migrations"
last="$(tr -d '[:space:]' <"$ledger_file")"
[[ "$last" =~ ^[0-9]{3}$ ]] || die "invalid migration ledger: $last"

source_root="${SOURCE_ROOT:-$DEPLOY_ROOT/source}"
[[ -d "$source_root/backend/src/migrations" ]] || source_root="$REPO_ROOT"
migrations="$source_root/backend/src/migrations"
runner="$source_root/docker/run-pending-migrations.sh"
[[ -x "$runner" ]] || die "migration runner missing or not executable: $runner"

pending_file="$(mktemp)"
trap 'rm -f "$pending_file"' EXIT
find "$migrations" -maxdepth 1 -type f -name '[0-9]*.sql' -print | sort | while read -r path; do
  num="$(basename "$path" | sed -E 's/^([0-9]+).*/\1/')"
  (( 10#$num > 10#$last )) && printf '%s\n' "$path"
done >"$pending_file"
if [[ ! -s "$pending_file" ]]; then log "MIGRATION PASS: no migrations newer than ledger $last"; exit 0; fi

duplicates="$(xargs -n1 basename <"$pending_file" | sed -E 's/^([0-9]+).*/\1/' | sort | uniq -d)"
[[ -z "$duplicates" ]] || die "duplicate pending migration numbers: $duplicates"
[[ -f "${MIGRATION_BACKUP_BUNDLE:-}/backup.json" ]] || die "a fresh verified MIGRATION_BACKUP_BUNDLE is required before applying pending migrations"

destructive=0
while IFS= read -r path; do
  if grep -qiE '^\s*(DROP\s+TABLE|TRUNCATE\s+TABLE)|^\s*DELETE\s+FROM\s+[^;]+;' "$path"; then
    destructive=1
    hash="$(sha256_file "$path")"
    [[ "${ALLOW_REVIEWED_DESTRUCTIVE:-}" == YES && -f "${MIGRATION_REVIEW_FILE:-}" ]] || die "destructive pending migration requires separate reviewed approval: $(basename "$path")"
    grep -Fq "$hash  $(basename "$path")" "$MIGRATION_REVIEW_FILE" || die "review manifest hash mismatch for $(basename "$path")"
  fi
done <"$pending_file"

acquire_lock database-operation
export REPO_ROOT="$source_root" LAST_APPLIED_FILE="$ledger_file"
export DB_HOST="${DB_ADMIN_HOST:-127.0.0.1}" DB_PORT="${DB_ADMIN_PORT:-3307}" DB_USER="${DB_ADMIN_USER:-root}"
export DB_PASSWORD="${DB_ADMIN_PASSWORD:-$MYSQL_ROOT_PASSWORD}" DB_NAME
[[ "$destructive" == 1 ]] && export MIGRATION_ALLOW_DESTRUCTIVE=1
"$runner"
log "MIGRATION PASS: ledger advanced only after runner/verifier success"
