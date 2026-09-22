# `almost done` master forensic + Clone V1 verdict

Date: 2026-09-11 Asia/Shanghai  
Status: analysis complete; validated O47 Internal-only clone candidate implemented; phone materialization requires the human-published OTA.  
Original Activity mutation: **none**.

## Executive verdict

`almost done` is a uniquely correlated real Hike owned by internal user 72: server session 2072, client Activity `99e48b0d-ad87-4aba-a94f-0d033393d0e6`, QA session `qa-mtwhxdio-22iczr8v`. O46 wrote one continuous 222-point canonical segment and 428.590 m locally from 239 raw observations. Background capture was continuous. The original Save did call the production Mapbox matcher, but all four chunks fell back because the routing network returned only 13 non-null tracepoints across the two nominally successful 80-point calls, then `NoMatch` and `NoSegment`. Detail therefore correctly retained canonical geometry.

O46 falsely admitted 11.790 m during the first stationary episode and 5.350 m during the second. The exact failure is not generic “GPS drift”: a coherent two-fix Candidate can promote low-speed directional drift, and the `moving` state then accepts subsequent fixes before a strict five-fix stationary cluster can demote it. At the later stop, a 23 s edge bypassed the low-speed Candidate's `<=20 s` window and a subsequent 2.12 m edge was below its `>=3 m` trigger; both were accepted solely because state remained `moving`.

The historical K8 CC family beginning at `738286b` best matches the remembered clean stationary presentation, but it is not suitable for restoration. On the 222 remotely available coordinates it retained only 28 points, lost 194 points, and reduced distance to 365.524 m. It suppressed the second stop but still admitted 8.204 m at startup. Its rolling time refresh made the supposed 30 s / 15 m gate sticky, sacrificing 1 m cadence, slow motion, U-turn shape, Z detail and stop/start recovery. The reusable idea is the fixed traversal anchor; the sticky distance deadband is not.

Clone V1 is therefore conservative: no Mapbox subsection passed, so no coordinate is represented as matched. It uses exact on-device raw provenance, O46 quality membership, removes the seven proven stationary-only canonical vertices, preserves the single segment and chronology, and applies only bounded collinear display refinement (p50 0.094 m, p95 0.420 m, max 1.433 m; 0.2513% length reduction versus selected geometry). It is a dedicated, read-only Internal Debug projection, not a SessionStore Activity or backend row.

## Authority and evidence limits

Read in full before analysis:

- `docs/review/activity-real/TRACKING_CONVERGENCE_PLAN.md`
- `docs/review/activity-real/TRACKING_CONVERGENCE_IMPLEMENTATION.md`
- O43, O44, true-1m, O45/O46 movement, stationary and presentation evidence in `docs/review/`
- current `realGpsContinuity.ts`, `snapTrack.ts`, Save pipeline, Detail geometry selection, Memory reconciliation, pending sync, lifecycle/background journal and tests
- visual authority, migration state, asset manifest and the day/night, product-unity and weather QA boards

`CairnNZ_Project_Authority.md` does not exist in the worktree or reachable Git history. This is an authority-input gap, not a reason to infer or recreate its contents.

The failed Save matters. The immutable phone pending payload contains all 239 ordered raw coordinates, but the server received only the 222 incrementally appended canonical points. QA telemetry intentionally redacts coordinates. The HTTP 400 was caused by `route_points_raw.119.v_acc` containing iOS's negative vertical-accuracy sentinel while server validation required `>=0`.

Consequences:

- O46's actual recorded canonical output and decisions are authoritative.
- the current production dry-run exactly repeats the production matcher's real input authority: 222 canonical points;
- the CC counterfactual preserves timestamp, accuracy, reported speed and order for all 222 remotely available points, but cannot replay the 17 raw-only coordinates;
- the Internal clone loader reads and inventories the full 239-point pending payload on the tester's phone; its stored provenance contains used, canonical-excluded, horizontally impossible, stationary-removed, unmatched and fallback raw ordinals.

No report below labels the 222/239 counterfactual as a complete raw replay.

## Activity identity and state

