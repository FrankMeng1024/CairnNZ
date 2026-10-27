#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

load_env
require_root
ops_root="$DEPLOY_ROOT/source/ops/australia"
[[ -x "$ops_root/scripts/backup.sh" ]] || die "deployed operations checkout missing at $ops_root"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
for unit in cairn-au-backup.service cairn-au-backup.timer cairn-au-health.service cairn-au-health.timer; do
  sed "s|__OPS_ROOT__|$ops_root|g" "$OPS_DIR/systemd/$unit" >"$tmp/$unit"
  run install -m 0644 "$tmp/$unit" "/etc/systemd/system/$unit"
done
run install -m 0644 "$OPS_DIR/systemd/cairn-au-logrotate" /etc/logrotate.d/cairn-au
run systemctl daemon-reload
run systemctl enable --now cairn-au-backup.timer
run systemctl enable --now cairn-au-health.timer
log "OPERATIONS SERVICES PASS: backup and health timers installed"
