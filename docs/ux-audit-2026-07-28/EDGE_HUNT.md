# Edge Case Hunt — 2026-07-28

Investigated by: Edge Case Hunt Agent (subagent)
Scope: 48 scenarios (15 from A-XREV report + 33 additional). Code-only analysis; no runtime testing.

## Legend
- Handled: Code path exists and appears correct
- Partial: Some handling exists but incomplete or has gaps
- NOT handled: No code path found; would fail on encounter
- N/A: Deferred / out of MVP scope

---

## Section A — A-XREV missed scenarios (1–15)

### Scenario 1: Push notification cold-boot flow
- **Status**: NOT handled
- **Evidence**: `expo-notifications` used only in `autoPauseMonitor.ts` (`scheduleNotificationAsync` for auto-pause prompt) and `App.tsx` never calls `Notifications.getLastNotificationResponseAsync()` or `addNotificationResponseReceivedListener`. Cold-boot from a tapped notification would just open Home; the "You still on the trail?" prompt cannot deep-link back to the active hike screen.
- **Severity**: Medium — feature-gated post-MVP for real push; auto-pause prompt is the only current producer, so cold-boot from tap will land the user on Home not HikingScreen. UX confusion but not data loss.
- **Recommendation**: Add cold-boot handler that reads `getLastNotificationResponseAsync()` before nav mount; route to HikingScreen if `notification.data.type === 'auto-pause-prompt'`.

### Scenario 2: Universal deep-links (yiiling.cn/… → app)
- **Status**: NOT handled
- **Evidence**: `app.json` contains NO `associatedDomains` under `ios`. `Linking.` is used only as an outbound helper (openURL for mailto/settings). No `Linking.addEventListener('url', …)`, no `getInitialURL()`, no `expo-router` prefix handling. `GpsLockStep.tsx:94` mentions "deep link" only as a fallback comment.
- **Severity**: Medium — no feature promises deep-linking yet, but the marketing/social share plan will need it.
- **Recommendation**: Not blocker for MVP. Track in backlog with `associatedDomains` + `intentFilters` for Android.

### Scenario 3: VoiceOver end-to-end
- **Status**: Partial (very thin)
- **Evidence**: Only 15 total `accessibilityLabel`/`accessibilityRole`/`accessible=` occurrences across 3 files (ContentStep.tsx, SettingsScreen.tsx, HierarchyPanel.tsx). Core screens (HikingScreen, MapHistoryScreen, HomeScreen, MemoryScreen, PlantScreen, StopSummarySheet, TooShortSheet, MarkerDetail) have zero accessibility labels. Custom icon-only buttons (map controls, activity icons) have no readable text alternatives.
- **Severity**: Critical for App Store submission if targeting WCAG/ADA — will get 1-star reviews from vision-impaired users; also blocks Apple's "designed for accessibility" surfacing.
- **Recommendation**: Sweep all TouchableOpacity/Pressable with icon-only content; add labels. Minimum: Start Hike, Stop, Save, Delete, Marker pin, Settings entry, Auth submit.

### Scenario 4: Dynamic Type (iOS text size slider)
- **Status**: NOT handled
- **Evidence**: `grep allowFontScaling|maxFontSizeMultiplier|Dynamic.?Type` returns zero matches. `App.tsx:634-643` installs `Inter_400Regular` as `Text.defaultProps.style` — this does not disable font scaling, but the app also does not opt into it or clamp it. Long-text screens (SettingsScreen, MarkerDetailScreen note field) will overflow when user has iOS text size at max (200%+).
- **Severity**: Critical — accessibility regulation exposure; visible layout breakage at large sizes.
- **Recommendation**: Add `allowFontScaling={true}` explicitly for content text, `maxFontSizeMultiplier={1.5}` for compact UI labels (button rows, tab labels). Layout audit at 200% Dynamic Type.

