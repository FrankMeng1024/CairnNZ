# Tracking convergence implementation

Date: 2026-09-11 (Asia/Shanghai)

Candidate: **O46**

Readiness: **READY FOR NATIVE VALIDATION**

This is a coordinated client implementation of
`TRACKING_CONVERGENCE_PLAN.md`. It does not claim that iOS delivery,
lock-screen execution, battery cost, or native Mapbox animation has been
certified by deterministic tests.

## A. Implementation summary

### Movement authority

- `realGpsContinuity.ts` is now the sole real-GPS movement authority in both
  foreground and headless background paths. The later store mutation retains
  ownership, ordering, journal, segment, metric, Memory, and Simulator gates,
  but no longer applies a second real-GPS stationary/indoor verdict.
- Movement checkpoint version 2 retains at most six eligible raw observations
  from eight seconds and at most three Candidate observations. A v1 checkpoint
  reconstructs from journaled canonical history and discards its incompatible
  uncommitted Candidate. An O45 rollback ignores v2 and reconstructs from the
  same durable tail, so no server migration is required.
- The unchanged 25 m canonical accuracy gate and the accuracy-adjusted
  impossible-speed gate run before traversal acceptance. Rejected evidence
  advances only raw ordering, never the trusted traversal anchor.

### Stationary and Candidate

- Reported `CLLocation.speed` is supporting evidence, not a stationary
  verdict. Bounded cumulative/net progression can establish movement despite
  a contradictory low scalar.
- A rolling median-centred cluster distinguishes local orbiting from sustained
  translation. Stationary observations may update an ephemeral
  `positionEstimate`, but the new `REFINE` decision creates no canonical edge,
  distance, elevation, live trace, journal point, or Memory traversal.
- Candidate is exceptional and bounded. Confirmation uses ordered cumulative
  progression, not a fixed two-metre next step. It resolves as soon as enough
  evidence exists, after at most three observations/five seconds, or expires
  without manufacturing truth.
- No global heading prior exists. U-turns, repeated geography, deliberate Zs,
  switchbacks, circles, diagonal/off-road movement, and backtracking are judged
  only by local physical/evidence plausibility.

### Cadence

- Ordinary real foreground Activity now uses `BestForNavigation` with
  `distanceInterval=1 m`; this does not depend on Debug Mode.
- Internal Debug retains the explicit 5 m baseline for diagnosis. Background
  remains 5 m. The iOS watcher still ignores Android-only `timeInterval`
  metadata when deciding whether a restart is necessary.

### Presentation

- Hike and Run share the map implementation. Confirmed segment history is
  static; only the newest confirmed head is animated over 900 ms with the
  installed RNMapbox animated ShapeSource primitive.
- A new target interrupts from the animation's current value and retargets,
  rather than rewinding. The mutable presentation tail is bounded to eight
  targets and never grows with Activity history.
- Segment changes remount the head and never animate a gap connector.
  Simulator remains on its frozen static path. Reduce Motion uses immediate
  confirmed geometry.
- Internal QA records only animation target, interruption, completion, and
  bounded-reset checkpoints. It records counts/timing, never coordinates or
  frames.

### Lifecycle, permission, and health

- The existing O45 fixes remain: transient iOS `inactive` is held, foreground
  takeover is ownership/event-driven rather than a fixed two-second sleep,
  and a no-op iOS nominal interval change does not restart the watcher.
- Native background permission is authoritative. `educationSeen` controls only
  repeated explanatory copy; it cannot suppress an otherwise eligible OS
  permission evaluation/request. Grant, `canAskAgain`, request result, and
  Settings requirement remain distinct and instrumented.
- Source freshness and canonical-route freshness are separate internal states.
  Real Hike/Run green requires fresh source and fresh canonical evidence;
  fresh source plus a Candidate/rejection becomes amber, while source silence
  becomes lost. A fresh stationary refinement is not falsely shown as route
  loss. Simulator Normal/Poor/Lost/Frozen semantics are unchanged.

## B. Historical CC

The useful idea from `95302b8` was modernized: truth and calm display geometry
are separate. The old whole-history Kalman, scalar-speed authority, large
deadband, endpoint displacement, corner cutting, discarded raw evidence,
Save-dependent Memory, and permissive ownership did not return. The physical
plausibility intent from `d7ea3b0` and background survivability intent from
`738286b` survive behind modern journal, gap, generation, and recovery
contracts.

