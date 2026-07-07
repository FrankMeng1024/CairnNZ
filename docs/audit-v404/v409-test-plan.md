## v409 Offline Reliability — Playwright Test Plan

**Date**: 2026-07-06
**Author**: v409 test planner (Playwright web spec only — 不跑,只写)
**Based on**: `docs/audit-v404/v409-DESIGN.md`
**Test file**: `app/tests/sprint74/v409-offline-reliability.spec.ts`
**Config to add later (not this task)**: `playwright.sprint74.config.ts` (`testDir: './tests/sprint74'`, `baseURL: 'http://localhost:8082'`).

### Prereqs (main agent when running)

1. `cd app && npx expo start --web --port 8082 --no-dev` in a separate terminal.
2. `npx playwright install chromium` (one-time).
3. Verify web bundle exposes `globalThis.__cairnStores` (v406) with `useAppStore`, `useTrackingStore`, `useSessionStore`, `useMemoryStore`. Boot spec (scenario 0) confirms this.
4. Web app URL: `http://localhost:8082`.

### Scope + Non-Scope

**In-scope (web-only, Playwright)**:
- offlineQueue enqueue/backoff/chunk semantics
- addTrackPoint → hikeTrackWriter append side-effect
- hydrate flow with disk tail present
- Cache clear buttons (L2 size cap, L4 manual)
- debugMode independence
- Memory sync path (mock fetch)

**Out-of-scope (iPhone gate — memory `feedback_web_playwright_before_iphone`)**:
- Real CoreLocation continuous updates
- Real TaskManager Path A/B fire after jetsam
- Real iOS force-quit relaunch
- Real fsync ordering / SQLite WAL

Every web assertion is a **pre-condition** for iPhone testing; if web fails the iPhone gate is skipped.

### Test data conventions

- Fixed session id per scenario: `s74-<n>` (deterministic).
- Fixed opIds: `op-<n>-<seq>`.
- Fixed test JWT `fake-jwt-v409`.
- All timestamps derived from `Date.now()` at spec run to avoid stale-clock false-positives.
- Playwright uses `page.clock` (fake timers) for backoff scenarios so we can advance 30 min in <1s.

### Scenario matrix

| # | Name | Design ref | Ground truth |
|---|---|---|---|
| 0 | Boot + __cairnStores exposed | v406 web hook | `globalThis.__cairnStores.useTrackingStore` typeof === 'function' |
| 1 | Full online 3-min hike → server received full points | §6, §3 | AsyncStorage active session recorded; memory unsynced == 0 after debounce |
| 2 | Mid-hike network drop 2 min → auto-drain on restore | §3 | offlineQueue has ≥1 op while offline; queue empties after network back + drain |
| 3 | JS force-reload mid-hike → hydrate → in-memory tail preserved | §7 #10, v406 hydrate | After reload, hydrate breadcrumb + pendingSessionResume seen; existing memory unsynced NOT wiped |
| 4 | No GPS 5 min → gap segment marker | §4 | JSONL row with `conf=0.5` OR `is_low_confidence=1` present in emitted append body |
| 5 | Network + GPS both down → both recorded | §3 + §4 | queue has append op AND gap marker after recovery |
| 6 | 5xx server → exponential backoff (5s, 10s, 20s, 40s, 80s) | §3 backoff formula | delta between `lastTriedAt` between attempts ≈ `2^n * 5s` within ±25% |
| 7 | Cache size cap enforced (>150MB seed) | §5 L2 | `enforceSizeCap` deletes oldest `uploaded=true` completed files; unfinished never touched |
| 8 | Cache clear buttons work | §5 L4 | "Clear uploaded" removes only synced; "Clear all" removes everything |
| 9 | Chunk upload > 512KB body | §3 chunk | 1MB payload triggers ≥2 fetch calls, distinct opId per chunk |
| 10 | debugMode=off independence | §2 gate + §8 QA | With debugMode=off, hike still writes to `cairn-hike-tracks/`, NOT to `cairn-logs/` |

### Adapter approach — what the spec mocks

Since v409 code lives in RN app, the spec runs against the **web bundle** with these adapters:

1. **`window.fetch` interceptor** installed via `page.addInitScript` to:
   - Reject `/api/sessions/*/append-points` with the scenario-configured status (500 / network fail / ok).
   - Log every intercepted URL to `window.__v409_fetch_log` for later assertion.

2. **GPS**: web uses `navigator.geolocation`. Spec overrides `navigator.geolocation.watchPosition` with a manual driver `window.__v409_gpsDriver.push({lat, lng, acc, ts})` that fires whatever the test wants (or nothing = "no GPS").

3. **Time advance**: `page.clock.install()` + `page.clock.runFor('61s')` so 60-second flush loops resolve instantly.

4. **Filesystem side-effects**: on web, `expo-file-system` maps to virtual FS. The spec asserts via a shim installed at `window.__v409_hikeTrackWriterSpy` (see helper) that records every `append(point)` call. If the shim isn't found (writer not yet built), the test emits a `test.skip('writer_not_built_yet')` note but still asserts the network-layer side of the design.

