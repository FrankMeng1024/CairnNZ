#!/usr/bin/env bash
# iTunes RSS Customer Reviews Batch Scraper
# Bash on Windows Git Bash. Uses curl + python (inline) for JSON parsing.

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$ROOT_DIR/raw/02_appstore"
mkdir -p "$OUT_DIR"

PY="${PY_BIN:-python}"
command -v "$PY" >/dev/null 2>&1 || { echo "python not found in PATH" >&2; exit 2; }
export PYTHONIOENCODING=utf-8
export PYTHONUTF8=1

# --- Config ---
# slug|id|regions_csv
APPS=(
  "polarsteps|947925763|us,gb,au,nz"
  "dayone|1044867788|us,gb,au,nz"
  "alltrails|405075943|us,gb,au,nz"
  "fogofworld|505367096|us,gb,au,nz,cn"
  "yishengzuji|1225520399|cn"
  "linggan|1539411511|cn"
)
SORTS=("mostRecent" "mostHelpful")
PAGES=(1 2 3 4 5 6 7 8 9 10)

PRIMARY_HOST="itunes.apple.com"
BACKUP_HOST="rss.applemarketingtools.com"

declare -A HOST_FAILS
USE_BACKUP=0

log() { echo "[$(date +%H:%M:%S)] $*" >&2; }

url_for() {
  local host="$1" region="$2" appid="$3" sort="$4" page="$5"
  echo "https://${host}/${region}/rss/customerreviews/id=${appid}/sortBy=${sort}/page=${page}/json"
}

out_file_for() {
  local slug="$1" region="$2" sort="$3"
  echo "$OUT_DIR/${slug}_${region}_${sort}.jsonl"
}

# parse_and_emit: read $1 (json path), emit JSONL rows to stdout
# Args: json_file slug appid region sort page
parse_and_emit() {
  local json_file="$1" slug="$2" appid="$3" region="$4" sort="$5" page="$6"
  "$PY" - "$json_file" "$slug" "$appid" "$region" "$sort" "$page" <<'PYEOF'
import json, sys
path, slug, appid, region, sort, page = sys.argv[1:7]
try:
    with open(path, 'r', encoding='utf-8') as f:
        d = json.load(f)
except Exception as e:
    sys.stderr.write("parse_error: %s\n" % e)
    sys.exit(3)
feed = d.get('feed') or {}
entries = feed.get('entry') or []
if isinstance(entries, dict):
    entries = [entries]
def g(o, k):
    v = o.get(k)
    if isinstance(v, dict):
        return v.get('label', '')
    return v or ''
count = 0
for e in entries:
    if 'im:rating' not in e:
        continue  # first entry is app metadata, no rating
    try:
        rating = int(g(e, 'im:rating') or 0)
    except Exception:
        rating = 0
    row = {
        'id': g(e, 'id'),
        'rating': rating,
        'title': g(e, 'title'),
        'content': g(e, 'content'),
        'author': (e.get('author') or {}).get('name', {}).get('label', '') if isinstance(e.get('author'), dict) else '',
        'updated': g(e, 'updated'),
        'version': g(e, 'im:version'),
        'app_slug': slug,
        'app_id': appid,
        'region': region,
        'sort': sort,
        'page': int(page),
    }
    print(json.dumps(row, ensure_ascii=False))
    count += 1
sys.stderr.write("PARSED_COUNT=%d\n" % count)
PYEOF
}

LAST_HTTP=0
LAST_BODY_FILE=""
fetch_page() {
  local url="$1"
  local tmp
  tmp=$(mktemp)
  local code
  code=$(curl -sS --max-time 30 -o "$tmp" -w "%{http_code}" \
    -H "User-Agent: Mozilla/5.0 (compatible; ReviewScraper/1.0)" \
    -H "Accept: application/json" \
    "$url" 2>/dev/null)
  if [ -z "$code" ]; then code="000"; fi
  LAST_HTTP="$code"
  LAST_BODY_FILE="$tmp"
}

