# O49 Final Snap implementation

Date: 2026-09-11 (Asia/Shanghai)

Status: **implementation and offline gates complete; real `snap` Detail projection updated for authorized visual QA; native Mixed-route validation still required.**

## Selected design

O49 keeps O48 canonical recording and changes only Final matching plus one narrow
moving-to-stop timeout boundary.

Per real Activity Segment, Final matching now does this:

```text
canonical ordered evidence
  -> sequence-aware ~4 s matcher evidence
  -> Mapbox walking, timestamps, tidy=false, accuracy radii 10...40 m
  -> contiguous tracepoint-supported temporal islands
  -> independent geometry/topology/seam gates
  -> MATCHED or exact CANONICAL fallback
  -> shared-boundary hybrid assembly
  -> whole-route validation
  -> Final display geometry only
```

The resampler preserves the Segment endpoints and the neighbours of strong
turns, reversals and stop/start time boundaries. It never spatially deduplicates
observations, so revisiting the same coordinate later remains distinct ordered
evidence. Inputs without trustworthy strictly increasing timestamps retain every
point rather than receiving invented timing.

Requests retain the walking profile, full GeoJSON geometry, timestamps when
valid and the existing accuracy-aware radius policy. O49 changes `tidy=true` to
`tidy=false` because Cairn now performs deliberate bounded resampling itself.
Chunks contain 80 submitted observations with one shared temporal boundary;
a final remainder is absorbed up to Mapbox's 100-coordinate limit to avoid a
tiny tail request becoming an artificial route seam.

Mapbox geometry has no ownership without tracepoint provenance. Each matching's
tracepoints are split into maximal contiguous temporal runs. Every run maps back
to exact canonical source indices and is cropped between its supported
tracepoints. The tracepoint-to-geometry mapping is monotonic, which prevents an
out-and-back endpoint at the same coordinate from being confused with its
earlier departure.

## Independent island gates

An island needs at least three submitted supports and 10 m of canonical source
length. It then passes:

- existing confidence floor plus bounded raw-to-matched p50/p95/max deviation;
- bounded endpoint displacement and length ratio;
- net-bearing compatibility where meaningful;
- reversal preservation (lost and invented reversals are rejected);
- entry/exit edge, heading and introduced-loop seam checks.

An unsafe seam is cropped inward by up to four supported observations and
retested. If no supported boundary is acceptable, the island is rejected. O49
does not prepend/append a separate bridge: the exact canonical boundary replaces
the matched endpoint atomically, and assembly shares that one boundary vertex.

The final route validator independently protects Activity endpoints, total
length, maximum edge size and duplicate zero-length edges. It removes the
weakest matched island until the complete route passes, or returns exact
canonical geometry. No global smoothing or post-assembly dedupe runs.

## Stop-V fix

The real incident was a `possible-stationary-jitter` Candidate expiring after
about five seconds. The resolving fix had no `speedAccuracy`, but its scalar
speed was previously treated as independently reliable and created one false
5.171 m canonical edge.

Only that timeout boundary changed. When the expired Candidate reason is
`possible-stationary-jitter`:

- scalar speed needs a finite measured `speedAccuracy <= 0.8 m/s` to establish
  motion by itself;
- the pre-timeout recent-window cumulative signal cannot establish motion by
  itself;
- accuracy-adjusted lower-bound progression can still accept immediately;
- otherwise the traversal anchor stays fixed and a fresh bounded Candidate lets
  the next coherent fix confirm departure.

The deterministic incident now contributes 0 m and no Memory. Missing speed
uncertainty plus a second coherent departure fix resumes on that second fix.
Measured reliable speed still resumes at the timeout itself. Normal O48
classification outside this exact timeout remains unchanged.

## Three route classes

### Mapped

Deterministic mapped fixtures pass, including ordered A→B→A→B and an
out-and-back whose start and finish share coordinates. The real `snap` final
public corridor is accepted independently.

### Unmapped / internal

`NoMatch`/`NoSegment` stays exact canonical. A deterministic internal-path
candidate shifted 16 m onto an external road fails the deviation gate even with
moderate reported GPS accuracy. Radius policy was not widened.

### Mixed

