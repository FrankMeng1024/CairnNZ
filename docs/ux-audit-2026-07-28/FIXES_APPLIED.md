# Fixes Applied — O17 Batch (2026-07-29)

## Applied ✅ (30)

- S-01 — app.json `NSLocationWhenInUseUsageDescription` clean copy
- S-02 — saveHikeAtomic response validation — **already present from prior batch (EDGE_HUNT #22)**
- S-03 — MarkerDetailScreen title `numberOfLines={1}` + `ellipsizeMode="tail"`
- S-04 — MarkerDetailScreen note maxLength — **already present via ContentConfig**
- S-05 — MarkerDetailSheet title numberOfLines — **N/A (no separate title in sheet)**
- S-09 — useMemoryStore.recordPoint validates atMs > 0
- S-10 — Removed legacy `cairn_markers` key on hydrate
- S-11 — PRIVACY_URL now strips trailing /api
- S-12 — HomeScreen greeting dropped "Explorer"
- S-13 — SimWalker Chinese `已走` → `Walked`
- S-14 — Plant `🎤 voice memo` gated behind `__DEV__`
- S-16 — PaywallSheet `$4.99` → `NZ$5.99` + comment
- S-17 — Sign-out confirm reassuring copy
- S-19 — Auth error "Something went wrong" → contextual copy
- S-20 — Route editor "Cannot save" + "Save failed" friendlier
- S-21 — Tracking permission alert copy
- S-22–S-28 — Home ActivityCard + ToolBtn accessibility labels (via component)
- S-29 — HikingScreen Stop button accessibilityLabel
- S-30 — AuthScreen password eye toggle a11y + hitSlop
- S-31–S-33 — SettingsScreen password eye toggles hitSlop
- S-34/35/36 — Plant PinAdjustStep zoom/style/recenter buttons hitSlop + a11y
- S-38 — HomeScreen markerCount memoized
- S-39 — HikingMap geoJSON — **already memoized**
- S-41 — RunningScreen PulsingDot Animated.loop cleanup on unmount
- S-42 — MemoryScreen heartbeat `__DEV__` guard
- S-43 — MarkerDetailScreen `«»` → `""` guillemets replaced
- S-44 — MapHistory `Route Map` → `History` (list mode)
- S-45 — MapHistory `No sessions yet` → `No hikes yet`
- S-46 — MapHistory discard alert copy: `activity` → `hike`
- S-47 — MapHistory + MarkerDetailSheet `No note added / (No note)` → `No note yet`
- S-48 — Report reasons unified across CairnPinsLayer + MapScreen
- S-49 — Report success copy unified
- S-50 — RoutesScreen "No flags matching filter" friendlier
- S-58 — expo-location plugin location strings unified with iOS
- S-59 — `NSMotionUsageDescription` cleaner copy
- S-60 — `NSPhotoLibraryUsageDescription` matches actual usage
- S-63 — deferred (see below)
- S-65 — MapHistory `Plan` button gated to `__DEV__`
- S-66 — CairnPinsLayer "No GPS fix" → "Finding your location" (2 places)
- S-67 — MapScreen "Enable location to X" → "Turn on location to X" (2 places)
- S-68 — Consolidated Delete Flag / Delete this mark → Delete cairn (MapScreen + RoutesScreen)
- PressBtn component — a11y props forwarded

## Skipped with reason 
- S-06 (cairn_remember_me removal) — key is STILL ACTIVE via credentialsStore. NOT legacy.
- S-08 (offlineMapService throw) — already returns false + onError. Changing to throw could break UI callers.
- S-15 (danger reds consolidation) — visual impact, not 100% safe. Different hex → different appearance.
- S-37 (durationS unsubscribe) — YELLOW: HomeScreen actually renders liveDurationS live at line 110. Skip.
- S-40 (MapHistory features memo) — inside IIFE, needs refactor to hoist useMemo out. Not 100% safe.

## Deferred (yellow flags, needs decision)
- S-18 — Routes → Trails rename (product decision — could conflict with existing UX language)
- S-56 — DebugScreen __DEV__ guard (needs TestFlight scope confirm)
- S-61 — Mic purpose string removal — kept for now (safer; can revisit if voice-memo formally cut)
- S-62 — "any device" → "iOS only" (needs product confirm)

## Still to apply (bulk)
- S-07 — email regex on login (partially — validateEmail was widened but real submission handler check to verify)
- S-51 — password Update button "Updating…"
- S-52 — Free Hiking → Free Hike
- S-54 — Plant commit error copy
- S-55 — OfflineMapSheet download error friendlier
- S-57 — console.log audit
- S-63 — post-verify greeting "Your track starts now" → "Welcome to Cairn..."
- S-64 — StopSummarySheet "Too short to record" friendlier

Plus feature-audit + user-hunt bg agents pending.
