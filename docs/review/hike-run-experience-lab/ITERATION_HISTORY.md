# Hike / Run Experience Lab Iteration History

This ledger records meaningful rejected attempts as diagnosis evidence. A failed
automation attempt is not counted as product acceptance, and no later green run
erases the earlier artifact.

## Baseline campaign bring-up

- `baseline-attempt-01`: rejected after the UI driver timed out before a complete
  saved Activity. It exposed insufficient phase-level timeout reporting.
- `baseline-attempt-02`: rejected because browser wall time, rather than the
  frozen logical clock, affected the simulator run.
- `baseline-attempt-03` and later bring-up attempts: rejected while tightening
  accessible UI locators, completion detection and exported-artifact checks.
- `baseline-actual-app`, `baseline-actual-app-batch02`, and
  `baseline-actual-app-batch03`: accepted baseline evidence only after every case
  completed Start, replay, Finish, Activity Detail, export and cold reopen.

## Web Mapbox lifecycle

- Early `candidate-renderer-replay-*` runs reproduced the recurring Mapbox GL JS
  v2 `undefined.send` teardown race during consecutive maps and theme changes.
- Deferring style cleanup and bounding the stale global map reference reduced the
  surface but did not independently close it.
- The accepted GL JS v2 boundary prewarms the shared worker pool and disables the
  optional asynchronous worker cache-trim cadence through an optional-chained,
  Web-only compatibility call. The native RNMapbox adapter is unchanged.
- A `reuseMaps` experiment removed the runtime error but was rejected after the
  strict Plant-return gate exposed a detached canvas with route overlays and no
  real basemap tiles.
- `candidate-renderer-final-no-reuse` is the accepted renderer stress: three
  Activities, cold reopen, day/sunset/night changes, zero runtime errors and zero
  screenshot recoveries.

## Activity Plant path

- `candidate-run-plant-flow-01` through `-04`: rejected because an old Metro CI
  lazy module or responder path meant the visible action did not exercise the new
  full Plant bundle reliably.
- `candidate-run-plant-flow-05`: rejected because the old loaded bundle lacked
  the new immutable accuracy/timestamp/provenance fields.
- `candidate-run-plant-flow-06`: established the fields after a full Metro
  `--clear` restart, but its return screenshot was captured too early to prove a
  real basemap.
- `candidate-run-plant-flow-07` through `-10`: retained failures that exposed the
  focus/remount and tile visibility problem. A forced style reload made the
  behavior worse and was reverted.
- `candidate-run-plant-flow-11` and `-12`: diagnostic runs separated a true blank
  basemap from a strict-gate layer-prefix mismatch.
- `candidate-run-plant-flow-13-final`: accepted. It uses the visible Run Cairn
  action, creates exactly one QA-local Cairn with the active Activity identity and
  placement facts, returns to the same tracking Run with a visible real Mapbox
  basemap, finishes, and cold reopens without runtime errors.

## Geometry tuning decision

No GPS filter, smoothing, matching or distance parameter experiment was promoted.
Frozen training geometry was already good and all four holdouts generalized. The
difficult M05, X04 and U06 cases were retained as honest gaps; filling them would
require inventing motion during unsupported outages. Candidate and baseline
geometry therefore remain exactly equal case by case.
