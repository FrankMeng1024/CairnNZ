# O51 REAL FIELD FORENSIC VERDICT

## Executive verdict

The three production Activities are unambiguously identified and are useful field evidence. They do **not** support a broad GPS, cadence, Stationary V2, candidate, or Hike-versus-Run tracking change.

They do prove one narrow tracking defect: `run issue` contains a false segment break across the red-light stop. The break is not inferred from a screenshot. The saved Final has an explicit `gps-reacquired` boundary over 121 seconds and 11.937 m, and the current background classifier can be shown to make that wrong decision because its persisted prior point contains `acc` while the shared classifier reads `accuracy`. That missing field becomes the 25 m fallback and makes a merely long interval look “spatially uncertain.” With the recorded 14.246 m value, the same interval stays continuous.

The other route observations divide into:

- correct candidate/stationary holding that was visually hard to interpret (`GH-1`);
- movement below available GPS resolution (`GH-2`, `RI-2`, `MS-1`);
- a bounded O50 display-compositor artifact, not canonical corruption (`GH-3`);
- product/UX gaps independent of GPS (`RI-3` through `RI-8`, except the still-unresolved camera evidence in `RI-5`).

No product code, data, thresholds, tracking configuration, UI, backend, OTA marker, or deployed system was changed during this audit.

## Evidence and privacy

Primary evidence was read-only production session data, persisted raw/Final geometry, uploaded QA JSONL, current O51 source, and a post-hoc walking-network comparison. All report coordinates are local metres relative to each Activity's first raw point:

```text
Activity start/reference = (0,0)
x = east-positive metres
y = north-positive metres
```

Exact coordinates are deliberately excluded from repository artifacts. UTC is used throughout.

## Activity identity

| Field | `great hike` | `run issue` | `mstand` |
| --- | ---: | ---: | ---: |
| Server id | `2074` | `2075` | `2076` |
| Client Activity id | `52a9fc6e-e587-4177-8dbb-cfddd4cb61ce` | `1585cb3e-6d4f-4159-bbdf-0bca3a4e7f16` | `d041fe82-0542-4cf9-81bc-22797fe06083` |
| Mode | Hike | Run | Run |
| App / build / OTA | `0.2.6` / `56` / `O51` | `0.2.6` / `56` / `O51` | `0.2.6` / `56` / `O51` |
| OS | iOS 26.6.1 | iOS 26.6.1 | iOS 26.6.1 |
| Start | 07:51:24 | 07:55:14 | 08:02:57 |
| End | 07:54:48 | 08:02:02 | 08:04:52 |
| Finalized | 07:54:54 | 08:02:07 | 08:05:00 |
| Wall elapsed | 204 s | 408 s | 115 s |
| Saved active duration | 195 s | 400 s | 110 s |
| Saved distance | 177.025 m | 691.839 m | 251.613 m |
| Raw callback count | 99 | 119 | 40 |
| Canonical count | 88 | **not recorded** | 38 |
| Final point count | 18 | 53 | 22 |
| Canonical route length | 177.025 m | 691.839 m | 251.613 m |
| Final route length | 172.516 m | 681.065 m | 249.241 m |
| Segments / Gaps | 1 / 0 | 2 / 1 | 1 / 0 |
| Pause / resume | 1 / 0, Finish fence | **not recorded** | 1 / 0, Finish fence |
| Foreground duration | 147.67 s | **not recorded**; first 4.49 s proven foreground | 4.39 s |
| Background duration | 47.26 s | **not recorded** | 106.25 s |
| Quick Cairns | 0 | 1 user-observed; 0 matching server rows | 0 |
| Final reconstruction | O50 hybrid; road-offset + canonical fallback | O50 stored two-section Final; subsection telemetry missing | O50 canonical-derived fallback |

The Run canonical count is unavailable because its QA stream stopped after the first five seconds and the server persists raw plus Final, not the complete pre-Final canonical array. It must not be inferred from the 53 resampled Final points.

## Required issue matrix

