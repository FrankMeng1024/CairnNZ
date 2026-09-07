# Free Activity code evidence

Concise evidence ledger for material findings. Line numbers are intentionally omitted because the active files are changing rapidly; symbols and unique behaviors are supplied.

## Entry and reachability

| Conclusion | File / symbol | Evidence |
|---|---|---|
| Home directly enters Hike and Run | `app/src/screens/home_generated/HomeScreen.generated.tsx` / Home action row | Active Hike and Run buttons call `nav.navigate('Hiking')` and `nav.navigate('Running')`. |
| Hike/Run accept no start parameters | `app/src/navigation/RootNavigator.tsx` / `RootStackParamList` | `Hiking: undefined`, `Running: undefined`; `Plant: undefined`; Activity Detail uses `MapHistory` with `sessionId`. |
| Home also exposes unfinished recovery entry | `app/src/screens/HomeScreen.tsx` / `topUnfinished`, `onLastHikePress` | Reads writer metadata on focus and routes the newest unfinished item to its mode screen. |

## Free context and ready state

| Conclusion | File / symbol | Evidence |
|---|---|---|
| Free equals no selected Route | `HikingScreen.tsx`, `RunningScreen.tsx` / `selectedRoute` | Both initialize `useState<string | null>(null)` and show Free rows when null. |
| Route selection is not recording provenance | same screens / `pickRoute`, `handleStart` | Selection remains screen-local. `startTracking` accepts no Route ID. Run never uses selected geometry; Hike only derives `routeStart`. |
| Dormant following state is disconnected | `app/src/store/useRouteStore.ts` / `followingRouteId`; `app/src/hooks/useRouteFollowing.ts` | Store/hook exist, but active Hike/Run never call `setFollowingRoute` or mount the hook. |
| Zero metrics are presentation only | ready JSX in both screens; `useTrackingStore.ts` | Ready rows render zero values; tracking calculations and lifecycle live independently in the store. |
| Map and location readiness are separate | `HikingMap.tsx` / `mapFirstRender`, `isOffline`; `RunningScreen.tsx` / `mapLoadState`, `foregroundGranted`, `permissionBlocked` | Each screen has distinct map and location state, though current ready copy/colors are inconsistent. |

## Shared Activity model and lifecycle

| Conclusion | File / symbol | Evidence |
|---|---|---|
| Hike and Run are modes of one Activity | `useTrackingStore.ts` / `activityMode`; `useSessionStore.ts` / `ActivityMode`; `backend/src/migrations/002_sessions.sql` | One session model uses hiking/running enum. |
| One stable local ID exists at Start | `useTrackingStore.ts` / `startTracking` | Generates `localSessionId`, sets status `requesting`, keys the writer, and later uses it as completed local Activity ID. |
| Server ID is asynchronous/optional | `useTrackingStore.ts` / `startSession(...).then` | Numeric `remoteSessionId` arrives later; failure is non-fatal and offline finish queues the payload. |
| Start/Finish are idempotently guarded | `useTrackingStore.ts` / `startTracking`, `stopTracking` | Rejects non-idle/double Start and idle/already-finishing Finish at the store boundary. |
| Operational states are exclusive | `app/src/features/activity/activityOperationalState.ts` | Pure derivation makes Finishing dominant and retains Paused as session-visible/finishable. |
| P0 contract tests pass | `app/src/features/activity/__tests__/activityOperationalState.test.ts`; `app/src/screens/__tests__/activityP0Contract.test.ts` | 13 tests passed on 2026-09-06, including state exclusivity, guards, recovery host, no keep-awake, and Mapbox attribution. |

## Metrics

| Conclusion | File / symbol | Evidence |
|---|---|---|
| Both modes record time/distance/elevation | `useTrackingStore.ts` / timer and accepted-point updates | Same point path computes raw distance and positive altitude deltas without a Run exclusion. |
| Pace is derived, not stored | `RunningScreen.tsx` / `paceDisplay` | Computes seconds per km/mile from shared duration and distance; shows `--` below 10m/no location. |
| Hike-only speed policy is intentional domain logic | `useTrackingStore.ts` / hiking overspeed gate | Sustained over-speed filtering/banner applies only to `activityMode === 'hiking'`; Run can legitimately be faster. |
| Units are shared | `app/src/utils/distanceFormat.ts` / `useDistance` | Metric/imperial preference supplies distance/elevation formatting; Run uses it for pace unit. |

## Map interaction

| Conclusion | File / symbol | Evidence |
|---|---|---|
| Hike is interactive follow/recenter | `HikingMap.tsx`; `HikingScreen.tsx` / `followUser`, `onUserGesture`, `recenterImperativeRef` | Gestures re-enable after fly-in; active user gesture releases follow; Recenter uses current store coordinate and zoom 15. |
| Hike currently enables rotate and pitch too | `HikingMap.tsx` / MapView gesture props | Scroll, zoom, rotate, and pitch all use `gesturesEnabled`. |
| Run active map is follow-first/non-interactive | `RunningScreen.tsx` / active MapView | Parent has `pointerEvents="none"`; scroll/zoom/rotate/pitch are false; Camera follows at zoom 16. |
| Run remount applies to ready map | `RunningScreen.tsx` / `mapEpoch`, pre-start MapView key | Focus increments key to replay ready-map fly-in. This is implementation behavior, not product authority. |
| Hike honors map layer; Run does not | `HikingMap.tsx` / `mapLayer`; `RunningScreen.tsx` / `getMapStyleForTheme('outdoors', ...)` | Same hidden setting has different consumers. |

## Completion and Activity Detail