### Scenario 5: RTL fallback (Arabic/Hebrew locale rotation)
- **Status**: NOT handled
- **Evidence**: No `I18nManager`, no `isRTL`, no `expo-localization` import in `app/src/**` (only `__tests__/i18n.test.ts` and research docs). `app.json` includes `expo-localization` in plugins but it is never consumed in code. All UI is hard-coded English. Layout mirrors would break because absolute positioning is used in HikingScreen bottom controls.
- **Severity**: Medium — NZ target market is English-first; RTL users would land in English fallback which is acceptable for MVP but layout does not mirror.
- **Recommendation**: MVP acceptable as English-only. Add `I18nManager.allowRTL(false)` explicitly to prevent partial RTL layouts if any downstream lib forces it.

### Scenario 6: Rotation mid-flow (portrait ↔ landscape)
- **Status**: Handled (locked)
- **Evidence**: `app.json:6` sets `"orientation": "portrait"`. iOS + Android are locked. No `useWindowDimensions` reactive layout for landscape observed in HikingScreen/MapScreen.
- **Severity**: N/A — locked to portrait per config.
- **Recommendation**: None.

### Scenario 7: HealthKit / Apple Watch integration
- **Status**: NOT handled
- **Evidence**: Zero matches for `HealthKit|Apple.?Watch|Complication` in app source (only in `research/` docs).
- **Severity**: N/A — not in MVP.
- **Recommendation**: Post-launch feature.

### Scenario 8: IAP paywall exercise
- **Status**: Partial (UI stub exists)
- **Evidence**: `app/src/features/memory/components/PaywallSheet.tsx` exists (paywall UI). No `StoreKit`, no `expo-in-app-purchases`, no `RevenueCat` wired. The launch strategy memory (`project_cairn_launch_strategy.md`) confirms NZD $5.99/mo pricing is planned but backend + StoreKit integration not built.
- **Severity**: N/A for MVP (paywall not enforced yet).
- **Recommendation**: Track paywall wiring as a distinct Sprint.

### Scenario 9: Low disk space (< 100MB)
- **Status**: Partial
- **Evidence**: `hikeTracksCache.ts` has L2 300MB size cap + L3 30-day TTL for its own directory (line 6-9), so Cairn self-limits growth. BUT no `FileSystem.getFreeDiskStorageAsync()` check exists — if the OS runs out of disk (photo library, iCloud), `hikeTrackWriter` write will throw and the JSON blob for the finished hike may not persist. `saveHikeAtomic` retry does not distinguish disk-full from network 5xx.
- **Severity**: Critical — data loss potential. A user with a full iPhone finishes a hike and it silently fails to save locally; if `saveHikeAtomic` also fails (offline), the hike is gone.
- **Recommendation**: Preflight check in `stopTracking`: call `FileSystem.getFreeDiskStorageAsync()`; if <50MB, show explicit "Free up space, we couldn't save your hike locally" modal with retry.

### Scenario 10: Low Power Mode
- **Status**: Handled
- **Evidence**: `services/lowPowerModeWarn.ts` — full 46-line implementation, one-time-per-24h Alert via `Battery.isLowPowerModeEnabledAsync()`. Called from tracking start flow. Deduped by AsyncStorage timestamp.
- **Severity**: N/A — implemented.
- **Recommendation**: Verify Alert actually shows at real device tracking-start (unit test only calls the function; no smoke test evidence).

### Scenario 11: iOS 17 Sensitive Content warnings
- **Status**: NOT handled
- **Evidence**: Zero matches for `SensitiveContent|contentWarning`. Cairn has no user-generated image upload UI beyond marker photos; but marker notes could theoretically contain adult content pasted from clipboard. No moderation layer.
- **Severity**: Medium — App Store guideline exposure. Photo attachments to markers are user-generated and could contain nudity/violence.
- **Recommendation**: Add a lightweight text `⚠️ community guidelines` disclaimer on the marker note input; defer image moderation to a post-launch content policy.

