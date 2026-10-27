#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

SOURCE_MANIFEST=
TARGET_MANIFEST=
SOURCE_FREEZE_EVIDENCE=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --source-manifest) SOURCE_MANIFEST="${2:?}"; shift 2 ;;
    --target-manifest) TARGET_MANIFEST="${2:?}"; shift 2 ;;
    --source-freeze-evidence) SOURCE_FREEZE_EVIDENCE="${2:?}"; shift 2 ;;
    *) die "usage: cutover-preflight.sh --source-manifest DIR --target-manifest DIR --source-freeze-evidence FILE" ;;
  esac
done
load_env
[[ "${PRODUCTION_CUTOVER_AUTHORIZATION:-}" == OWNER_APPROVED ]] || die "separate Owner cutover authorization is absent"
[[ "${SOURCE_WRITES_FROZEN:-0}" == 1 ]] || die "source writes are not declared frozen"
[[ -s "$SOURCE_FREEZE_EVIDENCE" ]] || die "source freeze evidence is missing"
[[ -d "$SOURCE_MANIFEST" && -d "$TARGET_MANIFEST" ]] || die "source and target manifests are required"
[[ -f "$SOURCE_MANIFEST/table-content-sha256.tsv" && -f "$TARGET_MANIFEST/table-content-sha256.tsv" ]] || die "final cutover requires full logical per-table content hashes"
[[ -f "$DEPLOY_ROOT/state/last_restore.json" ]] || die "restore evidence is missing"
[[ "$(cat "$DEPLOY_ROOT/state/write-mode" 2>/dev/null || true)" == frozen ]] || die "Australia target must remain write-frozen during final comparison"
[[ "${DISABLE_CRON:-1}" == 1 ]] || die "Australia cron must remain disabled during final cutover comparison"

"$SCRIPT_DIR/compare-manifests.sh" "$SOURCE_MANIFEST" "$TARGET_MANIFEST"
"$SCRIPT_DIR/verify.sh"

if command -v dig >/dev/null 2>&1; then
  ttl="$(dig +noall +answer "$API_DOMAIN" A | awk 'NR==1 {print $2}')"
  [[ -n "$ttl" && "$ttl" -le 300 ]] || die "production DNS TTL is not confirmed at <=300 seconds"
else
  warn "dig is unavailable; record DNS TTL evidence manually before cutover"
  [[ "${DNS_TTL_VERIFIED:-}" == YES ]] || die "DNS_TTL_VERIFIED=YES evidence is absent"
fi

cat >"$DEPLOY_ROOT/state/cutover-ready.json" <<EOF
{"checked_at":"$(timestamp)","git_sha":"$BACKEND_GIT_SHA","source_manifest":"$(basename "$SOURCE_MANIFEST")","target_manifest":"$(basename "$TARGET_MANIFEST")","dns_changed":false}
EOF
chmod 0600 "$DEPLOY_ROOT/state/cutover-ready.json"
log "CUTOVER PREFLIGHT PASS: data/health gates pass; DNS has NOT been changed"
