# Native Activity Simulator regression forensic

Date: 2026-09-08

Status: forensic record written before the baseline-restoration runtime changes in this worktree.

## Evidence boundaries

This analysis treats the reported iPhone behavior as authoritative and reconstructs the implementation from Git objects, reflog-preserved objects, the two prior Codex session transcripts, and the current uncommitted worktree. No production system, database, OTA channel, or deployed build was changed while producing it.

The four comparison points are:

| Label | Evidence point | Meaning |
| --- | --- | --- |
| A — baseline | `bbcc37a` (`feat(backend): enforce Free Activity identity contracts`, 2026-09-07 16:48) | Last committed tree before Activity Simulator integration. The relevant client files are also identical in `a9157af`. |
| B — initial Simulator | `05ec257` (`feat: complete Free Activity and QA simulator`, 2026-09-07 18:03) | Initial integrated Activity Simulator. |
| C — native blocker round 1 | Uncommitted edits recorded in Codex rollout `01a07ac1-7a82-75b1-9e99-7ae71b327f66`, principally patches at transcript ordinals 2509–2795 | First native-blocker attempt: elapsed format, panel placement, joystick separation, start configuration, map recenter/readiness changes, and QA contracts. |
| D — native blocker round 2/current | Uncommitted edits recorded in Codex rollout `01a07c3c-4c79-78a1-a99e-8f3d57877280`, principally patches at transcript ordinals 229–703, as present in the worktree at the start of this forensic | Second attempt: provider/map-state resolver, additional camera/readiness handling, native joystick coordinates, Settings locking, and expanded diagnostics. |

`cf444c0` (`rewrite hike and run`) is a reflog-preserved equivalent client-history point, not the branch baseline used for these comparisons.

## Proven baseline camera contract

At A, ordinary pre-Activity Hike rendered `HikingMap` with only empty markers/track points and a marker callback. It intentionally did **not** pass `userPos` or `instantCamera`. `HikingMap` then rendered Mapbox `Camera` with:

- `followUserLocation={!instantCamera && followUser}`;
- `followZoomLevel={15}` and `followPitch={0}`;
- `animationMode="flyTo"` and `animationDuration={600}` when not instant;
- no `defaultSettings` unless an explicitly instant position existed.

That is the original globe/world presentation followed by Mapbox's native user-follow fly-to. The map also held its welcome touch shield for 700 ms. Because an ordinary pre-start screen did not inject the tracking store's retained `lastCoordinate`, every fresh ordinary Hike entry recreated the same journey rather than beginning directly on a cached coordinate.

The tracking/resume branch was different by design: it passed `lastCoordinate` and `instantCamera={lastCoordinate != null}` so an in-progress Activity could resume directly. Map readiness began false, became true from `onDidFinishLoadingMap` or the fully-rendered callback, and had the existing 8-second safety fallback.

Running used the corresponding native follow-user camera contract. Its pre-Activity camera deliberately remounted on focus and used the 600 ms fly-to path; the tracking camera used zoom 16. Simulator restoration must not change those ordinary branches.

## Regression matrix