## C. Incident results

| Incident/contract | Result |
|---|---|
| Normal 1 m coherent movement | **PASS** deterministic; native cadence recheck required |
| False reported-speed backtrack | **PASS** |
| U-turn | **PASS** |
| Repeated route / same segment x3 | **PASS** canonical and matching regression |
| Deliberate Z corridor | **PASS** |
| Switchback/circle/diagonal/off-road | **PASS** |
| Slow cumulative progression | **PASS** |
| Stop/start | **PASS** within three eligible fixes |
| Stationary spaghetti | **PASS**; bounded <=5 m fixture target |
| Teleport/lateral spike | **PASS** |
| Gap/reacquisition | **PASS**; zero connector truth |
| Memory | **PASS**; canonical only, no gap/stationary/render input |
| Presentation phase/immutable body | **PASS** structural/pure tests; native visual validation required |
| Lifecycle ownership/inactive | **PASS** |
| Background permission state | **PASS** deterministic; actual Always/lock test required |
| Recovery/checkpoint | **PASS** v1/v2 and durable-tail compatibility |
| Matching | **PASS**; a newly exposed repeated-path apex collapse was fixed |

## D. Master issue ledger

The status vocabulary is the requested final implementation vocabulary. “Native
validation required” means the client work is present and deterministic
contracts pass; it does not claim iOS certification.

