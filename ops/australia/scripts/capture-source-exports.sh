#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

CONTAINER=cairn-backend
DESTINATION=
while [[ $# -gt 0 ]]; do
  case "$1" in
    --container) CONTAINER="${2:?}"; shift 2 ;;
    --destination) DESTINATION="${2:?}"; shift 2 ;;
    *) die "usage: capture-source-exports.sh --destination DIR [--container NAME]" ;;
  esac
done
[[ -n "$DESTINATION" ]] || die "--destination is required"
[[ "$CONTAINER" =~ ^[A-Za-z0-9_.-]+$ ]] || die "invalid container name"
require_command python3
[[ -z "$(find "$DESTINATION" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]] || die "destination must be empty"
mkdir -p "$DESTINATION"
chmod 0700 "$DESTINATION"
docker inspect "$CONTAINER" >/dev/null 2>&1 || die "source backend container not found: $CONTAINER"
if ! docker exec "$CONTAINER" test -d /tmp/cairn-exports; then
  log "SOURCE EXPORT CAPTURE PASS: no legacy export directory exists"
  exit 0
fi
docker cp "$CONTAINER:/tmp/cairn-exports/." "$DESTINATION/"
find "$DESTINATION" -type f -exec chmod 0600 {} +
python3 - "$DESTINATION" <<'PY'
import hashlib, pathlib, sys
root = pathlib.Path(sys.argv[1]).resolve()
manifest = root / "export-files.sha256"
rows = []
for path in sorted(p for p in root.rglob("*") if p.is_file() and p != manifest):
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    rows.append(f"{digest.hexdigest()}  {path.relative_to(root)}")
manifest.write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")
manifest.chmod(0o600)
PY
log "SOURCE EXPORT CAPTURE PASS: copied legacy ephemeral exports to protected destination"
