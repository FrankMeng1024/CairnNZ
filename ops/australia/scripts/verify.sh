#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

load_env
require_env BACKEND_GIT_SHA DEPLOY_ROOT DB_NAME MYSQL_ROOT_PASSWORD
base="http://${BACKEND_BIND_IP:-127.0.0.1}:${BACKEND_PORT:-3001}"
health="$(curl -fsS "$base/health")" || die "local health failed"
printf '%s' "$health" | grep -q '"status":"ok"' || die "health is not ok"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "$base/api/auth/onboarding" -H 'Content-Type: application/json' -d '{"done":true}')" == 401 ]] || die "auth route contract failed"
[[ "$(curl -sS -o /dev/null -w '%{http_code}' "$base/privacy")" == 200 ]] || die "privacy route failed"

actual_image_sha="$(docker inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "${COMPOSE_PROJECT_NAME:-cairn-au}-backend-1")"
[[ "$actual_image_sha" == "$BACKEND_GIT_SHA" ]] || die "backend image SHA mismatch: $actual_image_sha"
[[ "$(cat "$DEPLOY_ROOT/state/deployed_git_sha")" == "$BACKEND_GIT_SHA" ]] || die "deployed state SHA mismatch"

ledger_file="${MIGRATION_LEDGER_FILE:-$DEPLOY_ROOT/state/migrations_applied}"
[[ -f "$ledger_file" ]] || die "migration ledger missing"
ledger="$(tr -d '[:space:]' <"$ledger_file")"
latest="$(find "$DEPLOY_ROOT/source/backend/src/migrations" -maxdepth 1 -name '[0-9]*.sql' -print | xargs -n1 basename | sed -E 's/^([0-9]+).*/\1/' | sort -n | tail -1)"
[[ "$((10#$ledger))" -eq "$((10#$latest))" ]] || die "migration ledger $ledger != source latest $latest"

for url in https://appleid.apple.com/auth/keys https://oauth2.googleapis.com/tokeninfo https://api.resend.com/emails https://exp.host/--/api/v2/push/getReceipts; do
  code="$(curl --connect-timeout 5 --max-time 10 -sS -o /dev/null -w '%{http_code}' "$url" || true)"
  [[ "$code" != 000 ]] || die "outbound dependency unreachable: $url"
done

if [[ "${VERIFY_PUBLIC_TLS:-0}" == 1 ]]; then
  curl -fsS "https://$API_DOMAIN/health" >/dev/null || die "public TLS health failed"
fi
log "VERIFY PASS: health, source label, migration ledger, route contracts and outbound reachability"
