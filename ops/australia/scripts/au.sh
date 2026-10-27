#!/usr/bin/env bash
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${AU_ENV_FILE:-/etc/cairn-au/au.env}"
DRY_RUN="${DRY_RUN:-0}"

usage() {
  cat <<'EOF'
Usage: au.sh [--env FILE] [--dry-run] COMMAND [ARGS]

Commands:
  preflight             Read-only host/config checks
  bootstrap             Install host prerequisites and create directories
  security              Apply firewall and SSH guardrails
  install-ops-services  Install backup/health timers after checkout
  deploy                Check out exact SHA, build and start isolated stack
  init-db               Start the isolated empty MySQL service
  migrate               Apply only reviewed migrations newer than restored ledger
  backup                Create consistent, checksummed logical backup
  capture-source-exports Copy legacy ephemeral export files without mutation
  restore               Restore a verified dump into an empty database
  db-manifest           Generate per-table/schema integrity evidence
  compare-manifests     Compare source/target manifest directories
  verify                Verify health, TLS, routes and DB identity
  install-tls           Install/renew Let's Encrypt TLS after DNS is ready
  set-write-mode        Set nginx open/frozen mutation mode on this host
  cutover-preflight     Prove gates; never changes DNS
  rollback              Evaluate/execute only a data-safe traffic rollback
  rehearse-local        Synthetic local backup/restore rehearsal
  validate-static       Syntax, compose, template and packaging checks
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env) [[ $# -ge 2 ]] || { usage; exit 2; }; ENV_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) break ;;
  esac
done

[[ $# -ge 1 ]] || { usage; exit 2; }
COMMAND="$1"; shift
case "$COMMAND" in
  preflight|bootstrap|security|install-ops-services|deploy|init-db|migrate|backup|capture-source-exports|restore|db-manifest|compare-manifests|verify|install-tls|set-write-mode|cutover-preflight|rollback|rehearse-local|validate-static) ;;
  *) echo "Unknown command: $COMMAND" >&2; usage; exit 2 ;;
esac

export AU_ENV_FILE="$ENV_FILE" DRY_RUN
exec "$HERE/$COMMAND.sh" "$@"
