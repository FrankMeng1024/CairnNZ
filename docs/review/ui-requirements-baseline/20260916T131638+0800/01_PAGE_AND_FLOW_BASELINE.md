# Page and action-flow baseline

This report describes current source and bounded runtime evidence. A forced route is never counted as normal reachability. Destructive actions were source-traced but not invoked.

## Reachability headline

- **All Cairns:** `UNREACHABLE` / missing. Own marker storage and old forced `initialTab: flags` scripts do not constitute a page.
- **Non-owner Cairn Detail:** `UNREACHABLE` for a normal user. Forms/services are source-present, but Memory supplies own markers only, circle markers are disconnected, and public pins are unpressable.
- **Own Cairn Detail:** `NORMAL_USER` after successful full Plant and from own-marker surfaces.
- **Activity Detail and Route Detail:** `NORMAL_USER` from Trails; Activity Detail also follows successful Finish.

## Hike

1. **Primary job:** Record a hiking Activity truthfully.
2. **Secondary job:** Choose/show a Route reference, place a full Cairn, recover unfinished work.
3. **Owns:** ACT-01, RQ-ACT-003, RQ-ACT-004, RQ-MAP-001
4. **Must not own:** Route provenance decisions; Memory friend authorization; Final acceptance of Activity Detail
5. **Current maturity:** SOURCE_MATURE / NATIVE_AND_USER_ACCEPTANCE_UNVERIFIED
6. **Important gaps:** Native map/theme proof; Current field recovery proof; Too-short paused Continue inconsistency; Expo Web 320×568 capture clips top/bottom chrome
7. **Future direction:** Review current candidate first; preserve shared lifecycle.

- Components: `app/src/screens/HikingScreen.tsx`, `app/src/screens/HikingMap.tsx`, `app/src/components/activity/ActivityRecordingChrome.tsx`
- Normal path: Home → Hiking
- Entry class: `NORMAL_USER`
- Incoming IDs: optional routeId
- Stores/APIs: useTrackingStore, useRouteStore, /api/sessions, /api/markers
- Gates: Simulator/debug capability is separate and build gated
- Theme: useVisualTheme/useScenicTimeState
- Tests: activity operational/route/UI contract suites
- Image evidence: VIS-001, VIS-002, VIS-005, VIS-006, VIS-009, VIS-010, VIS-040

## Run

1. **Primary job:** Record a running Activity with trustworthy pace/distance/time.
2. **Secondary job:** Choose/show a Route reference and create Quick Cairn.
3. **Owns:** ACT-02, RQ-CAIRN-002, RQ-MAP-001
4. **Must not own:** All Cairns retrieval; Active following unless explicitly wired; Public sharing policy
5. **Current maturity:** SOURCE_MATURE / NATIVE_AND_USER_ACCEPTANCE_UNVERIFIED
6. **Important gaps:** Startup pace/current field proof; Native themes/legal-control proof; Quick Cairn later retrieval
7. **Future direction:** Review current candidate first; preserve shared lifecycle.

- Components: `app/src/screens/RunningScreen.tsx`, `app/src/screens/HikingMap.tsx`, `app/src/components/activity/ActivityRecordingChrome.tsx`
- Normal path: Home → Running
- Entry class: `NORMAL_USER`
- Incoming IDs: optional routeId
- Stores/APIs: useTrackingStore, useMarkerStore, useRouteStore, /api/sessions, /api/markers
- Gates: Simulator/debug capability is separate and build gated
- Theme: useVisualTheme/useScenicTimeState
- Tests: activity operational/route/UI contract suites
- Image evidence: VIS-003, VIS-004, VIS-007, VIS-008, VIS-011, VIS-012, HIST-001

## Trails

1. **Primary job:** Personal Activities/Routes library.
2. **Secondary job:** Search/filter loaded objects and open their Details.
3. **Owns:** ACT-03, ROUTE-01, RQ-TRAIL-001
4. **Must not own:** Equal Cairns tab; Mine/Friends tier; Friend Route contract without approval
5. **Current maturity:** INTEGRATED_LIST / COMPLETENESS_AND_ACCEPTANCE_PARTIAL
6. **Important gaps:** Search/pagination covers loaded subset only; No All Cairns; Downstream details not accepted
7. **Future direction:** Keep accepted Activities/Routes IA; revisit integration after Detail slices.

