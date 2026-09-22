# Revision-03 A4 exact-fingerprint verifier audit

Audited product fingerprint: `044045c3ad1ecde3c8eb9c55b76a72c14dfc46a39d8c14bf659b51e498e29929` (633 files). It was independently recomputed before the changed gate and again after the bounded test-only correction. The correction is under `app/__tests__`, outside the fingerprint's declared `app/src`, `app/scripts`, app package, backend source/script/package scope, so the product fingerprint remains exact.

## Disposition

- The retained loaded-Web result is internally consistent and all 24 booleans are supported by the retained stage/timing/request operands. Runtime errors are zero.
- The required `cd app && npm run verify:changed` was restarted from the beginning and completed, but **FAILED**: 109/120 suites and 1,124/1,154 tests passed; 11 suites and 27 tests failed. Complete output and an exit-1 receipt are `verify-changed-resumed.log` and `verify-changed-resumed.json`.
- One relevant failure was a stale O41 test guard. It was corrected without changing product behavior, then the old/new authority guards passed 11/11.
- The other relevant failure was one 180 ms synchronous geometry slice against the frozen `<150 ms` ceiling. Two CPU-profiled, test-name-only diagnostics passed the same frozen truth/retention/budget assertions. The second deliberately constrained the V8 heap to 384 MiB: 871 GC events had a maximum 32.9 ms pause and none reached 150 ms, while its longest 106.77 ms profiler interval was attributed to the atomic Turf-intersection stack. This rules out a 150 ms GC pause in that sensitivity run but does not reconstruct the original failure. The original result remains **unresolved/non-reproduced**, not erased and not promoted to PASS.
- Nine remaining failures are pre-existing Full-gate collection/obsolete-test debt outside the authorized A4 correction. They were not edited.
- Therefore the loaded journey remains `PASS 24/24`, while the required changed gate remains `FAIL`; this audit does not advance A4 to software PASS.

## Loaded assertion audit

| # | Assertion | Retained executable operands | Audit |
|---:|---|---|---|
| 1 | `ordinaryStartReachedTracking` | Normal `Start hike` was clicked; `initial-accepted-motion` is `tracking`, provider `simulator`, session `ec11c863-8c67-48c3-a308-9746d026b27b`. | PASS |
| 2 | `liveMemoryBeforeFinish` | Loaded Memory before Finish contains 9 isolated synthetic footprints. | PASS |
| 3 | `stationaryDidNotWidenCoverage` | Initial and post-90-s stationary snapshots both contain 9 footprints; raw fixes rise 91→181 while accepted fixes remain 32. | PASS |
| 4 | `resumedMotionAddedCoverage` | The retained loaded `resumed-motion` snapshot contains 20 footprints versus 9 stationary, with Fog loaded. The runner boolean compares the later pre-Finish count (21) to stationary; that predicate is less specific, but the retained resumed-stage operand independently proves the executed claim. | PASS, instrumentation note |
| 5 | `finishDidNotCreateMissingCoverage` | Immediately before Finish and loaded Memory after Finish both contain 21 footprints. | PASS |
| 6 | `reloadRestoredCoverage` | After Finish and after process-style page reload both contain 21 footprints. | PASS |
| 7 | `finishRetainedExactCoverage` | Pre-Finish and after-Finish content fingerprint is exactly `21\|50fcee86`. | PASS |
| 8 | `reloadRestoredExactCoverage` | After-Finish and after-reload content fingerprint is exactly `21\|50fcee86`. | PASS |
| 9 | `reloadRestoredActivityJournal` | The run begins with an empty journal; reload contains the one started client Activity ID `ec11c863-8c67-48c3-a308-9746d026b27b`. | PASS |
| 10 | `independentLifecycleObservations` | Monotonic stage wall times are pre-Finish `1789825850499`, after-Finish `1789825901291`, reload `1789825948108`. | PASS |
| 11 | `independentReloadObject` | Runtime changes `0b57…`→`a4e1…`; synthetic object identity changes `…:8`→`…:1`. | PASS |
| 12 | `syntheticNeverEnteredPersonal` | Every retained stage has personal coverage 0 and presence witnesses 0; `/api/sessions/9101/save` contains `memory_points: []`. | PASS |
| 13 | `rawInputExisted` | Pre-Finish has 295 raw versus 86 accepted fixes. | PASS |
| 14 | `actualFogLoadedAtMemoryStages` | All five Memory-route snapshots report loaded map, `memory-fog` layer, and `memory-fog-src` source. | PASS |
| 15 | `normalFinishCommitted` | Exactly one `/api/sessions/start` and one `/api/sessions/9101/save` use the same client Activity ID; normal Finish navigates to Activity Detail, then tracking reaches idle. The runner boolean is supplemented by `requests.json` identity evidence. | PASS |
| 16 | `sameObservationPipelineCorrelated` | Correlation key `1789782812203\|293` binds identical raw/accepted/Memory coordinates, a committed non-deduplicated Memory mutation, coverage 21, and Fog revision `memory-fog-geodesic-v2`. | PASS |
| 17 | `wallClockRawInputReachedAccepted` | Same observation reaches accepted movement in 2.0 ms versus frozen 120 ms. | PASS |
| 18 | `acceptedEvidenceReachedLiveMemory` | Same observation reaches isolated Memory in 1.0 ms versus frozen 40 ms. | PASS |
| 19 | `liveMemoryReachedFogSource` | Coverage-21 Memory mutation reaches matching Fog source in 211.5 ms versus frozen 350 ms. | PASS |
| 20 | `webPaintOpportunityWithinBudget` | Matching `setData` schedules the next Web rAF in 14.5 ms versus frozen 50 ms. This is explicitly not native GPU proof. | PASS |
| 21 | `pauseControlAcknowledgedWithinBudget` | DOM click→paused store transition: 0.8 ms versus frozen 50 ms. | PASS |
| 22 | `resumeControlAcknowledgedWithinBudget` | DOM click→resuming/tracking store transition: 1.7 ms versus frozen 50 ms. | PASS |
| 23 | `pauseTransitionConvergedWithinBudget` | DOM click→paused and transition-idle: 18.5 ms versus frozen 500 ms. | PASS |
| 24 | `resumeTransitionConvergedWithinBudget` | DOM click→tracking: 38.7 ms versus frozen 500 ms. | PASS |

