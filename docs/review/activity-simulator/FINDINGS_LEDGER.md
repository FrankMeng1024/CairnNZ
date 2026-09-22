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

## SIM-025

- **AREA:** Simulator overlay composition
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN
- **FACT:** The compact trigger was anchored at `right: 10, top: 118`; the expanded panel filled the screen from `top: 84` to `bottom: 106`, and the joystick lived inside that panel.
- **EVIDENCE:** Unchanged 390×844 reproduction measured the trigger at the upper-right and the expanded panel across the map center; the approved runtime board showed metric/map/action obstruction.
- **IMPACT:** Debug controls obscured the UI they are meant to test.
- **ACTION:** Docked the compact trigger at lower-left above activity controls, bounded the settings panel above map center, and separated the live joystick into a right-side dock.
- **STATUS:** FIXED LOCALLY; NATIVE DEVICE VISUAL CONFIRMATION REQUIRED

## SIM-026

- **AREA:** Live metric formatting
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN
- **FACT:** Canonical `formatDuration` passed the fractional seconds remainder directly to `String()`.
- **EVIDENCE:** Unchanged runtime reproduced `01:30.679000000000002` from `durationS=90.679000000000002` on Hike.
- **IMPACT:** Hike/Run metric width expanded and could collide with adjacent metrics.
- **ACTION:** Normalize finite, non-negative duration to whole elapsed seconds in the shared formatter.
- **STATUS:** FIXED LOCALLY; UNIT AND 390×844 RUNTIME PASS

## SIM-027

- **AREA:** Run map readiness
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN for the unbounded loading state; UNKNOWN for the reported native basemap-render failure
- **FACT:** Running reset `mapLoadState` to `loading` on focus and had no timeout when native success/failure callbacks did not fire. No evidence identifies a Simulator-specific Mapbox style/tile failure.
- **EVIDENCE:** Source trace against HikingMap's existing bounded readiness guard; Expo Web cannot render the native `@rnmapbox/maps` path.
- **IMPACT:** A missed native callback could leave `Loading map…` masking the map forever.
- **ACTION:** The first timeout-only mitigation was superseded in Round 2: the underlying map is revealed after the bound while diagnostics remain `timed-out`, and native style/idle/load/error callbacks now report actual readiness. Mapbox style/token/config remain unchanged.
- **STATUS:** SUPERSEDED BY SIM-032; NATIVE MAP CONFIRMATION REQUIRED

## SIM-028

- **AREA:** Simulator camera/recenter
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN
- **FACT:** Hike recenter read only the real-GPS `lastCoordinate`; Run's active Camera lacked the ref used by the Simulator follow effect.
- **EVIDENCE:** Direct Hike/Run camera-path trace.
- **IMPACT:** Simulator movement could update canonical activity evidence while camera recenter/follow used a stale or missing target.
- **ACTION:** Hike now recenters on its selected provider position; active Run binds the existing camera ref.
- **STATUS:** FIXED LOCALLY; NATIVE CAMERA MOTION CONFIRMATION REQUIRED

## SIM-029

- **AREA:** Start-coordinate readiness
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN
- **FACT:** Fresh Simulator state silently treated the Queenstown fallback coordinate as configured and exposed no explicit no-start state.
- **EVIDENCE:** Store defaults/persistence/provider trace.
- **IMPACT:** QA could start from an unintended location and had no actionable setup signal.
- **ACTION:** Added a persisted `startConfigured` invariant, fail-closed provider preparation, a compact `SET START` trigger state, and an expanded worldwide-coordinate setup prompt. Existing v1 users retain validated saved starts.
- **STATUS:** FIXED LOCALLY; STORE AND 390×844 RUNTIME PASS

## SIM-030

- **AREA:** Reported zero distance / native basemap failure
- **SEVERITY:** High
- **CLASSIFICATION:** UNKNOWN
- **FACT:** The supplied report shows `0.0 km`, but no device log or accepted-sample trace proves whether no samples were emitted, rejected, or simply not yet accumulated. The native basemap failure is likewise not reproducible on Expo Web.
- **EVIDENCE:** The unchanged engine/provider tests pass the same canonical sink and the Web renderer intentionally uses the map-unavailable fallback.
- **IMPACT:** These two native symptoms cannot be declared closed from browser evidence.
- **ACTION:** Round-2 native evidence narrowed the client-side branches; see SIM-032 for map authority/readiness fixes and SIM-035 for the joystick input-layer fix. Mapbox style/token/config remain unchanged.
- **STATUS:** SUPERSEDED BY SIM-032/SIM-035; NATIVE VERIFICATION GATE REMAINS

## SIM-031