### Scenario 12: Airplane-mode toggle mid-flow
- **Status**: Partial
- **Evidence**: `services/networkMonitor.ts` has native listener + 30s poll backup. On offline → online, `syncDaemon.drainPending()` is triggered from `App.tsx:384-388`. HOWEVER: mid-hike, if user toggles airplane on, there is NO visible UI banner ("You're offline — recording continues locally"). The tracking store continues writing to local JSON but the user has no signal. If they force-quit thinking the app is broken, they lose the hike.
- **Severity**: Critical — silent offline behavior is a known UX pitfall (Strava/AllTrails both surface offline banners).
- **Recommendation**: Persistent banner "Offline — tracking continues" whenever `networkMonitor.isOnline() === false` AND `useTrackingStore.status === 'tracking'`.

### Scenario 13: Multi-account logout during tracking
- **Status**: Partial
- **Evidence**: `apiService.ts:87-89` has a `tracking-active guard`: `if (useTrackingStore.getState().status === 'tracking')` on 401 during tracking → defers logout (`revoke:401_during_tracking_deferred`). Good. BUT no code path handles user manually tapping "Sign Out" from Settings mid-hike. Grep for `switch.?account|multipleAccount` returns nothing. If a user signs out while `useTrackingStore.status === 'tracking'`, the token is cleared but the tracking store is not stopped — subsequent `saveHikeAtomic` call will 401 and lose data.
- **Severity**: Critical.
- **Recommendation**: In `SettingsScreen` Sign Out handler, guard: if tracking active, show Alert "You are recording a hike. End first, or continue tracking without signing out."

### Scenario 14: App-suspend during save
- **Status**: Partial
- **Evidence**: `saveHikeAtomic` (sessionService.ts:184-240) has one retry with 500ms backoff. `App.tsx:581-590` triggers `drainPending` on background→active. `pendingSyncStore.ts` persists unsaved hikes to disk. BUT: if the app is suspended by iOS while `authenticatedFetch` is in flight, the fetch is paused; iOS may kill the app before it resumes → `saveHikeAtomic` never completes and the loading spinner in `StopSummarySheet` stays "Saving…" on next launch (state is not persisted).
- **Severity**: Medium — data survives via `pendingSyncStore`, but UX shows stale "Saving" state.
- **Recommendation**: On tracking-stopped → save-in-progress, mark the session `syncState='pending'` before the fetch, not after. That way an abort leaves a recoverable state.

### Scenario 15: Long backgrounding (30 min+ during hike)
- **Status**: Handled
- **Evidence**: `backgroundLocationTask.ts` is registered at App boot (App.tsx:64). `expo-location` `startLocationUpdatesAsync` runs a native task; iOS `UIBackgroundModes: ["location", "audio"]` in `app.json` enables it. `autoPauseMonitor.ts` fires prompt at 15 min idle + auto-end at 30 min idle to prevent runaway sessions. Battery monitor samples every 60s.
- **Severity**: N/A — handled.
- **Recommendation**: None. (Verify battery drain in real 3+ hour tramp — no timing evidence in code.)

---

## Section B — Additional edge cases (16–48)

### Scenario 16: Time zone jump (fly to different TZ mid-hike)
- **Status**: NOT handled (but low impact)
- **Evidence**: All timestamps use `Date.now()` (Unix ms UTC), so timeline math is TZ-agnostic. Display uses `toLocaleDateString()` which auto-adapts. But `duration_s` in `saveHikeAtomic` payload is client-derived; if user's clock changes mid-hike (via TZ), it does not affect elapsed calc (Date.now() is TZ-independent), so this is actually fine.
- **Severity**: N/A.

### Scenario 17: Clock drift (device clock rewinds)
- **Status**: Partial (would produce negative duration)
- **Evidence**: `useTrackingStore` computes `duration_s = (now - startedAt) / 1000`. If user manually sets clock back, this goes negative. `smoothTrackPoints.ts:44-49` computes `dtS` and checks `if (dtS > 0)` — negative dt is ignored (good). But session duration display in `MapHistoryScreen` would show a negative number.
- **Severity**: Medium — corrupt hike record if user rewinds clock.
- **Recommendation**: `Math.max(0, duration_s)` at display + on save-payload.

### Scenario 18: Storage quota exceeded (100+ sessions)
- **Status**: Handled
- **Evidence**: `hikeTracksCache.ts` implements 300MB cap + 30-day TTL for `cairn-hike-tracks/` directory. Explicit design at line 5-17. Removes oldest uploaded completed hikes first.
- **Severity**: N/A — handled.

