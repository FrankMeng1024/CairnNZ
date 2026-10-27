#!/usr/bin/env bash
set -euo pipefail
export LC_ALL=C LANG=C

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPS_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
REPO_ROOT="$(cd "$OPS_DIR/../.." && pwd)"
AU_ENV_FILE="${AU_ENV_FILE:-/etc/cairn-au/au.env}"
DRY_RUN="${DRY_RUN:-0}"

timestamp() { date -u +'%Y-%m-%dT%H:%M:%SZ'; }
log() { printf '%s %s\n' "$(timestamp)" "$*"; }
warn() { printf '%s WARN: %s\n' "$(timestamp)" "$*" >&2; }
die() { printf '%s ERROR: %s\n' "$(timestamp)" "$*" >&2; exit 1; }

shell_join() {
  local quoted=() arg
  for arg in "$@"; do printf -v arg '%q' "$arg"; quoted+=("$arg"); done
  printf '%s' "${quoted[*]}"
}

run() {
  log "+ $(shell_join "$@")"
  if [[ "$DRY_RUN" != "1" ]]; then "$@"; fi
}

require_command() { command -v "$1" >/dev/null 2>&1 || die "required command missing: $1"; }
require_root() { [[ "$(id -u)" == "0" ]] || die "this command must run as root"; }
require_env() {
  local name
  for name in "$@"; do [[ -n "${!name:-}" ]] || die "required environment variable missing: $name"; done
}

load_env() {
  local path="${1:-$AU_ENV_FILE}"
  [[ -f "$path" ]] || die "environment file not found: $path"
  if [[ "$path" != *.example ]]; then
    local mode
    mode="$(stat -f '%Lp' "$path" 2>/dev/null || stat -c '%a' "$path")"
    [[ "$mode" == "600" || "$mode" == "400" ]] || die "secret environment file must be mode 600 or 400: $path (mode $mode)"
  fi
  set -a
  # shellcheck disable=SC1090
  source "$path"
  set +a
  export AU_ENV_FILE="$path"
}

compose() {
  require_command docker
  docker compose --env-file "$AU_ENV_FILE" \
    -f "$OPS_DIR/docker-compose.au.yml" \
    -p "${COMPOSE_PROJECT_NAME:-cairn-au}" "$@"
}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}';
  else shasum -a 256 "$1" | awk '{print $1}'; fi
}

ensure_under() {
  local child="$1" parent="$2"
  case "$child" in "$parent"/*) ;; *) die "refusing path outside $parent: $child" ;; esac
}

acquire_lock() {
  local name="$1" root="${DEPLOY_ROOT:-/srv/cairn-au}/state"
  mkdir -p "$root"
  if command -v flock >/dev/null 2>&1; then
    exec 9>"$root/$name.lock"
    flock -n 9 || die "another $name operation is already running"
  else
    mkdir "$root/$name.lockdir" 2>/dev/null || die "another $name operation is already running"
    trap 'rmdir "${DEPLOY_ROOT:-/srv/cairn-au}/state/'"$name"'.lockdir" 2>/dev/null || true' EXIT
  fi
}

full_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
