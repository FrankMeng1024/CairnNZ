# O52 blind real-field forensic

**Verdict date:** 2026-09-12  
**Mode:** blind, read-only, no tester symptom supplied  
**Time convention:** UTC. New Zealand local time for these traces was UTC+12.  
**Production user:** 72

## Executive verdict

These are genuine O52 recordings. Neither saved route is globally corrupt, neither credits an unobserved connector, and O50 reproduces both saved Final geometries. The field result is nevertheless **not ready to freeze tracking**:

- `hike ka` has an 89.703 s process/recovery continuity break covering 84.940 m of plausible unobserved movement. An earlier 41.001 s delayed callback was handled continuously and truthfully. The malformed lifecycle sequence around the later break is suspicious independently of any tester report.
- `lost run` has a 328.002 s source silence covering 673.941 m. O52 correctly represents this as a true `gps-reacquired` Gap, unlike the settled O51 `run issue` false-Gap bug. After two points in the new segment, however, 30 later points incorrectly reuse the original segment ID. That provenance reversal is a confirmed canonical bug and creates a second presentation break.
- The single-provider architecture works in every retained ownership interval: no Expo/Mapbox-Apple overlap is measured. Pause stops the custom provider. Full-session ownership cannot be proved for `lost run` because its QA telemetry ends 9.555 s after Start.
- The WAL survived process death and shows bounded append behavior in `hike ka`. Final reconstruction is conservative and truthful in both sessions, with no wrong-road stealing.
- O52 energy measurement is still confounded. The Hike map rebuilt the complete route projection on every observed append, the QA server merge grew to about 950 KB in six minutes, and `lost run` retried a Memory POST returning 401 every 15 s fifteen times. These are architecture/observability costs, not GPS truth costs.

The blind overall assessment is therefore:

| Activity | Blind assessment | Confidence |
| --- | --- | --- |
| `hike ka` | Mostly truthful route with a material lifecycle/process continuity loss and transient presentation anomalies; not globally broken | High for the interruption, medium for its root cause |
| `lost run` | Material source loss correctly exposed as a Gap, plus confirmed segment-provenance corruption after reacquisition; saved distance remains conservative | High |

No inference in this report uses later tester feedback. The settled O51 classifications for `great hike`, `run issue`, and `mstand` remain unchanged and are used only as regression context.

## Authority and evidence limits

Authority order followed here was production Activity evidence, persisted canonical/Final data, O52 telemetry, current source, live deterministic replay, then tests/contracts. The O51 real-field report and handoff remain authoritative for the three prior named sessions.

The production session column named `route_points_raw` is **not original raw GPS** for these recovered Activities. Process recovery finalized it from durable canonical evidence. Original raw counts and raw accuracy/spatial distributions therefore come only from retained QA telemetry. `hike ka` retained enough aggregate telemetry for useful FG/BG analysis. `lost run` telemetry was terminated after a QA upload received HTTP 401, so many requested metrics are genuinely unavailable.

No exact latitude/longitude is reproduced here or in the JSON handoff.

## Activity identity

There is no literal server title `hike ka`. The unambiguous most recent O52 Hike-mode Activity is server title `ka`; throughout this report the requested label remains **`hike ka` (server name `ka`)**.

| Field | `hike ka` | `lost run` |
| --- | ---: | ---: |
| Server ID | 2077 | 2078 |
| Client ID | `f7a6fcb9-eed4-45b3-a7e5-fe9c8bd71b4b` | `71b581ea-0feb-4f18-ba77-8b195b90a87b` |
| Server name | `ka` | `lost run` |
| Mode | Hike (`hiking`) | Run (`running`) |
| App / native build | 0.2.6 / 56 | 0.2.6 / 56 |
| OTA | Exact Expo update ID not retained; O52 cadence/provider contract emitted | Exact Expo update ID not retained; O52 cadence/provider contract emitted |
| Start | 2026-09-12 12:00:25Z | 2026-09-12 12:07:44Z |
| Finish/end timestamp | 2026-09-12 12:06:33Z | 2026-09-12 12:18:42Z |
| Server finalized | 2026-09-12 12:07:42Z | 2026-09-12 12:27:42Z |
| Wall duration | 368 s | 658 s |
| Saved active duration | 356 s | 614 s |
| Saved distance | 329.265 m | 753.311 m |
| Original raw callbacks | 168 from QA | Unavailable after telemetry cutoff |
| Persisted canonical points | 138 | 245 |
| Final points | 41 | 68 |
| Canonical segment-aware distance | 329.265 m | 753.311 m |
| Final segment-aware distance | 316.891 m | 722.529 m |
| Unique segment IDs | 2 | 2 |
| Contiguous segment runs | 2 | 3 (old -> new -> old) |
| Classified Gaps | 0 `gps-reacquired`; 1 process-recovery boundary | 1 `gps-reacquired`; 2 visible identity breaks |
| Pause / Resume | 1 / 1 | Unavailable |
| FG provider elapsed | At least 229.655 s | Only 3.3 s opening window retained |
| BG provider elapsed | At least 42.592 s | Only 5.175 s opening window retained; later mostly background but exact duration unavailable |
| Cairns / Plants | 0 / 0 | 0 / 0 |

The O52 runtime identity is established by the emitted `activity_location_cadence_experiment_v1` contract: `BestForNavigation`, foreground 1 m, background 1 m, iOS time interval not applied, and `expo-custom-provider` RNMapbox authority.

## Blind first-pass session assessment

### `hike ka`

Before inspecting individual classifier events, the whole persisted path exposes two route runs separated by a plausible 84.940 m relocation. The session remains chronologically ordered, its segment-aware saved distance is internally consistent, and Final preserves the break. The route before and after the break is usable. The interruption is material because about 20.5% of the all-adjacency physical displacement is intentionally absent from saved distance.

Independent suspicious regions were:

