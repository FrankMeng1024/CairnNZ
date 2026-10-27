#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

load_env
require_root
require_env DEPLOY_ROOT
[[ -r /etc/os-release ]] || die "unsupported host: /etc/os-release missing"
# shellcheck disable=SC1091
source /etc/os-release
[[ "${ID:-}" == ubuntu && "${VERSION_ID:-}" == 24.04* ]] || die "expected Ubuntu 24.04 LTS; found ${PRETTY_NAME:-unknown}"

export DEBIAN_FRONTEND=noninteractive
run apt-get update
run apt-get install -y --no-install-recommends \
  ca-certificates curl git jq nginx certbot python3-certbot-nginx \
  docker.io docker-compose-v2 default-mysql-client ufw logrotate rsync rclone gzip

if ! id cairn >/dev/null 2>&1; then
  run useradd --create-home --shell /bin/bash cairn
fi
run usermod -aG docker cairn
run install -d -m 0750 -o cairn -g cairn "$DEPLOY_ROOT"
run install -d -m 0750 -o cairn -g cairn \
  "$DEPLOY_ROOT/source" "$DEPLOY_ROOT/state" "$DEPLOY_ROOT/backups" \
  "$DEPLOY_ROOT/exports" "$DEPLOY_ROOT/logs"
run install -d -m 0750 -o 999 -g 999 "$DEPLOY_ROOT/mysql"
run install -d -m 0750 -o root -g cairn /etc/cairn-au
run install -d -m 0755 -o root -g root /var/www/certbot

run systemctl enable --now docker
run systemctl enable --now nginx

if [[ ! -f /etc/cairn-au/au.env ]]; then
  run install -m 0600 -o root -g root "$OPS_DIR/env/au.env.example" /etc/cairn-au/au.env
  warn "created /etc/cairn-au/au.env from template; fill secrets before preflight/deploy"
fi

log "BOOTSTRAP PASS: packages, service user and isolated directories prepared"
