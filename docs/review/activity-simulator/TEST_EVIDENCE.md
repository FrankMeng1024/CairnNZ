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
| 46 | Simulator logs bounded | AUTOMATED | PASS 2,000 event / 512 KiB / five-session limits, 20-second batching, retry and expiry caps |
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
- `app/src/features/activitySimulator/__tests__/nativeBlockerRound2.test.ts`
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

## Native blocker round-2 validation

| Gate | Result |
|---|---|
| Simulator + Free Activity regression selection | PASS — 24 suites, 230 tests |
| Required focused round-2 selection | PASS — 6 suites, 130 tests |
| Deterministic Hike 5 km/h, 1×, 10 wall seconds | PASS — approximately 14 m; all samples accepted |
| Deterministic Hike 5 km/h, 10×, 10 wall seconds | PASS — approximately 139 m; all samples accepted |
| Deterministic Run 10 km/h, 10×, 10 wall seconds | PASS — approximately 278 m; all samples accepted |
| Continuous joystick hold / release / autopilot | PASS — continuous sequence; release stops; autopilot remains active |
| Changed-scope TypeScript diagnostic filter | PASS — no matching diagnostics; whole-repository baseline remains 276 lines |
| Internal-capability iOS bundle export | PASS — 3,752 modules, one Hermes iOS bundle, exit 0 |
| Expo Web mobile board | PASS — five 390×844 states, independent switch click, toggle-OFF overlay removal, zero runtime errors |
| Physical iPhone map/touch behavior | NATIVE REQUIRED — no OTA or device mutation performed in this round |

The Jest configuration emits an existing warning for misspelled `setupFilesAfterFramework`; it does not fail the focused suites.

## Native regression forensic / baseline-restoration validation — 2026-09-08

| Gate | Result |
|---|---|
| Forensic anchors and A/B/C/D matrix | PASS — recorded in `NATIVE_REGRESSION_FORENSIC.md`; C/D are transcript-backed uncommitted states, not invented Git commits |
| Restored ordinary Hike camera contract | PASS (characterization) — Debug OFF, Debug ON + Simulator OFF, and both idle Simulator setup states all select the original default-world/native-follow/600 ms fly-to contract |
| Simulator provider isolation | PASS (contract) — configured idle Simulator has no map/provider authority; the engine emits no samples without an Activity lease |
| Toggle continuity | PASS — ordinary Real-GPS Activity is unlocked; only a live/unfinished Simulator-provider Activity blocks disable and supplies a reason |
| QA telemetry privacy / transport | PASS — precise Simulator coordinates retained; real/unknown coordinates, embedded coordinate pairs, credentials, email, bearer strings, and JWT-like values removed before upload |
| Broad regression selection | PASS — 16 suites, 206 tests |
| Preserved elapsed-format contract | PASS — 1 suite, 2 tests; fractional/invalid durations remain whole-second safe |
| Whole-app Jest command | REPOSITORY-WIDE RED — 58 suites / 592 tests pass; 14 suites / 40 tests fail outside this change's focused contracts (stale removed exports, missing Playwright/i18n modules, and unrelated route-edit/auth expectations) |
| Changed-scope TypeScript filter | PASS except pre-existing `App.tsx:951/956/967/969/971` WebPhoneFrame style / stale `@ts-expect-error` diagnostics; no diagnostic in the changed Activity/Simulator/telemetry modules |
| Backend syntax | PASS — `node --check backend/src/routes/telemetry.js` |
| Expo Web internal export | PASS — 3,399 modules, exit 0 |
| Expo Web 390×844 runtime board | PASS — five states; 15 assertions including independent toggle, full settings and diagnostics reachability, Start Here/Use Map Center handler arrival, right-side joystick, and zero runtime errors |
| `git diff --check` | PASS |
| Physical iPhone map/camera/touch/sample chain | **NATIVE REQUIRED** — intentionally not inferred from Jest or Expo Web |
| yiiling authenticated retrieval | **DEPLOYMENT REQUIRED** — route hardening is local only; no deploy, OTA, database migration, or production mutation was performed |

The current runtime evidence is in `runtime-evidence.json`; the five-state composite is `activity-simulator-runtime-board.jpg`. The first two attempted board runs used the wrong local capability environment-variable name and timed out before Simulator hydration. They changed no application state or artifact. The successful run used the actual gate, `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true`.

## O37 final virtual-GPS candidate — 2026-09-09