- **AREA:** Controlled render evidence
- **SEVERITY:** Low
- **CLASSIFICATION:** PROVEN
- **FACT:** The first repaired board injected a historical virtual timestamp and a bound ID without activating an engine lease; the passive runtime correctly advanced its clock to wall time and produced an artificial stale-signal banner.
- **EVIDENCE:** Runtime snapshot showed `locationProviderSource=simulator` but a roughly twelve-hour difference between the passive Simulator clock and the injected point.
- **IMPACT:** The board could falsely suggest a provider-timeline regression.
- **ACTION:** Keep controlled render-only points on the passive runtime clock and assert the source/timestamp relationship. Canonical accelerated-clock behavior remains covered by engine tests with a real lease.
- **STATUS:** QA HARNESS FIXED; FINAL BOARD HAS NO ARTIFICIAL SIGNAL-LOSS STATE

## SIM-032

- **AREA:** Map hidden only under Debug/Simulator
- **SEVERITY:** Critical
- **FACT:** Debug Mode alone did not change the Hike/Run Mapbox tree, but `showSimulator` became true as soon as the Simulator toggle was on. Before any virtual start existed, that branch skipped real-location priming, removed `UserLocation`, installed a synthetic `ShapeSource`, and supplied the persisted/default virtual coordinate to Camera. The loading mask also observed only a subset of the native Mapbox readiness events.
- **ROOT CAUSE:** One boolean conflated Simulator control visibility with Simulator location authority and camera display. The setup state therefore replaced the proven normal map/location path too early; the idle engine also rewrote the same virtual position once per second, churning the synthetic source while native style/idle readiness was not observed.
- **FIX:** Split `simulatorControlsEnabled` from `simulatorLocationAuthoritative`; no-start setup now preserves real-GPS/default map display, while configured pre-start and bound Activities may use virtual authority. A stationary pre-start runtime is quiescent. Added native style-loaded, map-idle, map-loaded, fully-rendered, and loading-error observations. A timeout can reveal the underlying map but remains explicitly `timed-out`, never `mapReady`.
- **TEST:** `nativeBlockerRound2.test.ts` no-start/configured/active matrix; `simulatorContracts.test.ts` native callback and Hike/Run tree assertions; iOS Expo bundle export passes. Expanded SIM exposes map mounted/style/ready/load event/camera/display diagnostics.
- **STATUS:** FIXED LOCALLY; REAL-IPHONE MAP RENDER CONFIRMATION REQUIRED

## SIM-033

- **AREA:** Empty expanded SIM settings
- **SEVERITY:** Critical
- **FACT:** The expanded native panel used only `maxHeight` around a flex `ScrollView`, and its former movement child retained `flex: 1` after being moved into scroll content. The diagnostic block also preceded the controls.
- **ROOT CAUSE:** Native Yoga could resolve the scroll viewport/content flex chain without usable control height, so expansion succeeded while the configuration surface appeared empty or non-scrollable.
- **FIX:** Gave the bounded panel a concrete 210-point height, removed content-child flex growth, enabled nested native scrolling/visible indicator, and ordered start/speed/time/altitude/GPS/lifecycle controls before diagnostics.
- **TEST:** `simulatorContracts.test.ts` asserts fixed viewport, scroll surface, ordering, and pre-start controls; 390×844 Expo Web board visibly renders Start here/Use map center and no-start inputs.
- **STATUS:** FIXED LOCALLY; REAL-IPHONE SCROLL/TOUCH CONFIRMATION REQUIRED

## SIM-034

- **AREA:** Missing independent Activity Simulator toggle
- **SEVERITY:** Critical
- **FACT:** The tested native artifact offered no usable way to disable Simulator without disabling Debug Mode, despite the provider having a persisted `enabled` state distinct from the Settings `debugMode` state.
- **ROOT CAUSE:** The tested UI did not expose the existing provider capability state as a verifiable independent Developer control, and it had no explicit active-Activity lock grammar.
- **FIX:** Settings → Developer now exposes a testable `Activity Simulator` switch. Fresh user state defaults OFF, disabling it while idle stops the Simulator runtime and hides all SIM UI without changing Debug Mode. The switch is disabled while any Activity is active/unfinished, with Finish/Save/Discard guidance, preventing a mid-Activity provider switch.
- **TEST:** Store toggle/active-lock test; pure Debug/Simulator/build source-selection matrix; mobile QA harness clicks Simulator OFF, proves Debug remains ON, and proves all SIM overlays disappear.
- **STATUS:** FIXED LOCALLY; REAL-IPHONE SETTINGS CONFIRMATION REQUIRED

## SIM-035

