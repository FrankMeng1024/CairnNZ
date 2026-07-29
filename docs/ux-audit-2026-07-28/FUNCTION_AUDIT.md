# Function Audit — 2026-07-28

Codebase: `C:\ClaudeCodeProjects\Cairn\app\src\`
OTA: **O16**
Scope: 12 functional dimensions. Only findings — no code modifications.

---

## 1. Authentication

### Coverage summary
Implemented: email register (with 2-step verification code), login, `getMe`, JWT refresh (30-min interval during tracking), logout (local only), Apple Sign In **stub**, Google Sign In **stub**, remember-me (SecureStore, O1 batch 28.5), delete-account via `mailto:` fallback, in-app password change.
Missing: **Apple Sign In (Alert stub)**, **Google Sign In (Alert stub)**, forgot-password / password-reset flow, server-side logout endpoint, multi-account switching, session revocation across devices, automated (backend-scheduled) account deletion.

### Blocker findings
- **F-AUTH-01** (Blocker, App Store risk): `AuthScreen.tsx:1135` — "Continue with Apple" button is an `Alert.alert('Coming soon', …)` stub. **Apple HIG 4.8 requires Sign in with Apple as an option** if any other 3rd-party social login is offered (Google is on-screen). Shipping this button to App Store review = automatic rejection. Either implement `expo-apple-authentication` or remove the button entirely.
- **F-AUTH-02** (Blocker): `AuthScreen.tsx:451-454` — "Continue with Google" is also an `Alert.alert('Google Sign In', 'Coming in next app update…')`. `promptGoogleAsync` is a hard-coded stub. `authService.ts:127-139` has real `loginWithGoogle(idToken)` that is **never called**. Google OAuth import was removed in "O1 batch 39". Users see a functionless button.
- **F-AUTH-03** (Blocker for App Store 5.1.1(v)): Delete Account flow (`SettingsScreen.tsx:1086-1149`) is a `mailto:` link to `privacy@cairnapp.nz`. Comment at :1067-1077 acknowledges "there is no server-side scheduled deletion table nor a cancel endpoint". Apple requires **actual** in-app deletion, not an email request. Meets guideline literally ("in-app path exists") but review team may still push back.

### Critical findings
- **F-AUTH-04** (Critical): No "Forgot password" link anywhere in `AuthScreen.tsx`. Grep for `forgot|reset.*password` returns no matches. User who forgets password can only email support.
- **F-AUTH-05** (Critical): `authService.logout()` (`authService.ts:141-143`) only calls `clearToken()` — **no backend call** to invalidate the JWT. Other devices/browsers keep the same JWT valid until natural 30-day expiry. Comment at `SettingsScreen.tsx:1120-1124` acknowledges this. No server-side revocation.
- **F-AUTH-06** (Critical): `useAppStore.logout()` (`useAppStore.ts:75-103`) clears `sessions`, `markers`, `memory`, but does **not** clear `useFriendStore.friends`, `useRouteStore`, `useRouteEditStore`, `useMarkerStore` MMKV cache (only in-memory), or `useSettingsStore.debugMode`. Sign-in as User B can see User A's friends momentarily.
- **F-AUTH-07** (Critical): Delete-account signs out locally but does not `logout()` the app (`SettingsScreen.tsx:1135` calls `appLogout()` for local sign-out only). Backend still has active session — if a bad actor grabs the token before deletion is processed, they can still access the account for up to 5 business days.

### Medium findings
- **F-AUTH-08** (Medium): Legacy `OLD_REMEMBER_ME_KEY = 'cairn_remember_me'` (AsyncStorage plaintext) is opportunistically cleared on next auth screen mount (`AuthScreen.tsx:524`) but never batch-migrated for users who never revisit AuthScreen. Existing plaintext credentials of dormant users linger indefinitely.
- **F-AUTH-09** (Medium): `getMe` timeout is 8s (`authService.ts:103`) but no user-visible feedback if it times out — `hydrate()` silently falls through to guest. User sees SignIn even when they were logged in.
- **F-AUTH-10** (Medium): No email validation regex on login (`AuthScreen.tsx:577`) — only on register. Login accepts arbitrary text, backend rejects with generic message.
- **F-AUTH-11** (Medium): `verifyCode` (`authService.ts:51-63`) has 60s resend cooldown UI (`AuthScreen.tsx:783`) but no server-side rate limit visible to client — burst-tap Resend is only client-guarded.
- **F-AUTH-12** (Medium): `saveCredentials` (SecureStore) failure is swallowed silently (`AuthScreen.tsx:646`). User checkbox says "Remember me" but if SecureStore write fails they never know it didn't persist.

### Inconsistency findings
- **F-AUTH-13**: `/api/auth/register` uses camelCase (`{name, email, password}` — `authService.ts:38`), `/api/auth/password` uses snake_case (`{old_password, new_password}` — `SettingsScreen.tsx:286`), `/api/auth/google` uses snake_case (`{id_token}` — `authService.ts:129`). No naming convention. Comment at SettingsScreen:281 acknowledges this was already a live bug (O13 fix).
- **F-AUTH-14**: Token stored as `cairn_jwt` (SecureStore) but user logout marker as `cairn_logout_marker` (AsyncStorage) — mixed persistence layers, no rationale.

### Missing features
- Multi-account switching (no UI)
- Session/device management ("sign out other devices")
- 2FA/TOTP setup
- Password strength meter on register
- OAuth Sign In with Google (declared in code but disabled)
- Sign In with Apple (declared, HIG-required, absent)

---

## 2. GPS / Location

### Coverage summary
Foreground GPS via `expo-location.watchPositionAsync`, background via TaskManager (`backgroundLocationTask.ts`). Kalman filter smoothing (Q=1e-9), accuracy reject >25m, teleport reject >10 m/s, stationary radius 8m. Sim-walker override (dev only). Battery-adaptive sampling 3-30s. Sprint 72 hiking token refresh every 30 min. iOS "Always Allow" education modal (once).
Missing: user-visible GPS reception feedback (accuracy meter, satellite count), pull-to-refresh permission, manual GPS calibration option.

### Blocker findings
None outright. GPS is the load-bearing feature and generally robust.

### Critical findings
- **F-GPS-01** (Critical): `startTracking` gates foreground permission (`useTrackingStore.ts:362-368`) but if user tapped "Deny" ever, subsequent taps of Start Hiking silently fall through to `locationAvailable=false` with **no user-facing "open Settings" CTA**. `HikingScreen.tsx:483-485` re-requests, but only if `perm.canAskAgain=true`. No "denied and locked out" branch.
- **F-GPS-02** (Critical): Background permission (`useTrackingStore.ts:373-378`) is best-effort — silent grant/deny. `backgroundGrantedCached` is a module-level flag; if user granted then revoked in iOS Settings while app suspended, the cache is stale until next `startTracking`. Meanwhile the app still calls `startLocationUpdatesAsync` which will fail silently → no background points recorded, but user doesn't know.
- **F-GPS-03** (Critical): iOS Always-Allow education alert (`useTrackingStore.ts:384-423`) has `cancelable: false` so it blocks Start Hiking on first-ever hike. If user taps "Later", the alert never returns even if they revoke background permission externally. Only shown once per install.
- **F-GPS-04** (Critical): Sim-walker `debugMode` gate uses `useSettingsStore.debugMode` (persistent) AND `useSimWalkerStore.active` (in-memory). If user leaves sim-walker active, then app process dies and restarts, debugMode stays but simWalker.active resets to false — user opens Hike, real GPS runs. If they then re-tap toggle, `startTracking` seeds `lastCoordinate` from injector — mixing real & simulated fixes possible in edge case.

### Medium findings
- **F-GPS-05** (Medium): `backgroundLocationTask.ts:104-124` uses read-modify-write on JSONL file (no native `append`). Fires each background wake — race between two wakes could truncate. Comment acknowledges "at worst we lose the last chunk on kill mid-write".
- **F-GPS-06** (Medium): Kalman filter constants (`useTrackingStore.ts:87` `KALMAN_PROCESS_NOISE = 1e-9`) hardcoded — no user-adjustable smoothing profile.
- **F-GPS-07** (Medium): `TELEPORT_SPEED_MPS = 10` fixed. User running at 3-4 m/s crossing a bridge with a GPS glitch could still teleport-reject a valid point below 10 m/s.
- **F-GPS-08** (Medium): No GPS-signal-lost UI event surfaced to the user during hiking. `locationAvailable=false` shows "GPS Offline" chip only at mount; a mid-hike loss doesn't re-appear the chip.
- **F-GPS-09** (Medium): `pendingBackgroundLocations` (module singleton array) drained on 1s foreground interval (`useTrackingStore.ts:546-562`). If foreground drain doesn't fire (app suspended, timer paused), and user reopens app after >1000 points accumulated, drain will iterate all synchronously — potential frame drop.
- **F-GPS-10** (Medium): `persistBackgroundContext` (backgroundLocationTask.ts:45) is async best-effort — if AsyncStorage write fails, Path B loses the gate → background points from that hike write to disk regardless. Comment acknowledges.

### Inconsistency findings
- **F-GPS-11**: Foreground uses `Location.watchPositionAsync`; background uses `Location.startLocationUpdatesAsync` + TaskManager. Both feed `addTrackPoint` but the timestamp dedupe key differs subtly (foreground has ms-precision, background uses `loc.timestamp` from TaskManager payload — may be quantized).

### Missing features
- Accuracy chip / satellite count during hike
- "GPS took X minutes to lock" telemetry surfaced
- Manual "Recalibrate GPS" button
- Compass calibration prompt (RN doesn't ship magnetometer calibration UI)

---

## 3. Map (Mapbox)

### Coverage summary
Native Mapbox via `@rnmapbox/maps` on iOS; `mapbox-gl-js` on web via adapter. Marker rendering via Zustand store filtered by `regionCode`. Fog/memory H3 overlay. Offline pack downloads (`offlineMapService.ts`, `NZ_OFFLINE_PACKS`). Fly-to animations via Camera. HikingScreen live polyline uses Kalman-smoothed track.
Missing: offline pack progress reporting during download, cluster rendering, tile-load failure UI.

### Blocker findings
None.

### Critical findings
- **F-MAP-01** (Critical): `MapHistoryScreen` fetches route detail with 15s timeout (comment at OtaBadge.tsx:70-73 says O6 fix), but if server returns empty `route_points` for a saved session, falls to local `loadTrackPoints` — which returns `[]` if not on this device. User sees "Route data unavailable" when they hiked on another device (comment at OtaBadge.tsx:108-113 O11 partially addresses).
- **F-MAP-02** (Critical): `offlineMapService.ts:56-121` uses `Mapbox.offlineManager.createPack` conditionally (`if (!offlineManager) return`) — on **web** offlineManager is null so `downloadPack` silently no-ops. `OfflineMapSheet.tsx` doesn't distinguish "download skipped (no manager)" from "download in progress" — user sees a spinner forever on web.
- **F-MAP-03** (Critical): No tile-load failure UI. If Mapbox token expires (`mapbox.ts:49` comment says "replace the placeholder URL below with…"), map is blank. Users see nothing, no error state.
- **F-MAP-04** (Critical): Marker cluster rendering not implemented. If user has 100+ markers in a region, all render individually — performance & visual clutter.

### Medium findings
- **F-MAP-05** (Medium): `MapScreen.tsx:693` comment "full bleed topo placeholder" — code says real Mapbox now but comment implies placeholder. Verify.
- **F-MAP-06** (Medium): No fly-to on marker tap; MarkerDetailSheet just opens without map recentering.
- **F-MAP-07** (Medium): Web adapter exposes `window.__cairnMap` for Playwright (`mapboxAdapter.web.tsx:126`) — production build should not have this hook. Comment says production tests use `--no-dev` but no runtime gate visible.

### Inconsistency findings
- **F-MAP-08**: HikingScreen uses `trackPointsSmoothed` (Kalman); MapHistoryScreen also uses smoothed once loaded — but `MarkerDetailScreen` and cairn pin overlays render on **raw** trackPoints. Two visually similar polylines drawn from different sources = subtle drift.

### Missing features
- Tile prefetching for planned routes
- Map style picker (satellite / topo / streets)
- Show current heading arrow on user puck (compass integration exists but not visualized on map)
- Map bookmarks / save current view

---

## 4. Session Tracking

### Coverage summary
Full lifecycle in `useTrackingStore.ts` (1937 lines): start → foreground/background source switching → 120s incremental flush → stop → v412 atomic save → local + remote. Too-short guard (2 points OR <20m). Sim-walker bypass. Auto-pause monitor (Sprint 72). Cold-boot recovery via `hikeTrackWriter` (JSONL persistence). PendingSyncStore for offline saves.
Missing: user-initiated pause during hike (only auto-pause), lap markers, split display.

### Blocker findings
- **F-SES-01** (Blocker for App Store data-loss concern): `saveHikeAtomic` (`sessionService.ts:184-248`) has one internal retry + 15s wall-clock timeout in stopTracking (`useTrackingStore.ts:1092-1107`). If both fail → `pendingSyncStore` write. If **that** write fails, `savePending`'s catch merely `crashLogger.breadcrumb`s — user's hike is lost with no user-facing surfacing. HikingScreen wall-clock catch was noted as "5s" (see comment 1295-1301) — mismatched with 15s inner.

### Critical findings
- **F-SES-02** (Critical): `stopTracking` has an outer try/catch (`useTrackingStore.ts:876-1283`) added in O8 because "user 12:11 real hike stopTracking died in some unguarded sync operation, no aliyun trace". The fallback `addSession` block runs with minimal payload (`syncState: 'pending'`). This is a workaround for an unresolved root-cause bug — still latent.
- **F-SES-03** (Critical): `useTrackingStore.discardCurrentSession` (referenced but not shown) must call `hikeTrackWriter.discardActiveHike` (per O14 fix + O16 B3 comment). If the fix isn't wired, discard → recovery modal ghost. Comments say fixed but process still fragile.
- **F-SES-04** (Critical): O14 Bug 5 fixed a "Save → unfinished modal on next open" bug by widening `FLUSH_INNER_TIMEOUT_MS` from 2500 → 15000. For hikes >15s to flush (very large hikes), rename still happens fire-and-forget → same bug re-emerges.
- **F-SES-05** (Critical): Too-short guard runs twice (`useTrackingStore.ts:751-808` and again at 937-952). If the two guards ever disagree (different sim-walker gate reads, race with settingsStore mutation), a session could be silently dropped between the checks.
- **F-SES-06** (Critical): `useTrackingStore.stopTracking` fetches `memoryUnsynced` by filtering `useMemoryStore.getState().points` (`useTrackingStore.ts:1051-1053`). If memory hydration hasn't finished (cold-boot mid-hike edge), the filter returns empty → server misses this hike's memory points.
- **F-SES-07** (Critical): `syncState: 'pending'` sessions render as grey unclickable in Activities (per comment in useSessionStore.ts:46), but `MapHistoryScreen.tsx:515` shows `abandonPending` action. If user abandons a pending hike, `pendingSyncStore` op is removed but the local session may retain `syncState='pending'` (stale) — permanent grey card.

### Medium findings
- **F-SES-08** (Medium): No user-initiated pause button — only auto-pause (`autoPauseMonitor.ts`). User walking through a tunnel can't tell the app "I'm actually still going".
- **F-SES-09** (Medium): `useTrackingStore.stopTracking` order-of-operations: v412Payload built before addSession; if `uuidv4()` fallback used (crypto unavailable), idempotency key quality drops silently.
- **F-SES-10** (Medium): `lastFlushedIdx` module-level variable is reset to 0 on every `startTracking` — but if `startTracking` is somehow called twice without stopTracking, second run overwrites the first's flush cursor.
- **F-SES-11** (Medium): `distanceM` accumulation uses `haversineM` on raw `trackPoints` — if raw includes even one accepted-but-noisy point near stationary, distance inflates. Reject rate is 25m accuracy but noise <25m still flows in.
- **F-SES-12** (Medium): No "resume last session" if user kills app mid-hike and doesn't accept UnfinishedRecoveryModal. Discarded modal = data lost.

### Inconsistency findings
- **F-SES-13**: `useSessionStore.clearSessions` acknowledges (`useSessionStore.ts:114-117`) that per-session trackpoint keys become orphaned because "AsyncStorage has no getAllKeys filter". Comment says "acceptable trade-off". Storage bloat.
- **F-SES-14**: `distance_m` stored as number in local session but comes back from backend as a JSON number too — no unit conversion anywhere. If backend ever changed to feet (unlikely) client would silently mislabel.

### Missing features
- Manual lap markers
- Splits display (per-km pace)
- Pause + resume history (currently `pausePins` array exists but was removed as dead field per O1 batch 40 comment)
- Live activity type auto-detection (hiking vs running vs cycling)
- Weather/temperature capture at session start

---

## 5. Storage / Persistence

### Coverage summary
Layers: `SecureStore` (JWT, remember-me credentials), `AsyncStorage` via wrapper `storage.ts`, `expo-file-system/legacy` for JSONL hike tracks. All Zustand stores hydrate on cold boot. Per-user key scoping (`cairn_sessions_<userId>`).
Missing: MMKV (referenced in comments but not imported — AsyncStorage is the reality), storage quota handling, background sync of legacy caches.

### Blocker findings
None outright.

### Critical findings
- **F-STO-01** (Critical): `storage.ts` silently swallows all storage errors and returns null. If AsyncStorage disk is full, user sees no error and their session is not persisted. Silent data loss.
- **F-STO-02** (Critical): `useSessionStore.hydrate` (`useSessionStore.ts:182-201`) is not idempotent — if called twice for different userIds racing (post-login `hydrate` + backend fetch), second call overwrites first without merging.
- **F-STO-03** (Critical): `useAppStore.hydrate` at :202 does `useSessionStore.setState({ sessions, currentUserId: user.id })` bypassing the store's actions — no `currentUserId` was updated via a store method. If `addSession` runs before this setState settles, sessions save under wrong user key. Race.
- **F-STO-04** (Critical): Orphan trackpoints — per session, `cairn_trackpoints_<userId>_<sessionId>` written on save, deleted on `deleteSession`. But `clearSessions` (logout) explicitly does NOT delete them (comment at useSessionStore.ts:114-117). Sign-in → sign-out → sign-in-as-different-user → new user's `hydrate` doesn't read them, but disk-usage grows unbounded.

### Medium findings
- **F-STO-05** (Medium): `sessionsKey` produces `cairn_sessions_${userId}` — but `userId` for guest is literal `'guest'`. If a user's real id happens to be the string "guest" (shouldn't but…), collision.
- **F-STO-06** (Medium): `cairn_markers_v026` (`useMarkerStore.ts:90`) — key bumped from `cairn_markers` in v0.2.6. Old key never cleaned up. Multi-version storage bloat.
- **F-STO-07** (Medium): `credentialsStore` (SecureStore) has no atomicity — if `saveCredentials` write fails partway (unlikely on iOS but possible), state is undefined.
- **F-STO-08** (Medium): No storage quota check anywhere. iOS silently caps AsyncStorage; hitting the cap = crashes.

### Inconsistency findings
- **F-STO-09**: `storage.ts` uses AsyncStorage on native, `localStorage` on web. `hikeTrackWriter.ts` uses expo-file-system/legacy on native, localStorage-backed shim on web. Two different fallback strategies for two adjacent concerns.
- **F-STO-10**: JWT is `cairn_jwt` (SecureStore). Logout marker is `cairn_logout_marker` (AsyncStorage via `storage.ts` wrapper). Credentials are in `credentialsStore` (SecureStore direct). Three different persistence patterns for authentication state.

### Missing features
- Storage cap enforcement
- Migration framework for schema bumps (each key does its own ad-hoc migration)
- Backup/restore user data (GPX export mentioned in Privacy but no code)

---

## 6. Sync (Backend upload)

### Coverage summary
`offlineQueue` (session_append, session_finalize, marker_create) with UUID idempotency + exponential backoff + chunking. `pendingSyncStore` for save-hike-atomic pending state. `syncDaemon.drainPending` for hike-atomic retry. `authenticatedFetch` adds Bearer + 401 handling with tracking-active guard.
Missing: manual force-sync button, per-op progress display.

### Blocker findings
None.

### Critical findings
- **F-SYNC-01** (Critical): `offlineQueue.drain` (`offlineQueue.ts:191`) has `draining` boolean guard but is not a lock — if called from two different triggers on same tick (foreground + online), only first wins; subsequent triggers are silently dropped. Second trigger may have been the correct one to drain new ops.
- **F-SYNC-02** (Critical): `syncDaemon.drainPending` has 3 trigger points (per OtaBadge.tsx:74-77): hydrate, NetInfo change, AppState → active. If all three fail (e.g., NetInfo doesn't fire on rejoin, hydrate ran early, no AppState transition), a pending hike could sit forever. Comment says "self-heal on foreground toggle" — user relies on OS behaviour.
- **F-SYNC-03** (Critical): `authenticatedFetch` 401 handling has 4 rules (`apiService.ts:52-101`). Rule 4 (tracking-active defers logout) sets no `pendingReauth` flag anywhere accessible to UI. User could be mid-hike with revoked token, hike ends, user is silently logged out with no notification.
- **F-SYNC-04** (Critical): `offlineQueue.enqueue` chunking (`offlineQueue.ts:143-167`) creates chunk opIds like `${baseOpId}-chunk-${idx}`. If **first** chunk succeeds server-side but **second** fails, server accepts the partial GPS points. No transactional integrity across chunks.
- **F-SYNC-05** (Critical): `saveHikeAtomic` idempotencyKey (`sessionService.ts:184-248`) — if `uuidv4()` fallback runs (comment at useTrackingStore.ts:1077-1086), key becomes `fallback-${Date.now()}-${Math.random()}`. If two identical fallbacks race in ms range with same random seed (unlikely but not zero), same key → server may replay wrong payload.

### Medium findings
- **F-SYNC-06** (Medium): `offlineQueue.MAX_ATTEMPTS = 8`. After 8 tries a session_append op is dropped silently — `crashLogger.breadcrumb('offlineQueue:exhausted')` but no UI. User loses GPS segment.
- **F-SYNC-07** (Medium): `fetchSessions` (`sessionService.ts:259-268`) silently returns `[]` on any error. `useAppStore.hydrate` at :180-205 falls through to `useSessionStore.hydrate(user.id)` (local cache) on any exception — but `fetchSessions` returning empty is NOT an exception, so local cache is bypassed, showing empty Activities to a signed-in user with a network hiccup.
- **F-SYNC-08** (Medium): `authenticatedFetch` sets `Content-Type: application/json` even for GET requests with no body — cosmetic but non-standard.
- **F-SYNC-09** (Medium): `sessionService.deleteRemoteSession` (`sessionService.ts:251-258`) has no offlineQueue integration — if delete fails offline, server row lingers forever.

### Inconsistency findings
- **F-SYNC-10**: `/api/sessions/start` returns `{id: number}` (camelCase key); `/api/sessions/:id` GET returns `{session: {…}}` wrapper (`sessionService.ts:146`). Different envelope shapes for closely related endpoints.
- **F-SYNC-11**: `deleteRemoteSession` uses `X-Idempotency-Key` header (implied via authenticatedFetch)? No — it doesn't. But `saveHikeAtomic` does. Idempotency applied unevenly.
- **F-SYNC-12**: `activityMode` in `pendingSyncStore` is TS field, but backend endpoint `/api/sessions/start` expects `type`. Comment at pendingSyncStore.ts:41 flags this as a v412 blocker 1 fix — verify wire mapping is now correct.

### Missing features
- Force-sync-all button in Settings
- Sync progress indicator on Home screen
- "Sync failed" persistent banner
- Bulk deletion sync
- Conflict resolution when server-side edit happens (currently first-write-wins)

---

## 7. OTA (Expo Update)

### Coverage summary
`OtaBadge.tsx` — auto-check on mount with 30s timeout, silent retry on timeout, 60s download timeout, auto-apply 600ms after download. Version pill shows `O16 · <state>`. Manual retry on error. Both inline and floating modes.
Missing: user consent gate before auto-apply, restart delay preferences, changelog display.

### Blocker findings
None.

### Critical findings
- **F-OTA-01** (Critical): `handlePress` for error state calls `Updates.reloadAsync()` (`OtaBadge.tsx:423`) — a **hard app reload**. If user has an unsaved hike or unsent form data, this destroys it. Should confirm before reload.
- **F-OTA-02** (Critical): Auto-apply after 600ms (`OtaBadge.tsx:403`) — user has no chance to prevent. If they're recording a hike (`useTrackingStore.status === 'tracking'`), reload interrupts and forces UnfinishedRecoveryModal on relaunch. Cascading UX pain.

### Medium findings
- **F-OTA-03** (Medium): No changelog / release notes shown before applying update.
- **F-OTA-04** (Medium): `OTA_VERSION = 'O16'` (constant in `OtaBadge.tsx:248`) — bumped manually. If dev forgets to bump, users see stale version string.
- **F-OTA-05** (Medium): OtaBadge state `'error'` shows "Couldn't check · tap to retry" but doesn't distinguish network vs auth vs server error to user.
- **F-OTA-06** (Medium): No rollback UI — if a bad OTA ships, user has no way to revert to previous bundle.

### Inconsistency findings
- **F-OTA-07**: OtaBadge is imported in `AuthScreen.tsx` (splash) and rendered inline. It's also imported in `HomeScreen.tsx` (floating). Both invocations use the same `OtaBadge` component with different `inline` prop — consistency, but two separate cold-boot checks fire simultaneously.

### Missing features
- Update history / changelog viewer
- Manual "Check for updates" button
- Beta channel opt-in

---

## 8. Push Notifications

### Coverage summary
Only usage: `autoPauseMonitor.ts` calls `Notifications.scheduleNotificationAsync` (`autoPauseMonitor.ts:89-96`) for the auto-pause prompt — a local notification, no registration or permission request.
Missing: **entirely absent** — no `registerForPushNotificationsAsync`, no `Notifications.setNotificationHandler`, no cold-boot notification handler, no deep link handling.

### Blocker findings
None (Push isn't in the current feature set).

### Critical findings
- **F-PUSH-01** (Critical if launch requires push): No push registration flow anywhere. Grep for `registerForPushNotifications|getExpoPushToken` returns 0 hits. If launch strategy relies on push notifications (Marketing / re-engagement / friend requests), it's missing.
- **F-PUSH-02** (Critical): `sendPromptNotification` (`autoPauseMonitor.ts:87-100`) does NOT request Notification permission before calling `scheduleNotificationAsync`. On iOS if permission was never granted, `scheduleNotificationAsync` silently fails (`try/catch` swallows). User will never see the auto-pause prompt.

### Medium findings
- **F-PUSH-03** (Medium): No `Notifications.setNotificationHandler` set at app boot — foreground notification behaviour is default (banner, sound, list). If auto-pause fires while user is in-app, they see a banner over the map — could be surprise UX.

### Missing features
- Push notification registration
- Backend push token upload
- Cold-boot deep link from tapped notification (Friend request accepted, etc.)
- In-app notification preferences

---

## 9. Permissions

### Coverage summary
`expo-location`: foreground + background — requested in useTrackingStore.startTracking with education modal. `expo-image-picker`: media library (debugUpload.ts:75 only). `expo-notifications`: never explicitly requested (only auto-pause tries it lazily).
Missing: Camera permission (no `expo-camera`), Media Library (only used in debug upload, not for photo attachment on markers), Notifications permission (see F-PUSH-02).

### Blocker findings
- **F-PERM-01** (Blocker if photo/voice memo is core): No `expo-camera` in codebase (grep returns 0 matches for `Camera.requestPermissionsAsync`). Voice memo (`voiceMemoService.ts:70`) requests Audio permission only. If marker photo upload is planned per PRD, camera perm is missing.

### Critical findings
- **F-PERM-02** (Critical): Foreground GPS permission denial with `canAskAgain=false` — no code path opens Settings deep link automatically. `Linking.openSettings()` is called only in useTrackingStore's education modal (once) and MemoryScreen (`MemoryScreen.tsx:717`). Other GPS-permission entry points (HomeScreen:349, RunningScreen:150, GpsLockStep.tsx) call `requestForegroundPermissionsAsync` and just fail silently.
- **F-PERM-03** (Critical): Background location "Always Allow" education modal is once-per-install (`useTrackingStore.ts:391` SecureStore flag). If user taps "Later" once, they never see it again — no way to re-trigger. If they later realize they want background tracking, they must know to go to iOS Settings themselves.

### Medium findings
- **F-PERM-04** (Medium): Media library permission (`debugUpload.ts:75`) is requested only when user taps "Attach screenshot" — no pre-emptive request, no denial handling.
- **F-PERM-05** (Medium): iOS Tracking Transparency (App Tracking Transparency, `requestTrackingPermissionsAsync`) — 0 matches. If app has any 3rd-party SDK (Mapbox does telemetry), Apple requires ATT prompt. Missing = App Store rejection risk.

### Inconsistency findings
- **F-PERM-06**: Foreground GPS permission is requested from at least 5 screens (`HikingScreen`, `HomeScreen`, `MemoryScreen`, `RunningScreen`, `GpsLockStep`). No single source of truth. Each has its own denial handling.

### Missing features
- Camera permission
- Push notification permission
- App Tracking Transparency (iOS 14+)
- Motion & Fitness permission (for auto-detect / step count if planned)
- "Rationale" screen explaining why each permission is needed BEFORE the OS prompt

---

## 10. Network / API

### Coverage summary
Base URL from `EXPO_PUBLIC_API_BASE_URL` env with production fallback `https://api.yiiling.cn` (`config/api.ts`). `authenticatedFetch` for auth-required routes. Some endpoints have AbortController timeout (getMe: 8s, refreshToken: 8s, snapTrack: various). `networkMonitor` observes NetInfo. Rate-limit 429 handled in `MapMatchingClient`, `markerInteractionService`, `editDiagSender`.
Missing: consistent per-request timeout, retry policy, offline detection banner.

