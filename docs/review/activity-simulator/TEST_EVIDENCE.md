# Activity Simulator test evidence

Date: 2026-09-07
Legend: **PASS** = locally automated; **READY** = implementation is ready for the first internal OTA scenario; **NATIVE REQUIRED** = cannot be closed by Expo Web/Simulator.

## Required scenario matrix

| # | Required scenario | Coverage kind | Status / evidence |
|---:|---|---|---|
| 1 | Simulator selected before Hike Start | AUTOMATED + MANUAL SIMULATOR | PASS static: both `HikingScreen` and provider selection require authorized source; READY A |
| 2 | Simulator selected before Run Start | AUTOMATED + MANUAL SIMULATOR | PASS static: same panel/provider in `RunningScreen`; READY B |
| 3 | Manual worldwide coordinate validation | AUTOMATED | PASS: `geodesy.test.ts`, `store.test.ts` |
| 4 | High-latitude geodesic sanity | AUTOMATED | PASS: 1 km at 78.2232° remains valid and measures 1 km |
| 5 | Longitude wrap sanity | AUTOMATED | PASS: east across 179.999° wraps into canonical negative longitude |
| 6 | Joystick produces canonical samples | AUTOMATED | PASS: `engine.test.ts` verifies 1 Hz engine cadence, bounded accelerated batches, metre displacement, ownership/source metadata |
| 7 | Auto-waypoint produces canonical samples | AUTOMATED | PASS: engine reaches destination, emits evidence, clears queue |
| 8 | Activity distance derived from samples | AUTOMATED | PASS: canonical `useTrackingStore` Simulator test; no engine metric mutation |
| 9 | Run pace derived from samples | AUTOMATED + MANUAL SIMULATOR | PASS: canonical store derives 10× Run at 10 km/h as ~6 min/km, never 100 km/h; READY B for Run UI |
| 10 | Hike elevation derived from samples | AUTOMATED + MANUAL SIMULATOR | PASS: altitude evidence derives gain in canonical stats/store; READY A |
| 11 | Stationary behavior | AUTOMATED | PASS: 10× identical-position evidence advances canonical duration through 30 s zero-motion heartbeats and adds no distance/elevation |
| 12 | Pause ignores Activity movement | AUTOMATED | PASS: engine detaches sink; store rejects paused sample; virtual position may move |
| 13 | Resume continues correctly | AUTOMATED + MANUAL SIMULATOR | PASS engine lease rotation/static recovery contract; READY A/G |
| 14 | Reverse/backtrack is real return movement | AUTOMATED | PASS: outbound+return totals travelled distance while ending near origin |
| 15 | Good accuracy acceptance | AUTOMATED | PASS: canonical store accepts Simulator `accuracy=5` and journals `src=sim` |
| 16 | Poor accuracy rejection | AUTOMATED | PASS: canonical store rejects 60 m as `poor-accuracy`; raw audit only |
| 17 | Short GPS loss | AUTOMATED + MANUAL SIMULATOR | PASS central `shouldStartNewSegment` credible short-delay case; READY D for provider flow |
| 18 | Long/untrusted GPS loss | AUTOMATED + MANUAL SIMULATOR | PASS central authority and canonical Simulator long-gap tests; READY D |
| 19 | Forced interruption creates segment | AUTOMATED + MANUAL SIMULATOR | PASS static action has `process-recovery`, no direct point insertion; READY E |
| 20 | Gap zero distance | AUTOMATED | PASS `activityContracts.test.ts` and canonical Simulator long-gap store test |
| 21 | Gap zero elevation | AUTOMATED | PASS same segmented-stat test |
| 22 | Gap zero pace contribution | AUTOMATED | PASS cross-segment time/distance excluded by `calculateActivityStats` |
| 23 | Gap zero Memory | AUTOMATED + MANUAL SIMULATOR | PASS by architecture: no lost samples and Memory only after accepted journal commit; READY E/H |
| 24 | Full Plant uses Simulator location | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS static selected-provider → normal `decideFromReadings`; READY A |
| 25 | 50 m accepted Plant adjustment | AUTOMATED CONTRACT + MANUAL SIMULATOR | Existing `PinNudgeConfig.maxNudgeMeters=50` unchanged; READY A, interaction manual |
| 26 | Quick Cairn uses current accepted location | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS static fresh accepted-fix/LOST gate; READY B |
| 27 | Cairn origin Activity association | AUTOMATED CONTRACT | PASS `originActivityClientId` precedes offline commit and is logged after success |
| 28 | Cairn offline commit | AUTOMATED + MANUAL SIMULATOR | PASS `offlineCommittedEntity.test.ts`/marker ownership contracts; READY F |
| 29 | Activity Memory incremental | AUTOMATED | PASS canonical Simulator sample invokes shared `recordMemoryEvidence(source=activity)` after journal |
| 30 | Activity Discard preserves Memory | AUTOMATED | PASS `activityRecoveryMemory.test.ts`: reconcile evidence before discard/journal delete |
| 31 | Passive Memory OFF | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS Settings default/gate; READY H |
| 32 | Passive Memory ON | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS shared passive evidence authority and 25 m gate; READY H |
| 33 | Offline Simulator Hike | AUTOMATED CONTRACT + MANUAL SIMULATOR | Normal journal/pending/offline entities pass; READY F, end-to-end manual |
| 34 | Offline Simulator Run | AUTOMATED CONTRACT + MANUAL SIMULATOR | Same mode-neutral store/writer/pending path; READY F, end-to-end manual |
| 35 | Offline Finish | AUTOMATED + MANUAL SIMULATOR | PASS verified pending snapshot and completed intent suites; READY F |
| 36 | Pending Activity Detail | AUTOMATED + MANUAL SIMULATOR | PASS local-authoritative retention/static Detail snapshot; READY F/I |
| 37 | Process/recovery Simulator state restore | AUTOMATED + MANUAL SIMULATOR + REAL DEVICE | PASS user-scoped clock/store/journal source tests and non-rewinding recovery alignment; READY G; actual kill is native |
| 38 | One-unfinished guard | AUTOMATED + MANUAL SIMULATOR | PASS Activity registry/start-lock suites; READY J |
| 39 | Recovery Resume | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS exact-ID source restoration/process segment contract; READY G |
| 40 | Recovery Save | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS shared `saveEligibility`/normal stop path; READY G |
| 41 | Recovery Discard | AUTOMATED | PASS `activityRecoveryMemory.test.ts`, registry tombstone, cleanup order |
| 42 | Save eligibility parity | AUTOMATED | PASS `<2 points`, `<20 m`, eligible conditions; old Simulator bypass absent |
| 43 | Stale Real callback cannot enter Simulator | AUTOMATED | PASS canonical store returns `provider-source-mismatch` |
| 44 | Stale Simulator callback cannot enter Real | AUTOMATED | PASS canonical store returns `provider-source-mismatch` |
| 45 | Account A/B isolation | AUTOMATED + MANUAL SIMULATOR | PASS Simulator store, Activity registry, Memory ownership, sync ownership tests; READY J |
| 46 | Simulator logs bounded | AUTOMATED | PASS 5,000 event limit; code also caps 2 MiB and five sessions |
| 47 | Simulator logs contain no secrets | AUTOMATED | PASS recursive forbidden-key sanitizer test |
| 48 | Public feature gate blocks Simulator | AUTOMATED | PASS production profile is explicit `false`; no `__DEV__ ||` bypass |
| 49 | Activity Detail uses same product flow | AUTOMATED + MANUAL SIMULATOR | PASS segmented/dashed snapshot and cleanup contracts; READY A/B/E/I |
| 50 | Sync/cleanup normal for simulated Activity | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS historical payload validation, unchanged `saveHikeAtomic` replay, ACK-before-cleanup, source only for local logs; READY I |