| # | Issue | Final status | Implementation/result |
|---:|---|---|---|
| 1 | 5 m source cadence | FIXED | Normal foreground selects 1 m; Debug keeps 5 m control. |
| 2 | 1 m source cadence | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Proven native short-walk candidate; battery/soak outstanding. |
| 3 | RNMapbox/Cairn dual providers | INTENTIONALLY DEFERRED | At 1 m this was not the dominant failure; comparison telemetry retained. |
| 4 | One Cairn-owned raw source | INTENTIONALLY DEFERRED | Map remains presentation-only; no native rewrite. |
| 5 | Expo limitations | NOT APPLICABLE | Expo produced proven 1/2 s cadence; no replacement justified. |
| 6 | Native CLLocation arrays | INTENTIONALLY DEFERRED | No proved foreground batch loss; background still iterates its batch. |
| 7 | Reported-speed over-trust | FIXED | Scalar speed downgraded to fallible evidence. |
| 8 | U-turn | FIXED | No direction penalty; regression passes. |
| 9 | Backtracking | FIXED | False-low-speed 1 m return remains canonical. |
| 10 | Repeated traversal | FIXED | Same corridor x3 is preserved. |
| 11 | Intentional Z corridor | FIXED | Local physical transitions survive. |
| 12 | Switchbacks | FIXED | Alternating turns survive; display body stays stable. |
| 13 | Diagonal road crossing | PRESERVED + REGRESSION PASS | No map/heading-shape authority. |
| 14 | Off-road/grass/plaza/unmapped | PRESERVED + REGRESSION PASS | Canonical truth remains topology-independent. |
| 15 | Slow coherent movement | FIXED | Cumulative short-step progression confirms. |
| 16 | Stop to start | FIXED | Cluster escape resolves within bounded evidence. |
| 17 | Direction coherence | FIXED | Candidate-local signal only; no forward prior. |
| 18 | Candidate confirmation | FIXED | Ordered cumulative corroboration replaces fixed next-step proof. |
| 19 | Candidate timeout | FIXED | Observation budget resolves first; timeout only discards uncertainty. |
| 20 | Stationary V/Z/spaghetti | FIXED | Cluster/refinement has no traversal output. |
| 21 | True-1 m stationary false movement | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Deterministic false-distance bound passes; real stand required. |
| 22 | Stationary cluster model | FIXED | Bounded cluster/net/path/direction features implemented. |
| 23 | Position refinement vs traversal | FIXED | Explicit `REFINE` and ephemeral estimate. |
| 24 | Impossible teleport/river jump | PRESERVED + REGRESSION PASS | Accuracy-adjusted hard physical gate retained. |
| 25 | Drift V vs real out-and-back | FIXED | Isolated spike rejected; ordered plausible return accepted. |
| 26 | 25 m gate before Candidate | PRESERVED + REGRESSION PASS | Gate unchanged; source/canonical health now distinguishes the consequence. |
| 27 | Trusted position != trusted transition | PRESERVED + REGRESSION PASS | Explicit in state, Candidate, and gap paths. |
| 28 | Gap creation | PRESERVED + REGRESSION PASS | New segment; zero connector metrics/Memory/matching. |
| 29 | Chunky live line | IMPLEMENTED, NATIVE VALIDATION REQUIRED | 900 ms confirmed-head animation added. |
| 30 | Line ahead of puck | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Compatible temporal phase added; native pixels remain unproved. |
| 31 | Puck/line phase alignment | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Retargetable line clock plus timing telemetry. |
| 32 | Renderer-only endpoint interpolation | FIXED | Tiny animated head; canonical arrays untouched. |
| 33 | Historical CC smoothing idea | FIXED | Truth/display separation modernized. |
| 34 | Whole-history Kalman | NOT APPLICABLE | Explicitly rejected; old confirmed body cannot move. |
| 35 | Mutable confirmed display tail | FIXED | Only bounded active head is mutable. |
| 36 | Provisional unconfirmed tail | INTENTIONALLY DEFERRED | Not needed for Normal 1 m; no raw/puck truth leakage. |
| 37 | Live strong road snap | PRESERVED + REGRESSION PASS | Excluded; off-road truth survives. |
| 38 | Green GPS during canonical stall | FIXED | Green now requires fresh source and canonical evidence. |
| 39 | Finding semantics | FIXED | Awaiting, uncertain, weak/lost, and permission states separate. |
| 40 | Poor/Lost/Frozen distinctions | PRESERVED + REGRESSION PASS | Real mapping improved; Simulator semantics frozen. |
| 41 | iOS Android-only `timeInterval` | PRESERVED + REGRESSION PASS | No iOS restart for nominal timing-only change. |
| 42 | Transient AppState inactive | PRESERVED + REGRESSION PASS | No false handoff or gap. |
| 43 | Two-second foreground takeover | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Ownership-completion fast path preserved; lock return required. |
| 44 | Background education flag | FIXED | Education no longer acts as permission authority. |
| 45 | Background permission state machine | PRESERVED + REGRESSION PASS | Grant/canAsk/request/Settings states distinct. |
| 46 | Background TaskManager | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Existing plumbing uses v2 authority; no redesign. |
| 47 | UIBackgroundModes/native capability | PRESERVED + REGRESSION PASS | No native configuration change. |
| 48 | Lock-screen continuity | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Authorization flow repaired; OS delivery still physical. |
| 49 | Foreground/background ownership | PRESERVED + REGRESSION PASS | One serialized generation-fenced owner. |
| 50 | Stale-generation callbacks | PRESERVED + REGRESSION PASS | Rejected before Activity truth. |
| 51 | Raw forensic retention | PRESERVED + REGRESSION PASS | Reject/QUARANTINE/REFINE remain raw evidence. |
| 52 | Journal durability | PRESERVED + REGRESSION PASS | Canonical journal precedes publication. |
| 53 | Crash/restart recovery | FIXED | v1/v2 checkpoint and canonical-tail fallback pass. |
| 54 | Atomic finish | PRESERVED + REGRESSION PASS | Finish authority unchanged. |
| 55 | Pending sync | PRESERVED + REGRESSION PASS | Local completion/client identity unchanged. |
| 56 | Local canonical vs server display | PRESERVED + REGRESSION PASS | Different authorities remain intentional; common fallback contract intact. |
| 57 | One unfinished Activity | PRESERVED + REGRESSION PASS | Registry/start authority unchanged. |
| 58 | Incremental Memory | PRESERVED + REGRESSION PASS | Only promoted canonical points write evidence. |
| 59 | No Memory across Gap | PRESERVED + REGRESSION PASS | Segment reset remains absolute. |
| 60 | No provisional/render Memory | PRESERVED + REGRESSION PASS | Animation is map-local. |
| 61 | Stationary false Memory | FIXED | `REFINE`/Candidate create no Memory traversal. |
| 62 | Memory display smoothing | PRESERVED + REGRESSION PASS | Existing clipped derivative unchanged. |
| 63 | Per-segment final matching | PRESERVED + REGRESSION PASS | No gap matching. |
| 64 | Raw retained under matching | PRESERVED + REGRESSION PASS | Derived geometry does not replace evidence. |
| 65 | Endpoint protection | PRESERVED + REGRESSION PASS | Existing head/tail quality gates pass. |
| 66 | Matching quality gate | PRESERVED + REGRESSION PASS | Confidence/deviation/length/coverage fallbacks pass. |
| 67 | Live/final consistency | PRESERVED + REGRESSION PASS | Matched-or-canonical contract unchanged. |
| 68 | Repeated-path final topology | FIXED | Sharp repeated apex is preserved; collapse regression passes. |
| 69 | False elevation gain | IMPLEMENTED, NATIVE VALIDATION REQUIRED | Existing independent reducer passes; flat/hill test remains. |
| 70 | Vertical-quality pipeline | PRESERVED + REGRESSION PASS | No horizontal=vertical authority regression. |
| 71 | Apple Watch authority | PRESERVED + REGRESSION PASS | iPhone remains sole Activity truth. |
| 72 | Watch workout integration | INTENTIONALLY DEFERRED | Separate product capability. |
| 73 | PDR/IMU | INTENTIONALLY DEFERRED | Normal 1 m evidence does not justify it. |
| 74 | 1 m battery cost | IMPLEMENTED, NATIVE VALIDATION REQUIRED | 10k CPU bound passes; one-hour battery test outstanding. |
| 75 | Long-duration Hike | IMPLEMENTED, NATIVE VALIDATION REQUIRED | State is bounded; physical one-hour/2–3-hour soaks outstanding. |
| 76 | Memory/CPU/render load | FIXED | Reducer window <=6, Candidate <=3, animated tail <=8. |
| 77 | Incident regression coverage | FIXED | Named privacy-safe movement/stationary/lifecycle/matching matrix added. |
| 78 | Avoid test overfitting | PRESERVED + REGRESSION PASS | Behavioral incidents preferred; structural guards remain classified. |
| 79 | Impact-based verification | PRESERVED + REGRESSION PASS | New tests are routed by the maintained impact map. |
| 80 | Native evidence loop | PRESERVED + REGRESSION PASS | O46 deliberately stops at native validation. |

