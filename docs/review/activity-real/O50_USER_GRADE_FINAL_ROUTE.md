# O50 user-grade pedestrian Final route

Date: 2026-09-11  
Verdict: **PASS — ready for human O50 visual review**  
Scope: Final display reconstruction only. O49 Live tracking is unchanged.

## Authority recovery

The repository does not contain `CairnNZ_Project_Authority.md`; a full search of
the Cairn workspace found no copy. O50 therefore recovered authority from the
available O43–O49 convergence reports, O49 implementation report, current
tracking/Final/Detail source, real replay artifacts, real `snap` backup and DB
audit, and the historical `back` forensic set. This absence is not silently
treated as authority.

Visual work followed `docs/VISUAL_SYSTEM.md`,
`docs/VISUAL_MIGRATION_STATE.md`, `docs/VISUAL_ASSET_MANIFEST.json`, and the
canonical day/night and product-unity QA boards. O50 changes route geometry,
not Cairn's established visual language or core anchors.

## Product result

The exact generic production compositor was run over all 392 canonical points
of real `snap`. It produced one continuous 97-point Final route:

- opening roadside: network topology plus a **14.170 m evidence-derived
  pedestrian offset**;
- departure/crossing: a bounded evidence-derived `FREE_TRAVERSAL` connector;
- internal/common route, stop, return and repeated traversal: conservative
  heading-aware canonical cleanup;
- final roadside: bounded walking-Directions topology plus a **7.960 m
  evidence-derived pedestrian offset**;
- whole Activity: 823.682 m display length versus 843.202 m canonical length,
  ratio **0.976851**;
- canonical-to-Final displacement: p50 **0.457 m**, p95 **1.542 m**, maximum
  **3.200 m**;
- maximum Final edge: **15.222 m**, versus canonical maximum 14.271 m;
- every subsection seam and the whole-route gate passed.

No Activity ID, name, fixed location, or source range appears in the production
algorithm. The named ranges below exist only in the privacy-safe review script
for reporting against established forensic sections.

## Final architecture

Canonical accepted GPS remains the immutable authority for distance, metrics,
chronology, Memory and raw evidence. O50 creates only a completed-Activity
display projection:

1. Canonical observations are sampled in order at a four-second target using
   O49's mandatory endpoint, turn, reversal and stop/start preservation.
