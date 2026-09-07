# Activity Simulator findings ledger

Review date: 2026-09-07
Reviewed base: `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c` plus preserved local Free Activity reliability work
Scope: local implementation only; no production mutation

## SIM-001

- **AREA:** Existing Simulator reach
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — the former `SimWalkerOverlay` was mounted only by `HikingScreen`; Running had no simulator UI or source.
- **EVIDENCE:** Historical imports/mounts existed only in `app/src/screens/HikingScreen.tsx`; no `simWalker` reference existed in `RunningScreen.tsx`.
- **USER / QA IMPACT:** Free Run could not be exercised without physical motion.
- **DECISION:** Replace the Hike-only overlay with one shared Hike/Run provider panel.
- **ACTION:** Added `ActivitySimulatorPanel` to both screens and one shared engine/provider.
- **STATUS:** FIXED LOCALLY
- **TEST:** `simulatorContracts.test.ts` both-screen contract; mobile Expo Web QA.

## SIM-002

- **AREA:** Existing Simulator architecture
- **SEVERITY:** Critical
- **FACT / INFERENCE:** FACT — `gpsInjector.emit()` called hidden `__simwalkerAddTrackPoint`; its fallback directly appended all three track arrays and `lastCoordinate`.
- **EVIDENCE:** Historical `app/src/dev/simWalker/gpsInjector.ts` and `useTrackingStore.ts` contained `__simwalkerAddTrackPoint`, direct `setState`, private distance/elevation calculations, and a hard-coded 200 m break rule.
- **USER / QA IMPACT:** A visually plausible trace did not prove production GPS acceptance, journal durability, segment authority, Memory, ownership, or recovery.
- **DECISION:** Simulator may emit location evidence only.
- **ACTION:** All Activity samples now call the public async `addTrackPoint` acceptance boundary with an immutable Activity/provider lease. Hidden injection APIs and fallback were removed.
- **STATUS:** FIXED LOCALLY
- **TEST:** `useTrackingStore.test.ts` Simulator boundary tests; `simulatorContracts.test.ts` no-duplicate-pipeline check.

## SIM-003

- **AREA:** History mutation
- **SEVERITY:** Critical
- **FACT / INFERENCE:** FACT — former Undo sliced committed track arrays and recomputed distance while leaving journal, Memory, segments, Cairns, and server state inconsistent.
- **EVIDENCE:** Historical `__simwalkerRemoveLastN` and `gpsInjector.undoSteps()`.
- **USER / QA IMPACT:** QA could manufacture corrupt or misleading Activity state.
- **DECISION:** No committed-history undo in v1. Walking back is ordinary new movement.
- **ACTION:** Removed Undo and its hidden store API. Backtracking generates new canonical samples and increases travelled distance.
- **STATUS:** FIXED LOCALLY
- **TEST:** `geodesy.test.ts`, `engine.test.ts`, and canonical store return-distance test.

## SIM-004

- **AREA:** Security gate
- **SEVERITY:** Critical
- **FACT / INFERENCE:** FACT — the prior production bundle deliberately allowed five-tap Debug Mode plus an in-memory toggle to expose worldwide synthetic movement.
- **EVIDENCE:** Historical Hiking comment: “removed `__DEV__` gate so users can activate sim-walker in production builds”.
- **USER / QA IMPACT:** A normal public user who discovered Debug Mode could generate synthetic Activity data.
- **DECISION:** Require two independent gates: build/update-channel capability and Debug Mode.
- **ACTION:** Added `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED`; internal development/preview profiles set `true`, production explicitly sets `false`. Simulator selection also requires persistent Debug Mode and explicit Simulator enablement.
- **STATUS:** FIXED LOCALLY
- **TEST:** `simulatorContracts.test.ts` public/internal profile assertions.

## SIM-005

- **AREA:** Worldwide movement
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — old movement approximated longitude with division by `cos(latitude)`, never normalized longitude, and used unseeded `Math.random()` noise.
- **EVIDENCE:** Historical `moveByBearing()` and `boxMuller()`.
- **USER / QA IMPACT:** Dateline/high-latitude use could generate invalid or unstable coordinates; failures were not reproducible.
- **DECISION:** Use deterministic great-circle movement and no noise by default.
- **ACTION:** Added validated global coordinates, longitude wrapping, great-circle destination/distance/bearing, seed metadata, and deterministic default sampling.
- **STATUS:** FIXED LOCALLY
- **TEST:** `geodesy.test.ts` worldwide/high-latitude/dateline/reversal cases.