| ID | Activity | Observation | Layer | Classification | Severity | Confidence | One-line reason |
| ---- | ----------- | ------------------------------ | ----- | -------------- | -------- | ---------- | --------------- |
| GH-1 | great hike | abrupt stop / line catch-up | Canonical → Live | **EXPECTED BUT UX-CONFUSING** | P2 | High | Raw continued; the reducer held uncertain fixes, rejected one poor fix, then promoted movement while the independent puck kept updating. |
| GH-2 | great hike | left two steps appears right | Raw sensor | **DATA QUALITY LIMITATION** | P2 | High | Raw GPS itself showed 1.7–2.8 m right with ~14.25 m hAcc; Cairn did not flip left evidence. |
| GH-3 | great hike | Final bends inward | O50 Final compositor | **PRODUCT DESIGN ISSUE** | P2 | Medium-high | A straight network skeleton plus stable road offset is blended to exact canonical endpoints, creating a bounded ~2.24 m curve. |
| RI-1 | run issue | red-light disconnect | Background segmentation | **CONFIRMED BUG** | P1 | High | A stored `acc`/classifier `accuracy` mismatch turns the real 14.25 m prior accuracy into 25 m and falsely opens a Gap at 121 s. |
| RI-2 | run issue | roadside drift | Raw sensor / Final | **DATA QUALITY LIMITATION** | P2 | Medium-high | 95% of hAcc is ~14.25 m, larger than lane-side separation; Final largely follows that evidence. |
| RI-3 | run issue | weak Quick Cairn feedback | Quick Cairn UX | **UX ISSUE** | P1 | High | Commit is locally durable, but feedback lasts 1.5 s and Run shows neither the marker nor persistent session state. |
| RI-4 | run issue | 9:38/km | Metric definition | **PRODUCT DESIGN ISSUE** | P1 | High | Math is exact for cumulative active-session average, but the UI labels it `LIVE PACE` and includes unpaused stops. |
| RI-5 | run issue | foreground map not recentered | Camera/lifecycle | **INSUFFICIENT EVIDENCE** | P1 | High that attribution is unresolved | Return/follow/camera events are missing; source intentionally preserves manual-pan state but has no explicit AppState-return intent restoration. |
| RI-6 | run issue | Finish feels frozen | Finish feedback | **UX ISSUE** | P1 | High | No blocked-thread evidence; O50/network dominates nearby saves, while Run loses Hike's spinner and phase-specific sheet feedback. |
| RI-7 | Hike vs Run | lifecycle inconsistency | Activity UX | **UX ISSUE** | P1 | High | Engine/lifecycle authority is shared, but Finish presentation and follow-reset composition diverge. |
| RI-8 | run issue | Untitled Cairn / no enrichment | Quick Cairn product loop | **PRODUCT DESIGN ISSUE** | P1 | High | Empty content is valid storage, generic fallback leaks to UI, and Activity-linked Cairns have no Finish enrichment handoff. |
| MS-1 | mstand | roadside tracking | Raw sensor / Final | **DATA QUALITY LIMITATION** | P2 | High | ~14.25 m hAcc cannot prove a road side; O50 rejected network display and remained within 2.33 m of canonical. |
| MS-2 | mstand | crossing/avoidance | Canonical / Final | **EXPECTED / ACCEPTABLE** | NOT A DEFECT | High | One continuous canonical-derived segment preserves the path to sensor resolution with no false Gap or network coercion. |

## `great hike`

### Physical truth and broad result

The initial stand, crossing/left turn, short stop, longer forward movement, abrupt stop and restart are all present at the scale the sensor can support. The Activity has one canonical segment and no Gap. Raw length was 236.077 m because it includes rejected/uncertain evidence; canonical saved distance was 177.025 m; O50 Final was 172.516 m.

### GH-1 — abrupt stop and line catch-up

#### Observation

After the abrupt stop, the puck appeared ahead of the line; the line later caught up. The visual straight connection raised a question about missing GPS callbacks.

#### Evidence

| Raw | Time | Δt | x / y m | hAcc | Reported speed | Canonical decision |
| ---: | --- | ---: | --- | ---: | ---: | --- |
| 82 | 07:53:38.000 | 3 s | -89.1 / -51.3 | 14.25 m | 0.55 m/s | ACCEPT coherent motion |
| 83 | 07:53:39.000 | 1 s | -90.8 / -50.3 | 14.25 m | 0.90 m/s | ACCEPT coherent motion |
| 84 | 07:53:40.000 | 1 s | -91.8 / -49.6 | 14.25 m | 0.85 m/s | ACCEPT coherent motion |
| 85 | 07:53:43.000 | 3 s | -91.4 / -50.5 | 14.25 m | 0.06 m/s | QUARANTINE possible stationary jitter |
| 86 | 07:53:48.000 | 5 s | -91.1 / -51.7 | 14.25 m | 0.00 m/s | QUARANTINE awaiting confirmation |
| 87 | 07:53:49.000 | 1 s | -91.0 / -52.0 | 14.25 m | 0.05 m/s | QUARANTINE possible stationary jitter |
| 88 | 07:53:52.844 | 3.84 s | -104.5 / -76.5 | **31.0 m** | unavailable | **REJECT poor accuracy** |
| 89 | 07:53:53.613 | 0.77 s | -99.8 / -48.3 | 18.28 m | 1.26 m/s | QUARANTINE awaiting confirmation |
| 90 | 07:53:58.613 | 5 s | -101.8 / -54.4 | 14.0 m | 1.45 m/s | QUARANTINE, then promoted |
| 91 | 07:53:59.613 | 1 s | -103.0 / -56.7 | 6.06 m | 1.45 m/s | ACCEPT new direction confirmed |
| 92 | 07:54:02.613 | 3 s | -106.2 / -62.2 | 3.86 m | 1.98 m/s | ACCEPT coherent motion |

There is no Core Location silence at the stop. The largest local interval before background is 5 seconds. Raw 88 is a real callback, but its 31 m hAcc exceeds the 25 m acceptance boundary and its coordinate is visibly inconsistent; rejecting it is correct.

