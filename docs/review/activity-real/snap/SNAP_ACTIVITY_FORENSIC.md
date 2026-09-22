# `snap` real Activity master forensic

Verdict date: 2026-09-11 Asia/Shanghai. Mode: read-only forensic/source archaeology/online matcher experiments. No production code, test, constant, database, backend, or OTA change was made.

> Authority note: `CairnNZ_Project_Authority.md` is not present in this workspace. The tracking convergence authorities, WYSIWYG implementation, O43–O48 evidence, current source, Git history, visual authorities, and real telemetry were read instead. This missing file is documented rather than silently substituted.

## Executive verdict

O48 live tracking is fundamentally healthy. It recorded the route at one-metre foreground cadence, preserved one continuous Segment through background ownership, and self-stabilized after one 5.171 m false stop-transition edge. That V is a narrow Candidate-timeout bug, not a failed stationary architecture.

Final Snap ran, but produced zero accepted geometry. Three causes combine:

1. O48 submits dense 1–2 s evidence with `tidy=true`. Mapbox returns high-confidence matchings with many null tracepoints after tidying; Cairn interprets their source indices as a non-contiguous unmatched span and rejects them.
2. The only truly safe matched island discovered under unchanged gates is the final public corridor. Large middle portions return `NoSegment` even when isolated and tested with bounded 21 m uncertainty-aware radii; visible map ink is not necessarily a walking-matchable edge.
3. Fixed 80-point chunks have no pre-request route-class boundary discovery, so one internal/ambiguous span prevents public islands in that chunk from surviving independently.

The controlled winner is sequence-aware 4 s resampling with mandatory turn/reversal/stop/Gap points, `tidy=false`, current walking profile, and current gates. It safely accepts the final 87.549 m public subsection (confidence 0.976010; p50/p95/max displacement 7.963/8.754/8.754 m; length ratio 0.9963). The isolated head corridor is highly plausible but remains 0.058 m above the current 15 m p95 gate and is not promoted.

No app-openable `snap clone v1` was created. The geometry proof does not yet satisfy every mandatory clone gate, and the existing safe Internal projection is hard-coded to `almost-done-v1`; changing it would be production/debug app work explicitly forbidden by this task.

## Source identity and immutable facts

| Field | Evidence |
|---|---|
| Name/type | `snap`, Hiking |
| Server ID | 2073 |
| clientActivityId | `c302e123-534d-4f60-ade1-159e3b48f3e5` |
| QA session | `qa-mtwrqajx-un973228` |
| Owner | privacy-safe `current-snap-owner` |
| Start | 2026-09-11 17:43:12 Asia/Shanghai |
| End | 2026-09-11 17:56:41 Asia/Shanghai |
| Finalized | 2026-09-11 17:56:43 Asia/Shanghai |
| Runtime | O48; app 0.2.6 build 56; iOS 26.6.1 |
| Foreground policy | BestForNavigation, distanceFilter 1 m; no JS timeInterval authority |
| Raw/canonical | 428 / 392 |
| Segment/Gap | 1 / 0 |
| Saved distance/duration | 843.202 m / 805 s |
| Elevation gain | 0 m |
| Background | 80 native callbacks; 65 accepted, 15 rejected/pending |
| Matching | five walking Map Matching requests; zero accepted chunks |
| Saved Final | exact canonical fingerprint (`a623c4a4` privacy-safe diagnostic) |
| Detail source | server `route_points`; same fingerprint as local Final |

Raw ordinals span 1–431 because three source ordinals are absent; raw storage still contains 428 observations. Raw evidence, canonical geometry, metrics, Memory, journal, match result, timestamps, sync, and server row were not changed.

## Incident A — stop V

The full privacy-safe evidence is in `SNAP_STOP_V_TIMELINE.csv` and `SNAP_STOP_V_SUMMARY.json`.

At raw 246, motion was still coherent. Raw 247 (0.614 m from the anchor, reported 0.088 m/s) correctly entered `possible-stationary-jitter`. Raw 248 jumped 5.857 m and stayed quarantined. Raw 249 returned near the anchor; Cairn rejected the old Candidate and performed ephemeral position refinement without moving traversal.

Five seconds later raw 250 was 5.171 m from the traversal anchor with reported speed 0.850 m/s but no `speedAccuracy`. The pending candidate aged 5000.016 ms, hit `candidate-timeout`, and re-entered `classifyWithoutPending`. Current `hasReliableReportedSpeed` treats absent speed uncertainty as reliable. `reportedMoving` therefore passed, the 5.171 m displacement cleared 0.75 m, and the 0.57 m/s implied speed was plausible. The stationary-cluster check had only four recent points, below its five-point requirement. The route anchor advanced once.