scrape_one() {
  local slug="$1" region="$2" appid="$3" sort="$4" page="$5"
  local out_file
  out_file=$(out_file_for "$slug" "$region" "$sort")

  local host
  if [ "$USE_BACKUP" -eq 1 ]; then host="$BACKUP_HOST"; else host="$PRIMARY_HOST"; fi
  local url
  url=$(url_for "$host" "$region" "$appid" "$sort" "$page")

  local attempt=0
  local backoff=4
  while [ $attempt -lt 3 ]; do
    fetch_page "$url"
    log "GET $slug/$region/$sort/p$page -> HTTP $LAST_HTTP"

    case "$LAST_HTTP" in
      200)
        local rows count
        rows=$(parse_and_emit "$LAST_BODY_FILE" "$slug" "$appid" "$region" "$sort" "$page" 2>/tmp/parse.err)
        count=$(grep -o 'PARSED_COUNT=[0-9]*' /tmp/parse.err | tail -1 | cut -d= -f2)
        count="${count:-0}"
        rm -f "$LAST_BODY_FILE"
        if [ "$count" -gt 0 ]; then
          printf "%s\n" "$rows" >> "$out_file"
        fi
        echo "  $slug/$region/$sort/p$page: $count reviews -> $(basename "$out_file")"
        HOST_FAILS["$host"]=0
        return 0
        ;;
      429|503)
        rm -f "$LAST_BODY_FILE"
        log "  throttled ($LAST_HTTP); backoff ${backoff}s"
        sleep "$backoff"
        backoff=$((backoff * 2))
        attempt=$((attempt + 1))
        ;;
      404)
        rm -f "$LAST_BODY_FILE"
        log "  404 — invalid region/app combo, skip"
        return 0
        ;;
      000)
        rm -f "$LAST_BODY_FILE"
        log "  network failure; backoff ${backoff}s"
        sleep "$backoff"
        backoff=$((backoff * 2))
        attempt=$((attempt + 1))
        HOST_FAILS["$host"]=$(( ${HOST_FAILS["$host"]:-0} + 1 ))
        if [ "${HOST_FAILS[$host]:-0}" -ge 3 ] && [ "$USE_BACKUP" -eq 0 ]; then
          log "  primary failed 3x, switching to backup host"
          USE_BACKUP=1
          host="$BACKUP_HOST"
          url=$(url_for "$host" "$region" "$appid" "$sort" "$page")
        fi
        ;;
      *)
        rm -f "$LAST_BODY_FILE"
        log "  unexpected HTTP $LAST_HTTP; backoff ${backoff}s"
        sleep "$backoff"
        backoff=$((backoff * 2))
        attempt=$((attempt + 1))
        ;;
    esac
  done
  log "  FAILED after 3 attempts: $slug/$region/$sort/p$page"
  return 1
}

# Resume check: does out file already have a row for this page+region?
already_have() {
  local slug="$1" region="$2" sort="$3" page="$4"
  local f
  f=$(out_file_for "$slug" "$region" "$sort")
  [ -f "$f" ] || return 1
  grep -q "\"page\": $page" "$f" 2>/dev/null || grep -q "\"page\":$page" "$f" 2>/dev/null
}

main() {
  if [ "${1:-}" = "--dry-run" ]; then
    shift
    scrape_one "$@"
    return $?
  fi

  local total=0
  for app_def in "${APPS[@]}"; do
    IFS='|' read -r slug appid regions <<< "$app_def"
    IFS=',' read -ra RA <<< "$regions"
    total=$(( total + ${#RA[@]} * ${#SORTS[@]} * ${#PAGES[@]} ))
  done
  log "Total tasks: $total"

  local idx=0
  for app_def in "${APPS[@]}"; do
    IFS='|' read -r slug appid regions <<< "$app_def"
    IFS=',' read -ra RA <<< "$regions"
    for region in "${RA[@]}"; do
      for sort in "${SORTS[@]}"; do
        for page in "${PAGES[@]}"; do
          idx=$((idx + 1))
          if already_have "$slug" "$region" "$sort" "$page"; then
            echo "[$idx/$total] SKIP (exists) $slug/$region/$sort/p$page"
            continue
          fi
          echo "[$idx/$total] $slug/$region/$sort/p$page"
          scrape_one "$slug" "$region" "$appid" "$sort" "$page" || true
          sleep 2
        done
      done
    done
  done
  log "Done."
}

main "$@"