- Components: `app/src/screens/RoutesScreen.tsx`
- Normal path: Home → Trails; MapHistory without ID redirects → Trails
- Entry class: `NORMAL_USER`
- Incoming IDs: initialTab activities|routes
- Stores/APIs: useSessionStore, useRouteStore, /api/sessions, /api/routes
- Gates: none
- Theme: useVisualTheme
- Tests: trailsLibrary; trailsScreenContracts
- Image evidence: VIS-013, VIS-014, VIS-015, VIS-016, VIS-017, VIS-018

## Activity Detail

1. **Primary job:** Review one finalized Activity and its truth/sync/Route state.
2. **Secondary job:** Rename/delete and Save as Route.
3. **Owns:** ACT-03, ROUTE-02
4. **Must not own:** All Cairns; Route planning provenance; Automatic refinement without worker
5. **Current maturity:** NORMALLY_REACHABLE / PARTIAL_DNA / NOT_ACCEPTED
6. **Important gaps:** Web fallback only in audit; Native detail proof; Durable refinement truth
7. **Future direction:** Next page after Hike/Run review.

- Components: `app/src/screens/MapHistoryScreen.tsx (object branch)`
- Normal path: Hike/Run Finish → MapHistory(sessionId); Trails Activity row → MapHistory(sessionId)
- Entry class: `NORMAL_USER`
- Incoming IDs: sessionId/clientActivityId
- Stores/APIs: useSessionStore, useMarkerStore, useRouteStore, /api/sessions/:id
- Gates: none
- Theme: useVisualTheme
- Tests: activityRouteState; completed Activity/source contract tests
- Image evidence: VIS-019, VIS-026, VIS-033

## Route Detail

1. **Primary job:** Review one saved Route and choose Edit/Use.
2. **Secondary job:** Rename/delete Route.
3. **Owns:** ROUTE-01, ROUTE-04
4. **Must not own:** Claim active following when only reference line exists; Rewrite source Activity
5. **Current maturity:** NORMALLY_REACHABLE / ERROR_HANDLING_PARTIAL / NOT_ACCEPTED
6. **Important gaps:** Layers no-op; Rename/delete failure feedback; Unknown ID loading/not-found; Native renderer proof
7. **Future direction:** Review with Editor and Use journey after Own Cairn/All Cairns slice.

- Components: `app/src/screens/MapHistoryScreen.tsx (route object branch)`
- Normal path: Trails Route row → MapHistory(routeId)
- Entry class: `NORMAL_USER`
- Incoming IDs: routeId
- Stores/APIs: useRouteStore, /api/routes/:id
- Gates: none
- Theme: useVisualTheme
- Tests: route store/offline and UI source contracts
- Image evidence: VIS-020, VIS-027, VIS-034

## Route Editor

1. **Primary job:** Edit and save a Route draft.
2. **Secondary job:** Create Route from Activity and change personal/friend visibility.
3. **Owns:** ROUTE-02, RQ-ROUTE-005, RQ-ROUTE-006
4. **Must not own:** Mutate source Activity; Claim server provenance that is local only
5. **Current maturity:** NORMALLY_REACHABLE / WEB_MAP_FALLBACK / PARTIAL_FAILURE_HANDLING
6. **Important gaps:** Gear no-op; Delete failure catch; Post-create landing mismatch; Server provenance loss
7. **Future direction:** Bounded Route Detail/Editor/Use slice.

- Components: `app/src/screens/RouteEditorScreen.tsx`, `app/src/store/useRouteEditStore.ts`
- Normal path: Route Detail → Edit; Activity Detail → Save as Route
- Entry class: `NORMAL_USER`
- Incoming IDs: routeId, sourceActivityId/draft ID
- Stores/APIs: useRouteStore, useRouteEditStore, /api/routes
- Gates: editModeEnabled; debug QA telemetry branch
- Theme: useVisualTheme
- Tests: route edit/store/offline tests
- Image evidence: VIS-021, VIS-028, VIS-035

## Plant / Quick Cairn

1. **Primary job:** Create a durable Cairn from a trustworthy location.
2. **Secondary job:** Optionally add title/body/voice/visibility; link to active Activity.
3. **Owns:** CAIRN-01, RQ-CAIRN-001, RQ-CAIRN-002
4. **Must not own:** All Cairns retrieval; Public moderation policy
5. **Current maturity:** FULL_PLANT_REACHABLE / QUICK_ACTION_REACHABLE / DEVICE_DURABILITY_UNVERIFIED
6. **Important gaps:** Title-in-note schema debt; Quick Cairn retrieval after creation; No current reconnect device proof
7. **Future direction:** Preserve current creation; converge on canonical Detail/retrieval.

