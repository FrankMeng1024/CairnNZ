#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

OUT_DIR=
DATABASE=
FULL=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --out) OUT_DIR="${2:?missing --out value}"; shift 2 ;;
    --database) DATABASE="${2:?missing --database value}"; shift 2 ;;
    --full) FULL=1; shift ;;
    *) die "usage: db-manifest.sh --out DIR [--database NAME] [--full]" ;;
  esac
done

load_env
DATABASE="${DATABASE:-$DB_NAME}"
[[ "$DATABASE" =~ ^[A-Za-z0-9_]+$ ]] || die "invalid database name"
[[ -n "$OUT_DIR" ]] || die "--out is required"
require_command mysql
require_command mysqldump
require_command python3
admin_password="${DB_ADMIN_PASSWORD:-$MYSQL_ROOT_PASSWORD}"
admin_host="${DB_ADMIN_HOST:-127.0.0.1}"
admin_port="${DB_ADMIN_PORT:-3307}"
admin_user="${DB_ADMIN_USER:-root}"

mkdir -p "$OUT_DIR"
chmod 0700 "$OUT_DIR"

mysql_q() {
  MYSQL_PWD="$admin_password" mysql --batch --skip-column-names \
    -h"$admin_host" -P"$admin_port" -u"$admin_user" "$DATABASE" -e "$1" </dev/null
}

MYSQL_PWD="$admin_password" mysqldump -h"$admin_host" -P"$admin_port" -u"$admin_user" \
  --no-data --skip-comments --compact --set-gtid-purged=OFF "$DATABASE" >"$OUT_DIR/schema.sql"
: >"$OUT_DIR/schema-canonical.tsv"
mysql_q "SELECT 'TABLE',TABLE_NAME,ENGINE,TABLE_COLLATION FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' ORDER BY TABLE_NAME;" >>"$OUT_DIR/schema-canonical.tsv"
mysql_q "SELECT 'COLUMN',TABLE_NAME,ORDINAL_POSITION,COLUMN_NAME,COLUMN_TYPE,IS_NULLABLE,COALESCE(COLUMN_DEFAULT,'<NULL>'),EXTRA,COALESCE(CHARACTER_SET_NAME,'<NULL>'),COALESCE(COLLATION_NAME,'<NULL>') FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,ORDINAL_POSITION;" >>"$OUT_DIR/schema-canonical.tsv"
mysql_q "SELECT 'INDEX',TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX,COLUMN_NAME,COALESCE(SUB_PART,'<NULL>'),NON_UNIQUE,INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;" >>"$OUT_DIR/schema-canonical.tsv"
mysql_q "SELECT 'FK',k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION,k.COLUMN_NAME,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE k.CONSTRAINT_SCHEMA=DATABASE() AND k.REFERENCED_TABLE_NAME IS NOT NULL ORDER BY k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION;" >>"$OUT_DIR/schema-canonical.tsv"
sha256_file "$OUT_DIR/schema-canonical.tsv" >"$OUT_DIR/schema.sha256"