## Accelerated-time closure matrix

| # | Required closure case | Coverage kind | Status / evidence |
|---:|---|---|---|
| 1 | 1× unchanged | AUTOMATED | PASS: wall start/advance/Finish remain wall-clock in `simulatorTime.test.ts`; 1 Hz engine behavior retained |
| 2 | 2× Hike | AUTOMATED + MANUAL SIMULATOR | PASS parameterized engine/canonical-stat derivation; READY accelerated guide |
| 3 | 5× Hike | AUTOMATED + MANUAL SIMULATOR | PASS parameterized engine/canonical-stat derivation; READY accelerated guide |
| 4 | 10× Hike | AUTOMATED + MANUAL SIMULATOR | PASS: 5 km/h produces ~833 m, 600 s, ~12 min/km from canonical points |
| 5 | 30× bounded Hike | AUTOMATED + MANUAL SIMULATOR | PASS: three ≤10 s samples per normal tick and hard 12-hour/non-future clock limit |
| 6 | 10× Run at realistic pace | AUTOMATED + MANUAL SIMULATOR | PASS: 10 km/h produces ~1,667 m, 600 s, ~6 min/km |
| 7 | Pace uses configured speed, not multiplied speed | AUTOMATED | PASS: emitted speed remains 5/3.6 or 10/3.6 m/s; Activity derives pace from evidence |
| 8 | Distance/time relationship | AUTOMATED | PASS Hike and Run canonical store assertions; no Simulator metric mutation |
| 9 | Stationary accelerated duration | AUTOMATED + MANUAL SIMULATOR | PASS: zero displacement/speed plus canonical heartbeat reaches 600 s at 10× |
| 10 | Pause under acceleration | AUTOMATED + MANUAL SIMULATOR | PASS: detached sink/inactive acceptance; segmented stats exclude paused interval |
| 11 | Resume under acceleration | AUTOMATED + MANUAL SIMULATOR | PASS: provider-timeline owner fence, rotated generation, new normal segment |
| 12 | Short GPS loss | AUTOMATED + MANUAL SIMULATOR | PASS: LOST emits no samples; short virtual interval remains central continuity decision |
| 13 | Long GPS loss | AUTOMATED + MANUAL SIMULATOR | PASS: hidden virtual clock/movement plus canonical long-gap authority creates `gps-reacquired` where warranted |
| 14 | Forced interruption | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS: `process-recovery` boundary is independent of scale and inserts no point/metric directly |
| 15 | Memory ordering | AUTOMATED | PASS: accepted evidence timestamps are unique/increasing and central Memory calls preserve order |
| 16 | Full Plant | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS: current historical virtual fix enters normal GPS fusion; LOST fails closed; READY A |
| 17 | Quick Cairn | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS: freshness uses provider timeline, provenance/local commit unchanged; READY B |
| 18 | Offline Save | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS normal journal/pending snapshot path accepts historical epochs; READY F |
| 19 | Pending Activity Detail | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS summary/points preserve virtual epochs and normal projection; READY I |
| 20 | Recovery | AUTOMATED + MANUAL SIMULATOR + REAL DEVICE | PASS clock alignment cannot rewind; source/scale persist per owner; actual kill remains native |
| 21 | Backend sync/reconciliation | AUTOMATED CONTRACT + MANUAL SIMULATOR | PASS Start/append/Finish/Memory schema payload plus byte-identical pending replay/ACK ordering; QA account round-trip is first OTA gate |
| 22 | No future-time backend rejection | AUTOMATED | PASS every scale remains historical; normal backend Joi contracts accept representative 10× payload |
| 23 | No acceleration-only order rejection | AUTOMATED | PASS bounded engine timestamps strictly increase; canonical store receives no `non-monotonic-timestamp` rejection |
| 24 | No clock leak into later Real Activity | AUTOMATED | PASS `activityTimestampForSource('real')` ignores persisted Simulator clock; source fixed per Activity |

