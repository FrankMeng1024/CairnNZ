#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=lib/common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib/common.sh"

MODE=all
case "${1:-}" in
  --db-only) MODE=db; shift ;;
  --backend-only) MODE=backend; shift ;;
  "") ;;
  *) die "usage: deploy.sh [--db-only|--backend-only]" ;;
esac

load_env
require_env BACKEND_GIT_SHA BACKEND_GIT_REF CAIRN_REPO_URL DEPLOY_ROOT COMPOSE_PROJECT_NAME MYSQL_ROOT_PASSWORD DB_NAME
full_sha "$BACKEND_GIT_SHA" || die "BACKEND_GIT_SHA must be a full commit SHA"
if [[ "$DRY_RUN" != 1 ]]; then acquire_lock deploy; fi

if [[ "$DRY_RUN" == 1 ]]; then
  git -C "$REPO_ROOT" cat-file -e "$BACKEND_GIT_SHA^{commit}" 2>/dev/null || die "dry-run source SHA is unavailable in the current checkout"
  docker compose --env-file "$AU_ENV_FILE" -f "$OPS_DIR/docker-compose.au.yml" -p "$COMPOSE_PROJECT_NAME" config -q
  run git clone --filter=blob:none --no-checkout "$CAIRN_REPO_URL" "$DEPLOY_ROOT/source"
  run git -C "$DEPLOY_ROOT/source" fetch --no-tags origin "$BACKEND_GIT_REF"
  run git -C "$DEPLOY_ROOT/source" checkout --detach "$BACKEND_GIT_SHA"
  if [[ "$MODE" == all || "$MODE" == db ]]; then run docker compose up -d db; fi
  if [[ "$MODE" == all || "$MODE" == backend ]]; then run docker compose build backend; run docker compose up -d backend; fi
  log "DEPLOY DRY RUN PASS: mode=$MODE source=$BACKEND_GIT_SHA; no filesystem/container changes made"
  exit 0
fi

source_dir="$DEPLOY_ROOT/source"
ensure_under "$source_dir" "$DEPLOY_ROOT"
if [[ ! -d "$source_dir/.git" ]]; then
  [[ -z "$(find "$source_dir" -mindepth 1 -maxdepth 1 -print -quit 2>/dev/null)" ]] || die "$source_dir is non-empty and is not a Git checkout"
  run git clone --filter=blob:none --no-checkout "$CAIRN_REPO_URL" "$source_dir"
fi

[[ -z "$(git -C "$source_dir" status --porcelain)" ]] || die "refusing to deploy from dirty checkout: $source_dir"
run git -C "$source_dir" fetch --no-tags origin "$BACKEND_GIT_REF"
git -C "$source_dir" merge-base --is-ancestor "$BACKEND_GIT_SHA" FETCH_HEAD || die "BACKEND_GIT_SHA is not reachable from fetched ref $BACKEND_GIT_REF"
run git -C "$source_dir" checkout --detach "$BACKEND_GIT_SHA"
actual_sha="$(git -C "$source_dir" rev-parse HEAD)"
[[ "$actual_sha" == "$BACKEND_GIT_SHA" ]] || die "checkout identity mismatch: expected $BACKEND_GIT_SHA, got $actual_sha"

source_ops="$source_dir/ops/australia"
[[ -f "$source_ops/docker-compose.au.yml" ]] || die "selected commit does not contain ops/australia"
compose_args=(docker compose --env-file "$AU_ENV_FILE" -f "$source_ops/docker-compose.au.yml" -p "$COMPOSE_PROJECT_NAME")
if [[ "$DRY_RUN" != 1 ]]; then "${compose_args[@]}" config -q; fi

if [[ "$MODE" == all || "$MODE" == db ]]; then
  run "${compose_args[@]}" up -d db
  if [[ "$DRY_RUN" != 1 ]]; then
    for _ in $(seq 1 60); do
      [[ "$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT_NAME}-db-1" 2>/dev/null || true)" == healthy ]] && break
      sleep 2
    done
    [[ "$(docker inspect -f '{{.State.Health.Status}}' "${COMPOSE_PROJECT_NAME}-db-1")" == healthy ]] || die "database did not become healthy"
  fi
fi

if [[ "$MODE" == all || "$MODE" == backend ]]; then
  if [[ "$DRY_RUN" != 1 ]]; then
    escaped_db="${DB_NAME//\'/\'\'}"
    table_count="$(MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -h127.0.0.1 -P"${DB_ADMIN_PORT:-3307}" -uroot -Nse \
      "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='$escaped_db';")"
    [[ "$table_count" -gt 0 ]] || die "database is empty; restore and verify data before starting backend"
  fi
  run "${compose_args[@]}" build backend
  run "${compose_args[@]}" up -d backend
  if [[ "$DRY_RUN" != 1 ]]; then
    for _ in $(seq 1 60); do
      curl -fsS "http://${BACKEND_BIND_IP:-127.0.0.1}:${BACKEND_PORT:-3001}/health" >/dev/null 2>&1 && break
      sleep 2
    done
    curl -fsS "http://${BACKEND_BIND_IP:-127.0.0.1}:${BACKEND_PORT:-3001}/health" >/dev/null || die "backend health check failed"
  fi
fi

if [[ "$DRY_RUN" != 1 ]]; then printf '%s\n' "$BACKEND_GIT_SHA" >"$DEPLOY_ROOT/state/deployed_git_sha"; fi
log "DEPLOY PASS: mode=$MODE source=$BACKEND_GIT_SHA"