The current Full gate also passed the exact-current Revision-03 pipeline, live presentation, continuity, simulator, durability, authority, Fog continuity, Activity recovery, Activity registry, tracking-store, and session-store suites. In particular, `revision03RawGpsPipeline.test.ts` protects the timing correlator against a deduplicated accepted point impersonating a later Memory mutation, missing paint, and paint-before-source ordering.

## Changed-gate failure classification

| Failed suite | Classification and disposition |
|---|---|
| `__tests__/useAppStore.test.ts` | Stale implementation guard contradicted the O41 product authority: `App.tsx` owns account-scoped Memory initialization for every authenticated login path, while cold-boot `useAppStore.hydrate` must not create a competing owner. Updated one test only; focused old/new authority tests pass 11/11. |
| `src/features/memory/__tests__/revision03MemoryScale.test.ts` | Actual Full-gate failure: 180 ms versus frozen `<150 ms` for one 10,000-location slice; total build 95,120.7 ms remained within 150 s and prior truth checks passed. First profiled diagnostic: geometry 72,445.6 ms, exit 0, no profiler gap ≥150 ms, largest Turf-attributed gap 55.161 ms. Constrained-heap diagnostic: geometry 81,245.8 ms, exit 0, no GC pause or profiler gap ≥150 ms, 32.9 ms maximum GC pause, and 106.77 ms longest profiler interval on Turf intersect. Retain as unresolved/non-reproduced; no threshold or Fog change. |
| `src/services/__tests__/editDiagSender.test.ts` | Untouched obsolete test imports non-exported internal `MAX_QUEUE_SIZE`, so its loop executes zero times and compares queue length 0 to `undefined`. Outside A4. |
| `src/utils/__tests__/geo-kalman.test.ts` | Untouched obsolete test calls helpers that `geo.ts` explicitly records as removed with zero external callers. Outside A4. |
| `src/utils/__tests__/geo-dynamic-sampling.test.ts` | Same removed-helper debt. Outside A4. |
| `src/utils/__tests__/geo-route.test.ts` | Same removed-helper debt. Outside A4. |
| `src/services/routing/corridor/__tests__/CorridorQuery.test.ts` | Untouched obsolete test imports a now-private helper and asserts the former empty-index fail-open behavior, while source documents fail-closed. Outside A4. |
| `__tests__/i18n.test.ts` | Untouched test imports absent `src/config/i18n`. Outside A4. |
| three `tests/**/*.spec.ts` Playwright suites | Pre-existing broad Jest `*.spec.ts` match collects Playwright suites, while `@playwright/test` is not installed. Router/package collection debt outside A4. |

The pre-existing Jest warning for unknown `setupFilesAfterFramework` was also retained and not edited.

## Bounded correction and receipts

- Changed file: `app/__tests__/useAppStore.test.ts`, 7 insertions / 9 deletions. The former v405 expectation that cold boot directly calls `hydrateMemoryForUser` then `attachMemorySync` now asserts the O41 contract: cold boot restores authenticated state but does not start either competing owner.
- Source authority: `app/App.tsx` O41 authenticated-user effect performs `await hydrateMemoryForUser(userId)`, identity revalidation, `attachMemorySync(userId)`, and asynchronous server reconcile. `app/src/features/memory/__tests__/memoryAuthorityInitialization.test.ts` separately guards that authority and the absence of cold-boot ownership.
- Focused command: `cd app && npx jest __tests__/useAppStore.test.ts src/features/memory/__tests__/memoryAuthorityInitialization.test.ts --runInBand --silent`.
- Focused result: exit 0; 2/2 suites and 11/11 tests passed in 3.517 s. Complete log: `verify-changed-diagnostics/o41-authority-focused.log`, SHA-256 `9327365d141ee2a70101b0f6a62bb5f557f6a65d86cd143505c2ec5a71e521de`.
- Diagnostic profile receipts: `verify-changed-diagnostics/profile-summary.json` and `verify-changed-diagnostics/gc-sensitivity/summary.json`.

## Evidence boundary and cleanup

This is deterministic synthetic Raw GPS and loaded Expo Web evidence, not native iOS GPS delivery, lock-screen/background execution, battery, native Mapbox/GPU paint, physical-route fidelity, or NZ field proof. No T01/T04 rerun, long loaded-screen rerun, deployment, migration, backend, database mutation, or OTA publication occurred. All owned Jest/profiler sessions are terminal and no owned test/browser/service process remains.