## Automated files

New/extended Simulator proof:

- `app/src/features/activitySimulator/__tests__/geodesy.test.ts`
- `app/src/features/activitySimulator/__tests__/engine.test.ts`
- `app/src/features/activitySimulator/__tests__/store.test.ts`
- `app/src/features/activitySimulator/__tests__/simulatorTime.test.ts`
- `app/src/features/activitySimulator/__tests__/simulatorContracts.test.ts`
- Simulator canonical cases in `app/__tests__/useTrackingStore.test.ts`
- historical Start/append/Finish/Memory validation in `backend/src/routes/__tests__/freeActivityContracts.test.js`

Shared Free Activity proof used by the matrix:

- Activity contracts, registry, operational state, completed intent, recovery/Memory, and integration contract suites;
- Memory evidence, settings, and durability boundary suites;
- Hike journal, pending sync, offline entity, marker tombstone, and sync ownership/cleanup suites;
- `useSessionStore`, Plant title/body, and Activity P0 screen contracts.

## Local validation record

| Gate | Result |
|---|---|
| Simulator-only suites | PASS — 5 suites, 57 tests |
| Simulator + canonical tracking boundary | PASS — 6 suites, 87 tests |
| Combined Activity/Memory/Cairn/recovery/sync matrix | PASS — 27 suites, 222 tests |
| Backend historical Start/append/Finish/Memory and reconciliation contracts | PASS — 11 tests |
| Changed Simulator/Activity TypeScript filter | PASS — no matching diagnostic |
| Whole-repository TypeScript | BASELINE RED — exit 2, 276 diagnostic lines; unrelated generated/test/tooling debt plus pre-existing App web-style errors |
| Expo Web internal-capability export | PASS — 3,395 modules, exit 0 |
| Expo Web mobile visual inspection | PASS — three 390×844 states including 10× controls/derived Run pace, zero browser runtime errors |
| `git diff --check` | PASS — no whitespace errors |

The Jest configuration emits an existing warning for misspelled `setupFilesAfterFramework`; it does not fail the focused suites.

## Native-only gate

The following remain **NATIVE REQUIRED** and are not represented as Simulator passes:

- iOS locked-screen/background delivery;
- Android background service behavior;
- memory pressure / jetsam;
- deliberate force quit;
- Background App Refresh and Low Power Mode restrictions;
- permission downgrade and Precise Location off;
- real GPS/tunnel/multipath conditions;
- native batching/order/scheduling;
- signed A→B→A device recovery and server re-open evidence.

The Simulator’s release verdict means “ready for internal Functional QA OTA,” not “native matrix passed” and not “production release approved.”