2. Bounded overlapping windows are sent with the walking profile, timestamps,
   accuracy-bounded radii and `tidy=false`. Repeated positions are never
   spatially deduplicated. These choices align with Mapbox's documented Map
   Matching timestamp and `alternatives_count` behavior. See the official
   [Map Matching API documentation](https://docs.mapbox.com/api/navigation/map-matching/).
3. Each tracepoint-owned temporal run is assessed using an explainable
   composite score: Mapbox confidence, coverage, ambiguity, bearing agreement,
   length agreement, endpoint safety, lateral consistency, temporal
   persistence, accuracy and overlapping-window agreement.
4. O49's truth envelope remains the normal gate. The only overrun path allows
   at most a one-metre p95 excess and additionally requires high score, stable
   signed displacement, at least 80% unambiguous known alternatives, safe
   endpoints, topology, length and maximum displacement. This is why the
   opening's historical 15.058 m p95 is accepted without globally loosening the
   15 m guard.
5. Accepted network topology selects one of:
   `A_PEDESTRIAN_NETWORK`, `B_ROAD_OFFSET`, or
   `C_CANONICAL_DERIVED`. A named road is never displayed as its centreline:
   Mode B projects canonical points onto the network, rejects outliers, and
   requires a stable sign, bounded MAD/residual, bearing agreement, low
   ambiguity and accuracy-plausible magnitude before applying the robust local
   median offset. An ambiguous side becomes Mode C.
6. Where matching is unusable, at most three walking-Directions requests use
   already-observed subsection anchors. A successful route is merely a
   candidate; it must pass the same shape, displacement, length, endpoint,
   ambiguity and seam gates. Mapbox documents walking Directions as using
   pedestrian-accessible routing such as sidewalks and trails in the official
   [Directions API documentation](https://docs.mapbox.com/api/navigation/directions/).
7. Short coherent transitions use the simplest evidence-supported connector.
   Off-network geometry uses accuracy-bounded, multi-scale turn/reversal-aware
   simplification and interpolated display density. Endpoints, meaningful
   corners, U-turns, repeated traversal, Z/switchbacks and Gap boundaries remain
   protected.
8. Every candidate passes subsection truth, topology and seam gates. The fully
   assembled Activity then passes endpoints, length, edge-spike and duplicate
   checks. Failure falls back first to cleaned canonical geometry and finally
   to exact canonical geometry.

Production integration is segment-local. A Gap is never sent to the
compositor, so no network or cleanup path can bridge missing movement. Final
processing is not imported by either Live screen; Memory reconciliation still
iterates `s.trackPoints`, never Final geometry.

## Internal path investigation

`NoSegment` was not interpreted as “the path does not exist.” The investigation
separated rendered-vector evidence, routing evidence and pedestrian display
authority:

- Road-layer Tilequery probes found a `path/footway` near the very beginning,
  but not a continuous dedicated pedestrian geometry through the opening or
  internal route. The opening also had named primary/residential/service road
  candidates. Mapbox documents `sidewalk`, `crossing`, `footway`, `path` and
  `trail` road feature types in the
  [Mapbox Streets v8 reference](https://docs.mapbox.com/data/tilesets/reference/mapbox-streets-v8/).
- Internal and lower/middle probes did not expose a usable road-layer feature
  at representative middle points. A feature visible in a rendered basemap is
  not necessarily present as walking-routing topology; Tilequery and rendered
  styling answer different questions. See the official
  [Tilequery API documentation](https://docs.mapbox.com/api/maps/tilequery/).
- Production Map Matching returned `NoSegment` for the stable middle windows
  and sparse/ambiguous support around the transitions.
- A walking-Directions probe over the internal/common subsection could return
  an `Ok` route between observed anchors, but its geometry failed the O50 shape
  and truth gates. That proves Directions reachability without proving that the
  returned route represents what was walked.
- Nearby external roads explain the ambiguity at the road crossing. At the
  final corridor, matching support was useful but not safe as a complete
  display candidate; bounded walking Directions produced the coherent road
  topology that then passed the same evidence gates.

Therefore the internal path remains `OFF_NETWORK_PATH`/Mode C. This is an
affirmative safety result, not an early stop at `NoSegment`.

## Real `snap` section report

Network confidence is `n/a` for canonical-authority rows; their value `1` in
machine output denotes truth-authority confidence, not network confidence.
Length ratios are section-weighted from the exact production sections.

| Product section | Final state and mode | Network evidence / decision | Offset | Score | p95 displacement | Length ratio |
|---|---|---|---:|---:|---:|---:|
| Opening road, 0–61 | `NETWORK_CONFIDENT` Mode B through 59, then free transition | 24/24 window support; Mapbox confidence 0.926; 95.8% unambiguous; coherent isolated envelope overrun accepted | +14.170 m | 0.8848 | 1.254 m after offset | 0.9720 |
| Road crossing, 62–104 | `FREE_TRAVERSAL` into Mode C | matcher alternatives/null support and Directions shape were unsafe; simplest bounded connector then canonical cleanup | — | n/a | 2.323 m | 0.9611 |
| Internal outbound, 105–158 | `OFF_NETWORK_PATH`, Mode C | high null support/`NoSegment`; Directions candidate failed shape agreement | — | n/a | 1.589 m | 0.9789 |
| Lower/middle corridor, 159–283 | `OFF_NETWORK_PATH`, Mode C | stable windows returned `NoSegment`; no safe road-layer ownership | — | n/a | 1.470 m | 0.9789 |
| Stop area, 284–304 | `OFF_NETWORK_PATH`, Mode C | canonical stop chronology retained; measurement wobble cleaned | — | n/a | 1.187 m | 0.9789 |
| Internal return, 284–327 | `OFF_NETWORK_PATH`, Mode C | `NoSegment`/sparse external-road support; canonical return retained | — | n/a | 2.162 m | 0.9789 |
| U-turn/repeated path, 254–327 | `OFF_NETWORK_PATH`, Mode C | temporal order, reversal and both corridor passes retained | — | n/a | 2.072 m | 0.9789 |
| Final road, 328–391 | Mode C to 331, then `NETWORK_CONFIDENT` Mode B | bounded Directions 332–391 passed after matching candidate remained unsafe; derived shape confidence 0.851, unambiguous route candidate | +7.960 m | 0.8769 | 0.716 m | 0.9905 |

Positive offset means the signed left side of each candidate's traversal
direction. It is not a standard sidewalk width. The different opening and final
values are independently recovered from their observations.

## Product visual scorecard

Historical `back` is evaluated only as visual reference; it has no canonical
truth pair, so its displacement and length-preservation cells are self-relative
and must not be interpreted as accuracy evidence.

| Measure | Historical `back` | O49 `snap` | O50 `snap` |
|---|---:|---:|---:|
| Vertices | 87 | 348 | **97** |
| Vertices/km | 99.2 | 408.5 | **117.8** |
| Short-scale heading jitter p50 | 2.95° | 7.73° | **0.50°** |
| Non-major heading-change p95 | **25.97°** | 36.32° | 41.20° |
| Alternating small zig-zags | **0** | 58 | **0** |
| Meaningful turns represented | 6 | 14 | 11 |
| Canonical displacement p95 | n/a | 7.962 m | **1.542 m** |
| Canonical displacement max | n/a | 8.835 m | **3.200 m** |
| Length ratio to canonical | n/a | 1.01043 | **0.97685** |

O50 reaches `back`-like density and eliminates O49's 58 alternating small
zig-zags. Its p95 heading-change value is higher because real `snap` contains
more protected corners, a crossing, U-turn and repeated traversal than `back`;
the zero alternating-zig-zag count and 0.50° median distinguish those retained
turns from pervasive GPS wobble. The visual board shows one route with uniform
stroke density and no centreline jump, artificial bridge or visible authority
seam.

Review artifacts:

- `docs/review/activity-real/snap/O50_SNAP_PRODUCT_COMPARISON.html` — default
  back / O49 / O50 panels and subsection table;
- `docs/review/activity-real/snap/O50_REAL_REPLAY_RESULTS.json` — privacy-safe
  machine scorecard, section decisions and request timing;
- `docs/review/activity-real/snap/O50_SNAP_PRIVACY_SAFE_GEOMETRY.json` — local
  metre frames only;
- `docs/review/activity-real/snap/run_o50_replay.mjs` — exact production-module
  replay and artifact generator.

The historical `back` panel uses its own local frame. O49 and O50 share the
`snap` local frame. No absolute cross-Activity frame is mixed.

## Performance

The final reproducible replay used:

- Map Matching requests: **8**;
- walking-Directions fallbacks: **3**;
- cumulative Map Matching request duration: **7,230 ms**;
- cumulative Directions duration: **1,171 ms**;
- cumulative request duration: **8,401 ms**;
- wall-clock API phase: **3,751 ms** through bounded concurrency;
- total compositor/save-processing duration: **3,784 ms**.

Production limits are 33 matching requests for unusually long activities,
three Directions requests, four concurrent matching calls, a 10 s total Finish
budget and a 2.6 s per-call timeout. Timeout, network failure and missing-token
paths use canonical-derived fallback.

## Regression and validation evidence

Permanent O50 tests cover:

- obvious pedestrian-aligned mapped geometry and independent sidewalk mode;
- road centreline plus stable evidence-derived side offset;
- the coherent 15.058 m threshold-overrun regression;
- ambiguous parallel roads;
- diagonal crossing and side A → crossing → side B;
- mapped → off-network → mapped assembly;
- common internal path and Directions-routable/Map-Matching-failing fallback;
- true unmapped trail and plaza/open area;
- U-turn, repeated corridor, Z and switchback;
- stop boundary and Gap non-bridging;
- timeout/canonical fallback and non-standard offset magnitude.

Results:

- O50 suite: **19/19 passed**;
- targeted O50 integration + O49 matcher suite: passed;
- standalone TypeScript compile of O49 matcher and O50 compositor: passed;
- `npm run verify:changed`: **32 suites / 368 tests passed**; only the same
  pre-existing `v409-offlineQueue.test.ts` suite failed its seven removed
  `readQueueSnapshot`/`clearQueue` helper expectations, reproduced before O50;
- Expo Web: bundled successfully and rendered at **390×844** with O50 visible;
  only known localhost-to-production diagnostic CORS rejection appeared;
- no native GPS source changed, so native telemetry is not newly required;
- O50 added no backend change and no backend deploy or client OTA was run.

## Authorized real `snap` QA mutation

The exact automatic O50 array was written directly to the existing `snap`
row's `route_points`. Nothing else was mutated.

- O49 route hash before:
  `eb5f5a03dace61460288e6004023a7a035ba0d3a69956a481d34169745c20b3f`
- O50 route hash after:
  `208fa97501e8f70201d0701bfe97815e8d93bcd51be3fd8df7863ceba74b70ec`
- Detail fingerprint: `f4f38b0c`
- Detail points: 97
- raw hash unchanged:
  `3d47e9144ae6d3e13e900e341787aefcb86586e7819a809cb6168f70a8fad13f`
- raw points unchanged: 428
- distance unchanged: 843.202 m
- duration unchanged: 805 s
- owner, finalized state, progression aggregate, Memory aggregate and flags:
  unchanged.

The independent fresh Detail-authority read passed identity, route hash, raw
hash, fingerprint, point count, chronology, metric, owner aggregate and Memory
aggregate checks. Evidence is in
`SNAP_O50_DB_UPDATE_AUDIT.json` and
`SNAP_O50_DETAIL_VERIFICATION.json`.

The original exact backup and O50 private handoff artifact are both mode 0600.
The original remains restorable with:

```sh
node docs/review/activity-real/snap/restore_snap_o48_from_backup.mjs --restore
```

The O49 → O50 Home marker advanced exactly once. App/runtime/build versions did
not change. OTA publication remains a manual human action.

## Human review

Open real `snap` Detail and evaluate the opening roadside position, the natural
departure/crossing, calm internal outbound/return geometry, preserved stop and
U-turn/repeated traversal, and the final roadside position as one continuous
route. Compare the overall visual calm against the historical `back` panel in
`O50_SNAP_PRODUCT_COMPARISON.html`.

**SNAP READY FOR O50 USER-GRADE FINAL REVIEW**