### Blocker findings
None outright.

### Critical findings
- **F-NET-01** (Critical): Most `authenticatedFetch` calls have **no timeout**. `sessionService.startSession`, `appendPoints`, `saveHikeAtomic`, `deleteRemoteSession`, `fetchSessions`, `fetchSessionDetail` — all raw fetches. `saveHikeAtomic` has one internal retry but no wall-clock timeout at the fetch level. If Cloudflare/proxy hangs, `stopTracking` inherits its 20s wall-clock via `Promise.race` (useTrackingStore.ts:1094-1107), but every other endpoint could hang indefinitely.
- **F-NET-02** (Critical): Base URL fallback `https://api.yiiling.cn` (`api.ts:17`) is a hardcoded production URL for the launch domain. If DNS goes down and env var isn't set, app is dead. No fallback second host.
- **F-NET-03** (Critical): `PRIVACY_URL` (`api.ts:29-32`) constructed by concatenation — if `ENV_URL` is set to `.../api` prefix, `PRIVACY_URL` becomes `.../api/privacy` which won't route correctly.
- **F-NET-04** (Critical): 429 rate-limit is handled inconsistently — some services (`editDiagSender`, `MapMatchingClient`, `markerInteractionService`) explicitly recognize it; `sessionService` / `authService` do NOT — they treat 429 as a generic 4xx (offlineQueue drops it, offlineQueue drain would drop it as "bad payload").

