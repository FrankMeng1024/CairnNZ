# Code and runtime evidence index

This is a concise evidence locator, not a source dump. Line numbers are intentionally avoided because the audit is stored alongside an evolving working tree; function/component/model names are the stable anchors.

## Authority and reachability

| Conclusion | Evidence classification | File / anchor | Evidence statement |
|---|---|---|---|
| Home-led stack; no active bottom tabs | **FACT** | `app/src/navigation/RootNavigator.tsx` — `RootStackParamList`, authenticated `Stack.Screen` registrations | Active authenticated navigation registers Home, Hiking, Running, Routes/Trails, details, Plant, Friends, Settings, Memory, and Debug. Comment explicitly restores the Home-stack model. |
| Production vs preview reachability | **FACT / DEV / QA ONLY** | `RootNavigator.tsx` — `__DEV__` registrations | Generated preview/component lab screens are dev-gated; Debug is not. |
| Web QA bridge | **DEV / QA ONLY** | `app/App.tsx`, `RootNavigator.tsx` — `__cairnStores` | Store/navigation/file helpers are exposed only on web for controlled Playwright state. |
| Visual authority | **FACT** | `docs/VISUAL_SYSTEM.md`, `docs/VISUAL_MIGRATION_STATE.md`, `docs/VISUAL_ASSET_MANIFEST.json`, `docs/VISUAL_NORTH_STAR_LOCK.md` | Home three-theme family and canonical assets/tokens/components are the locked visual authority; audit board reused accepted captures. |

## Activity and Hike/Run

| Conclusion | Evidence classification | File / anchor | Evidence statement |
|---|---|---|---|
| Hike/Run share one Activity domain | **FACT** | `app/src/store/useSessionStore.ts` — `TrackingSession`, `ActivityMode`; `backend/src/models/Session.js` | One model stores mode/type rather than separate Hike/Run objects. |
| Live tracking owner | **FACT** | `app/src/store/useTrackingStore.ts` — `startTracking`, `pauseTracking`, `resumeTracking`, `stopTracking` | Shared lifecycle owns both screens, GPS, monitors, processed/raw tracks, finish/save, and recovery state. |
| Derived operational state | **FACT | LOCAL HEAD ONLY** | `app/src/features/activity/activityOperationalState.ts`; Hiking/Running consumers | One pure adapter makes active lifecycle states exclusive. |
| Duplicate Start/Finish guards | **FACT | LOCAL HEAD ONLY** | `useTrackingStore.ts` — `requesting`, `isFinishing`; `app/__tests__/useTrackingStore.test.ts` — `P0 operation guards` | Store boundary locks synchronously; focused tests passed. |
| Unfinished recovery parity | **FACT | LOCAL HEAD ONLY** | `app/src/features/activity/activityRecovery.ts`; Hiking/Running recovery hosts | Shared helper filters exact mode and restores/discards JSONL for both screens. |
| Save-loss recovery | **FACT** | `app/src/features/activity/useActivitySaveLossRecovery.ts`, `useTrackingStore.ts` — SAF-01 fields | Durable Retry/Discard payload is user/mode aware; Running host is local-HEAD P0. |
| Background GPS | **FACT** | `app/src/services/backgroundLocationTask.ts`; `useTrackingStore.ts` location owner setup | Expo task and foreground watcher feed the same tracking owner; app-state switching is explicit. |
| Append-only local recording | **FACT** | `app/src/services/hikeTrackWriter.ts` — start/append/resume/complete/discard APIs | Active JSONL persists mode, identity, points, and recovery metadata. |
| Incremental/offline sync | **FACT** | `app/src/services/sessionService.ts`, `offlineQueue.ts`, `syncDaemon.ts` | Start/append/atomic save plus user-scoped pending retries and idempotency keys. |
| Atomic completion and Memory flush | **FACT** | `useTrackingStore.ts` — `stopTracking`; `flushHikingToMemory.ts`; `backend/src/routes/sessions.js` — `PATCH /:id/save` | Both modes simplify points, finalize the session, and insert Memory points transactionally. |
| Processed vs raw geometry | **FACT** | `useTrackingStore.ts` finish pipeline; `sessions.js` and migration `008_session_raw_points.sql` | Processed/map-matched/smoothed route points and raw audit points persist separately. |
| Completed local history | **FACT** | `useSessionStore.ts` — `addSession`, hydrate/merge, per-session point keys | AsyncStorage summary plus separate track point payload, capped history, remote ID dedupe. |
| Owner-only server history | **FACT** | `backend/src/routes/sessions.js`, `models/Session.js` — list/detail/delete | Authenticated queries scope all rows to `req.user.userId`; unfinished empty shells excluded from normal list. |
| Activity rename local only | **FACT** | `useSessionStore.ts` rename method; MapHistory/Routes Activity actions; no backend update route | UI changes local summary without a server mutation. |
| Activity delete non-transactional | **FACT** | `useSessionStore.ts` / `MapHistoryScreen.tsx` delete path | Local record is removed immediately; remote delete is not a rollback authority. |
| P0 deployment gap | **PRODUCTION FACT** | local git/EAS read-only metadata; `docs/review/activity-p0-reliability/*` | Local HEAD `a9157af` includes P0; production OTA is `6d4a682`, one commit earlier. |