| Field | Evidence |
|---|---|
| User-visible name | `almost done` in immutable local pending payload; telemetry records `nameLen=11` |
| Server ID | 2072 |
| Internal owner | user 72 |
| Client Activity ID | `99e48b0d-ad87-4aba-a94f-0d033393d0e6` |
| QA session | `qa-mtwhxdio-22iczr8v` |
| Type | hiking |
| Start | 2026-09-11 13:08:46.128 Asia/Shanghai (`2026-09-11T05:08:46.128Z`) |
| Local completion | 2026-09-11 13:15:39.046 Asia/Shanghai (`2026-09-11T05:15:39.046Z`) |
| Recorded duration | 403 s (telemetry lifetime 412.918 s) |
| Saved local distance | 428.58960555464506 m |
| Elevation gain | 9.260034259717933 m |
| Device | iOS 26.6.1; app 0.2.6; native build 56 |
| OTA marker | O46 by candidate/test context; marker was not emitted into this telemetry schema |
| Raw observations | 239; raw ordinal watermark 241; two ownership/dedupe transitions account for the ordinal/count difference |
| Canonical | 222 points |
| Segment | one segment: `99e48b0d-ad87-4aba-a94f-0d033393d0e6:1789103326128:3062a00b` |
| Gaps | zero explicit gaps; zero inferred 120 s / 200 m gap connectors |
| Final display | canonical, 222 points, fingerprint `574bcc33` |
| Match state | `raw-fallback`, `no-derived-chunks`, algorithm `segment-walking-v2` |
| Sync | local `saved_pending`; server finalize PATCH returned HTTP 400 |
| Server row | active/unfinalized: `end_time=start_time`, 0 m, 0 s, no name, `active_slot=1`; canonical append exists |
| Memory | 14 incremental Memory evidence commits; Save reconciliation inspected all 222 canonical points and found zero new evidence; pending final payload contains zero new Memory points |

The anomalous unfinished server row is part of the original evidence and was not repaired in this task.

## Stationary forensic

### Episode 1 — startup, physically stationary for approximately 45 s

The accepted stationary canonical window is raw ordinals 9–14:

- 6 canonical points;
- 11.790 m canonical path;
- 9.538 m net displacement;
- first trusted fix at +8.619 s (raw 9);
- raw 10 at +9.620 s: accuracy-eligible, speed 0.19 m/s, 5.46 m from trusted in 1.001 s; quarantined as `possible-stationary-jitter`;
- raw 11 arrived 1.243 s later and confirmed the Candidate. Relative movement from raw 9 was 8.20 m, corroborating step 2.83 m, detour excess 0.09 m and reversal only 17.42°.

The Candidate confirmation threshold for stationary jitter is cumulative path `>=2 m`, net `>=1.75 m`, progress ratio `>=0.75`, direction variability `<=55°`, with plausible accuracy-adjusted edge speeds. This short run of directional GPS drift satisfied it. Raw 10 was promoted with raw 11 in order, state became `moving`, and later drift was accepted.

The strict stationary classifier could not protect startup. It needs at least five recent eligible fixes over at least 3 s, low net relative to median accuracy, progress ratio `<=0.42`, cluster radius within `min(8,max(3.5,0.85×medianAccuracy))`, inconsistent turn sign and low speed/high direction variability. The false sequence was too directionally coherent and had a progress ratio near one, so it looked like real progression rather than a stationary cluster.

The route's current-position estimate was allowed to refine, but O46 had no independently fixed traversal anchor. Candidate promotion moved both concepts together.

### Episode 2 — minute-six stop

The stationary window is raw ordinals 224–226:

- 3 canonical points;
- 5.350 m path;
- 4.642 m net displacement;
- raw 224: 1.11 m in 3 s, reported speed 0.10 m/s, accepted while the recent six-fix window still showed 6.86 m cumulative / 6.79 m net, ratio 0.99, cluster radius 3.74 m and state `moving`;
- raw 225: 3.23 m after 23 s, reported speed 0.07 m/s, accepted;
- raw 226: 2.12 m after 17.999 s, reported speed 0.05 m/s, accepted.

Raw 225 did not enter the low-speed Candidate because that rule is limited to `dt <=20 s`. Raw 226 was within 20 s but below the Candidate's 3 m displacement floor. `showsStationaryCluster` saw only the current point after each long interval because the recent window is eight seconds. The next branch is:

```ts
if (state.motionState === 'moving' || showsCumulativeProgress(window)) ACCEPT;
```

Thus each fix was canonical despite near-zero Doppler speed. This proves the defect is not startup-only.

### Memory and display consequence

Accepted points use the normal canonical decision boundary. They therefore contributed route distance, confirmed geometry and incremental Memory evidence like any other accepted traversal. The final matcher fell back, so Detail displayed them unchanged. Clone V1 retains raw 9 and 224 as positional/traversal anchors but removes raw 10–14 and 225–226, eliminating the edges within each proven stationary window without inventing a replacement coordinate.