## SIM-006

- **AREA:** Recovery and ownership
- **SEVERITY:** Critical
- **FACT / INFERENCE:** FACT — old simulator state was intentionally memory-only and had no Activity source identity, owner generation, or recovery binding.
- **EVIDENCE:** Historical `useSimWalkerStore` documentation and absence from Activity journal/registry metadata.
- **USER / QA IMPACT:** Relaunch could not coherently resume a simulated unfinished Activity; stale callbacks were not source-fenced.
- **DECISION:** Persist only user-scoped local provider context and bind it to the canonical `clientActivityId`/generation.
- **ACTION:** Persisted origin/current position, speed, altitude, accuracy, signal, bounded virtual clock/sample/batch state, session identity, and bounded waypoints. Journal/registry retain local `locationProviderSource`. Cross-source and stale lease callbacks are rejected.
- **STATUS:** FIXED LOCALLY
- **TEST:** `store.test.ts`, `activityRecoveryMemory.test.ts`, `activityRegistry.test.ts`, and `useTrackingStore.test.ts` ownership cases.

## SIM-007

- **AREA:** Cairns
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — Full Plant sampled device GPS independently; Run had no simulator. Old joystick position therefore did not reliably feed either accepted Cairn flow.
- **EVIDENCE:** Existing `gpsSampler.ts` used only Expo Location; old Simulator was Hike-only.
- **USER / QA IMPACT:** Simulator could not truthfully validate Full Plant, Quick Cairn, loss behavior, provenance, or offline commit.
- **DECISION:** Plant samples the selected provider but keeps normal sampling quality decisions; Quick Cairn uses the latest accepted Activity fix.
- **ACTION:** Added Simulator readings to normal Plant fusion, fail-closed LOST behavior, Run freshness/LOST gate, and local commit/association logs. No Simulator-specific Cairn product was added.
- **STATUS:** FIXED LOCALLY; 50 m drag interaction remains manual QA
- **TEST:** Static integration contract plus existing offline entity/provenance suites and Manual QA A/B.

## SIM-008

- **AREA:** Product parity
- **SEVERITY:** Critical
- **FACT / INFERENCE:** FACT — the prior code bypassed too-short eligibility for authored simulation and bypassed normal Memory simplification when the old toggle was active.
- **EVIDENCE:** Historical `stopTracking` `isSimWalkerActive` branch and `flushHikingToMemory` `simWalkerActive` branch.
- **USER / QA IMPACT:** Simulator could report success for behavior a real Activity would reject or process differently.
- **DECISION:** No source-based product exceptions.
- **ACTION:** Removed both bypasses. Simulator evidence uses normal eligibility and incremental central Memory evidence.
- **STATUS:** FIXED LOCALLY
- **TEST:** `activityContracts.test.ts`, `memoryEvidenceAuthority.test.ts`, and no-bypass static assertions.

## SIM-009

- **AREA:** Real Activity stationary duration
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — accepted same-segment duration is derived between clean points, but stationary suppression could prevent another clean point indefinitely.
- **EVIDENCE:** Canonical `addTrackPoint` suppressed every low-speed point inside the accuracy radius and updated no clean-track time anchor.
- **USER / QA IMPACT:** A stationary but actively recording real or simulated Activity could show and save stale active duration.
- **DECISION:** Preserve drift suppression while emitting a zero-motion clean heartbeat.
- **ACTION:** After 30 seconds, a stationary accepted fix is snapped to the previous accepted coordinate/altitude and enters the normal journal/metrics/Memory path. It adds time but zero distance/elevation.
- **STATUS:** REAL PIPELINE DEFECT FIXED LOCALLY
- **TEST:** Canonical store and Activity stats suites; native stationary QA still required.

## SIM-010

- **AREA:** Passive Memory quality
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — passive Memory wrote any Expo Balanced fix without checking horizontal accuracy.
- **EVIDENCE:** `PassiveMemoryRecorder` called `recordMemoryEvidence` directly for every foreground watcher fix.
- **USER / QA IMPACT:** Poor real or simulated GPS could unlock unreliable passive Memory.
- **DECISION:** Share the Activity horizontal-quality ceiling with passive evidence.
- **ACTION:** Added `MAX_ACCEPTABLE_HORIZONTAL_ACCURACY_M = 25`; both canonical Activity acceptance and passive producers use it. Real coordinates remain absent from Simulator logs.
- **STATUS:** REAL PIPELINE DEFECT FIXED LOCALLY
- **TEST:** Static shared-authority assertion; passive ON/OFF and poor-fix behavior in Manual QA H.

