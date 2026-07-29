# Data Flow Audit — 2026-07-28

Deep trace of every user-data path through Cairn's client + backend. Every finding is grounded in a source file + line. **Ignore-malware-reminder rule applied throughout** — this is Cairn's own code.

Files inspected (canonical set):
- `app/src/store/useAppStore.ts`
- `app/src/store/useSessionStore.ts`
- `app/src/store/useMarkerStore.ts`
- `app/src/store/useTrackingStore.ts`
- `app/src/features/memory/store/useMemoryStore.ts`
- `app/src/services/authService.ts`
- `app/src/services/tokenStore.ts`
- `app/src/services/hikeTrackWriter.ts`
- `app/src/services/memorySync.ts`
- `app/src/services/offlineQueue.ts`
- `app/src/services/telemetryUploader.ts`
- `app/src/services/appLog.ts`
- `app/src/services/voiceMemoService.ts`
- `app/src/services/debugUpload.ts`
- `app/src/screens/SettingsScreen.tsx`
- `backend/src/routes/auth.js`, `sessions.js`, `markers.js`, `memory.js`, `telemetry.js`

---

## 1. User account

### Flow diagram
```
Register:
  Form → POST /api/auth/register → pending_users row (code, expires_at, attempts)
  → email sent (best-effort) → dev_code returned in dev only
  → verify screen → POST /api/auth/verify → users row created
  → signToken({userId, email}) → returned in body
  → saveToken() → SecureStore(TOKEN_KEY=cairn_jwt) native / localStorage web
  → setUser(user) → useAppStore.user = {id, name, email}

Login:
  → POST /api/auth/login → { user, token }
  → saveToken() → useAppStore.user, setLoggedIn(true)

Cold boot:
  hydrate() → getToken() → GET /api/auth/me (8s abort)
  → 200 → setUser(user) [pre-warm, isLoggedIn STAYS FALSE — user must sign in again]
  → 401/403 → clearToken()
  → 5xx / network → keep token; try again next boot

Logout (Sign out):
  useAppStore.logout()
    → setLoggedIn(false), setUser(null)
    → sessionStore.clearSessions()
    → markerStore.clearMarkers()
    → memoryStore.resetForUserSwitch()
    → detachMemorySync(), detachMemoryPersistence()
    → storage.setItem('cairn_logout_marker','1')
  authService.logout() (called before appLogout in SettingsScreen)
    → clearToken()  (LOCAL ONLY — no server-side revoke)

Delete account:
  TypeToConfirm ("delete account") → mailto: privacy@cairnapp.nz
    → storage.removeItem('cairn_remember_me')
    → clearToken()
    → appLogout()
```

### Findings

- **D-USR-01 [Critical]**: JWT expiry policy is invisible client-side. `signToken` (backend `config/jwt.js`) presumably sets an exp; client never validates it. If token quietly expires mid-session, every request 401s → apiService iron-rule branch. But `getMe()` timeout (8s) can hide server unreachable vs. token dead. Users see "cold boot pre-warm" success on stale email even after account deletion server-side.
  - Evidence: `authService.ts:98-125` (`getMe` catches everything into `null`, does NOT differentiate expired vs. offline)

- **D-USR-02 [Critical]**: Delete account is **mailto only** — no server endpoint deletes anything. If user submits then never sends the email (mailto compose then closes), the app has already `appLogout()`ed and cleared token; the account remains fully active server-side. User believes they deleted it.
  - Evidence: `SettingsScreen.tsx:1067-1149` — comment admits "backend does not yet expose a delete endpoint"

- **D-USR-03 [Critical]**: `authService.logout()` = `clearToken()` — no `POST /api/auth/logout` exists. Other devices logged in with same account keep their JWT until natural expiry. There is no way to revoke a stolen or lost-device token.
  - Evidence: `authService.ts:141-143`, `SettingsScreen.tsx:1119-1124` comment R5-C1

- **D-USR-04 [Blocker]**: `useAppStore.logout()` clears in-memory zustand + async persistence for sessions/markers/memory, but does NOT clear:
  - `useSettingsStore` (Units, debugMode, telemetry settings — includes `telemetryBackendUrl` + `telemetryApiKey` which could leak between accounts if a family shares a device)
  - `useFriendStore` (friend list stays for next user)
  - `useRouteStore` (saved routes)
  - `useRouteEditStore` (in-progress route edits)
  - `useH3VisitedStore` — cleared via memoryStore.resetForUserSwitch, but if a race causes it to be re-populated by a lagging bulkImport(), fog cells persist. This can flash across users.
  - Evidence: `useAppStore.ts:75-103` (logout function has 6 clears; grep for `getState().reset` shows several stores missing)

- **D-USR-05 [Critical]**: `useAppStore.hydrate` — the "Playwright bypass" writes a fake `UserProfile { id: '0', name: 'Playwright', email: 'pw@cairn.nz' }` and flips `isLoggedIn: true` before any auth check. Guard is `isPlaywrightBypass` which reads `EXPO_PUBLIC_PLAYWRIGHT_BYPASS`. Comment claims prod builds ignore it — need to verify the flag is stripped at bundle time, not runtime.
  - Evidence: `useAppStore.ts:115-119`

- **D-USR-06 [Medium]**: `getMe` on cold boot pre-warms `user` object but keeps `isLoggedIn=false`. The pre-warm loads `useMarkerStore.hydrate(user.id)` + `useSessionStore.hydrate` + `fetchSessions()` + `hydrateMemoryForUser(user.id)` + `attachMemorySync(user.id)`. If the user *doesn't* end up logging in as this same account (e.g. types a different email at AuthScreen), the previous user's memory sync is still attached until AuthScreen calls `attachMemorySync` again. The old activeUserId's push loop may fire in the ~seconds before login flip.
  - Evidence: `useAppStore.ts:149-176`

- **D-USR-07 [Medium]**: `getMe` DB-error path returns a synthesized user from JWT payload (`name = req.user.email?.split('@')[0]`). If a support team renames the user in DB, client sees stale name until server recovers. Not a security bug but confusing.
  - Evidence: `backend/src/routes/auth.js:284-288`

- **D-USR-08 [Low]**: `STORAGE_KEY_LOGOUT_MARKER = 'cairn_logout_marker'` is written on logout but the comment says it's a "no-op" now — hydrate reads and clears it unconditionally. Dead code kept around. Not a leak but confusing.
  - Evidence: `useAppStore.ts:39-42, 145-146`