1. 12:04:03–12:06:13: delayed/batched evidence followed by process loss and recovery.
2. 12:00:33–12:00:42: a transient raw/puck leap up to about 33 m ahead of canonical truth while the reducer quarantined implausible movement.
3. 12:01:58–12:02:20: a short reversal/lateral detour around a BG/FG interval; canonical retained it, but hAcc/course evidence makes physical interpretation uncertain.
4. 12:06:07–12:06:13: the recovered map briefly used the idle Apple provider before Activity recovery, including a failed camera fly and poor-accuracy targets.

### `lost run`

The saved path has a dense initial run, a 328.002 s absence, and a short recovered tail. The direct 673.941 m connector is not credited. That is truthful failure representation, not a false Gap. The unexpected old -> new -> old segment identity sequence is independently abnormal and cannot be explained by sensor accuracy.

Independent suspicious regions were:

1. 12:11:46–12:17:14: complete source/canonical silence while the endpoints show plausible continued relocation.
2. 12:17:18–12:17:59: background evidence reuses the original pre-Gap segment ID after foreground/reacquisition created a new segment.
3. Session-wide: pace is mathematically the saved average but is labelled `LIVE PACE`; missing distance during the honest Gap makes it materially slower than unknowable physical pace.
4. 12:08:15–12:11:46: fifteen Memory POST attempts return 401 at fixed 15 s intervals.
5. About 12:09:53 onward: QA upload 401 terminates the field telemetry needed to distinguish later provider and energy behavior.

## O52 precision validation

### Requested policy

Both Activities requested the same policy in both lifecycle states:

```text
accuracy: BestForNavigation
distanceInterval: 1 m
iOS timeInterval: not applied
RNMapbox Activity location authority: Expo custom provider
```

This is a precision intent, not a promise of one callback per metre or second. iOS batching and process scheduling remain visible in the real traces.

### `hike ka` actual delivered callbacks

The callback interval samples are bounded samples retained inside coalesced QA events. They are source-sequence deltas, grouped by provider; the separate global 41.001 s source gap is discussed below. Raw spatial samples were privacy-redacted during upload.

| Metric | Foreground | Background |
| --- | ---: | ---: |
| Provider elapsed represented | >=229.655 s | >=42.592 s |
| Raw callbacks | 135 | 33 |
| Callbacks/min over represented elapsed | <=35.27 | <=46.49 |
| Retained interval samples | 57 | 29 |
| Callback delta p50 | 1.000 s | 1.000 s |
| Callback delta p95 | 6.000 s | 6.565 s |
| Callback delta max within source runs | 9.000 s | 8.000 s |
| Delta >2 s | 5 | 6 |
| Delta >3 s | 3 | 4 |
| Delta >5 s | 3 | 2 |
| Delta >10 s | 0 | 0 |
| Raw spatial delta p50/p95/max | Unavailable; upload privacy stripping | Unavailable; upload privacy stripping |
| Raw hAcc p50/p95/max | Unavailable from coalesced upload | Unavailable from coalesced upload |

Accepted-source evidence, which is not equivalent to all raw callbacks:

| Accepted evidence | Foreground | Background |
| --- | ---: | ---: |
| Canonical points attributed to source | 121 | 17 |
| Within-source delta p50/p95/max | 1.000 / 2.001 / 13.000 s | 1.000 / 12.435 / 12.435 s |
| Spatial delta p50/p95/max | 1.491 / 3.125 / 32.209 m | 1.818 / 23.721 / 23.721 m |
| hAcc p50/p95/max | 14.246 / 16.732 / 24.614 m | 14.246 / 20.373 / 20.373 m |

The large accepted deltas are time-spaced or Candidate-promoted edges, not one-second teleportation. The separate 37.865 m edge spans 41.001 s, and the process-recovery connector is excluded.

### `lost run` actual delivered callbacks

Only the opening provider window survived telemetry upload:

| Metric | Foreground opening | Background opening |
| --- | ---: | ---: |
| Represented provider elapsed | about 3.3 s across two runs | 5.175 s |
| Raw callbacks | 5 | 5 |
| Retained delta p50/p95/max | 1.000 / 5.586 / 5.586 s | 1.000 / 2.578 / 2.578 s |
| Delta >2 / >3 / >5 / >10 s | 1 / 1 / 1 / 0 | 1 / 0 / 0 / 0 |
| Raw spatial and hAcc percentiles | Unavailable | Unavailable |

The persisted accepted stream is background-dominant after the final recorded background transition, but exact per-source attribution cannot be recovered. Its whole-stream accepted metrics are:

| Metric | Value |
| --- | ---: |
| Points | 245 |
| Delta p50/p95/max | 1.000 / 2.000 / 328.002 s |
| Delta >2 / >3 / >5 / >10 s | 4 / 3 / 3 / 3 |
| Spatial delta p50/p95/max | about 2.953 / 4.742 / 673.941 m |
| hAcc p50/p95/max | 14.246 / 14.246 / 22.469 m |

Before the outage, 213 canonical points span 241 s: about 52.8 accepted points/min in a mostly background session. That is strong real evidence opportunity where the source was alive.

### Precision conclusion

**Yes, O52's 1 m background intent materially improved evidence opportunity in healthy background stretches.** `hike ka` delivered a 1 s BG median, and `lost run` produced dense one-second accepted evidence for minutes. Background was not identical to foreground: its tail percentiles were wider and callbacks were drained/batched at takeovers. The 1 m request did not and could not prevent a delayed iOS callback, a process/lifecycle interruption, or a five-minute source silence.

## Raw GPS health

Because original raw distributions were not retained, these accuracy/movement distributions are over recovered canonical evidence. They describe the trusted source evidence, not rejected raw clouds.

| Accuracy bucket | `hike ka` | `lost run` |
| --- | ---: | ---: |
| hAcc p50 / p95 / max | 14.246 / 16.908 / 24.614 m | 14.246 / 14.246 / 22.469 m |
| <=5 m | 5 / 138 (3.62%) | 2 / 245 (0.82%) |
| >5–10 m | 7 / 138 (5.07%) | 6 / 245 (2.45%) |
| >10–20 m | 122 / 138 (88.41%) | 236 / 245 (96.33%) |
| >20 m | 4 / 138 (2.90%) | 1 / 245 (0.41%) |