The canonical head intentionally held from raw 84 at 07:53:40 to promoted raw 90 at 07:53:58.613: 18.613 seconds. RNMapbox's puck path remained active at approximately 1 Hz through 07:53:48. The greatest measured puck-to-canonical separation before the app backgrounded was 2.18 m. Once movement became coherent, raw 90 and 91 entered truth and the line caught up.

Live route target animations were bounded to roughly 720–864 ms per accepted head and slept while no new canonical target existed. Exact GPU/display-frame timing is not recorded, so 2.18 m is a target-to-canonical measurement, not a claimed pixel-perfect rendered distance.

#### Mechanism

This was a combination of Stationary V2 candidate holding plus an independently updating Mapbox puck. It was not callback loss, a Gap, or Final reconstruction. The later straight connection represents delayed acceptance between real observations, not invented or missing source evidence.

#### Classification

**EXPECTED BUT UX-CONFUSING — P2 — high confidence.** The underlying behavior protects route truth. Any future work belongs to presentation/state communication, not tracking thresholds.

Evidence that would change this conclusion: a frame-level trace showing the Live line failed to consume the promoted points, or a raw native callback log contradicting the persisted raw sequence.

### GH-2 — two steps left appear right

#### Evidence and left/right method

“Left/right” was computed from a stable local travel vector, never from screen orientation. Positive cross-track is left. Relative to that vector:

- raw 83: **-1.74 m** (right);
- raw 84: **-2.80 m** (right);
- hAcc for both: **14.25 m**;
- the physical two-step movement is approximately 1–2 m.

Canonical accepted raw 83/84 as received. Final retains the raw 84 position at 07:53:40. There is no evidence of a raw-left → canonical-right transformation. The raw sensor never resolved the physical left excursion in the first place.

#### Classification

**DATA QUALITY LIMITATION — P2 — high confidence.** A 1–2 m lateral action is materially smaller than the reported ~14 m horizontal uncertainty. It should not motivate a GPS, candidate, smoothing, or O50 change.

Evidence that would change this conclusion: several consecutive high-quality fixes (roughly ≤3–5 m hAcc) showing a statistically stable left excursion that canonical or Final moves right.

### GH-3 — inward bend on a straight road

#### Evidence

O50 did improve the overall route:

- canonical 177.025 m → Final 172.516 m;
- Final/canonical ratio 0.9745;
- canonical-to-Final displacement p50/p95/max 0.468 / 1.797 / 2.584 m;
- no rejected or shrunk seam;
- 40.414 m accepted Directions-derived display, 136.611 m canonical fallback;
- one road-offset section, two free traversal sections, three canonical-derived sections;
- Map Matching timed out twice; two bounded Directions calls succeeded.

A post-hoc walking Directions skeleton for the reported tail is nearly straight. Signed offsets from that skeleton are:

| Time | Final x / y m | Offset | Role |
| --- | --- | ---: | --- |
| 07:53:58.613 | -101.8 / -54.4 | -13.67 m | Exact canonical subsection endpoint |
| 07:54:09.611 | -110.9 / -64.8 | -11.43 m | Stable road-offset Final |
| 07:54:20.361 | -121.3 / -73.2 | -11.43 m | Stable road-offset Final |
| 07:54:30.000 | -131.2 / -80.0 | -11.93 m | Exact canonical Activity endpoint |

The network skeleton is not the curved object. O50 estimates a stable parallel pedestrian corridor of about -11.43 m, but its atomic boundary policy preserves the section's exact -13.67 m canonical start and the Activity's exact -11.93 m end. Blending those endpoints into the stable offset produces the visible inward curve, about 2.24 m at the larger transition.

#### Classification

**PRODUCT DESIGN ISSUE — P2 — medium-high confidence.** The fault domain is the O50 road-offset/end-anchor compositor. Canonical truth is straight enough; Mapbox skeleton is straight enough; projection is not the cause. The artifact is bounded inside O50's validated displacement envelope and does not justify retuning tracking.

Evidence that would change this conclusion: the exact saved Directions response showing a curved skeleton, or untruncated O50 section telemetry showing a different geometry mode for that range.

## `run issue`

### Raw quality and bicycle relevance

The bicycle does not invalidate this session. Reported speed p95 was 3.503 m/s (12.61 km/h) and maximum 4.576 m/s (16.47 km/h), plausible for fast running or a short sprint and safely below Run's 10 m/s continuity ceiling. Coordinate-derived speed reached 6.564 m/s (23.63 km/h), where bicycle acceleration/turn dynamics become less representative. The red-light, background, camera, Finish, Quick Cairn and pace observations remain directly relevant to Run.

Raw temporal/accuracy summary:

| Metric | Value |
| --- | ---: |
| Callbacks / span | 119 / 394.824 s |
| Callback p50 / p95 / max | 2.0 / 6.45 / 59 s |
| Gaps >2 / >3 / >5 / >10 s | 17 / 8 / 7 / 5 |
| hAcc p50 / p95 / worst | 14.246 / 14.246 / 14.246 m |
| ≤5 / 5–10 / 10–20 / >20 m | 0.84% / 4.20% / 94.96% / 0% |
| Reported speed p50 / p95 / max | 1.946 / 3.503 / 4.576 m/s |
| Derived speed p50 / p95 / max | 3.170 / 5.185 / 6.564 m/s |

The source-quality limitation is predominantly spatial, not a complete lack of callbacks.

### RI-1 — red-light disconnect

#### Observation

The user stopped for roughly one minute at a red light. The saved route visibly has two sections.

#### Source evidence

| Raw | Time | Δt | x / y m | hAcc | Reported speed | Final role |
| ---: | --- | ---: | --- | ---: | ---: | --- |
| 17 | 07:56:10 | 2 s | -55.4 / -33.7 | 14.25 m | 2.72 m/s | Last point, segment 1 |
| 18 | 07:56:38 | 28 s | -61.8 / -28.2 | 14.25 m | 0.01 m/s | Raw callback during stop |
| 19 | 07:57:37 | 59 s | -60.8 / -33.1 | 14.25 m | 0.81 m/s | Raw callback during stop |
| 20 | 07:58:11 | 34 s | -67.2 / -31.9 | 14.25 m | 1.74 m/s | First Final point, segment 2 |

Raw callbacks continued. The maximum interval was 59 seconds, expected to be sparse while a 5 m background distance filter observes a stationary user. No app-state or provider-restart telemetry survived for this period, but source evidence did not vanish for 121 seconds.

#### Canonical and Final evidence

The persisted Final explicitly records:

```text
segment 1 tail = 07:56:10.000
segment 2 head = 07:58:11.000
segment_start_reason = gps-reacquired
interval = 121.000 s
endpoint displacement = 11.937 m
distance contribution = 0
Memory bridge = forbidden
```

This is not a Live rendering seam. O50 preserved the upstream canonical segment boundary as it should.

#### Proven mechanism