This section supersedes earlier Simulator UI/time-scale assertions where the clarified final product contract differs.

| Gate | Result |
|---|---|
| O36 production telemetry retrieved first | PASS — iPhone sessions `qa-mtsmovfy-43c9lqeb` and `qa-mtsmpawf-lc911f5m`; evidence recorded before implementation in `FINAL_SIMULATOR_FORENSIC.md` |
| Distant virtual origin / provider fence | PASS — Hike and Run tests reject a Shanghai-shaped late real callback and commit Queenstown as point one with no connector |
| Map lifecycle characterization | PASS — one stable map owner per screen; focus rotates mount/key; positive style/load/idle readiness; loading error is diagnostic, not terminal |
| Runtime source semantics | PASS — live speed/time changes; Normal/Poor/Lost/Frozen; terrain-derived altitude; joystick and automatic movement |
| Repeated manual reacquisition | PASS — three Lost/reacquisition cycles create four segment IDs with zero connector distance/elevation/duration |
| Rollback 10/25/50/100 m | PASS — accepted-tail planning, canonical metric recalculation, position/time restoration, no Memory or Cairn deletion |
| Rollback crash safety | PASS — write-ahead truncation cap prevents a longer active/backup snapshot from winning after interruption; later append continues from the corrected prefix |
| Server consistency contract | PASS — final Save is the authoritative complete route/raw/metric replacement; no backend or schema change required |
| Telemetry privacy/bounds | PASS — synthetic coordinates retained; real coordinates and credential-shaped keys/values removed; 2,000-event/512 KiB hard bounds including critical-only input |
| Focused client selection | PASS — 21 suites, 246 tests; includes active Real-Activity Simulator-console isolation and shared Hike/Run Mapbox ownership |
| Changed Activity/Simulator TypeScript filter | PASS — no matching diagnostic; only the previously recorded `App.tsx` WebPhoneFrame style diagnostics remain |
| Internal-capability iOS export | PASS — 3,755 modules, clean-cache Hermes export |
| Expo Web export | PASS — 3,400 modules, clean-cache capability enabled |
| Expo Web 390×844 harness | PASS — four states / zero runtime errors; artifacts written to `/tmp`, not deploy-bearing review directories |
| `git diff --check` | PASS |
| Physical iPhone map/touch/provider/Detail proof | **O37 NATIVE RETEST REQUIRED** — intentionally not inferred from Web/Jest |

The O37 Web board shows the expected native-map fallback because Mapbox native rendering is unavailable on Web. It validates control layout and state gating only. Generated captures remain temporary local evidence under `/tmp/cairnnz-o37-mobile-qa`.

## O38 real-parity / Free Activity correction — 2026-09-09

