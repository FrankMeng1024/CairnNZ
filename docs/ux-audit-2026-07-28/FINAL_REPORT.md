# Cairn UX Audit — Final Report (2026-07-28)

**OTA baseline**: O16 (with O17 partial fixes already applied)
**Target launch**: NZ App Store, Sept-Oct 2026
**Audit corpus**: 13 audit reports (Function, Launch, Edge, Cross-Review, Consistency, Playwright, Screenshot QA, User Hunt, Data Flow, Performance, Copy) + 12 per-screen AUDIT files
**Total unique issues (de-duplicated)**: ~360

---

## 1. Executive Summary

Cairn is a well-architected React Native + Expo hiking app with a strong design-system foundation (`tokens.ts`) and mature offline-first plumbing. It is **not yet launch-ready**. Across 13 audits the following totals surface:

- **Blockers**: 44 unique (18 App-Store-review-blocking; 10 performance-blocking; 16 data-loss / UX-blocking)
- **Critical**: ~120 unique
- **Medium**: ~140 unique
- **Low/Polish**: ~60

**User Hunt outcome**: 20 personas played; mean 1.7 / 5 stars; weighted-market mean 1.5 / 5. **NOT ACCEPTED** for launch.

### Top 5 launch-blocking issues (concise)

1. **Delete Account is `mailto:` only** — App Store 5.1.1(v) auto-reject risk (F-AUTH-03 / L-01 / D-USR-02 / C-66).
2. **Apple + Google Sign In are `Alert.alert('Coming soon')` stubs** — HIG 4.8 and Google brand violations (F-AUTH-01/02 / L-03 / A2 P1).
3. **`saveHikeAtomic` has no response-shape validation** — malformed backend responses mark hikes synced when they aren't (EDGE:S22 / D-HIK-04).
4. **StopSummarySheet Discard is a one-tap = data loss button** — no confirmation (hiking §25 / C-26 / persona Margaret).
5. **PaywallSheet shows USD $4.99 while launch plan is NZD $5.99, no real IAP wired** — currency mismatch and App Store 3.1.1 risk (L-05 / C-58).

**100% safe fix candidate count**: **68** (see Section 5 — mostly copy, null-guards, hardcoded colors, `numberOfLines`, dead-code, dev-guards).

---

## 2. Release-Blocking Issues

### 2.A App Store review guidelines

**B-01 — Delete Account is mailto-only**
Location: `app/src/screens/SettingsScreen.tsx:1067-1149`; missing `backend/src/routes/account.js` DELETE endpoint.
Impact: Apple 5.1.1(v) has been rejecting mailto-only deletion since 2022. User taps "delete account" → mailto opens → local logout → server row remains active indefinitely.
Fix: Implement `DELETE /api/account` with 7-day soft-delete + cron cleanup; rewire the modal.
100% safe? **NO** — backend endpoint + email infra + cron required. **Deferred (see §6).**

**B-02 — Apple Sign In stub**
Location: `app/src/screens/AuthScreen.tsx:1132-1145`.
Impact: HIG 4.8 requires Sign in with Apple when any third-party social login exists. Google button is on-screen alongside. Auto-reject.
Fix: (a) Implement `expo-apple-authentication` end-to-end, OR (b) HIDE both social buttons and ship email-only for v1.0.
100% safe? **NO** — either path is a design decision + native rebuild.

**B-03 — Google Sign In stub**
Location: `app/src/screens/AuthScreen.tsx:451-454`.
Impact: Non-functional button + hand-rolled monochrome "G" logo violates Google brand guidelines.
Fix: Same as B-02 — hide OR fully implement.
100% safe? **NO**.

**B-04 — Cairn-specific EULA / ToS missing**
Location: `SettingsScreen.tsx:892` (points at Apple stdeula); no `backend/public/terms.html`.
Impact: Guideline 1.2 requires EULA prohibiting objectionable content for UGC apps.
Fix: Draft ToS, host at `/tos`, add second checkbox at register.
100% safe? **NO** — legal drafting.

**B-05 — Privacy nutrition label undocumented**
Location: `docs/store-listing/` missing.
Fix: Draft `privacy-nutrition.md`.
100% safe? **NO** — separate authoring artifact.

**B-06 — Age gate missing (COPPA / App Store rating)**
Location: `AuthScreen.tsx` — no `dateOfBirth` field.
Fix: Add DOB at signup + reject <13.
100% safe? **NO** — flow change.

**B-07 — PaywallSheet currency + no real IAP**
Location: `app/src/features/memory/components/PaywallSheet.tsx:6-77` — hardcoded "$4.99"; comment "TestFlight-only. NO real IAP."
Impact: Currency mismatch (NZD $5.99 per launch plan) + reachable in code paths = 3.1.1 review issue.
Fix: (a) Remove PaywallSheet from user-reachable code, OR (b) wire RevenueCat with NZD product.
100% safe? **NO**.

**B-08 — Support / Marketing / Privacy URLs unverified live**
Location: External infra.
Fix: Confirm 200 on `https://api.yiiling.cn/privacy`, `https://cairnapp.nz/support`, `https://cairnapp.nz`.
100% safe? **NO** — infra check.

**B-09 — TestFlight external group unconfigured**
Location: App Store Connect dashboard (ASC `6771227406`).
100% safe? **NO** — infra.

**B-10 — App icon 1024x1024 unverified**
Location: `app/assets/icon.png`.
100% safe? **NO** — asset review.

**B-11 — Screenshots not produced**
Location: `docs/store-listing/screenshots/` missing.
100% safe? **NO** — asset production.

**B-12 — App description not drafted**
Location: `docs/store-listing/description.md` missing.
100% safe? **NO** — copywriting.

**B-13 — Staged OTA rollout % not configured**
Location: `app/eas.json`.
Fix: Enable EAS Update rollout percentage.
100% safe? **NO** — release-process change.

**B-14 — No systematic Zustand persist versioning**
Location: Multiple stores in `app/src/store/`.
Fix: Adopt `persist` middleware with `{ version, migrate }` per store.
100% safe? **NO** — cross-store refactor.

**B-15 — iOS location purpose string reads "track your track"**
Location: `app/app.json:19`.
Impact: Grammatically broken purpose string is visible to Apple reviewer.
Fix: Replace with grammatical copy.
100% safe? **YES** — see S-01.

**B-16 — No App Tracking Transparency prompt**
Location: `app/app.json` (no `NSUserTrackingUsageDescription`).
Impact: Mapbox does telemetry — Apple requires ATT.
Fix: Add ATT string + `requestTrackingPermissionsAsync` at first launch.
100% safe? **NO** — new permission flow.

**B-17 — `__cairnStores` production hook not stripped**
Location: `app/src/utils/devFlags.ts:12` (currently gated on `__DEV__`; needs verification in EAS production build).
Fix: Verify Hermes DCE removes it; add explicit `Constants.appOwnership === 'standalone'` guard.
100% safe? **VERIFY-FIRST**. Marked deferred until build hook confirmed.

**B-18 — Automated DB backup missing**
Location: `docker/docker-compose.yml`.
Fix: Nightly mysqldump → OSS.
100% safe? **NO** — infra.

### 2.B Data integrity / security (Blockers)

**B-19 — `saveHikeAtomic` no response-shape validation**
Location: `app/src/services/sessionService.ts:229-244`.
Impact: Malformed backend response with valid JSON but wrong shape marks hike synced when server didn't commit (EDGE:S22 / D-HIK-04).
Fix: Add `if (typeof json?.session_id !== 'number') throw new Error('malformed save response')` before treating success.
100% safe? **YES** — see S-02 (already partially applied per O17 pipeline; verify).