| Behavior / structure | A — baseline | B — initial Simulator | C — round 1 | D — round 2/current at forensic start |
| --- | --- | --- | --- | --- |
| Hike initial globe animation | Proven: no cached target injected before Activity; Mapbox begins at its world/default presentation. | Preserved when Simulator was not shown (`instantCamera=false`), replaced by virtual-coordinate instant camera when shown. | Ordinary path remained B. | **Regressed:** ordinary pre-start passes `mapDisplayPosition`, which resolves to retained real `lastCoordinate`. |
| Hike fly-to-user | Proven native `followUserLocation` + `flyTo`, 600 ms. | Preserved for Debug OFF and Simulator OFF. | Preserved outside Simulator; imperative simulator recenter logic was added in `HikingMap`. | **Regressed:** `instantCamera={simulatorLocationAuthoritative || mapDisplayPosition != null}` becomes true for a retained real GPS fix, changing the camera to zero-duration/`none` and allowing the imperative instant target to suppress the journey. |
| Repeated Hike entry | Proven to remount an ordinary pre-start map without injecting cached `lastCoordinate`, so the globe journey repeats. | Preserved outside Simulator despite passing `lastCoordinate`, because `instantCamera` remained false. | Same as B outside Simulator. | **Regressed exactly by the round-2 HikingScreen hunk:** retained `lastCoordinate` now flips `instantCamera` true, so the next entry starts at the current location. |
| Run initial camera | Proven focus-key remount and 600 ms real-user fly-to. | Preserved outside Simulator; Simulator selected a virtual default target and removed real user following. | Added readiness timeout/fallback and simulator recenter; normal contract otherwise retained. | Normal follow condition is less coupled than B, but map/display state still becomes Simulator-authoritative while idle once `startConfigured` is true. This is architecturally wrong and not native-proven. |
| Debug ON only | Old debug tooling did not change normal map lifecycle unless its old walker was active. | Debug ON + Simulator OFF retained real map behavior. | Same intent. | The controls predicate is separated, but persisted start migration and idle authority mean Debug ON + Simulator ON can still alter the map before an Activity. |
| Simulator toggle OFF | No Activity Simulator. | Independent toggle existed in Developer Settings and called `setEnabled`. Store rejected changes during any in-progress tracking session. | Same broad store lock. | **Regressed further:** Settings disables the row for any non-idle Activity, any session id, or any Simulator binding—not only an active/unfinished Simulator Activity. A stale binding can make it appear permanently unclickable. |
| Simulator toggle ON | N/A. | Enables controls and immediately also selects virtual map/provider behavior. | Added explicit `startConfigured`, but legacy migration treated any valid persisted origin as configured. | Controls are visible, but a configured-idle state still grants virtual map authority. Existing v1 snapshots are silently considered configured even if the tester never chose a start. |
| Map tree | Single normal Mapbox lifecycle. | `showSimulator` changes camera following, user-location subtree, synthetic ShapeSource, and gestures before Activity start. | Still coupled to `showSimulator`; native readiness patches do not remove the alternate lifecycle. | Partially split, but `resolveSimulatorMapState` still chooses the Simulator tree for “controls visible + configured + idle.” This violates the required provider-only model. |
| `UserLocation` | Normal real `UserLocation` whenever permission allows. | Removed whenever Simulator controls are shown, including pre-start configuration. | Same. | Restored only for unconfigured idle; still removed for configured idle, including migrated snapshots. |
| Camera refs | Normal component ref/Mapbox declarative follow behavior. | Added map-center/camera refs and imperative simulator `setCamera`. | Added explicit ref/readiness logging and recenter behavior. | Refs exist, but ordinary Hike is fed an instant cached target; simulator ref availability remains coupled to a configured-idle authority decision. |
| Readiness | Native load callbacks plus existing 8-second safety fallback. | Simulator shared the map but changed tree/camera/location inputs. | Added more derived readiness and a Run fallback intended to reveal the map. | More telemetry-like state exists, but it does not fix the wrong idle authority/migrated configuration and native rendering remained unverified. |
| Simulator settings visibility | N/A. | Full settings existed in one large panel from start/destination through movement, speed, time, altitude, accuracy/signal, lifecycle, and diagnostics. | Panel was moved lower-left/bounded and joystick moved right. | **Regressed usability:** fixed `height: 210` leaves a short ScrollView whose initial viewport is dominated by diagnostics and Start/Destination. On native, responder/stacking failure makes later controls effectively unreachable, matching the limited panel report. The controls were not deleted. |
| Start Here | N/A. | Manual coordinates and map selection actions existed; buttons were hard-disabled while tracking. | `startConfigured` was introduced and set by `setOrigin`. | Still hard-disabled by `status !== 'idle'`, so no action or explanatory event fires. Map-selected Start Here is conditionally absent unless selection state hydrated/arrived. |
| Use Map Center | N/A. | Uses the real supported Mapbox ref API `MapView.getCenter()`. | Kept; ref/readiness work added. | Still hard-disabled by broad Activity status. Panel is rendered in a fragile overlay/native-map responder arrangement, and failure is only visible if the handler actually runs. No pre-action evidence proves which gate failed. |
| Joystick | N/A. | Used gesture `dx/dy`, so behavior depended on grant origin and could be wrong for native center-relative input. | Placement moved to the right; panel moved lower-left. | Improved and retained: native `locationX/locationY` is converted relative to joystick center, termination is rejected, native responder blocking is requested, and move logging is throttled. End-to-end native sample/accept/commit/movement remains unproven. |
| Provider selection | Real GPS (apart from the older explicit debug walker). | `debug && simulatorEnabled` selects Simulator before Activity start; start failure is fail-closed but display and provider intent are conflated. | Added required start preparation, still selected Simulator from the toggle. | Provider resolver is explicit, but map authority incorrectly includes configured idle. Active Simulator continuity is represented by the tracking provider/binding and must be the only reason Simulator controls cannot be disabled. |

## Exact regression-producing changes

### Non-Debug Hike regression

The producing hunk is round 2's change in `HikingScreen.tsx` from B/C:

```tsx
userPos={showSimulator ? simulatorPosition : lastCoordinate}
simulatorEnabled={showSimulator}
instantCamera={showSimulator}
```

to D:

```tsx
userPos={mapDisplayPosition}
simulatorEnabled={simulatorLocationAuthoritative}
simulatorControlsEnabled={showSimulator}
instantCamera={simulatorLocationAuthoritative || mapDisplayPosition != null}
```

`resolveSimulatorMapState` returns the accepted real `lastCoordinate` as `displayPosition` when Simulator is not authoritative. Therefore Debug OFF is no longer equivalent to A: a real cached coordinate now selects HikingMap's instant camera path. This directly explains both authoritative observations: the first entry loses the original flight once GPS priming supplies a coordinate, and subsequent entries begin directly at the retained coordinate.

Initial Simulator commit B did **not** cause this particular non-Debug regression because its ordinary branch left `instantCamera=false`.