| Movement metric | `hike ka` | `lost run` |
| --- | ---: | ---: |
| Reported speed p50/p95/max | 0.981 / 1.253 / 1.505 m/s | 2.525 / 3.645 / 4.979 m/s |
| Coordinate speed p50/p95/max | 1.077 / 2.535 / 4.780 m/s | 2.873 / 4.646 / 9.042 m/s |
| speedAccuracy | Not supplied | Not supplied |
| Valid course samples | 126 / 138 | 236 / 245 |
| Consecutive course change p50/p95/max | 4.36 / 24.39 / 61.81 deg | 4.68 / 21.81 / 169.45 deg |
| Circular course resultant | 0.947 | 0.606; reduced by multiple corridors and post-Gap reversal |

The Hike coordinate-speed maximum occurs on an accepted edge whose accuracy-adjusted motion remains plausible for the Hike envelope. The Run 9.042 m/s coordinate edge is below the 10 m/s Run envelope and sits inside roughly 14 m hAcc; it is suspicious-looking but not physically contradictory enough to reject.

| Silence metric | `hike ka` | `lost run` |
| --- | ---: | ---: |
| Longest source/canonical silence | 89.703 s process break | 328.002 s |
| Longest continuous-segment edge | 41.001 s / 37.865 m | 13.000 s / 17.815 m |
| Foreground longest within-source sample | 9.000 s raw; 13.000 s accepted | 5.586 s retained opening only |
| Background longest within-source sample | 8.000 s raw; 12.435 s accepted | 2.578 s retained opening; full session unavailable |

Overall source classification:

- `hike ka`: **USABLE**. Dense and directionally consistent when active, but broad ~14 m accuracy and one process break prevent GOOD/EXCELLENT.
- `lost run`: **POOR overall**. Healthy sections are usable and dense, but a 328 s source outage is disqualifying for the whole session. This does not mean the available points are poor.

## Canonical health

### `hike ka`

| Metric | Result |
| --- | ---: |
| Canonical points | 138 |
| ACCEPT decisions | 131 |
| Candidate/QUARANTINE decisions | 19 |
| REJECT decisions | 9 |
| REFINE decisions | 7 |
| Candidate transitions | 10 created, 7 confirmed, 6 rejected, 2 timed out |
| Stationary-named suppress/refine decisions | 12 |
| Unique segments / contiguous runs | 2 / 2 |
| `gps-reacquired` Gaps | 0 |
| Other continuity boundaries | 1 `process-recovery` |
| Owner-generation rejections | 1 before-owner-generation |
| Duplicate canonical points | 0 detected |
| Chronology violations | 0 detected |

Candidate confirmation accounts for the difference between 131 direct ACCEPT decisions and 138 persisted canonical points. The largest accepted same-segment edge is 37.865 m over 41.001 s. The largest quarantined/held startup displacement reached 32.209 m before coherent evidence confirmed the corridor. There is no false `gps-reacquired` Gap and no connector credit across process recovery.

### `lost run`

The terminal decision aggregate was not uploaded, so Accept/Candidate/Reject/stationary counts are unavailable. The durable facts are:

| Metric | Result |
| --- | ---: |
| Canonical points | 245 |
| Unique segments / contiguous runs | 2 / 3 |
| Gap | 1 true `gps-reacquired` |
| Gap displacement / duration | 673.941 m / 328.002 s |
| Owner-generation rejections | 1 in the retained opening |
| Duplicate canonical points | 0 detected |
| Timestamp chronology violations | 0 |
| Segment chronology violation | Yes: old segment ID reused after new segment |

The largest accepted same-run edge is 17.815 m over 13 s; the fastest is 9.042 m over one second. Neither proves impossible movement after considering hAcc and Run's envelope. The 673.941 m break is not accepted distance.

### False-Gap regression conclusion

`lost run` does **not** reproduce O51 `run issue`. Recorded accuracy is healthy and normalized; the interval is 328 s rather than an accuracy-schema fallback around the 120 s rule. The direct counterfactual connector is plausible in average speed but topologically and temporally unobserved. O52 is right to create the Gap. The defect occurs *after* that correct decision, when stale background context reuses the pre-Gap segment ID.

## Stationary windows

The detector found no defensible stationary period of 30 s or longer in either Activity. Therefore it would be false precision to quote a 30 s/two-minute raw-cloud radius.

| Activity | Window | Evidence | Verdict |
| --- | --- | --- | --- |
| `hike ka` | 12:03:48–12:04:01 (13 s) | 3.26 m accepted movement inside ~14.25 m hAcc; Candidate/stationary logic active | Too short and too uncertain to call stationary; no drift accumulation proven |
| `lost run` | 12:10:57–12:11:03 (about 6 s) | Reported speed falls to ~0.05 m/s; next accepted point after 13 s is 17.815 m away | Normal brief stop/deceleration with clean exit; no false Gap |

No old Stop-V signature, stationary segment explosion, or delayed stationary exit is present. There is also no evidence from these two sessions that Stationary V2 accumulated false distance.

## Turns, reversals, and geometry events

No crossing can be identified confidently without road/topology geometry retained alongside the trace. The following direction changes are data-driven:

| Activity / time | Raw/presentation evidence | Canonical | Final | Classification |
| --- | --- | --- | --- | --- |
| Hike 12:00:33–12:00:42 | Raw/puck moves about 28–33 m ahead during accuracy recovery | Impossible fixes rejected; corridor held, then confirmed | Smoothly represents confirmed corridor | Faithful and conservative; live presentation could feel ahead |
| Hike 12:01:58–12:02:20 | BG evidence reverses from local progress ~108 m to ~90 m, then returns; hAcc reaches ~20 m and one course is invalid | Detour retained | Reasonably simplified; network not trusted | DATA QUALITY LIMITATION, not a proven U-turn |
| Hike 12:04:03–12:04:44 | 37.865 m over 41.001 s, callback delivered 17.751 s late | Accepted continuous because motion is plausible and below 120 s | Preserved in first run | Correct batching handling |
| Hike 12:04:44–12:06:13 | 84.940 m over 89.703 s with process loss | New `process-recovery` segment; connector excluded | Separate Final segment | Truthful discontinuity; material lost movement |
| Run ~12:08:46 | ~56 deg corridor change | Preserved | Preserved/simplified | Healthy turn |
| Run ~12:10:38 | Large direction change including a one-second 9.042 m edge | Preserved under Run envelope | Preserved/simplified | Usable, accuracy-limited |
| Run ~12:11:30 | Further major corridor turn | Preserved | Preserved | Healthy turn |
| Run 12:11:46–12:17:14 | 328 s silence; heading after return broadly reverses | Correct new segment/Gap | Separate segment | True reacquisition |
| Run 12:17:18 | 2.014 m in 1.999 s but segment ID changes back | Incorrect provenance split | Second visible break | Confirmed bug; geometry itself plausible |