- **AREA:** Joystick continuous movement failure
- **SEVERITY:** Critical
- **FACT:** Native joystick magnitude was calculated from `gesture.dx/dy`, whose origin is the finger-down point, and `onPanResponderGrant` supplied no movement input. A held edge press therefore began at magnitude zero; small drags produced very small speeds. The responder also accepted termination by the surrounding native map gesture system, which released input and stopped motion.
- **ROOT CAUSE:** The first failure layer was joystick/touch input, not the geodesic engine, accelerated clock, sample sequence, or canonical Activity acceptance. Autopilot and a once-set full joystick vector both continue through the same engine/sink path in deterministic tests.
- **FIX:** Derive bearing/magnitude from native `locationX/locationY` relative to the fixed joystick center on grant and move, keep the responder until release, block native responder takeover, and retain the same joystick node/timers across panel rerenders. Release remains the sole normal zero-input transition.
- **TEST:** Pure center/edge vector tests; source contract for grant/move/termination; ten-second continuous-hold tests at 5 km/h 1×, 5 km/h 10×, and Run 10 km/h 10×; release-stop and continuous-autopilot tests; canonical acceptance tests show no repeated rejection or non-monotonic timestamp.
- **STATUS:** FIXED LOCALLY; REAL-IPHONE HOLD/DRAG/RELEASE CONFIRMATION REQUIRED

## SIM-036

- **AREA:** Native blocker diagnostics
- **SEVERITY:** High
- **FACT:** The former panel exposed only the latest combined decision and could not show where generated motion diverged from canonical Activity or displayed map state.
- **ROOT CAUSE:** Generated, accepted, committed, and displayed stages were not separately observable on-device.
- **FIX:** Expanded SIM now shows selected/active provider, Simulator/start state, map mount/style/readiness/event/camera/display, joystick activity/magnitude/bearing, autopilot, virtual coordinate/time, generated and accepted sequences/coordinates, last rejection, owner/Activity/segment, committed point count, and last committed position. JSONL logging remains bounded and Simulator-local.
- **TEST:** Diagnostic source contracts plus engine/store sequence assertions; local Mapbox package confirms all wired native callbacks are supported by installed v10.3.1.
- **STATUS:** IMPLEMENTED LOCALLY; DEVICE FAILURE CAPTURE READY

## SIM-037

- **AREA:** O36 Run native map readiness
- **SEVERITY:** Critical
- **CLASSIFICATION:** PROVEN
- **FACT:** O36 Run reached `style_loaded` with a valid camera ref, then three `onMapLoadingError`-family callbacks forced `mapLoadState='unavailable'`.
- **EVIDENCE:** Production QA session `qa-mtsmpawf-lc911f5m`; installed `@rnmapbox/maps` documents that `onMapLoadingError` can repeat and is not exclusive with successful loading.
- **IMPACT:** Both normal and Debug Run can display `Map unavailable` even though the native style exists.
- **DECISION:** Resource/loading errors remain diagnostics; positive style/load/idle/render evidence owns display readiness. Preserve structured error payloads.
- **STATUS:** FORENSIC COMPLETE; O37 IMPLEMENTATION PENDING

## SIM-038

- **AREA:** O36 Hike camera lifecycle
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN
- **FACT:** `hike_camera_initial_target_applied` fired 18 times during one active Simulator movement interval because an initial-camera effect depended on the changing accepted coordinate.
- **EVIDENCE:** Production QA session `qa-mtsmpawf-lc911f5m`, 12:13:38Z–12:14:16Z.
- **IMPACT:** Runtime GPS updates repeatedly execute initialization semantics and make map/camera diagnosis misleading.
- **DECISION:** Initial camera application is per mount/phase only; later location changes use explicit follow/recenter behavior.
- **STATUS:** FORENSIC COMPLETE; O37 IMPLEMENTATION PENDING

## SIM-039

- **AREA:** O36 telemetry retention and map correlation
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN
- **FACT:** The latest iPhone row reached 522,308 bytes and begins at Simulator sample 18. It contains no virtual-origin/provider-lock/first-point chain and no map mount IDs.
- **EVIDENCE:** Production rows `qa-mtsmovfy-43c9lqeb` and `qa-mtsmpawf-lc911f5m` retrieved through the operations-only SOP.
- **IMPACT:** Bounded telemetry succeeds operationally but high-volume stationary samples evict the exact transitions required to prove real-to-virtual isolation and re-entry ownership.
- **DECISION:** Keep bounds, reduce repeated stationary diagnostics, add mount IDs, and preserve high-value transition evidence without making telemetry a product dependency.
- **STATUS:** FORENSIC COMPLETE; O37 IMPLEMENTATION PENDING

## SIM-040

- **AREA:** O37 normal Hike/Run Mapbox ownership
- **SEVERITY:** Critical
- **CLASSIFICATION:** PROVEN ROOT CAUSE; LOCALLY FIXED
- **FACT:** O36 treated Run loading-error callbacks as terminal despite prior style success, and Hike readiness depended on callbacks that did not reliably arrive on re-entry. Screen-local readiness/camera state lacked a native mount identity.
- **DECISION:** One stable `HikingMap` owns each Hike/Run screen across pre-start and Tracking. Each focus entry rotates a native map key/mount ID and resets only screen-local style/readiness/camera guards. Style, load, idle, or full-render are positive readiness evidence; loading errors remain structured nonterminal diagnostics. The initial Hike camera contract runs once per mount.
- **STATUS:** IMPLEMENTED AND CHARACTERIZED; PHYSICAL O37 RETEST REQUIRED