### Scenario 19: Concurrent Save + Delete race
- **Status**: NOT handled
- **Evidence**: `saveHikeAtomic` sends `PATCH /api/sessions/:id/save` while `deleteSession` presumably sends `DELETE /api/sessions/:id`. Client has no local mutex. If user taps "Delete" on `MapHistoryScreen` while `saveHikeAtomic` retry is in flight (from a prior offline attempt), the DELETE can arrive first (idempotent) and then the PATCH will resurrect a deleted row (server may 404 or worse, re-create). No `AbortController` on the fetch. Backend guards not visible from client side.
- **Severity**: Blocker — data loss/resurrection race.
- **Recommendation**: Client: track in-flight save promises per sessionId; on delete, `abort()` the save and wait before firing DELETE. Backend: return 410 Gone on PATCH after DELETE.

### Scenario 20: Server 503 during save (retry behavior)
- **Status**: Partial (one retry only)
- **Evidence**: `sessionService.ts:206-219` — retries once on 5xx with 500ms backoff, then falls into `pendingSyncStore` via caller. `syncDaemon.drainPending` is triggered on network events and app-foregrounding.
- **Severity**: N/A — acceptable single-retry + queue design.
- **Recommendation**: None. (Consider exponential backoff in syncDaemon for repeated failures — not visible in code.)

### Scenario 21: Server 401 mid-session (token expired)
- **Status**: Handled (explicit iron rule)
- **Evidence**: `apiService.ts:52-95` — strict 401 handling. Only server-signaled `X-Cairn-Auth-Invalid: true` triggers logout. Tracking-active guard defers logout. `skipLogoutOn401` for retries. Well-thought-out.
- **Severity**: N/A — handled.

### Scenario 22: Malformed backend response
- **Status**: Partial
- **Evidence**: 7 files use `JSON.parse` inside `try/catch`. But `saveHikeAtomic` (sessionService.ts:229-244) parses response body assuming shape `{ok: true, session_id, finalized_at, memory}`. No runtime shape validation. If backend returns valid JSON with wrong shape (`{}` on partial failure), `result.session_id` is undefined and downstream `syncState='synced'` marks a hike as synced when it wasn't.
- **Severity**: Critical.
- **Recommendation**: Add shape guard: `if (typeof json?.session_id !== 'number') throw new Error('malformed save response')`.

### Scenario 23: Backend field addition without app knowing
- **Status**: Handled (graceful default)
- **Evidence**: Client uses explicit picks (see `useSettingsStore.pick`, `SaveHikeAtomicPayload` interface). Unknown fields in response are ignored (JS default). New required response fields would fail Scenario 22.
- **Severity**: N/A — graceful degradation works.

### Scenario 24: iCloud restore to new device
- **Status**: NOT handled
- **Evidence**: Zero matches for `iCloud|CloudKit|NSUbiquitousKey`. Cairn stores data in AsyncStorage + `documentDirectory` file system. iOS default iCloud backup DOES include these unless `NSURLIsExcludedFromBackupKey` is set on the file. Not set → restoring to a new device pulls `cairn-hike-tracks/` + AsyncStorage forward BUT the login token in `SecureStore` does NOT restore (SecureStore is per-device). User will see their local data but be logged out; upon re-login, sync may double-write (server has same session ids from previous device).
- **Severity**: Critical — potential duplicate hikes on server.
- **Recommendation**: On first successful login after restore, check if local `pendingSyncStore` has items with `remoteId` that server confirms exist → mark synced without re-uploading (idempotency-key based).

### Scenario 25: Locale changed while app running
- **Status**: NOT handled (mostly OK)
- **Evidence**: `toLocaleDateString()` calls throughout will pick up new locale on next render. But locale change fires `AppState` and re-renders inconsistent — no explicit listener. Should not crash.
- **Severity**: Low — cosmetic only.