## Historical CC reconstruction

| Candidate | File/function | Rules | Anchor, distance and display | Tests | Classification |
|---|---|---|---|---|---|
| `d7ea3b0` (2026-06-26) | `app/src/store/useTrackingStore.ts`, `addCoordinate` | reject accuracy >25 m from clean; reject >30 m and >10 m/s teleport; if reported speed <0.5 m/s and displacement <= `max(8 m, accuracy)`, suppress | traversal anchor stays at last accepted coordinate; suppression refreshes `lastCoordinateTime`; accepted raw coordinates determine distance; Kalman Q=1e-9 only drives `trackPointsSmoothed` display | no direct stationary GPS regression; auto-pause test is unrelated | **POSSIBLE**, but replay still leaks 8.204 m at startup |
| `738286b` (2026-08-08) | same function, K8 addition | all above; hiking >4.17 m/s overspeed; plus `(accuracy null or >12 m) && distance<15 m && age<30 s` indoor suppression | same fixed accepted anchor, but every suppressed fix refreshes age, making the “30 s” gate sticky under regular callbacks; same raw-distance/Kalman split | no direct movement topology regression | **LIKELY MATCH** for remembered stationary cleanliness and the origin of the broad CC deadband |
| `95302b8` (2026-08-17) | same store gate; Hike rendering uses `trackPointsSmoothed` | stationary logic materially identical to `738286b` | same sticky K8 anchor plus most likely historical calm visual presentation | no direct stationary/topology regression | **POSSIBLE / likely visual snapshot**, but not a different stationary algorithm |
| `a9157af` (2026-09-05) | same store gate | materially identical K8 stationary rules | same trade-offs in a later UI snapshot | no direct stationary/topology regression | **POSSIBLE**, not a distinct remembered algorithm |

`d7ea3b0`'s fixed-anchor concept is valuable. `738286b` is the best behavioral match to “stand still → no visible route growth,” especially when combined with the smoothed rendering present by `95302b8`. The exact `almost done` replay disproves a stronger claim that it would have produced zero startup route: accurate drift escaped the 8 m radius, and K8 only applied when accuracy was null or worse than 12 m.

## O46 versus historical replay

All historical numbers below are lower bounds over the remotely available 222 ordered coordinates, preserving their recorded timestamp, accuracy and speed. They do not include the 17 raw-only fixes.

| Algorithm | Accepted | Total distance | First stop | Second stop |
|---|---:|---:|---:|---:|
| O46 actual | 222 | 428.590 m | 6 points, 11.790 m | 3 points, 5.350 m |
| `d7ea3b0` | 211 | 418.877 m | 2 points, 8.204 m | 0 points, 0 m |
| K8 (`738286b`, `95302b8`, `a9157af`) | 28 | 365.524 m | 2 points, 8.204 m | 0 points, 0 m |

### Topology and responsiveness audit

| Forensic window | O46 | `d7ea3b0` | K8 result |
|---|---:|---:|---:|
| startup through walking, raw 9–30 | 15 pts / 37.202 m | 9 / 28.733 m | 3 / 23.630 m |
| 1 m cadence straight walk, 24–118 | 95 / 135.265 m | 95 / 135.265 m | 9 / 125.297 m |
| U-turn, 119–130 | 11 / 33.859 m | 11 / 33.859 m | 3 / 11.972 m |
| diagonal + deliberate Z, 163–188 | 24 / 91.581 m | 24 / 91.581 m | 7 / 73.257 m |
| repeated internal corridor, 188–210 | 23 / 43.587 m | 22 / 43.581 m | 3 / 31.990 m |
| second stop through restart, 224–236 | 13 / 19.540 m | 10 / 12.262 m | 1 / 0 m |

K8 did not merely simplify the line. It held an old anchor through valid metre-scale motion, then occasionally accepted a large catch-up edge. That creates sticky starts, delayed slow walking, coarsened or frozen reversals, lost Z/crossing detail and poor stop/start recovery. O46 preserves these behaviors well; `d7ea3b0` also preserves most walking topology but does not solve startup drift on this evidence.

## Stationary V2 proposal — design only

The smallest modern change is to make two authorities explicit:

```text
positionEstimate       // may follow accuracy-weighted raw refinements
traversalAnchor        // last canonical walked location; fixed while stationary/uncertain
```

Suggested state machine:

```text
ACQUIRING
  accuracy-eligible first fix -> traversalAnchor; STATIONARY_UNCERTAIN

STATIONARY_UNCERTAIN
  each eligible fix -> update positionEstimate and bounded recent evidence
  conflicting/clustered/low-Doppler evidence -> stay; write no traversal
  >=3 ordered fixes over roughly 2–5 s with:
      net progression >= about 2 m beyond uncertainty,
      cumulative/net coherence high,
      stable forward bearing,
      plausible lower-bound speeds,
      no stationary-cluster contradiction
    -> MOVING and promote only the coherent ordered suffix from traversalAnchor

MOVING
  coherent progression -> advance traversalAnchor per fix
  sustained low Doppler plus small/conflicting net progression -> STATIONARY_UNCERTAIN
  a single long interval or 1–3 m low-speed edge -> position-only evidence,
    never unconditional traversal because the prior state was MOVING

GAP_REACQUIRE
  require sequence corroboration/topology; never a giant escape step alone
```

Use uncertainty to score evidence, not as an escape radius the walker must cross. A real series `X→x→x→x` should establish movement quickly even at 1 m cadence. A large wandering cloud with low/conflicting net progress should only refine `positionEstimate`. Preserve O46's Candidate ordering, accuracy-adjusted speed safety, background journal, segment identity and fast U-turn response.

## O46 confirmed-head presentation

The full state table is in `ALMOST_DONE_PRESENTATION_STATE_MACHINE.md`.

The body and animated head are separate ShapeSources. Both use 8 px round-capped casing and 4.5 px round-capped core. The head is declared after the body, so its start casing/core paints over the body's terminal. The body advances only on a completed 900 ms animation. On `almost done`, 234/270 targets were interrupted and only 38 completed; p50 interruption was 137 ms. `AnimatedCoordinatesArray` retargets by array index and grows new vertices from the prior array's last value. The result is a succession of A→B, B→C, C→D mini-lines instead of one endpoint advancing along one stroke.

Recommendation: P1, one presentation ShapeSource composed of the immutable stable prefix plus a single interpolated endpoint, retargeted by arc length and committed without a rendered-coordinate change. The duration can be tuned later. 900 ms is secondary; source/layer/cap/commit topology is primary.

## Background forensic

Background permission was `granted`. O46 correctly treated iOS `inactive` as transient and kept the foreground watcher until actual `background`, then transferred ownership to the registered background task.

| Screen-off interval (from Activity start) | Callback sequences | Accepted / rejected | Foreground drain |
|---|---|---:|---:|
| 165.045–185.963 s | 1–5 | 4 / 1 | 0 |
| 233.767–254.817 s | 6–14 | 8 / 1 | 0 |
| 259.748–269.695 s | 15–18 | 4 / 0 | 1 ordered point |
| 274.261–295.471 s | 19–24 | 5 / 1 | 0 |

There were five successful background source activations, including one provider refresh/reuse during the fourth interval, and 24 native callbacks of one sample each. Twenty accepted canonical points survived final dedupe and contributed 105.848 m. Three accuracy-rejected callbacks were intentionally not journal commits; one Candidate transition resolved through the normal movement authority. Every committed batch reports `journalCommitted=true`. Foreground takeover stopped the background owner, drained in timestamp order, reactivated foreground distanceFilter=1 and retained the same segment ID.

There is no canonical gap, no false connector and no lost ownership period. Immediate installation of the already-confirmed history on foreground is correct. Replaying several minutes of animation would misrepresent confirmation time; only the new live head should resume smoothing.

## Final Map Matching forensic