There is no confidently detected repeated traversal or Z/switchback that Final flattened incorrectly. A simple short-edge/high-angle zigzag diagnostic falls from 4 to 3 in Hike and 11 to 4 in Run; this is a diagnostic count, not a product metric.

## Foreground/background transitions and ownership

Ten-second event coalescing did not retain every transition-adjacent fix as a separate row. The tables therefore use exact AppState/provider activation, stop, drain, and first recovered canonical timestamps; where a distinct last-FG or first-BG fix cannot be separated from a duplicated handoff sample, it is intentionally not invented.

### `hike ka`

| Transition | Evidence | Canonical result |
| --- | --- | --- |
| 12:01:54 FG -> BG -> 12:02:03 FG | Custom provider stops; BG Expo starts; FG takeover stops BG, drains 11 ordered points, then starts FG | Continuous; one non-monotonic duplicate rejected; overlap 0 |
| 12:02:08 FG -> BG -> 12:02:38 FG | BG Expo starts; takeover stops BG and drains 18 ordered points | Continuous; wider batching, no Gap; overlap 0 |
| 12:04:05 inactive -> 12:04:37 BG -> 12:04:44 active | App remains `inactive` about 32 s before true background. Custom provider stops at 12:04:42. Foreground return occurs with no provider active. A delayed BG registration starts at 12:04:54 while AppState is already active and stops at 12:04:59. | One delayed 12:04:44 point is accepted; later callbacks are rejected/held. Process continuity is subsequently lost |
| 12:06:07 map restore -> 12:06:13 Activity recovery | Apple idle provider runs 5.003 s, stops before Expo FG starts; recovery loads 129 points; first new point starts a process-recovery segment | No sensor overlap; 84.940 m truth gap |
| 12:06:27 Pause | Custom provider stops 10 ms after Pause; Expo source then stops | No post-Pause accepted point |
| 12:06:32 Finish | Already paused; fence/drain executes before O50 | No presentation/provider work continued |

The first two takeovers satisfy O52 ownership. The third lifecycle is not healthy: background ownership registration occurs after foreground return. It does not create simultaneous Activity providers, but it is a likely contributor or witness to the later recovery break.

Provider totals:

- Expo foreground starts/stops: 4 / 4 when first generation and recovery are combined.
- Expo background starts/stops: 3 / 3 successful starts/stops; extra stop calls are idempotent cleanup.
- Custom Cairn provider: 5 starts, 4 observed stops; the missing stop belongs to the interrupted process interval.
- Mapbox Apple idle provider: pre-Start 3.885 s and recovery 5.003 s. It was not active concurrently with the Activity Expo source in retained evidence.
- Measured Expo FG/BG overlap: 0 ms.

### `lost run`

The retained opening contains one clean cycle: FG starts, custom provider stops at background, Expo BG starts, then foreground takeover stops BG, drains five ordered points, and starts FG. The app backgrounds again at 12:07:53; the registration attempt is the last retained lifecycle event. Persisted evidence continues densely until 12:11:46, then stops for 328 s.

Opening provider totals are two FG source starts, one confirmed BG start, two custom starts/stops, and zero measured overlap. The second BG start result and all later stop/Finish events were lost with QA telemetry.

**Ownership conclusion:** there is no evidence of unintended simultaneous Activity location ownership in any retained interval. `hike ka` proves zero overlap through its terminal summaries. `lost run` cannot support an entire-session “never” claim because ownership telemetry is absent for most of the Activity. The segment-ID reversal is evidence of stale logical context, not proof of two simultaneous native providers.

## Camera and follow

O52 did not persist explicit `followUser`, manual-browse, camera center, and canonical/puck target in one correlated event. Exact follow-state restoration and recenter latency therefore remain unprovable.

One independent Hike recovery anomaly is visible:

- At 12:06:07 the remounted map is temporarily idle, activates Mapbox Apple location, and starts a 600 ms first-location camera fly.
- The fly is marked interrupted at 12:06:09 because no map-idle completion occurred.
- Apple targets have hAcc roughly 39–68 m and move up to 50.13 m between updates; separation from the old canonical point reaches 50.13 m and then 22.13 m.
- At 12:06:12 the initial target is applied and Apple stops. Expo FG starts at 12:06:13; the custom provider receives the new recovered location without native overlap.

This is an **EXPECTED BUT UX-CONFUSING P2** recovery presentation sequence. It does not explain missing canonical distance and is not a GPS ownership overlap. `lost run` has insufficient retained camera telemetry.

## Live presentation

For `hike ka`:

- 140 RNMapbox location-source events and 140 user-location targets were retained.
- Source interval p50/p95/max was approximately 1 / 3 / 30 s.
- Presentation-to-raw separation p50/p95/max was approximately 1.25 / 2.55 / 84.94 m.
- Presentation-to-canonical separation p50/p95/max was approximately 1.52 / 28.25 / 84.94 m.
- 127 continuous-route animation targets produced 109 completions, 17 interruptions, and one reset.
- The 8.912 s startup separation and the recovery relocation dominate the tail. After candidate confirmation, the route head catches up without inventing intermediate points.

No route-source update request timestamp falls inside a fully background interval; updates catch up on foreground return. The custom provider also stops on background. This is healthy energy isolation.

For `lost run`, only four opening Mapbox targets and one route build survived. Later puck/route-head separation and foreground restoration cannot be measured. It would be incorrect to label the 328 s truth loss as presentation lag.

