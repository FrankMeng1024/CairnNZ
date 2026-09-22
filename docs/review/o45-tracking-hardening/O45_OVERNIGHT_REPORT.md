# O45 overnight tracking hardening

Date: 2026-09-11 (Asia/Shanghai)

Status: **morning native A/B candidate ready; native cadence and lock-screen evidence still pending**.

The requested `CairnNZ_Project_Authority.md` is not present in this checkout. The current O38–O44 review artifacts, production source at `4fb85bc`, historical commits, and executable Activity contracts were therefore used as repository authority. This work does not change the O44 experiment: an Internal build in Debug Mode can select 5 m or 1 m, and the foreground Expo distance filter remains the only difference between the two variants.

## Fixed common behavior

### Stationary traversal

The pre-rewrite filter in `d7ea3b0` correctly distinguished raw observations from walked transitions and suppressed low-speed drift inside an accuracy-aware radius. `738286b` later added a broad indoor/airport deadband. The large Activity rewrite replaced those rules with a stronger physical-continuity reducer, but its generic 2–4 m stationary suppression admitted low-speed 5–10 m V/Z excursions as canonical movement.

O45 reuses the sound old principle but not the old unconditional deadband. A 4–15 m low-reported-speed displacement becomes a short Candidate. One corroborating fix either:

- rejects a reversal/detour/cluster without moving the trusted anchor; or
- confirms coherent continued slow progression in timestamp order.

Raw observations remain in the forensic stream. Rejected stationary candidates affect neither canonical route, distance, live geometry, Memory, nor elevation. The fixture `STATIONARY_GPS_JITTER_SPAGHETTI` proves a real-style V/Z cluster produces nine raw observations, three canonical approach points, approximately 10 m—not a wool-ball—of Activity distance, three Memory evidence calls, and no accepted stationary traversal. Existing diagonal-turn, real-turn, and impossible-motion fixtures remain green.

Classification: **PRIOR IDEA IMPROVED; PRIOR FIX REGRESSED — FIXED**.

### iOS watcher identity

Sprint 72 dynamic sampling intentionally changes nominal 3,000/2,000 ms timing metadata. Installed Expo Location applies `timeInterval` on Android, not iOS. Current code nevertheless restarted the iOS foreground watcher when only that no-op value changed.

O45 keeps Android restart behavior. On iOS it updates telemetry metadata without tearing down/recreating the unchanged BestForNavigation watcher. `IOS_NOOP_INTERVAL_PROVIDER_RESTART` proves watcher identity remains stable.

Classification: **PRIOR DYNAMIC-SAMPLING IDEA PRESERVED; IOS NO-OP RESTART FIXED**.

### AppState and foreground ownership

The historical two-second active debounce protected clustered AppState callbacks from repeated provider restarts. It also treated transient iOS `inactive` as background and imposed a fixed foreground hole when no background provider existed.

O45 retains the serialization, stop acknowledgement, pending-write drain, native ownership check, and generation fence. Real GPS lifecycle changes are now coalesced by current AppState plus actual provider ownership:

- `inactive` holds the current owner and opens no gap;
- repeated `active` with an existing foreground watcher is a no-op;
- confirmed `background` performs the fenced background handoff;
- confirmed `active` performs foreground takeover immediately through the serialized ownership boundary, without an arbitrary two-second sleep;
- Simulator retains its frozen debounce behavior.

The transition still asks the native module whether a background task is actually running before foreground activation, so process-restored ownership cannot create two simultaneous real providers.

Classification: **PRIOR CHURN PROTECTION IMPROVED; TRANSIENT INACTIVE FALSE GAP FIXED; TWO-SECOND REAL TAKEOVER HOLE FIXED**.

### Background permission authority

O43 recorded `foreground-only`, `canAskAgain=true`, `educationSeen=true`, and no native background request. The Start path used the one-time education flag as permission authority.

O45 separates the facts. Each real Activity Start reads current foreground/background OS permission. If background is absent and the OS says it can ask, the flow attempts the native request once for that Start regardless of whether education was seen. The education flag controls only explanatory copy. Refreshes during lifecycle handoff are read-only and cannot prompt. A failed attempt or `canAskAgain=false` is classified as Settings-required; the existing Hike/Run warning links to Settings.

Telemetry now records foreground permission, background state, `canAskAgain`, `educationSeen`, `requestAttempted`, `requestResult`, and `settingsRequired`. Existing Info.plist authority already contains the Always description and `UIBackgroundModes=location`; TaskManager is defined at module load and starts BestForNavigation/5 m/Fitness with automatic pausing disabled.

