#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

DUMP=
DATABASE=
LEDGER=
EXPORTS=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dump) DUMP="${2:?}"; shift 2 ;;
    --database) DATABASE="${2:?}"; shift 2 ;;
    --ledger) LEDGER="${2:?}"; shift 2 ;;
    --exports) EXPORTS="${2:?}"; shift 2 ;;
    *) die "usage: restore.sh --dump FILE.sql.gz [--database NAME] [--ledger FILE] [--exports FILE.tar.gz]" ;;
  esac
done
load_env
require_env MYSQL_ROOT_PASSWORD DB_NAME DEPLOY_ROOT
require_command mysql
require_command gzip
require_command python3
DATABASE="${DATABASE:-$DB_NAME}"
[[ "$DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || die "invalid database name"
[[ -f "$DUMP" && -f "$DUMP.sha256" ]] || die "dump and adjacent .sha256 file are required"
acquire_lock database-operation

expected="$(awk '{print $1}' "$DUMP.sha256")"
actual="$(sha256_file "$DUMP")"
[[ "$expected" == "$actual" ]] || die "dump checksum mismatch"
gzip -t "$DUMP"

admin_password="${DB_ADMIN_PASSWORD:-$MYSQL_ROOT_PASSWORD}"
admin_host="${DB_ADMIN_HOST:-127.0.0.1}"
admin_port="${DB_ADMIN_PORT:-3307}"
admin_user="${DB_ADMIN_USER:-root}"
mysql_admin=(mysql -h"$admin_host" -P"$admin_port" -u"$admin_user")
MYSQL_PWD="$admin_password" "${mysql_admin[@]}" -e "CREATE DATABASE IF NOT EXISTS \`$DATABASE\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
table_count="$(MYSQL_PWD="$admin_password" "${mysql_admin[@]}" -Nse "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$DATABASE';")"
[[ "$table_count" == 0 ]] || die "target database $DATABASE is not empty ($table_count tables); refusing overwrite"

log "restoring verified dump into empty database $DATABASE"
gunzip -c "$DUMP" | MYSQL_PWD="$admin_password" "${mysql_admin[@]}" "$DATABASE"

if [[ -n "$LEDGER" ]]; then
  [[ -f "$LEDGER" ]] || die "ledger file not found: $LEDGER"
  [[ "$(tr -d '[:space:]' <"$LEDGER")" =~ ^[0-9]{3}$ ]] || die "invalid migration ledger"
  install -m 0600 "$LEDGER" "${MIGRATION_LEDGER_FILE:-$DEPLOY_ROOT/state/migrations_applied}"
fi

if [[ -n "$EXPORTS" ]]; then
  [[ -f "$EXPORTS" && -f "$EXPORTS.sha256" ]] || die "exports archive and checksum are required"
  [[ "$(sha256_file "$EXPORTS")" == "$(awk '{print $1}' "$EXPORTS.sha256")" ]] || die "exports checksum mismatch"
  export_target="${EXPORT_DIR_HOST:-$DEPLOY_ROOT/exports}"
  [[ -z "$(find "$export_target" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]] || die "export target is not empty"
  tar -C "$export_target" -xzf "$EXPORTS"
fi
mkdir -p "$DEPLOY_ROOT/state"
python3 - "$DEPLOY_ROOT/state/last_restore.json" "$(timestamp)" "$DATABASE" "$actual" "$DUMP" <<'PY'
import json, sys
path, restored_at, database, sha256, source = sys.argv[1:]
with open(path, "w", encoding="utf-8") as handle:
    json.dump({"restored_at": restored_at, "database": database,
               "dump_sha256": sha256, "source_basename": source.rsplit("/", 1)[-1]},
              handle, indent=2, sort_keys=True)
    handle.write("\n")
PY
log "RESTORE PASS: dump verified and restored into previously empty database $DATABASE"