| Gate | Result |
|---|---|
| O37/O36 yiiling forensic | PASS — automatic iPhone batches and exact rows retrieved; O37 `qa-mttg439c-ccqp1eyj` has 657 events / 523,842 bytes; map source 401s and missing critical transitions documented before implementation |
| Real GPS contract | PASS — foreground/background configuration, native cadence/batching, owner/generation/order fences, and canonical acceptance documented against real Hikes 192/193 |
| Distant origin Hike + Run | PASS — Shanghai-shaped real sample rejected, Queenstown Simulator sample committed first, zero connector/distance |
| Runtime GPS/terrain/control semantics | PASS — Normal/Poor/Lost/Frozen, live speed/time/terrain, joystick, and canonical sample path |
| Exact acceleration | PASS — 5 km/h × 30× × 10 s ≈ 416.7 m; 10 km/h × 30× × 10 s ≈ 833.3 m; emitted physical speed is not multiplied |
| O38 production realism (`hike-09/09/2026`) | PASS — session 2053: 371 monotonic raw points, one segment/no gaps, 762.319 m recomputed raw distance = stored distance, 368 s, 22.861 m gain, max inferred 3.756 m/s, 43 Memory points, 277 accepted points independently matched to 53 derived display points |
| Fresh Simulator entry | PASS — Hike and Run share a registry-aware reset; stale origin/current/destination/reacquisition/runtime values clear while exact unfinished recovery and registry uncertainty fail closed |
| Fast realistic replay | PASS — 60×/120× retain physical speed and historical canonical time; maximum burst is 12 ordered ≤10 s samples / 120 virtual seconds; 5 km/h 1× and 120× scenarios have equivalent 120 s distance/endpoint/elevation/segment truth |
| O38 remote telemetry sufficiency | PASS — automatic iPhone upload `qa-mttg439c-ccqp1eyj`, 833 events / 524,245 bytes, complete origin→provider→first point→movement→Finish→matching→Save/synced completion chain |
| O39 390×844 runtime / exports | PASS — five-state local-only QA board, 120× control visible, zero runtime errors; Web and iOS Expo exports succeed |
| Walking Auto Move | PASS — Mapbox walking request/geometry bound; offline/token/request failures do not fall back silently; explicit Advanced straight line retained |
| Three repeated manual losses | PASS — Segment 1→4, zero connector metrics and no connector Memory input |
| Rollback | PASS — 10/25/50/100 m planner, canonical metric/current-time/position recalculation, journal truncation recovery, Memory/Cairn retention |
| Map matching | PASS (contract) — shared real/Simulator completion, per-segment match/fallback, raw authority, gap exclusion, Activity Detail derived source |
| Activity navigation/delete | PASS (contract) — post-save Back resets to Trails; deleted projection invalidated; Activity-derived Route backend mutation serialized with deletion |
| Rename | PASS — remote server-first success/failure and pending-outbox-first behavior |
| QA telemetry | PASS for transport + implementation — O37 iPhone auto-upload/retry/retrieval proven; O38 same-turn serialization and protected critical-set tests pass; O38 native remote completeness remains the retest gate |
| Focused client selection | PASS — 23 suites, 265 tests |
| Changed TypeScript scope | PASS — zero diagnostics across 53 changed/new TypeScript files; whole-repository baseline remains red with 263 unrelated diagnostic lines |
| Backend Free Activity + telemetry contracts/syntax | PASS — 19 tests; six-file scoped backend commit; no schema migration |
| EAS preview environment presence | PASS — Mapbox public token, yiiling API, and Simulator capability booleans all true; no values exposed |
| EAS preview iOS export | PASS — 3,760 modules, one Hermes iOS bundle, exit 0 |
| Expo Web 390×844 harness | PASS — four states, 13 assertions, zero runtime errors; generated artifacts written only to `/tmp` |
| Production backend | PASS — commit `8900028e`, canonical deploy, zero migrations, backend recreated/healthy; MySQL/nginx not restarted |
| Production telemetry smoke | PASS — `qa-o38-smoke-1788927556466`; anonymous upload/retrieval rejected, operations upload/exact/recent retrieval succeeded, synthetic coordinate retained, real coordinate and credential-shaped data removed |
| `git diff --check` | PASS — no whitespace errors |
| Native iPhone result | **O38 RETEST REQUIRED** — readiness is not native certification |

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

## O39 Activity realism / fast replay candidate — 2026-09-09

| Gate | Result |
|---|---|
| Production Activity realism | PASS — SELECT-only session 2053 analysis recomputes 762.319 m from 371 monotonic raw points over 370.441 virtual seconds; one segment, zero gaps, plausible Hike speed/pace/elevation |
| Real Hike comparison | PASS — sessions 192/193 use the same canonical/journal/metric/Memory/save contract; Simulator delivery is intentionally deterministic rather than native-irregular |
| Automatic remote telemetry | PASS — `qa-mttg439c-ccqp1eyj`, 833 events / 524,245 bytes; origin-to-provider-to-first-point-to-Finish/matching/Save/synced chain retained without manual JSONL |
| Fresh Hike/Run setup | PASS — shared durable-registry guard clears completed/discarded setup and preserves the same unfinished Activity or uncertain recovery state |
| 1x / 120x parity | PASS — same 5 km/h path over 120 virtual seconds ends within 0.1 m with equivalent distance, duration, pace basis, elevation, segment, and physical-speed metadata |
| Burst safety | PASS — maximum 120 virtual seconds / 12 ordered canonical samples per tick; delayed excess wall backlog is dropped rather than teleported |
| Focused client selection | PASS — 21 suites, 266 tests |
| Focused post-change selection | PASS — 3 suites, 78 tests |
| Changed Activity/Simulator TypeScript filter | PASS — no diagnostics in changed scope; unrelated repository baseline diagnostics remain |
| Expo Web export and 390x844 QA harness | PASS — five states, 120x visible, zero runtime errors; captures remain under `/tmp` |
| Final O39 iOS export | PASS — 3,760 modules, Hermes bundle, exit 0 after the marker change |
| `git diff --check` | PASS |
| Physical native behavior | **O39 RETEST REQUIRED** — readiness is not native certification |