## SIM-041

- **AREA:** Real-to-virtual first-point contamination
- **SEVERITY:** Critical
- **CLASSIFICATION:** PROVEN RISK; LOCALLY FENCED
- **FACT:** A virtual-origin Activity is only truthful if provider ownership is fixed before canonical point one. Selecting a map center is not location evidence.
- **DECISION:** Start selects/binds Simulator before Tracking, deactivates real sources, logs `simulator_provider_locked`, then emits the origin through `addTrackPoint`. Canonical ingestion rejects any real/foreground/background callback for that owner as `provider-source-mismatch` and emits a protected rejection event. Tests use Shanghai-shaped real callbacks and a Queenstown origin for both Hike and Run; only Queenstown is committed and no connector exists.
- **STATUS:** IMPLEMENTED AND TESTED

## SIM-042

- **AREA:** Repeated GPS loss and gap truth
- **SEVERITY:** Critical
- **CLASSIFICATION:** PROVEN CONTRACT; LOCALLY IMPLEMENTED
- **FACT:** A one-gap `before/after` model cannot represent repeated real-world outages. Manual Lost reacquisition has no known path between endpoints.
- **DECISION:** Each explicit `丢失 → 重新定位 → 从这里继续` allocates a new canonical segment with reason `gps-reacquired`. No connecting point is inserted; segmented stats and Memory exclude the unknown connector. Tests produce Segment 1 through Segment 4 with three zero-distance gaps.
- **STATUS:** IMPLEMENTED AND TESTED; DASHED VISUAL POLISH REMAINS NON-BLOCKING

## SIM-043

- **AREA:** Debug Activity-tail rollback durability and sync
- **SEVERITY:** Critical
- **CLASSIFICATION:** PROVEN SAFE WITHOUT BACKEND CHANGE
- **FACT:** Active points may be incrementally backed up to the server, but normal final Save sends the authoritative complete route/raw/metric snapshot and the server overwrites those fields. Memory and Cairns are independent durable objects.
- **DECISION:** Rollback drains production/ingest, truncates the durable journal through a write-ahead cap marker, recomputes Activity state from retained accepted points, and restores Simulator position/time to that tail. Recovery honors the cap even if killed before snapshot replacement. Final Save overwrites any stale incremental server tail. Memory remains monotonic and Cairns remain committed by locked product decision.
- **STATUS:** IMPLEMENTED AND TESTED; NATIVE ONLINE FINISH/DETAIL RETEST REQUIRED

## SIM-044

- **AREA:** Live time-scale safety
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN ARCHITECTURAL REQUIREMENT
- **FACT:** Runtime controls appear after Start, so a Simulator Activity begun at `1×` must be able to change to `30×` without future-dating or rewriting prior evidence.
- **DECISION:** Every Simulator Activity reserves the existing 12-hour-plus-safety historical window, including `1×`. Scale changes affect only subsequent clock advancement. Real GPS continues to use wall-clock time and never reads this clock.
- **STATUS:** IMPLEMENTED AND TESTED

## SIM-045

- **AREA:** Backend requirement
- **SEVERITY:** Informational
- **CLASSIFICATION:** PROVEN
- **FACT:** Authoritative final-save replacement, existing segmented payloads, and the deployed authenticated QA telemetry transport already satisfy O37. No schema or backend endpoint change is required.
- **DECISION:** Keep all O37 source changes local for the human OTA. Do not push or deploy backend.
- **STATUS:** NO BACKEND CHANGE

## SIM-046

- **AREA:** Active-provider UI isolation
- **SEVERITY:** High
- **CLASSIFICATION:** PROVEN STATE-MODEL EDGE; LOCALLY FIXED
- **FACT:** The persisted Simulator preference may be enabled while a Real-provider Activity is already active, because continuity locking correctly prohibits switching only an active/unfinished Simulator Activity. Preference state alone must not expose an inert SIM console or joystick over that Real Activity.
- **DECISION:** Idle Debug screens show virtual-origin setup when the preference is enabled. Once Activity state is non-idle, SIM controls are visible only when that Activity's immutable provider is `simulator`. Provider authority, not the preference, owns the runtime UI.
- **STATUS:** IMPLEMENTED AND TESTED

## SIM-047