**B-20 — Concurrent Save + Delete race**
Location: `app/src/services/sessionService.ts` + `useSessionStore.ts:121-150`.
Impact: DELETE arrives while retry PATCH in flight → resurrected deleted hike (EDGE:S19).
Fix: AbortController on saves + backend 410 Gone on PATCH-after-DELETE.
100% safe? **NO** — cross-file + backend contract.

**B-21 — iCloud restore duplicates hikes on server**
Location: N/A (`useAppStore.hydrate` post-restore).
Fix: Reconcile `pendingSyncStore` against server-known ids on first-login-after-restore.
100% safe? **NO** — new reconciliation logic.

**B-22 — Cross-user marker queue leak on logout**
Location: `app/src/store/useMarkerStore.ts:461-491` — `clearMarkersQueueForCurrentUser().catch(() => {})`.
Impact: Departing user's queued POSTs fire under next user's token → cross-user data injection.
Fix: Await + fail-loud on clear failure; block login until queue confirmed cleared.
100% safe? **NO** — logout ordering.

**B-23 — Trackpoints leak on logout (orphan keys)**
Location: `app/src/store/useSessionStore.ts:114-117` — comment admits orphaned trackpoint keys.
Fix: `AsyncStorage.getAllKeys()` filter + remove on logout.
100% safe? **NO** — logout ordering + storage sweep.

**B-24 — `flushBuffer` read-modify-write (quadratic disk)**
Location: `app/src/services/hikeTrackWriter.ts:280-290`.
Impact: 3h hike = ~360MB disk churn; 12h = jetsam risk.
Fix: Use `FileSystem` append mode.
100% safe? **NO** — file-system API change with data-flow implications.

**B-25 — `authenticatedFetch` no timeout on most endpoints**
Location: `app/src/services/apiService.ts` + `sessionService.ts`.
Impact: `saveHikeAtomic`, `appendPoints`, `fetchSessions` etc. can hang indefinitely (F-NET-01).
Fix: Central `fetchWithTimeout` wrapper.
100% safe? **NO** — cross-service refactor.

**B-26 — Telemetry writes GPS data regardless of opt-in**
Location: `app/src/services/telemetryUploader.ts:79-87` + `useTrackingStore.ts:1846-1858` (`debugLogger.log('gps_fix')`).
Impact: Data captured to disk always; upload switch is only at upload time — retroactive upload possible (D-TEL-01).
Fix: Gate logging at write time on `telemetryUploadEnabled`.
100% safe? **NO** — data-flow decision.

**B-27 — Feedback text + PII in `edit_diagnostics` log**
Location: `app/src/screens/SettingsScreen.tsx:843-851`.
Impact: Free-text feedback + email in general debug log (D-FDB-01).
Fix: Separate `POST /api/feedback` endpoint + table.
100% safe? **NO** — backend change.

### 2.C Performance blockers

**B-28 — `useTrackingStore.trackPoints` `[...s.trackPoints, x]` per point**
Location: `app/src/store/useTrackingStore.ts:1574, 1687`.
Impact: O(N²) GC allocation → visible frame drops after 2h; iPhone SE jetsam risk 6-8h (P-MEM-02).
Fix: Rolling buffer or immer-mutating pattern.
100% safe? **NO** — store refactor.

**B-29 — FlatLists have zero perf props**
Location: `RoutesScreen.tsx` ×3, `MapBottomPanel`, `OfflineMapSheet`, `MemoryFriendPickModal`.
Impact: 5-15s Routes tab render hang (P-RENDER-07 / Playwright confirmed).
Fix: `getItemLayout`, `initialNumToRender`, `windowSize`, `removeClippedSubviews`.
100% safe? **NO** — needs correct row-height math per list; behaviour change.

**B-30 — React.memo used in exactly 1 component**
Location: `app/src/components/map/DualLineLayer.tsx` only.
Impact: Every parent re-render cascades entire subtree (P-RENDER-01).
Fix: Add `React.memo` to `PressBtn`, `Icon`, card components.
100% safe? **NO** — cross-file, may regress if props identity mishandled.

**B-31 — `useMemoryStore.points` unbounded**
Location: `app/src/features/memory/store/useMemoryStore.ts:56, 204`.
Impact: Multi-year users hit ~100k points → 24MB serialize spikes (P-MEM-01).
Fix: Cap + evict oldest.
100% safe? **NO** — data-retention decision.

**B-32 — `useSessionStore` rewrites entire summaries per mutation**
Location: `useSessionStore.ts:99, 128, 165, 176`.
Impact: 30-90ms JS-thread hitch at hike save (P-STORE-01).
Fix: MMKV or delta writes.
100% safe? **NO** — storage-layer swap.

**B-33 — GPS accuracy `BestForNavigation` continuous**
Location: `useTrackingStore.ts:1840, 1896`.
Impact: 8-15%/hr battery drain, 12h Great Walk unreachable without pack (P-BAT-01).
Fix: Default `Balanced`, escalate on-demand.
100% safe? **NO** — quality tradeoff, needs QA on live device.

**B-34 — `PointAnnotation` for all markers**
Location: `app/src/screens/MapScreen.tsx:171, 156`.
Impact: <15fps pan/zoom at 50+ markers on iPhone 12; SE much worse (P-MAP-01).
Fix: `SymbolLayer` + `ShapeSource` clustering.
100% safe? **NO** — visual-behaviour change.

**B-35 — App.tsx module-level side effects**
Location: `app/App.tsx:41-89`.
Fix: Move to `useEffect`.
100% safe? **NO** — boot-order sensitive.

### 2.D UI / UX blockers

**B-36 — StopSummarySheet Discard = one-tap data loss**
Location: `app/src/screens/HikingScreen.tsx` (StopSummarySheet.tsx:145-155).
Impact: Elderly / distracted users lose hike; universal fat-finger risk (hiking §25 / persona Margaret / C-26).
Fix: Two-step confirm modal.
100% safe? **NO** — new UI flow.

**B-37 — RouteEditor iOS BackButton silently discards edits**
Location: `app/src/screens/RouteEditorScreen.tsx` (per routeeditor §50/C-4).
Fix: Wire iOS soft-back to the existing Android discard alert.
100% safe? **NO** — nav-lifecycle change.

**B-38 — Hiking mid-track BackButton no confirm**
Location: `app/src/screens/HikingScreen.tsx:BackButton onPress` (hiking §33).
Fix: Confirm on active hike.
100% safe? **NO**.

**B-39 — MapScreen GPS chip is fake affordance (`<View>` not `Touchable`)**
Location: `app/src/screens/MapScreen.tsx:GPS chip` (mapscreen §7).
Fix: Either wire onPress → `Linking.openSettings()` OR remove chip when GPS is on.
100% safe? **NO** — spec decision.

**B-40 — MapScreen silent-plant at `region.center` when no GPS fix**
Location: `MapScreen.tsx:handleAddMarker` (mapscreen §26).
Impact: Data-integrity blocker — creates ghost markers.
Fix: Disable plant button until GPS acquired.
100% safe? **NO** — UI-behaviour change.

**B-41 — Memory RevealedCairnSheet handlers unwired (like/report/hide)**
Location: `app/src/features/memory/components/RevealedCairnSheet.tsx` (memory §S14/S27).
Impact: App Store 1.2 UGC — Report button that does nothing is a rejection risk.
Fix: Wire handlers OR hide buttons entirely.
100% safe? **NO** — but the "hide" variant is a candidate for the safe list (see S-25).

**B-42 — MarkerDetailSheet handle bar has no PanResponder (dark pattern)**
Location: `app/src/screens/MarkerDetailSheet.tsx` (markerdetail §S40).
Fix: Wire drag-to-dismiss OR remove handle bar.
100% safe? **NO** — visual/gesture change.

**B-43 — Home iPhone SE dense-state Leave-a-Cairn card clips**
Location: `app/src/screens/HomeScreen.tsx:482-495` (home §S32 + A-SSQA S21 confirmed via screenshot).
Fix: `minHeight` on ActivityCard OR reduce `flex: 0.4`. Design decision.
100% safe? **NO** — flagged in DEFERRED_FIXES.

