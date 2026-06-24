# Subagent F — v319 Login Crash Round 2 Investigation

**Focus**: setLoggedIn(true) → zustand subscriber chain → 1s-after-Home crash

**Key new evidence to explain**:
- v319 login → HomeScreen visible for ~1s → crash
- Means: setLoggedIn(true) flipped, RootNavigator re-rendered with logged-in branch,
  setTimeout(0) → nav.replace('Home') succeeded, HomeScreen mounted, render committed,
  visible to user, **then** died ~1s later.
- Server beacons show 0 fgum_hasuser_scheduled — same fetch-loss pattern as before.

---

## A. Full enumeration of useAppStore subscribers, ranked by suspicion

Searched: `Grep useAppStore\(` across `app/src` → 14 source files. All subscribe via
component-level hook selectors (no `useAppStore.subscribe` imperative — confirmed
via `Grep useAppStore\.subscribe` → 0 matches).

Subscribers **mounted when isLoggedIn flips true → true (after login)**:

| # | File | Selector | Mounted state at T=setLoggedIn(true) | Suspicion |
|---|------|----------|--------------------------------------|-----------|
| 1 | `ForegroundUnlockManager.tsx:58,65,219` | `s.user?.id`, `s.isLoggedIn`, `s.isLoggedIn` (3 separate selectors!) | **Always mounted at App root level** (App.tsx:643 — sibling to RootNavigator) | **CRITICAL** |
| 2 | `RootNavigator.tsx:58` | `{ isLoggedIn }` (full state destructure) | Always mounted | HIGH — triggers Stack.Screen children change |
| 3 | `AuthScreen.tsx:440` | `{ setLoggedIn, setUIMode, setUser, hydrate }` (full state destructure) | Mounted during login → **unmounted** when isLoggedIn flips true (Stack.Screen replaces Auth with 13 logged-in screens) | MEDIUM — unmount during set |
| 4 | `HomeScreen.tsx:223` | `s => s.uiMode` | **First mounts AFTER setLoggedIn(true) + nav.replace** | LOW — uiMode primitive, narrow selector |