## Route-presentation efficiency

| Metric | `hike ka` | `lost run` |
| --- | ---: | ---: |
| Canonical points | 138 | 245 |
| Geometry build count | 138 | Only opening value 1 retained |
| Shape/source update count | 137 | Only opening value 0 retained |
| Maximum changed payload | 2,048 B | 16 B opening only |
| Cumulative changed payload | 136,944 B | Unavailable |
| Static body chunks | 0; route never reached 256-point freeze threshold | Unavailable |
| Bounded-head updates | 137 | Unavailable |
| `routeProjectionRebuilt` | `true` in every retained aggregate | `true` at opening; no later evidence |

The 2,048 B maximum is below O52's 4,128 B bound, so the bridge-payload cap works for this short route. However, the Hike projection did **not** take its incremental append path. Current source checks old point object identity, while Hike creates fresh mapped point objects; every update therefore reconstructs the whole projection. This will also recreate stable chunks after 256 points. The field verdict is **partially working, with a confirmed incremental-projection bug**. Visible line truth, segment seams, U-turn order, and latency remained correct in this session.

## Journal / WAL validation

### `hike ka`

| Metric | Result |
| --- | ---: |
| Accepted/recovered canonical records | 138 |
| Instrumented append count | >=137; one final pre-process record lacks a terminal counter |
| Instrumented physical append operations | >=135 |
| Instrumented logical bytes | >=113,217 B |
| Instrumented actual append bytes | >=113,217 B |
| Checkpoints / checkpoint bytes | 0 / 0 B |
| Instrumented total commit time | >=1,378 ms |
| Commit p50/p95 | Not retained by aggregate telemetry |
| Maximum commit | 471 ms during recovery generation |
| Torn-tail / repair / corruption / rollback | 0 observed |

The first process generation had 128 measured appends, 126 append operations, 109,140 B and 854 ms at its last health report. Recovery loaded 129 records, proving one additional durable record beyond that report. The recovery generation appended nine records in nine operations, 4,077 B and 524 ms. Process death recovery was idempotent and Finish recovered all 138 points.

This confirms approximately linear/bounded normal persistence in a real session: bytes appended equal logical bytes and there was no history checkpoint per point. The isolated 471 ms recovery append is a latency WATCH/P2, not data loss.

### `lost run`

The WAL ultimately recovered all 245 canonical points for server finalization. Per-session append-operation, byte, checkpoint, and latency counters were not uploaded. There are no observed torn-tail/corruption events in the retained opening, but absence after cutoff is not proof. This session validates durability, not scaling telemetry.

## QA telemetry overhead

| Metric | `hike ka` | `lost run` |
| --- | ---: | ---: |
| Remote merged events | 1,066 | 102 before cutoff |
| Remote merged JSONL bytes | 950,327 B | 82,735 B before cutoff |
| Final local bounded count reported | 599 | Unavailable |
| Upload count | 10 | At least five access-log attempts; terminal attempt 401 |
| Server merged size echoed to client | 949,730 B at upload 10 | 3,075 B at first checkpoint; later value unavailable |
| Actual request/upload bytes | Not instrumented | Not instrumented |
| Last reported delta size | 105 events | 5 events at first checkpoint |
| Retained point-event aggregates | 130 | 24 opening aggregates |
| Durable flush count / bytes | Not instrumented | Not instrumented |
| Critical immediate flush count | Not instrumented | Not instrumented |

QA overhead is material in `hike ka`, not “much less than the behavior measured.” Two source contracts explain the evidence:

1. A critical event still invokes `flushSimulatorLogs()`, which serializes and writes the entire bounded event array to AsyncStorage. The number and bytes of these local writes are not counted.
2. Coalescing replaces an event with a newer event timestamp, while the upload delta cursor uses timestamp and server identity also includes timestamp. Later aggregate snapshots can therefore be uploaded and merged as new events rather than stable deltas.

The health event also places required raw/cadence fields after more than 48 fields; the generic field sanitizer retains only the first 48. That is why the supposedly terminal aggregate lacks its own callback percentiles and decision totals.

For `lost run`, an upload at approximately 12:09:53 returned 401. The uploader classifies a non-retryable failure as terminal and advances the failure state to its cap, explaining why no later Activity telemetry reached the server. Tracking continued independently, which is correct failure isolation. Observability did not.

## Memory hot path

| Metric | `hike ka` | `lost run` |
| --- | ---: | ---: |
| Evidence mutations / server cells | 13 / 13 | At least 42 / 42 |
| Evidence calls | 406 across live + recovery/Finish reconciliation | Unavailable |
| Deduplications | 393 | Unavailable |
| Batch flushes | 2 | Unavailable |
| Full persistence writes | 18 | Unavailable |
| Persistence bytes | 462,912 B | Unavailable |
| Network sync requests | 5 | 17 |
| Maximum persistence latency | Unavailable | Unavailable |

The Hike numbers show the 1 m callback stream did not produce one Memory mutation/write per callback: only 13 of 138 canonical points created new evidence. Deferred boundaries flushed successfully, and all 13 cells reached the server. Eighteen full snapshots for 13 mutations remains higher than ideal because lifecycle/recovery/Finish force boundaries, but it is not per-fix amplification.

`lost run` eventually synchronized all 42 cells, so no Memory truth regression is visible. It did so inefficiently: 15 consecutive POSTs returned 401 at fixed 15 s intervals from about 12:08:15 through 12:11:46, followed by successful batches of 39 and 3 points after recovery. Current source treats every non-OK response, including authorization failure, as a generic server error and schedules the same 15 s retry. This is a **confirmed energy/network bug**.

## Network inventory

### `hike ka`

- Activity: Start succeeded; local Finish completed pending sync; final server PATCH occurred about 63 s after local durable completion.
- Memory: five POST attempts, with evidence eventually complete.
- QA: ten uploads for the primary QA session; the server-merged row reached about 950 KB. Actual request bytes were not instrumented.
- O50: four Map Matching requests and three Directions requests, all HTTP 200, all Finish-only.
- Mapbox tiles/styles: not visible in Cairn backend access logs and not separately instrumented.
- No live Map Matching or Directions storm occurred.