| Conclusion | File / symbol | Evidence |
|---|---|---|
| Hike freezes before confirmation | `HikingScreen.tsx` / Finish handler | Calls `pauseTracking`, snapshots values, opens `StopSummarySheet`. Cancel calls Resume. |
| Run does not freeze before naming | `RunningScreen.tsx` / Finish handler, `openSaveSheet` | Valid Finish directly opens name sheet; `handleStop` runs only after Save. |
| Run can falsely show Complete after too-short discard | `RunningScreen.tsx` / `TooShortSheet.onDiscard` | Discards, nulls `stoppedSessionId`, then sets `runState('stopped')`; stopped screen renders and View Activity falls Home. |
| Hike standard destination is already detail | `HikingScreen.tsx` / `saveHikeAndNav` | Captures local ID and resets stack Home → Routes(Activities) → MapHistory(sessionId). |
| Run has an intermediate completion page | `RunningScreen.tsx` / stopped branch | Shows Run Complete, Share, View Activity, and Done after stop. |
| Detail can open pending/local Activities | `MapHistoryScreen.tsx` / target selection and track loading | Selects `useSessionStore` by local ID; tries server when `remoteId` exists, then falls back to `loadTrackPoints(localId)` when remote data is absent/short/timed out. |
| Detail supports both modes but not Run pace | `MapHistoryScreen.tsx` / single-session panel | Shows mode icon/name and distance/time/elevation for Hike or Run; no pace field/presentation. |
| Detail Cairns are proximity-derived | `MapHistoryScreen.tsx` / `routeFlags`, `NEARBY_FLAG_RADIUS_M` | Finds all personal markers within 80m of any trace point, not exact Activity association. |
| Save as Route is already present | `MapHistoryScreen.tsx` / action pill | Enabled for at least two loaded points and navigates to RouteEditor with local points. |
| Save as Route is online-only | `useRouteStore.ts` / `addRoute`; `routeService.ts` / `createRoute` | Backend-first store has no local Route persistence/pending create queue. |

## Cairn, identity, and Memory

| Conclusion | File / symbol | Evidence |
|---|---|---|
| Hike uses Full Plant | `HikingScreen.tsx` / Cairn action | Navigates to `Plant` without pausing or passing session data. |
| Plant is three-step and offline-first | `PlantScreen.tsx` / `GpsLockStep`, `PinAdjustStep`, `ContentStep`, `commit` | Samples GPS, adjusts pin, collects content/privacy, calls `addMarker`, preserves failed draft, opens Marker Detail on success. |
| Run quick-plants the same Marker object | `RunningScreen.tsx` / `handlePlantCairn` | Creates type `cairn`, personal, empty note, current coordinate, and local `sessionId`; then `linkMarker`. |
| Marker association is local only | `useMarkerStore.ts` / `Marker.sessionId`, `addMarker` payload; marker schema/routes | Local Marker accepts `sessionId`, but offline/API payload and backend table omit it. |
| Marker acknowledgement changes ID | `useMarkerStore.ts` / `setMarkerCreateAckHandler` | Replaces `id` with server ID and retains `localId`; no code updates completed/live Activity `markerIds`. |
| All Marker creation currently adds Memory | `useMarkerStore.ts` / `addMarker` Memory block | Directly appends a Memory point and H3 visit for every call. |
| Plant comments contradict shared behavior | `PlantScreen.tsx` / `commit` comments | Says Plant unlock was removed, but calls the shared `addMarker` that still unlocks. |
| Activity Memory flush happens at Finish | `useTrackingStore.ts` / `flushHikingToMemory` | No live walking write; valid stop flushes smoothed/snapped-or-fallback trace and includes unsynced Memory in atomic/pending payload. |
| Deletes do not reverse Memory | `useSessionStore.ts` / `deleteSession`; `useMarkerStore.ts` / `deleteMarker` | Neither delete path touches Memory/H3 stores or server memory points. |
| Backend Marker lacks Activity FK | `backend/src/migrations/003_friends_markers.sql`; later Marker migrations | Marker belongs to user and has type/text/location/privacy; no Activity/session column or relation. |

## Recovery, background, and settings

| Conclusion | File / symbol | Evidence |
|---|---|---|
| No unconditional keep-awake | Hike/Run source; P0 source contract test | Neither active screen imports/calls `useKeepAwake`. |
| Both modes share background tracking | `useTrackingStore.ts`; `backgroundLocationTask.ts` | AppState switches foreground watcher/background task; writer persists both activity modes. |
| Background permission is best-effort | `useTrackingStore.ts` / start permission block | Foreground permission is required; denied background permission permits foreground recording but no background updates. |
| Background education is mode-wrong for Run | same block / `Alert.alert` | Shared copy says “recording your hike” even when mode is running. |
| Running uses shared P0 save-loss host | `RunningScreen.tsx` / `useActivitySaveLossRecovery('running')` | Mode-aware Alert with durable retry state. |
| Hiking still duplicates legacy save-loss logic | `HikingScreen.tsx` / two save-loss effects | Own mount and AppState Alerts/retry logic; does not use shared hook. |
| Recovery modal is shared; discovery differs | `UnfinishedRecoveryModal.tsx`; `activityRecovery.ts`; both screens | Both offer Continue/Discard. Run uses `findRecoverableActivity`; Hike includes additional remote-shell/stale-local logic. |
| Relevant Settings are local | `useSettingsStore.ts`, `useMemorySettingsStore.ts` | Appearance/units/date/haptics/map layer/debug stored device-side; OS owns location grants. |

## Scope validation

- Relevant in-scope files have no working-tree diff against HEAD.
- Production inspection was unnecessary: this question concerns current local architecture, and no material in-scope schema/code difference required deployment verification.
- No runtime mutation, API mutation, production access, migration, or app build was performed.
