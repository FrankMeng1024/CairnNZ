# Activity verification

Use the diff-driven router first:

```sh
cd app
npm run verify:changed
```

The maintainable impact map is `app/scripts/activity-verification-map.json`; the runner is `app/scripts/verify-activity.mjs`. Use `npm run verify:changed -- --explain` to inspect routing without running tests.

## Gates and cost

| Command | Cost | Purpose |
|---|---:|---|
| `npm run verify:changed` | FAST–HEAVY by diff | Select the smallest mapped gate plus scoped TypeScript validation. |
| `npm run verify:activity:gps` | MEDIUM | Continuity/candidate, background, gap, elevation, matching, real-GPS telemetry, Memory gap safety, and server payload/telemetry contracts. |
| `npm run verify:activity:core` | HEAVY | GPS plus journal, recovery, unfinished ownership, Memory, offline/sync, and shared Simulator-pipeline regression. |
| `npm run verify:full` | HEAVY | All client Jest and backend `node:test` files. Reserve for major architecture, nightly, or release work. |

Presentation-only Hike/Run changes route to focused screen contracts. GPS/filter/background/elevation/matching/telemetry changes route to GPS. Journal/recovery/Memory/sync/shared Activity state routes to Core. Runtime/package architecture routes to Full. Successful runs print only group counts; failures expand the underlying logs.

TypeScript currently has unrelated repository debt, so the router runs the compiler and fails on diagnostics in touched TypeScript files. It does not hide a new touched-file error behind the pre-existing global count.

## Test governance

- **PRODUCT CONTRACT** — explicit Activity semantics. If the product contract is unchanged, fix implementation. If it intentionally changes, update authority first and audit affected expectations with rationale.
- **INCIDENT REGRESSION** — privacy-safe deterministic reproduction of a real failure. Current fixtures include wrong-style lateral drift, legitimate turns, stationary noise, loss/reacquisition, background handoff, false elevation, endpoint fallback, real/virtual isolation, and critical telemetry churn.
- **CHARACTERIZATION / IMPLEMENTATION GUARD** — protects a current integration or structural invariant. It may change during a safe refactor and is not permanent product truth.

Some integration and Simulator tests intentionally inspect source strings because native ownership ordering, provider fencing, and durable-operation sequencing are difficult to exercise completely in Jest. Keep those only while they protect a named structural invariant. Prefer behavioral tests for outcomes; do not rewrite a working guard merely for style.

Named real-location incident fixtures currently include
`STATIONARY_GPS_JITTER_SPAGHETTI`, `IOS_NOOP_INTERVAL_PROVIDER_RESTART`,
`BACKGROUND_PERMISSION_EDUCATION_SUPPRESSION`,
`TRANSIENT_INACTIVE_FALSE_GAP`, `FOREGROUND_TAKEOVER_OWNERSHIP`,
`NORMAL_1M_COHERENT_MOVEMENT`, `FALSE_REPORTED_SPEED_BACKTRACK`,
`U_TURN_IS_NORMAL`, `REPEATED_SEGMENT_THREE_PASSES`,
`DELIBERATE_Z_CORRIDOR`, `SLOW_CUMULATIVE_PROGRESS`, and
`STOP_START_RECOVERY`. The matching group also protects repeated out-and-back
topology, while the presentation group protects gap isolation and the bounded
confirmed-head tail.

Never change expected output just to make a suite green. First classify a failure as unchanged product contract, intentional contract change, or incorrect/implementation-specific test. Record why when updating the latter two.

## Flakes and native evidence

Never rerun until green. Classify random failure as product failure, test race, or environment failure; replace sleeps with observable operation fences/events/promises.

Deterministic tests do not certify iOS GPS delivery, lock-screen execution, sensor drift, or Mapbox rendering. The permanent loop is: implementation → router → OTA candidate → short native walk → telemetry review → privacy-safe incident fixture for every confirmed bug.