- Components: `app/src/screens/PlantScreen.tsx`, `app/src/screens/RunningScreen.tsx`
- Normal path: Home → Plant; Hike → Cairn → Plant; Run → Cairn (Quick)
- Entry class: `NORMAL_USER`
- Incoming IDs: active tracking session implied
- Stores/APIs: useMarkerStore, useTrackingStore, offlineMarkers, /api/markers
- Gates: Public option hidden
- Theme: useVisualTheme
- Tests: plantTitleBody; marker fast-ack/tombstone contracts
- Image evidence: VIS-022, VIS-029, VIS-036

## Own Cairn Detail

1. **Primary job:** Review/edit/delete one own Cairn.
2. **Secondary job:** Show origin/time/permission/map.
3. **Owns:** CAIRN-02, RQ-CAIRN-004, RQ-CAIRN-005
4. **Must not own:** Non-owner moderation without reachable identity; All Cairns index
5. **Current maturity:** REACHABLE_AFTER_FULL_PLANT / PARTIAL_DNA / NOT_ACCEPTED
6. **Important gaps:** No normal personal index; Native map/device proof; Potential exact-coordinate presentation
7. **Future direction:** Review with All Cairns product decision.

- Components: `app/src/screens/MarkerDetailScreen.tsx`
- Normal path: Successful full Plant → MarkerDetail(markerId); Own marker sheet → full Detail
- Entry class: `NORMAL_USER`
- Incoming IDs: markerId/localId
- Stores/APIs: useMarkerStore, /api/markers/:id
- Gates: owner and sync state controls edit/delete availability
- Theme: useVisualTheme
- Tests: marker tombstone/fast-ack tests
- Image evidence: VIS-023, VIS-030, VIS-037

## Non-owner Cairn Detail

1. **Primary job:** Future safe friend/public Cairn review and explicit interactions.
2. **Secondary job:** Like/report/hide/Thanks under approved privacy semantics.
3. **Owns:** CAIRN-04, CAIRN-05
4. **Must not own:** Implicit encounter inference; Visitor location disclosure
5. **Current maturity:** SOURCE_COMPONENTS_ONLY / NORMAL_ENTRY_UNREACHABLE
6. **Important gaps:** circleMarkers disconnected; public markers unpressable; full screen resolves own store only; hide no-op
7. **Future direction:** Do not build until authorization/privacy/moderation decisions.

- Components: `app/src/features/memory/components/CairnPinsLayer.tsx`, `MarkDetailSheet components`, `app/src/screens/MarkerDetailScreen.tsx`
- Normal path: none
- Entry class: `UNREACHABLE`
- Incoming IDs: No normal supported non-owner ID path
- Stores/APIs: circleMarkers/publicMarkers, markerInteractionService
- Gates: public pins deliberately unpressable
- Theme: useVisualTheme
- Tests: lower-layer interaction tests only
- Image evidence: none

## All Cairns

1. **Primary job:** Future personal Cairn retrieval/index.
2. **Secondary job:** Recency/search/reopen/edit/delete boundaries.
3. **Owns:** CAIRN-03
4. **Must not own:** Reopen accepted Trails IA without decision
5. **Current maturity:** MISSING
6. **Important gaps:** No screen; No normal entry; No visual evidence
7. **Future direction:** Needs product decision; do not fabricate/build in audit.

- Components: none
- Normal path: none
- Entry class: `UNREACHABLE`
- Incoming IDs: none
- Stores/APIs: Lower-level own marker cache/API only
- Gates: none
- Theme: none
- Tests: none
- Image evidence: none

## Memory

1. **Primary job:** View personal explored evidence.
2. **Secondary job:** Switch friend display scope, choose friends, revisit own Cairns, inspect place hierarchy.
3. **Owns:** MEM-01, MEM-02, MEM-04
4. **Must not own:** Count friend fog as personal; Infer Encounter; Bypass owner grant
5. **Current maturity:** NORMAL_ENTRY / FEATURE_RICH_SOURCE / DIVERGENT_VISUAL_AND_SECURITY_BOUNDARY
6. **Important gaps:** Known friend auth P0; circle markers disconnected; Web loading/runtime error; Final visual language open
7. **Future direction:** Personal Memory page slice before Friends sharing layer.

- Components: `app/src/features/memory/screens/MemoryScreen.tsx`, `MemoryMap.tsx`, `FogLayer.tsx`
- Normal path: Home → Memory
- Entry class: `NORMAL_USER`
- Incoming IDs: none
- Stores/APIs: useMemoryStore, useFriendMemoryStore, useMemorySubscriptionsStore, /api/memory/points, /api/circle/fog
- Gates: paid friend selection cap; foreground exploration setting
- Theme: useVisualTheme plus map adapter
- Tests: memory evidence/settings/sync tests
- Image evidence: VIS-024, VIS-031, VIS-038

