# O43 live-location forensic

Forensic date: 2026-09-10 (Asia/Shanghai)

Mode: read-only runtime/code/telemetry investigation. The only files created are the three forensic artifacts in this directory. No app, backend, test, threshold, configuration, database, Git-history, OTA, or deployment state was changed.

Status vocabulary:

- **OBSERVED** — human report or a directly retained event/value.
- **PROVEN** — current source or retained evidence establishes the claim.
- **HYPOTHESIS** — consistent leading explanation, but a discriminating measurement is absent.
- **NOT PROVEN** — the available evidence cannot establish it.

`CairnNZ_Project_Authority.md`, named in the task, is not present anywhere below `/Users/mzm/Desktop/cairn`. Current source, Git history, `QA_TELEMETRY.md`, the O38–O43 review artifacts, and the production read-only evidence were therefore used as the available authorities.

## 1. Verdict

**The largest proven ordinary live-line delay is upstream of Cairn's acceptance/store/render path: Cairn's Expo/Core Location observation stream delivered samples at 5.000 s median, 12.977 s p95, with foreground gaps of 15–25 s.** O43 accepted every eligible normal-motion fix in the same callback and requested the updated ShapeSource about 139 ms median / 164 ms p95 after the native sample timestamp. The old “3-second foreground interval” is not an iOS guarantee: installed Expo code drops `timeInterval` from the iOS foreground options entirely.

The current-position display and Activity line do not use the same subscription:

- The visible current-position component is RNMapbox `UserLocation`, `renderMode="normal"`, with default `animated=true` and `minDisplacement=0`. It is a JavaScript `Annotation` backed by an `Animated.ShapeSource`, not `LocationPuck` and not the native puck rendering mode.
- Activity recording uses Expo Location's separate foreground `CLLocationManager`, `kCLLocationAccuracyBestForNavigation`, `distanceFilter=5 m`, then Cairn's 25 m horizontal-accuracy gate and continuity reducer.

O43 contains direct runtime evidence that the RNMapbox source can be fresher and can consume estimates Cairn rejects. At 20:57:42, both paths observed the same or near-identical ~27.93 m estimate; `UserLocation` consumed it while Cairn rejected it as `poor-horizontal-accuracy`. At 20:58:00, RNMapbox observed a ~14.02 m estimate approximately 8.3 seconds newer than Cairn's last Activity observation. This proves materially different app-level streams/configuration. It does **not** reveal whether Apple used GPS, Wi-Fi, cellular, inertial fusion, or another internal source for either estimate.

The installed `UserLocation` animation is one-second linear interpolation to a newly received source coordinate. It is not prediction or dead reckoning, and it does not extrapolate beyond the target. Its material contribution to the human-observed gap is **NOT PROVEN** because the rendered/interpolated dot is not logged.

## 2. Exact O43 state

| Item | Evidence |
|---|---|
| OTA marker | `O43` in current source; the physical test is identified by the human as O43. The marker itself is not retained in this QA session. |
| App / native shell | `0.2.6`, build `56`, iOS `26.6.1` from production telemetry. |
| Current local HEAD | `4fb85bc3173aff11fd4ff7b34ce7feefc561d9cc` (`gps rewrite`, 2026-09-10 21:02:27 +08:00). |
| `origin/master` | Same hash; local master is neither ahead nor behind. |
| Runtime policy | Expo `appVersion`; repository app version `0.2.6`. |
| Working tree | Pre-existing dirty backend/docs and untracked review docs; no dirty `app/` product paths at inspection. This forensic did not modify them. |
| Exact commit embedded in device telemetry | **NOT PROVEN.** The walk ended before the commit timestamp; the emitted O43 event schema and behavior match the committed source, but the QA row does not store a Git hash. |

There is no independently committed O42 snapshot: current HEAD's parent is `5ce9c876` (`sim freeze`, O41 marker), and `4fb85bc3` contains the combined O43 implementation. Therefore a literal Git `O42..O43` diff cannot be constructed. The O43 implementation report establishes that the candidate added the continuity reducer/candidate model, independent elevation reducer, background authorization/task instrumentation, matching diagnostics/head-tail gates, bounded live smoothing, telemetry retention, Activity UI work, and verification router. Relative to O42's forensic state, these affect provider lifecycle, canonical acceptance, smoothing, telemetry, background, matching/elevation/Memory presentation, and Hike/Run UI. Watch authority did not change.

## 3. QA sessions and Activity identity

### Candidate sessions

| Confidence | qaSessionId | Shanghai interval | Events | Provider/state | Classification |
|---|---|---:|---:|---|---|
| Rejected | `qa-mtviplr2-g1xlb7sr` | 20:42:56.990–20:42:58.611 | 4 | real / idle | Setup envelope only; no Activity. |
| Supporting | `qa-mtviwils-4ms24c1n` | 20:48:19.504–20:57:42.347 | 7 | real / idle→tracking | Logger/upload shell tied to Activity suffix `2e7dbfd6`; no GPS decisions. |
| **High / primary** | `qa-mtvixnmb-iim3w848` | **20:49:12.659–20:58:00.573** | **576** | real / Hike / tracking | Full O43 observation, decision, journal, store, map, lifecycle, gap, elevation, and Memory evidence. |

Older rows uploaded during this window had old device start timestamps and only 4–11 envelope events; they are retry uploads, not plausible walks.

### Server Activity

| Field | Value |
|---|---|
| Server session ID | `2067` |
| `clientActivityId` | `70f69c8e-028b-4e8d-89bc-20592e7dbfd6` |
| User | internal user ID `72`; account contact omitted |
| Type | Hike (`hiking`) |
| Server start | 2026-09-10 12:49:13 UTC / 20:49:13 Shanghai |
| QA binding | client suffix `2e7dbfd6` in the primary and supporting QA sessions |
| State at inspection | unfinished/not finalized; Activity remained `tracking` in the last event |
| Server incremental geometry | 41 display points; raw field absent; distance/duration still zero in the unfinished shell |
| Local canonical telemetry | 75 accepted points across the retained test |