- **AREA:** O37 native Mapbox authorization
- **SEVERITY:** Critical
- **FACT:** O37 native MapViews mounted, loaded the Standard style, and acquired camera refs, then every Standard source/tile request returned HTTP 401. The named EAS `preview` environment contained the public Mapbox token but initially lacked the API-base and Simulator variables that existed only under `eas.json` build profiles.
- **ROOT CAUSE:** The O37 OTA was bundled without a complete named EAS environment, while `initMapbox` unconditionally replaced native Mapbox configuration with an empty JS value.
- **CHANGE:** Empty/invalid token configuration no longer mutates Mapbox; token presence is emitted only as a boolean. The project `preview` environment now holds the three required non-secret/public OTA inputs and the publish SOP requires `--environment preview`.
- **TEST:** Read-only O37 trace proves 401; EAS environment execution reports token/API/Simulator booleans all true without exposing values; Expo iOS export runs under that exact environment.
- **STATUS:** IMPLEMENTED; O38 NATIVE TILE/FIRST+SECOND ENTRY CONFIRMATION REQUIRED

## SIM-048

- **AREA:** QA telemetry event loss
- **SEVERITY:** Critical
- **FACT:** O37 auto-upload succeeded, but its 523,842-byte row had no start checkpoint, map mount, provider lock, first accepted/committed point, finish, Save, or sync chain. Same-turn asynchronous appends could read one old array and overwrite siblings.
- **ROOT CAUSE:** Per-session appends were not serialized, routine GPS events dominated the byte budget, and too few lifecycle names were reserved from eviction.
- **CHANGE:** Serialize all appends and drain them before flush/upload; sample/coalesce routine events; reserve up to 256 critical transitions while retaining the hard 2,000-event/512-KiB cap; add a distinct `simulator_first_point_committed` event and bounded upload checkpoints.
- **TEST:** Forty same-turn events survive immediate export; noise-bound tests preserve the map/origin/provider/first-point/gap/rollback/Cairn/Save/sync set; privacy and uploader suites pass.
- **STATUS:** IMPLEMENTED; O38 REMOTE TRACE COMPLETENESS CONFIRMATION REQUIRED

## SIM-049

- **AREA:** `debug1` zombie Activity mutations
- **SEVERITY:** Critical
- **FACT:** production deleted the source Activity at 10:02:04 Shanghai time, then created Route 82 at 10:02:19 and updated it at 10:02:20. The Route therefore did not predate deletion.
- **ROOT CAUSE:** mounted Detail and RouteEditor retained geometry/actions after the live Activity disappeared; the route-create API had no source identity and could not serialize create against delete.
- **CHANGE:** Delete invalidates mounted Detail before its first await and resets navigation to Trails. RouteEditor checks the live source, and Activity-derived POSTs include immutable provenance. The backend locks user then source session in the same order as deletion and rejects missing/deleted/unfinalized sources. Existing independently committed Routes are untouched.
- **TEST:** client navigation/source-authority contracts and backend route/delete lock-order/schema contracts pass.
- **STATUS:** IMPLEMENTED; BACKEND DEPLOY REQUIRED

## SIM-050

- **AREA:** Activity Detail Back stack
- **SEVERITY:** High
- **FACT:** conditional `goBack()` could return a post-save Detail to Home or leave that Detail reachable behind Trails, producing Detail → Trails → Detail loops.
- **ROOT CAUSE:** post-save Detail was treated as ordinary navigation history instead of a leaf destination.
- **CHANGE:** Activity Detail Back always resets to the canonical two-entry stack `Home → Routes(initialTab=activities)`; Trails Back therefore returns Home and cannot reopen the saved Detail.
- **TEST:** source contract proves the target-detail handler contains the reset and no `goBack`.
- **STATUS:** IMPLEMENTED; O38 NATIVE STACK CONFIRMATION REQUIRED

## SIM-051

- **AREA:** `hike-08/09/2026` rename
- **SEVERITY:** High
- **FACT:** production session 2052 remains named `Hike — 08/09/2026`; the old Detail action changed only local Zustand/AsyncStorage and made no server request.
- **ROOT CAUSE:** a synced Activity had no server-authoritative rename contract, so the next hydrate restored the old name and the UI had reported false success.
- **CHANGE:** authenticated/validated completed-Activity rename is server-first and rejects nonexistent/deleted rows. Pending-local rename atomically updates both upload payload and summary before the UI projection. Syncing or failed persistence reports truthful failure.
- **TEST:** server schema/route/model contracts, remote rejection/no-local-change, successful server-first rename, and pending-outbox ordering tests pass.
- **STATUS:** IMPLEMENTED; BACKEND DEPLOY AND PRODUCTION SMOKE REQUIRED

## SIM-052

- **AREA:** Per-segment map matching
- **SEVERITY:** High
- **FACT:** O37 supplied the matcher without accuracy/altitude/speed, emitted no matching outcome, and required every segment to succeed before using any derived geometry.
- **ROOT CAUSE:** completion stripped quality metadata and treated all segments as one success switch despite already matching each segment independently.
- **CHANGE:** pass the canonical fields, emit attempt/result/fallback per segment, retain successful matches alongside raw fallback for only failed segments, preserve segment IDs, and keep raw accepted GPS as `route_points_raw` authority.
- **TEST:** contract proves matching precedes Save, fallback stays per segment, Activity Detail reads derived `route_points`, and no cross-gap input is constructed.
- **STATUS:** IMPLEMENTED; O38 FINISH/DETAIL TRACE REQUIRED

