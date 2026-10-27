#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

load_env
require_env BACKEND_GIT_SHA BACKEND_GIT_REF CAIRN_REPO_URL DEPLOY_ROOT DB_NAME DB_USER DB_PASSWORD \
  MYSQL_ROOT_PASSWORD JWT_SECRET NONCE_SECRET CAIRN_TELEMETRY_API_KEY CORS_ORIGINS \
  PUBLIC_API_BASE_URL API_DOMAIN

full_sha "$BACKEND_GIT_SHA" || die "BACKEND_GIT_SHA must be a full 40-character lowercase SHA"
[[ "$BACKEND_GIT_SHA" != 0000000000000000000000000000000000000000 ]] || die "BACKEND_GIT_SHA is still the template value"
[[ ! "$CAIRN_REPO_URL" =~ ://[^/@]+@ ]] || die "repository URL must not embed credentials; use SSH agent or a credential helper"
[[ "$BACKEND_GIT_REF" =~ ^[A-Za-z0-9._/-]+$ ]] || die "BACKEND_GIT_REF contains unsafe characters"
for secret_name in DB_PASSWORD MYSQL_ROOT_PASSWORD JWT_SECRET NONCE_SECRET CAIRN_TELEMETRY_API_KEY; do
  [[ "${!secret_name}" != REPLACE_* ]] || die "$secret_name is still a template value"
done
[[ "$DB_USER" != root ]] || die "the application DB_USER must not be root"
[[ "$DB_NAME" =~ ^[A-Za-z0-9_]+$ ]] || die "DB_NAME contains unsafe characters"
[[ "${BACKEND_PORT:-3001}" == 3001 ]] || die "nginx template and health timers require BACKEND_PORT=3001"
[[ "$DEPLOY_ROOT" == /srv/cairn-au ]] || warn "non-standard DEPLOY_ROOT: $DEPLOY_ROOT"

require_command git
require_command curl
require_command awk
require_command sed

if [[ "$(uname -s)" == Linux ]]; then
  arch="$(uname -m)"
  [[ "$arch" == x86_64 ]] || die "first migration is approved for x86_64 only; found $arch"
  mem_kib="$(awk '/MemTotal:/ {print $2}' /proc/meminfo)"
  cpu_count="$(getconf _NPROCESSORS_ONLN)"
  disk_kib="$(df -Pk "$(dirname "$DEPLOY_ROOT")" 2>/dev/null | awk 'NR==2 {print $2}' || true)"
  [[ "$cpu_count" -ge 2 ]] || die "at least 2 vCPU required; found $cpu_count"
  [[ "$mem_kib" -ge 3900000 ]] || die "at least 4 GiB RAM required; found ${mem_kib} KiB"
  if [[ -n "$disk_kib" && "$disk_kib" -lt 78643200 ]]; then
    die "at least 80 GiB root/data disk required; found ${disk_kib} KiB"
  fi
fi

if command -v docker >/dev/null 2>&1; then
  docker info >/dev/null 2>&1 || die "Docker exists but the daemon is unavailable"
  docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is unavailable"
  compose config -q
else
  warn "Docker is not installed yet; run bootstrap before deploy"
fi

if git -C "$REPO_ROOT" cat-file -e "$BACKEND_GIT_SHA^{commit}" 2>/dev/null; then
  log "source commit exists in local repository: $BACKEND_GIT_SHA"
else
  warn "source commit is not in this local clone; deploy will verify it after authenticated fetch"
fi

if command -v ss >/dev/null 2>&1 && ss -lntH | awk '{print $4}' | grep -Eq '(^|:)3306$'; then
  warn "port 3306 is listening; ensure it is not public. Australia compose uses loopback port ${DB_ADMIN_PORT:-3307}."
fi

log "PRECHECK PASS: configuration shape, minimum host resources and source identity checks completed"
