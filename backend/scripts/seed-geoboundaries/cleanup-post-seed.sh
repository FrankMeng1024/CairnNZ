#!/usr/bin/env bash
# cleanup-post-seed.sh — v428 入库后清理
#
# 用户要求 "该留留该删删",服务器 + 本地都要清干净。
# 只在 SQL 已成功入 aliyun MySQL + 5 城市 point-in-polygon 抽查全过之后运行。
#
# 保留 (决策记录 + 生成脚本):
#   backend/scripts/seed-geoboundaries/*.js
#   backend/scripts/seed-geoboundaries/*.py
#   backend/scripts/seed-geoboundaries/deploy-seed.sh
#   _review/v428-plan/*.md
#   _review/v428-plan/*.json
#
# 删除 (临时下载 + 中间产物):
#   backend/scripts/seed-geoboundaries/tmp/*        (188MB 4 源原始 GeoJSON)
#   backend/scripts/seed-geoboundaries/regions-v428.sql  (162MB 生成 SQL)
#   backend/scripts/seed-geoboundaries/regions-v428.sql.gz  (若还在)
#   backend/scripts/seed-geoboundaries/audit-output.txt
#
# Aliyun 上也清:
#   /tmp/regions-v428.sql
#   /tmp/regions-v428.sql.gz
#   ainews-db 容器内 /tmp/regions-v428.sql
#
# Usage: bash backend/scripts/seed-geoboundaries/cleanup-post-seed.sh

set -euo pipefail

DIR="$(dirname "$0")"

echo "=== v428 post-seed cleanup ==="
echo ""

# Compute local size before
BEFORE=$(du -sm "$DIR" 2>/dev/null | cut -f1)
echo "Local dir size before: ${BEFORE}M"

# Delete local tmp/ (source data files)
if [[ -d "$DIR/tmp" ]]; then
  echo "Removing $DIR/tmp/ ($(du -sh "$DIR/tmp" | cut -f1))..."
  rm -rf "$DIR/tmp"
fi

# Delete generated SQL
for f in regions-v428.sql regions-v428.sql.gz audit-output.txt; do
  if [[ -f "$DIR/$f" ]]; then
    echo "Removing $DIR/$f ($(du -sh "$DIR/$f" | cut -f1))..."
    rm -f "$DIR/$f"
  fi
done

# Aliyun cleanup (already done by deploy-seed.sh, but idempotent redo just in case)
SSH_HOST="root@122.51.174.118"
if command -v ssh >/dev/null 2>&1; then
  echo ""
  echo "Cleaning aliyun /tmp..."
  ssh -o ConnectTimeout=10 "$SSH_HOST" "rm -f /tmp/regions-v428.sql /tmp/regions-v428.sql.gz && docker exec ainews-db rm -f /tmp/regions-v428.sql 2>/dev/null || true" || echo "  (SSH cleanup failed, non-fatal)"
fi

# Size after
AFTER=$(du -sm "$DIR" 2>/dev/null | cut -f1)
echo ""
echo "Local dir size after: ${AFTER}M (saved $((BEFORE - AFTER))M)"
echo ""
echo "=== kept files ==="
ls -lh "$DIR"/*.js "$DIR"/*.py "$DIR"/*.sh 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
echo ""
echo "=== v428 cleanup complete ==="
