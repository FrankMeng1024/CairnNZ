# Final V2 / New Zealand reconstruction

Date: 2026-09-13

Recommendation: **O50 + LIMITED V2 EXTENSION**

Validation class: **SIMULATION/OFFLINE VALIDATED — NOT REAL NZ FIELD VALIDATED**

## Verdict

Keep O50's segment-local compositor, conservative network gates, endpoint protection, pedestrian semantics, and true-Gap handling. Productionize only the offline-safe Base Final extension and its uncertainty/structure diagnostics. Keep Mapbox as a bounded optional enhancement. Do not productionize DOC, LINZ, or terrain snapping from this pass.

This is deliberately not an O50 rewrite. Current field evidence says O50's main safety choices are sound: it rejects attractive but ambiguous network geometry, retains off-network travel, and never sends a true missing section to a matcher. The gap was the canonical-derived fallback: it was still closer to a lightly simplified GPS trace than a finished consumer representation, especially on simple corridors.

## Authority recovered

`CairnNZ_Project_Authority.md` is not present in this workspace. Authority was recovered from current source and the newest retained evidence, principally:

- [O50 user-grade Final](./O50_USER_GRADE_FINAL_ROUTE.md)
- [O51 real-field forensic](./O51_REAL_FIELD_FORENSIC.md)
- [O52 precision/efficiency convergence](./O52_PRECISION_EFFICIENCY_CONVERGENCE.md)
- [O52 blind-field forensic](./O52_BLIND_FIELD_FORENSIC.md)
- [historical back forensic](./snap/HISTORICAL_BACK_FORENSIC.md)
- [SNAP forensic](./snap/SNAP_ACTIVITY_FORENSIC.md) and matcher dry-runs
- current canonical, background ownership, WAL, completion, Memory, and Detail source

No historical implementation was treated as correct merely because it exists.

## Architecture gap analysis

### What O50 already does well

- Works on independently segmented canonical truth, so a Gap is never offered to Mapbox as a traversed connector.
- Separates Map Matching and walking Directions candidates from accepted Activity geometry.
- Classifies pedestrian-network, road-offset, ambiguous, off-network, and free-traversal sections.
- Applies lateral, corridor, topology, seam, endpoint, length, and whole-route gates.
- Allows mixed output: accepted network subsections plus canonical-derived fallback.
- Preserves canonical distance, chronology, Memory, segment identity, and accepted-traversal authority.
- Times out to a valid local representation instead of making online evidence a validity requirement.

### Gap found

O50's fallback simplification protected essentially every sharp local turn. That was safe, but could freeze short uncertainty-scale Z shapes and same-corridor spurs into Final. It also used one median-accuracy tolerance without an explicit simple-versus-complex corridor decision. The result was appropriately conservative on mountain structure but under-finished on simple roads and valley-like corridors.

### V2 boundary

The extension is display-only and save-time only:

```text
raw evidence -> canonical acceptance/segments/metrics/Memory (unchanged)
                                      |
                                      v
                        offline Base Final per real segment
                                      |
                       optional bounded Mapbox candidates
                                      |
                            O50 gates + whole-route gate
                                      |
                              Activity display geometry
```

No V2 output feeds the canonical reducer, distance, Memory, or Gap classification.

## Base Final

`buildBaseFinalGeometry` is now the deterministic offline fallback. It:

- estimates effective uncertainty from reported accuracy p65, bounded to 3–30 m;
- detects structural turns at 5 m, 10 m, and 22 m scales instead of protecting a one-sample heading twitch;
- classifies the section as simple or complex from protected-turn density;
- uses a tighter simplification range for complex terrain and a slightly stronger one for simple corridors;
- removes only a short excursion that rejoins the same corridor, stays inside an uncertainty-derived 4–10 m depth fuse, has no source pause, and has a large path-length-to-endpoint-displacement ratio;
- preserves first/last anchors, chronology, section boundaries, and direction;
- densifies long display edges rather than reintroducing noisy raw vertices.

