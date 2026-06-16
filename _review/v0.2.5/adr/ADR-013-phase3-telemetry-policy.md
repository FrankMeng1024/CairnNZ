# ADR-013: Phase 3 telemetry policy — persistent queue, user_id, retention, PII

## Context
Phase 3 4-eye review (#3-2) raised four interrelated policy questions about
debug_events_v2 / TelemetryBatcherV2:

1. Plan §3.3 said "persistent queue" but neither C# nor TS impl persists to disk
2. user_id NULLABLE collapses anonymous-from-many-devices into one bucket in
   `GROUP BY user_id` analytics queries
3. No retention policy → table grows unbounded
4. PII risk via free-form `diagnostic` VARCHAR(1024)

Round-1 fixes already applied:
- ✅ Rate limit on /api/v025/debug-events (60 req/min/IP)
- ✅ stripPii() filter on diagnostic (lat/lng + email patterns → `[redacted-*]`)
- ✅ Comment in TelemetryBatcherV2 corrected: "in-memory bounded queue" not "persistent"

This ADR records the four decisions still open.

## Decision

### A. Persistent queue → defer to Phase 4 with explicit AsyncStorage / file backing
- Phase 3 ships with **in-memory bounded queue** (1000 events, oldest-drop overflow)
- Phase 4 wires:
  - **Unity side**: serialize queue snapshot to `Application.persistentDataPath/v025_telemetry_queue.json`
    on `OnApplicationPause(true)` and `OnApplicationQuit`; restore on Awake
  - **RN side**: `AsyncStorage.setItem('v025.telemetry.queue', JSON.stringify(queue))` on
    AppState change to background; restore on app boot via TelemetryBatcher constructor
- Phase 4 4-eye review verifies both restore paths work after an app force-kill

### B. user_id bucketing → keep NULLABLE + document; add device_install_id later
- Phase 3 keeps user_id NULLABLE — events emit before sign-in (boot crash) need a row
- Analytics queries that aggregate by user MUST `WHERE user_id IS NOT NULL`
  (document this in BACKEND_QUERIES.md when Phase 4 writes it)
- Future v0.2.6 may add `device_install_id VARCHAR(64) NULL` column for
  anonymous-but-distinguishable bucketing — out of scope for v0.2.5

### C. Retention → 30-day TTL via background cron in Phase 4
- Backend cron job runs nightly: `DELETE FROM debug_events_v2 WHERE received_at < NOW() - INTERVAL 30 DAY`
- Implementation: backend/scripts/cron/debug-events-purge.js (Phase 4)
- For v0.2.5 closed beta the table will not exceed 1M rows in 30 days at expected
  spawn rate (~50 events/spawn × 100 spawns/user/day × 100 users = 500k events/day)

### D. PII filter — already partially shipped; document allow-list approach
- ✅ Round-1 fix: stripPii() removes lat/lng decimal coords + email patterns
- This is a deny-list approach. Long-term safer pattern: enum-keyed structured
  diagnostic ({code: 'plane_rejected_b6', ext: {...numeric metrics...}}) — but
  that's a wire schema change requiring CR.
- Phase 4 does NOT change wire schema; only adds new patterns to deny-list as
  needed.
- Developer guideline: NEVER write free-form lat/lng / email / phone into
  diagnostic. Use telemetry numeric fields if precise coords are needed for debug.

## Consequences
- (+) Phase 3 has rate-limit + PII deny-list + bounded queue (no obvious abuse vector)
- (+) Phase 4 wiring has clear scope: persistence + retention cron + analytics docs
- (-) Crash-during-spawn telemetry may be lost in Phase 3 (pre-Phase 4 persistent queue)
  — acceptable for closed beta where users can re-trigger
- (-) Anonymous events from different devices share user_id=NULL bucket; analytics
  needs awareness

## Failure modes
- Spawn-flow crash before flush in Phase 3 = lost diagnostics → users in closed beta
  re-trigger ≈ usually recoverable
- PII deny-list miss (e.g. phone number formats) → escalate as encountered
- Cron job not deployed in Phase 4 → table grows; alert via disk usage monitor

## Expiration phase
Phase 4 (EAS build #1) — persistent queue + retention cron + analytics docs

## Status
active

## Signoff
- Main agent: 2026-06-17
- User review pending