### `lost run`

- Activity: Start succeeded; final server PATCH occurred about 9 min after the saved end timestamp.
- Memory: 17 POST attempts, including the 15-request 401 storm, then two successful batches.
- QA: the primary upload stream ended after 401.
- O50: production request telemetry is missing. Current exact replay made six Map Matching and four Directions requests, all Finish-only.
- Two marker POSTs returned 400 around 12:17:10–12:17:17, but no marker persisted or links to this Activity. They are insufficient evidence of a user-created Cairn and are reported as an unexplained sync anomaly.
- Tile/style traffic is unavailable.

## Final reconstruction

### Summary

| Metric | `hike ka` | `lost run` |
| --- | ---: | ---: |
| Canonical segment-aware distance | 329.265 m | 753.311 m |
| Final segment-aware distance | 316.891 m | 722.529 m |
| Final/canonical ratio | 0.9624 | 0.9591 |
| Canonical points -> Final points | 138 -> 41 | 245 -> 68 |
| Canonical-to-Final displacement p50/p95/max | 0.367 / 1.658 / 2.350 m | 0.444 / 2.528 / 5.366 m |
| Heuristic small zigzags before -> after | 4 -> 3 | 11 -> 4 |
| Accepted network-refined islands | 1 short road-offset island | 0 |
| Canonical-derived sections | 4 | 5 in current replay |
| FREE_TRAVERSAL sections | 1 | 1 in current replay |
| Road-offset sections | 1 | 0 |
| Pedestrian-network sections | 0 | 0 |
| Seam rejects / wrong-road stealing | 0 / none detected | 0 / none detected |
| Production requests | 4 Map Matching + 3 Directions | Unavailable |
| Current exact-replay requests | Same 4 + 3 | 6 Map Matching + 4 Directions |
| Timeout/fallback | 0 timeouts; canonical fallback 316.859 m | No accepted network geometry; canonical fallback 753.311 m |
| O50 production wall phase | 3.792 s | Unavailable |

The displacement metric measures each canonical point to its corresponding contiguous Final run and never crosses a Gap.

### `hike ka` Snap decisions

The 129-point first run generated three Map Matching and three walking Directions calls. All returned HTTP 200. The third Map Matching window produced an accepted candidate, but the compositor rejected network distance under its side/ambiguity gates and used four canonical-derived sections, including one FREE_TRAVERSAL section. Canonical fallback distance is 316.859 m.

The nine-point recovery run generated one Map Matching call. Its candidate was accepted as a 12.406 m road-offset section, displayed as 11.418 m, confidence 0.842, p95/max displacement 1.073 m. Endpoints remain atomic canonical boundaries. There are no seam rejects or wrong-road stealing.

The production Final geometry has 41 points and current replay reproduces it exactly. The all-adjacency raw displacement would be 414.204 m only if the unobserved recovery connector were incorrectly counted; O50 correctly reports 316.891 m segment-aware.

### `lost run` Snap decisions

Current replay reproduces the saved 68-point Final fingerprint exactly:

- Run 1, 213 points -> 61: four Map Matching and three Directions requests. A Directions candidate was formed, but conservative side/ambiguity checks rejected it. Final uses 706.130 m canonical fallback across three canonical-derived sections and one FREE_TRAVERSAL section.
- Run 2, two points -> two: one Map Matching request, no safe candidate, 1.319 m fallback.
- Run 3, 30 points -> five: one Map Matching and one Directions request, no safe candidate, 45.862 m fallback.

No network-refined geometry was accepted. Final does not draw or credit the 673.941 m reacquisition connector, and it also respects the erroneous second segment-ID change. That makes Final truthful to its input, though the upstream provenance bug leaves an unnecessary break.

### Background density and network refinement

The denser background evidence clearly increased real sampling opportunity, but it did **not** automatically create safe road geometry. Hike accepted only a short post-recovery road-offset island; its long corridor remained canonical-derived after successful network responses were conservatively rejected. Run accepted none. This is evidence for keeping the O50 gates, not loosening them.

### Straight-road quality and O51 regression context

The Hike's main long, low-curvature corridor is canonical-derived rather than endpoint-blended road-offset geometry. The only road-offset section is short, moves at most 1.073 m, and retains exact boundaries. No recurrence of the settled `great hike` 2.24 m inward endpoint-blend artifact is detected. Run has no road-offset section, so that compositor mechanism is absent.

This does not alter the O51 conclusions: `great hike` remains a Final-display P2, `run issue` remains the fixed `acc`/`accuracy` false-Gap case, and `mstand` remains continuous with network timeouts as the demonstrated reason it did not Snap.

## Replay

Replay was performed after inspecting saved evidence:

| Activity | Saved | Current O52 replay | Result |
| --- | --- | --- | --- |
| `hike ka` | 138 canonical, 2 runs, 329.265 m; 41 Final | Canonical pass-through remains 138/2/329.265; live O50 reproduces 41-point saved geometry | No version/state divergence |
| `lost run` | 245 canonical, 3 runs, 753.311 m; 68 Final | Canonical pass-through remains 245/3/753.311; live O50 reproduces fingerprint `010ce8da` and 68 points | No Final divergence; segment-ID reversal reproduces because it is persisted input |

Original raw GPS cannot be replayed because it was not retained after process recovery. The replay therefore verifies canonical persistence, segment-aware distance, and Final, not the unobservable raw decisions during `lost run`.

## Run metrics

Current Run source computes pace as:

```text
active duration seconds / (saved distance metres / 1000)
```

For `lost run`, 614 s / 0.753311 km = 814.93 s/km, displayed as approximately **13:35 min/km**. This is mathematically correct for the saved Activity.

It is semantically problematic in two independent ways:

- The label is `LIVE PACE`, but the value is whole-Activity average pace, not instantaneous pace.
- The honest Gap contributes elapsed/active time while 673.941 m of unobserved straight-line displacement is not credited. Physical distance and pace through that interval are unknowable, so the displayed average can be materially slower than physical pace.