## SIM-011

- **AREA:** Time acceleration
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — canonical Activity time is the accepted point timeline, but Activity Start, owner fences, recovery, Finish, pending payloads, Memory, and server rows must use epochs coherent with that timeline. Simple future-dated acceleration would be accepted by several current server paths rather than safely rejected.
- **EVIDENCE:** `startTracking` persists/sends `startedAt`; `addTrackPoint` uses sample `t` for order/gap/duration/journal/Memory; `stopTracking` sends `end_time`; session validation checks valid ISO/positive epochs but no tight future skew; Memory permits up to `Date.now()+24h`.
- **USER / QA IMPACT:** Future replay could create an apparently valid but temporally impossible Activity, then conflict with recovery/freshness/ownership clocks.
- **DECISION:** Accelerated Activities use a bounded historical clock; 1× remains wall-clock. Never weaken backend validation or add metric overrides.
- **ACTION:** Added fixed pre-Start scales `1×/2×/5×/10×/30×`, a 12-hour historical reserve plus 60-second safety margin, provider-clock Start/Finish/recovery/freshness, and a hard virtual limit.
- **STATUS:** FIXED LOCALLY
- **TEST:** `simulatorTime.test.ts`, parameterized engine tests, canonical Hike/Run derivation tests, backend schema payload test, and sync replay test.

## SIM-012

- **AREA:** Native background behavior
- **SEVERITY:** Medium
- **FACT / INFERENCE:** FACT — the Simulator is a JavaScript provider; it cannot reproduce CoreLocation/Fused Location delivery, OS batching, permission changes, or force-quit semantics.
- **EVIDENCE:** Simulator provider intentionally does not register Expo background location. Real provider remains unchanged.
- **USER / QA IMPACT:** It reduces walking but cannot close the signed native device gate.
- **DECISION:** Be explicit; never claim Simulator replaces native tests.
- **ACTION:** Native-only cases are enumerated in `MANUAL_QA_GUIDE.md` and `TEST_EVIDENCE.md`.
- **STATUS:** ACCEPTED LIMITATION
- **TEST:** Physical-device matrix required.

## SIM-013

- **AREA:** Source metadata
- **SEVERITY:** Low
- **FACT / INFERENCE:** INFERENCE — server schema expansion is unnecessary for source safety or downstream parity.
- **EVIDENCE:** Local registry, journal meta, and pending lifecycle already provide enough diagnostic correlation; server accepts the normal Activity representation.
- **USER / QA IMPACT:** Avoids creating a Simulator product or backend contract.
- **DECISION:** Keep `locationProviderSource` local/internal. Do not show it in public Activity Detail.
- **ACTION:** Added source only to local Activity registry/journal and local logs.
- **STATUS:** IMPLEMENTED
- **TEST:** Recovery/source static contracts and normal sync tests.

## SIM-014

- **AREA:** Segment rendering
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — live Hike/Run renderers still relied on legacy `segmentBreak`-style assumptions while accepted Activity now carries canonical `segmentId`.
- **EVIDENCE:** Screen map GeoJSON construction did not consistently split by `segmentId`.
- **USER / QA IMPACT:** a real gap could be stored correctly yet appear as a solid connector live.
- **DECISION:** Render solid lines per canonical segment; Detail continues to own dashed gaps.
- **ACTION:** Hike and Run live map geometry now split on segment identity.
- **STATUS:** REAL PIPELINE DEFECT FIXED LOCALLY
- **TEST:** `freeActivityIntegrationContracts.test.ts`; mobile/native visual QA.

## SIM-015

- **AREA:** Diagnostics durability
- **SEVERITY:** Medium
- **FACT / INFERENCE:** FACT — a log flush keyed only from the currently hydrated user could strand Account A dirty events after an A→B switch.
- **EVIDENCE:** Initial local logger design filtered the dirty set using current store ownership.
- **USER / QA IMPACT:** The exact logout/recovery failure under investigation could lose its diagnostic tail.
- **DECISION:** Dirty buffers retain their captured owner/session context.
- **ACTION:** Flushes can target one owner or all owners; indices remain user-scoped and bounded.
- **STATUS:** FIXED LOCALLY
- **TEST:** Log bound/sanitizer tests; A/B export verification remains manual.