- False canonical edge: **5.171 m**.
- Visual V detour excess: **2.183 m**.
- Bad edges: **1**.
- False Memory: **0 new cells, 0 new area, 0 progression**; the edge was considered but deduplicated.
- Stabilization: the next callback 11 s later was quarantined; no more false accepts occurred before real movement resumed 126 s after the bad edge.
- Classification: **MINOR STOP-TRANSITION TUNING**, mixed V1/V6/V3. It is canonical, not presentation-only.

Recommended narrow fix: after a `possible-stationary-jitter` timeout, missing `speedAccuracy` must not independently establish `reportedMoving`. Hold the traversal anchor in REFINE/a fresh bounded Candidate until accuracy-adjusted lower-bound movement or two coherent post-timeout fixes establish progression. Keep all other O48 Stationary V2 logic.

## Background proof

Background permission was granted. The real provider retained Activity ownership. Telemetry contains 80 background callback checkpoints and 80 matching journal results; 65 became canonical and 15 remained rejected/pending. All points retained the same Segment ID, no Gap was emitted, and journal acknowledgement reached all 392 canonical points. Foreground and background batches went through the same v3 authority. Memory was called only from committed canonical evidence.

This proves screen-off recording continued rather than being reconstructed later. Immediate restoration of all confirmed background history on foreground is correct; replaying minutes of animation would be misleading. Only the new live endpoint should resume normal smoothing.

## Production Final matching pipeline

```text
392 canonical points in one Segment
→ accuracy GOOD/LOST runs (`accuracy >20m` is fallback)
→ fixed 80-point chunks, overlap one canonical boundary
→ Mapbox /matching/v5/mapbox/walking
   tidy=true, GeoJSON/full, per-point 10–40m radii, timestamps
→ tracepoints mapped to matching indices
→ require each matching’s input indices to be contiguous
→ confidence >=0.3 + deviation + endpoint + length gates
→ anchored matched subsection or exact canonical fallback
→ no derived chunks survived
→ canonical Final persisted local/server
→ Detail selected server Final
```

Source authority is `app/src/services/routing/snapTrack.ts`: algorithm and constants at lines 1–25 and 152–163; request construction at lines 480–502; tracepoint/submatch extraction at 524–636; hybrid assembly at 637–669. Finish/save owns the bounded 4,000 ms total budget and 1,600 ms per call in `app/src/store/useTrackingStore.ts`. Detail chooses a server route with at least two points, otherwise local, in `app/src/screens/MapHistoryScreen.tsx:1020-1069`.

### Exact Save requests

| Canonical range | Count | Radius | Result | Confidence | Tracepoints | Null | Cairn result |
|---|---:|---:|---|---:|---:|---:|---|
| 0–79 | 80 | 10–14 m | Ok | 0.971186 | 80 | 68 | partial coverage fallback |
| 79–158 | 80 | 10–15 m | Ok | 0.953768 | 80 | 77 | partial coverage fallback |
| 158–237 | 80 | 14 m | NoSegment | — | 0 | 0 | fallback |
| 237–316 | 80 | 14 m | NoSegment | — | 0 | 0 | fallback |
| 316–391 | 76 | 14 m | Ok | 0.041909 | 76 | 71 | partial/low-confidence fallback |

Canonical cadence was p50 1.000 s, p95 5.000 s; spatial spacing p50 1.417 m, p95 6.145 m. Timestamps were present in all five requests. No waypoint parameters are used.

The production radius policy is appropriate as a starting point and not the primary failure. Conservative accuracy-aware 14–21 m experiments did not unlock the internal/lower `NoSegment` spans. A global 50 m radius would create external-road stealing risk.

### API failure vs rejection

- M1 `NoMatch`: the isolated internal outbound subsection returns this in one controlled run.
- M2 `NoSegment`: both production middle chunks and several isolated middle windows return it.
- M3 partial tracepoints: production head, next, and tail responses.
- M4 useful result rejected by Cairn: high-confidence production responses are rejected because `tidy=true` leaves non-contiguous non-null indices. In isolated `tidy=false` head runs, the candidate is then rejected by `raw_deviation`: p95 15.058 m versus a 15 m cap.

Mapbox documents that `tidy` can remove clusters/resample a trace and that five-second timestamps are only a recommendation, not a law.[^mapbox-mm] Cairn currently combines dense input, server tidying, and a source-index contiguity rule that assumes null means unmatched. That semantic mismatch is the main software cause.

## Controlled D0–D5 matrix