Classification: **PRIOR FIX REGRESSED — FIXED in the OTA-capable product flow; physical Always/lock-screen delivery remains native evidence**.

### Source health versus canonical health

The user-visible badge historically derives from accepted-point freshness, so it cannot prove that Core Location stopped. O45 does not redesign that UI during the controlled experiment. It adds separate privacy-safe telemetry facts:

- source health: provider ownership and latest raw-source age;
- canonical health: latest accepted age;
- degradation reason: Candidate, accuracy rejection, continuity rejection, source stale, or lifecycle gap.

Classification: **DIAGNOSTIC CONFLATION FIXED; VISUAL POLICY DEFERRED**.

## Investigations with no product change

### Expo native arrays

Installed Expo iOS `watchPositionImplAsync` receives `[CLLocation]` and exports only `locations.last` to its foreground JS callback. Its TaskManager background consumer exports every member; Cairn's headless handler iterates every member and records batch size/index/sequence. Current real evidence does not prove that foreground arrays contain lost traversable members, so no Expo fork or synthetic recovery was added. Status: **SEPARATE FOLLOW-UP** pending native batch evidence.

### Local canonical count versus server display count

The O43 75-versus-41 observation was taken from an unfinished server shell. Locally, every accepted point crosses the journal before store publication. Incremental server backup intentionally appends periodic canonical slices, while Finish sends the complete canonical-derived display payload and separate raw audit payload. The 41-point unfinished display is not the canonical authority and no accepted-point durability loss is proven. Status: **INVESTIGATED — NOT A BUG**.

### Stable contracts

Journal/recovery/sync ownership, Memory authority/gap safety, final per-segment matching and endpoint gates, the independent elevation-quality reducer, and Watch/Simulator authority were not redesigned. Their focused suites pass. Elevation still requires a separate physical vertical forensic; no O43/O44 evidence justified changing its algorithm tonight.

## O44 experiment integrity

The two morning variants share all O45 fixes and retain identical:

- BestForNavigation accuracy;
- 25 m canonical accuracy gate;
- continuity/Candidate policy except the common stationary incident repair;
- smoothing, metrics, elevation, Memory, gaps, matching, journal, and recovery;
- RNMapbox `UserLocation` configuration;
- background permission/lifecycle behavior.

The only variant is foreground Expo `distanceInterval`: `distanceFilter5` versus `distanceFilter1`. Production/non-Debug behavior remains 5 m.

## Validation

- Focused O45 incident and integration set: 114/114.
- Focused unchanged recovery/ownership/elevation/Simulator/cadence set: 51/51.
- Permanent Activity GPS gate: 244/244, including 19/19 scoped static checks.
- Diff-routed Core gate: 32/33 suites and 319/326 tests pass. The only failure is the explicitly unrelated, pre-existing `v409-offlineQueue.test.ts` contract mismatch: seven tests call removed `readQueueSnapshot`/`clearQueue` exports. It was not retried or changed.
- Global TypeScript still contains unrelated repository debt. The scoped router reports no diagnostics in the 19 touched TypeScript files.
- No native dependency/configuration or backend source was changed by O45.

## Incident ledger

