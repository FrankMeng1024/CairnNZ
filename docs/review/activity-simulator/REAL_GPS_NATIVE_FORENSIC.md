# Real GPS native forensic — O39

Date: 2026-09-09 (Asia/Shanghai)

This document separates human observation from evidence. It was written before
any Real-GPS corrective code change in this investigation.

## Evidence scope and limits

- Native QA session: `qa-mttqqopk-ksz87ea5`.
- Client diagnostic launch: `mttsfq4a-4e10g6yq`.
- Production account correlation: user 72, read-only.
- The QA session reached its 2,000-event / 512-KiB retention bound. Later
  uploads replaced the server row with the then-current bounded JSONL. The
  retained JSONL contains lifecycle and map-idle events, but no longer contains
  the routine `real_location_sample_observed`, `location_sample_accepted`, or
  `location_sample_rejected` events for these Activities.
- `debugLogger` recorded foreground Core Location callbacks only to its local
  Activity diagnostic file. No corresponding non-QA telemetry row was uploaded
  for either Activity. The physical iPhone was not connected to this Mac, so
  its Activity journal and local pending payload could not be read safely.
- Consequently, exact callback/sample interval median, p95, and maximum values
  cannot be reconstructed for these two historical recordings. They are marked
  **INCONCLUSIVE**, not estimated from the saved polyline.

## Observed issue A — `underground`

### OBSERVATION

During a real subway Hike, the Mapbox device-position puck later showed a
current above-ground position while the accepted Activity route and Recenter
appeared to remain at an older underground position. The GPS affordance stayed
green.

### EVIDENCE

- Client Activity ID:
  `2d94c03b-f455-4f17-b00b-1f95b4f4cc4f`.
- Server shell: session 2058 (subsequently deleted when the client resolved the
  completed-local Activity and started the next Activity).
- Name recorded in the local completion diagnostics: `underground`.
- Tracking began at 2026-09-09 15:39:53.580 Shanghai time and Finish was
  requested at 16:28:03.714: 48 minutes 10.134 seconds of lifecycle time.
- The retained lifecycle telemetry records 13 foreground transitions and 25
  inactive/background transitions. The final foreground transition was at
  16:27:33.409, 30.305 seconds before Finish.
- Completion diagnostics report 20 canonical raw/audit points, 5 accepted
  clean points, 3 Activity segments, and 75.78 m accepted distance.
- Segment-aware matching received only the first three-point segment. The two
  remaining one-point segments were preserved but were not matchable.
- The incremental append and final Save both returned HTTP 400. The exact API
  validation error was `points[n].t must be an integer` /
  `route_points[n].t must be an integer`. The Activity was committed locally as
  `saved_pending`; it was not durably represented in production `sessions`.

### TIMELINE

| Shanghai time | Proven transition |
| --- | --- |
| 15:39:53.580 | Real Hike start requested |
| 15:39:53.720 | Real foreground/background provider reached `tracking` |
| 15:40–16:24 | Repeated foreground/background transitions while underground |
| 16:27:33.409 | App returned active for the last time |
| 16:28:03.714 | Finish requested |
| 16:28:03.752 | Three segments / five accepted points entered completion |
| 16:28:03.888 | Atomic Save rejected because point timestamps were fractional |

### FIRST DIVERGENCE LAYER

**INCONCLUSIVE for this historical incident.** The retained evidence proves
that Mapbox and Activity used different authorities, but it does not preserve
the final above-ground callback/rejection event needed to decide whether the
first divergence was:

1. Mapbox's native `UserLocation` callback versus Expo's Activity watcher;
2. Expo callback versus canonical `addTrackPoint`; or
3. canonical validation versus accepted Activity state.

The first *architecturally proven* divergence is the authority split:

- Mapbox's visible puck is its native `UserLocation` component.
- Activity Recenter reads `useTrackingStore.lastCoordinate`, the latest
  accepted Activity coordinate.
- The green GPS dot reads `locationAvailable`, which is set when a source is
  successfully started. It does not mean a recent raw fix or a recent accepted
  fix.

### HYPOTHESES TESTED

#### HYPOTHESIS A — stale accepted continuity baseline

**PROVEN unsafe code path; incident attribution INCONCLUSIVE.** In hiking mode,
`hiking-overspeed`, `stationary-suppressed`, and `indoor-drift-suppressed`
retain the old `lastCoordinate` but advance `lastCoordinateTime`. A later fix
at a genuinely new position is therefore compared to an old coordinate over a
recent time interval and can be rejected as `implausible-teleport`. The
long-loss recovery exception is not available until 120 seconds after that
advanced time. The human inspected/finished only 30 seconds after the final
foreground transition, so this defect matches the observed window, but the
evicted rejection event prevents claiming that it was the exact incident path.

