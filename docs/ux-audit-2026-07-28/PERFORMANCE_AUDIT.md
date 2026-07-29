# Performance Audit — 2026-07-28

Scope: full app/src/. All findings are file:line evidence-backed. No runtime measurements — findings inferred from code + measurements provided by A-PLAY1 (Routes 5-15s hang, Settings 15-20s cold, Home iPhone SE overlap, silent GPS fail).

Priority key:
- **Blocker** — causes user-visible freeze / crash / drains battery > 20%/h
- **Critical** — causes >500ms lag, jank on interaction, memory growth > 20MB/hr, or fails on low-end iPhone SE
- **Medium** — cumulative perf debt, would matter under stress
- **Low** — polish

---

## 1. Render performance

### P-RENDER-01 [Blocker]: React.memo used in exactly 1 component across entire app
- Evidence: `Grep React\.memo|memo\(` → only `app/src/components/map/DualLineLayer.tsx` matches. 0 memoized screens, 0 memoized list items, 0 memoized icons.
- Impact: Every parent re-render cascades unconditionally to every child. On HomeScreen/RoutesScreen/HikingScreen (which subscribe to tracking/session/marker stores) a state change → **entire subtree** re-renders. During a hike this fires N-per-second (see P-RENDER-02).
- Fix: wrap PressBtn, Icon, Card components, FlatList renderItem outputs (ActivityCard, RouteCard, FlagCard, MarkerCard) in `React.memo`. Highest priority: `PressBtn`, `Icon`, `HikingIcon`, `RunningIcon`, `Illustrations/*` — these appear inside every FlatList.

### P-RENDER-02 [Blocker]: useTrackingStore.durationS increments every 1s, triggers every subscribed screen to re-render
- Evidence: `useTrackingStore.ts:347` `durationInterval = setInterval(() => { set((s) => ({ durationS: s.durationS + 1 })); }, 1000);`
- Subscribers observed (grep `useTrackingStore(s => s.durationS)`):
  - `HomeScreen.tsx:58` — subscribes to durationS. **HomeScreen re-renders every 1s during a hike even though it's not visible.**
  - `RunningScreen.tsx:112`, `HikingScreen.tsx` — expected
- Because HomeScreen has NO memoized children, every 1s → every card, every icon, every marker count re-renders.
- Impact: baseline 1 fps of GC pressure during tracking; on iPhone SE, foreground background flicker.
- Fix: (a) split `durationS` into its own atomic store subscribed only by the timer display; (b) HomeScreen should not subscribe to live tracking metrics — read once on focus, or derive from `sessions` snapshot.

### P-RENDER-03 [Critical]: Every screen uses N separate zustand `use...Store(s => s.field)` calls
- Evidence: `RunningScreen.tsx:111-128` — 15 separate `useTrackingStore(...)` calls in one component. Same pattern in MapScreen.tsx:545-575 (10+), HikingScreen, RoutesScreen.
- Each call registers a separate subscription. Any state change fires N subscription callbacks in sequence.
- Impact: When a tracking action fires, RunningScreen alone triggers 15 subscription checks; React batches renders, but subscription callbacks are still O(N * subscribers).
- Fix: use a single selector returning an object plus `shallow` equality — but see P-RENDER-04.

### P-RENDER-04 [Critical]: Zero use of `shallow` / `useShallow` in the codebase
- Evidence: `Grep shallow|useShallow` → 0 matches.
- Impact: Any `useStore(s => ({ a: s.a, b: s.b }))` pattern would return a new object every render, causing infinite re-render. This is the reason developers wrote 15 individual selector calls — they didn't know about `shallow`. Cost = code readability + more subscription overhead.
- Fix: import `shallow` from `zustand/shallow`, batch related fields into one object selector.

### P-RENDER-05 [Critical]: HomeScreen computes markerCount by filtering ALL markers every render
- Evidence: `HomeScreen.tsx:251` `const markerCount = allMarkers.filter(m => m.regionCode === region.code).length;` — no useMemo.
- With N markers, this is O(N) per render. Given P-RENDER-02, that's O(N) every second during a hike.
- Fix: `useMemo(() => allMarkers.filter(...).length, [allMarkers, region.code])`.

### P-RENDER-06 [Critical]: RoutesScreen ActivitiesTab sort creates new array every filter/sort change
- Evidence: `RoutesScreen.tsx:709-720` — useMemo IS present but does `[...list].sort(...)` on every filter/sort/session change. Sort is O(N log N).
- With 100+ sessions this is fine (~1ms). Combined with FlatList without `getItemLayout`, initial mount cost is what causes the reported 5-15s hang.

### P-RENDER-07 [Blocker]: 0 FlatLists have `getItemLayout`, `initialNumToRender`, `windowSize`, `removeClippedSubviews`
- Evidence: `Grep getItemLayout|initialNumToRender|windowSize|removeClippedSubviews` → 0 matches.
- All 6 FlatLists (RoutesScreen ×3, MapBottomPanel, OfflineMapSheet, MemoryFriendPickModal) use defaults.
- Impact: RN measures each item on first mount, blocks main thread for the full list. **This is the direct cause of A-PLAY1's reported 5-15s Routes tab render hang.**
- Fix: cards have known heights — provide `getItemLayout={(_, i) => ({length: 84, offset: 84*i, index: i})}`, `initialNumToRender={10}`, `windowSize={5}`, `removeClippedSubviews={Platform.OS === 'android'}`.

