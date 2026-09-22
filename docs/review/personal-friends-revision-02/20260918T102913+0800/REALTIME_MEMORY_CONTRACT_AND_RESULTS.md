# Real-time Memory contract and results

## Authoritative sequence

`accepted real movement -> durable Activity journal -> durable Memory evidence -> incremental personal display`

Finish performs completeness/reconciliation. It does not grant permission for the first reveal. The accepted-point handler awaits its Activity journal append, commits Memory with `activity_real` provenance, and only then publishes accepted live state. It requires neither a network response nor a server Activity ID. One native watcher remains authoritative.

## Truth separation

- Exploration coverage: spatially deduplicated accepted personal footprints.
- Time-qualified presence: bounded real-source witnesses with immutable first observation and a separately advanced latest observation.
- Display geometry: unioned and cosmetically smoothed only inside the accepted evidence envelope; never persisted as truth.
- Friend projection: coarse server-authorized cells retained under the source friend, never merged into personal exploration.

Final/snap-to-road, planned or borrowed Routes, Cairn creation, simulator fixtures, historical unknown rows, map pan, cached friend coverage, and arbitrary flat-list adjacency cannot become personal exploration or Encounter truth.

## M-LIVE results

| ID | Executed evidence | Result |
|---|---|---|
| M-LIVE-01 | `useTrackingStore`: accepted foreground point calls durable Memory before Finish while `remoteSessionId` is null | PASS |
| M-LIVE-02 | stationary-jitter handler fixture plus repeat-presentation dedupe | PASS |
| M-LIVE-03 | same-place later witness changes presence only; repeat display area is unchanged | PASS |
| M-LIVE-04 | straight/bend/switchback/ring/parallel fixtures retain supported footprints and courtyard hole | PASS |
| M-LIVE-05 | source gaps, loss/reacquisition, separate segments/Activities, and pause do not gain connectors | PASS |
| M-LIVE-06 | offline persistence/reload/recovery and Finish reconciliation preserve truth without duplicate witnesses | PASS |
| M-LIVE-07 | 1999/2000/2001 boundary retains the prior footprint; former global-stride defect removed | PASS |
| M-LIVE-08 | changed middle geometry or authority revision changes the cache signature at equal count | PASS |
| M-LIVE-09 | self+A+B, deselect/revoke/account/expiry/late-read fences remove only the invalid source | PASS |
| M-LIVE-10 | slow/error/unavailable/remount/retry paths keep personal management usable and prevent cross-authority last-good reuse | PASS for deterministic/Web subset |

## Presentation measurements

The output is in `qa/memory-presentation-metrics.json`.

| Measure | Result |
|---|---:|
| Accepted evidence | 240 synthetic points |
| Evidence radius | 30 m |
| Geometry build p50 / p95 / max | 453 / 582 / 582 ms |
| Evidence-to-display p50 / p95 / max | 573 / 702 / 702 ms |
| Maximum synchronous bounded slice | 388 ms |
| Interactive build budget | 650 ms |
| Build + coalescing budget | 800 ms |
| Prior supported samples lost | 0 |
| Unsupported reveal area | 0 m² |
| Output | Polygon, 2,294 vertices, 91,487 bytes |
| Presentation updates | 6 |

Machine: Darwin x64, Intel Core i5-5350U 1.80 GHz, Node v24.11.1, standalone Turf/GeoJSON. The fixture is synthetic accepted-source-contract geometry near New Zealand. These numbers do not establish native Mapbox frame performance, physical GPS behavior, battery impact, or New Zealand field validation.

The test’s 20-second outer envelope permits multiple yielded synthetic slices to complete; it does not relax the 650 ms per-build, 388 ms observed per-slice, or 800 ms evidence-to-display bounds.