#### HYPOTHESIS B — accepted/persisted but stale live UI

**NOT PROVEN.** Foreground acceptance is serialized as validation → verified
journal replacement → Zustand publication. The line is derived from the
published accepted array and Recenter reads the published accepted tail. No
retained event proves that a fresh above-ground point crossed the journal
boundary while the store stayed stale.

#### HYPOTHESIS C — Activity subscription did not recover

**INCONCLUSIVE.** Source activation is serialized and the lifecycle shows the
app foregrounded, but the exact Expo watcher callback events were evicted.

#### HYPOTHESIS D — accepted batch not published/rendered

**NOT SUPPORTED by current code.** There is no accepted-point publication
batch. Each accepted foreground point is published after its individual
journal commit. Headless background batches are queued and drained at one
second while the background source is active; a foreground transition can,
however, stop draining a late background callback, so that queue race remains
a separate test target rather than a conclusion about `underground`.

#### HYPOTHESIS E — green status represented another authority

**PROVEN.** Green means only `locationAvailable === true`, i.e. a location
source was activated. It is not an Activity-fix freshness or acceptance-health
indicator. The separate signal-loss calculation uses the accepted route tail,
but has no independent clock subscription, so complete GPS silence need not
cause React to recompute it at the two-minute boundary.

#### HYPOTHESIS F — lifecycle/ownership generation failure

**INCONCLUSIVE.** The recording had unusually frequent AppState transitions,
but no retained stale-generation rejection proves an ownership failure.

### PROVEN ROOT CAUSE

The complete historical Issue A cause remains **INCONCLUSIVE** because the
decisive callback/rejection events are no longer available. Three independent
defects are nevertheless proven by production diagnostics and executable code:

1. rejected real samples can advance the continuity time while retaining the
   old accepted coordinate, delaying credible reacquisition;
2. the green GPS status reports provider activation, not current Activity
   tracking health, and its loss clock does not tick independently; and
3. fractional native timestamps make both incremental backup and final Save
   permanently fail the server's integer timestamp contract.

Only those proven defects may justify implementation.

## Observed issue B — outdoor route and timer lag

### OBSERVATION

On a real outdoor walk, the Mapbox device puck moved ahead while the Activity
line stayed behind and caught up after roughly 10+ seconds. The timer appeared
to freeze and then jump at the same time.

### EVIDENCE

The temporally adjacent real outdoor candidate is Activity
`874bb114-d2a5-4106-9429-8c0cc194d007` (server shell 2059). The human did not
provide its saved name, so the correlation is strong but not absolute.

- Tracking: 16:28:25.247 to the Pause/Finish snapshot at 16:33:22.441
  Shanghai time (297.194 seconds).
- Canonical audit array: 48 samples.
- Accepted clean array at Finish: 19 points.
- Accepted distance: 297.97 m.
- Matched/display payload: 20 points; raw payload: 48 points.
- The QA payload retained map lifecycle but evicted per-sample timing events.
- The final Save again failed only because `t` was fractional, and the local
  Activity was committed as `saved_pending`.

Counts provide throughput, not interval percentiles: 48 audit points in 297.2
seconds is 0.162 samples/s; 19 accepted points is 0.064 points/s. These ratios
are consistent with visibly discrete updates but cannot provide median, p95, or
maximum interval without the original point timestamps.

### TIMELINE

| Shanghai time | Proven transition |
| --- | --- |
| 16:28:25.093 | Real Hike start requested |
| 16:28:25.247 | Source active / tracking |
| 16:28:37–16:32:49 | Multiple background/foreground transitions; map also unmounted and remounted once while tracking |
| 16:33:22.441 | Pause/Finish snapshot: 19 accepted, 297.97 m |
| 16:33:26.398 | Payload: 20 matched/display, 48 raw |
| 16:33:26.514 | Save rejected for non-integer point timestamps |

### Layer cadence

| Layer | Evidence for this Activity | Median | p95 | Max |
| --- | --- | ---: | ---: | ---: |
| Native/Core Location callback | Local-only `gps_fix` file unavailable | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Canonical audit sample | 48 samples / 297.2 s | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Accepted Activity point | 19 points / 297.2 s | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Durable journal | one verified replacement per accepted foreground point; no duration telemetry | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Tracking-store publication | immediately after that journal promise; no duration telemetry | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| React trace state | one renderable array update per published accepted point | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Mapbox source/render | map-idle evidence retained, source-update timing not retained | INCONCLUSIVE | INCONCLUSIVE | INCONCLUSIVE |
| Timer state | advances only on accepted same-segment point intervals | coupled to accepted points | coupled | coupled |
| Timer render | React renders the changed `durationS` | coupled to accepted points | coupled | coupled |