Map matching is a sequence problem: observations are visited in input order, and tracepoints correspond to that ordered input; unmatched observations may be null and ambiguity can produce multiple submatches. The same graph edge can therefore appear repeatedly without spatial deduplication ([Mapbox Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/)). Established HMM map matching likewise estimates a path from a time-ordered noisy observation sequence and uses network transition plausibility, not a spatial union ([Newson & Krumm, 2009](https://www.microsoft.com/en-us/research/wp-content/uploads/2016/12/map-matching-ACM-GIS-camera-ready.pdf)).

### Original Save

The original Save invoked `segment-walking-v2` on its one 222-point canonical segment:

| Request | Input | Timestamps | Radii | Result | Coverage |
|---|---:|---|---|---|---|
| 1 | 80 | no | 10–14 m | HTTP 200 `Ok` | 3 non-null / 80 tracepoints |
| 2 | 80 | yes | 10–19 m | HTTP 200 `Ok` | 10 / 80 |
| 3 | 25 | yes | 10–19 m | HTTP 200 `NoMatch` | none |
| 4 | 56 | yes | 10–14 m | HTTP 200 `NoSegment` | none |

Outcome: zero derived chunks, four fallbacks, `fallbackReason=no-derived-chunks`. `activity_final_geometry_v2` recorded canonical and display count 222, one segment each, identical fingerprint `574bcc33`. Thus Final Snap was visually absent because no matched geometry was accepted and Detail read the canonical final payload—not because Detail selected the wrong source.

### Current production dry-run

The analysis transpiled and invoked the checked-out production `snapTrack.ts` without parameter changes. It reproduced four calls, zero accepted chunks, the same coverage shape and all-fallback result. The function internally returned a 93-point, 400.776 m fallback/smoothing candidate, but the Save caller's `chunksOk===0` guard rejects it and retains canonical truth.

### Conservative subsection probes

Twenty-one fixed 12-point windows with one-point overlap were sent using the unchanged walking profile, per-point production radii and production quality gates. No radius was enlarged. Results:

- matched windows: 0;
- canonical fallback windows: 21;
- accepted match confidence: N/A;
- matched coverage: 0 accepted subsections;
- p50/p95/max canonical→matched deviation: N/A;
- endpoint displacement: N/A;
- matched length distortion: N/A;
- topology/repeated-pass/U-turn match gates: not reached because tracepoint coverage failed first.

Sparse isolated tracepoints near the route are evidence that the walked internal/private path is missing or unusable in the routing graph. Expanding radii to force a match would invite the nearby external road to steal the route. Case 2/3 policy therefore applies: retain canonical evidence for the whole Activity. There is no fake connector.

### U-turn, repeated traversal and straightness

The principal U-turn is at raw ordinal 124 with a 167.7° reversal. Original, hybrid fallback and Clone V1 all retain it. No shortcut or radius-based external-road substitution occurs.

The real trace contains three chronological visits to the same internal corridor, reference ranges 47–65, 188–197 and 197–210. Their observed directions are A→B, A→B, B→A—not a literal contiguous A→B→A→B triple in this recording. All three remain before and after Clone V1; coordinates are never laterally offset. The product contract remains unconditional: when an Activity actually is A→B→A→B, matching must emit A→B→A→B in temporal order.

Default Detail should remain one clean static stroke with start/end and a subtle turnaround marker. Pixel overlap is truthful. Optional inspection should offer a time scrub/replay, temporal gradient and sparse direction arrows, with pass highlighting on tap. Never displace stored or matched geography just to separate passes.

Because no mapped path passed the gates, Clone V1 does not call any straightening a road snap. Its 137 changed middle vertices are classified as **bounded final smoothing**: same segment, adjacent span <=10 s, turn <=18°, timestamp-weighted chord, move <=1.5 m. Endpoints, timestamps, order and turns are unchanged. Displacement is p50 0.094 m, p95 0.420 m, max 1.433 m; selected-path length changes from 408.750 m to 407.723 m (ratio 0.997487). All other geometry is **unchanged canonical fallback**.

## Clone V1 representation and provenance

### Why it is not a normal Activity

Tracing the normal creation path found writes to SessionStore/history, track-point storage, pending sync, backend session/finalize, Memory reconciliation, stats/progress surfaces and Route/Detail actions. A duplicate normal Activity would violate the review contract. No existing general QA clone schema exists, and a production schema migration would be disproportionate.

The smallest safe representation is instead:

- compile-time gate: `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true` Internal build;
- independent runtime gate: Debug Mode enabled;
- source: exact immutable pending item with exact client ID, owner, name, 239 raw and 222 canonical count checks;
- source read: a non-promoting, non-writing pending snapshot reader;
- storage: dedicated `cairn_qa_snap_review_clone_v1_<owner>` key only;
- view: normal `MapHistory` Activity Detail surface with a prominent `QA / SNAP REVIEW CLONE · NO PRODUCT EFFECTS` label;
- read-only: rename, delete, Save as Route, sync and nearby route flags disabled;
- no insertion into SessionStore and no call to pending save, backend, Memory, stats, gameplay, social/feed or clone analytics.

### Identity

| Field | Value |
|---|---|
| Name | `almost done clone v1` |
| Clone/client ID | `qa-snap-review:99e48b0d-ad87-4aba-a94f-0d033393d0e6:v1` |
| Server ID | none by design |
| Label | `QA / SNAP REVIEW CLONE` |
| Internal route | `MapHistory({ qaReviewClone: 'almost-done-v1' })` |
| Human path | Settings → tap “About Cairn” five times → Developer → enable Debug mode → Open Debug screen → QA SNAP REVIEW → Open review clone |

The checked-in candidate cannot materialize on the current O46 phone without a human-published Internal OTA. Until that happens, the honest creation status is `SOURCE_CANDIDATE_READY__DEVICE_MATERIALIZATION_REQUIRED`, not a fabricated server Activity ID. On first open, the phone builds the dedicated review object from its full pending payload and records exact raw-ordinal provenance.

### Clone geometry

```text
239 ordered raw observations retained in source pending
  ↓ O46 membership / impossible-observation safety
222 canonical observations
  ↓ remove proven stationary traversal ordinals 10–14, 225–226
215 selected canonical observations; one segment, no gaps
  ↓ production matching + conservative probes
0 accepted matched subsections; all selected evidence unmatched
  ↓ canonical fallback + bounded collinear final smoothing
215 Clone V1 display points; 407.723 m geometric length
```

The displayed stats deliberately retain source factual summary values (428.590 m, 403 s, +9.260 m) for side-by-side review; the clone never contributes those numbers to product totals.

## Validation and safety ledger

Before edits, `cd app && npm run verify:changed` exposed a pre-existing unrelated failure in `__tests__/v409-offlineQueue.test.ts`: seven expectations reference removed `readQueueSnapshot`/`clearQueue`; 32/33 suites and 338/345 tests passed. It was diagnosed and not retried to green.

Clone-specific validation:

- touched-file TypeScript diagnostics: zero (repo-wide TypeScript still has unrelated baseline failures);
- production dry-run: reproduced original fallback;
- conservative probes: 0 accepted / 21 fallback;
- preview Chromium load at 390×844: all three pages, zero page errors;
- chronology scrub interaction: verified line count and time update;
- Expo Web at 390×844: the O47 Internal route opened normal Activity Detail, SessionStore stayed empty, the pending source bytes stayed unchanged during open, the dedicated clone key was created, the QA label was visible and page errors were zero;
- native GPS telemetry was used as evidence, but no new native tracking behavior was implemented;
- Home marker advanced once from O46 to O47 after validation; no OTA was published and no backend deploy was performed.

Safety:

- original `almost done` modified: **NO**
- original raw/canonical geometry modified: **NO**
- original Memory modified: **NO**
- original stats/gameplay/social modified: **NO**
- original database row mutated: **NO**
- backend production logic deployed: **NO**
- production tracking/matching tests modified by this task: **NO**
- production Stationary V2 or presentation fix implemented: **NO**
- product code modified: **YES, narrowly**, only the Internal-only review loader, Debug entry and read-only Detail projection
- OTA published: **NO**; human publication remains authoritative

## Recommended next implementation — not part of this task

1. **P0 — Stationary V2:** fixed traversal anchor plus independent position estimate and sustained-progress state transition. Add exact raw replays for startup, second stop, slow 1 m cadence, U-turn, repeated path, Z, diagonal/off-road and stop/start before production integration.
2. **P1 — one-source continuous presentation:** stable prefix plus one arc-length interpolated endpoint; native proof under 1 s cadence, interruptions, turns, stationary refinement and background foreground handoff.
3. **P2 — hybrid Final matching and inspection UX:** generic submatch/fallback boundaries with no fake connector, explicit repeated-pass topology gates, clean static Detail plus optional time scrub/arrows/turnaround markers. Do not tune radii against this single Activity.

## Reproducible artifacts

- `ALMOST_DONE_STATIONARY_COMPARISON.csv`
- `ALMOST_DONE_CURRENT_VS_HISTORICAL_CC_REPLAY.json`
- `ALMOST_DONE_PRESENTATION_STATE_MACHINE.md`
- `ALMOST_DONE_MATCHING_DIAGNOSTICS.json`
- `ALMOST_DONE_CLONE_V1_PROVENANCE.json`
- `ALMOST_DONE_PRIVACY_SAFE.geojson`
- `ALMOST_DONE_CURRENT_MATCH_PREVIEW.html`
- `ALMOST_DONE_REPEAT_TRAVERSAL_PREVIEW.html`
- `ALMOST_DONE_HYBRID_SNAP_PREVIEW.html`
- `ALMOST_DONE_IMMUTABILITY_CHECK.json`
- `build-forensic.mjs`
- `render-previews.mjs`
- `verify-immutability.mjs`