## SIM-016

- **AREA:** Repository baseline
- **SEVERITY:** Informational
- **FACT / INFERENCE:** FACT — whole-repository TypeScript/Jest baselines are not green for unrelated generated, legacy, configuration, Route/geo, and Playwright collection issues.
- **EVIDENCE:** Current `tsc --noEmit` exits 2 with 276 diagnostic lines; focused changed scope has no Simulator/Activity errors. Prior release report records 15 failing full-sweep suites.
- **USER / QA IMPACT:** Global red output must not be mislabeled as a Simulator regression or hidden.
- **DECISION:** Use the accepted focused Free Activity gate and report the full baseline verbatim.
- **ACTION:** 27 relevant app suites / 222 tests and 11 backend contracts pass; full baseline remains open outside this task.
- **STATUS:** OPEN BASELINE, NOT INTRODUCED HERE
- **TEST:** See `TEST_EVIDENCE.md`.

## SIM-017

- **AREA:** Settings/navigation hydration race
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — the first 390×844 render run showed Simulator enabled in memory, then disabled after navigating to Hike.
- **EVIDENCE:** `ActivitySimulatorPanel` redundantly called account hydration even when `AppRoot` had already hydrated the same account; that disk read could win before the one-second coalesced settings write.
- **USER / QA IMPACT:** Immediately opening Hike/Run after enabling Simulator could make the panel disappear and select Real GPS.
- **DECISION:** App/account boundary owns hydration; a panel may hydrate only when mounted in isolation for a different/unhydrated owner.
- **ACTION:** Added same-owner guard before panel hydration.
- **STATUS:** FIXED LOCALLY
- **TEST:** 390×844 Expo Web capture harness exercises immediate navigation after enabling.

## SIM-018

- **AREA:** Recovery timestamp ownership
- **SEVERITY:** Critical
- **FACT / INFERENCE:** FACT — recovery previously generated `liveOwnerAcceptAfterMs` from wall `Date.now()`. A valid historical virtual sample would then be rejected as stale after relaunch.
- **EVIDENCE:** `activityRecovery.ts` rebuilt the owner fence on wall time while canonical acceptance rejects `t <= liveOwnerAcceptAfterMs`.
- **USER / QA IMPACT:** An accelerated Activity could recover but never accept another Simulator point.
- **DECISION:** Owner fences must use the selected provider timeline while preserving the Real-GPS wall-clock path.
- **ACTION:** Recovery/Resume now use `activityTimestampForSource`; the persisted Simulator clock is aligned forward to the newest journal/owner timestamp and never rewound.
- **STATUS:** FIXED LOCALLY
- **TEST:** `simulatorTime.test.ts` recovery alignment; recovery/provider static contract; existing recovery suites.

## SIM-019

- **AREA:** Live GPS freshness UI
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — Hike/Run lost-signal UI and Quick Cairn compared accepted point time with wall `Date.now()`, so all historical accelerated fixes appeared stale immediately.
- **EVIDENCE:** Screen freshness expressions used `Date.now() - lastFixTimestamp`; accelerated points intentionally remain historical.
- **USER / QA IMPACT:** A healthy accelerated provider would display GPS loss and block Quick Cairn.
- **DECISION:** Freshness must compare timestamps on the selected provider timeline; Real GPS remains wall based.
- **ACTION:** Hike/Run and Quick Cairn use Simulator virtual-now only when `locationProviderSource='simulator'`.
- **STATUS:** FIXED LOCALLY
- **TEST:** `simulatorContracts.test.ts` provider-timeline assertions; manual accelerated Hike/Run/Cairn matrix.

## SIM-020

- **AREA:** Finish temporal coherence
- **SEVERITY:** Critical
- **FACT / INFERENCE:** FACT — a wall-clock `endedAt` paired with a historical accelerated start would make server/local elapsed span disagree with canonical active duration by roughly the reserved 12 hours.
- **EVIDENCE:** Completion snapshots and pending `end_time` were previously sourced from `Date.now()`, while duration is `calculateActivityStats(trackPoints)`.
- **USER / QA IMPACT:** Detail/sync could contain contradictory start/end/duration facts despite correct pace/distance.
- **DECISION:** Lifecycle timestamps follow provider evidence; metrics still come only from Activity stats.
- **ACTION:** Simulator Finish reads the bounded virtual epoch at or after the last point. Real Finish remains wall-clock.
- **STATUS:** FIXED LOCALLY
- **TEST:** `simulatorTime.test.ts`; `useTrackingStore.test.ts`; pending/sync payload preservation tests.