| Run | Input/result | Verdict |
|---|---|---|
| D0 | production 392, 1–2 s dense, tidy=true | five calls, zero accepted |
| D1 | sequence-aware 4 s, 150 points, tidy=false, production radii | two Ok responses; final 87.549 m island accepted; 12.67% observation coverage |
| D2 | D1 + tidy=true | 132/151 tracepoints null; zero accepted |
| D3 | D1 + accuracy×1.5 radii clamped 10–25 m | same final island; no extra safe coverage |
| D4 head | 22 isolated points | 0.946153, all tracepoints, p95 15.058 m; fails gate by 0.058 m |
| D4 lower out/back | isolated public-looking spans | NoSegment at production and bounded wider radii |
| D4 final | 19 isolated points | 0.976010; accepted, p95/max 8.754 m, length ratio 0.9963 |
| D5 internal | 21 isolated points | NoMatch; canonical fallback is correct |

D1 is the best safe controlled configuration. D3 proves wider radii are not the missing lever. D2 proves `tidy=true` remains incompatible with the current provenance logic. D4 proves useful public sections can match independently when isolated, but only the tail currently clears every gate.

## Three route classes in `snap`

The privacy-safe classification sequence is:

```text
MAPBOX_MAPPED_AMBIGUOUS
→ UNKNOWN (transition/crossing)
→ OFF_NETWORK_CONFIDENT
→ UNKNOWN / visible-but-NoSegment
→ OFF_NETWORK_CONFIDENT
→ MAPBOX_MAPPED_CONFIDENT
```

| Range | Distance | Duration | Class/evidence |
|---|---:|---:|---|
| canonical 0–61 | 121.556 m | 105 s | R1 candidate; consistent high-confidence matches but 14–16 m shift |
| 62–104 | 97.062 m | 94 s | R4/Unknown transition and crossing |
| 105–158 | 130.051 m | 91 s | R3 internal outbound; NoMatch/NoSegment |
| 159–283 | 232.138 m | 308 s | R2/Unknown; public-looking but absent/incompatible with walking matching |
| 284–327 | 159.269 m | 122 s | R3 internal return; mostly NoSegment/zero confidence |
| 328–391 | 87.973 m | 70 s | R1 mapped-confident; accepted when isolated |

The displayed map alone cannot distinguish R1 from R2. The lower visible corridor’s repeated `NoSegment` under bounded radius proves that “nearest visible road wins” is unsafe.

The future hybrid needs to discover temporal islands before large chunk acceptance. Resample at 3–5 s while preserving mandatory endpoints, turns, U-turns, repeated-pass reversals, stop/start, confidence transitions, and Gap boundaries; use `tidy=false`; probe/split ordered islands; apply current gates to each; anchor at canonical boundaries. `NoMatch`, `NoSegment`, ambiguity, implausible bearing/topology, or excessive displacement stays canonical. Never bridge route-class boundaries with a fake road connector.

Repeated traversals and U-turns are preserved today because the whole Activity falls back canonical. D1 also leaves every repeated/U-turn interval canonical and replaces only the final non-repeated corridor. Neither process spatially unions geography.

## Detail selection

The locally saved Final, server `route_points`, and canonical fingerprints are identical. Detail selected server `route_points`, so the tester saw canonical. Snap was not secretly successful behind a selector bug.

## Live options and road assistance

O48’s real line uses a single bounded presentation route (`trackPointsSmoothed`) while Simulator uses exact canonical (`HikingScreen.tsx:188-194`). The prior cross-track projection was removed after offline replay worsened turn risk; the shipped presentation is a small 1–2 m causal blend, not road-aware.

Strictly mapped-confident evidence covers about **87.973 m / 70 s**, or **10.4% of distance / 8.7% of duration**. Including the borderline head raises this to about **209.529 m / 175 s** (24.9% / 21.7%), but it requires a new evidence-conditioned gate.

At the real road crossing, assist would need to disengage. Current evidence becomes ambiguous, not cleanly off-network in one fix, so an online matcher could visibly trap the head on the old road. D5 proves it should remain off inside the internal path. The final corridor proves confident re-entry is possible after several supporting fixes.

### L0/L1/L2

- L0 canonical O48: healthy, truthful, low lag; bounded GPS wobble remains.
- L1 current robust plus bounded presentation: visually continuous and low risk. There is no active cross-track projection because it damaged the replay matrix.
- L2 online road display: straighter in a small supported fraction, but dependent on network calls taking hundreds of milliseconds, ambiguous at the crossing, and unavailable offline.

Map Matching is billed per request after the free tier and is rate-limited; calling it near one hertz would add cost, radio wakeups, latency, and connectivity state.[^mapbox-price] Dry-run calls took hundreds of milliseconds, sometimes over one second. This is incompatible with a calm continuously retargeting endpoint.

Recommendation for the next release: **NO LIVE ROAD ASSIST**. If revisited, rank LA presentation-only first, LB derived confirmed display second only after broad offline validation, and reject LC canonical road-aware truth. Mapbox Navigation free-drive demonstrates real-time enhanced driving location, but Cairn lacks that native SDK and its driving/provider model is not evidence of safe pedestrian behavior.[^free-drive]

