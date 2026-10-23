#!/usr/bin/env bash
set -euo pipefail

container_name="cairn-diag-harness-$$"
cleanup() {
  docker rm -f "${container_name}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run --rm -d \
  --name "${container_name}" \
  --security-opt seccomp=unconfined \
  -e MYSQL_ROOT_PASSWORD=harness-only-password \
  -e MYSQL_DATABASE=cairn_diag_harness \
  -P mysql:8.0 >/dev/null

for attempt in $(seq 1 60); do
  if docker exec "${container_name}" mysqladmin ping -uroot -pharness-only-password --silent >/dev/null 2>&1; then
    break
  fi
  if [ "${attempt}" -eq 60 ]; then
    echo "Disposable MySQL did not become ready" >&2
    exit 1
  fi
  sleep 1
done

mapped_port="$(docker port "${container_name}" 3306/tcp | awk -F: 'NR==1 { print $NF }')"
DB_HOST=127.0.0.1 \
DB_PORT="${mapped_port}" \
DB_USER=root \
DB_PASSWORD=harness-only-password \
DB_NAME=cairn_diag_harness \
JWT_SECRET=automatic-diagnostics-harness-secret-2026-minimum-32-bytes \
CAIRN_TELEMETRY_API_KEY=harness-operations-read-key \
NODE_ENV=test \
node scripts/automatic-diagnostics-harness.js