## SIM-053

- **AREA:** Walking Auto Move and measured acceleration
- **SEVERITY:** High
- **FACT:** straight-line movement can cross buildings/terrain and is not an acceptable primary walking simulation. Existing engine tests did not explicitly assert the human-reported 30× ten-second distances.
- **ROOT CAUSE:** destination input contained one geodesic target rather than pedestrian geometry; perceived speed lacked a direct generated-distance/accepted-distance contract.
- **CHANGE:** primary `自动前往` resolves Mapbox walking geometry, fails closed with Chinese joystick guidance, and reserves straight-line movement for Advanced QA. Deterministic movement remains physical configured speed on virtual time.
- **TEST:** 5 km/h × 30× × 10 s = 416.7 m and 10 km/h × 30× × 10 s = 833.3 m at generated input; canonical acceptance/visible camera remain native-retained evidence for O38.
- **STATUS:** IMPLEMENTED AND UNIT-VERIFIED; NATIVE PUBLICATION/CAMERA CONFIRMATION REQUIRED

## SIM-054

- **AREA:** O38 backend authority and production rollout
- **SEVERITY:** High
- **FACT:** Synced rename required server authority, and an Activity-derived Route mutation needed a server-side source-existence lock to prevent the proven `debug1` post-delete zombie write. Neither change required a schema modification.
- **ROOT CAUSE:** The prior APIs could neither persist a completed-Activity rename nor distinguish an independently created Route from a Route mutation initiated by a stale Activity Detail.
- **CHANGE:** Backend-only commit `8900028e` adds authenticated validated rename and transactionally serializes source-Activity Route creation against deletion. It was pushed normally and deployed with the canonical script; zero migrations ran. Operations telemetry smoke also reconfirmed auth, retrieval, and privacy behavior.
- **TEST:** 19 backend contracts pass; production checkout/health/schema/ledger/log checks pass; anonymous telemetry and rename probes return 401; smoke session `qa-o38-smoke-1788927556466` is retrievable by ID and timestamp with real coordinates and credential-shaped fields removed.
- **STATUS:** DEPLOYED AND VERIFIED; O38 CLIENT/NATIVE FUNCTIONAL RETEST REQUIRED

## SIM-055

- **AREA:** O38 production Activity realism (`hike-09/09/2026`)
- **SEVERITY:** Gate
- **FACT:** Production session 2053 retains 371 strictly monotonic raw points over 370.441 virtual seconds, one segment, zero gaps, 1 m accuracy, maximum inferred speed 3.756 m/s, 762.319 m raw same-segment distance, 368 s duration, and 22.861 m positive elevation. Raw-distance recomputation matches the stored metric. Forty-three ordinary Memory points were committed along the accepted path.
- **ROOT CAUSE:** No Activity-data defect found. The deterministic Simulator callback cadence is more regular than historical real Hikes 192/193, but every sample satisfies the same canonical acceptance and durable business contract.
- **CHANGE:** No Simulator movement or matching correction. Preserve O38 architecture and add only a deterministic accelerated-parity contract.
- **TEST:** Production SELECT-only raw/display/Memory aggregation plus source tests and 1x-versus-120x engine comparison.
- **STATUS:** REALISTIC ACTIVITY DATA — PASS

## SIM-056

- **AREA:** O38 telemetry automatic upload and sufficiency
- **SEVERITY:** High
- **FACT:** QA session `qa-mttg439c-ccqp1eyj` automatically reached yiiling in repeated HTTP 200 batches and retains 833 events / 524,245 bytes. It reconstructs virtual origin, provider lock, first generated/accepted/committed point, movement/rejection, Memory/metrics, Finish, matching, Save, server-synced acknowledgement, completion, and origin clear for session 2053.
- **ROOT CAUSE:** No critical-event loss occurred after O38 reservation/coalescing. Map idle remains noisy (542 retained events), leaving only 43 bytes under the hard cap, but critical reconstruction survived and product correctness is unaffected.
- **CHANGE:** Reserve the single fresh-entry reset event as critical. Do not expand bounds or reopen the working uploader.
- **TEST:** Operations retrieval by `qaSessionId`, DB event/count/size comparison, upload checkpoints, and nginx 20-second authenticated POST cadence.
- **STATUS:** QA TELEMETRY SUFFICIENT FOR NATIVE FORENSICS

## SIM-057

