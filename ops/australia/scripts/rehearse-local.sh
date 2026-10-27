#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

require_command docker
require_command python3
docker info >/dev/null 2>&1 || die "Docker daemon unavailable"

run_id="$(date +%s)-$$"
network="cairn-au-rehearsal-$run_id"
source_container="cairn-au-source-$run_id"
scratch="$(mktemp -d "${TMPDIR:-/tmp}/cairn-au-rehearsal.XXXXXX")"
results="$OPS_DIR/tests/results"
mkdir -p "$results"
log_file="$results/latest-rehearsal.log"

cleanup() {
  docker rm -f "$source_container" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf "$scratch"
}
trap cleanup EXIT
exec > >(tee "$log_file") 2>&1

docker network create "$network" >/dev/null
for container in "$source_container"; do
  docker run -d --name "$container" --network "$network" \
    -e MYSQL_ROOT_PASSWORD=synthetic-root-password \
    -e MYSQL_DATABASE=cairn mysql:8.0.36 >/dev/null
  for _ in $(seq 1 90); do
    docker exec -e MYSQL_PWD=synthetic-root-password "$container" mysqladmin --connect-timeout=2 ping -h127.0.0.1 -uroot --silent >/dev/null 2>&1 && break
    sleep 2
  done
  docker exec -e MYSQL_PWD=synthetic-root-password "$container" mysqladmin --connect-timeout=2 ping -h127.0.0.1 -uroot --silent >/dev/null || die "$container did not become ready"
done

mkdir -p "$scratch/bin" "$scratch/source/backups" "$scratch/source/exports" "$scratch/source/state" "$scratch/target/backups" "$scratch/target/exports" "$scratch/target/state"
cat >"$scratch/bin/mysql" <<EOF
#!/usr/bin/env bash
exec docker run --rm -i --network "$network" -e MYSQL_PWD -e LANG=C -e LC_ALL=C mysql:8.0.36 mysql "\$@"
EOF
cat >"$scratch/bin/mysqldump" <<EOF
#!/usr/bin/env bash
exec docker run --rm -i --network "$network" -e MYSQL_PWD -e LANG=C -e LC_ALL=C mysql:8.0.36 mysqldump "\$@"
EOF
chmod +x "$scratch/bin/mysql" "$scratch/bin/mysqldump"
export PATH="$scratch/bin:$PATH"

docker exec -i -e MYSQL_PWD=synthetic-root-password "$source_container" mysql -uroot cairn <"$OPS_DIR/tests/fixtures/synthetic.sql"
printf '058\n' >"$scratch/source/state/migrations_applied"

write_env() {
  local file="$1" host="$2" root="$3" database="$4"
  cat >"$file" <<EOF
BACKEND_GIT_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
BACKEND_GIT_REF=codex/australia-infrastructure-preparation-20261027
CAIRN_REPO_URL=https://example.invalid/CairnNZ.git
DEPLOY_ROOT=$root
COMPOSE_PROJECT_NAME=cairn-au-rehearsal
MYSQL_IMAGE=mysql:8.0.36
BACKEND_BIND_IP=127.0.0.1
BACKEND_PORT=39999
DB_ADMIN_HOST=$host
DB_ADMIN_PORT=3306
DB_ADMIN_USER=root
DB_NAME=$database
DB_USER=cairn_app
DB_PASSWORD=synthetic-app-password
MYSQL_ROOT_PASSWORD=synthetic-root-password
JWT_SECRET=synthetic-jwt-secret-at-least-32-characters
NONCE_SECRET=synthetic-nonce-secret-at-least-32-characters
JWT_EXPIRES_IN=7d
CAIRN_TELEMETRY_API_KEY=synthetic-telemetry-key
CORS_ORIGINS=https://example.invalid
PUBLIC_API_BASE_URL=https://example.invalid
API_DOMAIN=example.invalid
STAGING_DOMAIN=example.invalid
LETSENCRYPT_EMAIL=operator@example.invalid
TRUST_PROXY=1
PUBLIC_CAIRN_PILOT_ENABLED=0
DISABLE_CRON=1
EXPORT_DIR=/srv/cairn/exports
EXPORT_DIR_HOST=$root/exports
BACKUP_DIR=$root/backups
MIGRATION_LEDGER_FILE=$root/state/migrations_applied
BACKUP_RETENTION_DAYS=14
SOURCE_WRITES_FROZEN=1
EOF
  chmod 0600 "$file"
}

source_env="$scratch/source.env"; target_env="$scratch/target.env"
write_env "$source_env" "$source_container" "$scratch/source" cairn
write_env "$target_env" "$source_container" "$scratch/target" cairn_restore

AU_ENV_FILE="$source_env" "$SCRIPT_DIR/backup.sh" --full-manifest
bundle="$(find "$scratch/source/backups" -mindepth 1 -maxdepth 1 -type d | head -1)"
[[ -n "$bundle" ]] || die "backup bundle was not created"

AU_ENV_FILE="$target_env" "$SCRIPT_DIR/restore.sh" --dump "$bundle/cairn.sql.gz" --ledger "$bundle/migrations_applied" --exports "$bundle/exports.tar.gz"
AU_ENV_FILE="$target_env" "$SCRIPT_DIR/db-manifest.sh" --out "$scratch/target-manifest" --full
"$SCRIPT_DIR/compare-manifests.sh" "$bundle/db-manifest" "$scratch/target-manifest"

if AU_ENV_FILE="$target_env" "$SCRIPT_DIR/restore.sh" --dump "$bundle/cairn.sql.gz" >/dev/null 2>&1; then
  die "negative test failed: restore overwrote a non-empty target"
fi
cp "$bundle/cairn.sql.gz" "$scratch/tampered.sql.gz"
printf '0%.0s' {1..64} >"$scratch/tampered.sql.gz.sha256"
printf '  tampered.sql.gz\n' >>"$scratch/tampered.sql.gz.sha256"
if AU_ENV_FILE="$target_env" "$SCRIPT_DIR/restore.sh" --dump "$scratch/tampered.sql.gz" --database tamper_test >/dev/null 2>&1; then
  die "negative test failed: bad checksum was accepted"
fi

docker exec -e MYSQL_PWD=synthetic-root-password "$source_container" mysql -uroot cairn_restore -e \
  "SET FOREIGN_KEY_CHECKS=0; INSERT INTO markers(id,user_id,title) VALUES(999,999,'orphan'); SET FOREIGN_KEY_CHECKS=1;"
if AU_ENV_FILE="$target_env" "$SCRIPT_DIR/db-manifest.sh" --out "$scratch/orphan-manifest" >/dev/null 2>&1; then
  die "negative test failed: foreign-key orphan was not detected"
fi

printf 'REHEARSAL_PASS source_rows=9 target_rows=9 overwrite_blocked=true checksum_blocked=true orphan_blocked=true\n'
log "LOCAL REHEARSAL PASS: synthetic backup, verified restore, exact manifest comparison and three fail-closed checks"