## E. Verification

Commands and results:

```text
cd app
npx jest --runInBand <focused convergence paths>
  PASS 112/112

npm run verify:activity:gps
  PASS 269/269

npm run verify:activity:core
  Activity-related suites PASS; 337/344 overall

npm run verify:changed
  Same classified result; 337/344 overall

npx jest --runInBand --runTestsByPath \
  src/features/activity/__tests__/confirmedRoutePresentation.test.ts \
  src/features/activity/__tests__/freeActivityIntegrationContracts.test.ts
  PASS 47/47 after final presentation lifecycle/telemetry integration

npx tsc --noEmit | filter-to-touched-modules
  no touched-module diagnostics

npx expo export --platform web --output-dir /tmp/cairn-o46-web-final3-20260911
  PASS; 3,822 modules bundled

CAIRN_QA_URL=http://127.0.0.1:8093 \
  CAIRN_QA_ARTIFACT_DIR=/tmp/cairn-o46-activity-ui-qa \
  node scripts/hike-run-ui-qa.mjs
  PASS 25/25 mobile layouts; no runtime errors
```

The Core and changed routers have one known unrelated failure suite:
`__tests__/v409-offlineQueue.test.ts`, 7 failures because the test imports
`readQueueSnapshot`/`clearQueue` that the current module does not export. It
was present before this implementation, was explicitly excluded from scope,
and was not retried or changed. The remaining 32 suites/337 tests passed.
Jest also prints the pre-existing `setupFilesAfterFramework` configuration
warning and an open-handle warning after store suites; neither caused a test
failure and neither was changed here.

## F. Performance

The deterministic 10,000-observation reducer loop completed in approximately
3.0 seconds under Jest on this workstation (about 0.30 ms/observation). The
focused Jest process reported approximately 40.9 MB peak memory footprint
(process maximum resident set included the Jest runtime at about 262 MB in the
isolated measurement). Retained reducer state never exceeded six recent raw
observations or three Candidate observations; presentation targets are capped
at eight. There are no per-frame Zustand, journal, Memory, telemetry, or server
writes. This is a CPU/boundedness check, not a native battery result.

## G. Changed files

Convergence product files:

- `app/src/features/activity/realGpsContinuity.ts`
- `app/src/features/activity/activityLocationHealth.ts`
- `app/src/features/activity/confirmedRoutePresentation.ts`
- `app/src/features/activity/locationCadenceExperiment.ts`
- `app/src/store/useTrackingStore.ts`
- `app/src/store/useSettingsStore.ts` (authority comment only)
- `app/src/services/backgroundLocationTask.ts`
- `app/src/services/routing/snapTrack.ts`
- `app/src/screens/HikingMap.tsx`
- `app/src/screens/HikingScreen.tsx`
- `app/src/screens/RunningScreen.tsx`
- `app/src/components/OtaBadge.tsx`

Convergence test/router files:

- `app/src/features/activity/__tests__/realGpsContinuity.test.ts`
- `app/src/features/activity/__tests__/activityLocationHealth.test.ts`
- `app/src/features/activity/__tests__/confirmedRoutePresentation.test.ts`
- `app/src/features/activity/__tests__/locationCadenceExperiment.test.ts`
- `app/src/features/activity/__tests__/freeActivityIntegrationContracts.test.ts`
- `app/__tests__/useTrackingStore.test.ts`
- `app/src/services/__tests__/backgroundLocationTaskOwnership.test.ts`
- `app/src/services/routing/__tests__/snapTrack.test.ts`
- `app/scripts/activity-verification-map.json`
- `docs/operations/ACTIVITY_VERIFICATION.md`

O45 lifecycle/permission files already present in the preserved working tree
and carried into this candidate are `backgroundAuthorization.ts`,
`activityLocationLifecycle.ts`, their tests, and the existing telemetry/debug
modules. No task change was made to backend, database, native configuration,
Memory persistence, Simulator engine, or Watch authority. The repository had
other pre-existing uncommitted work; it was neither cleaned nor overwritten.

## H. Rollback

- **Movement reducer:** restore the v1 reducer/store integration. An old bundle
  ignores the v2 checkpoint and reconstructs the trusted tail from journaled
  canonical points; any uncommitted Candidate is discarded. Raw/canonical
  data and server schemas require no rollback.
- **Foreground cadence:** restore the normal selector to 5 m independently.
  No persisted format changes.
- **Visual head:** remove/disable `ConfirmedRouteHead`; the existing static
  confirmed segment GeoJSON remains valid.
- **Health UI:** revert the source/canonical presentation mapping independently;
  tracking truth is unaffected.
- **Lifecycle/permission:** keep the O45 fixes when rolling back other phases.
  They correct independently proven no-op restart, inactive, takeover, and
  permission-flow defects.

No destructive Git operation, force push, OTA publish, backend deploy, native
build, or database mutation occurred.

## I. Native validation still required

### Test 1 — geometry and visual feel (8–10 minutes, screen on)

Start a real Hike named `O46 geometry`. Stand 45 s; walk straight 60 s; turn
90 degrees; make a normal 180-degree U-turn; traverse the same safe 20 m
section three times; walk a deliberate Z; walk slowly 30 s; stand 60 s; resume
walking 30 s; Finish/Save. Note only approximate phase times and whether the
line feels attached to the puck, hesitates, forms stationary V/Z geometry, or
moves old history.

### Test 2 — lifecycle and background (8–10 minutes)

Start `O46 lifecycle` in open sky; pass through a safe covered stretch; lock
the screen and walk 3–5 minutes; unlock; briefly open/close Notification
Center; continue; Save; reopen Detail. Do not force-quit. If iOS reports that
Always permission needs Settings, grant it there once, then perform the test.

Return only Activity names, `qaSessionId`s, approximate phase times, and a
brief visual/background observation. Telemetry should answer the processing
questions. After these pass, perform the separate one-hour battery/load test;
the 2–3-hour soak is a later broad-release gate, not the first validation.

## J. Readiness and delivery

**READY FOR NATIVE VALIDATION.**

- Marker: **O46**, incremented once from O45.
- App/runtime: **0.2.6**, runtime policy `appVersion`, unchanged.
- Native build: unchanged Internal/preview shell; no install required if the
  tester already has the O43–O45-capable Internal shell.
- Git HEAD / `origin/master`: `4fb85bc3173aff11fd4ff7b34ce7feefc561d9cc`
  / same, with preserved uncommitted work.
- OTA published: **NO**. The human owns publication.
- Backend/database: no task changes and no deploy.

Before publishing, run the privacy-safe preview environment preflight in
`docs/review/activity-simulator/QA_TELEMETRY.md`. The human-owned OTA command is:

```sh
cd app
npx eas update --branch production --platform ios --environment preview \
  --message "O46: tracking convergence native-validation candidate"
```
