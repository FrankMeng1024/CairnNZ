#!/bin/bash
# backup_mock_data.sh — Friend System v1 / Sprint 67 / STORY-00527
#
# Dumps every row that touches a @cairn.demo account.
# Output: backend/scripts/seed/backups/mock-YYYYMMDD_HHMMSS.sql
#
# What gets dumped:
#   - users WHERE email LIKE '%@cairn.demo'
#   - sessions/markers/routes WHERE user_id IN (mock ids)
#   - friends WHERE user_id IN (mock ids) OR friend_id IN (mock ids)
#   - memory_subscriptions WHERE user_id IN (mock ids) OR friend_id IN (mock ids)
#   - hidden_items WHERE user_id IN (mock ids)
#
# This script NEVER reads user_id=4 (9163). It scopes by email LIKE filter only.
#
# Usage:
#   bash backend/scripts/seed/backup_mock_data.sh
#
# Notes:
#   - Runs against the aliyun MySQL container (ainews-db) via SSH.
#   - Requires SSH key access to root@122.51.174.118 (already configured).
#   - Idempotent: each call writes a new timestamped snapshot.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="$SCRIPT_DIR/backups"
mkdir -p "$BACKUP_DIR"

STAMP="$(date +%Y%m%d_%H%M%S)"
OUT="$BACKUP_DIR/mock-$STAMP.sql"

SSH="ssh root@122.51.174.118"
DB="cairn"
CONTAINER="ainews-db"
MYSQL_CMD="mysql -uroot -p\$MYSQL_ROOT_PASSWORD $DB"
MYSQLDUMP_CMD="mysqldump -uroot -p\$MYSQL_ROOT_PASSWORD $DB"

# Collect mock user ids (comma separated)
MOCK_IDS=$($SSH "docker exec $CONTAINER sh -c '$MYSQL_CMD -N -e \"SELECT GROUP_CONCAT(id) FROM users WHERE email LIKE \\\"%@cairn.demo\\\";\"'" | tr -d '\r')

if [[ -z "$MOCK_IDS" || "$MOCK_IDS" == "NULL" ]]; then
  echo "[backup_mock_data] No mock users found — nothing to dump."
  exit 0
fi

echo "[backup_mock_data] Mock user ids: $MOCK_IDS"
echo "[backup_mock_data] Writing $OUT ..."

{
  echo "-- Mock data backup $STAMP"
  echo "-- Mock user ids: $MOCK_IDS"
  echo "USE $DB;"

  $SSH "docker exec $CONTAINER sh -c '$MYSQLDUMP_CMD --skip-add-drop-table --no-create-info --complete-insert users --where=\"email LIKE \\\"%@cairn.demo\\\"\"'"

  for TABLE in sessions markers routes hidden_items; do
    $SSH "docker exec $CONTAINER sh -c '$MYSQLDUMP_CMD --skip-add-drop-table --no-create-info --complete-insert $TABLE --where=\"user_id IN ($MOCK_IDS)\"'"
  done

  for TABLE in friends memory_subscriptions; do
    $SSH "docker exec $CONTAINER sh -c '$MYSQLDUMP_CMD --skip-add-drop-table --no-create-info --complete-insert $TABLE --where=\"user_id IN ($MOCK_IDS) OR friend_id IN ($MOCK_IDS)\"'"
  done
} > "$OUT"

SIZE=$(wc -c < "$OUT")
echo "[backup_mock_data] Done. $OUT ($SIZE bytes)"