## Routes and the Activity cycle

| Conclusion | Classification | File / anchor | Evidence statement |
|---|---|---|---|
| Route server authority | **FACT** | `app/src/store/useRouteStore.ts` module contract; `routeService.ts`; `backend/src/models/Route.js` | Route library is backend-first with no AsyncStorage persistence. |
| Activity-generated creation | **FACT** | `MapHistoryScreen.tsx` — “Save as Route”; `RouteEditorScreen.tsx` — `fromSessionId` | Active creation starts from Activity Detail and loads that session's trace. |
| No manual/import/duplicate UI | **FACT** | Root/navigation calls and RouteEditor parameter contract | No reachable blank-new/import/duplicate entry was found. |
| Geometry transformation | **FACT** | `RouteEditorScreen.tsx` — session point load, edit/smoothing/save | Editor derives proposed route geometry and recomputes metrics before POST. |
| No source provenance | **FACT** | `routeService.ts` `RoutePayload`; `backend/src/routes/routes.js`, `models/Route.js`, `migrations/005_routes.sql` | No `source_activity_id`/mode origin is accepted or stored. |
| Repeated generation allowed | **FACT** | MapHistory action + route schema | No uniqueness/link constraint; action remains available after prior generation. |
| Independent edit/delete | **FACT** | Route Detail and RouteEditor; routes CRUD | Route changes do not mutate source Activity. |
| Route picker is presentation-only | **FACT** | Hiking/Running `selectedRoute` local state; `useTrackingStore.startTracking` signature; session save payload | Selected ID never enters shared tracking or saved session. |
| Hike only start-pin rendering; Run ignores geometry | **FACT** | Hiking `activeRoute` map source; Running `selectedRoute` uses | Hike derives first point for display; no full route follower; Run uses selection in picker/copy only. |
| `followingRouteId` dormant | **DORMANT / FUTURE** | `useRouteStore.ts` — `followingRouteId`; repository caller search | Setter/consumer is absent from ordinary active screens. |
| Route following dormant | **DORMANT / FUTURE** | `app/src/services/routeFollowing/RouteFollower.ts`, `VoiceGuidance.ts`, `app/src/hooks/useRouteFollowing.ts` | Implementations/tests exist without active hook caller. |
| Route update/delete false success | **FACT** | `routeService.ts` returns `null`/`false`; `useRouteStore.ts` update/delete | Store does not consistently check returned failure before changing local state. |
| Route/session schema link | **FACT / PRODUCTION FACT** | `migrations/005_routes.sql`; production information_schema | Repo declares `fk_session_route`; production has `route_id` column but no FK. |

## Trails and detail family