## Debug Auto-Go

Auto-Go calls Mapbox Directions **walking** before movement, stores the returned full route geometry as waypoints, and synthesizes one-hertz positions directly along those edges. Joystick motion cancels/does not use that known path and moves geodesically. It does not dynamically map-match unknown positions. Its perfection is predominantly predetermined clean evidence, not a more capable real-GPS inference algorithm. See `DEBUG_AUTO_GO_ARCHITECTURE.md`.

## Historical `back` control

The privacy-safe `historical-back-control` is server Activity 46, recorded May 29 under a different user. It predates the Git repository root and first Mapbox matcher. Its raw evidence is naturally sparse (5.016 s p50), and its 87-point saved route is displaced from raw (3.828 m p50 nearest-raw, 18.011 m max), consistent with the early low-Q smoothing/Detail-cleanup family.

The June 17 v6.4 matcher later says it was validated on session 46. Replaying that exact family on `snap` accepts two whole chunks while ignoring 68/80 and 37/42 null tracepoints, gives 813.066 m versus 843.202 m, and shifts p95/max 14.775/19.029 m. It looks more attached but weakens temporal provenance. The 2×2 therefore proves both dataset and pipeline differences: `back` is easier in mapped portions, while old acceptance was also more aggressive. See `HISTORICAL_BACK_FORENSIC.md`.

## Recommended next implementation

### P0 — Final matcher input and island authority

Implement bounded sequence-aware 3–5 s resampling, mandatory topology points, `tidy=false`, temporal island discovery, and independently gated `MATCHED → CANONICAL → MATCHED` assembly. Add request telemetry for submitted source-index mapping, tracepoint runs, subsection gates, and final Detail fingerprint. Keep walking profile, bounded accuracy radii, current endpoint/topology/repeat protections, exact Gap boundaries, and canonical fallback.

### P1 — stop-transition guard

Narrow the Candidate-timeout rule so absent speed uncertainty cannot alone turn possible-stationary jitter into motion. Require lower-bound progression or two coherent post-timeout fixes. Replay O48’s full stationary/slow/U-turn/Z/repeat/stop-start matrix before advancing the marker.

### P2 — mapped-corridor evidence experiment, Final only

Create a principled high-confidence corridor gate for borderline consistent offsets like the head (multi-window full tracepoints, confidence ≥0.9, stable bearing/alternatives, bounded accuracy envelope, explicit crossing exit). Do not globally raise the 15 m gate. Do not add live road assist in the next release.

After implementation, run one native Mixed-route validation: stationary, mapped head, abrupt crossing/stop, internal out-and-back, repeated corridor/U-turn, mapped re-entry, background/foreground, Save, and Detail. Require zero false stop distance/Memory, correct crossing, canonical internal route, mapped recovery, ordered repeats/U-turn, and visible safe Final refinement.

## Clone gate

The root cause is understood, and a safe partial Final exists. A review clone was still not created because all twelve geometry/delivery gates do not pass together:

- the head is outside the current gate;
- only one mapped island is fully proven;
- there is therefore no proved `MATCHED → CANONICAL → MATCHED` clone;
- the Internal loader/navigation union is hard-coded to `almost-done-v1` (`MapHistoryScreen.tsx:782-795`, `DebugScreen.tsx:290-304`, `almostDoneCloneV1.ts:12-66`);
- extending it is production/debug code modification, forbidden here.

The analysis-only comparison clearly labels this state. No normal Activity row, backend row, owner mapping, pending sync, Memory, stats, progression, or social state was created.

## Safety and reproducibility

`generate_snap_forensic.mjs` uses SELECT-only production access, GET-only Mapbox calls, and writes only this review directory. Exact coordinates live only in process memory. Persisted geometry is translated into an arbitrary local metre frame. The historical email is absent from all review artifacts.

[^mapbox-mm]: [Mapbox Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/) — ordered coordinates, walking profile, radii, timestamps, tidying and response semantics.
[^mapbox-price]: [Mapbox pricing: Map Matching API](https://www.mapbox.com/pricing/).
[^free-drive]: [Mapbox Navigation SDK for iOS: free-drive UI](https://docs.mapbox.com/ios/navigation/v3/guides/free-drive/user-interface/).

## Sources

- [Mapbox Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/)
- [Mapbox pricing](https://www.mapbox.com/pricing/)
- [Mapbox Directions API](https://docs.mapbox.com/api/navigation/directions/)
- [Mapbox Navigation free drive](https://docs.mapbox.com/ios/navigation/v3/guides/free-drive/user-interface/)
- Current Cairn source and Git evidence cited inline.