### FIRST DIVERGENCE LAYER

For the timer, the first divergence is **PROVEN** at Activity metric state:
`durationS` changes only when a clean point is accepted in the same segment.
GPS loss, rejection, and silence therefore freeze the timer by design. This
contradicts the stated lifecycle requirement.

For the line, the earliest proven authority difference is before rendering:
the puck uses Mapbox native UserLocation, while the trace uses only accepted
points after a synchronous validation and an awaited journal commit. The
outdoor candidate reduced 48 audit samples to 19 accepted points. In addition,
the live line uses a low-process-noise Kalman endpoint instead of the accepted
raw endpoint, deliberately adding spatial following lag. There is no evidence
that Mapbox delayed an already-published source update by ten seconds.

### HYPOTHESES TESTED

- **Native callbacks intrinsically too sparse:** **INCONCLUSIVE.** Current
  configuration is `BestForNavigation`, initially 3 s, dynamically 10 s static
  / 1 s walking / 0.5 s running, with a 5 m distance filter. Exact native
  callback timestamps are missing, so the configuration must not be changed on
  this evidence.
- **Canonical filtering/publication caused discrete line updates:**
  **SUPPORTED.** Only 19 of 48 audit samples became clean points, and the trace
  can update only after those points. Exact rejection reasons were evicted.
- **Durable journal introduced 10-second latency:** **INCONCLUSIVE but not
  supported.** Publication awaits a verified snapshot write, but no journal
  duration measurement exists. The small 19-point file makes a repeated
  ten-second write unlikely, not impossible.
- **Store batching:** **REJECTED.** Accepted points are not batched in the
  Zustand store.
- **Mapbox source batching:** **INCONCLUSIVE and not supported.** There is no
  source-publication timing evidence; timer jumps at the same moments and does
  not depend on Mapbox.
- **Timer coupled to GPS geometry:** **PROVEN.** Both live and final
  `duration_s` are derived from accepted same-segment point timestamps.

### PROVEN ROOT CAUSE

1. The timer uses GPS-geometry evidence as its clock. It therefore freezes
   whenever no clean point is accepted and jumps by the accepted interval on
   the next point.
2. The trace is intentionally published only at accepted-point cadence and its
   endpoint is additionally Kalman-smoothed, while the puck is a separate raw
   native Mapbox authority. The missing historical timestamps prevent assigning
   the whole reported ten seconds between filtering, journal latency, and
   rendering.
3. Save/pending sync is independently blocked by fractional timestamps.

## GPS-loss duration semantics

Current semantics sum time only between consecutive accepted points in the
same segment. Explicit Pause and every GPS gap both remove duration. The stated
product rule instead defines Activity time from lifecycle state: `tracking`
accrues time even without geometry; explicit `paused` does not. Distance,
elevation, matching, and Memory remain segment/geometry-derived and must not
receive any unknown connector.

## Recenter authority

Real Recenter targets `useTrackingStore.lastCoordinate`, the last accepted
Activity coordinate. It does not target Mapbox UserLocation or the latest raw
callback. That is coherent for Activity truth, but becomes misleading when
acceptance recovery is stuck or delayed. Simulator Recenter separately targets
its screen-resolved accepted Simulator position.

## GPS status meaning

The green Hike/Run GPS affordance means the selected source was successfully
activated. It does not prove callback freshness or accepted Activity freshness.
The current label therefore does not accurately represent Activity tracking
health during a long silent/rejected period.

## Memory and matching across real gaps

- Segment IDs are the distance/elevation/matching authority. Completion matches
  each segment independently and never sends a cross-gap connector.
- Activity Memory commits one accepted coordinate at a time; it performs no
  path interpolation between consecutive Activity points. Completion and
  recovery only replay those individual accepted coordinates. Thus the current
  shared writer creates no synthetic Memory traversal across a real segment
  gap.
- Lifecycle duration changes must not alter those geometry contracts.

## Pre-edit disposition

- Safe to change: timestamp normalization at the client API boundary; the
  rejected-sample continuity clock; lifecycle-based timer state; freshness
  recomputation/status semantics; focused timing telemetry; tests for these
  proven contracts.
