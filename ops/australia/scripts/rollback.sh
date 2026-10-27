#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

[[ "${1:-}" == --execute ]] || die "usage: rollback.sh --execute"
load_env
require_root
[[ "${PRODUCTION_CUTOVER_AUTHORIZATION:-}" == OWNER_APPROVED ]] || die "Owner authorization is absent"

if [[ "${AU_WRITES_STARTED:-0}" == 1 ]]; then
  die "automatic traffic rollback is blocked: Australia accepted writes. Freeze AU, create a final AU backup, reconcile/restore those writes to the chosen authority, compare manifests, then route traffic. Never point clients at stale China data."
fi

export WRITE_MODE_CHANGE_APPROVED=YES
"$SCRIPT_DIR/set-write-mode.sh" frozen
mkdir -p "$DEPLOY_ROOT/state"
cat >"$DEPLOY_ROOT/state/rollback-ready.json" <<EOF
{"checked_at":"$(timestamp)","au_writes_started":false,"dns_changed":false,"action":"manual DNS rollback permitted after source health and write mode are verified"}
EOF
chmod 0600 "$DEPLOY_ROOT/state/rollback-ready.json"
log "ROLLBACK GATE PASS: no AU writes recorded. DNS has NOT been changed; verify/unfreeze source immediately before manual DNS rollback."
