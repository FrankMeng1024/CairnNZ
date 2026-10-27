#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

for script in "$SCRIPT_DIR"/*.sh "$SCRIPT_DIR"/lib/*.sh; do
  bash -n "$script"
  [[ -x "$script" ]] || die "script is not executable: $script"
done

required_docs=(
  AU_SERVER_PURCHASE_CHECKLIST.md CURRENT_INFRASTRUCTURE_INVENTORY.md
  AU_DEPLOYMENT_PLAN.md AU_ENV_REQUIREMENTS.md AU_DATA_MIGRATION.md
  AU_CUTOVER_AND_ROLLBACK.md AU_ACCEPTANCE_CHECKLIST.md PREPARATION_REPORT.md
)
for doc in "${required_docs[@]}"; do [[ -s "$OPS_DIR/$doc" ]] || die "missing required document: $doc"; done

python3 - "$OPS_DIR/env/au.env.example" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
keys = []
for line in path.read_text(encoding="utf-8").splitlines():
    if line and not line.startswith("#"):
        if "=" not in line:
            raise SystemExit(f"invalid env template line: {line}")
        keys.append(line.split("=", 1)[0])
duplicates = sorted({key for key in keys if keys.count(key) > 1})
if duplicates:
    raise SystemExit(f"duplicate env keys: {duplicates}")
if any(re.search(r"(AKIA[0-9A-Z]{16}|re_[A-Za-z0-9]{20,}|sk-[A-Za-z0-9]{20,})", line) for line in path.read_text().splitlines()):
    raise SystemExit("credential-like value found in template")
PY

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  tmp_env="$(mktemp)"; trap 'rm -f "$tmp_env"' EXIT
  sed \
    -e "s|0000000000000000000000000000000000000000|$(git -C "$REPO_ROOT" rev-parse HEAD)|" \
    -e 's|https://github.com/OWNER/PRIVATE_REPOSITORY.git|https://example.invalid/CairnNZ.git|' \
    -e 's|REPLACE_IN_SECRET_STORE|synthetic-secret-value|g' \
    -e 's|REPLACE_WITH_EXISTING_PRODUCTION_VALUE|synthetic-continuity-value|g' \
    -e 's|REPLACE_WITH_DISTINCT_RANDOM_VALUE|synthetic-distinct-value|g' \
    "$OPS_DIR/env/au.env.example" >"$tmp_env"
  chmod 0600 "$tmp_env"
  docker compose --env-file "$tmp_env" -f "$OPS_DIR/docker-compose.au.yml" config -q
fi

git -C "$REPO_ROOT" diff --check -- ops/australia
log "STATIC VALIDATION PASS: shell syntax, executable modes, docs, env template, compose model and whitespace"