: >"$OUT_DIR/table-counts.tsv"
while IFS= read -r table; do
  [[ -n "$table" ]] || continue
  escaped="${table//\`/\`\`}"
  count="$(mysql_q "SELECT COUNT(*) FROM \`$escaped\`;")"
  printf '%s\t%s\n' "$table" "$count" >>"$OUT_DIR/table-counts.tsv"
done < <(mysql_q "SELECT table_name FROM information_schema.tables WHERE table_schema=DATABASE() AND table_type='BASE TABLE' ORDER BY table_name;")

: >"$OUT_DIR/fk-orphans.tsv"
mysql_q "SELECT CONSTRAINT_NAME,TABLE_NAME,COLUMN_NAME,REFERENCED_TABLE_NAME,REFERENCED_COLUMN_NAME,ORDINAL_POSITION
  FROM information_schema.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
  ORDER BY TABLE_NAME,CONSTRAINT_NAME,ORDINAL_POSITION;" >"$OUT_DIR/fk-metadata.tsv"
python3 - "$OUT_DIR/fk-metadata.tsv" "$OUT_DIR/fk-queries.tsv" <<'PY'
import collections, re, sys
source, target = sys.argv[1:]
groups = collections.OrderedDict()
with open(source, encoding="utf-8") as handle:
    for line in handle:
        constraint, child, child_col, parent, parent_col, ordinal = line.rstrip("\n").split("\t")
        for value in (constraint, child, child_col, parent, parent_col):
            if not re.fullmatch(r"[A-Za-z0-9_$]+", value):
                raise SystemExit(f"unsafe SQL identifier in FK metadata: {value!r}")
        groups.setdefault((constraint, child, parent), []).append((int(ordinal), child_col, parent_col))
with open(target, "w", encoding="utf-8") as handle:
    for (constraint, child, parent), columns in groups.items():
        columns.sort()
        joins = " AND ".join(f"c.`{cc}`=p.`{pc}`" for _, cc, pc in columns)
        present = " OR ".join(f"c.`{cc}` IS NOT NULL" for _, cc, _ in columns)
        parent_probe = columns[0][2]
        query = f"SELECT COUNT(*) FROM `{child}` c LEFT JOIN `{parent}` p ON {joins} WHERE ({present}) AND p.`{parent_probe}` IS NULL;"
        handle.write(f"{constraint}\t{child}\t{query}\n")
PY
fk_sql="$(cat "$OUT_DIR/fk-queries.tsv")"
while IFS=$'\t' read -r constraint child query; do
  [[ -n "$constraint" ]] || continue
  orphan_count="$(mysql_q "$query")"
  printf '%s\t%s\t%s\n' "$constraint" "$child" "$orphan_count" >>"$OUT_DIR/fk-orphans.tsv"
done <<<"$fk_sql"

if [[ "$FULL" == 1 ]]; then
  : >"$OUT_DIR/table-content-sha256.tsv"
  while IFS= read -r table; do
    [[ -n "$table" ]] || continue
    [[ "$table" =~ ^[A-Za-z0-9_$]+$ ]] || die "unsafe table identifier: $table"
    if command -v sha256sum >/dev/null 2>&1; then
      content_hash="$(MYSQL_PWD="$admin_password" mysqldump -h"$admin_host" -P"$admin_port" -u"$admin_user" \
        --no-create-info --skip-comments --compact --skip-extended-insert --order-by-primary \
        --hex-blob --set-gtid-purged=OFF "$DATABASE" "$table" | sha256sum | awk '{print $1}')"
    else
      content_hash="$(MYSQL_PWD="$admin_password" mysqldump -h"$admin_host" -P"$admin_port" -u"$admin_user" \
        --no-create-info --skip-comments --compact --skip-extended-insert --order-by-primary \
        --hex-blob --set-gtid-purged=OFF "$DATABASE" "$table" | shasum -a 256 | awk '{print $1}')"
    fi
    printf '%s\t%s\n' "$table" "$content_hash" >>"$OUT_DIR/table-content-sha256.tsv"
  done < <(cut -f1 "$OUT_DIR/table-counts.tsv")
fi

ledger="UNKNOWN"
if [[ -f "${MIGRATION_LEDGER_FILE:-}" ]]; then ledger="$(tr -d '[:space:]' <"$MIGRATION_LEDGER_FILE")"; fi
git_sha="${BACKEND_GIT_SHA:-UNKNOWN}"
python3 - "$OUT_DIR/metadata.json" "$(timestamp)" "$DATABASE" "$git_sha" "$ledger" "$(mysql_q 'SELECT VERSION();')" "$FULL" <<'PY'
import json, sys
path, generated_at, database, git_sha, ledger, version, full = sys.argv[1:]
with open(path, "w", encoding="utf-8") as handle:
    json.dump({"generated_at": generated_at, "database": database, "git_sha": git_sha,
               "migration_ledger": ledger, "mysql_version": version,
               "full_checksums": full == "1"}, handle, indent=2, sort_keys=True)
    handle.write("\n")
PY

if awk -F '\t' '$3 != 0 {bad=1} END {exit bad}' "$OUT_DIR/fk-orphans.tsv"; then :; else
  die "foreign-key orphan rows detected; inspect $OUT_DIR/fk-orphans.tsv"
fi
log "DB MANIFEST PASS: $OUT_DIR"