Tests exercise two independently supported matching islands around null
tracepoints and exact canonical fallback in between. A single Mapbox matching
with internal null support is likewise split into separate temporal islands.
Gaps remain caller-owned Segment boundaries and are never included in one
matcher request.

## Whole-route visual continuity

Hybrid assembly operates on source chronology, not nearest geography. Canonical
and matched pieces share an exact source boundary vertex; no connector, union,
global simplification or global smoothing is generated. Seam gates compare the
derived heading with canonical geometry on the same side, so a real 90-degree
turn or U-turn is not penalized merely for being sharp.

The real `snap` island required one tail-support crop. Its accepted entry/exit
edges are 10.392 m / 9.657 m inside a 22 m bound; heading deltas are 48.25° /
61.20° inside the bounded seam rule. The complete O49-only mobile preview is a
single continuous stroke with no missing portion, duplicate edge, tiny loop or
style/density boundary. The expected approximately 8 m road correction is
visible in the optional canonical overlay, but the normal Final-only view has
no disconnected geometry or separate rendering layer.

## Real `snap`

Source Activity: server session 2073, one Segment, 392 canonical points, 428 raw
observations, canonical metric distance 843.202 m.

| Decision | O48 Final | O49 Final |
|---|---:|---:|
| Matcher input | 392 dense canonical fixes | 162 ordered observations |
| Requests | fixed dense chunks, `tidy=true` | 2 balanced requests, `tidy=false` |
| Accepted matched islands | 0 | 1 |
| Matched canonical distance | 0 m | 85.338 m |
| Canonical fallback distance | 843.202 m | 757.864 m |
| Final display point count | 392 | 348 |

The accepted source range is 328–389. Confidence is 0.976010. Island
raw-to-matched displacement is p50 7.935 m, p95 8.670 m, max 8.833 m;
endpoint displacement is 8.744 m and island length ratio is 0.9913. The whole
route display length is 852.021 m versus canonical 843.202 m (ratio 1.01046),
while the saved metric remains the canonical 843.202 m. Maximum display edge
is 14.271 m, equal to the canonical maximum.

- Initial head: **CANONICAL**. In the complete O49 request its supported run
  confidence is only 0.0914; no special threshold was added for the earlier
  isolated borderline probe.
- Road crossing and Stop-V area: **CANONICAL**.
- Internal path, U-turn and repeated traversal: **CANONICAL**, therefore exact.
- Re-entry/final public corridor: **MATCHED** over 328–389, with source
  390–391 retained canonical after the tail crop.
- Known wrong-road stealing: **0 m**.

Privacy-safe replay details are in
`snap/O49_REAL_REPLAY_RESULTS.json`; the mobile local-metre comparison is
`snap/O49_SNAP_FULL_ROUTE_PREVIEW.html`.

## Historical `back` and `almost done`

The historical `back` control has no stored point timestamps, so O49 conservatively
retains all 87 points. Mapbox returned confidence 0.9811, but the candidate failed
modern maximum-deviation/endpoint protection (endpoint displacement 29.189 m),
so O49 retained all 877.356 m canonical. The reusable historical idea is sparse
ordered matcher input. Whole-history Kalman smoothing, whole-chunk ownership,
scalar-speed authority and aggressive acceptance were not restored.

The former server row for `almost done` (2072) is no longer present during the
fresh read-only lookup, while its immutable QA telemetry remains. Its settled
forensic records `NoMatch`/`NoSegment` and extremely sparse tracepoint support;
O49's deterministic no-match, partial-support, internal fallback and Gap tests
cover those same matcher outcomes without fabricating unavailable coordinates.

## Save / Detail authority

`useTrackingStore` invokes O49 independently for each real Segment. A Segment is
considered refined only when at least one island survives. The exact same Final
array is written to local completed-session Detail, pending replay and server
`route_points`. Server Activity Detail reads `route_points` and normalizes its
segment fields. Canonical `s.trackPoints` remains the source for distance,
duration, elevation, Memory reconciliation, journal truth and progression.

Telemetry version `segment-walking-v4-islands` records canonical/resampled
counts, source-index maps, request cadence/radii/profile/tidy policy, response
status/code and tracepoint counts, island decisions and gate objects, seam
cropping, accepted/fallback distance, whole-route decision and the privacy-safe
Final fingerprint. The real replay fingerprint is `1877739a`.