There are no Activity IDs, named-case branches, coordinate boxes, or incident-specific route constants. The larger-excursion, crossing, repeated traversal, U-turn, switchback, and Gap fixtures prove the ambiguity fuse in the generic implementation.

The Finish path now distinguishes `baseFinalSegmentCount` from actual `matchedSegmentCount`. A no-token/no-network result is `base_ready`, not an alleged partial network match.

## Mapbox contribution

Mapbox remains useful, but only when it proves the same journey. The installed production path uses the walking profile, `tidy=false`, source-index mapping, bounded concurrency, and a total Finish budget of 10 seconds. Existing O50 quality gates were retained.

The live Tongariro prototype made five Map Matching requests and three walking Directions requests. Map Matching returned candidate geometry, but the fused compositor accepted **0 m** of network distance because the whole-section evidence remained ambiguous/off-network. It retained **3,692 m** of canonical-derived Base geometry. That is a successful safety result, not a failed snap-rate result.

Mapbox documentation used for the prototype:

- [Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/)
- [Static Images API](https://docs.mapbox.com/api/maps/static-images/)

No additional API is called during live tracking. Cost is bounded by the existing save-time windows; exact account pricing was not assumed in code or acceptance. A timeout, missing token, 4xx/5xx, or rejected candidate returns Base Final.

## DOC experiment

DOC AllTracks was evaluated as a strong NZ topology prior, not a metre-level authority. The public service endpoint returned HTTP 503 during this run, so it could not support a reproducible live comparison. This is itself important offline/product evidence: DOC cannot be a prerequisite for Finish.

Decision: **prototype/research only; not productionized**. A later experiment should cache a licensed, versioned extract, measure coverage and displacement over a broad corpus, and pass it through the same candidate gates. Service availability, attribution, update policy, and licensing must be settled before shipping. References: [DOC map server](https://mapserver.doc.govt.nz/arcgis/rest/services/DTO/AllTracks/MapServer), [DOC maps](https://www.doc.govt.nz/maps), and [DOC data terms](https://www.doc.govt.nz/our-work/maps-and-data/terms-and-conditions/).

## LINZ and terrain

LINZ Topo50 is valuable for topology, terrain context, and plausibility, not metre-level snap authority. Its stated source/representation accuracy is incompatible with treating the visible Topo50 line as the exact walked centreline. [LINZ accuracy guidance](https://www.linz.govt.nz/products-services/data/types-linz-data/topographic-data/accuracy-statements-and-technical-information) supports that boundary.

Terrain could later reject an impossible valley-wall shortcut or help distinguish a ridge from a nearby road, but it cannot prove a missing trail segment and must never bridge a Gap. No LINZ or terrain runtime dependency was added.

Decision: **research finding only; not productionized**.

## NZ mountain simulation

The reproducible fixture uses public Tongariro Alpine Crossing walking geometry plus deterministic synthetic GPS degradation. Additional unit fixtures cover Kepler-style switchbacks, forest heavy-tail drift, a simple valley corridor, sparse/batched observations, no-network behavior, and preserved endpoints.

Tongariro result:

| Geometry | Points | Length | Ratio to reference | Reference displacement p95 |
|---|---:|---:|---:|---:|
| Trail reference | 361 | 3,696.4 m | 1.0000 | 0 m |
| Synthetic canonical | 91 | 3,692.0 m | 0.9988 | 7.1 m |
| Frozen O50 | 273 | 3,692.0 m | 0.9988 | 7.1 m |
| Offline Base Final | 273 | 3,692.0 m | 0.9988 | 7.1 m |
| Gated fused V2 | 273 | 3,692.0 m | 0.9988 | 7.1 m |

Base classified this route as complex, protected 89 structural turns, and removed no micro-excursion. O50 and Base therefore look the same in this difficult case. That is correct: the V2 extension must not flatten a route merely to demonstrate visible change. Its improvement is exercised on simple-corridor fixtures, where bounded wobble and a 7 m same-corridor spur disappear while a 15 m excursion remains.

The machine-readable scorecard is [FINAL_V2_NZ_SIMULATION_RESULTS.json](./FINAL_V2_NZ_SIMULATION_RESULTS.json). The ignored, reproducible six-panel human board is [comparison-board.png](../../../app/_review/overnight-final-v2/comparison-board.png), with canonical, frozen O50, Base, candidate, and fused views. It intentionally includes the rejected candidate rather than hiding the hard case.

## Existing real corpus

Private evidence was read as authority but not copied into new public fixtures. This pass did not claim that deterministic simulation re-ran an unavailable raw stream.

| Corpus family | Settled/current evidence used | V2 regression protection |
|---|---|---|
| `back`, `snap` | visual north star; network/coherence and endpoint forensics | O50 gates retained; no activity-name branch |
| `great hike` | bounded inward road-offset issue; one real segment | endpoint and whole-route gates retained |
| `run issue` | historical false Gap came from provenance/schema, not Final | segment-local Final; no Gap connector |
| `mstand` | timeouts with safe canonical fallback; truthful crossing | no-token/Base and crossing tests |
| `hike ka` | ambiguous candidates correctly rejected; delayed lifecycle evidence | complex/off-network and transition guards |
| `lost run` | true 328 s source loss; correct Gap plus later provenance reversion | true-Gap and provenance regression tests |
| stationary / Stop-V | source pause and stationary truth must not become cosmetic smoothing | pause boundary and structural-turn guards |
| U-turn / repeated route / Z | chronology and repeated traversal remain meaningful | U-turn, repeated traversal, and switchback fixtures |
| crossing | larger topology change must survive | diagonal/road-crossing fixtures |
| mapped / unmapped / mixed | candidate value varies section by section | network rejection, fallback, and mixed-section tests |
| true Gap | absent evidence is not traversed geometry | independent segment reconstruction; Route-only explicit reconnect |

## Safety and visual quality

- Canonical tracking truth is unchanged by Final V2.
- Canonical distance, chronology, Memory, accepted traversal, and segment identity remain authority.
- Gap truth is preserved; Base and Mapbox run independently per real segment.
- No wrong-road bridge is permitted across source loss.
- Network geometry is rejected when side/corridor/topology evidence is ambiguous.
- Simple corridors receive more visual finishing; complex mountain structure receives less simplification.
- Raw high-frequency evidence remains evidence, not normal display geometry.

## Tests and repeatability

- `pedestrianFinalRoute.test.ts`: Base uncertainty, small-spur removal, larger-excursion retention, crossing, U-turn, repeated traversal, gap, mapped/unmapped/mixed and existing O50 gates.
- `finalV2NzSimulation.test.ts`: Kepler structure, forest degradation, valley cleanup, sparse batches, endpoints, and no network calls.
- `evaluate-final-v2-nz.mjs`: compiles current code and frozen O50 commit `12fa1cd0ef599e53a81cd30537ce761c5e2150ce`, then regenerates JSON and the local comparison board.
- Final focused convergence lane: 16 suites / 183 tests passed; the exact gate is recorded in the overall report.

## Productionized versus prototyped

Productionized:

- uncertainty-aware Base Final;
- multi-scale structural-turn protection;
- bounded same-corridor micro-excursion cleanup;
- Base/network distinction in Activity Final state;
- generic regression and NZ synthetic fixtures;
- retained O50 Mapbox gates.

Prototyped/evaluated only:

- public NZ trail degradation corpus and comparison generator;
- live Mapbox candidate comparison;
- DOC as a possible topology prior;
- LINZ/terrain as context/plausibility evidence.

## Remaining validation

The result is not ready for an unconditional NZ field claim. It still needs:

- a real iPhone Finish with and without a token/network;
- a real NZ mountain tester on forest, valley, ridge/open top, mapped and unmapped trail;
- multi-hour offline Finish followed by later online transition;
- a background enhancement service if the product is to change `base_ready` to richer geometry after Finish. This pass models that state but does not silently mutate stored Activities later.

Until those gates pass, the correct decision is **O50 + LIMITED V2 EXTENSION**, not “ADOPT FINAL V2.”