No connector distance should be invented to “correct” it. Classification: **PRODUCT DESIGN ISSUE, P2, HIGH confidence** for the label; **EXPECTED BUT UX-CONFUSING, P2** for average pace under truthful missing evidence.

## Finish timing

### `hike ka`

| Finish phase | Duration |
| --- | ---: |
| Source fence / reconciliation | 1.163 s |
| O50 total wall phase | 3.792 s |
| Map Matching aggregate request time | 6.130 s; requests overlap |
| Directions aggregate request time | 0.770 s; requests overlap |
| Memory reconciliation | 0.939 s |
| Payload serialization | 0.002 s |
| Local durable completion | 0.999 s |
| Server save request duration | Unavailable; PATCH observed ~63 s after local completion |
| Navigation | Unavailable |
| Finish request -> local completion | 6.952 s |
| Finish request -> observed server save | about 70 s |

The 6.952 s is actual Finish work visible to the client. The later PATCH is pending-sync latency and is not proof the UI blocked for 70 s.

### `lost run`

| Finish phase | Duration |
| --- | ---: |
| Source fence / O50 / matching / Directions / local persistence / navigation | Unavailable |
| Saved end -> observed server finalization | about 9 min |

The last canonical point is at 12:17:59, the saved end is 12:18:42, an app-start event occurs at 12:18:28, and the final server save appears at 12:27:42 after another app start. This proves eventual durable recovery but cannot distinguish Finish CPU latency, a pending save, process death, or UX feedback. Classification: **INSUFFICIENT EVIDENCE, P2** for Finish UX; the delayed server durability itself is real.

## Cairns / Plants

Neither Activity contains a persisted Cairn or Plant. There is therefore no valid coordinate age, linkage, server ID, title, visibility, or Trails discoverability row to report. The two lost-run-time marker 400s are retained only as unexplained network evidence and are not counted as Cairns.

## Energy-related workload indicators

### `hike ka`

| Work | Foreground | Background |
| --- | ---: | ---: |
| Raw callbacks/min | <=35.27 over measured provider elapsed | <=46.49 over measured provider elapsed |
| WAL writes/min | Source split unavailable; >=135 operations / 5.93 active min = >=22.75 overall | Source split unavailable |
| Map source updates/min | About 35.8 over measured FG provider elapsed | 0 observed while fully backgrounded |
| Memory writes/min | Source split unavailable; 18 / 5.93 = 3.03 overall | Source split unavailable |
| Activity-related network requests/min | Phase split unavailable | Phase split unavailable |

One Expo authority is the expected location cost. Presentation shuts down in background and at Pause. The excess foreground work is route projection rebuild and QA serialization/upload, not a second GPS client.

### `lost run`

The retained opening is too short for representative FG/BG rates. Across the whole saved Activity, canonical acceptance is 23.9 points/min; before the outage the first run is 52.8 points/min. WAL and map rates are unavailable after telemetry cutoff. Zero map presentation updates are observed in the retained background interval. Memory performs 17 requests over the Activity, including 15 failures in about 3.5 min (about 4.3 failed requests/min during the storm).

No physical start/end battery or thermal record is available. Battery acceptance cannot be claimed.

## Ranked suspicious windows

| Rank | ID | Activity | UTC interval | Duration | Data symptom and consequence | Likely layer | Classification | Severity | Confidence |
| ---: | --- | --- | --- | ---: | --- | --- | --- | --- | --- |
| 1 | O52F-01 | `lost run` | 12:11:46–12:17:14 | 328.002 s | No source/canonical evidence; 673.941 m plausible relocation; correct Gap and missing distance | Native source / lifecycle / process | LIKELY BUG | P1 | High anomaly, medium cause |
| 2 | O52F-02 | `hike ka` | 12:04:44–12:06:13 | 89.703 s | Process recovery boundary; 84.940 m unobserved and uncredited | Lifecycle / process recovery | LIKELY BUG | P1 | High anomaly, medium cause |
| 3 | O52F-03 | `lost run` | 12:17:18–12:17:59 | 41 s | New segment lasts two points, then 30 points reuse old pre-Gap ID; extra presentation break | Background context / canonical provenance | CONFIRMED BUG | P1 | High |
| 4 | O52F-04 | `hike ka` | 12:04:05–12:05:11 | ~66 s | 32 s inactive delay; BG source starts while app already active; late/bad callbacks precede process recovery | AppState ownership lifecycle | LIKELY BUG | P1 | High sequence, medium causality |
| 5 | O52F-05 | `hike ka` | Whole foreground route | 138 builds | `routeProjectionRebuilt=true` for normal appends; full projection rebuilt instead of incremental identity path | Map presentation efficiency | CONFIRMED BUG | P1 | High |
| 6 | O52F-06 | `lost run` | 12:08:15–12:11:46 | ~211 s | Fifteen Memory 401s at 15 s cadence; no truth loss, repeated radio/network work | Memory network backoff | CONFIRMED BUG | P1 | High |
| 7 | O52F-07 | `hike ka` | Whole QA session | 6.27 min | 1,066 merged events / 950 KB; full-array durable critical flush; aggregate delta duplication | QA telemetry | CONFIRMED BUG | P1 | High |
| 8 | O52F-08 | `lost run` | ~12:09:53 onward | remainder | QA 401 terminates telemetry; tracking survives but ownership/energy proof is missing | QA upload/auth | CONFIRMED BUG | P1 observability | High |
| 9 | O52F-09 | `hike ka` | 12:00:33–12:00:42 | 8.912 s | Puck/raw up to ~33 m ahead while canonical rejects/quarantines | Sensor acquisition / presentation | EXPECTED BUT UX-CONFUSING | P2 | High |
| 10 | O52F-10 | `hike ka` | 12:06:07–12:06:13 | ~6 s | Idle Apple provider and interrupted camera fly before recovered Activity custom provider | Recovery presentation | EXPECTED BUT UX-CONFUSING | P2 | High |
| 11 | O52F-11 | `hike ka` | 12:01:58–12:02:20 | ~22 s | Short reversal/detour under 14–20 m hAcc and invalid course | Sensor evidence | DATA QUALITY LIMITATION | P2 | Medium |
| 12 | O52F-12 | `hike ka` | 12:06:13 | 0.471 s | One WAL recovery-generation commit spike; data remains durable | Persistence latency | EXPECTED / ACCEPTABLE | NOT A DEFECT | High |
| 13 | O52F-13 | `lost run` | 12:17:10–12:17:17 | ~7 s | Two marker POST 400 responses; zero marker persisted or linked | Marker sync | INSUFFICIENT EVIDENCE | P2 | Medium |
| 14 | O52F-14 | `lost run` | End -> server final | ~9 min | Final server save delayed across app starts; local Finish phases missing | Recovery / pending sync | INSUFFICIENT EVIDENCE | P2 | High delay, low UX cause |

