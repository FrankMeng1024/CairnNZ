#!/usr/bin/env bash
# deploy-seed.sh — v428 阿里云 seed 一键部署脚本
#
# 用途: 把 regions-v428.sql 上传阿里云 MySQL 8, 完成 spatial index 就绪.
# 前置: 本地已跑 `node seed.js --dry-run` 生成 regions-v428.sql.
#
# 步骤:
#   1. gzip 本地 SQL (300MB → ~30MB)
#   2. scp 到阿里云 /tmp/
#   3. ssh 解压
#   4. docker cp 到 ainews-db 容器
#   5. mysql 执行 (drop + recreate + insert + spatial index build)
#   6. 验证行数 + 抽查 5 个点 point-in-polygon
#
# Usage:
#   bash backend/scripts/seed-geoboundaries/deploy-seed.sh
#
# 停止条件: 任一步失败即退出, 不继续.

set -euo pipefail

SQL="$(dirname "$0")/regions-v428.sql"
GZ="${SQL}.gz"
SSH_HOST="root@122.51.174.118"
DB_CONTAINER="ainews-db"
DB_PASSWORD='Mzm920313@950824'
DB_NAME="cairn"

if [[ ! -f "$SQL" ]]; then
  echo "ERROR: $SQL not found. Run: node seed.js --dry-run" >&2
  exit 1
fi

echo "[1/6] gzip SQL..."
gzip -k -f "$SQL"
ls -lh "$GZ"

echo "[2/6] scp to aliyun..."
scp "$GZ" "$SSH_HOST:/tmp/regions-v428.sql.gz"

echo "[3/6] gunzip on aliyun..."
ssh "$SSH_HOST" "cd /tmp && gunzip -f regions-v428.sql.gz && ls -lh regions-v428.sql"

echo "[4/6] docker cp into ainews-db container..."
ssh "$SSH_HOST" "docker cp /tmp/regions-v428.sql ${DB_CONTAINER}:/tmp/regions-v428.sql"

echo "[5/6] mysql execute (this may take 1-3 minutes with spatial index build)..."
ssh "$SSH_HOST" "docker exec ${DB_CONTAINER} bash -c \"mysql -uroot -p'${DB_PASSWORD}' ${DB_NAME} < /tmp/regions-v428.sql\""

echo "[6/6] verify..."
ssh "$SSH_HOST" "docker exec ${DB_CONTAINER} mysql -uroot -p'${DB_PASSWORD}' ${DB_NAME} -e 'SELECT COUNT(*) AS total, SUM(level=0) AS world, SUM(level=1) AS cont, SUM(level=2) AS country, SUM(level=3) AS adm1 FROM regions;'"

echo ""
echo "[verify] Shanghai point-in-polygon test..."
ssh "$SSH_HOST" "docker exec ${DB_CONTAINER} mysql -uroot -p'${DB_PASSWORD}' ${DB_NAME} -e \"SELECT id, name_en, level FROM regions WHERE NOT ST_IsEmpty(geom) AND ST_Contains(geom, ST_SRID(POINT(121.4737, 31.2304), 4326)) ORDER BY level DESC LIMIT 5;\""

echo ""
echo "[verify] Auckland point-in-polygon test..."
ssh "$SSH_HOST" "docker exec ${DB_CONTAINER} mysql -uroot -p'${DB_PASSWORD}' ${DB_NAME} -e \"SELECT id, name_en, level FROM regions WHERE NOT ST_IsEmpty(geom) AND ST_Contains(geom, ST_SRID(POINT(174.7633, -36.8485), 4326)) ORDER BY level DESC LIMIT 5;\""

echo ""
echo "[verify] London point-in-polygon test..."
ssh "$SSH_HOST" "docker exec ${DB_CONTAINER} mysql -uroot -p'${DB_PASSWORD}' ${DB_NAME} -e \"SELECT id, name_en, level FROM regions WHERE NOT ST_IsEmpty(geom) AND ST_Contains(geom, ST_SRID(POINT(-0.1281, 51.5081), 4326)) ORDER BY level DESC LIMIT 5;\""

echo ""
echo "[cleanup] removing /tmp files on aliyun..."
ssh "$SSH_HOST" "rm -f /tmp/regions-v428.sql /tmp/regions-v428.sql.gz && docker exec ${DB_CONTAINER} rm -f /tmp/regions-v428.sql"
rm -f "$GZ"

echo ""
echo "=== v428 seed deployment complete ==="
echo "Next: restart cairn-backend container to pick up any code changes."
echo "  ssh $SSH_HOST 'docker restart cairn-backend'"