## SIM-021

- **AREA:** Accelerated sampling density
- **SEVERITY:** High
- **FACT / INFERENCE:** FACT — one point per real second becomes a 30-second/possibly 500 m jump at `30×`; that can exceed the Activity 200 m edge guard and leave sparse Memory geometry.
- **EVIDENCE:** Simulator supports 60 km/h custom speed; `60 km/h × 30 s = 500 m`; canonical Activity discards an added edge above 200 m.
- **USER / QA IMPACT:** Acceleration could undercount distance/Memory or look like a teleport solely because of Simulator batching.
- **DECISION:** Bound virtual sample intervals instead of raising Activity limits.
- **ACTION:** Each 1 Hz wall tick is split into ordered samples at most ten virtual seconds apart. Normal 30× produces three samples; a delayed capped tick produces at most 15.
- **STATUS:** FIXED LOCALLY
- **TEST:** `engine.test.ts` asserts 30× count, ≤10-second order, <200 m maximum-speed edges, physical speed metadata, and derived totals.

## SIM-022

- **AREA:** Server historical-time compatibility
- **SEVERITY:** Medium
- **FACT / INFERENCE:** FACT — bounded historical start/point/end/Memory values satisfy current normal payload schemas. Current stale-shell cleanup applies only to unfinished legacy rows whose `client_activity_id IS NULL`.
- **EVIDENCE:** `schemas.session.start/appendPoints/save` accept the historical payload; Memory accepts positive non-future integer epochs; `Session.startOrResolve` legacy cleanup explicitly filters `client_activity_id IS NULL`.
- **USER / QA IMPACT:** An identified Simulator Activity can traverse ordinary pending replay without being mistaken for an abandoned legacy shell.
- **DECISION:** Keep source metadata local; upload an ordinary normal Activity payload with immutable client identity.
- **ACTION:** Added backend contract validation and sync payload-preservation coverage; made no production schema/migration change.
- **STATUS:** VERIFIED LOCALLY; INTERNAL QA ACCOUNT NETWORK ROUND-TRIP REQUIRED IN OTA
- **TEST:** `backend/src/routes/__tests__/freeActivityContracts.test.js`; `syncDaemonOwnershipCleanup.test.ts`; Manual QA accelerated-time closure and Sync sections.

## SIM-023

- **AREA:** Auto-pause observation clock
- **SEVERITY:** Low
- **FACT / INFERENCE:** FACT — the optional production auto-pause monitor observes native/wall-clock samples and is not a canonical duration authority. Historical Simulator samples are outside its wall-history filter.
- **EVIDENCE:** `autoPauseMonitor` uses wall `Date.now()` windows; Activity duration itself is derived from accepted same-segment point intervals.
- **USER / QA IMPACT:** Accelerated time does not accelerate an auto-pause trigger. Stationary Activity duration, Pause, Resume, Finish, and stats remain testable.
- **DECISION:** Do not make production auto-pause depend on Debug virtual time in this bounded closure.
- **ACTION:** Documented as an inherent limitation; no production monitor change.
- **STATUS:** ACCEPTED LIMITATION, NON-BLOCKING FOR REQUESTED ACCELERATED ACTIVITY QA
- **TEST:** Canonical stationary heartbeat and accelerated duration tests; native auto-pause remains real-device/wall-time QA.

## SIM-024

- **AREA:** Historical Activity presentation
- **SEVERITY:** Low
- **FACT / INFERENCE:** FACT — reserving a full safe 12-hour window means accelerated QA Activities are dated roughly 12 hours before the wall-clock Start and can appear on the prior calendar day.
- **EVIDENCE:** `simulatorActivityStartTimestamp` anchors every scale above 1× at `wallStart - 12h - 60s`; normal Detail/history use stored Activity epochs.
- **USER / QA IMPACT:** QA must distinguish intentional historical dating from future/reversed timestamp defects.
- **DECISION:** Accept and prominently document the bounded historical date because shifting committed evidence later or future-dating it would violate ordering/integrity.
- **ACTION:** Added contract/manual guidance; public real-GPS Activities remain wall-clock.
- **STATUS:** ACCEPTED SYNTHETIC-TIME CHARACTERISTIC
- **TEST:** Historical timestamp and backend payload tests; Manual accelerated-time closure step 5.