| Incident | Previous CC solution | Current status | Root cause | Action tonight | Tests | Result |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Normal source cadence | 5 m Expo foreground source; O42 reduced downstream decision delay | `NEEDS NATIVE A/B` | O43 strongly implicates upstream 5 m delivery cadence | Preserved controlled 5 m/1 m selector and diagnostics | cadence 5/5 | Only native A/B can decide production policy |
| 2. Puck/trace divergence | Separate RNMapbox and Expo subscriptions | `NEEDS ARCHITECTURE DECISION` | Different provider cadence plus RNMapbox animation | Preserved O44 source/target telemetry; no authority change | telemetry 36/36 | Awaits measured source lead |
| 3. Stationary V/Z/spaghetti | `d7ea3b0` low-speed accuracy radius; `738286b` indoor deadband | `PRIOR FIX REGRESSED — FIXED` | Rewrite admitted 5–10 m low-speed jitter | Added bounded stationary Candidate/corroboration | incident + integration | Raw retained; no false traversal/distance/Memory in fixture |
| 4. Impossible teleport/drift | `d7ea3b0` implied-speed gate | `ALREADY FIXED — REGRESSION PROVEN` | Physical impossibility/lateral excursion | Kept O43 accuracy-adjusted gate and short Candidate | continuity 12/12 | Teleport, return, and real-turn contracts pass |
| 5. 25 m/Candidate boundary | Binary 25 m filter since old CC | `PROVEN — INTENTIONALLY DEFERRED` | Accuracy gate runs before Candidate | Preserved gate and counterfactual telemetry | counterfactual artifact | 4/10 Candidate-worthy; zero proven Confirms |
| 6. iOS no-op interval restart | Sprint 72 nominal dynamic sampling | `FIXED` | Android-only metadata recreated iOS watcher | Platform-gated restart | lifecycle + integration | iOS watcher remains identical; Android unchanged |
| 7. Transient inactive false gap | Historically treated inactive as background | `FIXED` | AppState was mistaken for provider ownership | Hold owner until confirmed background/active | lifecycle matrix | No teardown or gap for active→inactive→active |
| 8. Two-second foreground takeover | Fixed debounce against AppState churn | `FIXED` | Arbitrary delay remained after owner fencing matured | Event/ownership-coalesced real takeover; full fence retained | lifecycle + integration | No sleep; repeated active is no-op |
| 9. Background permission | v412 one-time education + native request | `PRIOR FIX REGRESSED — FIXED` | `educationSeen` suppressed eligible request | OS state is authority; education only controls copy | authorization 5/5 + integration | Eligible request occurs once on Activity Start; canAskAgain=false does not loop |
| 10. Background TaskManager/native config | Top-level task, UIBackgroundModes, Fitness/no-pause | `SEPARATE FOLLOW-UP` | Plumbing is present; O43 lacked authorization | Verified source/config; no native change | ownership 4/4 | Foreground A/B unblocked; later lock-screen native test remains |
| 11. Source vs canonical health | Accepted freshness drove ambiguous “GPS” health | `FIXED` | Source freshness and truth freshness conflated diagnostically | Added separate health/reason fields | health 3/3 | Fresh source + degraded canonical and accuracy/continuity causes are distinct |
| 12. Expo native batch | Foreground exports last; background exports all | `SEPARATE FOLLOW-UP` | No proof foreground batches contain lost traversal | Investigated/instrumented background batch count only | ownership/telemetry | No dependency fork; native batch evidence remains |
| 13. Local canonical vs server display | Durable local journal + periodic server backup + final payload | `INVESTIGATED — NOT A BUG` | Compared unfinished display snapshot with canonical authority | Traced all boundaries | journal/server contracts | No canonical loss proven |
| 14. Journal/recovery/sync | O41/O43 fenced durable ownership | `ALREADY FIXED — REGRESSION PROVEN` | Stable contract | No redesign; regression gate | Core excluding known legacy test | Touched contracts pass |
| 15. Memory | Incremental accepted evidence; no gap bridge | `ALREADY FIXED — REGRESSION PROVEN` | Stable authority | Stationary integration verifies no false Memory | memory + integration | Pass |
| 16. Final matching | Per-segment derived geometry and gates | `ALREADY FIXED — REGRESSION PROVEN` | No new O43/O44 defect | No change | matching 25/25 | Pass |
| 17. Elevation | Independent O42 vertical-quality reducer | `SEPARATE FOLLOW-UP` | Native flat-walk behavior still needs vertical evidence | No algorithm change | elevation 5/5 | No regression; physical validation pending |
| 18. Watch/PDR | iPhone is sole Activity truth authority | `PROVEN — INTENTIONALLY DEFERRED` | Not involved in O43 | No change | authority contracts | No dual authority introduced |
| 19. O44 A/B readiness | Internal Debug selector and relative telemetry | `NEEDS NATIVE A/B` | Native 1 m cadence/quality unknown | Preserved and validated | cadence/GPS gate | Morning tests require no code or OTA between runs |

## Morning test build

- Marker: `O45`.
- Runtime identifier: Expo runtime policy `appVersion`, therefore `0.2.6`.
- App version: `0.2.6`, unchanged.
- Native build: unchanged existing Internal/preview native shell; an exact remote build number is not encoded in this checkout.
- Git HEAD: `4fb85bc3173aff11fd4ff7b34ce7feefc561d9cc` with local uncommitted client/docs work.
- OTA published: **NO**. Project authority reserves publication for the human; this is an OTA-safe candidate.
- Native install required: **NO** for the O45 JS changes; installed shell must already be the O43/O44-capable Internal build.
- Debug path: Settings → tap **About Cairn** five times → Developer → **Open Debug screen**.
- 5 m path: Debug → **ACTIVITY GPS A/B** → **5 m baseline**; start the next real Hike/Run.
- 1 m path: return after saving A → Debug → **ACTIVITY GPS A/B** → **1 m experiment**; start B. No OTA or restart is required.

Tomorrow, keep the screen on. For each variant: stand 20 s, walk straight 60 s, make one 90° turn, walk 30 s, stand 20 s, then Finish/Save. Return only Activity name, `qaSessionId`, approximate turn time, and a short puck/line/stationary observation.