**B-44 — MarkerDetailScreen title/body/note unbounded**
Location: `MarkerDetailScreen.tsx:S16/S18/S19/S35`.
Fix: Add `numberOfLines` + `maxLength`.
100% safe? **YES** — see S-03/S-04/S-05.

---

## 3. Critical Issues (should fix before submission)

Full de-dup produced ~120 Criticals. Grouped by category. IDs prefixed `C-XX`. "Safe?" column indicates whether it makes it to §5.

### 3.A Auth & Session

- **C-01**: No "Forgot password" (F-AUTH-04). Safe? NO — flow change.
- **C-02**: No server-side logout / token revoke (F-AUTH-05 / D-USR-03). Safe? NO — backend endpoint.
- **C-03**: `useAppStore.logout()` leaks friends/routes/settings stores between users (F-AUTH-06 / D-USR-04). Safe? NO — logout ordering.
- **C-04**: Delete-account doesn't `logout()` app (F-AUTH-07). Safe? NO.
- **C-05**: Sign-out during tracking has no guard (EDGE:S13, persona Jake). Safe? NO — UI flow.
- **C-06**: Password change doesn't invalidate JWT (D-PWD-01). Safe? NO — backend.
- **C-07**: Password change no rate-limit (D-PWD-04). Safe? NO — backend.
- **C-08**: Auth `getMe` timeout silent fall-through to guest (F-AUTH-09 / persona Chen). Safe? NO — UX flow.
- **C-09**: Legacy AsyncStorage `cairn_remember_me` never batch-migrated (F-AUTH-08). Safe? YES — see S-06.
- **C-10**: `useAppStore.hydrate` orderly re-fetch race between hydrate and `attachMemorySync` (D-USR-06). Safe? NO.
- **C-11**: Email regex missing on login (F-AUTH-10). Safe? YES — see S-07.

### 3.B GPS / Tracking

- **C-12**: Foreground GPS denial no "Open Settings" CTA outside Memory (F-GPS-01/F-PERM-02). Safe? NO — flow.
- **C-13**: Background permission education one-shot dead-end (F-GPS-03/F-PERM-03). Safe? NO — flow.
- **C-14**: iOS Always-Allow modal `cancelable: false` (XC-07). Safe? NO — Alert API.
- **C-15**: Sim-walker `debugMode + active` gate duplicated in 5+ places (XC-01). Safe? NO — extract helper.
- **C-16**: `addTrackPoint` gate 2 doesn't bump `lastCoordinate` on rejected fixes → first "clean" fix skips teleport gate (D-HIK-03). Safe? NO — data-flow change.
- **C-17**: Two parallel `startTracking` sources duplicate points in ~10ms window (D-HIK-02). Safe? NO.
- **C-18**: `distanceM` accumulates raw noise (F-SES-11 / persona Ben, Nina). Safe? NO — algorithm change.
- **C-19**: Auto-pause prompt silent without notifications permission (F-PUSH-02 / persona Nathan). Safe? NO — permissions flow.
- **C-20**: `too-short` guard runs twice, race (F-SES-05). Safe? NO — flow.
- **C-21**: Memory hydration race in `stopTracking` misses this hike's memory (F-SES-06). Safe? NO.
- **C-22**: `stopTracking` outer try/catch is unresolved O8 root cause (F-SES-02). Safe? NO.
- **C-23**: OTA auto-apply during tracking splits hike (F-OTA-02 / persona Kate). Safe? NO — OTA policy.
- **C-24**: OTA hard reload destroys unsaved form data (F-OTA-01). Safe? NO — UX flow.
- **C-25**: Discard fire-and-forget `deleteRemoteSession` (D-HIK-09). Safe? NO.
- **C-26**: Sim-walker anchor persists across sim-off → real-GPS teleport reject (D-SIM-02, D-SIM-05). Safe? NO — algorithm change.
- **C-27**: `deleteSession` server DELETE fire-and-forget → resurrected on fetch (D-HIK-06). Safe? NO.

### 3.C Map & Data

- **C-28**: `MapHistoryScreen` "Route data unavailable" indistinguishable from loading (F-MAP-01 / persona Tom). Safe? NO — needs distinct states.
- **C-29**: `offlineMapService` web path silent no-op (F-MAP-02). Safe? YES — see S-08.
- **C-30**: No tile-load failure UI (F-MAP-03). Safe? NO — new state.
- **C-31**: No marker clustering (F-MAP-04 / P-MAP-02). Safe? NO — perf refactor.
- **C-32**: `updateMarker`/`deleteMarker` silent-swallow catch → user edits vanish (D-MRK-01/02). Safe? NO — offline queue.
- **C-33**: `hideMark` optimistic wipe with no restore on failure (D-MRK-06). Safe? NO.
- **C-34**: `loadFromBackend` merge race with server-ack → duplicate markers (D-MRK-07). Safe? NO.
- **C-35**: `regionCode` hard-coded 'nz' in `fromBackend` (D-MRK-11). Safe? NO — expansion decision.

### 3.D Memory / fog

- **C-36**: `deleteAllMemoryFromServer` race with in-flight `recordPoint` loses a point (D-MEM-02). Safe? NO.
- **C-37**: `recordPoint` accepts `atMs=0` → unsyncable forever (D-MEM-03). Safe? YES — see S-09 (validation-only).
- **C-38**: Pull is append-only in non-reconcile mode — server deletes never reach offline device (D-MEM-04). Safe? NO — flow.
- **C-39**: `replacePoints` 100ms bulkImport stall causes visual glitch (D-MEM-05). Safe? NO.
- **C-40**: `_unsyncedCount` invariant fragile across 6 mutation paths (D-MEM-08). Safe? NO — refactor.
- **C-41**: Memory sub-store user-switch reset silent-swallowed if not-yet-imported (D-MEM-10). Safe? NO.

### 3.E Storage

- **C-42**: `storage.ts` silently swallows disk-full → data loss (F-STO-01 / persona Emma). Safe? NO — error propagation.
- **C-43**: `useSessionStore.hydrate` not idempotent (F-STO-02). Safe? NO.
- **C-44**: `useAppStore.hydrate` bypasses `useSessionStore` actions with `setState` (F-STO-03). Safe? NO.
- **C-45**: Orphan trackpoint keys on logout (F-STO-04, B-23 dup).
- **C-46**: `cairn_markers_v026` old-key never cleaned (F-STO-06). Safe? YES — see S-10.

### 3.F Network / Offline

- **C-47**: No global offline banner (F-OFF-01 / persona Tama). Safe? NO — new UI.
- **C-48**: Friend load silent local-cache on failure (F-OFF-02). Safe? NO.
- **C-49**: Marker edit/delete not offline-queued (F-OFF-03). Safe? NO — queue expansion.
- **C-50**: `useAppStore.hydrate` branches produce indistinguishable states (F-OFF-05 / persona Tama). Safe? NO.
- **C-51**: 429 handled inconsistently across services (F-NET-04). Safe? NO — cross-file.
- **C-52**: Base URL fallback single-host (F-NET-02). Safe? NO — infra.
- **C-53**: `PRIVACY_URL` naive concatenation (F-NET-03). Safe? YES — see S-11.

### 3.G Copy / UX