| Conclusion | Classification | File / anchor | Evidence statement |
|---|---|---|---|
| Trails combines three domains | **FACT** | `app/src/screens/RoutesScreen.tsx` — `SegmentControl`, ActivitiesTab, RoutesTab, FlagsTab | One screen owns Activities, Routes, Cairns; Activity tab is Mine-only; other two support Mine/Friends. |
| Activity history source | **FACT** | `RoutesScreen.tsx` — `ActivitiesTab`; `useSessionStore` | Local/merged completed sessions, mode filters and metrics; incomplete files recover elsewhere. |
| Route search/filter/source | **FACT** | `RoutesScreen.tsx` — `RoutesTab` | Own routes vs `circleRoutes`, search, mode chips, sort. Mode filtering is unreliable because active persistence lacks source mode. |
| Cairn search/filter/source | **FACT** | `RoutesScreen.tsx` — `FlagsTab` | Own vs circle markers, category/permission and recency/distance controls. |
| Friend detail broken | **FACT** | `RoutesScreen.tsx` card navigation; `MapHistoryScreen.tsx` own `routes` lookup; `MarkerDetailScreen.tsx` own `markers` lookup | Friend list IDs are sent to details that only select personal slices. |
| Activity/Route details share MapHistory | **FACT** | `MapHistoryScreen.tsx` — route param branch and session param branch | The component owns both detail families plus a dormant unparameterized index branch. |
| Old combined MapHistory path | **DORMANT / FUTURE / LEGACY COMPETITION** | `MapHistoryScreen.tsx`; navigation caller search | Active callers pass an ID; ordinary history entry is Trails. |

## Cairn, Marker, and Plant

| Conclusion | Classification | File / anchor | Evidence statement |
|---|---|---|---|
| Cairn and Marker are one object | **FACT** | `useMarkerStore.ts` `Marker`; `backend/src/routes/markers.js`; `migrations/003_friends_markers.sql` | UI noun and technical/backend noun map to one ID/table/API. |
| Full Plant entries | **FACT** | Home, Hiking, RoutesScreen navigation calls; `PlantScreen.tsx` | Standalone, Hiking, and Trails empty-state enter one three-step flow. |
| Plant location/content/privacy | **FACT** | `PlantScreen.tsx`; `features/plant/components/*` | GPS sample/pin constraint, category, required title/body, personal/friend visibility. |
| Public client write disabled | **FACT** | Plant content/visibility components; `backend/src/routes/markers.js` validation | Ordinary UI does not offer public; backend rejects client public create/update. |
| Offline-first Cairn create | **FACT** | `useMarkerStore.ts` — `addMarker`; `markerOfflineEntities.ts` | Local entity first; network/5xx retry; 4xx failed state; acknowledgement replaces local ID. |
| Plant inserts Memory point | **FACT** | `useMarkerStore.ts` — `addMarker` direct `VisitedPoint` insertion | Store intentionally bypasses nearby-point culling and pushes a point at marker coordinates. |
| Plant docs/code contradiction | **FACT** | `PlantScreen.tsx` comments around commit vs `useMarkerStore.addMarker` | Screen comments say planting no longer clears Fog; active store does. |
| Running quick Cairn | **FACT** | `RunningScreen.tsx` — `handlePlantCairn` | Creates type `cairn`, personal, blank note at current location; then `linkMarker`. |
| Hiking full Plant lacks link | **FACT** | Hiking Plant navigation and Plant params; marker payload | No session/activity ID is passed or stored. |
| No backend Activity/Route relation | **FACT** | marker model/API/schema | Marker has neither `activity_id` nor `route_id`. |
| Edit/delete reconciliation gap | **FACT** | `useMarkerStore.ts` update/delete; MarkerDetail | Optimistic local mutations have no durable queue/rollback equivalent to create. |
| Delete leaves Memory/Fog | **FACT** | marker delete path vs Memory store/schema | No source link or point deletion call exists. |
| Community/votes | **FACT — PARTIAL** | `migrations/012_marker_community.sql`, marker routes, `CairnPinsLayer.tsx` | Backend status/votes/report capability exists; active input/reveal paths limit ordinary reachability. |

## Memory and Fog