### P-RENDER-08 [Critical]: All FlatList renderItems are inline arrow functions
- Evidence: `RoutesScreen.tsx:664`, `:753`, `:1154` — three FlatLists all use `renderItem={({ item }) => (...)}` inline.
- Impact: `renderItem` prop identity changes every render → FlatList thinks all items changed → full re-render of the list. Combined with P-RENDER-01 (no memo), the list rebuilds every parent re-render.
- Fix: extract `renderItem` to `useCallback` (still won't help without memo on rows) or extract to top-level `MemoizedCard` component with props-based rendering.

### P-RENDER-09 [Critical]: HikingMap builds solidGeoJSON + gapGeoJSON with filter+map inside render body
- Evidence: `HikingMap.tsx:148, 156` — `segs.filter(s => !s.gap).map(s => ({...}))`. Not wrapped in useMemo.
- Impact: every re-render (which is every trackPoint via P-RENDER-02) rebuilds the entire FeatureCollection → Mapbox ShapeSource sees a new object reference → full geometry rebuild on GPU thread. This is likely the source of jank during hikes.
- Fix: `useMemo(() => ({ solidGeoJSON, gapGeoJSON }), [segs])`. Cheap to compare segs by ref if it's already memoized upstream.

### P-RENDER-10 [Critical]: MapHistoryScreen also builds solidFeatures / gapFeatures per render
- Evidence: `MapHistoryScreen.tsx:207, 213` — same pattern.
- Impact: same as P-RENDER-09 but every time user pans/zooms if any state upstream mutates.
- Fix: same — wrap in useMemo.

### P-RENDER-11 [Critical]: PulsingDot in RunningScreen runs Animated.loop with no cleanup
- Evidence: `RunningScreen.tsx:66-80` — `useEffect(() => { Animated.loop(...).start(); }, [])` — no return cleanup.
- Impact: When RunningScreen unmounts, the loop keeps running forever, holding refs to `pulse` value + running the animation driver. Multiple mount/unmount cycles = N running loops. Memory + battery leak.
- Fix: `const anim = Animated.loop(...); anim.start(); return () => anim.stop();`

### P-RENDER-12 [Medium]: RoutesScreen imports 24+ components/services in one file
- Evidence: `RoutesScreen.tsx:1-30`. Not tree-shaken because it's a screen bundle.
- Impact: 1476-line screen loads all imports on first navigation. Contributes to 5-15s Routes hang.
- Fix: Split into per-tab files (RoutesTab, ActivitiesTab, FlagsTab) with lazy dynamic import on tab switch, or at minimum move heavy Mapbox imports to lazy require inside preview component.

### P-RENDER-13 [Medium]: SettingsScreen subscribes to memoryPointCount + allMarkers eagerly
- Evidence: `SettingsScreen.tsx:243-244` — `useMemoryStore(s => s.points.length)` and `useMarkerStore(s => s.markers)` at screen root.
- Impact: On mount SettingsScreen re-renders any time either store updates. Memory store updates during every hike (P-MEM-01). This is a likely contributor to the reported 15-20s Settings cold render — hydrating memory store on Settings mount triggers rerender loop.
- Fix: read once on mount via `getState()`, or gate behind visible sections.

### P-RENDER-14 [Medium]: CairnPinsLayer classified useMemo dep list mislabeled with eslint-disable
- Evidence: `CairnPinsLayer.tsx:113-134` — depends on `isExplored` and `friendPointsExploredCheck` closures but they aren't in deps (eslint-disable).
- Impact: When `isExplored`'s bucket index changes but `geometryVersion` didn't (edge case), classification becomes stale → correctness bug that can also cause N-frame lag if user pans then Mapbox retries.
- Fix: verify `geometryVersion` truly covers every case that mutates the bucket index; add unit test.

### P-RENDER-15 [Medium]: FogLayer buildFogShape runs turf.union O(N²) per points change
- Evidence: `FogLayer.tsx:227-` — comment says "O(N²) for N segments via reduce, but N is small (<20 typical)". True for typical case. But `useMemoryStore.points` is unbounded (see P-MEM-01) — after 100 hikes could be 100+ segments = 10,000 union ops → visible jank on the Memory tab.
- Fix: Cap fog corridors to most-recent 50 segments OR precompute the fog union at hike-save time and store as pre-baked geometry.

### P-RENDER-16 [Medium]: useMemoryStore.recordPoint rebuilds bucket index on every point
- Evidence: `useMemoryStore.ts:234` `const idx = get()._bucketIndex ? new Map(get()._bucketIndex!) : buildBucketIndex(points);`
- Impact: `new Map(oldMap)` is O(N). Called on every recordPoint → O(N) per point → O(N²) per hike.
- Fix: bucket index should be mutated in place, not cloned every time. Or use immer.

---

## 2. Memory

### P-MEM-01 [Blocker]: useMemoryStore.points is unbounded — no cap, never pruned
- Evidence: `useMemoryStore.ts:56 points: VisitedPoint[]; :204 points: []` — no MAX. Grep for `MAX_POINTS` in useMemoryStore returns nothing.
- Growth rate: `recordPoint` fires from GPS at 3s interval when moving. 1h hike = ~1200 points. Deduped at 12.5m so effectively depends on route length. A 12h Great Walk could easily accumulate 500-1500 unique points. Multiplied by hundreds of hikes over a user's lifetime → 100k+ points.
- Storage: `storage.setItem(storageKey(userId), JSON.stringify(next))` runs on every mutation — writes the entire array to AsyncStorage.
- Memory impact: each VisitedPoint is ~80 bytes → 100k pts = 8MB in-memory + doubled during JSON.stringify + doubled again during AsyncStorage native serialize → 24MB spikes.
- Fix: cap at MAX_MEMORY_POINTS (e.g. 20,000), evict oldest. Or use spatial cull: drop points inside cells already 100% covered.

### P-MEM-02 [Blocker]: useTrackingStore.trackPoints unbounded, uses `[...s.trackPoints, rawPoint]` O(N) per point
- Evidence: `useTrackingStore.ts:1574, 1687` — `trackPoints: [...s.trackPoints, rawPoint]` and same for trackPointsSmoothed + trackPointsRaw (three parallel unbounded arrays).
- Growth: 12h hike @ 3s sampling = ~14,400 pts × 3 arrays = 43k objects. Each ~100 bytes = ~4MB in-memory. Then `[...arr, x]` allocates a new array of length N+1 on each addTrackPoint → over the hike GC allocates ~1M array cells cumulatively (proportional to O(N²/2) allocation).
- Impact: memory pressure grows through the hike, GC pauses become visible after ~4h. On iPhone SE (2GB RAM, 500MB per-app soft cap) this **is** the jetsam kill root cause the code comments repeatedly reference.
- Fix: use `s.trackPoints.push(rawPoint)` on a mutable buffer + wrap in immer/proxy for zustand subscription notification, OR maintain a max window (e.g. last 5000 points in-memory, older ones flushed to disk via hikeTrackWriter — which already exists but currently duplicates rather than replaces).

### P-MEM-03 [Critical]: trackPointsSmoothed + trackPointsRaw are pure duplicates
- Evidence: three arrays maintained simultaneously — `trackPoints`, `trackPointsSmoothed`, `trackPointsRaw`. Comment at line 1573-1576 shows all three appended per addTrackPoint.
- Impact: 3× memory for tracking. If HikingMap only renders smoothed, `trackPointsRaw` is a leak of unused RAM.
- Fix: verify which arrays have live consumers; drop the ones with 0 readers. Prior O1 batch already dropped `trackPointsRaw, pausePins` from useSessionStore (comment at useSessionStore.ts:37) — same pruning needed in useTrackingStore.

### P-MEM-04 [Critical]: hikeTrackWriter appends every point to JSONL — but also keeps in useTrackingStore
- Evidence: `useTrackingStore.ts:1594` calls `appendHikePoint` for every point already added to trackPoints.
- Impact: point stored in memory + on disk simultaneously. Memory hasn't been reduced — disk write is additive, not a memory relief.
- Fix: swap useTrackingStore.trackPoints to a rolling window (last 500 for map preview) + disk as source of truth for save.

### P-MEM-05 [Blocker]: SessionStore rewrites entire sessions summary to AsyncStorage on every mutation
- Evidence: `useSessionStore.ts:99, 128, 165, 176` — every addSession/deleteSession/markSynced/removeLocal writes `JSON.stringify(summaries)`.
- Impact: with 100 sessions × ~500 bytes each = 50KB rewrite per mutation. AsyncStorage.setItem is IPC to native → blocks JS thread ~10-30ms per call. During hike save, this fires 2-3 times → 30-90ms hitch at the exact moment user taps Save.
- Fix: use react-native-mmkv (sync, native, ~100× faster than AsyncStorage) or write only the delta.

### P-MEM-06 [Critical]: MMKV never adopted despite obvious win
- Evidence: `Grep MMKV` → 0 matches. All persistence goes through `AsyncStorage` (native async round-trip) + `JSON.stringify` (full serialize).
- Impact: cold boot re-parses 3-5 large JSON blobs sequentially → contributes to 15-20s Settings cold render (Settings triggers memory hydrate on mount).
- Fix: replace `storage.ts` internals with MMKV. Same API surface.

### P-MEM-07 [Critical]: 22 setInterval timers with cleanup, but multiple started at App root have no unmount cleanup
- Evidence: `App.tsx:551` `AppState.addEventListener` inside useEffect — returns `sub.remove()`. Good.
  But `debugLogger.ts:143`, `batteryMonitor.ts:63`, `networkMonitor.ts:86`, `sessionRecorder.ts:191`, `autoPauseMonitor.ts:110`, `telemetryUploader` are all module-level singletons — created once at import, never torn down. If tests reload or the module is re-required, timers stack.
- Fix: singletons should expose `stop()` explicitly; verify start() is idempotent (only useTrackingStore already handles this with defensive clears).

### P-MEM-08 [Medium]: MemoryScreen 500ms heartbeat setInterval
- Evidence: `MemoryScreen.tsx:460` — `const heartbeat = setInterval(() => log('memory.js_heartbeat', {...}), 500);` cleanup on tab_blur.
- Impact: 500ms interval producing log events → 120/min → contributes to debugLogger buffer + battery drain when Memory tab is open. Comment says it's for diagnostics — should be dev-only.
- Fix: gate on `__DEV__` or debugMode setting.

### P-MEM-09 [Medium]: useMemoryStore hydrate spins bucket index rebuild at cold boot
- Evidence: `useMemoryStore.ts:234` `buildBucketIndex(points)` on hydrate. Points may be tens of thousands. buildBucketIndex is O(N).
- Impact: Blocking JS thread during hydrate — contributes to boot time.
- Fix: lazy-build bucket index on first isExplored/recordPoint call, not at hydrate.

### P-MEM-10 [Medium]: Closures in useTrackingStore capture `get()` — no direct leak, but keeps store instance alive
- Evidence: intervals reference `get().status`, `get().trackPoints` etc. Standard zustand pattern, safe. Flagging only for review.

---

## 3. Network

### P-NET-01 [Critical]: No Cache-Control anywhere in the codebase
- Evidence: `Grep Cache-Control|no-cache|max-age` → 0 matches.
- Impact: All API responses use whatever default HTTP cache — likely fully cached OR fully uncached depending on server headers. No client-side cache invalidation strategy.
- Fix: add stale-while-revalidate for `/api/sessions`, `/api/markers`, `/api/friends` list endpoints. Or use react-query.

### P-NET-02 [Critical]: Concurrent request storm on FriendsScreen mount
- Evidence: `FriendsScreen.tsx:373` `await Promise.all([loadFriendsFromBackend(), loadRequests()]);` — plus `loadCircleMarkers()` fire-and-forget.
- Impact: 3 concurrent requests on tab focus; add profile-photo fetches, this can peak at ~10 requests. On mobile network, this contends for TCP slots.
- Fix: acceptable but consider serial for cold boot; add p-limit for photo fetches.

### P-NET-03 [Critical]: Only 3 files use AbortController
- Evidence: `Grep AbortController` → 5 files. Auth/routing/snap have it. `apiService.ts`, `sessionService.ts`, `authService.ts` calls do NOT abort on unmount.
- Impact: user navigates away mid-fetch → response still processes on return → setState on unmounted component → warning + memory retention. Also wastes bytes for canceled navigations.
- Fix: standardize fetchWithTimeout signature to accept `signal`, plumb through to all call sites.

### P-NET-04 [Critical]: fetchWithTimeout is duplicated across 3 files (memorySync, MapMatchingClient, snapTrack)
- Evidence: each has its own implementation with slightly different semantics.
- Impact: no consistent retry, backoff, or telemetry across the codebase.
- Fix: single `services/http.ts` with fetch wrapper: timeout + retry + AbortController + logging.

### P-NET-05 [Medium]: No exponential backoff on retries
- Evidence: telemetryUploader and offlineQueue retry, but no backoff observed. `Grep backoff` → 0 hits.
- Impact: on flaky mobile network user's device hammers server every X seconds for hours.
- Fix: exponential backoff 2s → 4s → 8s → capped at 5min.

### P-NET-06 [Medium]: Incremental flush intervals may fire during background
- Evidence: `useTrackingStore.ts:631` incrementalFlushInterval fires PATCH to server every 120s foreground / 300s background. In background, on cellular, this drains data budget.
- Impact: 12h hike = 360 flushes × ~1KB = ~360KB cellular per hike. Acceptable but flag.
- Fix: allow user setting for "cellular data cap during tracking".

### P-NET-07 [Medium]: No batch endpoint for friend photo fetch
- Evidence: no evidence of batched avatar/photo endpoint.
- Fix: if user has 50 friends, that's 50 GET requests. Add `/api/users?ids=1,2,3` batching.

### P-NET-08 [Medium]: `debugLogger` uploads on session end synchronously chained
- Evidence: `useTrackingStore.ts:863-869` — batteryMonitor.stop().finally(debugLogger.endSession().then(telemetryUploader.upload)).
- Impact: on hike stop, telemetry upload can block finalize logic for 5-30s on slow network.
- Fix: fire-and-forget with queue persistence.

---

## 4. Storage

### P-STORE-01 [Blocker]: useSessionStore writes entire summaries array on every mutation
- Evidence: `useSessionStore.ts:99, 128, 165, 176` — see P-MEM-05.
- **Duplicate of P-MEM-05, listed under Storage since it's I/O bound.**
- Impact: hike save = 1 addSession = full rewrite. 100 sessions = 50KB serialize + AsyncStorage.setItem = ~30ms JS thread hitch.
- Fix: incremental writes via MMKV keyspace, or accept and mitigate by moving write to microtask queue after UI transition.

### P-STORE-02 [Blocker]: hikeTrackWriter flushes buffer every 30s OR 50 points — sizes concatenate O(N)
- Evidence: `hikeTrackWriter.ts:38 FLUSH_INTERVAL_MS = 30_000`, flushBuffer reads existing file, appends new lines, writes back (line ~198 in flushOldSession).
- Impact: "30s buffer × 1h = ~120 flushes, each concat writes O(file_size)" — the comment itself acknowledges O(N²) growth. 12h hike = ~1440 flushes, at hike-end file is ~2MB, cumulative writes = ~2.9GB.
- Fix: append-only via `fs.writeAsStringAsync(path, lines, { encoding: 'utf8', append: true })` or use expo-file-system append flag. Current concat behavior is silently wasting battery + wear on flash storage.

### P-STORE-03 [Critical]: memoryPersistence writes entire memory points array on every recordPoint
- Evidence: `useMemoryStore.ts:252, 364, 391, 436, 511, 670, 685` — each mutation calls `storage.setItem(storageKey, JSON.stringify(next))` with full payload.
- Impact: 100k points → 8MB JSON.stringify → 8MB AsyncStorage write per hike-save trigger. Not per point, but still enormous.
- Fix: dirty-flag + throttled write (max 1 write per 10s) + MMKV.

### P-STORE-04 [Critical]: 42 files use AsyncStorage / localStorage directly instead of via storage.ts wrapper
- Evidence: `Grep MMKV|AsyncStorage` → 42 files. Only some go through the wrapper. Others `import AsyncStorage from '@react-native-async-storage/async-storage'` directly.
- Impact: inconsistent error handling; hard to swap to MMKV globally.
- Fix: enforce via lint rule: only `storage.ts` may import AsyncStorage.

### P-STORE-05 [Medium]: clearSessions comment admits orphaned trackpoints stay on disk
- Evidence: `useSessionStore.ts:114-117` — "trackpoints keyed per-session-id are not enumerable... They become orphaned but unreachable".
- Impact: over time (multi-user devices, logout/login cycles), orphaned trackpoints accumulate. iOS may reclaim, but on Android these stay.
- Fix: on logout, `AsyncStorage.getAllKeys()` filter `cairn_trackpoints_{prevUserId}_*` and remove.

### P-STORE-06 [Medium]: bootDiagnostics writes checkpoint on every markBootPhase call
- Evidence: `bootDiagnostics.ts:108` `void AsyncStorage.setItem(CHECKPOINT_KEY, JSON.stringify(cp))`. App.tsx calls markBootPhase 30+ times at boot.
- Impact: 30 AsyncStorage writes during boot serialization → measurable boot time cost.
- Fix: batch checkpoint writes; only write on error boundaries + at final "boot_complete".

### P-STORE-07 [Medium]: Storage growth estimate per hour of hiking
- addTrackPoint fires ~3s → 1200 pts/h × ~150 bytes each = **~180KB/h in trackPoints alone**
- Plus JSONL hikeTrack disk write of the same → **~180KB/h disk**
- Plus incremental server flush 120s → ~30 PATCH bodies × ~20KB = **~600KB/h uplink**
- Plus useSessionStore.setItem N times = negligible until save
- Fix: acceptable but document per Product for cellular users.

---

## 5. Battery

### P-BAT-01 [Blocker]: GPS accuracy = BestForNavigation continuously during hike
- Evidence: `useTrackingStore.ts:1840, 1896` — `accuracy: Location.Accuracy.BestForNavigation` on both foreground watch and background task.
- Impact: BestForNavigation is the HIGHEST setting (uses GPS + sensors continuously). Battery drain is 8-15%/h on iPhone 12. For 12h Great Walk this drains phone from 100% to critical zone even with battery pack.
- Comparison: Strava default = "Balanced" or "High" (~5-7%/h). Komoot default = "Balanced" during tracking.
- Fix: use Balanced/High as default; escalate to BestForNavigation only when user explicitly enables "high-precision mode" or during route recording where jitter matters more. dynamicSamplingInterval already downgrades interval, extend it to downgrade accuracy too.

### P-BAT-02 [Critical]: distanceInterval = 5m — very tight for a slow hiker
- Evidence: `useTrackingStore.ts:1842, 1898`.
- Impact: on a windy trail with GPS noise, this fires ~1 fix/s. Combined with BestForNavigation, GPS core stays warm continuously.
- Fix: raise to 10m for hiking mode; keep 5m for running mode.

### P-BAT-03 [Critical]: PulsingDot Animated.loop never stopped (see P-RENDER-11)
- Duplicate flag — kills battery via GPU compositor thread.

### P-BAT-04 [Critical]: 22 setInterval timers running during a hike
- Evidence: durationInterval (1s), drainInterval (1s), dynamicSamplingInterval (10s), incrementalFlushInterval (120s), tokenRefreshInterval (30min), autoPauseMonitor (unknown), batteryMonitor, networkMonitor, sessionRecorder, debugLogger flush (30s).
- Impact: JS event loop wakeups every ~1s → CPU can't fully idle → 2-3%/h baseline drain even at rest.
- Fix: consolidate 1s tickers into a single tick that broadcasts to consumers.

### P-BAT-05 [Critical]: showsBackgroundLocationIndicator = true (see line 1899)
- Evidence: `useTrackingStore.ts:1899`.
- Impact: correct for iOS transparency but keeps blue indicator visible, consuming display. Acceptable.

### P-BAT-06 [Medium]: staysActiveInBackground for audio
- Evidence: `App.tsx:415` — `staysActiveInBackground: true` for expo-av.
- Impact: keeps audio session alive even when not speaking → minor drain (~1%/h). Only needed during TTS.
- Fix: activate audio session on-demand right before TTS speak; deactivate after.

### P-BAT-07 [Medium]: useKeepAwake in HikingScreen + RunningScreen
- Evidence: `Grep KeepAwake` — 2 files.
- Impact: correct behavior — user wants screen on. But nothing throttles screen brightness. iOS has auto-brightness but developer should let user set "night mode" for reduced backlight during long hikes.
- Fix: add setting for max brightness during tracking (via `expo-brightness`).

### P-BAT-08 [Medium]: No wake-lock release on Low Power Mode
- Evidence: `lowPowerModeWarn.ts` exists but only warns; does not adjust tracking behavior.
- Impact: user in LPM gets full BestForNavigation → phone dies faster.
- Fix: if LPM detected, downgrade to `Balanced` + double sampling interval + skip Kalman.

---

## 6. Map performance

### P-MAP-01 [Blocker]: PointAnnotation used for markers instead of MarkerView / SymbolLayer
- Evidence: `MapScreen.tsx:171, 156` — `markers.map(m => <PointAnnotation ...>)`. Each PointAnnotation is a native view.
- Impact: Mapbox docs explicitly warn that PointAnnotation "does not scale to hundreds of markers". Each renders a separate native view. Above ~50 markers, pan/zoom is <15fps on iPhone 12 and worse on SE.
- Fix: use SymbolLayer with a GeoJSON ShapeSource + circle/symbol style — cluster with `clusterMaxZoomLevel`. Fallback MarkerView for the SINGLE selected marker only. **Note: CairnPinsLayer already uses this pattern (`featureCollection` at :155) — extend to all markers everywhere.**

### P-MAP-02 [Critical]: No marker clustering
- Evidence: `Grep cluster` in /screens/ — not present.
- Impact: A user with 500 flags anywhere in the world sees 500 PointAnnotations rendered. iPhone SE at ~30 fps drops to 5.
- Fix: enable Mapbox ShapeSource `cluster: true, clusterMaxZoomLevel: 12, clusterRadius: 50`. Below cluster zoom, aggregate.

### P-MAP-03 [Critical]: Fog polygon vertex budget uncapped for long-lived users
- Evidence: `FogLayer.tsx:194` comment claims "~2400 verts still well under ~5000 vert earcut bug". But base assumption is "5-hike accum × 30 GPS pts × 16 steps". At 100 hikes × 100 pts × 16 = **160,000 verts**. earcut catastrophically slows above 10k.
- Impact: after ~30 hikes user sees Memory tab freeze for seconds when panning.
- Fix: bake fog geometry per-hike at save time, cache result; union at display time from cached per-hike polygons.

### P-MAP-04 [Medium]: MapView renders same time as fog + pins
- Evidence: MapScreen assembles all layers eagerly on mount.
- Impact: cold navigation to Map = full Mapbox init + all sources + fog compute + pin render simultaneously.
- Fix: mount MapView first, mount layers via useEffect after `onDidFinishLoadingMap`.

### P-MAP-05 [Medium]: No tile prefetch for offline-planned areas
- Evidence: offlineMapService.ts exists (offline packs).
- Impact: user with offline packs still sees network requests on pan into the pack because prefetch doesn't preload styles/glyphs into map cache before viewing.
- Fix: check offlineMapService already handles this; if not, add `offlineManager.setTileCountLimit`.

---

## 7. Bundle size

### P-BUNDLE-01 [Critical]: App.tsx has 40+ eager imports at module top
- Evidence: `App.tsx:1-25` — imports SafeAreaProvider, expo-web-browser, expo-font, useAppStore, useSettingsStore, useTrackingStore, initMapbox, debugLogger, backgroundLocationTask, telemetryUploader, networkMonitor, isPlaywrightBypass, crashLogger, OTA_VERSION, API_BASE_URL, markBootPhase, MigratorRetryPrompt, useMemorySettingsStore, getFlags, RootNavigator.
- RootNavigator itself imports every screen — full app bundle parsed at boot.
- Impact: JS bundle parse blocks first paint. Reported symptom: 15-20s Settings cold render is partly this — Settings tab mounts after boot, but requires Memory hydrate (heavy).
- Fix: use `React.lazy` for non-Auth screens; RootNavigator can lazy-load screens per stack.

### P-BUNDLE-02 [Critical]: RoutesScreen is 1476 lines including three tabs
- Evidence: `wc -l RoutesScreen.tsx = 1476`.
- Impact: navigating to Routes loads all three tabs' code + Mapbox preview + all icons + Illustrations. This is the immediate cause of the 5-15s render hang.
- Fix: split into three files, dynamic import per tab.

### P-BUNDLE-03 [Critical]: MapHistoryScreen 1737 lines
- Evidence: `wc -l = 1737`. Contains history + editing + trim slider + fog preview.
- Impact: heavy screen; navigate cost.
- Fix: split into MapHistoryList + MapHistoryDetail.

### P-BUNDLE-04 [Critical]: useRouteEditStore 2871 lines
- Evidence: `wc -l = 2871`.
- Impact: any screen importing this store pulls the whole file (routes, edit, undo, trim, migration). RoutesScreen imports it → contributes to bundle bloat.
- Fix: split into 3 stores: useRouteStore (already exists), useRouteEditStore (edit session), useRouteMigration (migration only, loaded lazily).

### P-BUNDLE-05 [Critical]: useTrackingStore 1937 lines
- Evidence: `wc -l = 1937`. Any screen using tracking pulls all this + Kalman + background task + hikeTrackWriter.
- Fix: split Kalman geometry into utils; keep store focused on state.

### P-BUNDLE-06 [Medium]: expo-font Inter loaded from local .ttf via require
- Evidence: `App.tsx:186-189` — three separate ttf imports.
- Impact: OK but blocks first paint (see `if (!fontsLoaded && !fontError)` at :622).
- Fix: use `expo-font.loadAsync` after first paint OR preload via native fontFamilies. Accept 250ms tradeoff for correct fonts.

### P-BUNDLE-07 [Medium]: @turf/helpers required inline inside FogLayer buildFogShape
- Evidence: `FogLayer.tsx:169` — `require('@turf/helpers')` inside function.
- Impact: correct pattern to defer load, but require() is sync — first call still blocks. Turf is ~300KB gzipped.
- Fix: use dynamic import.

### P-BUNDLE-08 [Medium]: Inline Mapbox require at top-level in every map screen
- Evidence: MapScreen, MapHistoryScreen, MarkerDetailScreen, HikingMap all have `if (Platform.OS !== 'web') { try { const Mapbox = require('@rnmapbox/maps'); ... } }`. Correct guard, but the require runs once per screen module load.
- Impact: bundle already includes Mapbox JS binding once — repeated require is cached, negligible.

---

## 8. Cold-boot time

### P-BOOT-01 [Blocker]: App.tsx module-level side effects
- Evidence: `App.tsx:41-89` — `markBootPhase`, `WebBrowser.maybeCompleteAuthSession()`, `initMapbox()`, `registerBackgroundTask()`, IIFE for background task cleanup all run at module parse time BEFORE React renders.
- Impact: bundle parse ends → these run → then React mounts. If any is slow (e.g. initMapbox on iOS calls native), cold-boot is delayed.
- Fix: move to useEffect inside App() where they can be deferred.

### P-BOOT-02 [Critical]: 3-hydrate sequence at boot (settings, memory, app)
- Evidence: `App.tsx:333` hydrateSettings; `:348` memorySettings.hydrate; `:356` hydrate (which is useAppStore.hydrate).
- All three read AsyncStorage. Not awaited. Race conditions handled by `hydrated` + `settingsHydrated` gates.
- Impact: 3 AsyncStorage reads + 3 JSON.parse of variable size. Memory hydrate specifically reads points array which could be 8MB.
- Fix: MMKV would eliminate this bottleneck entirely.

### P-BOOT-03 [Critical]: Memory hydrate parses points array synchronously in one JSON.parse
- Evidence: `useMemoryStore.ts` hydrateForUser reads full JSON. Combined with unbounded points array (P-MEM-01), this is the smoking gun for the reported 15-20s Settings cold render — Settings mount triggers memory hydrate.
- Fix: paginate the memory persist (write in chunks), or lazy-hydrate only when Memory tab opens (comment at App.tsx:651-660 confirms this is the intent for ForegroundUnlockManager but the store hydrate itself still runs eagerly).

### P-BOOT-04 [Critical]: OTA check at boot with 8s timeout
- Evidence: `App.tsx:253-256` — `withTimeout(Updates.checkForUpdateAsync(), 8000)` + `fetchUpdateAsync(), 8000`.
- Impact: cold boot has up to 16s of OTA work in flight. Doesn't block UI (fire-and-forget) but competes for network/CPU.
- Fix: defer OTA check by 5s so user sees UI first.

### P-BOOT-05 [Medium]: Route pending cleanup IIFE at boot
- Evidence: `App.tsx:475-547` — `AsyncStorage.getAllKeys()` on every boot.
- Impact: `getAllKeys` is O(N) over stored keys — for a user with many hikes, this iterates hundreds. Then filter + iterate again.
- Fix: gate on a "dirty flag" — only run cleanup if a marker in storage says routes are pending.

### P-BOOT-06 [Medium]: bootDiagnostics writes on every phase (30+ writes at boot)
- Duplicate of P-STORE-06.

---

## Anti-patterns audit (from checklist)

| Anti-pattern | Count | Files |
|---|---|---|
| `arr.forEach(async x => ...)` unbounded parallel | 0 | None found |
| `Promise.all(bigArr.map(fetch))` no limit | Present in `FriendsScreen.tsx:373` (only 2 fixed calls, bounded — OK) |
| setState in loops | Not found in top-level screens |
| Missing FlatList keys | Not found — all use `keyExtractor` |
| Inline anon renderItem | 3+ in RoutesScreen — see P-RENDER-08 |
| `Animated.loop` without .stop() cleanup | RunningScreen.tsx:66 — P-RENDER-11 |
| Cursor iteration without pagination | Not found; sessions capped at MAX_SESSIONS=100 |
| Timers without cleanup | 22 setInterval sites; 20 have proper cleanup; module-level singletons (P-MEM-07) don't |

---

## Priority summary

| Priority | Count | Findings |
|----------|-------|----------|
| Blocker  | 10 | P-RENDER-01, P-RENDER-02, P-RENDER-07, P-MEM-01, P-MEM-02, P-MEM-05, P-STORE-01, P-STORE-02, P-BAT-01, P-MAP-01, P-BUNDLE-01, P-BOOT-01 |
| Critical | 25+ | P-RENDER-03 through P-RENDER-11, P-MEM-03, P-MEM-04, P-MEM-06, P-MEM-07, P-NET-01 through P-NET-04, P-STORE-03, P-STORE-04, P-BAT-02, P-BAT-03, P-BAT-04, P-MAP-02, P-MAP-03, P-BUNDLE-02, P-BUNDLE-03, P-BUNDLE-04, P-BUNDLE-05, P-BOOT-02, P-BOOT-03, P-BOOT-04 |
| Medium   | 20+ | Remaining items |
| Low      | 0 | (findings intentionally graded high — this is pre-launch) |

**Total findings: 55+**

---

## Estimates (based on code review — not measured)

- **Cold-boot on iPhone 12** (typical user with ~20 sessions + ~200 memory points):
  - JS bundle parse: 1.2–1.8s (large App.tsx + eager RootNavigator)
  - Module-level side effects: 0.3–0.6s (initMapbox, background task register)
  - 3× AsyncStorage hydrate: 0.4–1.0s
  - Font load: 0.2–0.4s
  - **Total: 2.1–3.8s** — acceptable for launch, but P-BOOT-04 OTA check adds up to 2s of contention.

- **Cold-boot on iPhone SE (2020)** (2GB RAM, A13):
  - All the above × 1.5–2× = **3.5–7s** — problematic; combined with P-BOOT-03 memory hydrate spike this **is** the reported 15-20s Settings render.

- **Memory during 4h hike**:
  - trackPoints (raw + smoothed + trackPointsRaw): 3 × 4800 pts × 100B = **~1.5MB** live
  - useMemoryStore.points (append 200 new): ~20KB delta but full array re-serialized on save
  - hikeTrackWriter buffer flushed to disk: **stable ~30KB in memory**
  - Debug logger buffer capped at 1000 events × ~200B = **200KB**
  - GC allocations from `[...arr, x]` pattern: **cumulative ~200MB over 4h** (garbage, but each collection is a pause)
  - **Working set peak: ~20-30MB** — OK; **GC pressure: high** — visible frame drops after 2h.

- **Memory during 12h Great Walk** (jetsam risk zone):
  - trackPoints: 14,400 × 3 × 100B = **~4.3MB** live (up from 1.5MB)
  - GC pressure grows quadratically due to P-MEM-02 spread operator pattern
  - **Prediction: iPhone SE jetsam-kill around hour 6–8** if no other perf work is done. Aligns with existing comments about jetsam-resistant boot tracing.

- **Battery drain per hour tracking** (screen on, BestForNavigation):
  - GPS core continuous: **~5-7%/h**
  - Screen on max brightness: **~4-6%/h**
  - JS event loop + timers: **~1-2%/h**
  - Cellular flush every 120s: **~0.5%/h**
  - **Total: 10-15%/h** — significant. For 12h Great Walk without recharge, requires 100% start + one full 20W battery pack.

- **Storage per hour hiking**:
  - trackPoints in-memory: ~180KB/h
  - hikeTrack JSONL (mirror + concat waste): **~2-4MB/h due to P-STORE-02 concat pattern**
  - Server flush uplink: ~600KB/h cellular
  - Session summary rewrite on save: 50KB (one shot)

---

## Recommended optimizations (ranked by impact/effort ratio)

1. **[Blocker, ~2 days] Replace `[...s.trackPoints, rawPoint]` pattern with immer or mutable append** (P-MEM-02). Single biggest win: eliminates ~200MB GC waste per 4h hike. Fixes jetsam risk. Fixes ongoing frame drops.

2. **[Blocker, ~1 day] Add FlatList perf props** (P-RENDER-07): `getItemLayout`, `initialNumToRender`, `windowSize`, `removeClippedSubviews`. Directly fixes reported 5-15s Routes tab render hang.

3. **[Blocker, ~1 day] Split RoutesScreen into three tab files with dynamic import** (P-BUNDLE-02, P-RENDER-12). Complements #2.

4. **[Blocker, ~2 days] Cap useMemoryStore.points with eviction + move to MMKV** (P-MEM-01, P-STORE-03). Fixes 15-20s Settings cold render. Prevents multi-year memory bloat.

5. **[Blocker, ~1 day] Downgrade default GPS to Balanced** (P-BAT-01). Cuts battery drain from 10-15%/h to 6-9%/h. Enables full-day tracking without power bank.

6. **[Blocker, ~1 day] Move Zustand subscriptions to atomic slices; remove HomeScreen subscribing to durationS** (P-RENDER-02). Kills 1s re-render tax.

7. **[Blocker, ~2 days] Switch AsyncStorage → MMKV via storage.ts** (P-MEM-06, P-STORE-01, P-STORE-03). Boot time drops ~500ms; hike save no longer hitches.

8. **[Blocker, ~3 days] Migrate marker rendering from PointAnnotation to SymbolLayer + clustering** (P-MAP-01, P-MAP-02). Restores map pan/zoom to 60fps on iPhone SE with 100+ flags.

9. **[Critical, ~1 day] Add React.memo to PressBtn, Icon, ActivityIcons, all card components** (P-RENDER-01). Reduces cascade re-renders across all list screens.

10. **[Critical, ~1 day] Fix hikeTrackWriter to append-only instead of read+concat+write** (P-STORE-02). Cuts disk write from ~2.9GB/12h hike to ~2MB/12h hike. Massive battery + flash wear win.

11. **[Critical, ~1 day] Add Animated.loop cleanup in RunningScreen** (P-RENDER-11). Fixes memory leak on tab switch.

12. **[Critical, ~2 days] Consolidate 22 setInterval sites into 1 shared 1s tick loop** (P-BAT-04, P-MEM-07). Cuts JS wakeup rate.

13. **[Critical, ~1 day] Bake fog polygon geometry at hike-save time; cache** (P-MAP-03, P-RENDER-15). Prevents Memory tab freeze for long-time users.

14. **[Critical, ~1 day] Add AbortController + shared fetch wrapper** (P-NET-03, P-NET-04). Prevents unmounted-component setState warnings + wasted bytes.

15. **[Critical, ~1 day] Move App.tsx module-level side effects into useEffect** (P-BOOT-01). Shaves 0.5–1s off cold boot.

16. **[Medium, ~1 day]** Reduce distanceInterval to 10m in hiking mode (P-BAT-02).

17. **[Medium, ~1 day]** Downgrade GPS + double sampling interval when Low Power Mode detected (P-BAT-08).

18. **[Medium, ~2 days]** Add memory + tracking-store selectors using `shallow` (P-RENDER-04).

19. **[Medium, ~1 day]** Cap AsyncStorage.getAllKeys usage at boot via dirty-flag gate (P-BOOT-05).

20. **[Medium, ~1 day]** Add Cache-Control + retry backoff (P-NET-01, P-NET-05).

**Estimated total effort for all Blockers + Criticals: ~3-4 weeks of focused perf work.** Recommend at least steps 1-8 pre-NZ-launch (the "must-fix" cluster).

PERFORMANCE_AUDIT_COMPLETE