- **AREA:** Fresh Simulator origin setup
- **SEVERITY:** Medium
- **FACT:** Completion/discard clears origin, but fresh Hike/Run focus had no independent reconciliation of stale persisted setup against the durable unfinished-Activity registry.
- **ROOT CAUSE:** Screen focus relied on previous lifecycle teardown and the optional manual Reset action; `status=idle` alone cannot distinguish a new Activity from a not-yet-restored unfinished Activity.
- **CHANGE:** Both Hike and Run invoke one registry-aware fresh-entry initializer. It clears all pre-start/runtime virtual state when no owner exists, preserves enabled/QA identity/map lifecycle, rechecks live ownership after storage I/O, and fails closed for an unfinished or unreadable registry.
- **TEST:** stale origin/destination/Lost/120x state resets; an exact unfinished Simulator state and registry uncertainty are preserved; both screen sources use the guard.
- **STATUS:** IMPLEMENTED AND AUTOMATED; O39 NATIVE RE-ENTRY CONFIRMATION REQUIRED

## SIM-058

- **AREA:** Fast realistic Debug replay
- **SEVERITY:** High
- **FACT:** Existing 30x already subdivides movement into three ordered ten-virtual-second canonical samples per ordinary wall tick while retaining configured physical speed. Naively exposing 120x with the former five-second delayed-tick allowance could serialize 60 samples in one UI turn.
- **ROOT CAUSE:** The clock had a wall-delay cap but no scale-independent virtual-advance/sample-count cap.
- **CHANGE:** Add 60x/120x while capping every tick to 120 virtual seconds / 12 canonical samples. Every sample retains monotonic historical time and traverses the unchanged acceptance/journal/metrics/Memory path. Suspended wall backlog beyond the cap is dropped rather than teleported.
- **TEST:** 5 km/h at 1x for 120 wall seconds and 120x for one wall second end within 0.1 m with equivalent 120 s Activity duration, distance, pace basis, elevation, segment, physical-speed metadata, and endpoint. A five-second delayed 120x tick still emits exactly 12 intermediate samples and 166.7 m, never 60 samples or a teleport.
- **STATUS:** IMPLEMENTED AND AUTOMATED; 120x IS THE MAXIMUM NORMAL QA OPTION FOR O39 NATIVE PROFILING

## SIM-059

- **AREA:** O40 Simulator Poor/Lost/Frozen semantics and status truth
- **SEVERITY:** High
- **FACT:** O39 `case01` advanced the hidden position and emitted 41 Poor samples, but every sample used 60m accuracy and therefore failed the shared 25m production gate. Lost emitted no samples; Frozen emitted a fixed coordinate. Direct Lost/Frozen recovery did not own the same segment handoff as manual relocation, and the real-freshness status remained green during short Debug state changes.
- **ROOT CAUSE:** Poor generated only categorically unusable evidence; known-loss recovery was coupled to one UI action; the status surface had no Simulator-state authority.
- **CHANGE:** Poor emits a deterministic accepted/rejected degraded mix through the unchanged canonical filter. Every Lost/Frozen recovery starts a fresh durable Activity segment and retains its boundary marker until an accepted point. Hike/Run show explicit Simulator Normal/Poor/Lost/Frozen state while real GPS retains O40 freshness semantics.
- **TEST:** Engine/provider/store tests cover hidden movement, mixed Poor outcomes, Lost no-emission, Frozen fixed callbacks, repeated recovery, initially rejected Poor recovery, and status-source contracts.
- **STATUS:** IMPLEMENTED AND AUTOMATED; O41 NATIVE STATE CONFIRMATION REQUIRED

## SIM-060

- **AREA:** O40 Fast Replay discoverability
- **SEVERITY:** High
- **FACT:** source already contained 60x/120x and bounded intermediate samples, but the collapsed native control displayed only `SIM`; the newest O40 checkpoint remained at 1x and contained no scale-selection event.
- **ROOT CAUSE:** current multiplier and replay affordance were hidden behind an unlabeled collapsed runtime surface. Native engine regression was not evidenced.
- **CHANGE:** the collapsed chip displays `SIM · <scale>x` and the normal runtime panel exposes 1x/5x/10x/30x/60x/120x without Advanced QA.
- **TEST:** 5km/h 1x/120x parity preserves physical distance/time/pace/segment/endpoints and all intermediate points; 390x844 Expo-Web QA visibly exposes all six controls with zero runtime errors.
- **STATUS:** IMPLEMENTED AND AUTOMATED; O41 NATIVE DISCOVERABILITY CONFIRMATION REQUIRED

## SIM-061

- **AREA:** O40 Simulator joystick S/SE jitter
- **SEVERITY:** High
- **FACT:** the octant bearing math is monotonic, but the responder consumed local coordinates while its animated knob and labels remained hit-testable. O40 telemetry lacked move vectors, so it cannot prove this was the only native contributor.
- **ROOT CAUSE:** PROVEN coordinate-contract defect: the supposedly fixed input surface did not exclusively own pointer targeting. Exclusive attribution of the human-observed shake remains INCONCLUSIVE until O41 vector telemetry.
- **CHANGE:** a fixed `box-only` surface owns all joystick events; one pure center-relative function owns magnitude/bearing; bounded touch vector and requested/actual displacement telemetry was added.
- **TEST:** N/NE/E/SE/S/SW/W/NW and twenty sustained inputs per direction retain constant bearing/magnitude.
- **STATUS:** IMPLEMENTED AND AUTOMATED; S/SE NATIVE FIRST-DIVERGENCE CONFIRMATION REQUIRED

