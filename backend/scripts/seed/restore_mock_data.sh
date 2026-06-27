#!/bin/bash
# restore_mock_data.sh — Friend System v1 / Sprint 67 / STORY-00527
#
# Loads the LATEST snapshot from backend/scripts/seed/backups/ back into
# the aliyun MySQL. Use after clear_mock_data.sql wiped current mock rows.
#
# Usage:
#   bash backend/scripts/seed/restore_mock_data.sh                    # latest
#   bash backend/scripts/seed/restore_mock_data.sh path/to/file.sql   # explicit
#
# Safety: this script does NOT delete anything before loading. It relies on
# INSERT IGNORE semantics in the dump. If the target table already has
# conflicting rows, run clear_mock_data.sql first.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/backups"

if [[ -n "$1" ]]; then
  SRC="$1"
else
  SRC=$(ls -t "$BACKUP_DIR"/mock-*.sql 2>/dev/null | head -1)
fi

if [[ -z "$SRC" || ! -f "$SRC" ]]; then
  echo "[restore_mock_data] No backup file found in $BACKUP_DIR. Aborting."
  exit 1
fi

echo "[restore_mock_data] Loading $SRC into aliyun MySQL ..."

ssh root@122.51.174.118 "docker exec -i ainews-db sh -c 'mysql -uroot -p\$MYSQL_ROOT_PASSWORD cairn'" < "$SRC"

echo "[restore_mock_data] Done."
