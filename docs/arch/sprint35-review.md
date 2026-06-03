# Arch Code Review — Sprint 35

**Verdict**: PASS
**Reviewer**: Arch subagent (claude-opus-4-6)
**Date**: 2026-05-16

## Issues

| Severity | Description | Story |
|----------|-------------|-------|
| Medium | Health endpoint returns `{status, db, version, timestamp}` but API_SPEC.md specifies `{status, version}` only. Extra fields are additive and non-breaking — update spec to reflect reality. | STORY-00118 |
| Medium | Rate limiting (10 req/15 min per IP) not documented in API_SPEC.md. Clients need to know about 429 responses. | STORY-00118 |
| Medium | `API_BASE_URL` defaults to `http://localhost:3001` — no HTTPS enforcement documented for production. Ensure production config enforces HTTPS to protect JWT tokens in transit. | STORY-00119 |

## Spec Drift

| Description | Confirmed Fixed |
|-------------|----------------|
| API_SPEC.md originally referenced Firebase Auth. CR-004 replaced this with custom JWT auth (`POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`). Backend implements all three endpoints with correct paths, request/response shapes `{token, user: {id, name, email}}`, and JWT Bearer authentication on `/me`. | ✅ Yes |

## Summary

No Blockers or Critical issues. Three Medium items flagged for backlog. Spec Drift from Firebase→JWT is confirmed fixed. Sprint 35 integration may proceed.
