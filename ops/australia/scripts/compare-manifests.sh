#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

[[ $# -eq 2 ]] || die "usage: compare-manifests.sh SOURCE_DIR TARGET_DIR"
SOURCE="$1" TARGET="$2"
for dir in "$SOURCE" "$TARGET"; do
  [[ -f "$dir/schema.sha256" && -f "$dir/table-counts.tsv" && -f "$dir/fk-orphans.tsv" ]] || die "incomplete manifest: $dir"
done

status=0
for file in schema.sha256 table-counts.tsv; do
  if ! diff -u "$SOURCE/$file" "$TARGET/$file"; then
    status=1
    if [[ "$file" == schema.sha256 && -f "$SOURCE/schema-canonical.tsv" && -f "$TARGET/schema-canonical.tsv" ]]; then
      diff -u "$SOURCE/schema-canonical.tsv" "$TARGET/schema-canonical.tsv" || true
    fi
  fi
done
if [[ -f "$SOURCE/table-content-sha256.tsv" || -f "$TARGET/table-content-sha256.tsv" ]]; then
  [[ -f "$SOURCE/table-content-sha256.tsv" && -f "$TARGET/table-content-sha256.tsv" ]] || die "full logical content hashes exist on only one side"
  if ! diff -u "$SOURCE/table-content-sha256.tsv" "$TARGET/table-content-sha256.tsv"; then status=1; fi
fi
for file in "$SOURCE/fk-orphans.tsv" "$TARGET/fk-orphans.tsv"; do
  awk -F '\t' '$3 != 0 {print; bad=1} END {exit bad}' "$file" || status=1
done
[[ "$status" == 0 ]] || die "database manifests differ"
log "MANIFEST COMPARE PASS: exact per-table counts, schema hash and available content checksums match"