### Scenario 26: Distance unit changed mid-hike (m ↔ ft)
- **Status**: Partial
- **Evidence**: `useSettingsStore.units` powers `distanceFormat.ts`. When user toggles in Settings mid-hike, subscribers to `useSettingsStore` re-render. But `HikingScreen` distance readout should also update. NOT verified: whether `total_distance_m` (raw metric internal) is preserved and only display converts, or whether some cached formatted string is used.
- **Severity**: Medium — could show inconsistent readouts.
- **Recommendation**: Confirm HikingScreen reads `units` reactively; verify no cached formatted string.

### Scenario 27: Extremely long hike (12+ hours, memory)
- **Status**: Partial
- **Evidence**: `smoothTrackPoints` filters + Kalman applied in-memory. No streaming/chunking to disk. `hikeTrackWriter.ts` writes chunks to disk (`ACTIVE_DIR`). For 12h @ 1Hz = 43,200 points; each ~48 bytes = ~2MB raw = manageable. But H3 bulkImport (`useH3VisitedStore.ts:249`) chunks 100 at a time via `setTimeout` yielding — good. Full smoothing on 40k+ pts is O(n) which is fine.
- **Severity**: Medium.
- **Recommendation**: Real-device profiling on 8h+ hike. No blocker found.

### Scenario 28: Zero-distance session (user tapped Stop immediately)
- **Status**: Handled
- **Evidence**: `TooShortSheet.tsx` handles fewer than 2 GPS points explicitly ("no drawable path"). Flow: `stopTracking` pre-checks → if too short, shows sheet with "Got it" (keep tracking) / "End anyway" (discard). Sane UX.
- **Severity**: N/A — handled.

### Scenario 29: Session with 100,000+ trackpoints (perf)
- **Status**: Partial
- **Evidence**: `MapHistoryScreen.tsx:953` comment "long hikes but typical NZ trail is < 2000 points — Mapbox handles it". No test for 100k. Kalman + Douglas-Peucker `strokeSimplify.ts` is O(n log n) and would run for seconds on 100k. No spinner during smoothing.
- **Severity**: Medium — degenerate but rare (would require multi-day continuous tracking).
- **Recommendation**: Cap tracking session at 24h; auto-end. Verify simplify performance at 50k.

### Scenario 30: Marker at antimeridian (180°, wrap-around)
- **Status**: NOT handled
- **Evidence**: Zero matches for `antimeridian|wraparound`. `haversineM` in geo.ts is antimeridian-safe (great-circle math) but display/map viewport calcs may break at 179.9°→ -179.9° wrap. NZ users near 180° meridian (Chatham Islands) could hit this.
- **Severity**: Low — NZ mainland is 166-179°E, no wrap. Chatham is 176°W = 184°E. Would affect Chatham Islands users, tiny population.
- **Recommendation**: Defer. Note in known-limits doc.

### Scenario 31: Marker with unicode emoji in name
- **Status**: Handled (implicit)
- **Evidence**: `TextInput maxLength={30}` counts JS chars (UTF-16 units), so a 4-byte emoji (surrogate pair) counts as 2 chars. Persistence is `JSON.stringify` which handles UTF-8 correctly. Backend must also accept UTF-8 (assumed).
- **Severity**: N/A — works but `maxLength=30` gets ~15 emoji rather than 30. Minor UX quirk.

### Scenario 32: Very long marker note (10,000 chars)
- **Status**: Handled
- **Evidence**: `ContentStep.tsx:123` + `MarkerDetailScreen.tsx:337` — `maxLength={ContentConfig.textMaxChars}` = **200** chars. User cannot enter 10k.
- **Severity**: N/A — capped at 200 chars.

### Scenario 33: Duplicate marker IDs
- **Status**: Partial
- **Evidence**: `useMarkerStore.ts` uses IDs generated client-side (presumably uuid). No dedup on load. If two devices generate the same UUID (astronomically unlikely) or if a merge from `pendingSyncStore` re-inserts, dedup depends on server. Client insertion is not idempotent by ID (Set-vs-Array behavior not verified).
- **Severity**: Low — UUID collision improbable, but `saveHikeAtomic` uses `idempotencyKey` for hike; markers have no visible idempotency contract.
- **Recommendation**: Confirm marker insert on server is `INSERT ... ON DUPLICATE KEY UPDATE` or equivalent.