## Settings

1. **Primary job:** Manage account, preferences, privacy/data, and help/about.
2. **Secondary job:** Expose version/build and destructive account/data contracts.
3. **Owns:** MEM-03, SET-01, SET-02, SET-03
4. **Must not own:** Internal Debug in normal production UI; Claim backend contracts not deployed
5. **Current maturity:** STRONG_SOURCE_DNA / DEPLOYMENT_CONTRACT_MISMATCH
6. **Important gaps:** Feedback endpoint absent in production; Deletion timing mismatch; Export content/version mismatch; No update ID
7. **Future direction:** Preserve UI; separate release-contract containment.

- Components: `app/src/screens/SettingsScreen.tsx`
- Normal path: Home → Settings
- Entry class: `NORMAL_USER`
- Incoming IDs: none
- Stores/APIs: useSettingsStore, authService, /api/auth/me, /api/account/*, /api/memory/*
- Gates: Debug intentionally not exposed
- Theme: useVisualTheme/useScenicTimeState
- Tests: settingsProductConvergence; settingsServerActions
- Image evidence: VIS-025, VIS-032, VIS-039, VIS-041

## Home / Friends / Auth references

1. **Primary job:** Provide accepted navigation and visual-family anchors.
2. **Secondary job:** Regression reference for shared changes.
3. **Owns:** AUTH-01, FRI-01
4. **Must not own:** This audit’s unresolved detail-page decisions
5. **Current maturity:** BOUNDED_ACCEPTED_REFERENCE
6. **Important gaps:** Not re-audited comprehensively
7. **Future direction:** Keep no change; regression-check shared dependencies.

- Components: `HomeScreen`, `FriendsScreen`, `AuthScreen`
- Normal path: Auth gate; Home actions
- Entry class: `NORMAL_USER`
- Incoming IDs: none
- Stores/APIs: useAppStore, useFriendStore
- Gates: Auth gate
- Theme: canonical visual family
- Tests: existing visual authority artifacts
- Image evidence: REF-001


# Action trace

### Hike/Run

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Ready screen Start | location available; optional Route selection → startTracking with single-flight/epoch guards | idle→starting→tracking and WAL/session ownership; local journal plus session API/outbox | transition/status and errors in recording chrome; same recording page | Native/field behavior unverified. |
| Pause / Resume | tracking / paused → pauseTracking / resumeTracking | lifecycle and timers/location work; tracking journal/context | button/status/transition labels; same page | Rapid Resume protected in source/tests; physical recovery unknown. |
| Finish | tracking/paused/recovering; eligibility varies → open intent snapshot; confirm later stopTracking | none until confirm; then finalizes Activity; local completed Activity and server sync | confirmation/too-short sheet and failure states; Activity Detail on success | Too-short Continue resumes paused state. |
| Finish sheet Cancel | intent open → dismiss sheet | restores prior captured lifecycle; none | returns to prior chrome; same page | Regular path covered; current device unverified. |

### Hike

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Cairn | fresh accepted Activity fix → navigate Plant | none until Plant Cairn; Plant outbox only on confirmation | compose screen; returns to Activity after successful create | Audit did not confirm create. |

### Run

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Cairn | fresh accepted fix ≤30s → addMarker + linkMarker | creates private empty Cairn linked to Activity; durable local entity/outbox | success/error toast; same Run page | No immediate Detail/retrieval path. |

### Trails

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Activities / Routes tabs | always → local tab state | view only; none | segmented selected state; same page | Accepted IA; no Cairns tab. |
| Search/filter | loaded arrays → client filter/mode selection | view only; none | filtered list/no results; same page | Loaded subset only; no pagination proof. |
| Activity/Route row | row present → navigate MapHistory with sessionId/routeId | navigation; none | Detail page; canonical current MapHistory branch | Normal reachability YES. |

### Activity Detail

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Rename | own Activity → await update with feedback | Activity name; local/server according to store | error retained; same detail | Device/deployed proof partial. |
| Delete | own Activity and confirmation → await delete | removes Activity; local/server | failure remains; success resets Trails; Trails | Not invoked in audit. |
| Save as Route / Review route | route readiness state → create transient editor draft | new Route draft only; not server until outer Save | Route Editor; Route Editor | Successful new Save remains in editor view, not canonical Route Detail. |

### Route Detail

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Layers | visible → none/TODO | none; none | none; same page | Visible UI without handler. |
| Rename | own Route → updateRoute invoked without await/catch | optimistic/store mutation; route store/API | no screen-level failure feedback; same detail | Swallowed/unrepresented failure. |
| Delete | second tap confirmation → deleteRoute fired, then goBack immediately | store/API deletion or rollback; route store/API | no failure feedback after navigation; back immediately | Async failure hidden. |
| Use for a Hike/Run | Route present; detail loaded if necessary → navigate Hike/Run with routeId | pre-start reference selection; none beyond store availability | Route selected · shown on the map for guidance; Hike/Run pre-start | Does not call setFollowingRoute; not active following. |

### Route Editor

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Edit / inner Save / Cancel | existing/draft Route → useRouteEditStore session | in-memory/persisted local edit draft; draft session; outer Save required for Route | edit overlays/warnings; view mode or prior screen | Web map unavailable; native proof missing. |
| Outer Save | name and valid points → create/update Route | durable local outbox/server Route; route cache/outbox/API | saving/alert errors; existing goes back; new resets Home→RouteEditor(view) | New Route landing diverges from canonical Detail. |
| Gear | edit mode → empty TODO callback | none; none | none; same page | Visible no-op. |

### Plant

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Confirm spot | standalone pin and GPS sample → advance to content | local draft step; draft only on failed create | compose screen; same Plant flow | Web/native map boundary differs. |
| Plant Cairn | valid location; content optional → addMarker | stable pending own Cairn; owner-scoped entity/outbox | alert on failure; MarkerDetail standalone; Activity when launched from Activity | Not invoked in audit. |

### Own Cairn Detail

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Edit / Save | owner; synced requires online → update marker/local entity | note/type/permission; pending local vs synced API differ | editing availability/catch; same detail | Title is encoded inside note. |
| Delete | owner; synced requires online → delete marker/tombstone | removes/hides object; local tombstone and/or API | availability/error; back | Not invoked in audit. |

### Memory

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Mine / Friends | screen ready; friends subject to subscription/paywall → local scope state | view projection only; scope reset to Mine on focus | segmented state/map fog; same page | Friend authorization unsafe; circle Cairns absent. |
| Own Cairn pin | own marker supplied → open MarkDetailSheet/full detail path | view only until actions; none | sheet/detail; own detail family | Non-owner data not normally supplied. |
| Public blurred pin | outside explored fog/public bbox → deliberately not pressable | none; none | blurred presence only; none | Does not prove non-owner Detail. |

### Memory non-owner sheet

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Hide from my map | sheet somehow opened with non-owner fixture → close only | none; none | sheet closes; Memory | No-op pending implementation. |

### Settings

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Appearance / Units / Haptics | root visible → saveAll/updateSetting | persisted local preference; local storage | immediate UI selection/theme; same page | Map renderer parity not implied. |
| Export request | privacy page and network → POST export then poll status | server job; backend job | queued/ready/failed/download; same page/external download | Not invoked; deployed contract/content partial. |
| Delete Memory / Delete account | destructive confirmation → server mutation then local state changes | irreversible/scheduled destructive state; server authority plus local clear | confirmation/error/auth flow; Memory state or Auth | Not invoked; account timing mismatch. |
| Send feedback | valid message/network → POST /api/account/feedback | feedback record; server | ack/retry; same page | Not invoked; production endpoint absent in prior evidence. |

### Shared navigation

| Action | Conditions → handler | Change / persistence | Feedback / destination | Gap |
|---|---|---|---|---|
| Back | stack entry → navigation goBack | navigation only; none | prior page; origin-dependent | Post-create Route reset makes Back go Home rather than Route Detail. |

# Required journey conclusions

- **Hike/Run → Finish → Activity Detail → Back:** source-wired; regular Cancel preserves the prior snapshot; native/device journey remains unverified.
- **Paused → Finish → Cancel:** source/tests support preservation. **Paused → too-short Continue** resumes and is a bounded discrepancy.
- **Quick/Plant → retrieval/detail:** full Plant reaches Own Cairn Detail; Quick Cairn stays in Run and later retrieval is weak because All Cairns is absent.
- **Trails Activity → same Activity Detail:** yes by session/client Activity ID.
- **Activity → Save as Route → reopen:** new Route draft and persistence exist, but successful creation lands in RouteEditor view, not canonical Route Detail.
- **Route Detail → Edit/Use:** normal path exists; Use supplies a pre-start reference line, not active following.
- **Personal Memory → Cairn Detail:** own marker path exists. Friend/public path does not.
- **Appearance:** shared source applies Day/Sunset/Night, but each renderer must be judged separately.