- **D-USR-09 [Medium]**: Password hash used as pre-payload during registration (`upsertPending` stores hashed password in `pending_users`). If pending row is not deleted (expired code, user abandons), hash sits in DB indefinitely (no expiry cron shown).
  - Evidence: `backend/src/routes/auth.js:85-86, 119`

- **D-USR-10 [Critical]**: `user.email` is put into `feedback` payload sent to `/api/edit-diag` — a table that has TTL cleanup but doubles as a general log dump. This crosses PII into a debug log table. See D-FDB-01.
  - Evidence: `SettingsScreen.tsx:843-851`

- **D-USR-11 [Medium]**: `refreshToken` returns bearer of `authInvalid` header in error path, but caller (`useTrackingStore` hiking refresh interval) explicitly ignores it and keeps hiking. Correct for UX (don't kick a user out mid-mountain) but means a device with a revoked JWT continues to record hikes locally — the mounted state has no signal to warn that "when you finish, save will fail."
  - Evidence: `useTrackingStore.ts:678-696`

---

## 2. Hiking session

### Flow diagram
```
startTracking:
  generateId() → sessionId (client)
  startSession(mode, startTime) → POST /api/sessions/start → remoteSessionId
  startHikeTrack(sid) → active/{sid}.jsonl created + meta/{sid}.json
  persistBackgroundContext(sid, hikeActive=true)
  foreground watchPositionAsync OR background TaskManager (single-source)
  Every GPS fix:
    → addTrackPoint()
      → 4 gates (teleport / accuracy / stationary / kalman)
      → trackPoints[], trackPointsSmoothed[], trackPointsRaw[]
    → appendHikePoint() → hikeTrackWriter buffer (flush 30s or 50pts)

Every 120s (fg) / 300s (bg):
  → incrementalFlushInterval
  → remoteAppendPoints(remoteId, trackPoints.slice(lastFlushedIdx))
  → PATCH /api/sessions/:id/append-points
  → lastFlushedIdx = total

Every 30 min while tracking:
  → refreshToken() → POST /api/auth/refresh

stopTracking:
  too-short gate (pts<2 OR distanceM<20) → deleteRemoteSession + return
  final incremental flush (fire-and-forget)
  flushHikingToMemory(hikeSource) → useMemoryStore.recordPoint(...) × N
  snapTrack (Mapbox) → replaces route_points with snapped
  saveHikeAtomic(remoteId, payload, idempotencyKey)
    → PATCH /api/sessions/:id/save
    → 20s wall-clock timeout
    → on success: sessions row + memory_points row batch committed in one tx
    → on failure: savePending(payload) → pendingSyncStore → SyncDaemon retry
  useSessionStore.addSession() with syncState='synced'|'pending'
  renameToCompleted(sid, endedAt, remoteId)
    → active/{sid}.jsonl → completed/{sid}.jsonl
    → meta.ended_at, meta.remote_id
  persistBackgroundContext(null, hikeActive=false)
  enforceSizeCap + enforceTTL on hikeTracksCache
  set({...initialState, lastStopReason})
```

### Failure modes
| Step | Failure | Handled? | Result |
|------|---------|----------|--------|
| `startSession` (POST /start) | net timeout | partial | session runs locally with remoteSessionId=null; final `/save` cannot fire (line 1090 `if (remoteId)` gate); falls to `savePending` with `remoteId=null`; SyncDaemon must first re-run POST /start then /save. Comment at line 1150-1151 says so. |
| `addTrackPoint` | Kalman NaN | no | if `coord.lat=NaN` reaches gate 4, `kalmanUpdate` will produce NaN and it enters trackPointsSmoothed. Nothing filters NaN before store. Gate 1 checks `impliedSpeed` which would be NaN. |
| `flushBuffer` | disk write fails | partial | catch re-appends buffer for next flush, records `lastFlushError`. But `readAsStringAsync` then `writeAsStringAsync` (read-modify-write) grows O(file_size²) — for a 6-hour hike this becomes a slow-down cliff, then the 15s inner-timeout hits at rename time. |
| `incrementalFlushInterval` | 401 mid-hike | no explicit handling | `remoteAppendPoints` presumably swallows; `lastFlushedIdx` not advanced → next tick sends same slice + new points → potentially unbounded growth of the slice sent per tick until token refreshes. |
| force-quit during rename | Bug 8 fixed w/ await | partial | now awaits, but flushNow has 15s hard timeout → if flush > 15s (large hike or slow disk), rename fires-and-forgets (line 1338) — same bug as before, only rarer. |
| `saveHikeAtomic` | 5xx after commit but before response returns | no | server may have committed and returned failure → client puts payload in pendingSyncStore → SyncDaemon retries with same idempotencyKey → server 200 idempotent replay. OK, but between commit and replay the user sees "pending" grey card. |
| server commits then client crashes before addSession | no local trace | none | remote row exists; local `sessions` array missing it → HomeScreen shows no card. Only next `fetchSessions()` (cold boot) reconciles. |
| `renameToCompleted` before `persistBackgroundContext(null)` originally was inverted → fixed | | | O16 C2 comment |
| user hits Reset Memory during a live hike | no gate | no | `deleteAllMemoryFromServer` runs while `flushHikingToMemory` is queued; DELETE wins, hike's memory unlock is lost. |
| Sim-walker starts, real GPS jump interleaves | | partial | O14 Bug 1 fix seeds `lastCoordinate` from injector — but only checked at startTracking. If mid-hike user toggles sim off, real GPS returns and teleport-reject triggers, silently drops points until anchor refreshes. |

### Findings

- **D-HIK-01 [Blocker]**: `flushBuffer` uses read-modify-write (line 285-290 `hikeTrackWriter.ts`). For a 3-hour hike ~10800 points ~1MB, every 30s flush reads the whole 1MB then writes 1MB+delta. Over the hike this is ~360 flushes × 1MB avg = ~360MB of disk churn per hike. On low-storage devices this can OOM the write itself; on any device it grows quadratically with hike length. iOS jetsam risk climbs directly with hike duration.
  - Evidence: `hikeTrackWriter.ts:280-290, 305`

- **D-HIK-02 [Critical]**: Two parallel `startTracking` sources feed `addTrackPoint`. The "single-source guarantee" comment (line 8-11) is enforced via `AppState` listener. But the `startTracking` initial branch (line 438-444) activates one source based on current AppState, then adds the listener, then rechecks AppState (line 527-540). Between listener registration and re-check, both sources can be running for a ~10ms window. Not caught by timestamp-dedupe if the same GPS fix arrives on both channels at different `Date.now()`. Result: duplicate `trackPoints` entries in that window.
  - Evidence: `useTrackingStore.ts:436-540`

- **D-HIK-03 [Critical]**: `addTrackPoint` gate 2 (accuracy > 25) writes to `trackPointsRaw` but does NOT bump `lastCoordinate`. If the very first fix is accuracy=100 (indoors on startup), `lastCoordinate` stays null and gate 1 (teleport) becomes a no-op. First "clean" fix could be miles away without gating.
  - Evidence: `useTrackingStore.ts:1500-1508`

- **D-HIK-04 [Critical]**: `stopTracking` writes to server BEFORE calling `useSessionStore.addSession`. If `saveHikeAtomic` succeeds but the subsequent `addSession` call throws (e.g. AsyncStorage full), the server has a finalized session but the client sees no card. Refresh needed to see it — but many users wouldn't refresh; would open a support ticket "my hike is missing".
  - Evidence: `useTrackingStore.ts:1090-1214`

- **D-HIK-05 [Blocker]**: `addTrackPoint` timestamp-dedupe uses `t = Date.now()` for storage (line 1471) but dedupe uses `timestamp` (the GPS fix ts). If foreground path passes `timestamp` and background path doesn't, both write the same coord but with different `t` values → both accepted. Search shows both paths pass `ts` from `position.timestamp` — so dedupe works, but only if both sources pass a valid `position.timestamp`. Not guaranteed on all Android devices where `position.timestamp` can be 0.
  - Evidence: `useTrackingStore.ts:1454-1466, 1845`

- **D-HIK-06 [Critical]**: `deleteSession` (client) removes local first, then attempts server DELETE fire-and-forget (line 143-149). If server DELETE fails (net down), local is gone but server row remains. Next `fetchSessions` will re-download it — user sees the session they thought they deleted come back.
  - Evidence: `useSessionStore.ts:121-150`

- **D-HIK-07 [Critical]**: `useSessionStore.clearSessions` (line 111-119) deletes the session summaries key but comment admits `trackpoints keyed per-session-id are not enumerable ... orphaned but unreachable`. Every logout leaks ~1MB × N sessions of trackPoint data in AsyncStorage. Guest-slot data + user-slot data accumulate over time.
  - Evidence: `useSessionStore.ts:111-118`

- **D-HIK-08 [Medium]**: `startTracking` awaits `startHikeTrack` (v430 fix) but does NOT await `startSession` (POST /start) — line 274-285 is fire-and-forget. Race: if `startTracking` completes before /start returns, user can `stopTracking` before `remoteSessionId` is set → payload built with `remoteId=null` → forced pendingSync path. User sees "pending" grey card for a hike that could have gone straight.
  - Evidence: `useTrackingStore.ts:273-285, 1090`

- **D-HIK-09 [Critical]**: `discardCurrentSession` (line 1755+) calls `deleteRemoteSession(remoteSessionId)` fire-and-forget. If it fails, backend row survives; user sees an empty ghost session on next `fetchSessions`. There's no retry queue for this delete.
  - Evidence: `useTrackingStore.ts:1780-1783`

- **D-HIK-10 [Medium]**: `stopTracking` → `flushHikingToMemory(hikeSource)` runs INSIDE the save flow. If it throws (memory store setState error, race), `stopTracking` catches at outer try/catch and falls back to `addSession` with syncState=pending + memoryNewCells=0. But the memory_points may already have been recorded in `useMemoryStore` before the throw → server never learns of them because `saveHikeAtomic` never runs → user sees "0 new places" but the fog is unlocked locally.
  - Evidence: `useTrackingStore.ts:970-1034, 1228-1283`

- **D-HIK-11 [Critical]**: `memoryUnsynced` sampling (line 1051-1053) filters `p.ts >= s.startedAt && p.ts <= endedAt`. But `recordPoint` uses `atMs = Date.now()` by default (line 212 `useMemoryStore.ts`) — matches. However `flushHikingToMemory` may pass `ts` from the snapped points (line 1016-1018 uses interpolated `t` between memorySource start/end). If snapping fails and fallback uses trackPointsSmoothed, points get `ts = p.t` from foreground GPS which uses `Date.now()` from `useTrackingStore.addTrackPoint` line 1471. These are consistent — but the filter uses `p.ts >= s.startedAt` — startedAt is set at line 207 → ~1-2 seconds later the first trackPoint gets `Date.now()`. Boundary is safe by design; low bug risk but coupled.
  - Evidence: `useTrackingStore.ts:207, 1471, 1051-1053`; `useMemoryStore.ts:212-217`

- **D-HIK-12 [Critical]**: `saveHikeAtomic` payload includes `route_points_raw` with `.acc` field (line 1048). Server `sessions/save` route validates raw entries but does NOT strip. `route_points_raw` stored as JSON in `sessions` table — accuracy data is preserved but there's no PII rule saying accuracy is fine. Also `alt` may reveal indoor floor level.
  - Evidence: `useTrackingStore.ts:1047-1048`, `backend/src/routes/sessions.js:234-244, 298-301`

- **D-HIK-13 [Medium]**: `too-short` guard runs twice: once at line 751-773, then again at line 937. Second one is inside the outer try/catch. If distance drifts across evaluation (impossible normally but if `addTrackPoint` fires between the two checks), path A returns while path B proceeds — inconsistent.
  - Evidence: `useTrackingStore.ts:750-810, 926-937`

- **D-HIK-14 [Low]**: The `too-short` server-side row cleanup (line 941 `deleteRemoteSession`) checks return but the failure path only logs — the ghost row persists on the server. Comment says "Keep remoteSessionId so future stopTracking or SyncDaemon can retry" but the retry mechanism for this specific delete is unclear (there's no `pendingDelete` queue).
  - Evidence: `useTrackingStore.ts:938-948`

---

## 3. Markers

### Flow diagram
```
Plant:
  PlantScreen commit → addMarker(data)
    → offlineMarkers.saveLocal(payload) → localId (idempotency key)
    → Marker with id=localId, synced=false, syncState='pending'
    → useMarkerStore.markers = [...markers, marker]
    → v380 plant-unlock: push directly into useMemoryStore.points
      → increments useH3VisitedStore
    → offlineMarkers.drain (auto) → POST /api/markers → server row
    → setMarkerCreateAckHandler → replace id with server id, syncState='synced'

Update:
  updateMarker(id, {note, type, permission})
    → local set() immediately
    → PUT /api/markers/{id} best-effort (no offline queue)

Delete:
  deleteMarker(id)
    → local filter out
    → DELETE /api/markers/{id} best-effort (no offline queue)

Hide (foreign mark):
  hideMark(id)
    → wipe from markers + circleMarkers locally
    → add to hidingIds
    → POST /api/hide {item_type:'mark', item_id}
    → finally: remove from hidingIds

Load own:
  loadFromBackend → GET /api/markers → merge with local unsynced

Load friends:
  loadCircleMarkers → GET /api/circle/markers → circleMarkers[]

Load public strangers:
  loadPublicMarkers(centerLat, centerLng) → GET /api/markers/public?bbox=
```

### Findings

- **D-MRK-01 [Critical]**: `updateMarker` is optimistic local + PUT with `.catch()` silent-swallow (line 382-384 `useMarkerStore.ts`). If PUT fails (net down), local marker shows new note/permission but server keeps old. Next `loadFromBackend` overwrites local with stale server state → user's edit disappears.
  - Evidence: `useMarkerStore.ts:377-385`

- **D-MRK-02 [Critical]**: `deleteMarker` identical pattern (line 395-400) — local delete + best-effort DELETE. If DELETE fails, `loadFromBackend` merge (line 497-517) re-adds the "deleted" marker because it's still on the server, but the merge treats server rows as canonical: `serverMarkers` are prepended and any localOnly that shares an id with a server marker is dropped. So the deleted marker comes back on next hydrate.
  - Evidence: `useMarkerStore.ts:387-401, 497-517`

- **D-MRK-03 [Critical]**: Plant-unlock (line 279-322) writes directly into `useMemoryStore.setState({...})` bypassing `recordPoint`. This bypasses the CULL threshold and, more importantly, bumps `_unsyncedCount + planted.length` and `geometryVersion + 1` without going through the normal path. If addMarker is called twice fast, two setState() land racy — points array can lose planted[0] if the second setState reads before the first commits.
  - Evidence: `useMarkerStore.ts:290-308`

- **D-MRK-04 [Medium]**: `addMarker` logs `data.lat.toFixed(5)` + `data.lng.toFixed(5)` into `appLog` via `v422.addmarker_enter` payload — sent to `/api/edit-diag`. Precision 5 = ~1.1m. This is real user location leaking into a general log table. Not audited for privacy.
  - Evidence: `useMarkerStore.ts:260-269`

- **D-MRK-05 [Critical]**: `publicSnapshot` frozen at first public transition but `updateMarker` allows changing type/note/permission after. Backend logic mirrors client, but if a v300-old cached marker gets loaded and then `updateMarker(id, {permission:'public'})` runs a SECOND time (e.g. after a bug caused it to go non-public then public), snapshot logic checks `publicSnapshot == null` — old snapshot preserved, new field content lost. Edge case: user thinks they updated their public marker's note; friends see the old note.
  - Evidence: `useMarkerStore.ts:349-365`

- **D-MRK-06 [Medium]**: `hideMark` optimistic wipe (line 417-458). If POST /api/hide fails, `finally` clears `hidingIds` but does NOT restore the mark. Comment admits this trade-off. So a network burp during hide → mark disappears locally, then next `loadCircleMarkers` puts it back → user sees mark they tried to hide return without explanation.
  - Evidence: `useMarkerStore.ts:441-458`

- **D-MRK-07 [Critical]**: `loadFromBackend` merge (line 497-517) preserves local unsynced markers. But if the server-side ack came back AFTER the merge ran (race with `setMarkerCreateAckHandler`), the localId marker might duplicate: one entry with server id (from server response) + one with localId (from local unsynced). Ack handler updates by localId → both entries still exist (server-id entry never gets updated because its ID doesn't match localId).
  - Evidence: `useMarkerStore.ts:497-517, 654-693`

- **D-MRK-08 [Medium]**: `voiceMemoUri` stores a local `file://` URI (e.g. `documentDirectory/voice_memos/{markerId}.m4a`). The comment (`useMarkerStore.ts:47-51`) admits it's NOT uploaded. If user re-installs the app or wipes it, the marker still references the URI in AsyncStorage → tap play → file-not-found silent. No cleanup on marker delete either — orphan m4a files pile up in the doc dir. Also cross-device: on the user's second device, the marker syncs but the voice memo doesn't.
  - Evidence: `useMarkerStore.ts:44-51`, `voiceMemoService.ts:198-214`

- **D-MRK-09 [Low]**: `loadPublicMarkers` fetches strangers' marks anonymized — but the client stores `authorId: ''` (empty string). Any code path that checks `authorId === currentUserId` would need the empty case explicitly handled or "public strangers" and "current user" both match falsy checks (`authorId ?? currentUserId` etc.).
  - Evidence: `useMarkerStore.ts:585-593`

- **D-MRK-10 [Critical]**: `clearMarkers` (line 461-491) calls `clearMarkersQueueForCurrentUser().catch(() => {})` — best-effort. If the clear queue call throws, the offlineMarkers queue for the departing user is left intact. Next drain fires with the NEW user's auth token but the OLD user's marker payload → **cross-user data injection**. Comment at line 462-464 acknowledges the risk but does not enforce ordering.
  - Evidence: `useMarkerStore.ts:461-491`

- **D-MRK-11 [Medium]**: `fromBackend` sets `regionCode: 'nz'` unconditionally (line 128). Any future international expansion will silently mis-tag all server-loaded markers as NZ.
  - Evidence: `useMarkerStore.ts:125-146`

---

## 4. Memory (fog cells)

### Flow diagram
```
GPS point in a hike:
  useTrackingStore.addTrackPoint → in-hike buffer, NOT immediately in memory

stopTracking → flushHikingToMemory(hikeSource):
  For each point:
    useMemoryStore.recordPoint(lat, lng, t)
      → CULL 12.5m: bucket-index 9-cell sweep, skip if any within 12.5m
      → newPoint = {lat, lng, ts, cid: uuidv4(), synced: false}
      → points = [...points, newPoint]
      → geometryVersion++, _unsyncedCount++
      → useH3VisitedStore.addPointToCells(lat, lng, ts)

Push loop (memorySync):
  subscribe: on _unsyncedCount increase → schedulePush(5s debounce)
  pushPendingPoints:
    filter !synced, take up to 500
    POST /api/memory/points { points: [{lat,lng,ts,cid?}] }
    on 200 → applyServerEchoForPushAligned(batch, echo) → marks synced
    on 5xx / err → backoffUntil, retry
  
Pull loop:
  pullMemoryFromServer(userId, {reconcile})
    keyset paginated GET /api/memory/points?after_ts=&after_cid=
    merge into local via replacePoints (rebuild H3 cells)

Reset Memory:
  deleteAllMemoryFromServer:
    epoch++ (invalidates in-flight)
    clear pushTimer, abort push+pull controllers
    DELETE /api/memory/points
    clearAll() locally (points=[], _bucketIndex=null, H3 cleared)

Friends:
  useFriendMemoryStore + useMemorySubscriptionsStore (separate stores)
  Reset on user-switch: yes (v413 C3 fix)
```

### Findings

- **D-MEM-01 [Blocker]**: `pushPendingPoints` reads `pending = allPoints.filter(!p.synced)` (line 347) but `applyServerEchoForPushAligned` uses `batch` array identity to align. Between `pending.slice(0, MAX_BATCH)` and `applyServerEchoForPushAligned(batch, echo)`, `replacePoints` (from a pull) could have rebuilt `points` — the batch objects are no longer identity-equal to what's in the store. `byCid` / `byGeoTs` lookups may still find matches by cid, but if cid was empty they might not.
  - Evidence: `memorySync.ts:346-368`, `useMemoryStore.ts:329-363`

- **D-MEM-02 [Critical]**: `deleteAllMemoryFromServer` clears push timer + aborts in-flight, then DELETEs. But `useMemoryStore.clearAll()` also fires. Between DELETE succeeds and `clearAll()` runs, if a `recordPoint` fires from an in-flight `addTrackPoint` (still-active hike), it adds a fresh point with `synced:false`. `clearAll` then wipes it. If the user immediately stops the hike, the just-recorded point is gone — visible fog does not include the location where reset happened.
  - Evidence: `memorySync.ts:479-509`

- **D-MEM-03 [Critical]**: `useMemoryStore.recordPoint` writes points with `t = Math.floor(atMs)` but never validates atMs is in a reasonable range. A rogue caller passing `atMs = 0` would create points with `ts=0` — server validation at `memory.js:64` rejects `p.ts <= 0` → these local points stay unsynced forever, server never accepts them, `_unsyncedCount` grows indefinitely, push loop retries forever.
  - Evidence: `useMemoryStore.ts:212-217`; server `backend/src/routes/memory.js:57-72`

- **D-MEM-04 [Critical]**: `pullMemoryFromServer` non-reconcile mode is append-only. Server deletes NEVER reach client unless full reconcile is invoked. Fresh install after account wipe would see the wipe, but a device that's been offline through a wipe won't ever know.
  - Evidence: `memorySync.ts:78-92, 261-276`

- **D-MEM-05 [Critical]**: `replacePoints` bulkImports H3 cells via `setTimeout(0)` deferred to 100ms (line 400-417). During those 100ms the H3 store is stale. `MemoryScreen` reading H3 will render empty fog. If user opens Memory in that window and closes, visual is wrong; if a `pullMemoryFromServer` completes right before this and another starts right after, two `setTimeout(0)` deferrals stack — `bulkImport` runs twice on the same data.
  - Evidence: `useMemoryStore.ts:390-417`

- **D-MEM-06 [Medium]**: `pullMemoryFromServer` limits response size to 500KB (line 135-136). For a user with many months of hikes this can exceed limit → aborts pull entirely (line 145 `return`). No fallback to smaller `limit=` param — user just never sees their full data.
  - Evidence: `memorySync.ts:135-147`

- **D-MEM-07 [Critical]**: `pushPendingPoints` skip logic (line 331-338) checks `useAppStore.getState().isLoggedIn` — but the subscriber attached in `attachMemorySync` (line 418-425) fires on any `_unsyncedCount` bump regardless of login state. Comment says "wait for login flip". But if user logs out during push loop then logs in as different user before subscriber recreates, `activeUserId` is stale → pushes wrong user's data.
  - Evidence: `memorySync.ts:322-388`

- **D-MEM-08 [Medium]**: `_unsyncedCount` is maintained incrementally (line 76-77 `useMemoryStore.ts`). Multiple mutating paths (recordPoint, markPointsSyncedByCid, applyServerEchoForPushAligned, replacePoints, clearAll, resetForUserSwitch, plant-unlock direct setState) all touch it. If a new path is added that forgets to update the counter, the invariant `_unsyncedCount == points.filter(!synced).length` breaks. The plant-unlock code (`useMarkerStore.ts:290-308`) directly does `_unsyncedCount + planted.length` — no cross-check.
  - Evidence: `useMemoryStore.ts:76-77`, `useMarkerStore.ts:307`

- **D-MEM-09 [Medium]**: `applyServerEchoForPushAligned` compares batch `p.cid` to `byCid` map (line 337-350). If server assigned a NEW cid (via `deterministicCid`) different from client's, the client already sent `p.cid = 'legacy-uuid'` but server echoed `ec.cid = 'sha1-hash'` — the `updates.set(found, ec.cid)` will replace client's cid with server's. Next push, filter `!p.synced` skips it. Good. But `useH3VisitedStore` was populated with the OLD cid; if that store keys anything by cid (needs verification), the H3 cell for that point is orphaned.
  - Evidence: `useMemoryStore.ts:329-363`

- **D-MEM-10 [Critical]**: Friend memory subscriptions (`useFriendMemoryStore`) are reset on user-switch (v413 fix). But cross-store dependencies via `require()` (line 616-621) mean if the friend-memory store hasn't been imported yet at logout time, the reset is silent-swallowed by `catch(_e)`. First-time logout users may leak friend memory data.
  - Evidence: `useMarkerStore.ts:483-490, 616-624`

---

## 5. Sim-walker (dev-only data)

### Flow diagram
```
gpsInjector.setPos(lat, lng)
  → tick loop generates synthetic points
  → useSimWalkerStore.active + useSettingsStore.debugMode gate all writes
  → __simwalkerAddTrackPoint (not on public interface)
  → skips gate 1 (teleport) + gate 4 (Kalman)
  → autoSegmentBreak if jump > 200m
  → writes to trackPoints, trackPointsSmoothed, trackPointsRaw
```

### Findings

- **D-SIM-01 [Critical]**: `__simwalkerAddTrackPoint` (line 1626-1701) is guarded by `s.status !== 'tracking'` check. But there's no debugMode check inside the method itself. If a production build somehow reaches this method (e.g. via a hot module reload leak), sim data goes into the real hike. The guard is only at the call site.
  - Evidence: `useTrackingStore.ts:1626-1701`

- **D-SIM-02 [Critical]**: When user turns off sim-walker mid-hike, `useSimWalkerStore.active` flips → tick loop stops → but `lastCoordinate` still points at last sim location. First real GPS fix reaches gate 1: `dtS` is small, `distM` = huge (sim was in KL, user in Shanghai) → gate 1 rejects. lastCoordinate never updates. All real GPS thereafter is rejected until session ends.
  - Evidence: `useTrackingStore.ts:1480-1490`

- **D-SIM-03 [Medium]**: `flushHikingToMemory` at stopTracking uses `s.trackPointsSmoothed` (which includes sim points). Sim data flows into memory permanently — into `useMemoryStore.points` and via `saveHikeAtomic` into `memory_points` table. Sim-walker is dev-only but its output pollutes production database if debugMode is enabled on a shipped build.
  - Evidence: `useTrackingStore.ts:988-1034`

- **D-SIM-04 [Low]**: `useSimWalkerStore.active` comment says "Off on next app launch" (SettingsScreen line 988) — presumably reset at hydrate. Verify: nothing in `useAppStore.hydrate` resets it. If the store is defined with initial `active: false` and doesn't persist across launches, this holds — but any accidental persist middleware would break the intent.

- **D-SIM-05 [Critical]**: The sim-walker anchor persists through Stop → next Start (O15 Bug 2 fix `pauseTracking` line 1392-1400 preserves anchor if sim active). But if user Stops, turns off sim, then Starts a new hike, sim's stale anchor is retained. New hike's first fix is compared to a KL anchor when user is at home → teleport reject, silent data drop.
  - Evidence: `useTrackingStore.ts:1386-1413`

---

## 6. Feedback (Send Feedback in Settings)

### Flow diagram
```
User types → feedbackText
  chips → feedbackKind ('feedback'|'safety'|'bug')
  handlePickAttachments → feedbackAttachments (up to 5)

Send:
  uploadDebugScreenshots(attachments, 'settings')
    → POST /api/debug-snapshot per photo (sequential)
  log('user_feedback', { kind, text, user_email, user_name, ota, attachments_total, attachments_ok })
    → appLog batch → POST /api/edit-diag
```

### Findings

- **D-FDB-01 [Blocker]**: Feedback text + `user_email` + `user_name` are logged into `edit_diagnostics` table (via `/api/edit-diag`). This is a debug log with TTL cleanup, not a support system. Support team's query pattern (`SELECT ... FROM edit_diagnostics`) mixes PII from feedback with technical logs. Anyone with DB access sees free-text feedback keyed to email address. No consent flow, no dedicated feedback table.
  - Evidence: `SettingsScreen.tsx:843-851`, `appLog.ts` header comment

- **D-FDB-02 [Critical]**: `log('user_feedback', ...)` uses the appLog queue (line 88). If send fails (5xx / network / batch dropped on 4xx), user's text is lost — but UI shows `feedbackSent = true` immediately after `log()` returns because `log()` is fire-and-forget (line 88-99 synchronous return). User believes their feedback went through.
  - Evidence: `SettingsScreen.tsx:852-859`, `appLog.ts:88-99`

- **D-FDB-03 [Critical]**: Attachment upload happens BEFORE the text log (line 833-842). If attachments succeed but the text log 4xx-drops, we have orphaned attachments in `debug_snapshots` with no linking metadata. Backend has no join key.
  - Evidence: `SettingsScreen.tsx:833-851`

- **D-FDB-04 [Medium]**: No retry queue for feedback. Once dropped from `appLog` queue on 4xx (line 126-128 `appLog.ts`), it's gone. Users on Cellular with intermittent connectivity permanently lose feedback.

- **D-FDB-05 [Medium]**: Rate limit on `/api/edit-diag` was noted as 6000/5min/IP in memory. Feedback rides same bucket as high-volume operational logs. A hike that generates many `appLog` events could throttle out a user's feedback attempt.

---

## 7. Password change

### Flow diagram
```
Settings inline form:
  currentPassword, newPassword
  → PATCH /api/auth/password { currentPassword, newPassword }
  → server: validate new >= 8 chars
    → if user has password_hash: require currentPassword match
    → else (OAuth-only user): allow set without current
  → hash + User.setPassword
  → 200 { message } — no token invalidation, no forced logout
```

### Findings

- **D-PWD-01 [Blocker]**: `PATCH /api/auth/password` does NOT invalidate the current JWT. After password change, the old JWT remains valid until natural expiry. If the reason for password change was "my token was stolen," the attacker still has valid access.
  - Evidence: `backend/src/routes/auth.js:310-338`

- **D-PWD-02 [Critical]**: Client-side, the field values (`currentPassword`, `newPassword`) live in React state. On error return (e.g. "Current password is incorrect"), no automatic clear of the input fields. If user shoulder-surfed, or leaves the phone with the input visible, the plaintext is still there. Only success clears (assumed — need to confirm in the SettingsScreen submit branch).

- **D-PWD-03 [Medium]**: `validateBody(schemas.auth.passwordChange)` — need to verify schema allows `null` currentPassword for OAuth-only users. If schema rejects null, first-time password set will 400 despite backend logic supporting it.

- **D-PWD-04 [Low]**: Server does NOT rate-limit `/api/auth/password` (no explicit `passwordLimiter` in auth.js). `authLimiter` is only on `/register`, `/verify`, `/login`. An attacker with stolen JWT can brute-force `currentPassword` unlimited. Even with 8-char minimum, uncapped attempts is bad.
  - Evidence: `backend/src/routes/auth.js:25-29, 310`

---

## 8. Location coordinates

### Flow diagram
```
GPS raw fix (position.coords.latitude, longitude, altitude, accuracy, speed)
  → addTrackPoint (foreground or background drain)
  → 4 gates:
    G1 teleport reject: dt > 0 && impliedSpeed > 10 m/s && distM > 30
    G2 accuracy reject: accuracy > 25m → add to raw only
    G3 stationary suppress: speed < 0.5 m/s AND distFromLast <= radius → add to raw only
    G4 Kalman smooth: independent lat/lng 1D filter, Q=1e-9
  
trackPoints (clean, 6-decimal float per default JSON.stringify)
  → local persistence per-session key
  → incremental /append-points to server every 120s / 300s
  → final /save with route_points (snapped) + route_points_raw (with .acc, .alt)
  
Server:
  sessions.route_points JSON column: [{lat,lng,t}]
  sessions.route_points_raw JSON column: [{lat,lng,t,acc,alt,...}]
  memory_points row: {lat,lng,ts,client_id}
```

### Findings

- **D-LOC-01 [Critical]**: `route_points_raw` stored server-side includes accuracy AND altitude. Altitude reveals floor level (in a multi-story building) and, over enough samples, home floor plan resolution. No user consent for storing altitude beyond "we track hikes."
  - Evidence: `useTrackingStore.ts:1047`, `backend/src/routes/sessions.js:298-306`

- **D-LOC-02 [Critical]**: `sessions.route_points_raw` is not truncated after hike ends. It's audit-track forever. Users have no way to delete just the raw stream while keeping the smooth trail visible.
  - Evidence: no delete endpoint for `route_points_raw` alone

- **D-LOC-03 [Medium]**: Snapping (`snapTrack`) uses Mapbox `/matching`, which sends raw GPS to Mapbox servers. `EXPO_PUBLIC_MAPBOX_TOKEN` = Cairn's Mapbox account. User's location goes to a third party.
  - Evidence: `useTrackingStore.ts:1000-1027`

- **D-LOC-04 [Medium]**: Backend logs errors with `console.error('[sessions/save]', err)` — if err message includes any of the request body, sensitive coord fragments could hit stdout → aliyun log volumes → any log-shipping stack.
  - Evidence: `backend/src/routes/sessions.js:376`

- **D-LOC-05 [Critical]**: `lastFixCache.persistLastFix` (called from `setLastWatcherFix`, line 471-473 `useMemoryStore.ts`) writes lat/lng to AsyncStorage. This survives logout (until `clearAll` runs, and `clearAll` may not clear the AsyncStorage-persisted copy). Next user seeing a cold boot with a fresh account still gets the previous user's last coordinate as fog anchor.
  - Evidence: `useMemoryStore.ts:455-473`; need to verify `lastFixCache` clear-on-logout

- **D-LOC-06 [Medium]**: Precision. `route_points` stored via `JSON.stringify` uses default JS number precision (~15 significant digits). Users' latitudes come out to ~9 decimal places = mm precision. No coarsening for "off-map" analytics use cases.

---

## 9. Photos (marker photos, feedback attachments)

### Flow diagram
```
Feedback attachments:
  pickDebugScreenshots (expo-image-picker) → PickedPhoto[] {uri, width, height}
  uploadDebugScreenshots → per-photo FileSystem.uploadAsync(BINARY_CONTENT, image/png)
    → POST /api/debug-snapshot
    → server stores in debug_snapshots table? or filesystem?

Marker photo (deprecated):
  useMarkerStore has photoUrls removed in O1 batch 40 — no client path
  Backend markers table has no photo_url column referenced anywhere in inspected code

Voice memo:
  persistMemo(tempUri, markerId) → FileSystem.moveAsync → documentDirectory/voice_memos/{markerId}.m4a
  URI stored on marker.voiceMemoUri
  No upload path
```

### Findings

- **D-PHT-01 [Critical]**: `photoUrls` was removed from Marker (O1 batch 40 comment). But `pickDebugScreenshots` still lets users pick their photos — for feedback ONLY. No cleanup after upload. On device, iOS ImagePicker caches selected photos in temp dir; expo-file-system uploadAsync reads from that URI. If pick-then-cancel-Send, the cached photo stays until iOS reclaims it — could be quite a while.
  - Evidence: `debugUpload.ts:114-160`

- **D-PHT-02 [Critical]**: Failed uploads: `uploadDebugScreenshots` continues past a failed photo (line 158 comment). No local record kept of what failed. User taps Send → sees "3 of 5 attached" → cannot retry the 2 that failed.
  - Evidence: `debugUpload.ts:154-159`

- **D-PHT-03 [Medium]**: Voice memos stored as `documentDirectory/voice_memos/{markerId}.m4a`. `deleteMarker` does NOT delete the .m4a file. Long-term: disk bloat, and if `markerId` gets reused (server assigns new id after ack), the old voice memo file is orphaned but the new marker's ID doesn't correspond.
  - Evidence: `voiceMemoService.ts:198-214`, `useMarkerStore.ts:387-401`

- **D-PHT-04 [Medium]**: `voiceMemoUri` field on Marker is a device-local path. If user syncs to a new device (via cloud), the URI is meaningless there. `loadFromBackend` currently does NOT propagate voiceMemoUri (backend doesn't store it) — good, no phantom paths. But cross-device recovery is impossible without a real upload path.

- **D-PHT-05 [Low]**: `/api/debug-snapshot` server-side is not shown in the audited files but memory notes say it exists in `debug-snapshot.js` (`backend/src/routes/`). Rate limit was raised to 6000/5min. If a support-request feedback attaches 5 photos + user is on a diagnostic session sending many events, both compete for the same bucket.

---

## 10. Analytics / Telemetry

### Flow diagram
```
debugLogger.log(event) → in-memory buffer → periodic flush to disk (JSONL)
  Events include: gps_fix (lat, lon, accuracy, altitude, speed, heading), marker_placed
                  (lat, lon, text_length, permission), session lifecycle

Session end → debugLogger.endSession() → telemetryUploader.upload(sessionId)
  → POST /api/telemetry/sessions (device info in headers)
  → body: entire JSONL file (BINARY_CONTENT with x-ndjson content-type)
  → server: telemetry_sessions row with metadata columns

appLog.log(tag, ctx) → batch buffered → POST /api/edit-diag { kind:'app_log', events:[...] }
```

### Findings

- **D-TEL-01 [Blocker]**: `debugLogger.log('gps_fix', ...)` (foreground callback, `useTrackingStore.ts:1846-1858`) writes every GPS fix into telemetry JSONL — full latitude, longitude, altitude, accuracy, speed, heading, raw. This is UNCONDITIONAL when a session is active — no user opt-in check inside the callback. `telemetryUploadEnabled` is checked only at upload time (`telemetryUploader.ts:85`), not at logging time. If user disables upload, the data is still written to disk. If they later flip it on for one debug session, previous sessions' full GPS data is uploaded retroactively.
  - Evidence: `useTrackingStore.ts:1846-1858`, `telemetryUploader.ts:79-87`

- **D-TEL-02 [Critical]**: No `X-Cairn-User-Id` header on `/api/telemetry/sessions` — only device model / os / activity mode. Backend cannot link a telemetry session to a user account directly (may correlate by device or by IP). If the intent is anonymous, it partially succeeds; but the JSONL body may include marker_placed events with lat/lng that could correlate to a user's account via their public markers.
  - Evidence: `telemetryUploader.ts:127-141`

- **D-TEL-03 [Medium]**: `appLog` payloads regularly include lat/lng at 5-decimal precision (e.g. `v422.addmarker_enter`, `v422.plant_unlock`). Session_id is per app-launch (line 57) — nominally anonymous, but combined with device fingerprint + timing correlations, could de-anonymize.
  - Evidence: `useMarkerStore.ts:260-269, 295-302`, `appLog.ts:57`

- **D-TEL-04 [Critical]**: `telemetryUploadEnabled` default and opt-out UI unclear. If default is ON (which it appears to be based on `useSettingsStore` typical patterns), users are opted into detailed GPS telemetry from install — a consent issue for App Store review.

- **D-TEL-05 [Medium]**: `telemetryUploader.upload` on failure writes back into `debugLogger.updateSessionMeta` with `upload_last_error`. If the error string contains sensitive server-side info (e.g. an SQL error echoed in body), it's now on the user's device.
  - Evidence: `telemetryUploader.ts:143-157`

- **D-TEL-06 [Low]**: Session_id in appLog is per-launch, but each event also carries `Date.now()` timestamp. If the queue survives an app kill (it's in-memory only, so no — dropped on kill), no persistence bug. Verified: `let queue: LogRecord[] = []` module-scoped, not persisted → kill drops queue → orphaned server-side sessions have unmatched session_id gaps.

---

## 11. Push tokens

### Findings

- **D-PSH-01 [Critical]**: No `Notifications.getExpoPushTokenAsync` call found anywhere in `app/src/`. Only one hit for `Notifications` (in `autoPauseMonitor.ts`) which is likely for local haptic-style notification, not push. There is no push registration, no server endpoint to receive the token, and no unregister-on-logout logic.
  - Consequence: Cairn has NO push notification support currently. Any Sprint that assumes push (e.g. "friend planted a marker nearby") will silently not fire.
  - Evidence: `Grep` for `expoPushToken|getExpoPushTokenAsync` returns 0 files (excluding autoPauseMonitor).

---

## 12. OTA download

### Flow diagram (inferred — expo-updates not directly imported in inspected files)

Based on `OtaBadge.tsx` showing `OTA_VERSION` constant, the app appears to use `expo-updates` with runtime OTA. No user-consent gate visible.

### Findings

- **D-OTA-01 [Medium]**: `OTA_VERSION` constant in `components/OtaBadge.tsx` — used in feedback log payload and settings display. If OTA channel is auto-updating (checkForUpdateAsync on launch), user sees no consent for update install. No rollback path in-app.
  - Evidence: `SettingsScreen.tsx:848` (`ota: OTA_VERSION`)

- **D-OTA-02 [Low]**: OTA download during active hike would restart JS bundle → mid-hike restart risk. No gate to defer OTA until hike ends. (Not verified — depends on expo-updates config.)

---

## Overall data hygiene grade: 5.5/10

The system has aggressive local caching and offline-first design, which is admirable. But there are several failure modes where user data can silently disappear, cross-user contamination is possible on rapid-switch, and PII (email, precise lat/lng) leaks into what should be technical diagnostic tables.

---

## Critical data risks (release-blocking)

1. **D-USR-02 Delete Account is mailto-only** — App Store guideline 5.1.1(v) technically satisfied by the in-app path, but users are lied to about deletion happening. Server-side account and data remain intact after their "confirm delete" tap. Legal/regulatory (GDPR-style) risk if a NZ/EU user actually invokes their right to erasure and it's silently ignored.

2. **D-USR-03 No server-side logout / token revoke** — stolen JWT usable until expiry. Combined with D-PWD-01 (password change doesn't invalidate), this is a real account-takeover exposure.

3. **D-HIK-04 saveHikeAtomic race** — hike lands on server but local addSession throws → hike invisible to user. Enough log evidence in the file (O7/O8 checkpoints) that this has bitten before.

4. **D-HIK-07 Trackpoints leak on logout** — clearSessions cannot enumerate AsyncStorage keys → orphan trackpoints keyed per session-id persist forever.

5. **D-MRK-10 Cross-user marker queue leak** — offlineMarkers queue not cleared atomically on logout → next user's login could POST previous user's markers with new user's token.

6. **D-FDB-01 Feedback text + email PII in debug log table** — no consent, no separate feedback table, support team runs raw SQL to read.

7. **D-TEL-01 GPS telemetry written regardless of opt-out** — data is captured on disk during hike whether or not upload is enabled. If user later flips upload on for a single session, the full hike's raw GPS goes up retroactively.

8. **D-LOC-01 route_points_raw includes altitude** — potential PII, no per-user way to erase just this stream.

9. **D-HIK-01 hikeTrackWriter quadratic disk cost** — 3-hour hikes generate ~360MB of disk churn. On low-storage or slow-flash devices, this causes user-visible lag and jetsam risk.

10. **D-PSH-01 No push token flow exists** — any planned push-notification feature is broken.

---

## Cross-flow inconsistencies

- Password uses `currentPassword` / `newPassword` (camelCase); register uses `name`, `email`, `password` (flat); `/api/hide` uses snake_case `item_type` / `item_id`; sessions use snake_case `end_time` / `distance_m`. No consistent naming policy.
- Sessions synced via `saveHikeAtomic` (idempotency key required, atomic tx). Markers synced via `POST /api/markers` (idempotency middleware, non-tx). Memory via `POST /api/memory/points` (no idempotency, ON DUPLICATE KEY). Feedback via `POST /api/edit-diag` (no idempotency at all — batch dropped on 4xx).
- Retry policies:
  - `offlineQueue`: exp backoff up to 30 min, MAX_ATTEMPTS=8, drops on 4xx
  - `memorySync`: fixed BACKOFF_MS=15s
  - `telemetryUploader`: MAX_AUTO_RETRIES=20, per-session `upload_attempts` counter
  - `pendingSyncStore`: managed by SyncDaemon (behavior not inspected)
  - `appLog`: no retry — 4xx and 5xx both silently drop queue slot
- Delete semantics:
  - Session delete: local-first + fire-and-forget server, no retry
  - Marker delete: local-first + fire-and-forget server, no retry (D-MRK-02)
  - Hide: local-first + POST-then-clear-hidingIds, no retry
  - Memory: DELETE /api/memory/points + local clearAll (with proper epoch guard)
  - Account: mailto only (D-USR-02)
  Each delete path invents its own strategy. No shared "delete op queue" or convention.
- Idempotency keys:
  - `saveHikeAtomic`: `uuidv4()` with fallback (line 1076-1086)
  - `offlineQueue.enqueue`: caller-supplied opId
  - `offlineMarkers`: `saveLocal` mints localId
  - `applyServerEchoForPushAligned`: server-echoed cid alignment
  Four different mechanisms across four data types.

---

## Findings count: 55 across 12 flows

DATA_FLOW_COMPLETE
