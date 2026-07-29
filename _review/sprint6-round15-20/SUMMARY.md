# Sprint 6 Rounds 15-23 Hardening — 2026-07-29 Overnight

Sleep-run session covering rounds 15-20 of adversarial review on Sprint 6
auth/push/friend/marker/GDPR-export/memory/session surface areas, plus
one client-side round on the pending-sync UX behavior.

## Incident: R9B7 auto-migration runner (avoided)

Attempted to implement R9B7 (auto-migration runner at boot). The runner
was correctly written (idempotent via `_schema_migrations` table), but
the FIRST boot with an empty registry attempted to apply all legacy
migrations 001-030 from scratch. Migration `004_auth_rebuild.sql` starts
with `DROP TABLE IF EXISTS sessions; DROP TABLE IF EXISTS pending_registrations;`
assuming a one-shot rebuild. On the live aliyun DB with existing data,
this dropped:

- `pending_registrations` (used by register/verify email flow)
- `sessions` (deprecated post-O1, no live data)

`DROP TABLE users` was blocked by FK constraint on `friends`, saving all
27 real users.

**Recovery**: manually `CREATE TABLE IF NOT EXISTS pending_registrations`
with the O18 schema (including `date_of_birth`). `sessions` left dropped —
it was already unused post-O1.

**Runner removed** from `backend/src/index.js` and `services/migrationRunner.js`
deleted. Ships never touched user data.

**Lesson saved**: `feedback_migration_runner_dry_run.md` — any future
runner must: (a) baseline `_schema_migrations` with all currently-applied
filenames on first deploy, (b) fail-closed on `DROP TABLE`, (c) support
`MIGRATION_DRY_RUN=1` mode, (d) tested against a local clone of the
production schema before shipping.

## Fixes deployed to production (backend)

| Round | ID | Severity | File | Summary |
|-------|----|----------|------|---------|
| R15 | B1 | Critical | routes/auth.js | PATCH /password now rate-limited per userId (10/15min) |
| R15 | B2 | Critical | routes/auth.js | Both password paths bump token_version + issue fresh token (universal sign-out) |
| R15 | B3 | Medium | routes/auth.js | refreshLimiter now correctly runs AFTER authenticate for per-user keying |
| R15 | B4 | Medium/DoS | models/DataExport.js | GDPR export: hard row caps on sessions/markers/memoryPoints/routes/friends |
| R15 | B5 | Critical | models/DataExport.js | Missing sessions table tolerated — every export was 100% failing before |
| R16 | F5 | Critical | models/DataExport.js | Narrow ER_NO_SUCH_TABLE match (was `/doesn't exist/i` — swallowed column drops) |
| R16 | F6 | Medium | models/DataExport.js | truncated flag now uses LIMIT CAP+1 pattern (exact-cap accuracy) |
| R16 | F7 | Defense-in-depth | routes/auth.js | Revoke caller's own jti explicitly on password change |
| R16 | F12 | UX correctness | routes/friends.js | /friends/accept response before push enqueue |
| R17 | F5 | Critical/leak | routes/markers.js | community-state + interact-nonce permission gate |
| R17 | F7 | Critical/mixup | models/PushNotification.js | Device transfer: delete stale-owner token row on register |
| R17 | F8 | Medium | models/PushNotification.js | Whitespace-only title/body normalization |
| R18 | doc | Backlog | routes/memory.js | client_id collation collision risk documented |
| R19 | #2 | Doc-only | routes/circle.js | /fog docstring corrected (hidden_items only applies to /markers /routes) |
| R19 | #5 | Medium | routes/sessions.js | Legacy PATCH per-point route_points validation |
| R19 | #4 | Doc | middleware/idempotency.js | Concurrent-request race documented + rationale for deferral |
| R22 | Q4 | Medium | routes/push.js | Rate-limit /push/register to blunt token-hijack (20/15min/user) |

## Fixes committed but NOT deployed (client)

**Sprint 6 R20** — three client-side pending-sync UX bugs. Requires real-device
test cycle before OTA per memory `feedback_ota_real_device_test_required.md`.

| ID | Severity | File | Summary |
|----|----------|------|---------|
| R20B6 | Critical | store/useSessionStore.ts | hydrate preserves syncState (infer from remoteId on legacy storage) |
| R20B5 | Blocker/data | services/syncDaemon.ts | orphan-sweep only marks synced when remoteId truthy |
| R20B2 | Critical | screens/HomeScreen.tsx | recent-pill filters out pending sessions |
| R20B7 | Critical | store/useSessionStore.ts | addSession dedupes by remoteId too |
| R21B2 | Critical | store/useTrackingStore.ts | hydrateSaf01 gates on currentUserId (cross-user leak) |
| R21B1 | Critical | store/useAppStore.ts | logout clears SAF-01 state + disk blob |
| R21B3 | Medium | screens/HikingScreen.tsx | AppState listener resets ref on background transition |

Real-device test cycle needed:
1. Offline hike → force airplane mode → save
2. Land in Home → verify pending card is NOT the recent-pill target
3. Back online → verify sync completes and card becomes regular
4. Force-restart app while pending → verify hydrate keeps pending state
5. Trigger drainPending↔remoteHydrate race → verify no duplicate card

## Deferred with rationale

- R9B7 auto-migration runner — needs baseline + DRY-RUN + local test (see incident above)
- R15 findings 5+6+7 (dead code, legal review, load data)
- R15 findings 8-15 (Low or theoretical without customer impact)
- R16 F1-F4 (client coordination + partial-auth + timing + already-indexed)
- R17 BUG 6 (schema verified — false alarm)
- R18 ts trust (design choice for clock skew tolerance)
- R19 #4 idempotency reservation-first pattern (deferred pending retry-storm evidence)
- R19 #7 routes.js NaN/Infinity (already handled by Joi schema)
- R20 BUG-1 MapHistoryScreen tappable pending card (design intent needs reconfirmation)
- R20 BUG-4 syncDaemon permanent-failure orphan handling (needs error-taxonomy refactor)
- R23 findings A (nonce replay within TTL — mitigated by DB UNIQUE) + B (0,0 coord — no real attack vector) both deferred as theoretical

## Convergence signal

Round 23 found only theoretical hardening items, no exploitable bugs. This
is the natural stopping signal — the review has converged and further
rounds would produce diminishing returns without a fresh attack surface.

## Commit chain (all pushed to origin/master)

```
8890857 R22Q4     rate-limit /push/register
e5d6511 docs      R21 fixes added to summary
cac6316 R21       SAF-01 cross-user + stuck-ref (client)
0c654da docs      rounds 15-20 summary
68c91be R20       client-side pending-sync UX
a1bd695 R19       circle + sessions + idempotency
ca60771 R18       memory_points cid docs
2a81ce5 R17F5+F7+F8  marker + push + whitespace
479d895 R16F12    friends/accept response order
1006727 R16F5-F7  refinements of R15
2d9fc1a R15B3-B5  refresh + GDPR export safety
c4d8c52 R15B1+B2  password change hardening
```

## Production state at end of run

- Backend healthy: `{status:"ok", db:"ok"}`
- Users: 27 (unchanged from start)
- pending_registrations: 0 rows (schema restored w/ date_of_birth)
- memory_points: 2,384 rows (unchanged)
- All Sprint 6 schema + columns + FKs present + verified at boot
- Zero open Blocker/Critical bugs from rounds 15-23
