#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

[[ $# -eq 1 && ( "$1" == open || "$1" == frozen ) ]] || die "usage: set-write-mode.sh open|frozen"
MODE="$1"
load_env
require_root
if [[ "$MODE" == open && "${WRITE_MODE_CHANGE_APPROVED:-}" != YES ]]; then
  die "opening writes requires WRITE_MODE_CHANGE_APPROVED=YES"
fi
src="$OPS_DIR/nginx/write-mode-$MODE.conf"
run install -m 0644 "$src" /etc/nginx/cairn-write-mode.conf
run nginx -t
run systemctl reload nginx
if [[ "$DRY_RUN" != 1 ]]; then printf '%s\n' "$MODE" >"${DEPLOY_ROOT:-/srv/cairn-au}/state/write-mode"; fi
log "WRITE MODE: $MODE"