The headless background path reads the persisted tail directly and passes it to `shouldStartNewSegment` as `previous` ([backgroundLocationTask.ts](../../../app/src/services/backgroundLocationTask.ts#L300)). Stored track points define accuracy as `acc`; the classifier reads `previous.accuracy` and substitutes 25 m when absent ([activityContracts.ts](../../../app/src/features/activity/activityContracts.ts#L145)). The same file already normalizes `acc → accuracy` for restoring Stationary V2 state, but not for the separate segment-classifier call.

For this exact field interval:

```text
dt = 121,000 ms
distance = 11.937 m
next accuracy = 14.246 m

current stored shape:
  previous.accuracy missing → fallback 25 m
  longAndSpatiallyUncertain = true because previousAccuracy > 15
  startNewSegment = true

same evidence, normalized:
  previousAccuracy = 14.246 m
  distance < 2 × uncertainty
  neither endpoint accuracy > 15
  implied speed = 0 after uncertainty
  startNewSegment = false
```

The 121-second boundary is especially diagnostic: it is one second beyond `MAX_CREDITABLE_ACTIVE_INTERVAL_MS`, so the schema mismatch changes the result while all physical values remain benign.

#### Classification

**CONFIRMED BUG — P1 — high confidence.** Fault domain: the background/headless segment-classifier input adapter, not Core Location, Stationary V2 candidate logic, Mapbox, presentation, or O50.

Evidence that would change this conclusion: an exact on-device journal proving the prior object had a real `accuracy > 15` field before the call, or a different known-loss event proving the saved boundary was intentionally opened earlier. Current persisted shape and source contract point the other way.

### RI-2 — route does not remain on the right side

#### Evidence

The sensor's p50 and p95 hAcc are approximately 14.25 m. Roadside/lane-side separation is typically smaller. Against a current walking-network comparison:

| Corridor | Raw median absolute / p95 | Final median absolute / p95 | Predominant signed side |
| --- | --- | --- | --- |
| Before the turn | 6.69 / 26.98 m | 5.14 / 15.43 m | Raw 79%, Final 74% same side |
| After the turn | 8.79 / 17.94 m | 8.65 / 22.30 m | Raw 80%, Final 74% same side |

These are post-hoc reference comparisons, not the saved O50 candidate skeleton. The saved O50 subsection/confidence/network telemetry is missing, so it is not possible to claim exactly which network mode was chosen.

What is knowable is that Final did not create a wholesale extra detour: raw same-segment length was 717.725 m, canonical saved length 691.839 m, and Final 681.065 m (ratio 0.9844). The explicit false Gap accounts for one missing 11.937 m connector. Remaining side variation is present in raw evidence and is of the same order as hAcc.

Hike and Run use the same BestForNavigation source, 1 m foreground filter, 5 m background filter, reducer, Live pipeline and O50. The only tracking-mode threshold difference is maximum plausible movement speed: Hike 4.17 m/s, Run 10 m/s. The measured session is below Run's ceiling.

#### Classification

**DATA QUALITY LIMITATION — P2 — medium-high confidence.** This session is not evidence that Run tracking is worse than Hike. It is evidence that a phone reporting ~14 m uncertainty cannot reliably retain which side of a road the user occupied.

Evidence that would change this conclusion: the missing O50 sections showing a high-confidence opposite-side network choice despite stable, tighter raw evidence; or a replay showing Final materially increases cross-track error beyond its input.

### RI-3 — Quick Cairn feedback

#### Current flow and durability

Run takes the last canonically accepted Activity coordinate if it is no older than 30 seconds; it does not make a second GPS request. It creates a private `type=cairn`, empty-note object, and includes the live Activity client id. `addMarker` first awaits offline-first `saveLocal`; only after that succeeds does Run append the marker id to Activity state and show `Cairn planted` for exactly 1,500 ms ([RunningScreen.tsx](../../../app/src/screens/RunningScreen.tsx#L501), [useMarkerStore.ts](../../../app/src/store/useMarkerStore.ts#L221)).

Therefore the observed success toast means the local durable commit succeeded. The user's later ability to open `Untitled Cairn` in Trails corroborates local persistence. At audit time there was no matching server marker row, so server sync, UUID and actual persisted provenance/linkage cannot be proved from server data.

Run passes `markers={[]}` to the map. It has no marker, count, recent-Cairn tray, or other persistent in-session confirmation. The only feedback disappears in 1.5 seconds.

#### Classification

**UX ISSUE — P1 — high confidence.** It is not a functional save failure. It is an incomplete feedback/rediscovery loop that reasonably makes a successful action look uncertain.

Evidence that would change this conclusion: the local outbox showing the object disappeared after the success toast, which would elevate this to a durability bug.

### RI-4 — exact `9:38 /km` pace forensic

Run's displayed pace is:

```text
seconds per kilometre = durationS / (distanceM / 1000)
```

`durationS` is shared active lifecycle time. Explicit Pause and the Finish-intent pause are excluded. A red-light stop is included if the user did not press Pause. Foreground/background does not change it. `distanceM` is canonical same-segment distance; Gap connectors contribute no distance even though their unpaused time remains in the numerator.

Exact reconstruction:

```text
time used = 400 s
distance used = 691.839 m = 0.691839 km
pace calculation = 400 / 0.691839 = 578.169 s/km
displayed result = 9 min 38.17 s/km → 9'38"/km
```

So **9:38/km is mathematically correct under current implementation**.

It is not accurately named `LIVE PACE`. It is a cumulative active-session average that includes stationary-but-unpaused time. Product intent is therefore weak even though implementation is correct.

Sensitivity, not a replacement metric:

- wall elapsed 408 s → 9:50/km;
- subtract only the user-reported 60 s red light → 8:11/km;
- moving-only pace → **not recorded**;
- credit only the 11.937 m connector lost by RI-1 → 9:28/km, about 9.8 s/km faster.

#### Classification

**PRODUCT DESIGN ISSUE — P1 — high confidence.** The confirmed Gap materially worsens pace but does not explain most of 9:38; unpaused stationary time is the dominant semantic issue.

### RI-5 — returning from background does not recenter

#### Known source behavior

Before the initial background transition, Run follow state defaults true and no manual gesture was recorded. The final uploaded lifecycle event is background at 07:55:19.760. Everything needed after that—foreground time, first canonical fix, first RNMapbox update, follow state, camera center and recenter action—is missing.

Source behavior is clear:

- Run resets follow to `true` on navigation focus, not on an AppState foreground event ([RunningScreen.tsx](../../../app/src/screens/RunningScreen.tsx#L384));
- a map gesture sets follow `false`;
- `HikingMap` forwards that flag to RNMapbox `followUserLocation` ([HikingMap.tsx](../../../app/src/screens/HikingMap.tsx#L961));
- the first-real-location fly-to is once per map mount, not once per app foreground ([HikingMap.tsx](../../../app/src/screens/HikingMap.tsx#L615)).

Thus two behaviors are possible:

1. If the user had manually panned before background, the current design intentionally preserves that viewport and does not restore follow.
2. If follow was still true, RNMapbox should follow on resumed locations, but Cairn does not explicitly reassert or verify that state.

`mstand` is a useful control: it foregrounded at 08:04:44.863, activated the foreground source by 08:04:44.959, and assigned a Mapbox target at 08:04:45.188. That target jumped 234.86 m from the stale Mapbox location and was only 2.48 m from canonical. It proves the shared position/puck path can refresh promptly; it does not prove the camera center moved.

#### Classification

**INSUFFICIENT EVIDENCE — P1 — high confidence that attribution is unresolved.** Location correctness and camera correctness cannot be separated for this exact return. The most likely fault domain is camera intent/lifecycle, not canonical tracking, but “likely” is not enough to recommend unconditional recenter.

```text
INSUFFICIENT EVIDENCE:
missing: app-active timestamp, first canonical fix, first RNMapbox fix, follow state, camera center, gesture history
why it matters: distinguishes stale location from preserved manual viewport or lost follow intent
best way to capture next time: retain existing APP and MAP_STATE QA events through upload; no new instrumentation is automatically added here
```

### RI-6 — Finish feels frozen

#### Real-session evidence

The Run's fine-grained Finish QA did not upload. Server timestamps only show end at 08:02:02 and finalized at 08:02:07, so roughly five seconds elapsed at server timestamp resolution. They cannot be partitioned into source drain, O50, network, persistence, navigation or Detail render.

The adjacent sessions show the actual cost shape:

| Activity | Source drain | O50 / network | Memory | Local + server persistence | Navigation / Detail | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| great hike | 90 ms | 6,234 ms | 96 ms | 181 ms | not recorded | 6,623 ms |
| run issue | not recorded | not recorded | not recorded | not recorded | not recorded | not recorded (~5 s DB end→finalized) |
| mstand | 51 ms | 7,887 ms | 37 ms | 142 ms | not recorded | 8,140 ms |

There is no evidence that the JS/UI thread froze. In both instrumented sessions, the dominant phase was bounded asynchronous O50 network waiting, not CPU, source teardown, serialization or persistence.

The UX divergence is source-proven. Hike retains `StopSummarySheet`, a spinner, and `savingHikeStep` such as upload/finalization phases. Run animates away its local naming sheet, calls `stopTracking`, then shows only the shared dock's `Completing activity / Securing your route` copy without spinner or granular phase ([RunningScreen.tsx](../../../app/src/screens/RunningScreen.tsx#L401), [ActivityRecordingChrome.tsx](../../../app/src/components/activity/ActivityRecordingChrome.tsx#L365)).

#### Classification

- Performance: **INSUFFICIENT EVIDENCE** for a Run-specific problem.
- Primary required classification: **UX ISSUE — P1 — high confidence.** The interface under-communicates a normal multi-second completion operation and differs from Hike.

### RI-7 — lifecycle consistency

| Lifecycle step | Hike | Run | Intentional difference? | Justified? |
| --- | --- | --- | --- | --- |
| Start | Shared mode selection → `startTracking` | Same | No | Yes, shared |
| Recording truth | Shared store/provider/reducer | Same | No | Yes, shared |
| Pause | Shared `pauseTracking`; provider fence | Same | No | Yes, shared |
| Resume | Shared new-segment/recovery path | Same | No | Yes, shared |
| Background/foreground | Shared ownership queue and provider handoff | Same | No | Yes, shared |
| Live map | Shared `HikingMap` / presentation geometry | Same | Trace color/metric hierarchy | Yes |
| Cairn action | Full Plant and markers visible | Quick private Cairn; no markers visible | Yes | Product rationale exists; feedback loop incomplete |
| Finish intent | Shared pause fence, shared eligibility | Same engine, separate local sheet | Mostly accidental | No |
| Saving feedback | Sheet spinner + granular `savingHikeStep` | Generic dock text after sheet dismisses | Accidental | No |
| Error/save-loss | Shared store authority | Shared store authority | No | Yes |
| Navigation to Detail | Shared MapHistory target | Same | No | Yes |
| Follow reset | Local Hike state; manual recenter | Run resets on navigation focus only | Accidental composition | Not fully defined for AppState return |

#### Classification

**UX ISSUE — P1 — high confidence.** Hike and Run are already functionally one Activity system. The divergence is presentation/intent handling, not duplicate tracking engines.

### RI-8 — `Untitled Cairn`

Quick Cairn deliberately writes an empty `note` and no separate title. The storage model permits this. UI surfaces then choose inconsistent generic fallbacks: `Untitled cairn` in cards and `(untitled)` in one sheet. That is storage/model fallback leaking into product language.

There is an edit route later in Marker Detail, but Quick Cairn does not present enrichment during Run or Finish. The Activity store does know marker ids through `linkMarker`, and the marker itself captures `originActivityClientId`; current Finish does nothing with that relationship. The user is expected to rediscover and edit later without a purposeful handoff.

#### Classification

**PRODUCT DESIGN ISSUE — P1 — high confidence.** Empty content can be valid for a one-tap trace; the defect is that the product has not defined how that trace is named, confirmed and enriched later.

## `mstand`

### Why it behaves differently

`mstand` is not evidence of better GPS hardware conditions. Its hAcc is essentially identical to `run issue`: p50/p95/worst all ~14.25 m. Its reported speed is somewhat higher (p50 2.584, p95 3.774 m/s), and it runs 106.25 of 110 active seconds in background.

It behaves better because:

- its longest background callback interval is 7 s, not 59 s;
- it never crosses the 120-second segment-classifier boundary;
- it has no long red-light stationary uncertainty;
- all 40 filter decisions and lifecycle events are retained;
- it remains one segment with no Gap;
- O50 rejects all network display candidates and uses canonical-derived Final rather than pulling the trace to a road skeleton.

Raw 1–38 produce 38 canonical points after one candidate promotion; raw 39–40 are held at the ending stop. Final is 249.241 m vs canonical 251.613 m, with canonical displacement p50/p95/max 0.388/2.299/2.325 m.

### MS-1 — roadside position

Against a current road reference, raw points predominantly occupy one signed side, but their median lateral distance is around 7–8 m while hAcc is ~14.25 m. The sensor can support corridor continuity, not lane-side truth. Because O50 accepted no network section, visible lateral behavior primarily belongs to raw/canonical evidence.

**DATA QUALITY LIMITATION — P2 — high confidence.**

### MS-2 — crossing and temporary avoidance

The local trace makes its turn/crossing excursion and continues chronologically. There is no segment break, no seam and no network coercion. A brief road-center avoidance is below exact observability, but O50 does not erase a strongly supported larger crossing.

**EXPECTED / ACCEPTABLE — NOT A DEFECT — high confidence.**

## Raw GPS health across Activities

| Activity | Callback p50 / p95 / max | >2 / >3 / >5 / >10 s | hAcc p50 / p95 / worst | Reported speed p50 / p95 / max |
| --- | --- | --- | --- | --- |
| great hike | 1.0 / 6.0 / 9 s | 21 / 15 / 6 / 0 | 14.246 / 14.246 / 31.0 m | 0.976 / 1.407 / 1.983 m/s |
| run issue | 2.0 / 6.45 / 59 s | 17 / 8 / 7 / 5 | 14.246 / 14.246 / 14.246 m | 1.946 / 3.503 / 4.576 m/s |
| mstand | 2.0 / 5.2 / 11 s | 15 / 5 / 2 / 1 | 14.246 / 14.246 / 14.246 m | 2.584 / 3.774 / 3.801 m/s |

Foreground/background details:

- `great hike` foreground raw 1–86: p50 1 s, p95 4.8 s, max 9 s. Background raw 87–98: p50 4 s, p95 5.5 s, max 6 s.
- `run issue`: split after 07:55:19 is **not recorded** in uploaded telemetry.
- `mstand` background raw 1–38: p50 2 s, p95 4.2 s, max 7 s; raw 39–40 follow foreground return.

## Canonical, stationary and Memory health

| Activity | Raw → canonical | Candidate evidence | Segment health | Longest meaningful raw-without-canonical interval | Memory consequence |
| --- | --- | --- | --- | --- | --- |
| great hike | 99 → 88 | 5 created, 2 confirmed; retained decisions compacted | 1 segment, 0 Gaps | 18.613 s at abrupt stop | No bridge problem; 11 server Memory points in session window |
| run issue | 119 → **not recorded** | **not recorded after first 5 s** | **2 segments, 1 false Gap** | 121 s Gap with 2 raw callbacks inside | Gap forbids Memory bridge; 27 server Memory points in session window |
| mstand | 40 → 38 | 2 created, 1 confirmed | 1 segment, 0 Gaps | ~13 s ending hold | No bridge problem; 9 server Memory points in session window |

Maximum raw-to-canonical displacement is **not recorded** as a complete array for these persisted sessions. Accepted and candidate-promoted observations preserve their raw coordinates; reporting an invented aggregate would be misleading.

Stationary V2 itself behaved well in all fully instrumented stops:

- `great hike` initial raw cloud radius 1.55 m;
- second stop radius 2.49 m, held until coherent exit;
- abrupt-stop valid cloud radius 6.90 m after excluding the correctly rejected 31 m-accuracy outlier, with zero immediate false canonical excursion;
- `mstand` ending cloud radius 1.50 m, raw 39–40 held, zero false distance.

The `run issue` red-light Gap is outside the Stationary V2 decision itself: it is created by the separate background segment classifier after acceptance.

## O50 Final forensic

| Activity | Geometry | Network state | Canonical → Final | Deviation p50 / p95 / max | Gap/seam result |
| --- | --- | --- | --- | --- | --- |
| great hike | Hybrid | 0 Map Matching islands; 2 Directions islands; 1 road-offset section | 177.025 → 172.516 m | 0.468 / 1.797 / 2.584 m | No Gap; no rejected/shrunk seam |
| run issue | Stored two-section Final | **not recorded** | 691.839 → 681.065 m | **not recorded** | Preserves upstream false Gap |
| mstand | Canonical-derived fallback | All 3 network requests timed out; 0 network sections | 251.613 → 249.241 m | 0.388 / 2.299 / 2.325 m | No Gap; no seam |

O50 is not the source of RI-1: Final correctly refuses to invent geometry across a canonical Gap. GH-3 is the only O50-specific concern, and it is a bounded display curve caused by endpoint anchoring.

## Hike / Run configuration proof

Hike and Run are truly one tracking engine with different product priorities:

- both call the same `useTrackingStore.startTracking` after setting mode;
- both use foreground Expo Location `BestForNavigation` with the current 1 m distance filter ([useTrackingStore.ts](../../../app/src/store/useTrackingStore.ts#L4851));
- both use the same background task at BestForNavigation/5 m ([useTrackingStore.ts](../../../app/src/store/useTrackingStore.ts#L5163));
- both use realGpsContinuity v3, candidate logic, Stationary V2, journal, Memory and recovery;
- both use the same bounded presentation trace and `HikingMap`/RNMapbox puck;
- both use the same O50 Final and completion/persistence controller;
- mode-specific tracking difference: maximum credible movement is 4.17 m/s for Hike and 10 m/s for Run ([realGpsContinuity.ts](../../../app/src/features/activity/realGpsContinuity.ts#L20));
- intentional product differences: metric hierarchy, trace treatment, Hike full Plant/visible marks versus Run one-tap private Cairn/no visible marks.

Nothing in `run issue` suggests a weaker Run GPS configuration.

## Cross-Activity conclusions

### Tracking

**NOT YET** ready for an unconditional freeze, solely because RI-1 is a confirmed false-Gap defect in the background segment input adapter. This is not a mandate to reopen tracking design. All GPS quality, cadence, Stationary V2, candidate and canonical rules should remain protected while that narrow schema boundary is separately reviewed.

### Stationary V2

Healthy in the fully observed Hike and control Run windows. The red-light failure occurs after the motion reducer, at segmentation.

### Final reconstruction

**YES WITH KNOWN ACCEPTABLE LIMITATIONS.** O50 behaves conservatively around Gaps and rejects unsupported network geometry. GH-3 is a bounded endpoint/offset visual artifact worth later review, not route-truth corruption.

### Run versus Hike

Run tracking is **not materially worse** than Hike. The modes share source and pipeline. `run issue` differs because it includes a 121-second background stop that exposes a shared headless schema bug, plus ordinary ~14 m lateral GPS uncertainty.

### Lifecycle

Functionally, yes: Hike and Run are one Activity system. UX, not engine ownership, diverges at Finish feedback and camera intent.

### Issues independent of GPS/tracking

- RI-3 Quick Cairn transient confirmation;
- RI-4 average pace mislabeled as Live Pace;
- RI-6 weak completion feedback;
- RI-7 Hike/Run Finish presentation divergence;
- RI-8 Untitled Cairn and missing enrichment/rediscovery loop;
- likely RI-5 camera intent, though exact evidence is insufficient.

## Things that should **not** trigger a tracking change

- GH-1's bounded candidate hold and later line catch-up;
- GH-2's two-step lateral mismatch under ~14 m hAcc;
- ordinary raw lateral noise in either Run;
- `mstand` failing to prove exact roadside lane position;
- bicycle dynamics alone—the measured reported speeds were largely relevant to fast running;
- O50 preserving a canonical Gap once one exists;
- GH-3 via GPS/candidate/Stationary thresholds—the future fault domain, if pursued, is Final offset/end anchoring only;
- RI-4 pace semantics;
- Quick Cairn confirmation/enrichment;
- Finish feedback;
- unconditional camera recenter without first knowing whether the user manually panned.

## Confirmed or likely issues worth addressing later

1. **Confirmed P1:** background/headless prior-point `acc` is not normalized to `accuracy` before segment classification, producing RI-1's false Gap exactly beyond 120 seconds.
2. **P1 UX/product:** Quick Cairn has durable local creation but a weak confirmation, no in-session visibility, no purposeful Finish enrichment, and generic “Untitled” rediscovery.
3. **P1 product:** cumulative active-session average is presented as `LIVE PACE`.
4. **P1 UX:** Run completion feedback is materially weaker than Hike even though completion authority is shared.
5. **P1 investigation:** foreground camera/follow intent needs complete existing telemetry before deciding behavior.
6. **P2 Final:** stable pedestrian road offset bends toward exact canonical endpoints on GH-3.

## Missing evidence

```text
INSUFFICIENT EVIDENCE:
missing: run issue canonical decisions, O50 section decisions, full lifecycle and Finish phase telemetry after 07:55:19.760
why it matters: prevents exact candidate/network/Finish attribution beyond persisted route facts
best way to capture next time: make the existing QA upload/retention path deliver the full session; do not invent values from Final points
```

```text
INSUFFICIENT EVIDENCE:
missing: run issue follow state, gesture history, camera center and first foreground position events
why it matters: distinguishes correct preserved browsing from a lost auto-follow intent
best way to capture next time: retain existing APP, RNMapbox location and MAP_STATE events
```

```text
INSUFFICIENT EVIDENCE:
missing: exact local Quick Cairn id, outbox sync state and saved Activity markerIds
why it matters: server has no matching row, so actual sync/linkage cannot be proven remotely
best way to capture next time: use the existing on-device local/outbox export before reconciliation
```

## Artifacts

- Human report: `docs/review/activity-real/O51_REAL_FIELD_FORENSIC.md`
- Machine-readable handoff: `docs/review/activity-real/o51-field/O51_FIELD_FORENSIC_HANDOFF.json`
- Privacy-safe visual comparison: `docs/review/activity-real/o51-field/O51_FIELD_FORENSIC_VISUAL.html`

`O51 REAL FIELD FORENSIC READY FOR SECOND REVIEW — NO CODE CHANGES APPLIED`