Because Finish/Save was not observed, this O43 session contains no matcher request/result or final Detail evidence. It cannot diagnose post-Finish matching.

Machine-readable artifacts:

- `O43_EVENT_TIMELINE.csv`: 196 privacy-safe event/causal rows plus header.
- `O43_EVENT_SUMMARY.json`: identities, distributions, provider configuration, direct stream comparisons, and limitations.

## 4. Calculated evidence

Percentiles use linear interpolation over sorted samples.

### Observation and acceptance cadence

| Metric | Count | p50 | p90 | p95 | max |
|---|---:|---:|---:|---:|---:|
| Cairn native sample inter-arrival | 84 intervals | **5.000 s** | 8.701 s | **12.977 s** | 57.082 s |
| Accepted canonical inter-arrival | 74 intervals | **5.000 s** | 10.000 s | **15.699 s** | 60.460 s |
| Native timestamp → Expo/Cairn callback | 85 | 97 ms | 105 ms | 169 ms | 4,371 ms |
| Callback → canonical decision | 85 | 0 ms | 1 ms | 1 ms | 1 ms |

Counts:

- raw observations: 85, all marked foreground;
- accepted: 75 (88.24%);
- rejected: 10;
- Candidate/quarantine: **0**;
- decisions: 4 `first-trusted-fix`, 71 `coherent-motion`, 10 `poor-horizontal-accuracy`;
- background callbacks: 0;
- explicit lifecycle gaps: 4.

**Prominent result:** Cairn raw callbacks themselves were already approximately 4–6 seconds apart in ordinary motion. This was not created by journal/store/React processing. Earlier language describing “3-second iOS tracking” was incorrect.

### The 5 m cadence hypothesis

For 71 accepted `coherent-motion` edges:

| Field | p50 | p90 | p95 | max |
|---|---:|---:|---:|---:|
| elapsed time | 5.000 s | 8.000 s | 11.000 s | 25.000 s |
| displacement from prior trusted point | **5.67 m** | 7.83 m | 9.83 m | 14.71 m |
| valid reported speed | 0.925 m/s | 1.331 m/s | 1.400 m/s | 1.860 m/s |

Displacement buckets were striking: 0 edges below 4 m, 0 from 4 to under 5 m, 64 from 5 to under 8 m, and 7 at or above 8 m. At a median reported walking speed near 0.93 m/s, a 5 m threshold naturally corresponds to roughly 5.4 seconds.

This is strong evidence that the configured 5 m distance filter materially shapes delivery, but it is **not proof of sole causation**:

- Apple controls when and with what uncertainty it forms/delivers estimates.
- `distanceFilter` is measured relative to the previously delivered location, not physical ground truth.
- O43 logs displacement from the prior *trusted* fix, not from every prior raw Expo fix; exact raw-to-raw threshold correlation is unavailable.
- elapsed-time vs displacement correlation was only 0.109, and reported-speed vs displacement correlation was -0.097. Cadence is not a deterministic `5m/speed` clock.
- Expo can receive a native batch but exports only `locations.last`, so intermediate native locations, if any, are not visible to JavaScript.

### Accuracy

| Population | n | p50 | p90 | p95 | max |
|---|---:|---:|---:|---:|---:|
| all raw | 85 | 14.25 m | 26.24 m | 29.71 m | 38.65 m |
| accepted | 75 | 14.25 m | 16.05 m | 18.59 m | 24.84 m |
| rejected | 10 | 29.14 m | 37.52 m | 38.08 m | 38.65 m |

Every rejection was caused by the 25 m horizontal-accuracy gate. There were no impossible-speed, lateral-innovation, non-monotonic, or Candidate decisions.

### App-side line latency

| Stage | n | p50 | p95 | max | Evidence |
|---|---:|---:|---:|---:|---|
| Physical movement → Apple estimate | — | unavailable | unavailable | unavailable | No ground-truth motion clock. |
| Consecutive Expo/Cairn sample timestamps | 84 | 5,000 ms | 12,977 ms | 57,082 ms | Exact sample timestamps. |
| Apple sample timestamp → Expo callback | 85 | 97 ms | 169 ms | 4,371 ms | `activity_observation_received_v2`; max is an old sample emitted after watcher restart. |
| Expo callback → filter decision | 85 | 0 ms | 1 ms | 1 ms | Same-event decision checkpoints. |
| Durable journal write | 12 retained checkpoints | 35.5 ms | 54.1 ms | 64 ms | Coalesced representative commit results. |
| Journal commit → Zustand publication | 12 | 0 ms | 1 ms | 1 ms | Store checkpoints. |
| Store publication → React source-request effect | 12 | 6 ms | 10.8 ms | 13 ms | Correlated retained checkpoints. |
| Expo callback → ShapeSource assignment request | 75 | 41 ms | 62.5 ms | 105 ms | Every accepted sample correlated by native timestamp. |
| Apple sample timestamp → ShapeSource assignment request | 75 | **139 ms** | **163.9 ms** | 339 ms | Every accepted sample. |
| ShapeSource assignment → native Mapbox/GPU paint | — | unavailable | unavailable | unavailable | No per-source paint callback. |

The app's source-assignment checkpoint occurs in a React effect and does not prove a painted frame. It does prove that journal/store/React/GeoJSON work is not responsible for multi-second stalls. Native/GPU paint latency remains unmeasured, but it would need to be implausibly large and synchronized with rejected/missing samples to explain the observed 15–60 second freezes.

### Bounded live smoothing

O43 produces a live coordinate only after canonical acceptance. Within a segment it blends 82% of a new accepted position at accuracy ≤15 m, otherwise 72%, then clamps the displayed tail to within 2–6 m of accepted truth. It never waits for future evidence.