### Debug/Simulator map regression

B introduced the original architectural coupling: `showSimulator` simultaneously controlled UI visibility, provider intent, camera mode, real `UserLocation` removal, and synthetic ShapeSource insertion. Thus merely turning on a configuration tool reconstructed important parts of the Mapbox lifecycle before Activity Start.

D attempted to separate controls from authority but encoded this rule in `simulatorMapState.ts`:

```ts
authoritative = providerActive || (controlsVisible && startConfigured && trackingStatus === 'idle')
```

That still makes an idle, merely configured Simulator authoritative. In addition, round 1's persistence migration assigned `startConfigured = origin.ok` whenever the field was absent. Every older v1 snapshot already held a valid default origin, so existing QA devices skipped the intended “not configured yet” branch. Together these changes explain why round 2 could pass fresh-state unit tests while the existing iPhone still received the wrong map tree.

### Toggle regression

B exposed the Developer Settings toggle without a UI-level disabled predicate. D added:

```ts
Boolean(simulatorBoundActivityId)
  || trackingStatus !== 'idle'
  || Boolean(trackingSessionId)
```

and passed it to the toggle row's `disabled` prop. The store independently rejects changes for the same broad notion of any Activity. This blocks Simulator changes during real-GPS Activities too. Separately, the recovery discard path does not release a persisted Simulator binding, so a discarded/recovered Activity can leave `boundActivityClientId` behind and lock the row indefinitely. The lock must be based only on continuity for an active or unfinished **Simulator-provider** Activity, with an explicit reason.

### Settings/action regression

The full control implementation remains present. Round 2 changed the earlier tall, screen-bounded panel (`top`, `bottom`) to a fixed 210-point panel. Diagnostics plus Start/Destination consume the first viewport. That is not by itself proof of a missing feature, but with native map responder/stacking contention it makes the ScrollView's remaining content inaccessible and presents exactly as “only Start/Destination exists.” Hike also renders the panel as a fragment sibling of the entire screen tree, unlike Run's in-screen sibling placement, making native Mapbox stacking less predictable.

`Start here` and `Use map center` are hard-disabled whenever `status !== 'idle'`. A disabled `TouchableOpacity` never calls the handlers, so no reason is logged and the failure banner cannot explain stale/non-idle state. `Use map center` itself calls a real Mapbox API (`getCenter(): Promise<Position>` in the installed `@rnmapbox/maps`), so the API name is not the fault. The unresolved/native-specific part is whether the touch reaches the panel and whether the registered ref is live; round 2 added state but no action-attempt telemetry, so it could not distinguish those cases.

## Existing telemetry audit

The historical yiiling-side capability is present, not gone:

- `app/src/services/debugLogger.ts` writes bounded local JSONL Activity sessions.
- `app/src/services/telemetryUploader.ts` uploads completed sessions and retries on network/app lifecycle changes.
- `backend/src/routes/telemetry.js` provides `POST` and `GET /api/telemetry/sessions` backed by `telemetry_sessions` (created by migration `006`).
- Developer settings retain upload-enabled, Wi-Fi-only, backend URL, and API-key fields; the screen exposes URL/upload controls but not the key field.

It is not safe to reactivate unchanged. Backend `requireApiKey` is currently an explicit no-op/TODO, so both upload and retrieval are unauthenticated even though documentation describes `X-API-Key`. Client upload can also contain precise real-GPS coordinates from the historical Activity logger. The existing endpoint/storage should be reused, but retrieval must fail closed without configured server authentication and upload must redact real coordinates. These are local implementation/deployment requirements; this work must not deploy them.

Client QA telemetry and backend logs have different jobs. Client telemetry can prove map callbacks, camera mode, responder events, provider/sample decisions, and Activity state. Backend logs can prove only HTTP/sync/storage behavior. A shared `qaSessionId` can correlate them but cannot make a backend request log evidence of native rendering.

## Restoration direction derived from evidence

The smallest evidence-based repair is:

1. Restore the exact A pre-Activity Hike camera inputs whenever Simulator is not the active Activity provider—including Debug ON + Simulator OFF and Debug ON + Simulator ON while configuring.
2. Make Simulator map authority mean only an actually active Simulator-provider Activity; visibility/configuration never selects a different map lifecycle.
3. Treat old snapshots without an explicit `startConfigured` field as unconfigured.
4. Lock the toggle only for active/unfinished Simulator-provider continuity, release stale bindings through recovery/discard, and show the reason.
5. Keep the corrected elapsed formatting, lower-left SIM placement, right-side joystick, and local-point joystick math while hardening the overlay responder boundary and making action attempts observable.
6. Extend the reviewed telemetry storage/transport rather than create a parallel analytics system; add a stable bounded `qaSessionId`, automatic Debug/Internal batching, authentication, and upload-time real-location redaction.

Native rendering and the full joystick chain remain explicitly unproven until a new device build emits the added client events. Jest/Web characterize the contract; they cannot substitute for the iPhone evidence.
