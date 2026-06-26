# Activity Data Sources for Memory Map

Spike subagent A — 2026-06-25
Question: How does Cairn currently store activity GPS data, and how should Memory map import past hiking/running tracks into `useH3VisitedStore` cells?

---

## TL;DR (decisions Memory needs)

1. There is **one** activity model in Cairn: `TrackingSession` ("session"). It covers both `hiking` and `running` via the `activityMode` discriminator. There is **no separate auto-track / passive-record table**. The only ambient GPS recorder is `ForegroundUnlockManager`, which already writes directly into `useMemoryStore` / `useH3VisitedStore`.
2. Past sessions live in **three** places: zustand `useSessionStore` (in memory), AsyncStorage (per-user, per-session blobs), and MySQL `sessions` table on the backend (canonical, includes `route_points` JSON).
3. **Local cache holds only summaries** after hydration. `trackPoints` are loaded **on demand** per session via `loadTrackPoints(id)` → AsyncStorage. Backend list endpoint also omits `route_points`; detail endpoint (`GET /api/sessions/:id`) returns the full polyline.
4. There is **no de-dup needed** between hiking/running and the Memory GPS watcher in terms of activity rows — they write to different stores. There IS implicit overlap of GPS points (Memory's `ForegroundUnlockManager` records continuously when `recordMode='always'`; an active hike also records via `useTrackingStore`), and this is intentional — Memory cells are deduped at the H3 cell level by `addPointToCells`.
5. `useH3VisitedStore.bulkImport` already exists and is designed exactly for this: chunked 50-point loop, yields between chunks, dedupes by H3 cell ID, single `cellVersion` bump at the end. Memory map can call it directly with the union of all completed session points.

---

## Storage

### Hiking + Running (unified — both are `TrackingSession`)

| Layer | Where | What it holds |
|---|---|---|
| Live tracking | `useTrackingStore` (zustand) | In-flight session: `trackPoints[]`, `trackPointsSmoothed[]`, `trackPointsRaw[]`, status, sessionId, remoteSessionId |
| Completed (local memory) | `useSessionStore` (zustand) | Summaries of last ≤ 100 sessions; `trackPoints` stripped (= `[]`) after hydrate |
| Completed (local disk) | AsyncStorage via `app/src/store/storage.ts` | Keys:<br>• `cairn_sessions_<userId>` — JSON array of summaries (no trackPoints)<br>• `cairn_trackpoints_<userId>_<sessionId>` — JSON array of TrackPoint per session |
| Completed (server, canonical) | MySQL `sessions` table (see schema below) | All fields incl. `route_points` JSON + `route_points_raw` JSON |
| Background live append | Same `sessions` row via `PATCH /api/sessions/:id/append-points` every 120s | Server-side audit + crash recovery |

User-scope key prefixing is enforced: `_<userId>` segment prevents cross-user data leak; on logout `clearSessions()` removes the key but orphaned per-session trackpoint keys are NOT enumerated (acknowledged tech debt in `useSessionStore.ts:140`).

### Auto-track ("自动录入") — does NOT exist as a separate table

Greps for `autoTrack`, `auto_track`, `autoRecord`, `background_tracking`, `passive_record`, `passiveTrack`, `alwaysTrack`, `自动` against `app/src` return **zero hits**. The feature that behaves like "auto-record while walking" is **Memory's foreground unlock**, which is gated by two settings in `useMemorySettingsStore`:

| Setting | Default | Effect |
|---|---|---|
| `foregroundAutoUnlockEnabled` | `true` | Master switch — start a 2s/5m `expo-location` watcher when app is foreground + user logged in |
| `recordMode` | `'always'` (alternative: `'session-only'`) | `'always'`: every fix calls `processReading()` → `useMemoryStore.recordPoint()`. `'session-only'`: only fires while a hiking/running session is active |

This watcher writes **only** to the memory layer (`useMemoryStore` → dual-writes to `useH3VisitedStore`). It does NOT create `TrackingSession` rows. So "auto-track" data is already inside the H3 cell store from the moment the user logs in with the default settings.

## Schema

### Frontend — `TrackingSession` (`app/src/store/useSessionStore.ts:26-45`)

```ts
{
  id: string;                  // client UUID-ish
  remoteId?: number;           // backend row id, set after sync
  activityMode: 'hiking' | 'running';
  regionCode: string;          // e.g. 'nz' — geo-extensible
  startedAt: number;           // Unix ms
  endedAt: number;             // Unix ms
  durationS: number;
  distanceM: number;
  elevationGainM: number;
  trackPoints: TrackPoint[];   // CLEAN polyline (Kalman, accuracy<25m, no teleports)
  trackPointsRaw?: TrackPoint[]; // FULL audit (only loaded if asked)
  markerIds: string[];
  pausePins?: Coordinate[];
  name?: string;
}

TrackPoint = { lat, lng, alt?, accuracy?, speed?, t (Unix ms) }
```

### Backend — `sessions` table (MySQL 8, migrations 002 + 007 + 008)

```sql
CREATE TABLE sessions (
  id           BIGINT UNSIGNED PK AUTO_INCREMENT,
  user_id      BIGINT UNSIGNED NOT NULL FK→users.id,
  type         ENUM('hiking','running') NOT NULL,
  start_time   DATETIME NOT NULL,
  end_time     DATETIME NOT NULL,
  distance_m   FLOAT NOT NULL DEFAULT 0,
  duration_s   INT   NOT NULL DEFAULT 0,
  name         VARCHAR(60) NULL,                -- migration 007
  route_points JSON  NULL,                      -- clean trackPoints
  route_points_raw JSON NULL,                   -- full audit, migration 008
  flags        JSON  NULL,                      -- marker IDs / pause pins
  created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_session_user(user_id),
  INDEX idx_session_time(user_id, start_time DESC)
);
```

### Status / completion semantics

- There is **no explicit `status` column**. Completion = "row was finalized via `PATCH /api/sessions/:id`" (sets `end_time`/`distance_m`/`duration_s`).
- An in-progress session is detected client-side via `useTrackingStore.status === 'tracking'|'paused'` and server-side by `route_points` having at least 2 entries.
- "Too-short" guard (both client and server): if `trackPoints.length < 2` OR `distanceM < 20`, the row is deleted (`DELETE /api/sessions/:id`) and not persisted locally.
- For Memory's purposes, **every row returned by `GET /api/sessions` is completed** (server only returns finalized rows that survived the too-short guard). No status filter needed.

### Scale (best-effort estimates from the code)

- Local cap: 100 most-recent sessions (`MAX_SESSIONS` in `useSessionStore.ts:47`).
- Typical session size: 1147 GPS points = ~1000 unique H3 res-11 cells (cited verbatim in `useH3VisitedStore.ts:7-9`). At 1147 points / hour-ish hike, the user's full history at 100 sessions ≈ 100k–150k raw points → ~80k–120k unique res-11 cells.
- Per-session trackPoints JSON in AsyncStorage: typically ~50KB clean + ~75KB raw.

## Auto-track Setting

- **Does not exist** as a named setting. Closest equivalents:
  - `useMemorySettingsStore.foregroundAutoUnlockEnabled` — file: `app/src/features/memory/store/useMemorySettingsStore.ts:48`, default **`true`**.
  - `useMemorySettingsStore.recordMode` — same file:49, default **`'always'`**.
- Data flow: GPS watcher in `ForegroundUnlockManager` → `processReading` (`unlockEngine.ts:46`) → `useMemoryStore.recordPoint` → `useH3VisitedStore.addPointToCells`. **No session row** is created.
- Therefore: under default settings, ambient-walk data is already in `useH3VisitedStore`. The gap Memory needs to fill is **hiking/running session points from BEFORE the H3 store existed for this user, and points from sessions on other devices** (server has them, but Memory currently never reads `sessions` table).

## Dedup

Question: do GPS points get written twice if user is hiking + auto-track is on?

- **At the activity layer**: no. `useTrackingStore` and `ForegroundUnlockManager` are independent location watchers. They both call `expo-location.watchPositionAsync` but write to different stores. There is no cross-pause logic (hiking does NOT pause Memory watcher; Memory watcher does NOT skip while a session is active under `recordMode='always'`).
- **At the H3 cell layer**: yes, dedup happens. `addPointToCells` (`useH3VisitedStore.ts:183-211`) keys by H3 cell ID at res 11. Repeated hits on the same cell only mutate `count`/`last`, never grow the Map. So even if a hiking session and Memory's watcher both record the same 1147 points, the cell count is identical to one source.
- **At the points-store layer** (`useMemoryStore.points`): there is a cull at insert (`recordPoint` checks `distanceSqMeters < CULL_THRESHOLD_M^2` where `CULL_THRESHOLD_M = 12.5m`). Two watchers firing within the same 12.5m radius produce one stored point, not two. (`useMemoryStore.ts:241-244`)
- **Implication for Memory import**: when we bulk-import past session trackPoints into `useH3VisitedStore`, we don't need to de-dup against the existing cells map — `addPointToCells` already does it. `bulkImport` even does in-place merge: pre-existing cell → mutate `count`+timestamps in place, new cell → insert.

## Recommended Memory import flow

### Goal

When the user opens Memory map (or at login boot), unlock H3 cells for every GPS point in every completed hiking/running session **plus** anything synced from the server. Result: fog evaporates over routes the user has actually walked, regardless of whether those routes happened in foreground-auto-unlock mode or in an explicit hiking/running session, and regardless of which device captured them.

### Phase 1 — One-time backfill on user login (or first Memory open)

1. After `useAppStore.hydrate` has called `fetchSessions()` and populated `useSessionStore.sessions[]` (this already happens in `useAppStore.ts:146-181`), schedule a deferred backfill (use the same `setTimeout(5000)` idiom as `ForegroundUnlockManager.tsx:151` — main thread already showed in v320 that 5s defer is required to avoid iOS watchdog).
2. For each session in `useSessionStore.sessions` where `trackPoints.length === 0` (local cache loaded summaries only):
   - If `remoteId` is set: call `fetchSessionDetail(remoteId)` → returns `{ route_points: TrackPointLike[] }` from `GET /api/sessions/:id`.
   - Else (rare; local-only un-synced session): call `loadTrackPoints(session.id)` → reads AsyncStorage `cairn_trackpoints_<userId>_<sessionId>`.
3. Map each loaded `TrackPoint` to the `bulkImport` shape: `{ lat, lng, ts: t }`.
4. Concat across all sessions → single flat array → `useH3VisitedStore.getState().bulkImport(points)`.

### Phase 2 — Incremental sync (per new completed session)

After `stopTracking()` calls `useSessionStore.addSession(...)` (`useTrackingStore.ts:623`), also call `useH3VisitedStore.getState().bulkImport(session.trackPoints.map(p => ({ lat: p.lat, lng: p.lng, ts: p.t })))`. Most of these cells are already present (Memory's foreground watcher saw them in real time under default settings) — `bulkImport`'s in-place cell mutation makes this a cheap no-op for those cells.

### Phase 3 — Bookmark cursor (avoid re-importing on every boot)

Persist last-imported session id in AsyncStorage:

```
key: cairn:memory:activity_import_cursor_<userId>
value: { lastImportedSessionId: <remoteId>, lastImportedTs: <ms> }
```

On boot, only iterate sessions with `endedAt > lastImportedTs` (or `id > lastImportedSessionId`). Drop the cursor on logout (mirror `clearSessions` semantics).

### Order vs the existing hydrate chain

Insert this AFTER `pullMemoryFromServer` (existing `ForegroundUnlockManager.tsx:205` step), because `pullMemoryFromServer` calls `replacePoints` which itself triggers a deferred `useH3VisitedStore.bulkImport` (`useMemoryStore.ts:566-579`). Doing activity backfill after that ensures cells from past sessions are union'd with cells from past Memory-watcher points, with no race.

```
boot:
  hydrate user
  → hydrateH3ForUser (cache)
  → hydrateMemoryForUser (replacePoints → defer 100ms → h3 bulkImport from cached points)
  → attachMemorySync
  → pullMemoryFromServer (may replacePoints again → another deferred bulkImport)
  → [NEW] activity backfill from useSessionStore + per-session detail fetch → bulkImport
```

### Performance budget — feasibility check

`useH3VisitedStore.bulkImport` (already in code, `useH3VisitedStore.ts:213-280`):
- Chunked 50 points / `setTimeout(0)` between chunks.
- Per point: 1 `h3.latLngToCell(lat, lng, 11)` call against `h3Pure` (pure JS, no WASM, ~230 LOC — v323 replacement for `h3-js`). h3Pure is documented as Hermes-friendly with no 32 MB ArrayBuffer alloc.
- 10 000 points → 200 chunks → 200 yield points → wall time roughly 200 × (chunk_compute + 0ms scheduler) ≈ a few seconds end-to-end. Main thread is unblocked every 50 points, so iOS watchdog cannot fire. Confirmed by the same chunking strategy already shipped in v311 for `replacePoints` → `bulkImport` cold-start flow.

For a typical heavy user (50 completed sessions × 1500 points avg = 75 000 points): backfill would take ~5–15s of background work, distributed across event loop ticks. User sees fog appear progressively (FogLayer's `cellVersion` is bumped only once at the end of `bulkImport`, but a multi-call pattern — one `bulkImport` per session — would produce N visible fog updates. Recommend a single concatenated `bulkImport` for the cleanest UX.).

### Robustness notes

- `bulkImport` calls `markH3InProgress()` at the start so an iOS SIGKILL mid-loop poisons the persistent gate (`h3LoadGate`) and on the next boot h3-js is permanently skipped → fog stays empty but app boots. We inherit this safety automatically by calling `bulkImport`.
- If `useH3VisitedStore.cells.size > some_cap` after import: not a concern at present scale, but Memory map render uses zoom-adaptive H3 resolution via `getResForZoom` (in `memoryConfig`), so very large cell counts only stress storage, not the renderer.
- `recordPoint`'s 12.5m cull is bypassed by `bulkImport` (it doesn't call `recordPoint`). This is correct — we want every GPS sample from past hikes contributing to a cell, not filtered by a cull intended for live 1Hz streams.

## Code references

| Concern | File:line |
|---|---|
| TrackingSession schema | `app/src/store/useSessionStore.ts:20-45` |
| Local persistence keys (per-user) | `app/src/store/useSessionStore.ts:49-51` |
| Hydrate (summaries only — trackPoints emptied) | `app/src/store/useSessionStore.ts:183-202` |
| On-demand trackPoints loader | `app/src/store/useSessionStore.ts:208-217` |
| Live tracking + 120s incremental flush | `app/src/store/useTrackingStore.ts:446-461` |
| Save completed session | `app/src/store/useTrackingStore.ts:623-641` |
| Too-short discard (<2 pts OR <20m) | `app/src/store/useTrackingStore.ts:489-505`, `586-595` |
| Server route POST (legacy all-in-one) | `backend/src/routes/sessions.js:19-62` |
| Server route start/append/finalize (incremental) | `backend/src/routes/sessions.js:75-194` |
| Server route GET detail (route_points) | `backend/src/routes/sessions.js:197-212` |
| Backend schema | `backend/src/migrations/002_sessions.sql`, `007_session_name.sql`, `008_session_raw_points.sql` |
| Client → fetchSessions on login | `app/src/store/useAppStore.ts:146-181` |
| Client → fetchSessionDetail (loads route_points) | `app/src/services/sessionService.ts:175-184` |
| Memory foreground watcher (the "auto-track" equivalent) | `app/src/features/memory/components/ForegroundUnlockManager.tsx:231-329` |
| Memory settings (foregroundAutoUnlockEnabled, recordMode) | `app/src/features/memory/store/useMemorySettingsStore.ts:48-49`, defaults at 47-58 |
| Unlock engine (radius=25m, speedGate=35km/h, accuracyGate=30m) | `app/src/features/memory/services/unlockEngine.ts:46-86`, `app/src/features/memory/config/memoryConfig.ts:16-41` |
| useH3VisitedStore.bulkImport (the target API) | `app/src/features/memory/store/useH3VisitedStore.ts:213-280` |
| useMemoryStore.recordPoint dual-writes to H3 | `app/src/features/memory/store/useMemoryStore.ts:233-266` |
| replacePoints → deferred bulkImport (existing pattern to mirror) | `app/src/features/memory/store/useMemoryStore.ts:530-584` |
| Memory sync push/pull (server canonical points) | `app/src/services/memorySync.ts:78-233`, `246-302` |

## Open questions for build

1. Where should the backfill run? Candidates: (a) inside `ForegroundUnlockManager` after `pullMemoryFromServer`; (b) in `useAppStore.hydrate` after `useSessionStore.setState`; (c) on Memory tab focus. Recommendation: (a), because FGUM already owns the 5s-defer-then-import pattern proven safe in v320.
2. Should we backfill **both** `trackPoints` (clean) and `trackPointsRaw` (audit)? Recommendation: clean only — raw includes stationary drift which would just hit the same cells anyway, and raw is gated by user opt-in / debug build in some configurations.
3. Should the bookmark cursor persist across logout, or only across in-session reboots? Recommendation: clear on logout (matches the existing user-scoped data lifecycle).