- Not justified: changing Core Location accuracy/intervals; rendering rejected
  raw points; subway-specific thresholds; matching across gaps; broad map/UI
  redesign.

## Post-edit corrective implementation

The historical first callback-level divergence remains **INCONCLUSIVE**. The
candidate changes only defects proven independently from the surviving O39
evidence and current executable code:

1. **Lifecycle timer authority.** `tracking` now accrues provider-clock time
   independently of GPS callbacks. Pause/Finish/safety interruption freezes
   the accumulated clock, Resume opens a new interval, and recovery reads the
   durable lifecycle anchor. Real Activities use wall time; Simulator
   Activities use the existing bounded virtual clock. Distance, elevation,
   matching, and Memory remain GPS/segment-derived.
2. **Accepted continuity authority.** Poor-accuracy, hiking-overspeed,
   stationary-suppressed, and indoor-drift-suppressed samples advance only the
   raw-fix dedupe timestamp. They no longer move the accepted-coordinate time
   anchor. A credible fix after long loss is therefore compared with the last
   accepted point over the actual loss interval and can open a new segment.
3. **Late background handoff.** The live queue now drains already-journaled
   background samples while tracking even if the foreground source has become
   active. Ownership/generation fences still reject stale work.
4. **Live trace authority.** Hike and Run render the canonical accepted array
   as the live line. A separately smoothed endpoint no longer adds extra
   spatial lag behind accepted evidence. Rejected raw fixes are not rendered.
5. **GPS health meaning.** The green affordance now requires active Tracking
   and a sufficiently fresh accepted Activity point. Source activation alone
   is not shown as healthy. The lifecycle timer supplies the independent UI
   ticks needed for the status to age into signal-lost during callback silence.
6. **Sync timestamp boundary.** Incremental and atomic Save payloads floor
   native fractional epoch milliseconds to the server's integer contract.
   Normalization runs again when an existing pending payload is replayed, so
   affected O39 local pending Activities can recover without a backend schema
   relaxation.
7. **Forensic telemetry.** Real source activation/error, foreground/wake and
   background callbacks, canonical accept/reject, journal latency, store
   publication latency, and React trace receipt are now retained in the
   bounded QA stream. Real events are not gated by Simulator sample sequence;
   high-volume map-idle events are no longer protected at their expense. Real
   coordinate fields remain stripped from upload.

Core Location accuracy, time interval, distance filter, background activity
type, and battery policy were deliberately unchanged because historical
native callback cadence is unavailable.

## Post-edit regression evidence

- Lifecycle clock advances with zero GPS points, freezes during explicit
  Pause, and resumes without counting paused wall time.
- A recent rejected fix cannot shorten the accepted continuity interval; a
  later credible displaced fix is accepted as a new segment.
- Two repeated long-loss/recovery cycles produce three segment IDs, zero
  connector distance, and only per-point Memory commits.
- The same repeated segmentation contract passes through the headless real
  background writer.
- Simulator explicit reacquisition, rollback-monotonic Memory, matching, time
  acceleration, provider isolation, and normal acceptance contracts remain
  green in the focused suite.
- Fractional timestamps are repaired for incremental points, matched/raw Save
  arrays, Memory timestamps, and replayed pending payloads.
- Focused validation: 214/214 Activity/Simulator/recovery/sync tests passed,
  followed by 127/127 final real-GPS contract tests after the last telemetry
  changes.
- Target-file TypeScript diagnostic filter: no errors. Repository-wide
  TypeScript remains red on unrelated existing preview/generated/test typing
  issues.
- Repository-wide Jest: 650 passed, 3 skipped, 40 failed. The failures are
  existing unrelated legacy export/config tests (geo, offline queue,
  auto-pause/corridor helpers, missing i18n and Playwright-in-Jest modules).
  All Activity tests affected by this change pass.
- Expo Web bundled successfully and rendered at 390 x 844. The unauthenticated
  smoke surface was stable; production diagnostic POSTs were blocked by the
  expected localhost CORS policy. Native Mapbox/Core Location behavior remains
  the purpose of the short device retest.

## Post-edit disposition

**READY FOR REAL-GPS NATIVE RETEST.** This is not a claim that the unavailable
historical Core Location callback stream has been reconstructed. It means the
proven timer, continuity-anchor, handoff, status, trace, and Save defects have
scoped fixes and deterministic coverage, while the next native run will retain
the missing callback-to-render evidence if any divergence remains.

Backend change: **NO**. Backend deploy: **NO**.

Client candidate marker: **O40**.