## What clearly worked

- Both Activities used the O52 BestForNavigation + 1 m precision contract.
- Healthy BG intervals delivered dense evidence rather than retaining the former 5 m policy.
- First two Hike FG/BG handoffs stopped one source, drained ordered evidence, and started the other with zero overlap.
- Lost Run's retained opening handoff also had zero overlap.
- The custom RNMapbox provider stopped in background and at Hike Pause; no fully-background map-source work was observed.
- Stationary/Candidate filtering did not accumulate false stationary distance or create a false red-light Gap.
- Owner fencing rejected pre-owner/stale duplicate evidence; no duplicate canonical coordinates/timestamps were found.
- The true 328 s source loss became an honest Gap and did not receive invented connector distance.
- WAL recovery preserved 129 Hike records across process interruption and all 245 Run records through eventual recovery.
- Hike persistence bytes were append-linear with no per-point checkpoint or full-history rewrite.
- Memory truth survived failures: 13 Hike and 42 Run cells reached the server.
- O50 preserved all canonical continuity breaks, did not steal a wrong road, and replayed both saved Final geometries.
- Hike accepted one safe short road-offset section; unsafe network candidates in both Activities fell back conservatively.
- Major Run corridor turns and the Hike's plausible delayed 41 s edge remained visible.
- Hike Finish reached local durable completion in 6.952 s and tracking stopped before Final work.

## Issue matrix

| ID | Activity | Finding | Layer | Classification | Severity | Confidence |
| --- | --- | --- | --- | --- | --- | --- |
| O52F-01 | `lost run` | 328 s / 674 m evidence outage | Native location/lifecycle | LIKELY BUG | P1 | High anomaly / medium cause |
| O52F-02 | `hike ka` | 89.7 s / 84.9 m process-recovery loss | Lifecycle/recovery | LIKELY BUG | P1 | High anomaly / medium cause |
| O52F-03 | `lost run` | Segment ID reverts after correct reacquisition | Canonical provenance | CONFIRMED BUG | P1 | High |
| O52F-04 | `hike ka` | Delayed inactive/background transition and BG start while active | Ownership lifecycle | LIKELY BUG | P1 | Medium-high |
| O52F-05 | `hike ka` | Incremental route projection always rebuilds | Map efficiency | CONFIRMED BUG | P1 | High |
| O52F-06 | `lost run` | Fixed 15 s retry on Memory 401 | Network/Memory | CONFIRMED BUG | P1 | High |
| O52F-07 | Both | QA full-array critical flush / unstable coalesced delta identity | Telemetry efficiency | CONFIRMED BUG | P1 | High |
| O52F-08 | `lost run` | QA 401 removes most field observability | Telemetry/auth | CONFIRMED BUG | P1 | High |
| O52F-09 | `hike ka` | Startup puck ahead of truthful route | Presentation/sensor | EXPECTED BUT UX-CONFUSING | P2 | High |
| O52F-10 | `hike ka` | Recovery idle-provider camera fly before Activity restore | Camera/presentation | EXPECTED BUT UX-CONFUSING | P2 | High |
| O52F-11 | `hike ka` | Short uncertain BG detour | Sensor | DATA QUALITY LIMITATION | P2 | Medium |
| O52F-12 | `hike ka` | Isolated 471 ms WAL recovery commit with no data loss | Persistence latency | EXPECTED / ACCEPTABLE | NOT A DEFECT | High |
| O52F-13 | `lost run` | Two unlinked marker 400s | Marker sync | INSUFFICIENT EVIDENCE | P2 | Medium |
| O52F-14 | `lost run` | Nine-minute server finalization delay | Save/recovery | INSUFFICIENT EVIDENCE | P2 | Medium |
| O52F-15 | `lost run` | `LIVE PACE` is saved whole-Activity average and is distorted by missing evidence | Product metric semantics | PRODUCT DESIGN ISSUE | P2 | High |

## Freeze opinions

### Tracking freeze

**NOT READY.** Exact blockers before freeze are:

1. Explain and contain the material source/lifecycle interruptions seen in both O52 sessions.
2. Correct the post-reacquisition segment-provenance reversal demonstrated by `lost run`.
3. Restore reliable low-overhead terminal telemetry so a later field run can prove ownership and persistence through the full Activity.

The correct Gap behavior itself is not a blocker; it is evidence that O52 failed honestly when the source disappeared.

### Final freeze

**READY WITH KNOWN LIMITATIONS.** O50 is conservative, reproduces both saved outputs, preserves discontinuities, accepts only one safe short road-offset island, and shows no wrong-road or `great hike` endpoint-blend recurrence. Final cannot reconstruct movement that was never observed, and the second Run break is upstream segment provenance.

### Energy measurement readiness

**NOT READY / CONFOUNDED.** A physical battery test now would mix the intended BestForNavigation cost with confirmed QA, route-projection, and Memory-retry overhead. It would also lack complete Run telemetry. No battery or thermal acceptance is claimed.

## Artifact decision

The machine-readable handoff is `docs/review/activity-real/o52-field/O52_BLIND_FIELD_HANDOFF.json`. An optional HTML overlay was intentionally not created: original raw GPS and accepted/rejected network geometries were not durably retained for both sessions, so a four-layer overlay would misleadingly present canonical recovery payload as raw evidence.

No source, threshold, UI, O50, telemetry, marker, deployment, OTA, or O marker was changed during this forensic.