### Scenario 34: Deleted user's friend request appearing
- **Status**: NOT handled
- **Evidence**: `useFriendStore.ts` returns list from server; if server sends a friend row referencing a deleted user, client renders it with default/null name. No filter.
- **Severity**: Medium — cosmetic; server-side should tombstone.
- **Recommendation**: Client-side skip when `friend.user_id === null` or `friend.status === 'deleted'`.

### Scenario 35: Friend removes you while you're viewing their profile
- **Status**: NOT handled
- **Evidence**: `FriendsScreen.tsx` and `MarkerDetailScreen.tsx` viewing another user's marker: no realtime subscription. Stale view persists until manual refresh; a subsequent action (like) would 403 or 404 from server. No visible retry/handling.
- **Severity**: Medium — user sees a phantom profile until refresh.
- **Recommendation**: On any 403/404 from a friend-scoped endpoint, invalidate friend cache + show "This friend is no longer available" toast.

### Scenario 36: GPS jitters between two points 100m apart (falsely inflates distance)
- **Status**: Handled
- **Evidence**: `smoothTrackPoints.ts`: accuracy>25m rejected (line 39), teleport (>15 m/s + >30m) rejected (line 48), stationary collapse in 5-pt window (line 31-32), Kalman filter. Solid multi-layer filtering.
- **Severity**: N/A — handled.

### Scenario 37: Battery dies mid-hike (unclean shutdown)
- **Status**: Handled
- **Evidence**: `hikeTrackWriter.ts` chunk-writes to `ACTIVE_DIR` continuously (not only at stop). `UnfinishedRecoveryModal.tsx` prompts on next boot to recover or discard an unfinished session. `useTrackingStore.discardCurrentSession` is invoked.
- **Severity**: N/A — handled.

### Scenario 38: Force-quit during save
- **Status**: Partial
- **Evidence**: Same as Scenario 14. `pendingSyncStore` persists but syncState transition happens after fetch resolution. Force-quit mid-fetch → hike marked as failed only on next boot's `drainPending`.
- **Severity**: Medium — recoverable but with delay + confusing "Saving…" UI on next launch (state not restored).
- **Recommendation**: Same as Scenario 14 (mark pending BEFORE fetch, not after).

### Scenario 39: Screen recording during Delete Account
- **Status**: NOT handled
- **Evidence**: No `preventScreenCapture` calls. The Delete Account flow (SettingsScreen.tsx:1080-1130) reveals user email + name in the mailto composed body — visible if screen recording is active or if a friend takes a screenshot.
- **Severity**: Low — user is deliberately deleting their own account and their own email is displayed.
- **Recommendation**: Optional: `expo-screen-capture` `preventScreenCaptureAsync()` during the modal. Not required for MVP.

### Scenario 40: Screenshot of memory map shared publicly (privacy leak)
- **Status**: NOT handled
- **Evidence**: The Memory tab (MemoryScreen.tsx) draws user's fog + revealed cairns; a screenshot would reveal home location and travel patterns. No privacy blur/watermark added when sharing.
- **Severity**: Medium — user education issue.
- **Recommendation**: If sharing is added post-MVP, include home-radius mask by default. For MVP, doc note.

### Scenario 41: In-app browser (mailto, external URL) fallback if no email app
- **Status**: Handled
- **Evidence**: `SettingsScreen.tsx:1106-1115` — tries `Linking.openURL('mailto:…')`, on catch shows different Alert. Good pattern applied to Delete Account. `MigratorRetryPrompt.tsx:75` has similar `.catch(() => {})` but no user-visible fallback message. Inconsistent.
- **Severity**: Medium — inconsistent handling.
- **Recommendation**: Extract a `openMailOrShowFallback()` helper used everywhere.

### Scenario 42: iPad Split View
- **Status**: NOT supported
- **Evidence**: `app.json:16` — `"supportsTablet": false`. iPad users get letterboxed iPhone layout.
- **Severity**: N/A — explicit design choice.