A local privacy-preserving reconstruction over the 41 server-retained canonical points available at inspection found live-to-accepted offset p50 1.22 m, p95 2.03 m, max 2.72 m. This can look roughly 1–2 seconds behind at walking speed, but it cannot cause a temporal freeze or a 20–60 second gap. Full 75-point smoothed coordinates were not retained remotely, so those spatial figures are representative rather than a complete-walk distribution.

## 5. Important event timeline

The CSV contains the full privacy-safe timeline. These condensed episodes show the causal points needed for review:

| Shanghai time | Event | Raw/canonical evidence | Interpretation |
|---:|---|---|---|
| 20:49:12.660 | Start requested | real Hike | O43 Activity begins. |
| 20:49:12.826 | Authorization refreshed | background = `foreground-only` | Background task cannot legitimately register. |
| 20:49:12.828 | Expo foreground source active | logged 3,000 ms; 5 m | 3,000 ms has no iOS runtime effect; 5 m does. |
| 20:49:17.662 | raw 1 | 30.64 m, REJECT | Correctly outside 25 m gate. |
| 20:49:22.855 | Expo foreground source restarted | logged 2,000 ms; still 5 m | Dynamic “interval” change restarts iOS manager despite interval being Android-only. |
| 20:49:22.860 | raw 2 | sample age 4.371 s, 34.83 m, REJECT | Old/cached estimate follows restart. |
| 20:49:25.168 | raw 3 | 23.33 m, first ACCEPT | First canonical point; ShapeSource request at +74 ms native time. |
| 20:49:26.553 | RNMapbox source snapshot | 23.33 m estimate | Separate `UserLocation` path active. |
| 20:49:26.838 | app inactive | accepted age 1.705 s | Foreground watcher is taken down. |
| 20:49:26.867 | background unavailable | permission not granted | No background callbacks possible. |
| 20:49:26.889 | gap/new segment | zero distance/elevation/Memory bridge | Honest discontinuity. |
| 20:49:30.450 | app active | accepted age 5.317 s | Foreground return. |
| 20:49:32.474 | takeover complete | foreground watcher reactivated | Two-second active debounce is intentional lifecycle latency. |
| 20:49:32.485 | raw 4 | 27.02 m, REJECT | New segment still acquiring. |
| 20:49:38.155 | raw 5 | 25.31 m, REJECT | Narrowly over hard gate. |
| 20:49:44.155 | raw 6 | 30.09 m, REJECT | Route remains at raw 3. |
| 20:49:48.185 | raw 7 | 16.32 m, first ACCEPT | Accepted interval from raw 3 is 23.005 s; the filter decision itself took 0 ms. |
| 20:49:51.185 | raw 8 | 5.76 m / 3.001 s, ACCEPT | Normal motion accepts immediately. |
| 20:49:53.198 | raw 9 | 8.67 m / 2 s, ACCEPT | Immediate; no Candidate. |
| 20:49:54.203 | raw 10 | 38.65 m, REJECT | Gate begins a three-fix rejection run. |
| 20:49:55.208 | raw 11 | 37.39 m, REJECT | Cairn route remains fixed. |
| 20:49:56.210 | raw 12 | 28.19 m, REJECT | Coordinate may still be plausible, but quality policy rejects it. |
| 20:49:57.223 | raw 13 | 9.52 m / 4 s, ACCEPT | Route catches up in one update; processing to source request 105 ms. |
| 20:49:58.076 | raw 14 | 7.83 m / 0.86 s, ACCEPT | Immediate despite a sharp heading diagnostic; no Candidate. |
| 20:49:59.178 | raw 15 | 26.86 m, REJECT | Another hard-gate stop. |
| 20:50:12.854 | health | raw 18 / canonical 9; accepted age 2.854 s | Telemetry chain intact. |
| 20:51:12.890 | health | raw 29 / canonical 20; age 3.889 s | Ordinary update cadence, no pending Candidate. |
| 20:52:12.892 | health | raw 37 / canonical 28; age 3.890 s | Same. |
| 20:53:12.914 | health | raw 47 / canonical 38; age 1.914 s | Same. |
| 20:54:12.925 | health | raw 58 / canonical 49; age 2.923 s | Same. |
| 20:55:12.936 | health | raw 69 / canonical 60; age 5.936 s | Raw cadence is visible even with no rejections. |
| 20:55:22.112 | app background | permission `foreground-only` | Foreground source off; no background source. |
| 20:55:22.259 | gap/new segment | zero contributions | Correct gap contract. |
| 20:55:27.169 | app active | accepted age 11.169 s | RNMapbox resumes independently. |
| 20:55:27.237 | RNMapbox source | 27.71 m estimate | Current-position path has a location before Cairn watcher takeover. |
| 20:55:29.264 | Cairn takeover complete | Expo watcher active | Cairn resumes two seconds after active. |
| 20:55:29.280 | raw 72 | 23.95 m, first ACCEPT | Canonical route resumes. |
| 20:56:00.101 | raw 75 | after 25.000 s with no Cairn callback, ACCEPT | Foreground delivery gap, not filter latency. |
| 20:56:12.968 | health | accepted age 12.967 s | No pending Candidate; no new raw callback since 20:56:00. |
| 20:56:17.099 | raw 76 | after 16.999 s, ACCEPT | Another foreground delivery gap. |
| 20:56:45.096 | raw 82 | ACCEPT | Last point before long background interval. |
| 20:56:46.185 | app background | permission `foreground-only` | Background source unavailable. |
| 20:56:46.354 | gap/new segment | zero contributions | Correct discontinuity. |
| 20:57:41.275 | health | background; accepted age 56.276 s | No native background callback; task inactive. |
| 20:57:42.021 | app active | Cairn watcher still off | Foreground takeover debounce begins. |
| 20:57:42.100 | RNMapbox source | ~27.93 m source estimate | `UserLocation` receives it promptly. |
| 20:57:44.120 | Cairn watcher active | takeover complete | Separate Activity subscription restarts. |
| 20:57:44.142 | raw 83 | same/near-identical ~27.93 m estimate, REJECT | Direct proof that current-position source can consume a point Cairn excludes. |
| 20:57:45.744 | raw 84 | 24.84 m, first ACCEPT | Accepted gap from raw 82 = 60.460 s; line resumes. |
| 20:57:51.779 | raw 85 | 13.05 m / 6.264 s, ACCEPT | ShapeSource request at +126 ms native time. |
| 20:58:00.485 | app inactive | accepted age 8.762 s | Cairn foreground subscription removed. |
| 20:58:00.569 | RNMapbox source | ~14.02 m, timestamp 20:58:00 | RNMapbox source is ~8.3 s newer than Cairn's last raw Activity sample. |