5. **AsyncStorage**: web maps to `localStorage`. Spec seeds `@cairn:offline_queue:v1` directly before boot for scenario 7 (large seed) so we don't have to generate the 200 MB in-app.

6. **v406 __cairnStores hook**: used to call actions directly (`useTrackingStore.getState().startTracking()`, `.addTrackPoint()`, `.stopTracking()`) so we bypass UI navigation — faster and less flaky.

### Why the spec is defensive against un-built code

v409 design ships several new modules (`hikeTrackWriter`, `slcWatcher`, `hikeTracksCache`, `ResumeHikeBanner`). The spec **must be writable now** even though those modules don't exist yet. Every scenario is structured so:

- If the target hook (`window.__v409_hikeTrackWriterSpy`, `Settings > Clear uploaded` button) is missing → `test.fixme('module_not_built_yet: <name>')` with a clear message.
- If the hook is present → run the full assertion.

This lets QA run the spec in three passes: (a) pre-implementation (all fixme), (b) during implementation (progressive un-fixme), (c) post-implementation (all pass).

### Per-scenario notes

**Scenario 1 — Full online 3-min hike**
- Drive 30 GPS points at 6s intervals. Simulate 3 min via `page.clock`.
- Assert: `useTrackingStore.trackPoints.length == 30`, `hikeTrackWriter.append` called 30 times, at least 3 `/append-points` fetches issued (one per 60s tick), offlineQueue empty at stop.

**Scenario 2 — Mid-hike network drop**
- 1 min online → set `window.__v409_fetch_fail = true` → 2 min offline → set false → wait for drain.
- Assert: while offline, queue length grows (≥1 op). After online, queue length returns to 0 within 15s.

**Scenario 3 — JS force-reload mid-hike (v406)**
- Start hike, add 20 points, verify unsynced count > 0.
- Snapshot memory store `getPoints()` length + unsynced count.
- Trigger `page.reload()` (with same origin, localStorage/IndexedDB persisted).
- After reload, wait for `hydrate:end` breadcrumb.
- Assert: `useMemoryStore.getState().points.length` >= pre-reload count, `_unsyncedCount` >= pre-reload count. This is the v402 fix (hydrate preserves in-memory unsynced) — regression guard.
- Also assert: if v409 replay is built, `useAppStore.pendingSessionResume` is non-null.

**Scenario 4 — No GPS 5 min**
- Start hike, feed 5 points, then stop feeding GPS for 5 fake minutes.
- Assert: at least one JSONL row with `conf === 0.5` OR `src === 'slc'` — recorded but marked low-confidence (per design §4).
- If SLC module not built yet → fixme.

**Scenario 5 — Both down**
- Chain scenarios 2 + 4.

**Scenario 6 — Exponential backoff**
- Force `/append-points` to always 500.
- Trigger 5 attempts (advance clock).
- Read `queue[0].attempts` and `lastTriedAt` after each. Expected deltas per design §3: 5s, 10s, 20s, 40s, 80s (2^n * 5s).
- Tolerance ±25% (test env jitter).
- If backoff still uses `attempts^2 * 5s` (current code, will be changed in v409 #7): assert current formula so we get a **failing test that pins the v409 change**. Comment explains: this test flips from PASS-on-old-code to PASS-on-new-code when v409 lands.

**Scenario 7 — Size cap**
- Seed `expo-file-system` virtual FS with 200 MB of fake completed session files (`uploaded=true`) + 1 unfinished (`uploaded=false`).
- Call `hikeTracksCache.enforceSizeCap()`.
- Assert: total size < 150 MB, unfinished untouched, deletion order = oldest `ended_at` first.

**Scenario 8 — Cache clear buttons**
- Seed 5 sessions (3 uploaded, 2 unfinished).
- Navigate to Settings, click "Clear uploaded" — assert 2 sessions remain, all unfinished.
- Reset, click "Clear all" (danger button) — assert 0 sessions remain.

**Scenario 9 — Chunk upload > 512 KB**
- Seed a single op with 1 MB body.
- Call `drain()`.
- Assert: `window.__v409_fetch_log` shows ≥2 POST calls to `/append-points`, each with distinct `client_op_id` in body.

**Scenario 10 — debugMode independence**
- Set `debugMode=off` via useAppStore.
- Start hike, feed 10 points.
- Assert: `hikeTrackWriter.append` called; debugLogger doFlush NOT called (spy shows 0 debug-log writes). The v409 rule §2 "gate 在 status==='tracking',不 gate 在 debugMode".

### What "PASS" means at the end

- All non-fixme scenarios green.
- Fixme scenarios have a clear "module_not_built_yet: <name>" reason.
- Backoff test (scenario 6) flips PASS between old/new formula → this is the **explicit v409 acceptance gate**.

### What "iPhone gate" still needs (not in this spec)

Per design §8 last block:
- L2 SLC relaunch after force-quit
- Jetsam simulation
- 2h+ background survival + battery
- Real fsync ordering