Subscribers **NOT mounted at T=setLoggedIn(true)** (login flow doesn't reach them):
- `HikingScreen`, `MapScreen`, `PlantScreen`, `MarkerDetailScreen`, `SettingsScreen`,
  `MemorySummaryCard`, `MemorySettingsSection` — only mount on user navigation. Irrelevant.

### A.1 Critical detail — full-state destructure pattern

`AuthScreen.tsx:440` and `SettingsScreen.tsx:174` use `const { ... } = useAppStore();`
**without a selector function**. In zustand, this subscribes the component to the **entire
state object** — meaning **any** change in **any** field (uiMode, activityMode, trackingState,
trackingDistance, trackingDuration, isLoggedIn, user, sessionExpired) re-renders these
components.

`RootNavigator.tsx:58` does the same (`const { isLoggedIn } = useAppStore();`). This is
not a bug — it's a perf nit — but it means **setLoggedIn(true) triggers a render of
RootNavigator** which is exactly what is needed to swap the Stack.Screen children.

### A.2 ForegroundUnlockManager subscribes THREE times to useAppStore

```ts
// line 58
const userId = useAppStore((s) => s.user?.id ?? null);
// line 65
const isLoggedIn = useAppStore((s) => s.isLoggedIn);
// line 219
const isLoggedInForGps = useAppStore((s) => s.isLoggedIn);
```

When `setLoggedIn(true)` fires:
- zustand calls all 3 listeners synchronously
- All 3 selectors re-evaluate (trivial — primitive equality)
- isLoggedIn selector returns new value (false → true)
- Component re-renders

The re-render triggers TWO useEffects to re-run because their deps changed:
- `useEffect(..., [effectiveUserId])` at line 81 — **`effectiveUserId = isLoggedIn ? userId : null`** flips from null → real-user-id → **hasUser branch enters**
- `useEffect(..., [enabled, isLoggedInForGps])` at line 220 — isLoggedInForGps flips → re-evaluates → if `enabled` and AppState=active, **calls `void start()` to attach GPS watcher**

---

## B. Setting up the suspect — InteractionManager.runAfterInteractions callback

This is **the primary suspect** and what the task brief already identified. Confirmed
by reading `ForegroundUnlockManager.tsx:140-200`:

```ts
InteractionManager.runAfterInteractions(() => {
  // ... fires AFTER navigation transition animation completes
  void (async () => {
    detachMemorySync();
    resetUnlockEngineForUser();
    useMarkerStore.getState().clearMarkers();   // SYNC store mutation
    await hydrateH3ForUser(effectiveUserId);     // async I/O + JSON.parse
    await hydrateMemoryForUser(effectiveUserId); // async I/O + JSON.parse
    attachMemorySync(effectiveUserId);           // SYNC subscribe call
    void pullMemoryFromServer(effectiveUserId);  // async fetch (fire-and-forget)
  })();
});
```

### B.1 Timing of InteractionManager callback

`InteractionManager.runAfterInteractions` fires after all currently-running interactions
(animations) are complete. The stack transition animation for `animation: 'ios_from_right'`
+ `animationDuration: 320` (RootNavigator.tsx:75-76) is ~320ms.

So callback fires at approximately:
- T+0: setLoggedIn(true) — fgum effect [effectiveUserId] gets scheduled
- T+5ms: Stack.Screen children swap (Auth → 13 logged-in screens)
- T+10ms: setTimeout(0) fires → nav.replace('Home')
- T+330ms: stack transition animation completes → InteractionManager queue drains
- **T+330ms+**: fgum hasUser async work starts → **`hydrateH3ForUser` enters**

User sees Home rendered visibly at ~T+200ms (initial frame after stack swap).
User sees Home for ~800ms-1s before death. So death is **T+1000ms or later**.

### B.2 What `hydrateH3ForUser` actually does

Read `app/src/features/memory/services/h3Persistence.ts:151-215`:

1. detachH3Persistence (await) — flushes prior state to AsyncStorage
2. `useH3VisitedStore.getState().clear()` — sync, sets cells to empty Map
3. `storage.getItem(storageKey(userId))` (await) — AsyncStorage I/O
4. **If raw.length > 500_000 bytes (500KB) → skip parse** (v315 guard, see line 184)
5. **Else: `deserialize(raw)` → `JSON.parse` sync block** + `replaceCells(decoded)`
6. `useH3VisitedStore.subscribe(...)` — attaches scheduleFlush listener

### B.3 What `hydrateMemoryForUser` actually does

Read `app/src/features/memory/services/memoryPersistence.ts:260-385`:

1. **`hasMemoryHydrateFailedBefore()` gate** (v317) — if persisted flag says prior session
   died in hydrate, bail early. If gate clear → continue.
2. `markMemoryHydrateInProgress()` — writes "in progress" flag (sync hint, async actual write).
3. detachMemoryPersistence (await) — flushes prior state to AsyncStorage
4. `useMemoryStore.getState().resetForUserSwitch()` — sync, empties points array
5. `storage.getItem(storageKey(userId))` (await) — AsyncStorage I/O
6. **If raw.length > 500_000 bytes → skip parse** (v315 guard, see line 324)
7. **Else: `deserialize(raw)` → `JSON.parse` sync block**
8. `useMemoryStore.getState().replacePoints(decoded.points, ...)` — sync rebuild
9. Inside `replacePoints` (`useMemoryStore.ts:524-578`):
   - `set({ points, _bucketIndex: buildBucketIndex(points), ... })` — sync rebuild bucket index
   - **`set` triggers all useMemoryStore subscribers** (FogLayer, CairnPinsLayer, sync)
   - `setTimeout(() => { useH3VisitedStore.bulkImport(...) }, 100)` — defers h3 work
10. `markMemoryHydrateSuccess()` — clears in-progress flag
11. `useMemoryStore.subscribe(...)` — attaches scheduleFlush listener

### B.4 What `attachMemorySync` does

Read `app/src/services/memorySync.ts:314-326`:

```ts
export function attachMemorySync(userId: string): void {
  detachMemorySync();
  activeUserId = userId;
  let lastUnsyncedCount = useMemoryStore.getState()._unsyncedCount;
  unsubscribe = useMemoryStore.subscribe((s) => {
    const u = s._unsyncedCount;
    if (u > lastUnsyncedCount) schedulePush();
    lastUnsyncedCount = u;
  });
  if (useMemoryStore.getState()._unsyncedCount > 0) {
    schedulePush(PUSH_DEBOUNCE_MS);
  }
}
```

This is light — adds another zustand subscriber, optionally schedules a push.

### B.5 What `pullMemoryFromServer` does

Read `app/src/services/memorySync.ts:78-233`:

- Fires `authenticatedFetch(/api/memory/points?...)` — async network
- If response Content-Length > 2_000_000 (2MB) → abort (v314 guard)
- Else `await res.json()` — **sync JSON.parse on response body in Hermes**
- If accumulated.length > 0 → `useMemoryStore.getState().replacePoints(merged, ...)` — **another sync rebuild**

---

## C. Complete timeline — tap Sign In to death

```
T+0     User taps Sign In button
        beacon: login_handleAuth_enter (fetch enqueued via markBootPhase)

T+5ms   handleAuth() runs — sets loading=true, calls login(email,pwd)

T+10ms  fetch /api/auth/login awaited

T+800ms Network response → result.user populated
        beacon: login_before_setUser
        setUser(result.user)
        → useAppStore listeners: AuthScreen full-state-destructure subscriber re-renders
        → ForegroundUnlockManager line 58 selector: s.user?.id changes from null → real-id
        → fgum useEffect [effectiveUserId] runs cleanup + queues new effect
          BUT: effectiveUserId = isLoggedIn(false) ? userId : null → STILL null
          → no-user branch runs (cleanup only)

T+810ms beacon: login_before_hydrate
        await hydrate()  // useAppStore.hydrate
        - Calls getMe() — another fetch
        - Hydrates markerStore, sessionStore, arOriginStore
        - Sets { user } again (no-op)
        - Sets { hydrated: true }

T+1500ms beacon: login_after_hydrate
        setLoggedIn(true)
        → zustand fires ALL subscribers synchronously, on this JS tick:
          1. RootNavigator { isLoggedIn } selector — full state destructure → re-render
             → Stack.Navigator children prop changes from [<Auth>] to [<Home>, <Hiking>, ...×12]
             → React Navigation native-stack diffs children → mounts Home + 12 placeholders
          2. AuthScreen { setLoggedIn, ... } full state destructure → re-render
             → but AuthScreen is about to unmount in same tick, render result discarded
          3. ForegroundUnlockManager line 65 selector: s.isLoggedIn → true
             → re-render → effectiveUserId flips null → real-id
             → useEffect [effectiveUserId] runs cleanup, queues new effect
             → useEffect [isLoggedInForGps] runs cleanup, queues new effect
          4. ForegroundUnlockManager line 219 selector: s.isLoggedIn → true (same)

T+1505ms beacon: login_after_setLoggedIn
        setTimeout(0, () => nav.replace('Home')) — v319 deferral

T+1510ms — React commits the new tree:
           - AuthScreen unmounts
           - HomeScreen mounts (Stack reports Home as initial focus screen)
           - HomeScreen render: home_screen_render_start beacon fires
           - HomeScreen reads uiMode/sessions/markers selectors — light work
           - ForegroundUnlockManager useEffect callbacks run NOW (post-commit):
             - effectiveUserId hasUser branch enters
             - beacon: fgum_user_effect_enter (hasUserId:true, isLoggedIn:true, effective:true)
             - beacon: fgum_hasuser_scheduled
             - InteractionManager.runAfterInteractions(callback) — queued

T+1515ms setTimeout(0) fires → nav.replace('Home')
        beacon: login_settimeout_fired
        - React Navigation: Home is already the current focus, no transition
          (Stack.Screen children swap already happened when isLoggedIn flipped)
        - OR: replace() does cause a transition because of v319 setTimeout deferral
          relative to the Stack.Screen children swap timing

T+1520ms HomeScreen visible to user (first paint complete)
        OtaBadge mounts → useEffect at line 1395 fires
        - import('expo-updates') (async)
        - Updates.checkForUpdateAsync() (async, 30s timeout)
        - Network call to EAS update endpoint

T+1800ms — T+2300ms  Stack transition animation finishes (320ms duration if any
                     transition runs; may be 0 if Home was already focus)

T+1850ms InteractionManager queue drains → fgum hasUser callback fires
        beacon: fgum_hasuser_interaction_done
        beacon: fgum_hasuser_async_enter

        detachMemorySync() — sync, light
        resetUnlockEngineForUser() — sync, light
        useMarkerStore.getState().clearMarkers() — sync, but → triggers
          all useMarkerStore subscribers (HomeScreen line 225 allMarkers re-renders Home)

        beacon: fgum_hasuser_before_hydrate_h3
        await hydrateH3ForUser(userId):
          - detachH3Persistence (await)
          - clear() — sync, useH3VisitedStore.cells = empty Map
                       → triggers H3 subscribers (FogLayer would re-render but
                         FogLayer not mounted on Home, OK)
          - storage.getItem (await) — AsyncStorage I/O ~5-50ms
          - beacon: h3hydrate_after_getitem
          - if raw.length > 500_000 → skip parse, beacon: h3hydrate_payload_too_large
          - else → JSON.parse(raw) → SYNC BLOCK on main thread

T+2000ms beacon: fgum_hasuser_after_hydrate_h3
        beacon: fgum_hasuser_before_hydrate_memory
        await hydrateMemoryForUser(userId):
          - hasMemoryHydrateFailedBefore() gate check — sync flag read
          - markMemoryHydrateInProgress() — async fire-and-forget write
          - detachMemoryPersistence (await) — flush prior state
          - resetForUserSwitch() — sync, empties points
            → triggers useMemoryStore subscribers; HomeScreen has none
          - storage.getItem (await) — AsyncStorage I/O ~5-50ms
          - beacon: memhydrate_after_getitem
          - if raw.length > 500_000 → skip parse, beacon: memhydrate_payload_too_large
          - else → JSON.parse(raw) → SYNC BLOCK
          - replacePoints(points, initialRevealDone) — sync rebuild buckets
            → triggers useMemoryStore subscribers
            → setTimeout(0, () => h3.bulkImport(snapshot), 100ms)  [chunked, safe]
          - markMemoryHydrateSuccess() — async fire-and-forget write

T+2100ms beacon: fgum_hasuser_after_hydrate_memory
        beacon: fgum_hasuser_before_attach_sync
        attachMemorySync(userId) — sync, adds subscriber

        beacon: fgum_hasuser_before_pull_memory
        void pullMemoryFromServer(userId) — fire and forget

T+2200ms pullMemoryFromServer enters:
        beacon: pull_memory_entry
        - fetchWithTimeout(/api/memory/points?...) — async
        - beacon: pull_memory_before_fetch (page=0)
        - server responds (could be MB-sized if user has lots of points)
        - beacon: pull_memory_after_fetch
        - content-length check (2MB limit)
        - if Content-Length > 2_000_000 → abort, beacon: pull_memory_too_large
        - **else: await res.json() — SYNC PARSE on main thread**

T+~2500ms — T+3500ms  if res.json() body > 1MB:
        - Hermes JSON.parse on 1-2MB body sync-blocks main thread for **seconds**
        - iOS watchdog timer (0x8badf00d) wakes up
        - If main thread frozen > 6-10s → SIGKILL
        - **User sees Home → ~1s of seeming-normalcy → instant death**
```

---

## D. Most likely root cause (T+2200ms suspect)

### Primary suspect: `pullMemoryFromServer` res.json() on a mid-sized response

The 2MB Content-Length guard at line 124 prevents the worst case (3MB+ payload), but
**a 500KB-1.5MB JSON body can still sync-block Hermes for 1-3 seconds**. That alone may
not trip the watchdog, but combined with:
- the freshly-completed hydrateMemoryForUser replacePoints work (still doing setTimeout
  bulkImport 100ms after replacePoints)
- the OtaBadge expo-updates check possibly downloading a bundle in parallel
- iOS memory pressure from the freshly-mounted Home + 12 placeholder screens (Stack.Navigator
  with children=13 mounts the screens lazily in native-stack BUT module-level imports of
  all 13 screens already happened at RootNavigator module load time)
- Mapbox memory budget (if user navigates to Memory soon — but here user hasn't)

…the combined pressure plus a sync JSON.parse can be enough to trip iOS jetsam OR the
RN watchdog.

### Secondary suspect: `JSON.parse` on memoryPersistence raw

Even with the 500KB guard, a 400-500KB JSON.parse is **non-trivial** on iOS Hermes for
a fresh-login first-time user (whose persisted memory cache is most likely empty or tiny).
This is unlikely to be the killer for THIS user on THIS login, but for an upgrade user
(v319 OTA over a v317 install with existing cache) it's plausible.

### Tertiary suspect: `OtaBadge` re-mounts on Home

The OtaBadge component is mounted on HomeScreen (`HomeScreen.tsx:239 <OtaBadge />`).
On mount it kicks off an `expo-updates` check (line 1395-1472). If an OTA is available,
`Updates.fetchUpdateAsync()` downloads it (60s timeout), then `Updates.reloadAsync()`
**reloads the entire JS bundle**. From the user's perspective, this **looks identical
to a crash** — the app suddenly disappears and re-launches. This could explain the
"1-second-after-Home" timing — except OtaBadge is also mounted on AuthScreen
(`AuthScreen.tsx:827 <OtaBadge inline />`) so the same effect would have already
fired and downloaded any new OTA during the auth screen view. **However**:
- OtaBadge **does NOT memoize the result across component instances**. The Home
  OtaBadge instance fires a fresh checkForUpdateAsync. expo-updates may or may not
  short-circuit if a check happened recently — needs expo-updates source to confirm.
- This is **plausible but not most-likely** because the user reports the same crash
  pattern repeatedly across multiple v319 attempts, which suggests it's not an OTA
  download (which would only fire once per published bundle).

### Quaternary suspect: useMemoryStore subscriber chain on replacePoints

`replacePoints` inside hydrateMemoryForUser does a `set({ points, _bucketIndex, geometryVersion+1, ... })`.
This wakes up every useMemoryStore subscriber. **However**, on the Home screen there
are zero useMemoryStore subscribers (Home doesn't import useMemoryStore). The fgum
component itself doesn't subscribe to useMemoryStore — only the persistence layer's
own subscribe-for-scheduleFlush callback (which is light).

But: `attachMemorySync` ALSO subscribes to useMemoryStore. When replacePoints sets
`_unsyncedCount`, the memorySync subscriber compares against `lastUnsyncedCount` and
may call schedulePush. Light. Not the killer.

---

## E. Why is `fgum_hasuser_scheduled` server beacon = 0?

This is the same fetch-loss pattern that's been observed across v311+. The beacon is
fired via `markBootPhase('fgum_hasuser_scheduled')` at line 138 — **BEFORE** the
InteractionManager.runAfterInteractions call. This means the beacon should fire **inside
the useEffect synchronously**, before the InteractionManager queue runs.

If the server sees 0 of these beacons, two possibilities:
1. **The useEffect never re-runs** — meaning effectiveUserId never changed, meaning
   isLoggedIn either never became true OR userId is null. But the user sees Home for
   1s which requires isLoggedIn=true.
2. **The beacon fetch is being lost** — the markBootPhase enqueues a fetch (look at
   `bootDiagnostics.ts`), and the fetch is killed by the watchdog SIGKILL before it
   flushes. This is the established explanation across v311-v319.

The fact that **`login_after_setLoggedIn` beacon also doesn't reach server** (need to
verify with server data) is consistent. The fetch flush happens on the event loop tick
AFTER markBootPhase, and if main thread freezes, those ticks never run.

---

## F. What the task brief's "InteractionManager fires after interactions complete"
       prediction says

The brief's T+2200ms hypothesis is consistent with my analysis above. Specifically:
- "InteractionManager.runAfterInteractions callback — fires after interactions are complete"
- "1 秒后 fire = 用户看到 Home 1 秒后死" ← **this is high alignment**
- "第一次 login gate flag empty → hydrate 跑全量 → JSON.parse sync block on growing memory cache"

### Refinement to the brief's prediction:

The brief says "JSON.parse sync block on growing memory cache" — but the memory cache is
guarded at 500KB. The brief is right in spirit but the actual sync-block JSON.parse is
**most likely** the `res.json()` inside `pullMemoryFromServer` (T+2200ms-2500ms), not the
local cache hydrate.

For a fresh-login user whose AsyncStorage memory cache is < 500KB (very likely for a
brand-new install + first login), the local hydrate JSON.parse is fast. But
**`pullMemoryFromServer` fetches the user's ENTIRE server-side memory history**, which
could be MUCH larger than the local cache. The 2MB guard handles >2MB cases, but
**500KB-2MB responses still sync-parse in Hermes for 1-3 seconds**.

A 2-second sync block on the main thread, **stacked on top of** the freshly-completed
hydrate work + Home render + still-running animations + Mapbox warmup (if any from
HomeScreen indirect deps) + OtaBadge expo-updates check, is plausibly enough to trip
the iOS watchdog (~6s) OR jetsam (memory pressure).

---

## G. Recommended fix priorities

1. **(Highest)** Tighten `pullMemoryFromServer` Content-Length guard from 2MB → 500KB,
   matching the local hydrate guard. Anything bigger should paginate harder OR be
   served as a binary protocol (protobuf / msgpack) that can be incrementally parsed.

2. **(High)** Add a **chunked JSON parser** for response bodies, or stream the response
   incrementally. Hermes lacks native streaming, but you can split the server response
   into N small JSON arrays of ≤1000 points each and call `res.json()` on each.

3. **(High)** Add a Content-Length-based decision **before** awaiting `res.json()`. The
   current code awaits `res.json()` immediately, which blocks even when Content-Length
   is checked first — because `res.json()` reads the full body into memory and then
   parses synchronously.

4. **(Medium)** Defer `pullMemoryFromServer` even further — current code fires it
   from inside the InteractionManager callback (T+~1850ms), but the hydrate work
   above it might still be settling. Wait an additional 2-3 seconds, OR wait until
   the user navigates AWAY from Home (i.e. when they tap a tool button).

5. **(Medium)** Add a "fgum_hasuser_pull_skipped_due_to_size" beacon when the 500KB
   guard hits in pull, so server data can distinguish "user has tons of points → guard
   working" from "guard not hitting because response is below 500KB".

6. **(Low / forensic)** Verify whether `login_after_setLoggedIn` and `home_screen_render_start`
   beacons are reaching the server. If they ARE → death is post-Home-render (this
   investigation's hypothesis). If they are NOT → death is earlier than thought, and
   the 1-second-Home-visible observation is an artifact of OTA reload rather than crash.

---

## H. Sanity check — could it be expo-updates reloadAsync mimicking a crash?

Possible but unlikely:
- Reload would happen after fetchUpdateAsync succeeds AND setState('applying') fires
- The "applying" pill would briefly flash before reload
- User report says "crash" not "app restarted"
- BUT user might not visually distinguish reload from crash

**Action**: ask user if the app re-opens to Home/Auth automatically on its own, or if
it requires manual re-launch. If automatic → it's an OTA reload bug. If manual → it's
a true crash.

---

## I. Summary verdict

**Most likely root cause** of v319 1-second-after-Home crash:

**`pullMemoryFromServer` synchronous `res.json()` on a 500KB-2MB response body**,
which sync-blocks Hermes main thread for 1-3 seconds at T+~2200ms post-login.
Combined with freshly-completed hydrate work, Home render commit, animations,
and OtaBadge expo-updates check, the cumulative main-thread freeze exceeds the
iOS watchdog threshold (~6s) and triggers SIGKILL.

**Secondary contributors**:
- Local `hydrateMemoryForUser` JSON.parse if user has a non-trivial existing cache
  (250KB-500KB) — the 500KB guard only catches the worst case
- iOS memory pressure from the 13 Stack.Screen mounts (even if lazy, modules are loaded)
- OtaBadge OTA check fetch + potential download in parallel

**Why 0 fgum_hasuser_scheduled beacons reach server**: the beacon fetch is enqueued
before the main-thread freeze, but its flush tick is starved by the freeze, and
SIGKILL terminates the process before the queued fetch can flush. This is the same
fetch-loss pattern observed since v311.

**Fix priority**: tighten pullMemoryFromServer's Content-Length guard from 2MB to
500KB, and add chunked-response handling for users with larger memory histories.
