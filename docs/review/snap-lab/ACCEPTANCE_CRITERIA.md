# Snap Lab acceptance criteria

Status: frozen before candidate-output evaluation

Baseline: `09e40318448d6d49162fc6a17b6d7a9b7b4d9d40`

Authoritative input archive SHA-256:
`b5fd4f09c293b81d05805a8a7f7faa260fbd82a585afebd72666f045bbb98878`

Authoritative matrix SHA-256:
`d86d84da93e449d1afca04ba6a940a005cc971fe3081038c75212ffd009b0f72`

Open Good audit SHA-256:
`d5b46f3ed86b62e37b7d99b2f2279b744ae1a218b10b521beafda5da15b570e4`

These criteria govern the reusable QA realm, the supplied case matrix, the
captured Good benchmark, and adjacent counterexamples. A test oracle may score
production output, but latent truth, expected corridor identity, expected
section boundaries, and expected outcomes must never enter the production
tracker, request planner, matcher, Final compositor, or Activity stores.

## Evidence labels

- `CAPTURED_REAL_RESPONSE`: exact credential-free response reused only with
  the exact request identity that produced it.
- `DETERMINISTIC_TRANSPORT`: HTTP-boundary test response generated from the
  case's available-map graph; it is never called a real Mapbox response.
- `LOCAL_ONLY`: no network evidence was selected.
- `NOT_EVALUATED_BUDGET`: no request covered this source arclength.
- `NO_NETWORK_EVIDENCE`: offline/no token/transport prevented evaluation.
- `AMBIGUOUS_EVIDENCE`: evaluated evidence cannot identify one corridor.
- `UNSAFE_CANDIDATE`: a returned candidate failed a named safety gate.