## 6. Exact foreground CLLocationManager configuration

Installed `expo-location` is `19.0.8`.

Production path:

```text
Location.watchPositionAsync({
  accuracy: BestForNavigation,
  timeInterval: dynamic 2000/3000,
  distanceInterval: 5
})
```

Installed Expo iOS implementation decodes only `accuracy` and `distanceInterval` into `LocationOptions`. It creates a new `CLLocationManager` and sets:

```text
allowsBackgroundLocationUpdates = false
distanceFilter = 5 m
desiredAccuracy = kCLLocationAccuracyBestForNavigation
delegate = Expo provider
startUpdatingLocation()
```

It does not set a foreground `activityType`, `pausesLocationUpdatesAutomatically`, deferred delivery, or an iOS timer. Those native defaults therefore apply. `didUpdateLocations` yields the native array, but `LocationModule` sends only `locations.last` to JavaScript.

**PROVEN:** `timeInterval` has no direct iOS foreground runtime effect. Expo's type/docs mark it Android-only, and the installed Swift options record has no such field. The same ordinary `timeInterval` is also not read by Expo's iOS background task consumer; `deferredUpdatesInterval` is a separate option.

There is one indirect effect: Cairn's dynamic-sampling loop changes the nominal 3,000/2,000 ms value and restarts the foreground watcher when it changes. On iOS this restart cannot change cadence through `timeInterval`, but it does tear down/create a manager. O43 shows exactly one such restart at 20:49:22 and then a 4.371-second-old rejected sample. This is a proven mechanism and a plausible startup disturbance, not the explanation for the entire walk.

Apple documents `distanceFilter` as the minimum horizontal movement before an update event, relative to the previously delivered location, and `desiredAccuracy` as a requested target rather than a guarantee. Expo's current public documentation also identifies `timeInterval` as Android-only. See [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/), [Apple `distanceFilter`](https://developer.apple.com/documentation/corelocation/cllocationmanager/distancefilter), and [Apple `desiredAccuracy`](https://developer.apple.com/documentation/CoreLocation/CLLocationManager/desiredAccuracy).

## 7. Exact current-position data flow

Hike and Run both render the same `HikingMap`.

### Current-position display

```text
iOS Core Location system estimate
  ↓
RNMapbox AppleLocationProvider
  - separate provider/CLLocationManager subscription
  - distanceFilter = 0 m (UserLocation minDisplacement default)
  - desiredAccuracy = kCLLocationAccuracyBest (Mapbox default)
  - activityType = other (Mapbox default)
  ↓
RNMBXLocationModule source event
  - location updates and heading updates share the event channel
  ↓
RNMapbox UserLocation state
  - visible = true
  - renderMode = normal
  - animated = true (default)
  - minDisplacement = 0 (default)
  - requestsAlwaysUse = false (default)
  ↓
Annotation
  ↓
Animated.ShapeSource
  - 1,000 ms linear interpolation to each changed source coordinate
  ↓
current-position dot
```

This is **not** `LocationPuck`, native-puck mode, or Cairn custom coordinate rendering. The task's generic word “puck” refers visually to this `UserLocation` annotation.

Installed `@rnmapbox/maps` is `10.3.1`; its podspec constrains Mapbox Maps iOS to `~> 11.20.1`. The exact patch embedded in build 56 is **NOT PROVEN** because there is no `Podfile.lock`, resolved native project, or SDK version telemetry. It is safe to say RNMapbox 10.3.1 with a Mapbox 11.20.x constraint, not to claim a specific compiled patch.

Mapbox's provider and Expo's Activity provider are separate manager instances. Apple may supply them equivalent estimates, as O43 sometimes shows, but Cairn does not forward an Expo `CLLocation` object to RNMapbox. Conversely, RNMapbox does not forward its source object into the Activity reducer.

Answers from current source:

1. Mapbox owns a separate default `AppleLocationProvider`: **yes**.
2. Cairn owns a separate Expo subscription: **yes**.
3. Same `CLLocationManager`: **no**.
4. Same exact `CLLocation` object/stream: **no** at app level; common underlying Apple estimation is possible and opaque.
5. Can Mapbox consume a point Cairn rejects: **yes**, by code and O43 evidence.
6. Can Cairn receive a point Mapbox never displays: code permits it (different lifecycle/subscription); a specific O43 coordinate is **NOT PROVEN** because RNMapbox source logs are coalesced.
7. Visual animation/interpolation: **yes**, one second to a received target; no extrapolation/PDR.
8. Continue moving between source fixes: only during that bounded one-second animation, then it stops unless another coordinate arrives.
9. JavaScript sees RNMapbox source callbacks through `UserLocation.onUpdate`, not the interpolated animation position.
10. `UserLocation.onUpdate`: used in the Internal O43 build.
11. `MapView.onUserLocationUpdate`: exposed by RNMapbox but not used here.
12. Native Mapbox v11 exposes `LocationManager.onPuckRender`, but installed RNMapbox 10.3.1 does not bridge it to JS, and Cairn's visible component is not the native LocationPuck. Mapbox describes that native signal as interpolated puck rendering data; it is not equivalent to Cairn's current JS `UserLocation` render path. See the [Mapbox user-location guide](https://docs.mapbox.com/ios/maps/guides/user-location/), [v11 location migration guide](https://docs.mapbox.com/ios/maps/guides/migrate-to-v11/), and [native `LocationManager` API](https://docs.mapbox.com/ios/maps/api/11.7.0/documentation/mapboxmaps/locationmanager).

### RNMapbox telemetry limitation

`real_location_sample_observed` is emitted by `UserLocation.onUpdate`, but the RNMapbox native module emits the same JS event after both location and heading updates while reusing its last location. The cumulative `repeatCount` values (7,178 in the first provider lifetime, 119 after restart) are therefore not location-coordinate cadence. The event is also coalesced. It proves source availability and sampled timestamp/accuracy, not every source coordinate or rendered position.

## 8. Canonical Activity and live-line data flow

```text
physical movement
  ↓ unknown/variable time
Apple Core Location estimate for Expo manager
  - standard startUpdatingLocation
  - BestForNavigation
  - 5 m distanceFilter
  ↓ [native batch, only last exported]
Expo watchPositionAsync callback
  ↓ synchronous ownership / generation / coordinate / timestamp guards
serialized addTrackPoint ingest
  ↓ realGpsContinuity.evaluateRealGpsObservation
  ├─ hAcc > 25 m → immediate REJECT
  ├─ impossible accuracy-adjusted speed → REJECT or reacquisition Candidate
  ├─ large trajectory innovation → Candidate (≤5 s, one corroborating fix normally)
  └─ normal coherent movement → immediate ACCEPT
  ↓ accepted only
segment/gap classification
  ↓
bounded causal accepted-coordinate smoothing (same segment only)
  ↓
independent elevation reducer + distance computation
  ↓
durable Activity journal (awaited)
  ↓
Zustand trackPoints / trackPointsSmoothed publication
  ↓
Hike/Run selects trackPointsSmoothed for real provider
  ↓
HikingMap useMemo splits geometry by explicit segment ID
  ↓
React ShapeSource shape assignment
  ↓ unmeasured bridge/native/GPU paint
Mapbox LineLayer
```

Potential waits:

- Core Location/Expo delivery: variable; configured 5 m distance filter; no iOS time guarantee.
- Cairn ingestion: serialized and awaits journal, but measured in tens of milliseconds.
- Candidate: only for ambiguous fixes, max five seconds; none occurred in this walk.
- React: no throttle/debounce; a render/effect occurs after store publication.
- Mapbox paint: asynchronous and not instrumented.
- Gap: route intentionally stays disconnected; no fake tail.

## 9. O43 acceptance audit and the 25 m gate

The exact current reducer is:

- hard horizontal quality gate `accuracy > 25 m`;
- Hike maximum accuracy-adjusted speed 4.17 m/s; Run 10 m/s;
- large lateral Candidate requires a sufficiently established recent edge, step at least max(18 m, 0.9×accuracy), innovation at least max(12 m, 0.75×accuracy), heading change at least 82°, and supporting quality/innovation;
- possible reacquisition Candidate applies after at least 20 seconds if a transition is accuracy-adjusted impossible;
- Candidate lifetime is five seconds and one coherent following fix can confirm a new direction;
- a return to the trusted corridor rejects the Candidate;
- ordinary accepted motion never waits for future evidence.

O43 result:

- **PROVEN:** normal eligible motion is immediately accepted on this hardware. All 71 normal eligible fixes were `coherent-motion`, all decisions were 0–1 ms, and no normal fix entered Candidate.
- **PROVEN:** the old real-GPS “indoor drift until 15 m” behavior is not active here; legacy scalar stationary/indoor checks in `addTrackPoint` are guarded to Simulator samples after the real reducer classifies the observation.
- **PROVEN:** the 25 m gate materially created specific trace freezes. Raw 4–6 were 27.02/25.31/30.09 m and generated a 23.005-second accepted interval. Raw 10–12 were 38.65/37.39/28.19 m and produced a visible stop followed by catch-up at raw 13. Raw 83 (~27.93 m) was rejected while RNMapbox consumed the corresponding source estimate.
- **NOT PROVEN:** that changing the 25 m policy would improve truth. `horizontalAccuracy` is an uncertainty radius, and the actual coordinate may sometimes be near the user even when the radius is >25 m; it may also be dangerously wrong. This task does not change the gate.

Apple defines `horizontalAccuracy` as an uncertainty radius, with negative values invalid—not a statement that the center coordinate is wrong. See [Apple `horizontalAccuracy`](https://developer.apple.com/documentation/corelocation/cllocation/horizontalaccuracy).

## 10. GPS/UI status semantics

For real Activities, `Poor`, `Lost`, and `Frozen` are not a shared native-GPS enum. Those literal labels belong to Simulator states.

Real Hike/Run UI derives:

- `Finding GPS`: no accepted track point yet (or not available);
- `GPS good`: `locationAvailable`, at least one accepted point, and last accepted point younger than 120 seconds;
- `Signal lost`: no accepted point for more than 120 seconds;
- accuracy warning: the **last accepted** point's accuracy is over 15 m;
- background warning: authorization state is `foreground-only`.

No O43 retained health checkpoint crossed the 120-second `Signal lost` threshold; the maximum retained accepted age was 56.276 seconds while backgrounded. Exact UI render transitions are not logged. Therefore “poor/no GPS” in a human description cannot be translated into “Core Location supplied no estimate.” Mapbox may still consume estimates that fail Cairn's accepted-quality contract.

## 11. Background and gap evidence

The tested device had `foreground-only` authorization at Start and on every transition. Consequently:

- Cairn did not attempt a background registration/start with permission granted;
- the foreground Expo watcher was deactivated on background/inactive;
- the background source reported `background-permission-not-granted`;
- zero background callbacks or journal writes existed;
- four explicit `background-provider-unavailable` gaps/new segments were created;
- each gap logged distance 0, elevation 0, Memory bridge false;
- foreground takeover drained zero events and restarted the foreground watcher after a two-second active debounce.

This is truthful behavior under the observed authorization; it does not certify the Always-authorized path. The 57.082-second raw gap from 20:56:44.999 to 20:57:42.081 is explained by background lifecycle/permission, not by the foreground filter. The 25.000- and 16.999-second intervals around 20:56 occurred while foreground active and contained no Cairn callbacks; those are provider/delivery absences.

## 12. H1–H6 ranking

| Hypothesis | Supporting evidence | Contradicting/limiting evidence | Confidence |
|---|---|---|---|
| **H1 Native delivery latency** | Cairn raw median 5 s, p95 12.98 s; 15/17/25 s foreground sample gaps; 5 m configured distance filter; coherent-edge floor at 5 m. | Physical movement onset is not instrumented; Mapbox's separate stream can be fresher; 5 m is not proven sole cause. | **HIGH** for largest ordinary Cairn cadence cost; **MEDIUM** for attribution specifically to 5 m. |
| **H2 Acceptance/filter latency** | Ten >25 m observations rejected; clusters created 23 s and 60 s accepted gaps; direct ~27.93 m RNMapbox-consumed/Cairn-rejected episode. | Eligible fixes accept in 0–1 ms; zero Candidates; acceptance ratio 88.24%. | **HIGH** for weak-quality episodes; **LOW** as cause of ordinary eligible motion latency. |
| **H3 Smoothing latency** | Spatial smoother can sit ~1–2 m behind accepted truth and is accuracy-weighted. | No temporal queue/future wait; bounded ≤2.72 m in available reconstruction; every accepted tail publishes promptly. | **HIGH confidence it is secondary, not the multi-second stall source.** |
| **H4 Store/React/GeoJSON/Mapbox line latency** | GPU paint itself is not measured. | Callback→source request p95 62.5 ms; native timestamp→source p95 163.9 ms; journal/store/React checkpoints are small. | **HIGH confidence app-side path is not material; native paint NOT PROVEN.** |
| **H5 Puck/Activity materially different streams** | Different manager/provider/config; RNMapbox source at 20:55:27 before Cairn restart, matched rejected estimate at 20:57:42, and fresher estimate at 20:58:00. | Both use Apple's Core Location system and can receive equivalent estimates; exact rendered position absent. | **HIGH** at app subscription/policy level; source-provenance differences UNKNOWN. |
| **H6 native/visual interpolation or prediction** | Installed `UserLocation` performs 1 s linear animation between source coordinates. | It is JS annotation interpolation, not native-puck `onPuckRender`; no rendered-position telemetry; it does not predict/extrapolate after 1 s. | **HIGH that interpolation exists; LOW/NOT PROVEN that it materially caused the observed separation; NO evidence of PDR.** |

This is Case 6 (mixed): primarily H1 for ordinary line cadence, H2 during poor-accuracy clusters, proven H5 enabling source divergence, bounded H3 spatial offset, and known-but-unquantified H6. H4 is not supported as a material app-side delay.

## 13. How observations A and B coexist

Observation A—current-position dot sometimes lags/jumps—is compatible with an irregular stream of system location estimates followed by one-second easing to each new target. When estimates arrive late or their centers move, the dot waits and then moves/jumps. Nothing here proves dead reckoning.

Observation B—the dot can look surprisingly current while the Activity line is behind—is explained by a different combination:

1. RNMapbox's provider requests updates with no displacement floor and has no Cairn 25 m gate.
2. Expo's Activity provider uses a 5 m delivery filter.
3. Cairn rejects every Activity estimate above 25 m even if its center happens to look good.
4. RNMapbox can resume before Cairn's two-second foreground takeover.
5. The line only changes after an accepted, durable canonical point; the dot consumes its independent source and eases to it.

O43 directly demonstrates points 1–4 in code and runtime. Whether the dot's *rendered* center was truly close to the human at a particular second remains human-observed rather than instrumented.

## 14. Apple/Core Location facts and unknown provenance

**Documented fact:** Core Location returns a system location estimate and can use multiple device components. Apple says its system can use Wi-Fi, cellular, GPS, and other hardware, selectively enabling what it needs. [`CLLocation`](https://developer.apple.com/documentation/corelocation/cllocation) carries position, timestamp, accuracy, speed, course, and related fields.

**Documented fact:** `CLLocationSourceInformation` reveals only whether an estimate is software-simulated or produced by an external accessory. It does not label a real point “GPS,” “Wi-Fi,” “cellular,” or “inertial.” See [Apple source information](https://developer.apple.com/documentation/corelocation/cllocationsourceinformation).

**Code-inferred fact:** current Expo exports no `sourceInformation`, speed accuracy, or course accuracy into this Activity callback. O43 telemetry retains horizontal/vertical accuracy, speed validity/value, and course validity, but not per-fix source provenance.

**Unknown/private implementation:** the exact fusion, interpolation, radio, or inertial inputs Apple used for any O43 estimate. “Phone built-in positioning,” “Wi-Fi point,” and “PDR” are not justified labels for this incident.

## 15. Watch path

Current app/module/config source contains no WatchConnectivity/WCSession, watchOS target, HealthKit workout session, or live/imported Watch location authority. Repository docs list Apple Watch as future/backlog work.

```text
Apple Watch → no implemented O43 Activity data path
iPhone Expo provider → sole canonical Activity location authority
iPhone RNMapbox provider → current-position presentation only
```

The Watch cannot explain this incident and must not become an accidental second truth authority.

## 16. DR1 consistency check

| DR1 principle | O43 result |
|---|---|
| Raw evidence separate from canonical | **Supported.** All 85 observations have decisions; rejected points do not enter route/metrics/Memory. |
| Normal coherent fix → immediate accept | **Supported on O43 hardware once delivered and ≤25 m.** 71/71 coherent fixes accepted in 0–1 ms. |
| Obvious invalid → immediate reject | **Supported for poor accuracy.** Other invalid classes were not exercised. |
| Ambiguous → short Candidate | **Not exercised / not yet proven natively.** Zero Candidate events. |
| No 10–20 s filter wait for normal motion | **Supported.** Long normal intervals were missing callbacks, permission/lifecycle, or quality rejection—not Candidate delay. |
| Trusted Position ≠ Trusted Transition | **Supported by architecture; not exercised by Candidate in O43.** |
| Missing evidence → gap | **Supported.** Four background-unavailable gaps, zero bridge contributions. |
| Accepted truth → incremental Memory | **Supported by telemetry checkpoints.** |
| Causal smoothing only on accepted continuous evidence | **Supported.** No cross-segment smoothing. |
| Final per-segment matching | **Not tested.** Activity never finished. |

The product-level low-latency goal is therefore only **partially achieved**: reducer latency is correct, while source cadence and divergent current-position/Activity subscriptions still produce ordinary visible separation.

## 17. Visual mutable/provisional tail hypothesis

Any provisional presentation must remain outside canonical distance, elevation, Memory, matching input, and journal truth, must reset at explicit gaps, and must never claim a trusted transition from the last accepted point.

| Option | Perceived latency | Truth/safety | Main risks and fit |
|---|---|---|---|
| A. Canonical-only | Current 5 s median cadence; stalls on rejection/missing callbacks | Strongest truth | Does not solve observed presentation separation. Fully DR1-compatible. |
| B. Latest raw Cairn `CLLocation` tail | Helps only after Expo callback; cannot fill Expo callback gaps | Can be clearly provisional | A >25 m coordinate may be very wrong; solid straight connector would misstate transition. Low complexity, limited benefit. |
| C. RNMapbox `UserLocation.onUpdate` tail | Potentially fresher; O43 proves independent/fresher source episodes | Presentation-only possible | Event channel includes heading duplicates; source policy differs; no rendered-position synchronization; low-quality centers can jump. Serious candidate only after clean source telemetry. |
| D. Actual rendered/interpolated current-position tail | Best visual synchronization in theory | Presentation-only | Not exposed by installed RNMapbox; current dot is JS `UserLocation`, not native puck; bridge/native complexity; could synchronize to visual fiction rather than factual evidence. |
| E. Short provisional source buffer | Better corners than one straight line; mutable recent tail | Can fade/dash uncertainty and reconcile only bounded history | Must cap age/distance/accuracy, discard on Lost/Frozen/gap, and avoid turning untrusted points into an apparently solid walked line. Best provisional form if later justified. |
| F. PDR/motion prediction | Could span true no-fix intervals | Not currently supportable | High drift/calibration/battery/Watch complexity; no current sensor authority or proof. Future research only. |

Edge cases common to B–E include standing drift, tall buildings, river/cliff excursions, switchbacks, real sharp turns, diagonal road crossings, off-road movement, and abrupt correction. A provisional line should therefore be visually uncertain (faded/dashed or an uncertainty leash), short-lived, segment-bound, and independently discardable.

**Assessment:** a provisional-tail prototype is worth considering later, but it should not be the first architectural change and should not use the current opaque rendered dot as truth. First measure the clean RNMapbox source/render clocks and decide whether the 5 m Activity stream is intentionally the right raw cadence.

## 18. Better-supported alternative architecture

The stronger long-term design is a **single foreground raw observation authority with two explicit consumers**, not two hidden location managers:

```text
one low-displacement foreground Core Location source
  ├─ current-position presentation (fresh estimate + uncertainty)
  └─ Cairn continuity reducer
       └─ accepted durable route
```

If a provisional tail is still desired, derive it from that same auditable raw source and style it as uncertainty. This eliminates unknown provider skew, makes callback→dot and callback→route comparisons exact, and prevents RNMapbox from becoming an accidental second Activity authority. The canonical filter, gaps, metrics, Memory, and final matching remain unchanged.

Tradeoffs requiring a measured prototype:

- `distanceFilter=0` or smaller than 5 m may increase callbacks/JS/battery and noise;
- custom current-position rendering loses some RNMapbox convenience unless the shared provider is fed into Mapbox cleanly;
- changing foreground source ownership is more architectural than adding a presentation-only tail;
- it still cannot create factual position when Core Location supplies none.

Before choosing it, run one instrumented cadence/battery test. The existing O43 evidence supports investigating it more strongly than wiring the line to native `onPuckRender`.

## 19. Missing evidence and minimal instrumentation specification

No instrumentation is implemented in this task.

| Event to add | Fields (privacy-safe) | Approximate emission point | Why | Privacy |
|---|---|---|---|---|
| `activity_mapbox_source_location_v1` | source ordinal, source timestamp, callback wall time, hAcc/vAcc, valid speed/course, **relative displacement from prior changed source coordinate**, duplicate-location/heading-only flag, app state | `HikingMap.handleRealUserLocationUpdate`, after locally distinguishing changed location timestamp/coordinate from heading-only repeats | Establish true RNMapbox coordinate cadence and compare it to Expo. | Never upload coordinates/course value; only deltas/quality/validity. |
| `activity_current_position_display_target_v1` | source ordinal/timestamp, target assignment wall time, relative target↔latest canonical distance, target age, accuracy, animation duration | RNMapbox `UserLocation` adapter or a Cairn wrapper around current-position target assignment | Prove which source point the visible component is targeting. | Relative distance only. |
| `activity_current_position_render_observation_v1` | source ordinal, frame time, animation progress, relative rendered↔target and rendered↔canonical distance | Requires a supported AnimatedPoint listener/custom current-position adapter; native `onPuckRender` is not the current path | Measure actual visual interpolation; current `onUpdate` is only source data. | Relative distances only; coalesce to 1–2 Hz and preserve transition endpoints. |
| `activity_trace_native_frame_v1` | pending canonical version, ShapeSource request time, first subsequent fully-rendered-frame time, elapsed ms, map/style state | Correlate `MapView` fully rendered-frame callback to the latest pending source version | Bound JS→native/GPU latency; acknowledge it is map-frame, not source-specific proof. | No coordinates. |
| `activity_raw_relative_edge_v1` | raw ordinal, dt from prior raw, relative raw-to-raw displacement, hAcc pair, watcher generation, batch count/index | Immediately after Expo callback/native batch export; native bridge needed for actual batch count | Test the 5 m filter directly and reveal discarded native batch members. | Relative distances/timing only. |
| `activity_location_manager_effective_config_v1` | provider ID, lifecycle generation, platform, desiredAccuracy enum, distanceFilter, activityType, pause/background flags, timeIntervalApplied boolean, start/stop reason | Foreground/background provider activation, ideally native-confirmed | Prevent Android-only “interval” metadata being mistaken for iOS runtime configuration. | No location data. |
| `activity_real_gps_ui_status_changed_v1` | from/to status, accepted age, raw age, last accepted hAcc, permission, provider-active flags | Hike/Run status selector on semantic change | Distinguish a UI warning from absence of Core Location. | No coordinates. |
| `activity_motion_groundtruth_marker_v1` | user action/landmark ordinal and wall time | Optional Internal-only test button or volume/haptic marker | Gives physical movement/turn onset a time anchor; software cannot otherwise measure it. | No location; tester-controlled timestamp. |

Retention: preserve source/status transitions and first/last events as critical; sample routine source/render ticks; coalesce stable status; never allow heading churn to evict lifecycle/filter/gap events.

## 20. Smallest next physical measurement

Do **not** repeat a long uninstrumented walk. After adding only the source/target/render/raw-edge timestamps above, run a 2-minute screen-on Hike:

1. stand still 20 seconds;
2. walk straight at a steady pace for 60 seconds;
3. make one clear 90° turn and continue 30 seconds;
4. stop 10 seconds; do not background or lock the phone;
5. screen-record the map and report Activity name, `qaSessionId`, and the approximate turn time.

This isolates 5 m Expo cadence, RNMapbox source cadence, one-second display animation, canonical acceptance, and ShapeSource paint without background permission as a confounder. A separate lock-screen test is unnecessary until Always/background authorization is actually granted.

## 21. Direct answers

1. **Where is the largest proven latency?** Before Cairn processing, in the Expo/Core Location sample cadence: 5.0 s median / 13.0 s p95, plus foreground delivery gaps up to 25 s. Background permission created the 57 s maximum. Quality-rejection clusters add episode-specific accepted-line stalls.
2. **Why can current position and track separate?** Separate manager/subscription/configuration, Cairn's 5 m delivery filter and 25 m gate, RNMapbox's 0 m provider threshold, lifecycle timing, and a one-second animated annotation versus an accepted-only line.
3. **Different streams?** **Yes at app/provider level.** Different `CLLocationManager` owners and runtime cadence are proven. Different Apple sensor provenance is unknown.
4. **Can Mapbox display points Cairn rejects?** **Yes.** Code allows it and the ~27.93 m 20:57:42 event demonstrates it.
5. **Is interpolation involved?** It exists as one-second RNMapbox JS annotation animation. Its material incident contribution is **NOT PROVEN**; it is not PDR.
6. **Is DR1 low-latency canonical acceptance working?** **Yes after delivery and within the 25 m gate:** 71 coherent accepts at 0–1 ms, zero Candidates. The end-to-end live experience is only partially achieved because delivery/gate divergence remains.
7. **Is 25 m materially involved?** **Yes in specific stalls:** all 10 rejections, including a 23 s start freeze and the direct Mapbox/Cairn divergence. It is not the source of the ordinary 5 s accepted median.
8. **Is smoothing materially involved?** **No for temporal stalls.** It is a bounded secondary spatial lag (~1–2 m typical in the available reconstruction).
9. **Is React/ShapeSource materially involved?** App-side evidence says no: callback→source request p95 62.5 ms. Actual GPU paint is not instrumented.
10. **Does Watch matter?** No; no implemented Watch Activity/location path exists.
11. **Is a visual provisional tail worth prototyping?** Later, yes—prefer a very short uncertain buffer only after source/render instrumentation. Never canonical/metrics/Memory.
12. **Another architecture?** Prefer one auditable low-displacement foreground source feeding both current-position presentation and the canonical reducer, with any tail derived from that shared raw stream.
13. **Missing evidence?** Physical movement onset, true RNMapbox coordinate cadence separated from heading, displayed/interpolated position, raw-to-raw displacement/native batch contents, and ShapeSource-to-painted-frame latency.
14. **Smallest next test?** The two-minute screen-on still/straight/turn/stop test above, after minimal instrumentation; no background confounder.

## 22. Commands and data sources

Read-only local commands included:

```sh
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master
git log -2 --format=... --date=iso-strict
git show --stat --oneline --summary HEAD
git diff-tree --no-commit-id --name-only -r HEAD
rg / nl / sed against current Activity, Hike/Run, telemetry, Expo, and RNMapbox source
node -p require(...package.json).version
find app -name Podfile.lock -o -name Package.resolved -o -name project.pbxproj
```

Production reads used the documented restricted route, with the operations key remaining inside `cairn-backend`:

```sh
ssh ubuntu@122.51.174.118 'sudo -n docker exec -i cairn-backend node'
GET http://127.0.0.1:3001/api/telemetry/sessions?since=2026-09-10T12:15:00Z&limit=50
GET http://127.0.0.1:3001/api/telemetry/sessions/<qaSessionId>
```

Read-only production DB queries ran through `backend/src/config/db` inside the same container:

```sql
SHOW COLUMNS FROM sessions;
SELECT ... FROM sessions WHERE RIGHT(client_activity_id, 8) = '2e7dbfd6';
SELECT ... FROM telemetry_sessions WHERE session_id = 'qa-mtvixnmb-iim3w848';
```

External sources were limited to current official Expo, Apple, and Mapbox documentation linked inline. No exact coordinates, account contact, token, key, cookie, JWT, or secret is present in these artifacts.