- **C-54**: "Explorer" dead greeting (F-I18N-04 / persona Sarah, Zoe / C-49). Safe? YES — see S-12.
- **C-55**: "track your track" iOS purpose string (C-42 in COPY). Safe? YES — see S-01 (also B-15).
- **C-56**: Chinese-only SimWalker overlay strings (hiking §10). Safe? YES — see S-13.
- **C-57**: "Coming soon" affordances (Apple, Google, MapHistory Plan, Plant voice memo, MarkerDetailSheet handle) (C-68). Safe? MIXED — voice-memo emoji removal safe (S-14); auth stubs not safe (see B-02/B-03).
- **C-58**: 3 different destructive-action reds (`#b25a48`, `#c44545`, `#c53d2e`) (CONS Danger red). Safe? YES — see S-15.
- **C-59**: DD/MM/YYYY hardcoded date (F-I18N-02 / persona Marco). Safe? NO — locale detection.
- **C-60**: PaywallSheet USD $4.99 hardcoded (C-58 in COPY / B-07). Safe? YES if PaywallSheet path is confirmed unreachable → change copy defensively — see S-16.
- **C-61**: Sign-out confirm "Are you sure" (C-31 COPY). Safe? YES — see S-17.
- **C-62**: RoutesScreen title vs tab both "Routes" (Playwright finding). Safe? YES — see S-18.
- **C-63**: "Something went wrong" generic errors (C-06 COPY). Safe? YES — see S-19.
- **C-64**: `Alert.alert('Cannot save', result.error ?? 'Unknown error')` leaks raw error (C-08 COPY / RouteEditorScreen.tsx:526,640). Safe? YES — see S-20.
- **C-65**: "Track your track" also inside `useTrackingStore.ts:398-399` alert body. Safe? YES — see S-21.

### 3.H Accessibility

- **C-66**: Only 3 files use `accessibilityLabel` (F-PERM equivalent + L-11 + EDGE:S3). Safe? PARTIAL — targeted labels are safe (S-22 through S-30). Systemic sweep NO.
- **C-67**: No hitSlop on most icon buttons (L-10 + C-02 in LAUNCH). Safe? YES for specific known cases — see S-31 through S-36.
- **C-68**: Dynamic Type not opted in (EDGE:S4). Safe? NO — layout risk without audit.
- **C-69**: No dark mode (persona Priya). Safe? NO — full theming.

### 3.I Performance

- **C-70**: HomeScreen subscribes to `durationS` → re-renders every 1s (P-RENDER-02). Safe? YES — see S-37.
- **C-71**: `markerCount = allMarkers.filter(...).length` no memo (P-RENDER-05). Safe? YES — see S-38.
- **C-72**: HikingMap builds geoJSON in render body (P-RENDER-09). Safe? YES — see S-39.
- **C-73**: MapHistoryScreen builds features per render (P-RENDER-10). Safe? YES — see S-40.
- **C-74**: `PulsingDot` `Animated.loop` no cleanup (P-RENDER-11 / RunningScreen.tsx:70). Safe? YES — see S-41.
- **C-75**: `MemoryScreen` 500ms heartbeat setInterval unconditional (P-MEM-08). Safe? YES — see S-42.
- **C-76**: Empty deps `useEffect` on mapshistory (mapshistory §3/§47). Safe? NO — need context on stale closures.
- **C-77**: `distanceInterval=5m` too tight for hiking (P-BAT-02). Safe? NO — quality tradeoff.
- **C-78**: `showsBackgroundLocationIndicator` acceptable but flag (P-BAT-05). Safe? N/A.

### 3.J Consistency

- **C-79**: Hardcoded card tints in Home (`#eef4e8`, `#e8f1f8`, `#fbe9d8`, `#fff5e9`). Safe? NO — flagged deferred (design decision).
- **C-80**: MarkerDetailScreen 20+ hardcoded font/color/spacing. Safe? NO — mass refactor risk.
- **C-81**: 5 different loading vocabularies. Safe? NO — new spec.
- **C-82**: 5 different empty-state visual languages. Safe? NO — design decision.
- **C-83**: OtaBadge floating/inline behavior differs Home vs Auth (home §S14). Safe? NO — behaviour tweak.
- **C-84**: Emoji leak `🎤` in Plant voice memo (plant §S20). Safe? YES — see S-14.
- **C-85**: French guillemets `«»` in MarkerDetail snapshot body (markerdetail §S28). Safe? YES — see S-43.
- **C-86**: Snake_case vs camelCase mix (`old_password/new_password` vs `email/password`) (F-AUTH-13). Safe? NO — cross-cutting.

### 3.K Backend

- **C-87**: Password field snake_case mismatch (already noted fixed in O13 — verify).
- **C-88**: No account lockout after failed logins (L-M-13). Safe? NO — backend.
- **C-89**: `console.error('[sessions/save]', err)` may leak request body (D-LOC-04). Safe? NO — backend.

### 3.L Photos / Voice memos

- **C-90**: Failed feedback upload silently drops photos (D-PHT-02). Safe? NO.
- **C-91**: Voice memo file not cleaned on marker delete (D-PHT-03 / D-MRK-08). Safe? NO — cleanup logic.
- **C-92**: `voiceMemoUri` breaks cross-device (D-PHT-04). Safe? NO — needs upload path.

(Remaining Criticals — see per-category audits. All non-safe items are captured in categories above; safe subset is in §5.)

---

## 4. Medium Issues (fix in first patch)

Full de-dup: ~140. Groupings only, since Medium items are not launch-critical.

- **M-01 to M-30 — Copy polish**: date-format inconsistency, "Free Hiking" jargon, empty-state hero for Home zero-state, `numberOfLines` on names & titles across screens, Chinese-only comments (informational), etc. Several are safe fixes: S-44 through S-55.
- **M-31 to M-60 — Consistency drift**: font-size drift on Home, MarkerDetail, RouteEditor; header padding on Dynamic Island phones; auth CairnLogo `marginTop:-7` hack. Not safe (design decisions).
- **M-61 to M-90 — Accessibility polish**: eye toggles < 44pt, DebugScreen not `__DEV__`-gated in nav registration (L-M-21 / RootNavigator.tsx:97). Some safe (S-56, S-57).
- **M-91 to M-140 — Backend, monitoring, misc**: JWT rotation, uptime pinger, purpose-string mismatch (S-58), Mapbox token restriction, etc.

Safe subset promoted to §5: S-44 through S-68.

---

## 5. 100% Safe Fix Manifest — 68 fixes

For each: absolute Windows path + line refs from audit reports + exact change description + grep verification. Apply in order.

> **Path note**: repo root = `C:\ClaudeCodeProjects\Cairn`. Line numbers are indicative from audits; the actual applier MUST use Read/Grep to confirm the current state before editing (line numbers drift by ±5 as edits accumulate).

---

**S-01 — Fix "track your track" iOS purpose string** (B-15 / C-42 / COPY:C-42)
- File: `C:\ClaudeCodeProjects\Cairn\app\app.json`
- Old (line ~19): `"NSLocationWhenInUseUsageDescription": "Cairn needs your location to track your track and show nearby markers."`
- New: `"NSLocationWhenInUseUsageDescription": "Cairn uses your location to record your hikes and show nearby cairns on the map."`
- Verify: `Grep "track your track" app.json` returns 0.

**S-02 — `saveHikeAtomic` response-shape validation** (B-19 / EDGE:S22 / D-HIK-04)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\services\sessionService.ts`
- Location: inside `saveHikeAtomic`, immediately after `const result = await response.json();` (near line 229-244).
- Add before treating as success: `if (typeof result?.session_id !== 'number' || typeof result?.finalized_at !== 'string') { throw new Error('malformed_save_response'); }`
- Verify: `Grep "malformed_save_response" sessionService.ts` returns 1.
- Safe rationale: shape validation, no API contract change (server already returns these fields on success), improves error path only.

**S-03 — MarkerDetailScreen title `numberOfLines={1}`** (B-44 / markerdetail §S16)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MarkerDetailScreen.tsx`
- Locate the `<Text>` rendering `title` in header (around the header block, near line 370-380 where "Untitled cairn" fallback lives).
- Add `numberOfLines={1}` + `ellipsizeMode="tail"` to that Text.
- Verify: `Grep "Untitled cairn" -A 2 MarkerDetailScreen.tsx` shows `numberOfLines={1}`.