Map Matching confidence, returned tracepoint correspondence and alternatives,
local shape agreement, Directions route rank, and route ambiguity are distinct
fields. Directions does not return Map Matching confidence or tracepoints and
must not synthesize either. Current provider semantics are documented by the
[Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/) and
[Directions API](https://docs.mapbox.com/api/navigation/directions/).

## Hard user and data invariants

All are zero-tolerance for every completed journey:

1. Wrong-corridor occupation is 0 m for accurate internal/unmapped-path,
   parallel-road, barrier, wall, building and disconnected-path negatives.
2. Invented physical-gap crossings are 0. No request, accepted island, seam,
   persisted artifact or reopened Detail edge may span Physical Segments.
3. Ordered protected corners, U-turns, reversals, repeated corridors, loops,
   figure-eights and switchbacks retain their required order and count. No
   accepted island may remove one or invent more than the existing topology
   gate permits.
4. Canonical point identity, timestamps, segment identity, Activity metrics,
   and QA Memory evidence are invariant under Final refinement.
5. Every accepted pre-fence WAL witness belongs to exactly one saved QA
   Activity. A failed/uncertain terminal read yields recoverable failure, never
   truncated success.
6. The QA realm produces zero production Activity, Memory, Route, Cairn,
   achievement, public/friend, telemetry or sync uploads. It cannot appear in
   ordinary owner stores and cannot be migrated to them.
7. Completion, Detail, cold reopen, and Save-as-Route use the same selected
   revision until the existing single optional upgrade. A route snapshot made
   before an upgrade remains byte-identical afterward.
8. At least one unambiguous mapped positive per Hike and Run must select useful
   road-aware refinement. An all-local implementation fails.

## Existing geometry safety budgets

These reuse reviewed production budgets rather than limits learned from a
candidate run:

- Truth-envelope p95: `min(15 m, max(8 m, accuracyP95 * 1.25))`.
- Maximum raw deviation: `min(30 m, max(18 m, envelope * 1.5))`.
- Trusted endpoint anchoring: each endpoint no farther than
  `min(20 m, max(8 m, accuracyP95 * 1.25))`.
- Candidate/source length ratio: `[0.67, 1.50]` at the hard gate. A case may
  impose a narrower independent-oracle range where its structure requires it.
- Seam heading delta: at most `65°` relative to the same-side canonical edge.
- Dense-evidence seam edge: at most `22 m`; sparse evidence may use at most
  `min(60 m, 1.5 * local canonical edge)`.
- Final maximum edge: no more than `max(30 m, 4 * maximum canonical edge)`.
- Final whole-route length ratio: `[0.67, 1.50]`.
- No additional duplicate edge or local duplicate loop at an authority switch.

Passing these numerical gates is necessary but not sufficient. Corridor
identity, tracepoint provenance, barriers, competing roads, protected
structures, and final assembled seams remain independent rejection authority.

## Product-quality scoring

Geometry comparisons use equal-arclength sampling at 2 m density for every
representation and identical map bounds. Truth-relative metrics are calculated
only for synthetic cases with latent truth. Good has no surveyed truth and is
reported as evidence-relative, never physically certified.

For mapped positives:

- selected lateral p95 must not be worse than Local Final by more than 0.5 m;
- selected lateral mean or heading-change RMS must improve by at least 10%
  when the case contains deliberately visible correctable wobble;
- correct-corridor occupation must be at least 95% of eligible arclength;
- no short in/out detour under 20 m, new hook, lateral teleport, or repeated
  edge may appear at a seam.

For local/ambiguous negatives:

- selected network coverage in the forbidden/ambiguous interval is 0 m;
- Local Final must remain inside the case's independent uncertainty/corridor
  envelope and preserve every protected structure;
- an absent provider response or exhausted request budget is reported as
  unevaluated, never as a safety rejection.

Coverage is measured over non-overlapping original-source arclength:
`MATCHED`, `ROAD_OFFSET_REFINED`, `LOCAL_CLEANED`, `LOCAL_AMBIGUOUS`,
`NOT_EVALUATED_BUDGET`, and `GAP`. Overlaps cannot count twice.

## Sectioning and request fairness

- A Snap Section contains at least 4 submitted observations and at least 15 m
  of source movement unless it owns a structural endpoint/turn that must stay
  local. One- or two-point passing slivers cannot be promoted.
- Boundaries require a real support discontinuity or a persistent material
  change in uncertainty, ambiguity/corridor attribution, or movement regime.
  A single threshold-failing sample is not by itself a sectioning oracle.
- Sectioning is deterministic for identical source evidence and response
  metadata. Reversing an otherwise symmetric route or changing only sample
  density must not starve the middle/late route solely due to window order.
- Matching supports up to the provider's documented 100 input coordinates;
  app window size, URL safety, overlap, concurrency, and persistent budget are
  separately reported.
- Existing Activity ceilings remain authoritative: final Matching minimum
  allowance 4, duration-scaled ceiling, hard Matching ceiling 60, Directions
  ceiling 2, and concurrency 2. Tests may use fewer; no repair raises them.

## Lifecycle and timing

- The three clocks are stored separately: observation time, callback delivery
  time, and program/commit/publication time.
- On clear controlled motion after loss/stop, the first qualifying evidence is
  accepted within the established bounded observation/batch contract. The
  matrix reports simulated seconds and delivery batches separately.
- WAL, canonical publication, Live publication, QA Memory projection, local
  Final selection, Activity persistence, Detail load, and cold reload each
  retain their own stage timestamps.
- Accelerated tests use one coherent virtual scheduler. Selected loss,
  delayed-batch, stop/restart, and Finish slices also run at 1x.
- Slow-storage tests inject delay below real storage readers/writers. No
  pending diagnostic write may block accepted evidence, and Finish may not
  report saved before mandatory durability is true.

## Matrix and run verdicts

The supplied `contracts/CASE_MATRIX.json` is the authority for family IDs,
fixed profiles, seeds, duration and case-specific expected properties. Its
three fixed profile seeds are `1709`, `23917`, and `405731`. The deterministic
fixture generator freezes latent truth, available map, sensor stream, lifecycle
events and private oracle to a per-run SHA-256 before candidate scoring. A
fixture hash may not change to cure a candidate failure; a generator defect
requires an explicit new fixture set and invalidates all prior matrix results.

Scenario-specific blockers are fixed as follows:

- SL01/SL02 require useful supported road refinement and no wrong-side pull;
  SL02 must improve straight-region lateral mean or heading RMS by at least
  10% over Local Final without inventing a turn.
- SL03 resumes within three coherent usable observations and two delivered
  batches, adds no stationary travel over the 8 m uncertainty budget, and
  projects QA Memory again before Finish.
- SL04/SL19/SL24 retain at least two Physical Segments at the true blackout;
  selected geometry and QA Memory have zero bridging edges across that gap.
- SL05/SL18 reject the prescribed teleport/spike and stationary cloud while
  accepting sustained later motion within the same three-observation/two-batch
  recovery bound.
- SL06 preserves observation ordering while recording delayed delivery; a
  delayed batch is not converted into a Physical Segment gap.
- SL07 may refine both supported city and mapped trail. SL08 must keep its
  unmapped middle local while independently considering the late mapped road.
- SL09/SL11 must not select the competing arterial over the supported internal
  path. SL10/SL12 select zero network metres in the forbidden mapped arterial
  or perimeter detour. SL13 cannot treat Directions shape score as Map Matching
  confidence and keeps equal-corridor ambiguity local.
- SL14–SL17 preserve ordered corner, U-turn/repeated-corridor, loop/
  figure-eight, and switchback structure respectively; spatially repeated
  locations never erase chronological traversal.
- SL20 saves Local Final offline, preserves its pre-upgrade Route snapshot,
  performs at most one validated online upgrade, and remains stable after cold
  reopen.
- SL21 preserves local save across each structured transport failure and a
  slow diagnostic writer; diagnostic latency never joins mandatory WAL
  durability.
- SL22 first fails recoverably on the predetermined lower WAL read fault with
  no truncated success, then saves the exact frontier once on retry.
- SL23 gives useful request opportunity to early, middle and late supported
  regions for both dense and sparse inputs without raising the governor.
- SL24 retains later opportunity after a bad middle region, all physical
  boundaries, and the two-hour logical duration without unbounded work.

A journey passes only if its recording, WAL, Live, local Final, transport/gate
decisions, persisted QA Activity, Detail, cold reopen, QA Route snapshot where
required, stage ledger, metrics and declared screenshots all complete. Missing
platform capability is `NOT_RUN`, never PASS. A deterministic failure is fixed
and the affected adjacency controls plus the complete final matrix are rerun.

## Platform claims

Expo Web actual-app runs are labelled `EXPO_WEB_ACTUAL_APP`. They exercise the
real React application, web storage adapters, RN-web orchestration and actual
screens; they do not certify native Mapbox rendering, GNSS, TaskManager wake,
lock-screen suspension, background OS scheduling, power/thermal behavior, or
an installed O66 binary. Logical AppState injection is not native background
evidence.

## Host responsiveness budgets

Virtual Activity duration is reported separately from real host timing. On the
same controlled browser host, ordinary fixture event processing should keep
maximum uninterrupted JS work below 100 ms and queued user-action latency
below 250 ms. SL23/SL24 may use bounded cooperative slices up to 250 ms and
500 ms queued-action latency. Local Finish should present a durable save within
5 s when mandatory storage is healthy; optional network work retains the
existing 3–5 s user-flow budget. A deliberately faulted mandatory WAL read must
fail recoverably rather than meet the healthy-storage time budget. Diagnostic
storage is never allowed to extend acceptance/WAL publication latency.