### Medium findings
- **F-NET-05** (Medium): No offline banner. `useOnlineOnly` hook exists (`hooks/useOnlineOnly.ts`) but only used in PlantScreen (`PlantScreen.tsx:218`) and MarkerDetail (`MarkerDetailScreen.tsx:120`). Global "You're offline" banner never shown.
- **F-NET-06** (Medium): `networkMonitor.getState().state === 'online'` — implemented per file, no shared hook for consumers other than useOnlineOnly.
- **F-NET-07** (Medium): CORS setup for `X-Cairn-Auth-Invalid` header (`apiService.ts:56`) — comment says "web/browser CORS strips response headers not listed in Access-Control-Expose-Headers". Falls back to body sniff. If server misconfigured, body sniff is O(response-size) — not great for large responses.

### Inconsistency findings
- **F-NET-08**: Fetch timeout: 8s for getMe, 15s for saveHikeAtomic (via race), 30s for OTA check, 60s for OTA download, unbounded for everything else. No policy.
- **F-NET-09**: Retry: OTA has 1 silent retry on timeout only; saveHikeAtomic has 1 retry on 5xx; offlineQueue has 8 attempts with backoff; MapMatching does not retry on 429 (spec says client shouldn't). Inconsistent retry semantics.

### Missing features
- Central `fetchWithTimeout` utility (referenced in nothing — no file matches the name)
- Global offline banner
- Force-refresh button on Home
- API health check / status endpoint monitored client-side

---

## 11. i18n / Localization

### Coverage summary
**Nothing implemented.** Grep for `i18n|translation|useTranslation|useIntl|localization` returns essentially 0. Two Te Reo strings hardcoded:
- `HomeScreen.tsx:38`: `'Kia ora, Explorer'` as morning greeting variant
- `AuthScreen.tsx:946`: `'Nau mai, haere mai'` on welcome screen

All UI copy is English inline strings. Units (metric/imperial) is the only localization primitive (`useSettingsStore.units`, `distanceFormat.ts`).
Missing: **entire i18n framework, translation files, locale detection, RTL support, plural rules, date/time localization.**

### Blocker findings
None (English-only is acceptable for NZ launch).

### Critical findings
- **F-I18N-01** (Critical for NZ launch messaging): DISCOVERY.md commits to "occasional Te Reo touch" but only 2 strings exist. No Te Reo dictionary, no fallback strategy, no way to add strings without editing source. If NZ market response demands more Te Reo, refactor cost is high.
- **F-I18N-02** (Critical): Date formatting is hardcoded `DD/MM/YYYY` (`useTrackingStore.ts:902-908`). For a US user (if the app ever expands), that's confusing. `Intl.DateTimeFormat` not used anywhere.
- **F-I18N-03** (Critical): Pluralization is manual concatenation (`"You still on the trail? Tap to continue or end your hike."` — autoPauseMonitor.ts:93). No plural rule engine. Any "3 hikes" vs "1 hike" is naked string interpolation.

### Medium findings
- **F-I18N-04** (Medium): "Kia ora, Explorer" hardcodes "Explorer" (`HomeScreen.tsx:38`) — a UI mode label that was deleted (O12 comment). Dead string that leaks Te Reo through morning greetings but uses an obsolete term.
- **F-I18N-05** (Medium): Comment at HomeScreen.tsx:37 says "registered translator review pending" — provisional Te Reo content shipping without formal review.

### Inconsistency findings
- **F-I18N-06**: Metric/imperial toggle exists in Settings (`SettingsScreen.tsx:238-684`). NZ users default metric, US would default imperial — but there's no locale-based auto-detection. Every user starts on metric.

### Missing features
- **i18n framework** (react-intl, i18next, or Expo Localization) — completely absent
- Te Reo dictionary
- Locale detection at boot
- Date/time formatting via `Intl`
- Number formatting via `Intl.NumberFormat` (currency, percent, distance)
- RTL layout support

---

## 12. Offline / Network Resilience

### Coverage summary
Offline queue (session_append / marker_create / marker_edit-delete via `markerOfflineEntities`). Pending sync store for hike-save-atomic. Local storage per-user for sessions, markers. Local JSONL hike track disk backup. `useOnlineOnly` hook shows "Needs internet" on specific screens (PlantScreen, MarkerDetailScreen).
Missing: global offline banner, offline maps user-visible status, sync-progress dashboard.

### Blocker findings
None.

### Critical findings
- **F-OFF-01** (Critical): No global "You're offline" banner. User launches app in airplane mode → sees Home with cached data → taps Start Hike → GPS works → hikes for 2 hours → taps Stop → tries to Save → pending sync → user has no idea whether their data is safely stored server-side. Comment at useSessionStore.ts:46 says grey card = pending, but no top-of-screen banner.
- **F-OFF-02** (Critical): Friends screen (`useFriendStore.loadFriendsFromBackend`) silently keeps local cache on failure. User loses network → thinks they've been unfriended because a new friend they added earlier doesn't show. Comment at useFriendStore.ts:60 acknowledges "Network failure — keep local cache" — but the SIDE the user is on (they added, server acknowledged, but pull-back fails) is ambiguous.
- **F-OFF-03** (Critical): Marker create is offline-queued via `offlineMarkers` entity — but marker EDIT and DELETE are not (per MarkerDetailScreen.tsx:120 comment "edit/delete 无网禁用"). User can't fix a typo in an existing marker while offline.
- **F-OFF-04** (Critical): Offline map packs (`offlineMapService.ts`) download when online, but if the user's tile pack is only partially downloaded when they go offline, they see partial tiles — no user feedback distinguishing "partial pack" from "map bug".
- **F-OFF-05** (Critical): `useAppStore.hydrate` at :148-219 has 3 branches: token valid → prewarm, getMe null → guest mode, network fail → guest mode. **Middle two branches both fall through to guest cache** — so a genuinely-invalid token and a network hiccup produce identical user-visible behaviour. User can't distinguish "you need to log in again" from "please connect".

### Medium findings
- **F-OFF-06** (Medium): Voice memo (`voiceMemoService.ts`) stores audio file locally, filename in marker record — but marker upload doesn't push audio (comment at useMarkerStore.ts:49-51 "NOT uploaded to backend in v80"). Voice memos are device-local forever.
- **F-OFF-07** (Medium): `pendingSyncStore` has no size cap (unlike offlineQueue's implicit cap). Hikes accumulate offline → many pending → sync storm on reconnect (many parallel POSTs).
- **F-OFF-08** (Medium): No "Retry sync" button anywhere visible to the user. Sync is autonomous — user cannot force it.

### Inconsistency findings
- **F-OFF-09**: Some offline screens show "Needs internet" pill (MarkerDetailScreen), some show a generic "Cannot reach the server" (AuthScreen:728), some show grey card (Activities pending), some silently fail (friend load). No pattern.

### Missing features
- Global offline banner (top of screen, dismissible)
- Pending-sync review screen (list all queued ops, force retry / delete)
- Offline map "which packs are downloaded" surface
- Read-only mode explicit ("you're offline — some features unavailable")
- Data-usage warnings (cellular vs Wi-Fi)

---

## Cross-cutting findings

- **XC-01**: Sim-walker gating logic (`useSettingsStore.debugMode && useSimWalkerStore.active`) is duplicated in **5+ places** (useTrackingStore.ts multiple times, HikingScreen). One central `isSimWalkerActive()` helper would prevent the "gate drift" bugs described in comments O14 and O15.
- **XC-02**: `crashLogger.breadcrumb(...)` is used everywhere for tracing but comment at OtaBadge.tsx:74 says it "doesn't ship to aliyun debug_events_v2". So breadcrumbs are for local debug only, but code uses them as if they were persistent server logs. Real logging happens via `appLog.log` (also referenced but sparingly). Two log systems, unclear when to use which.
- **XC-03**: `lazy require` pattern (`require('../services/…')`) is used everywhere to avoid top-level side effects. But at runtime this defeats Metro's tree-shaking — every require site pulls the whole module. Bundle size impact undocumented.
- **XC-04**: Playwright test hooks (`window.__cairnMap`, `window.__cairnBreadcrumbs`, `__cairnRestartFlush`, `__cairnStores`) — some gated behind `__DEV__`, some not. Comment at project_v406_web_test_hook.md indicates a known cleanup debt.
- **XC-05**: `voiceMemoUri` (`useMarkerStore.ts:51`) stores `file://…` URI to local m4a. On iOS if user offloads the app, iOS may delete the file — URI stays in the marker but audio is gone. No cleanup logic.
- **XC-06**: Multiple stores hydrate on cold boot in parallel with no explicit ordering: `useAppStore.hydrate` → `useMarkerStore.hydrate` → `useSessionStore.hydrate` → `useMemoryStore.hydrate`. If any depends on another's state at hydrate time, race exists. Comment at useAppStore.ts:160-162 shows a manual ordering rule that must be respected.
- **XC-07**: iOS "Always Allow" education modal is `cancelable: false` and blocks Start Hike — but it's an ambiguous Alert with only "Later" or "Open Settings" and no "Not now" recovery.
- **XC-08**: `syncState` field is optional on `TrackingSession` (`useSessionStore.ts:48`); some entries have `undefined` (legacy or hydrated backend). Callers assume `synced` if `syncState !== 'pending' && syncState !== 'syncing'`. Undefined ≠ 'synced' explicitly — defensive-coding gap.
- **XC-09**: Two "delete" flows (session-delete and account-delete) — session-delete mirrors to backend and cleans local; account-delete only clears local + sends `mailto:`. Very different user models under similar UI language.
- **XC-10**: Route service (`services/routeService.ts`, `routing/*.ts`) uses Mapbox map-matching — but no fallback if Mapbox is unavailable. Snap-to-road fails → raw GPS kept. No user notification of degraded quality.

---

## Priority summary

| Priority | Count | Examples |
|----------|-------|----------|
| Blocker | 5 | F-AUTH-01 (Apple stub), F-AUTH-02 (Google stub), F-AUTH-03 (Delete Account fake), F-SES-01 (data-loss corner), F-PERM-01 (camera missing) |
| Critical | 42 | F-AUTH-04 (no forgot password), F-AUTH-05 (no server logout), F-GPS-01 (denied GPS no CTA), F-MAP-01 (Route unavailable), F-SES-02..07 (session-save weaknesses), F-STO-01..04, F-SYNC-01..05, F-NET-01..04, F-OFF-01..05, F-I18N-01..03, F-PUSH-01..02, F-OTA-01..02, F-PERM-02..03 |
| Medium | 40+ | (see per-section lists) |
| Inconsistency | 15 | Naming (F-AUTH-13), timeout policy (F-NET-08), retry (F-NET-09), envelope shape (F-SYNC-10), offline UI (F-OFF-09) |

---

## Playwright test requests (Phase 2)

For each Blocker/Critical finding, a Playwright test that would surface it:

- **F-AUTH-01**: NAVIGATE `/auth` → CLICK "Continue with Apple" → SCREENSHOT → verify `alert()` text mentions "Coming soon" (not a real flow).
- **F-AUTH-02**: NAVIGATE `/auth` → CLICK "Continue with Google" → SCREENSHOT → verify alert with "Coming in next app update" text.
- **F-AUTH-04**: NAVIGATE `/auth` (login view) → SCREENSHOT → verify no "Forgot password" link visible.
- **F-AUTH-05**: LOGIN as user → capture token → LOGOUT → capture network trail → verify NO POST/DELETE to any `/api/auth/logout` or `/api/auth/session` endpoint.
- **F-AUTH-06**: LOGIN as user A → add friend → LOGOUT → LOGIN as user B → NAVIGATE Friends screen → SCREENSHOT — verify user A's friend does not appear even for 1 frame.
- **F-GPS-01**: DENY location permission at iOS Simulator level → tap Start Hike → SCREENSHOT — verify a user-facing message with "Open Settings" CTA (currently silent).
- **F-MAP-01**: LOGIN → NAVIGATE MapHistory → tap a hike that has no local route data + server returns empty `route_points` → WAIT for load → SCREENSHOT — verify explicit "Route data unavailable" message.
- **F-MAP-02**: Set network to offline → NAVIGATE MapScreen → tap Offline pill → tap a pack to download → SCREENSHOT after 5s — verify UI shows "Cannot download while offline" not perpetual spinner.
- **F-SES-01**: Start hike → walk simulator ~1km → set network offline mid-hike → tap Stop → set network offline throughout Save → SCREENSHOT StopSummarySheet — verify user is told hike is pending, not that it "saved". Kill app. Cold boot. Verify hike appears in Activities as pending grey card.
- **F-SES-06**: Fresh install → LOGIN → immediately tap Start Hike before memory hydrate completes (race) → walk simulator → tap Stop → SCREENSHOT — verify Memory panel shows new cells (or verify server row had memory_points).
- **F-SYNC-02**: Start hike → tap Stop → set network offline → pending saved → close app (do NOT foreground/background) → wait 5 minutes → open app fresh (cold boot) → SCREENSHOT Home — verify pending sync is retried on hydrate.
- **F-NET-01**: Intercept `/api/sessions/start` and hang the response → tap Start Hike → SCREENSHOT after 30s — verify some user-facing timeout, not silent stuck loading.
- **F-NET-02**: Unset EXPO_PUBLIC_API_BASE_URL, set DNS to fail api.yiiling.cn → open app → tap Sign In → SCREENSHOT — verify "Cannot reach server" message (not white screen or JS error).
- **F-OFF-01**: Set network offline before opening app → open app → NAVIGATE all screens (Home, Hike, Map, Memory, Friends, Settings) → SCREENSHOT each — verify at least ONE persistent visible indicator that user is offline.
- **F-OFF-03**: Create a marker while online → set network offline → tap edit marker → SCREENSHOT — verify Edit button is disabled with "Needs internet" hint (should already exist per code, verify actually renders).
- **F-OTA-02**: Start a mock hike → force an OTA available state → wait for auto-apply → verify recovery modal fires on next open (this is the bad UX — should be blocked or deferred while tracking).
- **F-PUSH-02**: DENY notification permission at iOS Simulator level → let auto-pause fire during a mock hike → verify no notification appears AND user sees a fallback in-app hint (currently silent).
- **F-PERM-02**: DENY location permission with canAskAgain=false → tap Start Hike → SCREENSHOT — verify Open Settings CTA visible.
- **F-I18N-04**: Set device time to 6am → open Home → SCREENSHOT — verify greeting text (currently "Kia ora, Explorer" — Explorer is dead UI mode label).

---

## Notes

Audit spans code visible at OTA O16 (2026-07-28). Findings prioritized by (1) launch risk (App Store rejection), (2) data-loss risk, (3) user-experience gap. Total findings across dimensions: **95+** (5 Blocker, 42 Critical, 40+ Medium, 15+ Inconsistency).

File paths cited are absolute per user instruction:
- `C:\ClaudeCodeProjects\Cairn\app\src\screens\AuthScreen.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\authService.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\apiService.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\sessionService.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\offlineQueue.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\backgroundLocationTask.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\hikeTrackWriter.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\pendingSyncStore.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\syncDaemon.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\offlineMapService.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\autoPauseMonitor.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\services\tokenStore.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\store\useAppStore.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\store\useSessionStore.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\store\useTrackingStore.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\store\useMarkerStore.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\store\useFriendStore.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\store\storage.ts`
- `C:\ClaudeCodeProjects\Cairn\app\src\components\OtaBadge.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\screens\SettingsScreen.tsx`
- `C:\ClaudeCodeProjects\Cairn\app\src\config\api.ts`