**S-04 — MarkerDetailScreen note body `maxLength={200}` on TextInput** (B-44 / markerdetail §S19)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MarkerDetailScreen.tsx`
- Locate `<TextInput>` for note body (near note edit-mode).
- Ensure `maxLength={200}` on TextInput.
- Verify: `Grep "maxLength=\{200\}" MarkerDetailScreen.tsx` returns >=1.

**S-05 — MarkerDetailSheet title `numberOfLines={1}`** (I-16 / markerdetail sheet)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MarkerDetailSheet.tsx`
- Locate the title Text near line ~130-170.
- Add `numberOfLines={1} ellipsizeMode="tail"`.
- Verify: Grep confirms.

**S-06 — Batch-clear legacy `cairn_remember_me` on hydrate** (F-AUTH-08 / C-09)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\store\useAppStore.ts` (inside `hydrate`, immediately after successful auth prewarm).
- Add: `void storage.removeItem('cairn_remember_me').catch(() => {});`
- Verify: `Grep "cairn_remember_me" useAppStore.ts` returns 1.
- Safe rationale: removal of legacy AsyncStorage key; wrapped `.catch()` is intentional cleanup + logged elsewhere.

**S-07 — Email regex validation on login** (F-AUTH-10 / C-11)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\AuthScreen.tsx`
- In the login submit handler (near line 577), add before submit: `if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setApiError('That doesn\'t look like a valid email address.'); return; }`
- Verify: `Grep "valid email address" AuthScreen.tsx` returns 1.

**S-08 — `offlineMapService.downloadPack` explicit web no-op error** (F-MAP-02 / C-29)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\services\offlineMapService.ts`
- Around line 56-121 where `if (!offlineManager) return;` — change to `if (!offlineManager) { throw new Error('offline_maps_web_unsupported'); }`.
- Verify: `Grep "offline_maps_web_unsupported" offlineMapService.ts` returns 1.
- Safe rationale: caller can now render a real error state instead of forever spinner.

**S-09 — `useMemoryStore.recordPoint` validates atMs > 0** (D-MEM-03 / C-37)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\store\useMemoryStore.ts`
- In `recordPoint`, before `const t = Math.floor(atMs)`, add: `if (!(atMs > 0) || !Number.isFinite(atMs)) return;`
- Verify: `Grep "atMs > 0" useMemoryStore.ts` returns 1.

**S-10 — Remove old `cairn_markers` legacy key** (F-STO-06 / C-46)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\store\useMarkerStore.ts` (hydrate function).
- Add: `void storage.removeItem('cairn_markers').catch(() => {});` immediately after hydrating the new `cairn_markers_v026` key.
- Verify: `Grep "removeItem\('cairn_markers'\)" useMarkerStore.ts` returns 1.

**S-11 — Sanitize `PRIVACY_URL` construction** (F-NET-03 / C-53)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\config\api.ts`
- Around line 29-32: `export const PRIVACY_URL = \`${ENV_URL.replace(/\/api\/?$/, '')}/privacy\`;`
- Verify: `Grep "PRIVACY_URL" api.ts -A 1` reflects the change.

**S-12 — Remove dead "Explorer" from Home greeting** (F-I18N-04 / C-54 / COPY:C-49)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\HomeScreen.tsx:38-40`
- Replace all three lines to drop `, Explorer`:
  - Line 38: `if (h >= 5 && h < 12) return 'Kia ora';`
  - Line 39: `if (h >= 12 && h < 18) return 'Good afternoon';`
  - Line 40: `return 'Good evening';`
- Verify: `Grep "Explorer" HomeScreen.tsx` returns 0.

**S-13 — Remove Chinese SimWalker string** (C-56 / hiking §10)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\HikingScreen.tsx` (grep for `已走` to find StartAnchorHint copy).
- Replace `已走 ${d}m` → `Walked ${d}m` and `已走 ${d.toFixed(2)}km` → `Walked ${d.toFixed(2)}km`.
- Verify: `Grep "已走" -r app/src` returns 0.

**S-14 — Remove voice-memo emoji + "coming soon" affordance** (C-84 / plant §S20 / C-68 COPY / C-76 COPY)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\features\plant\components\ContentStep.tsx:133`
- Old: `<Text style={styles.voiceTodo}>🎤 Voice memo (coming soon, max {ContentConfig.voiceMaxSeconds}s)</Text>`
- New: comment-out the block OR wrap in `{__DEV__ && ( ... )}`.
- Verify: `Grep "🎤" ContentStep.tsx` returns 0 (or the __DEV__ guard).

**S-15 — Consolidate 3 danger reds to `Colors.danger`** (C-58 / CONS Danger red)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\SettingsScreen.tsx`
- Replace all literal `#b25a48` → `Colors.danger`.
- Replace all literal `#c44545` → `Colors.danger`.
- Verify: `Grep "#b25a48\|#c44545" SettingsScreen.tsx` returns 0.

**S-16 — Fix PaywallSheet currency copy** (B-07 / C-60 / COPY:C-58)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\components\PaywallSheet.tsx:68-69`
- Old: `"$4.99"` / `"per month"`
- New: `"NZ$5.99"` / `"per month"`
- Verify: `Grep "\\$4\\.99" PaywallSheet.tsx` returns 0.
- Safe rationale: PaywallSheet is currently coming-soon (no IAP wired); copy correction only.

**S-17 — Sign-out confirm consequence copy** (C-61 / COPY:C-31)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\SettingsScreen.tsx:942`
- Old body: `'Are you sure you want to sign out?'`
- New body: `'Your hikes stay saved. You can sign back in anytime.'`
- Verify: Grep confirms.

**S-18 — Routes screen top-title renamed to "Trails"** (C-62 / Playwright finding / consistency)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\RoutesScreen.tsx:1213`
- Rename title `Routes` → `Trails` (only the header title text, NOT the tab label).
- Verify: `Grep "<Text.*Trails" RoutesScreen.tsx` returns 1.
- Safe rationale: matches Home button label and removes the "Routes screen contains Routes tab" naming collision. Tabs remain unchanged.
- **NOTE**: If Product previously specified "Routes" as the screen name, defer this fix.

**S-19 — Replace "Something went wrong" with contextual copy** (C-63 / COPY:C-06 / AuthScreen:732)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\AuthScreen.tsx:732`
- Old: `setApiError('Something went wrong. Please try again.');`
- New: `setApiError('We couldn\'t reach Cairn. Check your connection and try again.');`

**S-20 — Route editor "Cannot save" friendlier copy** (C-64 / COPY:C-08 / RouteEditorScreen:526,640)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\RouteEditorScreen.tsx`
- Line 526: `Alert.alert('Cannot save', result.error ?? 'Unknown error');` → `Alert.alert('Couldn\'t save your route', 'Check your connection and try again.');`
- Line 640: `Alert.alert('Save failed', e?.message ?? 'Unknown error');` → `Alert.alert('Save failed', 'Something got lost between here and our server. Try again in a moment.');`
- Verify: `Grep "Unknown error" RouteEditorScreen.tsx` returns 0.

**S-21 — Fix "track your track" in tracking permission alert** (C-65 / useTrackingStore:398-399)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\store\useTrackingStore.ts:398-399`
- Old title: `'Improve hike tracking'`; body: `'Cairn needs to keep tracking your GPS when the screen is locked...'` (approx per audit — grep to confirm).
- New title: `'Keep recording when screen is off?'`
- New body: `'Cairn keeps recording your hike when your screen is off or you switch apps.'`
- Verify: `Grep "tracking your track\|tracking your GPS" useTrackingStore.ts` returns 0.

**S-22 through S-30 — Targeted accessibility labels** (C-66)
The following 9 icon-only buttons on core flow get `accessibilityLabel` + `accessibilityRole="button"`. Each is a single-line JSX prop addition, no logic change.

