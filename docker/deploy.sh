#!/bin/bash
# Cairn backend deploy pipeline.
#
# User's iron rule (R114/O22 2026-08-08): "每次重启后端都是 git pull, 数据库
# 正确, 并且重启". Every restart MUST run through this script — no ad-hoc
# `docker compose restart` allowed. This is the single deploy entry point.
#
# Pipeline (fails fast on any step):
#   1. git pull → sync source from github hiking-app master
#   2. run pending migrations → keep DB schema in sync with code
#   3. docker compose build backend → rebuild image from new source
#   4. docker compose up -d backend → recreate container with new image
#   5. wait for healthcheck → confirm backend is live
#   6. smoke-check the new endpoint(s) → confirm no regression

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Sanity: .env must exist (contains DB_PASSWORD, telemetry key, etc)
if [ ! -f .env ]; then
  echo "❌ .env not found. Copy .env.example to .env and edit it first."
  exit 1
fi

# Load .env so migration step can read DB_PASSWORD
set -a
# shellcheck disable=SC1091
source .env
set +a

# Compose command detection (v2 preferred)
if docker compose version &> /dev/null; then
  COMPOSE=(docker compose)
else
  COMPOSE=(docker-compose)
fi

# ── Step 1: git pull ─────────────────────────────────────────────────────
# Server repo layout: /opt/githubRepos/Cairn/ is the git root, docker/
# subdir is where this script lives (SCRIPT_DIR = <repo>/Cairn/docker or
# similar). Walk up to the git root and pull hiking-app master.
echo "→ Step 1/6: git pull hiking-app master…"
REPO_ROOT="$(git -C "$SCRIPT_DIR" rev-parse --show-toplevel)"
cd "$REPO_ROOT"
# Allow an initial asset-heavy production catch-up to complete while still
# bounding a genuinely wedged fetch. Progress is monitored by the operator.
GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=10' \
  timeout 1800 git fetch origin master
git reset --hard origin/master
echo "  ✓ Repo now at $(git log --oneline -1)"
cd "$SCRIPT_DIR"

# ── Step 2: run pending migrations ───────────────────────────────────────
# Migrations live in backend/src/migrations/NNN_*.sql and are numbered
# strictly increasing. We store the last-applied number in a file so a
# rerun only picks up new migrations.
#
# CRITICAL (R114/O22 2026-08-08 post-mortem): destructive migrations
# (DROP TABLE / TRUNCATE / DELETE without WHERE) MUST NOT run
# automatically. On 2026-08-08 the initial deploy ran 004_auth_rebuild.sql
# on an existing populated DB — its unconditional `DROP TABLE sessions`
# succeeded and only `DROP TABLE users` failed (FK), destroying real
# hike data. Guard: if a migration file contains DROP/TRUNCATE, skip
# it and fail without advancing the ledger unless
# MIGRATION_ALLOW_DESTRUCTIVE=1 is set. Migration-specific verifiers handle
# MySQL DDL auto-commit and partial reruns before the ledger can advance.
echo "→ Step 2/6: running pending DB migrations…"
LAST_APPLIED_FILE="$SCRIPT_DIR/.migrations_applied"
REPO_ROOT="$REPO_ROOT" LAST_APPLIED_FILE="$LAST_APPLIED_FILE" \
  DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_NAME=cairn DB_PASSWORD="$DB_PASSWORD" \
  "$SCRIPT_DIR/run-pending-migrations.sh"

# ── Step 3: build backend image ──────────────────────────────────────────
echo "→ Step 3/6: docker compose build backend…"
"${COMPOSE[@]}" build backend

# ── Step 4: recreate backend container ───────────────────────────────────
echo "→ Step 4/6: recreating backend container…"
"${COMPOSE[@]}" up -d backend

# ── Step 5: wait for healthcheck ─────────────────────────────────────────
echo "→ Step 5/6: waiting for backend health (up to 90s)…"
for i in {1..30}; do
  STATUS=$(curl -fsS http://localhost:3001/health 2>/dev/null | grep -o '"status":"[^"]*"' || echo '')
  if [ "$STATUS" = '"status":"ok"' ]; then
    echo "  ✓ Backend healthy."
    break
  fi
  if [ $i -eq 30 ]; then
    echo "❌ Backend did not become healthy in 90s. Logs:"
    "${COMPOSE[@]}" logs --tail=80 backend
    exit 1
  fi
  sleep 3
done

# ── Step 6: smoke-check registered routes ────────────────────────────────
# Not exhaustive — just prove the key R114/O22 STORY-73006 endpoint is
# registered (returns 401 without auth = route exists + middleware works).
echo "→ Step 6/6: smoke-checking H2 endpoint…"
H2_CHECK=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH http://localhost:3001/api/auth/onboarding \
  -H 'Content-Type: application/json' -d '{"done":true}' 2>&1)
if [ "$H2_CHECK" = "401" ]; then
  echo "  ✓ PATCH /api/auth/onboarding registered (401 without token = correct)"
else
  echo "  ⚠️  PATCH /api/auth/onboarding returned $H2_CHECK (expected 401). Route may be missing."
fi

echo
echo "✓ Cairn backend deploy complete."
echo "  Commit:    $(git -C "$REPO_ROOT" log --oneline -1)"
echo "  Health:    http://localhost:3001/health"
echo "  Tail logs: ${COMPOSE[*]} logs -f backend"