## Authorized real-Activity visual projection

The existing `snap` row was backed up and then only `route_points` was replaced
with the O49 hybrid for QA. This schema column is both the server's historical
saved route projection and normal Detail geometry; there is no separate Final
column. The raw evidence and canonical metric fields were not changed.

- Backup: `snap/SNAP_BEFORE_O49_DB_BACKUP.json` (local, sensitive, mode 0600)
- Restore tool: `snap/restore_snap_o48_from_backup.mjs --restore`
- Audit: `snap/SNAP_O49_DB_UPDATE_AUDIT.json`
- O48 route hash: `3e1b6d8cdccd27c2b89e05935f0119dd6b930424f7fa8cf599a692c9ec09ac51`
- O49 route hash: `eb5f5a03dace61460288e6004023a7a035ba0d3a69956a481d34169745c20b3f`
- Raw hash before/after: `3d47e9144ae6d3e13e900e341787aefcb86586e7819a809cb6168f70a8fad13f`

The transaction verified the same owner and client Activity identity, unchanged
finalized timestamp, 428 raw points, distance 843.202 m, duration 805 s,
unchanged 12/10 total/finalized owner-session counts, unchanged aggregate
distance/duration and unchanged 170-row Memory aggregate. No Activity row or
pending sync was created, and flags remain `null`.

To restore O48 after review:

```sh
node docs/review/activity-real/snap/restore_snap_o48_from_backup.mjs --restore
```

The restore tool locks and revalidates identity, raw hash and metric fields,
updates only `route_points`, and requires the restored MySQL route hash to equal
the backup hash before commit.

## Performance

The 10,000-observation test retains at most 2,502 matcher observations and at
most 33 bounded requests; state is bounded and no business-state writes occur
per matcher observation. Its mocked matcher run completes inside the suite's
20-second guard (approximately 5 seconds in this environment).

The final pre-write real `snap` run made 2 requests in parallel. Request
durations were 771 ms and 969 ms; total matcher duration was 978 ms, inside the
4,000 ms Save budget. Ordinary timeout/error/NoMatch/NoSegment failures remain
silent canonical fallback.

## Verification

- `npm run verify:activity:gps`: **278/278 PASS**.
- Focused matcher: **39/39 PASS**.
- Focused continuity: **35/35 PASS**.
- Scoped `snapTrack.ts` TypeScript compile: **PASS**.
- `npm run verify:changed` / Activity Core: all 32 in-scope Activity suites and
  368 tests passed in the recorded run; seven pre-existing
  `__tests__/v409-offlineQueue.test.ts` cases fail because that old test mocks
  `readQueueSnapshot` and `clearQueue`, which are not exported. No O49,
  tracking, matching, presentation, Memory, journal, recovery, server or sync
  test failed. This unrelated baseline was classified, not retried or edited.
- Full-route and corridor previews were rendered at mobile dimensions and
  inspected. No production UI component or visual token changed.

## Delivery

- Home marker advanced exactly once: **O48 → O49**.
- App/runtime/build versions: unchanged.
- Native build required: **NO**.
- OTA published: **NO**. The human-controlled Internal OTA is ready to prepare.
- Backend code deployed: **NO**. The only production data operation was the
  explicitly authorized, reversible `route_points` QA update for session 2073.

## One Mixed-route native validation

Record one 20–30 minute Internal Hike containing: 60 s stationary start, normal
and slow walking on a clear mapped public path, a 90-degree turn, road crossing,
abrupt stop, real internal/unmapped path, U-turn, the same corridor three times,
mapped re-entry, five minutes screen-off background recording, foreground
restore, transient Notification Center, stop/resume, Finish and Detail review.

Confirm Live remains close and continuous; the abrupt stop creates no V; slow
walk, U-turn and repeated passes have no hesitation; background history restores
immediately. In Final Detail, confirm safe mapped sections improve, the internal
and crossing geometry remain truthful, matching resumes after mapped re-entry,
and no seam, bridge or wrong-road attraction is visible. Capture O49 telemetry,
battery delta and thermal state. This is algorithm validation, not a multi-hour
battery certification.

**READY FOR O49 INTERNAL OTA + ONE MIXED-ROUTE NATIVE VALIDATION**