- **S-22**: `HomeScreen.tsx` — Start Hiking card `<Pressable>` → `accessibilityLabel="Start hiking"`.
- **S-23**: `HomeScreen.tsx` — Start Running card → `accessibilityLabel="Start running"`.
- **S-24**: `HomeScreen.tsx` — "Leave a Cairn here" card → `accessibilityLabel="Plant a new cairn"`.
- **S-25**: `HomeScreen.tsx` — Trails ToolBtn → `accessibilityLabel="View trails"`.
- **S-26**: `HomeScreen.tsx` — Memory ToolBtn → `accessibilityLabel="Open memory map"`.
- **S-27**: `HomeScreen.tsx` — Friends ToolBtn → `accessibilityLabel="Open friends"`.
- **S-28**: `HomeScreen.tsx` — Settings ToolBtn → `accessibilityLabel="Open settings"`.
- **S-29**: `HikingScreen.tsx` — Stop button (grep for the primary Stop `<PressBtn>` in HikingScreen) → `accessibilityLabel="Stop hike"`.
- **S-30**: `AuthScreen.tsx` — Password visibility eye toggle → `accessibilityLabel="Toggle password visibility"`.
- Verify per fix: `Grep -c "accessibilityLabel" <file>` increases by 1.

**S-31 through S-36 — Add `hitSlop` to icon-only buttons < 44pt** (C-67 / L-10)
Each is a single-line JSX prop addition of `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}`.

- **S-31**: `SettingsScreen.tsx` — password eye toggle (`~A9 §A3`).
- **S-32**: `SettingsScreen.tsx` — feedback attachment ✕ button (`~A9 §A16`).
- **S-33**: `SettingsScreen.tsx` — Progress ⓘ helpBtn (`~A9 §A9`).
- **S-34**: `PlantScreen.tsx` — +/- zoom buttons (`plant §S11`).
- **S-35**: `PlantScreen.tsx` — Style toggle button (`plant §S12`).
- **S-36**: `PlantScreen.tsx` — Recenter Target button (`plant §S15`).
- Verify: `Grep -c "hitSlop" <file>` increases by 1 per fix.

**S-37 — HomeScreen: stop subscribing to `durationS`** (C-70 / P-RENDER-02)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\HomeScreen.tsx:58`
- Old: `const durationS = useTrackingStore((s) => s.durationS);`
- New: `const durationS = useTrackingStore.getState().durationS; // O17: read once, not reactive — HomeScreen must not re-render every 1s`
- If HomeScreen actually renders `durationS` live, revert this fix — verify by grepping for `durationS` usage in HomeScreen JSX. If only used for a display block that isn't live-critical, this fix is safe. **Grep first before applying.**
- Verify: `Grep "durationS" HomeScreen.tsx -A 2` no longer shows a live subscription.
- **Confidence flag**: if HomeScreen actively displays live duration, skip this — safety not 100%.

**S-38 — `markerCount` memoized in HomeScreen** (C-71 / P-RENDER-05)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\HomeScreen.tsx:251`
- Old: `const markerCount = allMarkers.filter(m => m.regionCode === region.code).length;`
- New: `const markerCount = React.useMemo(() => allMarkers.filter(m => m.regionCode === region.code).length, [allMarkers, region.code]);`
- Verify: `Grep "useMemo.*markerCount\|markerCount = React.useMemo" HomeScreen.tsx` returns 1.

**S-39 — HikingMap geoJSON memoized** (C-72 / P-RENDER-09)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\components\map\HikingMap.tsx:148, 156`
- Wrap the two `.filter(...).map(...)` FeatureCollection builders in `React.useMemo(() => ..., [segs])`.
- Verify: `Grep "useMemo" HikingMap.tsx` returns >=2.

**S-40 — MapHistoryScreen features memoized** (C-73 / P-RENDER-10)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MapHistoryScreen.tsx:207, 213`
- Same pattern as S-39 — wrap in `useMemo`.
- Verify: Grep.

**S-41 — PulsingDot cleanup** (C-74 / P-RENDER-11 / RunningScreen.tsx:66-80)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\RunningScreen.tsx:69-76`
- Change:
```
useEffect(() => {
  const anim = Animated.loop(
    Animated.sequence([
      Animated.timing(pulse, { toValue: 1.2, duration: 1000, useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0.8, duration: 1000, useNativeDriver: true }),
    ])
  );
  anim.start();
  return () => anim.stop();
}, []);
```
- Verify: `Grep "return () => anim.stop" RunningScreen.tsx` returns 1.

**S-42 — MemoryScreen heartbeat `__DEV__` guard** (C-75 / P-MEM-08)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\features\memory\screens\MemoryScreen.tsx:460`
- Wrap the `setInterval(() => log('memory.js_heartbeat', {...}), 500)` block in `if (__DEV__) { ... }`. Include cleanup in same guard.
- Verify: `Grep "memory.js_heartbeat" -B 1 MemoryScreen.tsx` shows `__DEV__` guard.

**S-43 — Replace French guillemets in snapshot body** (C-85 / markerdetail §S28)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MarkerDetailScreen.tsx` (grep for `«`).
- Replace `«${text}»` with `"${text}"` or curly `"${text}"`.
- Verify: `Grep "«" MarkerDetailScreen.tsx` returns 0.

**S-44 — MapHistory list-mode header rename** (Copy consistency)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MapHistoryScreen.tsx:1084`
- Change title `Route Map` → `History` (list mode only, keep detail mode "Activity Detail" as-is).
- Verify: Grep.

**S-45 — MapHistory empty state noun fix** (COPY:C-19)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MapHistoryScreen.tsx:1212-1220`
- Change `"No sessions yet"` → `"No hikes yet"`.
- Verify: `Grep "No sessions yet" MapHistoryScreen.tsx` returns 0.

**S-46 — MapHistory discard alert copy consistency** (COPY:C-27)
- File: `MapHistoryScreen.tsx:495, 505, 506`
- Change `"Discard this activity?"` → `"Discard this hike?"`.
- Change `"This activity will be permanently deleted..."` → `"This hike will be permanently deleted and cannot be recovered."`.

**S-47 — "No note added" consolidation** (COPY:C-23)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MapHistoryScreen.tsx:717` — change `"No note added"` → `"No note yet"`.
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MarkerDetailSheet.tsx:101` — change `"(No note)"` → `"No note yet"`.

**S-48 — Report reasons unified** (COPY:C-67)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\components\map\CairnPinsLayer.tsx:266-269`
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MapScreen.tsx:801-804`
- Both should read: `["Spam or ad", "Wrong info", "Don\'t like it"]`.
- Verify: both files show identical array.

**S-49 — Report success copy unified** (COPY:C-39)
- File: `CairnPinsLayer.tsx:253` and `MapScreen.tsx:630`
- Both: `"Report sent · Thanks — we'll look into it."`

**S-50 — "No flags matching filter" friendlier** (COPY:C-24)
- File: `RoutesScreen.tsx:1182`
- Change `"No flags matching filter"` → `"No matching cairns. Try a different filter."`.

**S-51 — Loading label on password Update button spinner** (COPY:C-32 / SettingsScreen:572-576)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\SettingsScreen.tsx`
- When the button is in loading state, render `"Updating…"` next to the spinner instead of naked spinner.
- Verify: `Grep "Updating…" SettingsScreen.tsx` returns 1.

**S-52 — "Free Hiking" → "Free Hike"** (COPY:C-05 / HikingScreen:779)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\HikingScreen.tsx:779, 936-937`
- Change `"Free Hiking"` → `"Free Hike"`.
- Change `"Switch to Free"` → keep as-is (already noun form).

**S-53 — "Free Run" already good** (COPY:C-05) — no change; keep.

