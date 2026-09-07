#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="${REPO_ROOT:-$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)}"
MIGRATIONS_DIR="${MIGRATIONS_DIR:-$REPO_ROOT/backend/src/migrations}"
LAST_APPLIED_FILE="${LAST_APPLIED_FILE:-$SCRIPT_DIR/.migrations_applied}"
DB_HOST="${DB_HOST:-127.0.0.1}"
DB_PORT="${DB_PORT:-3306}"
DB_USER="${DB_USER:-root}"
DB_NAME="${DB_NAME:-cairn}"
: "${DB_PASSWORD:?DB_PASSWORD is required}"

LAST_APPLIED="$(cat "$LAST_APPLIED_FILE" 2>/dev/null || echo "000")"
MIG_APPLIED=0
for mig_path in $(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '[0-9]*.sql' | sort); do
  mig_file="$(basename "$mig_path")"
  mig_num="$(echo "$mig_file" | grep -oE '^[0-9]+')"
  if [ -z "$mig_num" ]; then continue; fi
  if [ "$((10#$mig_num))" -le "$((10#$LAST_APPLIED))" ]; then
    continue
  fi
  if grep -qiE '^\s*(DROP\s+TABLE|TRUNCATE\s+TABLE)' "$mig_path" \
     || grep -qiE '^\s*DELETE\s+FROM\s+\w+\s*;' "$mig_path"; then
    if [ "${MIGRATION_ALLOW_DESTRUCTIVE:-0}" != "1" ]; then
      echo "  ⚠️  BLOCK $mig_file — contains destructive statements (DROP/TRUNCATE)."
      echo "❌ Refusing to advance the migration ledger for an unexecuted migration."
      exit 1
    fi
    echo "  ▸ applying $mig_file (destructive — allowed by env flag)"
  else
    echo "  ▸ applying $mig_file"
  fi

  verify_script="$REPO_ROOT/backend/scripts/verify-migration-${mig_num}.sh"
  mig_output="$(mktemp "${TMPDIR:-/tmp}/cairn-migration-${mig_num}.XXXXXX")"
  mysql_args=(-h"$DB_HOST" -P"$DB_PORT" -u"$DB_USER" "$DB_NAME")
  if [ -x "$verify_script" ]; then
    # A prior invocation may have completed every postcondition while still
    # returning non-zero (for example, a partial-DDL repair encountered
    # already-existing objects). That invocation is deliberately forbidden
    # from advancing the ledger. A clean later invocation may record the
    # already-complete migration without executing any DDL.
    if DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_NAME="$DB_NAME" \
      DB_PASSWORD="$DB_PASSWORD" "$verify_script" >/dev/null 2>&1; then
      echo "    schema already satisfies migration $mig_num; recording verified completion"
    else
    # MySQL DDL auto-commits. --force lets an interrupted migration skip
      # already-created objects and continue to missing statements. A non-zero
      # process status ALWAYS leaves the ledger unchanged, even when the final
      # verifier passes. The operator reruns; the verifier-only branch above
      # then records completion without executing a failing statement.
      set +e
      MYSQL_PWD="$DB_PASSWORD" mysql --force "${mysql_args[@]}" < "$mig_path" 2>&1 | tee "$mig_output"
      mig_status=${PIPESTATUS[0]}
      set -e
      # mysql --force may print SQL errors yet exit zero, so both the process
      # result and its canonical ERROR records are part of the failure signal.
      if [ "$mig_status" -ne 0 ] || grep -qE '^ERROR [0-9]+' "$mig_output"; then
        echo "❌ Migration $mig_file reported one or more statement failures. Ledger unchanged."
        if DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_NAME="$DB_NAME" \
          DB_PASSWORD="$DB_PASSWORD" "$verify_script"; then
          echo "   All postconditions now verify. Re-run once to record verified completion without DDL."
        else
          echo "   Schema remains incomplete; inspect and repair before re-running."
        fi
        echo "   Inspect: $mig_output"
        exit 1
      fi
      if ! DB_HOST="$DB_HOST" DB_PORT="$DB_PORT" DB_USER="$DB_USER" DB_NAME="$DB_NAME" \
        DB_PASSWORD="$DB_PASSWORD" "$verify_script"; then
        echo "❌ Migration $mig_file did not satisfy every postcondition. Ledger unchanged."
        echo "   Inspect: $mig_output"
        exit 1
      fi
    fi
  elif ! MYSQL_PWD="$DB_PASSWORD" mysql "${mysql_args[@]}" < "$mig_path" 2>&1 | tee "$mig_output"; then
    echo "❌ Migration $mig_file failed. Ledger unchanged. Inspect: $mig_output"
    exit 1
  fi

  rm -f "$mig_output"
  ledger_next="$(mktemp "${LAST_APPLIED_FILE}.next.XXXXXX")"
  printf '%s\n' "$mig_num" > "$ledger_next"
  mv "$ledger_next" "$LAST_APPLIED_FILE"
  LAST_APPLIED="$mig_num"
  MIG_APPLIED=$((MIG_APPLIED + 1))
done

echo "  ✓ Migrations complete ($MIG_APPLIED new, last=$(cat "$LAST_APPLIED_FILE" 2>/dev/null || echo "$LAST_APPLIED"))"