| Conclusion | Classification | File / anchor | Evidence statement |
|---|---|---|---|
| Memory is exploration, not entity | **FACT** | `features/memory/screens/MemoryScreen.tsx`, `useMemoryStore.ts`; schema | No Memory object/table; screen combines point map, Fog, Cairns, friend scope. |
| Personal point authority | **FACT** | `useMemoryStore.ts`, `memorySync.ts`, `backend/src/routes/memory.js` | Local/server merge uses `client_id`; server owns durable rows. |
| No source provenance | **FACT** | `migrations/001_init.sql`/memory migrations; `routes/sessions.js` insert list | Memory points store user/lat/lng/time/client ID only, not Activity/Cairn/source ID. |
| Turf Fog active | **FACT** | `features/memory/components/FogLayer.tsx` | Buffered-path mask uses Turf and caches shapes; file header and implementation are current. |
| H3 derived cache | **FACT** | `features/memory/hooks/useH3Fog.ts`, Memory store/settings | H3 resolution cells derive locally; `useH3Fog` kill switch can suppress layer. |
| Friend Fog owner cache | **FACT** | `MemoryScreen.tsx` — `loadFriendFog`; Memory subscriptions store | Friend responses are cached/grouped before selected collections flatten into map points. |
| Friend subscription relation | **FACT** | `useMemorySubscriptionsStore.ts`; `backend/src/routes/memory-subscriptions.js`; migration `018_friend_system_v4.sql` | Independent viewer→friend relation nominally capped at five. |
| Circle Fog trusts subscriptions | **FACT** | `backend/src/routes/circle.js` — `getSubscribedFriendIds`, `/fog` | Route checks subscription IDs, not current mutual friendship per request. |
| Missing production trigger | **PRODUCTION FACT** | production `information_schema.TRIGGERS`; migration `018_friend_system_v4.sql` | Repo declares authorization/cap trigger; deployed schema returned no triggers. |
| Friend remove leaves subscription | **FACT** | `backend/src/routes/friends.js` remove/block paths; subscription schema | No subscription delete is part of either mutation. |
| Memory marker omission | **FACT** | `MemoryScreen.tsx` marker props; `MemoryMap.tsx` | Active map receives personal markers and public nearby markers, not `circleMarkers`. |
| Mystery reveal | **FACT** | `CairnPinsLayer.tsx`, `MysteryCairnSheet.tsx` | Owner always revealed; other markers use personal/friend explored proximity and distance tiers. |
| Home metric proxy | **FACT** | `HomeScreen.tsx` exploration calculation | `points.length * 0.000541` divided by hard-coded region area; no unique cell union. |

## Friends and sharing

| Conclusion | Classification | File / anchor | Evidence statement |
|---|---|---|---|
| Request lifecycle | **FACT** | `useFriendStore.ts`, `FriendsScreen.tsx`, `backend/src/routes/friends.js` | Send, receive, accept, reject/decline, cancel, and cooldown paths are active. |
| Friendship representation | **FACT** | friends route/migration `018_friend_system_v4.sql` | Acceptance creates mutual directional rows; circle queries test mutuality. |
| Remove/block consequences | **FACT** | `friends.js` remove/block handlers | Friendship is removed and pending requests handled; domain objects are not deleted; Memory subscription is untouched. |
| Friend Routes/Cairns authorization | **FACT** | `backend/src/routes/circle.js` — route/marker queries | Mutual friendship gates friend-tier rows; Activities have no corresponding query. |
| Stale cross-domain caches | **FACT** | `useFriendStore.ts` mutations vs route/marker/memory stores | Friends mutation updates its own store only; no coordinated circle cache invalidation. |

## Settings, subscriptions, notifications

| Conclusion | Classification | File / anchor | Evidence statement |
|---|---|---|---|
| Settings defaults/storage | **FACT** | `useSettingsStore.ts` — `DEFAULTS`, `cairn_settings`; `useMemorySettingsStore.ts` | Exact local defaults and validation/migration logic. |
| Appearance/units/haptics active | **FACT** | Settings controls plus repository consumer search | Active format/theme/haptic consumers exist. |
| Memory GPS copy mismatch | **FACT** | `useMemorySettingsStore.ts`; App foreground unlock manager; Memory point mutation search | Setting controls foreground watcher but no automatic point write/unlock. |
| Hidden Debug unlock | **FACT — DEBUG ONLY** | `SettingsScreen.tsx` — About tap counter; `RootNavigator.tsx` Debug registration | Five taps enable debug mode; screen ships outside `__DEV__`. |
| Notifications hard-disabled | **DORMANT / FUTURE** | `SettingsScreen.tsx` — `false && pushPrefs`; `useAppStore.ts` commented registration; friend route comments | UI and event registration/enqueue are disabled while backend infrastructure remains. |
| RevenueCat implementation | **FACT — PARTIAL** | `iapService.ts`, `features/memory/components/PaywallSheet.tsx`, entitlement store | Purchase/restore/cache exists; product IDs/offerings come from external dashboard. |
| Paywall/server gap | **FACT** | Memory sixth-selection logic; `/memory-subscriptions`; `users.memory_subscription_limit` | Entitlement callback does not update server cap; paid user can still hit five-row authority. |
| Local feature flags | **FACT** | `app/src/config/featureFlags.ts` | Static defaults and optional local override; no active remote rollout fetch. |