## SIM-062

- **AREA:** Activity Save blocking latency
- **SEVERITY:** High
- **FACT:** O39 `case01` matching took about 1.194s, but the client reached its 20.199s server wait bound. Production logs showed spatial Memory attribution running about 84.4s inside the Save transaction and causing a concurrent Memory upload lock timeout.
- **ROOT CAUSE:** derived H3 region projection was incorrectly part of the source-data commit/acknowledgement critical path.
- **CHANGE:** commit session/raw/display/Memory evidence first, then schedule derived attribution in a coalescing per-user post-commit queue with a reset fence. Add client phase timings from Finish through server acknowledgement persistence.
- **TEST:** 17 backend contracts pass for atomic source durability, non-blocking projection, coalescing, and reset fencing. Scoped commit `f5d0127c` is deployed; production backend/DB health and restart counts are clean.
- **STATUS:** PROVEN BLOCKER REMOVED AND DEPLOYED; O41 NATIVE WALL-CLOCK MEASUREMENT REQUIRED

## SIM-063

- **AREA:** Map matching truth gate and zoomed-out gap styling
- **SEVERITY:** Medium
- **FACT:** Activity 2057 segment 1 moved derived geometry about 20m at p95 and 25.4m maximum from nominal 5m accepted evidence; case00 baseline was 1.8m/2.8m. Matching had only a 0.3 confidence floor. Gap data was correctly segmented, but used a constant screen-space line style at every zoom.
- **ROOT CAUSE:** matched output had no accuracy-bounded geometric plausibility gate; gap presentation did not adapt to summary zoom.
- **CHANGE:** record confidence/deviation/endpoint/length metrics and fall back per segment to raw accepted geometry outside a bounded quality envelope. Keep gap data intact and interpolate only line width/opacity by zoom.
- **TEST:** near-raw baseline is accepted, observed nearby-path-shaped displacement is rejected, segment-local fallback passes, and Activity/Map History contracts retain raw authority and explicit gaps.
- **STATUS:** IMPLEMENTED AND AUTOMATED; O41 NATIVE VISUAL CONFIRMATION REQUIRED

## SIM-064

- **AREA:** Memory bridge across segment and Activity boundaries
- **SEVERITY:** Critical
- **FACT:** production showed Russia-to-New-Zealand and New-Zealand-to-Shanghai cross-Activity discontinuities plus a 154.5m same-Activity gap. `memory_points` contained only actual endpoints; the client reconstructed all close-in-time rows as one LineString and buffered the invented connector.
- **ROOT CAUSE:** flat Memory evidence has no Activity/segment identity, yet rendering inferred traversal continuity from row order and time alone.
- **CHANGE:** render only 30m bounded footprints around persisted Memory evidence. Overlapping observations form corridors naturally; no line is synthesized between disconnected rows. Empty state also invalidates module/instance fog caches.
- **TEST:** same-segment overlap, one/two gaps, fresh Activity, cache reset, and monotonic rollback contracts pass. No Activity writer/calculation or real/Simulator split was introduced.
- **STATUS:** IMPLEMENTED AND AUTOMATED; O41 CLEAN-BASELINE NATIVE CONFIRMATION REQUIRED

## SIM-065

- **AREA:** Home Memory authority and authorized account reset
- **SEVERITY:** High
- **FACT:** Home consumed the shared local store, but full server reconciliation was mounted only by MemoryScreen. Exact user 72 held 115 Memory rows, 6 derived regions, and about 0.062215km2; opening Memory was therefore the initialization side effect.
- **ROOT CAUSE:** account Memory reconciliation was screen-owned, and empty/reset rendering could reuse stale module fog geometry.
- **CHANGE:** authenticated app initialization now hydrates local Memory, attaches sync, and launches bounded server reconciliation independent of screen lifecycle. Empty authoritative results discard only synced stale cache; genuine offline-unsynced evidence is preserved. The reset path fences server projection/pending client work and clears fog caches.
- **TEST:** cold direct-Home initialization, offline cache, server-empty reconcile, unsynced preservation, reset invalidation, and later shared-store publication pass. Authorized production cleanup deleted only 115 `memory_points` and 6 `unlocked_regions`; 6 Activities and all Cairn/Route counts were preserved, and repeated checks remained zero.
- **STATUS:** IMPLEMENTED, PRODUCTION MEMORY RESET, AND AUTOMATED; O41 COLD-LAUNCH DEVICE CONFIRMATION REQUIRED