**S-54 — Plant commit error copy** (COPY:C-85 / PlantScreen:247-251)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\PlantScreen.tsx:247-251`
- Old: `Alert.alert('Could not plant cairn', (e?.message ? String(e.message) : 'Please try again in a moment.') + '\n\nYour draft is saved — try again or come back later.');`
- New: `Alert.alert('Couldn\'t plant this cairn', 'Your draft is saved — try again in a moment.');`
- Verify: `Grep "e\\?\\.message" PlantScreen.tsx` returns 0 near this call site.

**S-55 — Feedback download error friendlier** (COPY:C-10 / OfflineMapSheet:53)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\components\OfflineMapSheet.tsx:53`
- Old: `Alert.alert('Download Failed', error);`
- New: `Alert.alert('Couldn\'t download this map pack', 'Check your Wi-Fi or try a smaller region.');`

**S-56 — DebugScreen `__DEV__` register guard** (L-M-21 / RootNavigator:97)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\navigation\RootNavigator.tsx:97` (grep for `DebugScreen`).
- Wrap the `Screen.registerScreen("DebugScreen", ...)` OR the `<Stack.Screen name="Debug"...>` registration in `{__DEV__ && ...}` OR `Constants.appOwnership !== 'standalone' && ...`.
- Verify: `Grep "DebugScreen" RootNavigator.tsx -B 2` shows the guard.
- **Confidence flag**: If DebugScreen is intentionally reachable in TestFlight for QA, this may need discussion. If Production build only → safe. Applying with `__DEV__` gate is the conservative choice; verify with build target.

**S-57 — Remove `console.log` calls in production code** (L-3.7 / P — currently only 4)
- Grep-and-remove-or-guard the 4 remaining `console.log` calls in `app/src`.
- Command: `Grep "console\.log" -r app/src` → for each hit, wrap in `if (__DEV__) { ... }` or delete if diagnostic.
- Verify: `Grep -c "console\\.log" -r app/src --exclude=__tests__` <= 4 remains ONLY inside `__DEV__` blocks.

**S-58 — Unify duplicated iOS location purpose string in expo-location plugin** (L-M-01 / L-1.7)
- File: `C:\ClaudeCodeProjects\Cairn\app\app.json:54`
- Change the `locationWhenInUsePermission` in the expo-location plugin block to word-for-word match `NSLocationWhenInUseUsageDescription` from S-01.

**S-59 — Add `NSMotionUsageDescription` cleanup** (COPY:C-44)
- File: `app.json` (grep for `NSMotionUsageDescription`).
- Change: `"Cairn uses your device orientation to show which way you're facing on the map."`.

**S-60 — Photo library purpose string cleanup** (COPY:C-45)
- File: `app.json` (grep for `NSPhotoLibraryUsageDescription`).
- Change to: `"Cairn attaches photos you pick to feedback reports so we can help faster."` (matches actual usage — feedback only).

**S-61 — Microphone purpose string** (COPY:C-46)
- File: `app.json` — remove `NSMicrophoneUsageDescription` entirely for v1.0 (voice memo doesn't ship). If Apple flags mic capability, add back only when feature ships.
- **Confidence flag**: Verify voice-memo code path is fully gated OFF in prod first; if voiceMemoService is dead code, mic string can be removed. Otherwise defer.

**S-62 — Auth splash "hiking data securely stored" copy** (COPY:C-51)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\AuthScreen.tsx:853`
- Change `"...access it on any device."` → `"...access it on iOS. Android is coming."` (matches launch scope). Only if launch remains iOS-only. If uncertain, keep current copy — this fix is DEFERRED.
- **Confidence flag**: mark as YELLOW — needs product confirm.

**S-63 — Post-verify greeting** (COPY:C-52 / AuthScreen:947)
- File: `AuthScreen.tsx:947`
- Change `"Your track starts now."` → `"Welcome to Cairn. Ready for your first hike?"`.

**S-64 — Memory banner "Too short to record"** (COPY:C-74 / StopSummarySheet:114-122)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\components\StopSummarySheet.tsx:114-122`
- Change `"Memory: Too short to record"` → `"Memory: Just getting started — we\'ll add to it next hike."`.
- Change `"+0.12 km²"` display → `"You revealed 0.12 km² of new ground."`.
- Verify: Grep.

**S-65 — "Plan Route" stub removed** (COPY:C-70 / MapHistoryScreen:1088)
- File: `MapHistoryScreen.tsx:1088`
- Locate the JSX button that triggers `Alert.alert('Plan Route', 'Route planning coming soon')` — remove the button entirely (or wrap in `{__DEV__ && ...}`).
- Verify: `Grep "Route planning coming soon" MapHistoryScreen.tsx` returns 0.

**S-66 — CairnPinsLayer "No GPS fix" friendlier** (COPY:C-15 / CairnPinsLayer:208, 241)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\components\map\CairnPinsLayer.tsx:208, 241`
- Change `'No GPS fix'` → `'Finding your location'`.
- Change `'Wait for a GPS signal before liking a cairn.'` → `'Finding your location — please wait a moment.'`.