## Auth, account, jobs, and production

| Conclusion | Classification | File / anchor | Evidence statement |
|---|---|---|---|
| Auth lifecycle | **FACT** | `app/src/services/authService.ts`, Auth screen; `backend/src/routes/auth.js`, `models/User.js` | Register/verify/login/social/reset/refresh/profile/delete/restore paths. |
| Logout clearing | **FACT** | `useAppStore.ts` — `logout` | Clears local user/session/marker/Memory/SAF slices, detaches Memory sync, sets logout marker, resets purchases. |
| Soft/hard deletion | **FACT** | `routes/auth.js` DELETE/restore; `models/User.js` hard delete; `cron/authSweep.js` | Soft delete followed by deadline-bound restore or FK-driven hard delete. |
| Five-minute deployed grace | **PRODUCTION FACT** | deployed `auth.js` hash/content and active cron topology | Explicit TEST-MODE constant/cadence is current production behavior. |
| Account cascade drift | **PRODUCTION FACT** | production information_schema referential constraints | Core FKs exist broadly, but `unlocked_regions` user FK and session Route FK are absent. |
| Background server jobs | **FACT / PRODUCTION FACT** | `backend/src/index.js`, `cron/authSweep.js`, `pushDrain.js`, `exportWorker.js`, `cleanHiddenItemsOrphans.js` | Auth/push every minute, export builder every two minutes, daily purges, weekly hidden cleanup, boot catch-up. |
| Password-reset observability | **LOCAL CANDIDATE** | uncommitted `migrations/033_password_reset_email_events.sql`, model/tests, auth/email diff | New delivery-event recording is not in HEAD or production; password reset itself predates it. |
| Production topology/version | **PRODUCTION FACT** | read-only SSH git/docker/health inspection; EAS branch metadata | Host checkout, container artifact, and OTA are different realities; backend container is healthy and mixed-version. |

## Documentation ↔ code contradictions

| Documentation/copy claim | Current code/runtime result | Classification |
|---|---|---|
| Activity P0 documents describe final intended local behavior | Production OTA predates the P0 commit | **FACT vs PRODUCTION FACT** |
| Plant comments say planting no longer unlocks Fog | Marker store inserts a Memory point for every creation | **FACT — contradiction** |
| Cairn deletion copy implies removal from Memory | delete path leaves Memory point/Fog | **FACT — contradiction** |
| Route-store comments say selected Route is set for navigation | no active screen calls setter; selection stays local | **DORMANT / FUTURE presented as comment intent** |
| Route run-count comments imply completions increment it | current client caller was removed | **FACT — dormant field** |
| Settings says Memory GPS fills map while app is open | watcher does not mutate Memory | **FACT — misleading copy** |
| Paywall implies unlimited Fog/sharing | server cap remains five and no entitlement reconciliation exists | **FACT — capability mismatch** |
| Account code comments call seven days the production target | deployed constant is five minutes TEST-MODE | **PRODUCTION FACT — contradiction** |
| Migration declares Memory subscription/FK authority | deployed trigger and selected FKs are absent | **PRODUCTION FACT — schema drift** |

## Validation evidence

- **FACT:** Expo Web mounted active product code at 390×844. A fresh Plant capture and accepted current Home/Trails/Hike/Run/Memory/Settings captures were assembled into `global-product-surface-board.jpg`.
- **FACT:** focused Activity operational-state and contract suites passed; P0 guard-only tests passed.
- **FACT:** the broader selected Activity test command had 24 passes and one pre-existing timestamp-dedupe failure (expected 54, received 14).
- **FACT:** full TypeScript `--noEmit` failed on extensive pre-existing errors across generated previews, test imports, icon names, Turf declarations, Settings nullability, and stale tests. It is not a clean repository-wide gate.
- **PRODUCTION FACT:** SSH, git metadata, Docker metadata, health check, source hashes, `information_schema` columns/constraints/triggers, and EAS update metadata were read only. No product endpoints that mutate state were called.
