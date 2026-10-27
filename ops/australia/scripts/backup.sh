#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

FULL_MANIFEST=0
[[ "${1:-}" == --full-manifest ]] && { FULL_MANIFEST=1; shift; }
[[ $# -eq 0 ]] || die "usage: backup.sh [--full-manifest]"
load_env
require_env DEPLOY_ROOT DB_NAME MYSQL_ROOT_PASSWORD
require_command mysqldump
require_command gzip
require_command python3
[[ "$FULL_MANIFEST" != 1 || "${SOURCE_WRITES_FROZEN:-0}" == 1 ]] || die "--full-manifest requires a verified write freeze"
acquire_lock database-operation

admin_password="${DB_ADMIN_PASSWORD:-$MYSQL_ROOT_PASSWORD}"
admin_host="${DB_ADMIN_HOST:-127.0.0.1}"
admin_port="${DB_ADMIN_PORT:-3307}"
admin_user="${DB_ADMIN_USER:-root}"
stamp="$(date -u +'%Y%m%dT%H%M%SZ')"
backup_root="${BACKUP_DIR:-$DEPLOY_ROOT/backups}"
bundle="$backup_root/$stamp"
mkdir -p "$bundle"
chmod 0700 "$bundle"
dump="$bundle/${DB_NAME}.sql.gz"

log "creating consistent logical backup in $bundle"
MYSQL_PWD="$admin_password" mysqldump -h"$admin_host" -P"$admin_port" -u"$admin_user" \
  --single-transaction --quick --routines --triggers --events --hex-blob \
  --set-gtid-purged=OFF --source-data=2 "$DB_NAME" | gzip -9 >"$dump.partial"
gzip -t "$dump.partial"
mv "$dump.partial" "$dump"
printf '%s  %s\n' "$(sha256_file "$dump")" "$(basename "$dump")" >"$dump.sha256"

manifest_args=(--out "$bundle/db-manifest" --database "$DB_NAME")
[[ "$FULL_MANIFEST" == 1 ]] && manifest_args+=(--full)
"$SCRIPT_DIR/db-manifest.sh" "${manifest_args[@]}"

if [[ -f "${MIGRATION_LEDGER_FILE:-}" ]]; then
  install -m 0600 "$MIGRATION_LEDGER_FILE" "$bundle/migrations_applied"
else
  warn "migration ledger not found; backup cannot qualify for cutover until ledger identity is supplied"
fi

if [[ -d "${EXPORT_DIR_HOST:-$DEPLOY_ROOT/exports}" ]]; then
  tar -C "${EXPORT_DIR_HOST:-$DEPLOY_ROOT/exports}" -czf "$bundle/exports.tar.gz" .
  printf '%s  %s\n' "$(sha256_file "$bundle/exports.tar.gz")" exports.tar.gz >"$bundle/exports.tar.gz.sha256"
fi

python3 - "$bundle/backup.json" "$(timestamp)" "${BACKEND_GIT_SHA:-UNKNOWN}" "$(sha256_file "$dump")" "$DB_NAME" <<'PY'
import json, sys
path, created_at, git_sha, dump_sha, database = sys.argv[1:]
with open(path, "w", encoding="utf-8") as handle:
    json.dump({"created_at": created_at, "git_sha": git_sha, "database": database,
               "dump_sha256": dump_sha, "consistent_dump": "single-transaction",
               "includes_routines": True, "includes_triggers": True, "includes_events": True},
              handle, indent=2, sort_keys=True)
    handle.write("\n")
PY

if [[ -n "${BACKUP_REMOTE:-}" ]]; then
  require_command rclone
  remote_path="${BACKUP_REMOTE}:${BACKUP_REMOTE_PREFIX:-cairn-au}/$stamp"
  run rclone copy "$bundle" "$remote_path" --immutable
  run rclone check "$bundle" "$remote_path" --one-way
fi

find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime "+${BACKUP_RETENTION_DAYS:-14}" -print >"$bundle/retention-candidates.txt"
if [[ "${BACKUP_PRUNE_APPROVED:-0}" == 1 ]]; then
  [[ -n "${BACKUP_REMOTE:-}" ]] || die "local pruning requires a configured remote backup destination"
  python3 - "$backup_root" "$bundle/retention-candidates.txt" <<'PY'
import pathlib, re, shutil, sys
root = pathlib.Path(sys.argv[1]).resolve()
for line in pathlib.Path(sys.argv[2]).read_text(encoding="utf-8").splitlines():
    candidate = pathlib.Path(line).resolve()
    if candidate.parent != root or not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", candidate.name):
        raise SystemExit(f"unsafe retention candidate: {candidate}")
    if not (candidate / "backup.json").is_file():
        raise SystemExit(f"candidate lacks backup manifest: {candidate}")
    shutil.rmtree(candidate)
PY
fi
log "BACKUP PASS: $bundle"