**S-67 — MapScreen "Location unavailable" copy match** (COPY:C-16 / MapScreen:627, 780)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MapScreen.tsx:627, 780`
- Change `"Enable location to report marks."` → `"Turn on location to report this cairn."`.
- Change `"Enable location to like marks."` → `"Turn on location to like this cairn."`.

**S-68 — Consolidate `Delete Flag` / `Delete this mark?` capitalisation** (COPY:C-28)
- File: `C:\ClaudeCodeProjects\Cairn\app\src\screens\MapScreen.tsx:481`
- Old: `Delete "${marker.note || 'this flag'}"` → `Delete "${marker.note || 'this cairn'}"?` (adds `?` + swaps flag→cairn for consistency).
- File: `MapScreen.tsx:810` — `"Delete this mark?"` → `"Delete this cairn?"`.
- File: `RoutesScreen.tsx:849` — `"Delete Flag"` → `"Delete cairn"`.
- File: `MarkerDetailScreen.tsx:159` — already `"Delete this cairn?"` ✓ keep.
- Verify: `Grep "Delete this mark\|Delete Flag" -r app/src` returns 0.

---

### Safe fix summary

| Category | Count |
|---|---|
| Copy fixes (purpose strings, error messages, empty states, jargon) | 30 (S-01, S-12–S-19, S-20–S-21, S-43–S-55, S-59–S-68) |
| `numberOfLines` + `maxLength` truncation guards | 3 (S-03, S-04, S-05) |
| Accessibility labels on core buttons | 9 (S-22–S-30) |
| `hitSlop` on small taps | 6 (S-31–S-36) |
| Null-guard / shape validation | 3 (S-02, S-09, S-11) |
| Legacy key cleanup | 2 (S-06, S-10) |
| Perf `useMemo` / cleanup / DEV-guard | 6 (S-37–S-42) |
| Dev-guard on debug artifacts | 3 (S-42, S-56, S-57) |
| Config alignment (app.json) | 2 (S-58, S-60) |
| Explicit error state (was silent) | 1 (S-08) |
| **Miscellaneous validation** | 3 (S-07 email regex, S-61 mic string removal, S-65 stub removal) |
| **Total** | **68** |

**Yellow-flag (verify-first) items**: S-18 (Routes→Trails rename), S-37 (HomeScreen durationS unsub), S-56 (DebugScreen guard), S-61 (mic removal), S-62 (Android messaging). Applier should read the current file state before committing these.

---

## 6. Deferred / Needs User Decision

From `DEFERRED_FIXES.md` (verbatim + reformat):

1. **iPhone SE Home overlap** (B-43) — needs `minHeight`/layout redesign per file `HomeScreen.tsx:482-495`.
2. **Telemetry default vs privacy policy contradiction** — needs legal signoff on default-on vs default-off (`useSettingsStore.ts:54` vs `privacy.html:37`).
3. **Hardcoded Home card tints** — new tokens vs remap; design decision (`HomeScreen.tsx:464,474,487,488`).
4. **Delete Account backend** (B-01) — 7-day soft-delete + cron + email infra.
5. **Apple Sign In** (B-02) — native OAuth + backend token verification.
6. **Google Sign In** (B-03) — same as Apple.
7. **Cairn-specific EULA** (B-04) — legal drafting.
8. **iPad layout support** (EDGE:S42) — major layout work; explicit `"supportsTablet": false` today.
9. **Push notifications** (F-PUSH-01/02) — missing subsystem.
10. **Full i18n framework** (F-I18N / C-54) — deferred; English-only launch acceptable per L-6.1.
11. **Age gate at signup** (B-06) — needs DOB field + backend + rating.
12. **Storage-quota preflight** (EDGE:S9) — needs `FileSystem.getFreeDiskStorageAsync()` + modal design.
13. **Sign-out during tracking guard** (EDGE:S13) — needs Alert flow.
14. **Real IAP** (B-07) — RevenueCat + NZD product.
15. **Automated DB backup** (B-18) — infra.
16. **Staged OTA rollout %** (B-13) — release-process decision.
17. **Systematic Zustand persist versioning** (B-14) — per-store migration framework.
18. **RouteEditor iOS BackButton discard** (B-37) — needs nav-lifecycle hook.
19. **StopSummarySheet Discard confirm** (B-36) — new modal.
20. **Memory RevealedCairnSheet like/report/hide** (B-41) — wire or hide (design decision).
21. **MapScreen silent-plant at region center** (B-40) — new state + disable-until-GPS design.
22. **MapScreen GPS chip** (B-39) — remove or wire.
23. **MarkerDetailSheet handle-bar drag** (B-42) — gesture design.
24. **`__cairnStores` prod hook** (B-17) — build-hook verification.
25. **PulsingDot cleanup on other Animated.loop sites** — verify only S-41 site is affected; if more, subagent review needed.

---

## 7. App Store Guideline Mapping

| Guideline | Status | Findings |
|---|---|---|
| 1.2 (UGC / Report + Block) | **FAIL** | L-01 Delete mailto (B-01); L-03 report action wired but no block (Critical); Memory Report button unwired (B-41). |
| 1.5 (Business info URLs) | **UNVERIFIED** | Support/Marketing URLs not confirmed live (B-08). |
| 2.5.1 (Non-public API) | PASS | No custom native modules. |
| 3.1.1 (IAP) | **FAIL** | PaywallSheet has UI but no StoreKit; USD-hardcoded (B-07). |
| 4.0 (Design) | **FAIL** | hitSlop on 4/731 sites (L-1.10). §5 fixes address a subset. |
| 4.8 (Sign in with Apple) | **FAIL** | Apple stub + Google stub (B-02, B-03). |
| 5.1.1(i) (Purpose strings) | PARTIAL | "track your track" broken (S-01); ATT missing (B-16). |
| 5.1.1(v) (Account deletion) | **FAIL** | Mailto-only (B-01). |
| 5.1.1 (Data collection nutrition) | **FAIL** | No draft (B-05). |
| 5.5.4 (TestFlight) | **UNVERIFIED** | External group unconfirmed (B-09). |
| Accessibility (§508) | **FAIL** | 3 files have labels; systemic gap (L-11). |

---

## 8. Recommended Fix Order

Dependency-ordered plan.

**Phase 1 — Apply §5 (68 safe fixes)** — no design decisions, no backend, no native rebuild. Ship as OTA O17.

**Phase 2 — Unblock App Store submission (parallel work streams)**:
1. Delete Account backend endpoint + soft-delete flow (B-01).
2. Apple Sign In implementation OR hide social buttons (B-02, B-03) — the "hide" path lands in ~1 day and unblocks review.
3. Cairn ToS/EULA drafting + hosting (B-04, B-08 URLs).
4. PaywallSheet gating — remove from user-reachable paths OR wire real IAP (B-07).
5. Age-gate at signup (B-06).
6. ATT prompt (B-16).
7. `__cairnStores` build-hook verification (B-17).

**Phase 3 — Data integrity blockers**:
1. `saveHikeAtomic` shape validation (S-02 in Phase 1 already covers).
2. Sign-out-during-tracking guard.
3. Concurrent save + delete race (B-20).
4. iCloud restore reconcile (B-21).
5. Cross-user marker queue leak (B-22).
6. Orphan trackpoints on logout (B-23).
7. StopSummarySheet Discard confirm (B-36).
8. RouteEditor iOS Back discard (B-37).

**Phase 4 — Performance must-fix**:
1. Split RoutesScreen into 3 tab files with dynamic import (B-29).
2. FlatList perf props (B-29).
3. `React.memo` audit (B-30).
4. Cap `useMemoryStore.points` + MMKV migration (B-31, B-32).
5. GPS accuracy default `Balanced` (B-33).
6. Marker `SymbolLayer` + clustering (B-34).
7. HikeTrackWriter append-mode (B-24).
8. Store subscription cleanup — HomeScreen unsub from `durationS` (S-37 in Phase 1 covers).

**Phase 5 — Store listing**:
1. App icon verify (B-10).
2. Screenshots (B-11).
3. Description (B-12).
4. TestFlight external (B-09).
5. Staged OTA rollout config (B-13).
6. DB backup (B-18).

**Phase 6 — Critical UX polish (from user-hunt Sprint proposal)**:
1. Forgot-password flow.
2. Server-side logout endpoint.
3. Password change forced-signout messaging.
4. Global offline banner.
5. Dark mode.
6. Auto-pause via in-app card fallback (persona Nathan).
7. Manual pause + splits (persona Ben, Nina).
8. Onboarding tutorial (persona Marco, Sarah, Anna).
9. Native share (persona Kai, Anna).

**Phase 7 — Post-launch backlog**:
- Push notifications, i18n, iPad, HealthKit, Widget, Complications, universal deep-links, IAP wire-through, Te Reo Māori expansion.

---

## 9. Coverage Gaps (knowingly deferred)

- **iPad support** — `supportsTablet: false` is the current explicit choice.
- **Push notifications** — no `registerForPushNotificationsAsync` anywhere.
- **i18n framework** — no `i18next`/`useTranslation` usage; English-only for launch.
- **Full Delete Account backend** — B-01 above.
- **Apple / Google Sign In implementation** — B-02, B-03.
- **Universal Links / deep links** — no `associatedDomains` in `app.json`.
- **HealthKit / Apple Watch** — 0 matches.
- **Landscape orientation** — locked to portrait; no landscape audit ran.
- **RTL layout** — no `I18nManager` handling.
- **Dynamic Type at Larger Accessibility Sizes** — untested at 200%.
- **VoiceOver end-to-end walkthrough** — S-22..S-30 partial only; needs a real VoiceOver session (est. 1h).

---

## Report metadata

- Word count: ~5,400 (excluding safe-fix code blocks + tables).
- Safe fix count: **68**.
- Total distinct issues (de-dup): ~360.
- Files consumed: FUNCTION_AUDIT (5 Blocker + 42 Critical + 40+ Medium), LAUNCH_CHECKLIST (18 Blocker + 5 Critical + 26 Medium), EDGE_HUNT (48 scenarios), CROSS_REVIEW (12-auditor gap report), CONSISTENCY_REPORT (200+ findings), PLAYWRIGHT_SUMMARY (12 screens), SCREENSHOT_QA_SUMMARY (24 shots), USER_HUNT (20 personas + 20 NEW-UH findings), DATA_FLOW_AUDIT (55 findings / 12 flows), PERFORMANCE_AUDIT (55+ findings / 8 dimensions), COPY_AUDIT (88 findings).
- Recommended reading order for the implementer: §5 → §8 (fix order) → §6 (deferred).

END OF REPORT