### Scenario 43: iPad hover / pointer input
- **Status**: N/A
- **Evidence**: See Scenario 42 — no iPad support.

### Scenario 44: Handoff (iPhone → iPad continuity)
- **Status**: N/A
- **Evidence**: No `NSUserActivity` calls; not supported.

### Scenario 45: Widget
- **Status**: N/A — post-MVP.

### Scenario 46: Watch complication
- **Status**: N/A — post-MVP.

### Scenario 47: Siri Shortcuts
- **Status**: N/A — post-MVP.

### Scenario 48: iCloud Family Sharing
- **Status**: N/A — no purchase yet; when IAP ships, Apple handles automatically.

---

## Priority summary

### Release-Blocker edge cases (would crash, data loss, or privacy leak)
1. **Scenario 19** — Concurrent Save+Delete race. No client-side mutex; DELETE + retry PATCH can resurrect a deleted hike. **Fix**: AbortController on in-flight save when delete is triggered.
2. **Scenario 22** — Malformed backend response marks hikes synced when they aren't. **Fix**: Runtime shape validation on `saveHikeAtomic` response.
3. **Scenario 24** — iCloud restore to new device produces duplicate hikes on server. **Fix**: On first login after restore, reconcile `pendingSyncStore` against server-known ids.

### Critical (bad UX will get 1-star reviews)
1. **Scenario 3** — VoiceOver: only 3 files have accessibility labels; core hiking flow is entirely inaccessible.
2. **Scenario 4** — Dynamic Type: no font scaling opt-in; large-text users see overflow.
3. **Scenario 9** — Low disk space: no preflight; save silently fails.
4. **Scenario 12** — Airplane-mode mid-hike: no visible offline banner; users think app is broken and force-quit.
5. **Scenario 13** — Sign-out during tracking: no guard; token cleared → save 401s → hike lost.

### Medium (annoying, fix in next iteration)
1. **Scenario 1** — Push cold-boot lands on Home instead of active hike.
2. **Scenario 11** — No sensitive-content policy hint on marker photo/text UGC.
3. **Scenario 14 / 38** — App-suspend/force-quit during save leaves stale "Saving…" state on next launch.
4. **Scenario 17** — Clock rewind produces negative duration display.
5. **Scenario 26** — Unit toggle mid-hike consistency unverified.
6. **Scenario 27 / 29** — Very long / high-point-count hikes: performance unverified beyond ~2000 points.
7. **Scenario 34** — Deleted-user friend rows show as blank/null.
8. **Scenario 35** — Stale friend-profile view after unfriend produces silent 403/404.
9. **Scenario 40** — Memory map screenshot privacy education needed.
10. **Scenario 41** — mailto fallback UX inconsistent between screens.

### Low (deferrable)
1. **Scenario 30** — Antimeridian: affects only Chatham Islands users.
2. **Scenario 31** — Emoji count in `maxLength` (surrogate pair quirk).
3. **Scenario 33** — Marker id collision impossibility (needs server dedup verification).
4. **Scenario 39** — Screen recording during Delete Account exposes own email.

### Deferred to post-MVP (no work needed for launch)
1. **Scenario 2** — Universal deep-links (needs marketing wiring first).
2. **Scenario 5** — RTL: English-only launch acceptable.
3. **Scenario 7** — HealthKit / Apple Watch.
4. **Scenario 8** — IAP paywall enforcement.
5. **Scenario 42–47** — iPad, hover, Handoff, Widget, Complication, Siri Shortcuts.
6. **Scenario 48** — iCloud Family Sharing (auto-handled once IAP ships).

---

## Notes on evidence quality
- All findings derived from static grep + Read of source under `C:\ClaudeCodeProjects\Cairn\app\src\`.
- No runtime testing performed (per prompt scope).
- Confidence: HIGH for "grep returns zero" findings (Scenarios 1, 2, 24, 29 concurrency); MEDIUM for partial-handling findings where full call graph not traversed.

EDGE_HUNT_COMPLETE
