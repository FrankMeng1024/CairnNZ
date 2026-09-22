# WRONG O42 CONTINUITY / DENOISING ANALYSIS

Forensic date: 2026-09-10

Repository marker under review: O42

Primary real Activity: `wrong`

Historical baseline: `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c`

This is an analysis artifact. It does not authorize or contain a product-code, telemetry, configuration, database, OTA, Git-history, push, or deployment change.

Evidence sources were the production database in read-only mode, the retained QA telemetry row associated by user/device/time, current O42 source and tests, the prior O41 reports, representative earlier real Activities, and Git history. Precise coordinates, absolute headings, credentials, and account contact details are deliberately omitted. Distances below are privacy-safe relative measurements.

Status vocabulary:

- **OBSERVED** — reported by the human or directly present in retained data.
- **PROVEN** — the retained data and/or deterministic code path establishes the claim.
- **HYPOTHESIS** — best explanation, but a required event or ground-truth reference is absent.
- **INCONCLUSIVE** — current evidence cannot safely distinguish the alternatives.

## A. Verdict

### REAL TRACKING CONTINUITY PLAN READY

**Recommendation:** keep O42's identity, journal, ownership, recovery, segmentation, offline/sync, provenance, lifecycle-time, Memory-monotonicity, and Simulator guarantees. Replace the scalar point-by-point acceptance policy with a low-latency, accuracy-aware physical-motion reducer that has three outcomes: accept now, reject now, or briefly quarantine an ambiguous candidate. Reset that reducer at every explicit segment boundary, use the same deterministic reducer in foreground and background, and give elevation an independent quality model.

The evidence supports the desired product target. It does not support choosing final numerical thresholds without a replay corpus and native validation. The key architectural conclusion is nevertheless safe: CairnNZ does not need to choose between a noisy immediate route and a clean route delayed by 10–20 seconds.

## B. Direct feasibility answer

| Question | Direct answer | Evidence status |
|---|---|---|
| Q1. Can CairnNZ provide low-latency live tracking while rejecting obvious drift? | **YES.** Accept ordinary high-confidence progression immediately; reject accuracy-aware physically impossible fixes immediately; quarantine only ambiguous innovations for one subsequent fix, with a hard wall-clock cap. | **PROVEN feasible** from O42 cadence and the `C → X → D` geometry; numerical tuning remains to be validated. |
| Q2. Can an obviously impossible lateral jump be rejected immediately? | **Yes when even the most favorable edge of its accuracy envelope requires impossible Hike/Run motion.** A large point estimate alone is not always enough. A broad-accuracy point such as `wrong`'s `X` should disappear from solid truth immediately by entering quarantine, then be rejected when the next fix corroborates the original corridor. | **PROVEN distinction.** |
| Q3. Which outliers require subsequent fixes? | Plausible sharp turns, bridge/road crossings, a first fix after occlusion, jumps whose accuracy ellipses overlap the plausible corridor, low-speed course instability, and sustained relocation that might be real all need one fix; exceptionally ambiguous reacquisition may use two, never an open-ended window. | **Architecture recommendation.** |
| Q4. Can this avoid 10–20 second route lag? | **Yes.** Green fixes incur no confirmation delay. The default amber case waits at most one callback, with an absolute cap; it does not wait for a large displacement. | **PROVEN feasible.** |
| Q5. What should normal latency target? | Under good 1–3 second Core Location delivery: 1–3 seconds visible cadence and less than 0.5 seconds callback-to-route processing. With `wrong`'s observed roughly 4-second median delivery: approximately 3–5 seconds typical and no more than one callback behind. Filter-created sustained delay above 8 seconds is unacceptable; 10–20 seconds is unequivocally unacceptable. | **Evidence-backed target.** |
| Q6. Why did `wrong` zig-zag? | O42 accepted sequential point estimates that passed coarse accuracy/speed gates but were inconsistent with the recent trajectory. The live line renders those canonical points directly. Later mild crookedness also exists in the raw observations within their stated accuracy. | **PROVEN for the recorded geometry; exact true path remains human-observed rather than reference-instrumented.** |
| Q7. Which bad points should have been rejected? | The 06:40:54.670 candidate `X` should not have entered solid canonical truth; after the next one/two fixes it should have been rejected or absorbed by the estimator. The preceding 32 m-accuracy raw fix was correctly rejected. The gradual later drift cannot be safely assigned point-by-point without a ground-truth track; it calls for bounded state estimation, not mass deletion. | **PROVEN for `X` after corroboration; later individual labels INCONCLUSIVE.** |
| Q8. Why were legitimate points delayed/rejected? | `wrong` does not show the pervasive O41 acceptance freeze: within continuous segments, accepted cadence was 5.0 seconds median and 10.4 seconds p95. Twenty-four retained raw observations did not enter canonical truth, but their decision events are missing. Exact reasons and whether any were legitimate are **INCONCLUSIVE**. Long absences were provider/continuity gaps, not proven filter delay. | **Mixed: cadence PROVEN; per-rejection cause INCONCLUSIVE.** |
| Q9. What did old CC do better? | It presented a Kalman-smoothed live line and immediately discarded very large `>30 m`/`>10 m/s` teleports. That could hide a dramatic river-bank jump and look calmer. It did not possess a trajectory-aware corroboration model. | **PROVEN from commit history.** |
| Q10. What old behavior should return? | The product idea of a responsive, causally smoothed presentation and decisive rejection of unequivocal teleports—implemented on O42's durable canonical pipeline, with adaptive/time-aware covariance and segment resets. | **Recommendation.** |
| Q11. What must not return? | `Date.now()` as observation time, moving the acceptance anchor on rejected fixes, dropping bad fixes from audit, low-process-noise whole-route Kalman lag, permissive background ownership, whole-Activity matching across loss, Save-time matched Memory, or the absence of explicit gaps/recovery. | **PROVEN risks.** |
| Q12. Why was screen-off/background recording missing? | At least four foreground-to-background transitions deactivated the foreground source and failed to establish a background source, after which O42 opened `gps-reacquired` segments. No background callbacks were retained. Whether the immediate cause was authorization not granted, task registration, or `startLocationUpdatesAsync` failure is **INCONCLUSIVE** because the required events are absent. | **First failure layer PROVEN; exact native cause INCONCLUSIVE.** |
| Q13. Can lock-screen recording be reliable? | **Yes for ordinary lock/background while an active Activity has Always/background authorization and the native task is correctly configured.** It cannot be guaranteed after force-quit, denied/When-In-Use-only permission, device/OS restriction, or unavailable location hardware. | **Supported platform contract, bounded by OS conditions.** |
| Q14. Why did a straight connector appear? | `wrong` contains seven explicit segments and six gaps. Live code leaves those breaks open. Detail deliberately draws a straight **dashed gap indicator** between segment endpoints. It contributes zero distance/elevation/Memory and is not sent to matching, but at overview scale it can still look like a route connector. | **PROVEN.** |
| Q15. Why did Snap not clean `wrong`? | The final 89-point display geometry is an exact timestamp/coordinate subset of canonical raw evidence; derived matching contributed zero points. The exact runtime branch—no token, request failure/budget, or all quality fallbacks—is **INCONCLUSIVE** because matching events are absent. Repository evidence makes token authority the leading risk: no public token is present in checked-in client configuration and the installed iOS native bridge declares no `getAccessToken` export despite the TypeScript declaration. | **Zero match PROVEN; exact reason INCONCLUSIVE.** |
| Q16. What should matching do differently? | Match meaningful segments independently and in priority order; skip one-point/tiny segments; send accuracy radiuses and timestamps; consume all returned matching/tracepoint evidence; gate confidence, coverage, deviation, length, monotonic progression, topology, and endpoints; accept a mixed per-segment result only where it improves credibility. | **Recommendation.** |
| Q17. What should head/tail handling be? | Preserve the first and last **trustworthy canonical** point of every segment. Replace a nearby matched endpoint, append only a short canonical stub within the continuity envelope, and fall back for missing/large-displacement coverage. Never anchor arbitrary low-quality raw fixes. | **Recommendation.** |
| Q18. Can Memory remain incremental and look smooth? | **YES.** Cleaner canonical evidence improves it naturally. Densify/buffer only consecutive accepted edges inside one segment and beautify the display within the union of supported footprints. Never bridge gaps, Activities, teleports, or rejected candidates. | **Feasible under locked semantics.** |
| Q19. Why is flat-walk elevation wrong? | Horizontal acceptance currently authorizes altitude automatically, and every positive altitude delta is summed while negative noise is ignored. `wrong` reconstructs about 58.19 m gain from near-canceling altitude oscillation; one suspicious horizontal excursion alone added 12.32 m. Vertical accuracy is not retained in canonical/server points and is not used. | **PROVEN.** |
| Q20. What should elevation do? | Use a separate vertical-quality stream: vertical-accuracy eligibility, robust time-aware filtering, uncertainty/hysteresis deadband, sustained climb support over time/distance, descent-aware baseline movement, deterministic finish recomputation, and gap resets. Barometer fusion can improve it later; terrain data must not overwrite recorded truth. | **Recommendation.** |
| Q21. Are current logs sufficient? | **NO.** The associated QA row contains only nine envelope/checkpoint events and no Activity callback/filter/provider/matching/elevation decision stream. | **PROVEN.** |
| Q22. Exactly what is missing? | Observation ordinals and native quality, per-fix physical features and decisions, candidate transitions, provider authorization/start results, background batch/drain acknowledgements, segment decisions, live source receipt, Memory edge continuity, full matching preflight/request/quality/coverage, elevation decisions, and an end-to-end telemetry health/ack watermark. | **PROVEN coverage gaps; exact event contract is in section X.** |

## C. Recommended latency target

There are two latencies and they must not be conflated:

1. **Device evidence latency:** how often Core Location provides a useful observation.
2. **Cairn processing latency:** callback → decision → durable canonical commit → store → map source.

For `wrong`, retained raw intervals inside continuous evidence were:

| Metric | Retained raw | Accepted canonical |
|---|---:|---:|
| Count | 113 | 89 |
| Retained acceptance ratio | — | 78.76% |
| Interval median, excluding >30 s gaps | 4.09 s | 5.00 s |
| Interval p95, within segments | 9.38 s raw | 10.43 s accepted |
| Maximum accepted interval within a segment | — | 18.86 s |

For comparison, O41 `almost work` had approximately 4-second raw median but 13-second accepted median and 24.3-second p95. **PROVEN:** O42 materially restored accepted cadence. It did not add the trajectory intelligence needed to keep that responsiveness clean.

Target contract:

- **Ideal, good open sky and 1–3 s native delivery:** solid-line updates at 1–3 s cadence; green callback-to-visible update ≤500 ms median and ≤1 s p95.
- **Acceptable on the observed O42 stream:** typical 3–5 s endpoint cadence; line no more than one trustworthy callback behind; an amber candidate settles within one following fix and ≤5 s wall time.
- **Unacceptable:** a green fix waiting for a displacement threshold; filter-created sustained age >8 s; any routine 10–20 s wait under good conditions.
- A native delivery interval longer than the target is a provider-quality condition, not permission to fabricate interpolation. The UI should report degraded freshness or an honest gap.

Approximately 1–3 seconds is realistic only when iOS supplies trustworthy fixes at that cadence. The observed `distanceInterval: 5` stream naturally produced a roughly four-second median at walking speed. Lowering native distance/time settings should be evaluated separately against battery and device evidence; it is not required to fix the filter's architectural delay.

## D. `wrong` Activity identity

### Production identity

| Field | Value | Status |
|---|---|---|
| Server session ID | `2065` | **PROVEN** |
| `clientActivityId` | `6ebb473c-5844-4e1c-a241-ebaf17242060` | **PROVEN** |
| User/account | user `4`, `Frank Test` | **PROVEN**; contact detail omitted |
| Type/name | Hike / `wrong` | **PROVEN** |
| Start | 2026-09-10 06:40:15 UTC / 14:40:15 Shanghai | **PROVEN** |
| Finish/finalize | 2026-09-10 06:58:56 UTC / 14:58:56 Shanghai | **PROVEN** |
| Wall interval | 1,121 s / 18:41 | **PROVEN** |
| Lifecycle duration | 1,111 s / 18:31 | **PROVEN** |
| Stored distance | 547.21 m | **PROVEN** |
| Retained raw/canonical points | 113 / 89 | **PROVEN** |
| Retained non-canonical points | at least 24 | **PROVEN minimum**; callbacks rejected before raw audit cannot be counted |
| Segments/gaps | 7 / 6 | **PROVEN** |
| Segment-respecting retained raw path | 610.05 m | **PROVEN reconstruction** |
| Naively flattened raw path | 1,281.83 m | **PROVEN counterfactual; not Activity distance** |
| Final display points | 89 | **PROVEN** |
| Final geometry source | canonical accepted fallback; zero derived-match contribution | **PROVEN** |
| Incremental Memory rows in Activity window | 29, all exact canonical point/time matches | **PROVEN** |
| Elevation gain | not persisted as a backend session field; current algorithm reconstructs 58.19 m | **PROVEN reconstruction** |
| QA session | `qa-mtv5r0h3-7i1ovlob` | **OBSERVED temporally associated**; direct Activity binding is **INCONCLUSIVE** because Activity events are absent |
| Client metadata | app 0.2.6, build 56, iOS 26.6.1 | **PROVEN** from QA row |

### Chronological evidence table

Screen-lock state, exact permission value, provider start result, native speed/course, rejection reason, journal latency, store latency, and Mapbox source latency are marked unknown where telemetry did not retain them. All positions are expressed only as relative movement.

| Shanghai time | App/source evidence | Raw/canonical evidence | Quality / relative motion | Segment, journal/store/live/Memory | Finding |
|---|---|---|---|---|---|
| 14:40:07.719 | QA envelope starts; app active event retained | No Activity event stream | Permission/provider unknown | QA row later contains only nine events | QA transport cannot diagnose this Activity. |
| 14:40:15 | Activity server start | — | — | Lifecycle begins | Server Activity identity established. |
| 14:40:16.166 | Foreground/background source not retained | First persisted raw; not canonical | horizontal accuracy 25.29 m | No canonical/journal/store/live evidence; no Memory | Correctly outside the current `>25 m` gate. |
| 14:40:18.166–14:40:37.024 | App state unknown | 2 canonical points | segment path 8.43 m | Segment 0, reason `start`; 2 Memory matches | First continuous evidence. |
| 14:40:37.024–14:40:47.034 | Transition state not logged | No trusted intermediate evidence; endpoint interval 10.01 s / 1.09 m | Very small displacement | Segment changes to `gps-reacquired`; journal/store timings unknown; Detail later draws dash | Current code cannot create this short gap from time/displacement rules; provider-unavailable transition is established. |
| 14:40:47.034 | Source event missing | `C` accepted, accuracy 9.20 m | Establishes recent trajectory | Segment 1 | Trustworthy anchor for the major excursion. |
| before 14:40:54.670 | Source event missing | A raw fix at about 32 m accuracy is retained but rejected | Poor accuracy | No canonical/live/Memory | Current accuracy gate behaved correctly. |
| 14:40:54.670 | Source event missing | `X` accepted, accuracy 24.68 m | 32.20 m in 7.636 s; 4.217 m/s point estimate; bearing changes sharply | Solid canonical/live line and distance/elevation/Memory-eligible evidence | `X` narrowly passes accuracy and hard-teleport gates. It should have been quarantined. |
| 14:40:55.669 | Source event missing | Next raw is 5.44 m from `X`, rejected; accuracy 15.05 m | Partial evidence around ambiguous candidate | Reason, journal, and display effect unknown | One-fix state is not retained, so exact decision cannot be reconstructed. |
| 14:40:56.669 | Source event missing | `D` accepted, accuracy 11.92 m | `X → D`: 12.86 m in 1.999 s, 6.431 m/s; about 137° reversal; `C → D` is coherent | Segment 1; `X` remains canonical | Strong causal corroboration that `X` was a lateral outlier. |
| 14:40:56.669–14:41:21.998 | Source event missing | Segment continues to 7 accepted points total | Start-window path remains highly circuitous | Journal/store are required by code before normal publication, but per-point timing absent | Start zig-zag is canonical truth, not renderer-created. |
| 14:41:21.998–14:45:24.749 | Screen/app/provider state unknown | No retained fixes; 242.751 s / 272.94 m between endpoints | Missing movement evidence | Gap to segment 2 | Honest gap in metrics; exact background failure reason absent. |
| 14:45:24.749–14:45:30.998 | State unknown | 2 canonical points | segment path 8.76 m | Segment 2, `gps-reacquired` | Brief reacquisition. |
| 14:45:30.998–14:47:22.003 | State unknown | No retained evidence; 111.005 s / 129.32 m | Missing evidence | Gap to one-point segment 3 | Honest gap. |
| 14:47:22.003–14:47:55.449 | Transition not logged | One canonical point, then 33.446 s / 45.61 m to next | Missing continuity | Segment 3 then gap to segment 4 | Too short/small for current automatic gap rule; provider-unavailable path is established. |
| 14:47:55.449–14:49:20 | Human reports screen-visible straight walking | 22 raw / 18 canonical | accepted path 112.28 m vs 75.01 m chord; max chord deviation 30.02 m; turn p95 70.74° | Segment 4; bad curvature becomes live truth | Gradual trajectory innovation passed the point-local rules. |
| 14:49:20–14:53:52.998 | Human reports approximately straight movement | 58 raw / 55 canonical | path 325.01 m vs 317.29 m chord; deviation p50 4.22 m, p95 8.32 m, max 8.84 m | Segment 4; Memory draws from a subset of these canonical points | Raw is mildly crooked within 14.25 m stated horizontal accuracy; current line adds no extra geometry. |
| 14:53:52.998–14:54:06.508 | Transition not logged | Endpoint interval 13.510 s / 28.24 m | Missing continuity | Gap to segment 5 | Cannot be produced by current time/displacement rule; provider-unavailable path is established. |
| 14:54:06.508–14:54:30.998 | State unknown | 4 accepted points; path 14.78 m | — | Segment 5; last retained Memory at 14:54:06 | Memory absence afterward may be spatial dedupe; no failure event. |
| 14:54:30.998–14:58:43.313 | State unknown | No retained evidence; 252.315 s / 199.37 m | Missing movement evidence | Gap to segment 6 | Honest gap; exact OS/provider condition unknown. |
| 14:58:43.313 | State unknown | Last canonical point | — | One-point segment 6 | Trustworthy canonical tail. |
| 14:58:45.476 | State unknown | Final raw, not canonical | 2.30 m in 2.163 s, accuracy 12.24 m | No canonical tail addition | Small raw tail omission is filter-side, not matcher-side; reason absent. |
| 14:58:56 | Finish | 113 raw, 89 canonical finalized | — | Server final display equals canonical subset; no match geometry | Activity durably completed. |

Segment lengths sum exactly to the stored 547.21 m. The six gap endpoint displacements sum to 676.56 m, but that number is **not walked distance**; it is only the straight separation of observations on either side of missing evidence.

## E. Start drift forensic

The human observation—Start occurred after crossing the road, followed by approximately straight walking—is the ground-truth claim available for this section. There is no independent reference receiver, so exact lateral error relative to the real footpath remains **INCONCLUSIVE**. The internal inconsistency is nevertheless measurable.

For the start analysis window (14:40:37–14:41:21.998):

- 13 retained raw observations, 8 canonical accepted: 61.5% retained acceptance.
- Accepted path: 79.04 m; endpoint chord: 38.36 m; path/chord ratio: 2.06.
- Lateral deviation from the window chord: p50 10.41 m, p95 22.09 m, max 23.67 m.
- Consecutive turn angle: p50 108.97°, p95 135.22°, max 136.98°.
- Horizontal accuracy: p50 11.64 m, p95 21.03 m, max 24.68 m.

### Suspicious `C → X → D` excursion

| Test | `C → X` | `X → D` | `C → D` counterfactual |
|---|---:|---:|---:|
| Time | 7.636 s | 1.999 s | 9.635 s |
| Displacement | 32.20 m | 12.86 m | 24.43 m |
| Point-estimate speed | 4.217 m/s | 6.431 m/s | 2.536 m/s |
| Accuracy | `C` 9.20 m; `X` 24.68 m | `X` 24.68 m; `D` 11.92 m | endpoint qualities only |
| Direction | sharp excursion | about 137° reversal | coherent with the surrounding corridor |

The detour adds 20.63 m over the direct `C → D` progression. The approximate velocity-vector change is 2.06 m/s². A person can turn or accelerate, so none of those scalar values alone is a universal rejection proof. The combined evidence is stronger:

- `X` lies near the poor-accuracy cutoff.
- The outbound point estimate is already slightly above the Hike native-speed policy, but the hard teleport gate uses 10 m/s.
- The return requires 6.43 m/s in two seconds and reverses direction.
- The trajectory that ignores `X` is temporally and spatially coherent.
- Two later observations arrive within two seconds of `X` and favor the prior corridor.

Because the summed/RSS accuracy envelopes overlap a plausible corridor, permanently rejecting `X` at arrival is not mathematically safe. **The safe real-time response is immediate quarantine from canonical/live truth, followed by rejection when `D` corroborates `C → D`.** That prevents the visible zig-zag without delaying ordinary fixes.

## F. Later foreground drift

Two different phenomena appear later and should not share one remedy.

### 14:47:55–14:49:20: large gradual bend

- 22 retained raw, 18 canonical; 81.8% acceptance.
- Accepted path 112.28 m vs 75.01 m chord: ratio 1.497.
- Chord deviation p50 13.80 m, p95 29.51 m, max 30.02 m.
- Turn p50 12.79°, p95 70.74°, max 102.23°.
- Retained accuracy is about 14.25 m.

**PROVEN:** the shape is already present in accepted canonical geometry. The renderer did not invent it. Unlike `X`, the bend develops across sequential observations, so no single edge necessarily exceeds the current hard limits. The current `credibleMotion` rule rewards sequential progress but has no predicted trajectory/cross-track innovation test.

### 14:49:20–14:53:53: mild raw crookedness

- 58 retained raw, 55 canonical; 94.8% acceptance.
- Accepted path 325.01 m vs 317.29 m chord: ratio 1.024.
- Chord deviation p50 4.22 m, p95 8.32 m, max 8.84 m.
- Turn p50 10.45°, p95 31.36°, max 34.39°.
- Retained horizontal accuracy is about 14.25 m.

**PROVEN:** raw observations themselves are mildly crooked and the filter accepts almost all of them. **INCONCLUSIVE:** which individual observations were wrong, because there is no reference path. This portion should be handled by an accuracy-aware causal state estimate and bounded display geometry, not by classifying every small lateral movement as false.

## G. Impossible-motion analysis

An “I cannot fly” test must use uncertainty, not only point-to-point distance:

1. Compute elapsed time from native observation timestamps.
2. Compare displacement with the joint horizontal uncertainty of the previous trusted state and candidate.
3. Derive a conservative lower-bound displacement and speed after subtracting uncertainty.
4. Compare candidate innovation to the recent velocity/corridor, including along-track and cross-track components.
5. Where valid, compare Core Location speed/course with positional inference.
6. Examine the minimum physical path through `previous → candidate → next`, not just either edge alone.

### Immediately rejectable red evidence

- Invalid/non-monotonic/stale observations.
- Extremely poor horizontal accuracy outside the usable policy.
- A lower-bound speed, after uncertainty, impossible for the selected Hike/Run mode.
- A lower-bound acceleration or back-and-forth motion impossible even under favorable uncertainty.
- Contradictory native speed/course plus a large estimator innovation, when those native fields are valid.
- Ownership/provider/timestamp violations.

These can be rejected with zero additional fixes.

### Amber evidence requiring bounded corroboration

- A large point-estimate jump whose broad accuracy envelope still intersects the plausible corridor (`X`).
- A plausible sharp turn, switchback, bridge crossing, or road crossing.
- A first fix after an occlusion/reacquisition.
- A coherent new corridor that might represent an actual direction change.
- Low-speed course reversals, because course is unstable near zero speed.

These candidates should not appear in solid canonical truth while unresolved. One subsequent fix normally decides them; a second is allowed only under a strict ≤5-second total cap.

### Current-rule explanation for `X`

- Accuracy rejection is `>25 m`; `X` was 24.68 m.
- Hard teleport requires both `>30 m` and `>10 m/s`; `C → X` was 32.20 m at 4.217 m/s.
- Hike overspeed examines native Core Location speed, not implied positional speed. Since `X` was accepted, retained evidence implies native speed was absent or within policy, but the value was not persisted.
- Indoor-drift suppression applies only below 15 m displacement when accuracy is over 12 m; a 32.20 m jump bypasses it.
- Gap plausibility subtracts at least 25 m/joint uncertainty, so this transition is not classified as impossible continuity.
- No rolling trajectory, heading innovation, candidate state, or later-fix reconsideration exists.

## H. Current filter behavior

The O42 foreground path is:

`Core Location BestForNavigation / 5 m distance interval → raw callback → ownership/timestamp guards → accuracy/native-speed/stationary/indoor-drift gates → canonical point → durable journal → store → incremental Memory → live ShapeSource`

Useful O42 improvements are real:

- Rejected fixes no longer advance the accepted continuity anchor.
- Credible sequential movement can escape the old small-displacement indoor gate.
- A stationary heartbeat keeps continuity without crediting drift every callback.
- Journal commit precedes normal store publication.
- Segment identity is retained through raw/canonical/save/detail.
- Lifecycle time does not belong to GPS cadence.

Its denoising limitation is structural: decisions are mostly scalar and point-local. `isCredibleMotionSample` can prove progression relative to recent raw/accepted positions, but there is no covariance-bearing motion state, cross-track innovation, acceleration test, or pending/revision stage. Once an observation is accepted, it immediately affects distance, elevation, Memory, and the visible line; later evidence cannot retract it.

The real Mapbox puck and the route have different authorities:

- The puck is `@rnmapbox/maps` `UserLocation`, fed by Mapbox/native location updates.
- The solid line receives canonical `trackPoints` from the tracking store, not `trackPointsSmoothed`.

That separation is valid. The puck may be fresher/noisier. The failure is not that they differ; it is that canonical truth currently admits outliers yet can still update more slowly than the native puck.

## I. Old CC filter behavior

The last meaningful pre-rewrite CC Hike baseline remains commit `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c`.

Its relevant logic was:

- Accuracy reject above 25 m.
- Immediate teleport reject only when displacement exceeded 30 m **and** implied speed exceeded 10 m/s.
- Hike native-speed reject above about 4.17 m/s.
- Stationary suppression for native speed below 0.5 m/s within `max(8 m, accuracy)`.
- The same sub-15 m/30-second indoor-drift idea.
- An independent latitude/longitude Kalman filter with fixed very low process noise; the live screen rendered smoothed points.

What the human likely remembers as “river-jump rejection” was a jump large/fast enough to cross the old hard teleport threshold, reinforced by a heavily smoothed displayed line. **PROVEN:** old CC did not use future-fix corroboration, trajectory heading, acceleration, or lateral innovation. `wrong`'s 4.217 m/s outbound estimate would not have triggered its 10 m/s teleport rule.

Deterministic replay of the old fixed Kalman over `wrong` illustrates why code restoration is unsafe:

- Start segment: 77.95 m canonical path became 35.48 m rendered, with 10.84 m tail lag.
- Later main segment: 325.01 m became 320.64 m, with 19.71 m tail lag.
- Without segment resets, whole-Activity replay produced about 170 m endpoint lag across gaps.

The old version also used `Date.now()` rather than native observation time in important paths, advanced coordinate-time state on several rejected branches, lacked explicit gap truth, had weaker provider ownership/recovery, matched the entire route, and derived Memory at Save from smoothed/matched presentation. Those behaviors must remain discarded.

## J. Old vs current comparison

| Area | Old CC | O42 | Best future choice |
|---|---|---|---|
| Immediate huge teleport | `>30 m` and `>10 m/s` reject | Comparable hard gate | Keep, but make accuracy-aware and mode/covariance based. |
| Ordinary motion latency | Raw accepted readily, then display-smoothed | Credible-motion restored cadence | Keep O42 immediate green acceptance. |
| Lateral outlier intelligence | None | None | Add trajectory innovation + short candidate confirmation. |
| Live line | Fixed low-Q Kalman | Canonical points directly | Adaptive causal accepted-state line; bounded display easing. |
| Timestamp | Often wall clock | Native normalized time | Keep O42. |
| Rejected-point anchor | Could advance and freeze movement | Protected | Keep O42. |
| Raw audit | Hard rejects could disappear | Better raw retention, still incomplete for early guards | Preserve every usable native observation in a dedicated forensic ledger. |
| Background | More permissive perceived continuity | Fenced, registered task, but `wrong` source unavailable | Keep fencing; make authorization/task authority observable and deterministic. |
| Recovery | Weak | Durable journal/identity/generation | Keep O42. |
| Gaps | Flat route could bridge loss | Seven explicit segments in `wrong` | Keep O42; refine potential-gap resolution and Detail semantics. |
| Memory | Save-time smoothed/matched geometry | Incremental canonical evidence | Keep O42 truth; add same-segment corridor display smoothing. |
| Matching | Whole route, no gap authority, long wait | Per-segment, quality gated, 1.8 s bound | Keep O42 base; fix token authority, request evidence, priority, timestamps, topology. |
| Elevation | Positive raw deltas; no adequate vertical model | Still positive canonical deltas | Replace with separate vertical model. |
| Diagnostics | Sparse | Rich event vocabulary in code, but `wrong` retained none of the needed stream | Build loss-detecting, append-only Activity telemetry. |

Representative historical matching is not uniformly evidence for old superiority. Earlier real session 193 had good endpoint displacement (about 4.6/7.1 m) and a 1.003 length ratio, while session 192 showed roughly 70 m p95 deviation. The old matcher sometimes produced a pleasing route; it was not a safe universal truth authority.

## K. Recommended low-latency filtering model

Use a deterministic, serializable 2D constant-velocity estimator (Kalman or equivalent alpha-beta state) whose measurement covariance comes from horizontal accuracy and whose process noise adapts to Hike/Run motion evidence. This is not the old fixed low-Q latitude/longitude smoother.

Every observation receives one of three causal classifications:

1. **Green / accept now:** innovation fits the state covariance and mode physics; sequential progression is credible. Persist canonical evidence immediately.
2. **Red / reject now:** invalid, unusable, or accuracy-aware lower-bound motion is impossible. Preserve raw forensic evidence and reason; do not update accepted anchors.
3. **Amber / pending:** point estimate is suspicious but uncertainty permits a real turn/relocation. Hold it outside canonical metrics/Memory/solid display until one following fix resolves it.

| Technique | Latency | Noise removal | Real-turn risk | Battery/CPU | Offline/recovery |
|---|---|---|---|---|---|
| Hard physical lower-bound gate | Zero | Excellent for gross teleports | Low if uncertainty-aware | Negligible | Fully deterministic/serializable |
| Accuracy-aware innovation gate | Zero for green/red | Strong for lateral drift | Low/medium; covariance calibration matters | Negligible | Serialize state/covariance |
| Adaptive constant-velocity estimator | Zero processing delay | Smooths ordinary noise without fixed lag | Medium if process noise is too low; adapt/reset on turns | Negligible relative to GPS | Serialize and version state; deterministic replay |
| Course/heading continuity | Zero supplemental evidence | Useful at sustained speed | High near stationary/slow walking; never sole gate | Negligible | Persist validity and heading delta, not absolute course |
| One-fix candidate confirmation | One native callback only for amber | Excellent for isolated `C-X-D` outliers | Low; permits true turn confirmation | Negligible | Persist candidate and predecessor atomically |
| Two-fix confirmation | Up to two fixes, ≤5 s only | Helps ambiguous reacquisition | Medium latency | Negligible | Serialize bounded queue |
| Large rolling window | 10–20 s | Smooth | High UX cost and tail loss | Low CPU but unacceptable latency | Reject |
| Distance-only resampling | Variable, often slow at walking speed | Removes dense jitter | High freeze risk | Negligible | Use only for derived display/output, never proof of movement |
| Map/road real-time gate | Network/topology dependent | Can look neat | High off-road/bridge/path ambiguity | Network/battery cost | Never primary truth authority |

Initialization uses two or three pre-start/reacquisition observations to establish covariance without crediting distance before Start or across a gap. Segment changes reset the estimator, candidate queue, heading history, and elevation state.

## L. Candidate confirmation strategy

The minimum safe window is:

- **Zero extra fixes** for clear green/red evidence.
- **One fix** as the normal amber policy.
- **Two fixes only** for a first post-occlusion/reacquisition ambiguity, and never beyond five seconds total.
- **No larger window.** If unresolved at the cap, do not force continuity: reject low-quality evidence or open/retain a gap and initialize a new segment.

Resolution rules:

- If `previous → next` fits the old trajectory while `previous → candidate → next` creates an accuracy-adjusted detour/reversal, reject candidate.
- If candidate and next form a physically coherent new direction, commit candidate then next in timestamp order.
- If both are plausible, commit an estimator state bounded by the observations' joint uncertainty; preserve both raw rows and the ambiguity reason.
- If neither supports trustworthy continuity, start a new segment. Never turn ambiguity into connector distance.

At `wrong`, `X` becomes amber at 14:40:54.670. The next raw fix arrives in 0.999 s and `D` in 1.999 s. That is enough to choose coherent `C → D`, so no 10–20 second delay is required.

## M. Raw vs accepted vs live responsibilities

| Authority | Owns | May change | Must never change |
|---|---|---|---|
| Raw forensic record | Every usable Core Location observation, timestamp, source, native quality/validity, owner/generation | Retention/encoding version only | Observation values, order, or provenance after append |
| Canonical Activity evidence | Filter decision, source raw ordinal(s), accepted estimator position/covariance, segment, reason/version | Deterministic replay under an explicit new algorithm version before finalization | Raw audit; gaps; cross-Activity identity; post-finalization historical truth silently |
| Live display route | Low-latency causal rendering of canonical state; optional clearly bounded pending/predicted tail | Presentation interpolation/smoothing inside uncertainty envelope | Distance/Memory truth; bridge gaps; expose arbitrary raw outliers as solid truth |
| Final derived route | Per-segment Mapbox/beautification output plus quality/provenance | Replace a segment only after quality gates; asynchronously refine a versioned derivative | Raw/canonical truth; topology; legitimate canonical head/tail; gaps |

The recommended first implementation should keep the solid line canonical-only. A provisional tail is unnecessary unless device testing proves the one-fix amber hold visibly problematic. If later added, it must be visually subordinate, limited to the estimator's uncertainty envelope, and disappear/reconcile causally.

## N. Background/screen-off forensic

`wrong` has no retained background callback events and no source field sufficient to count native foreground vs background observations server-side. App/screen state, permission value, task registration, and start result are absent from the associated telemetry.

What is still provable from segment structure and O42 code:

- Segment changes at 10.010 s/1.09 m, 33.446 s/45.61 m, 13.510 s/28.24 m, and similar short transitions cannot satisfy the current automatic time/spatial gap classifier.
- Those points are marked `gps-reacquired`, not `resume` or `process-recovery`.
- In the real foreground→background branch, O42 deactivates the foreground watcher, attempts `activateBackgroundSource()`, and calls `markRecordingContinuityUnavailable('background-provider-unavailable')` when activation returns false.
- Therefore at least four transitions reached a state where the background source was unavailable and continuity was explicitly broken before foreground evidence resumed.
- No evidence shows legitimate background callbacks being delivered and then rejected, lost from the journal, or omitted from rendering.

**First lost layer:** provider activation/delivery, before canonical filtering.

**Exact native cause:** **INCONCLUSIVE** among background permission not granted, task definition/registration failure, `hasStarted`/handoff failure, `startLocationUpdatesAsync` error, or another native activation error.

The implementation does refresh iOS background authorization before activation, requests `BestForNavigation`, disables automatic pauses, uses `Fitness`, and registers the TaskManager task at module scope. Those are appropriate code intentions; `wrong` proves that intention did not yield an active provider in several transitions, and telemetry cannot say why.

The next design must run the exact same canonical reducer in both foreground and background. The current headless task does durable ownership/order work but also performs a smaller prefilter before foreground-store ingestion; two decision authorities are a future divergence risk. Serialize estimator/candidate/segment state in the active Activity context so a background batch and foreground recovery continue one ordered decision stream.

## O. Background reliability answer

Ordinary lock-screen/background recording is an expected and supported core case when:

- foreground permission has been granted;
- iOS background/Always permission is granted rather than an unresolved Allow Once/When In Use state;
- the app has the location background mode and top-level registered task;
- the Activity remains active and ownership/generation is current;
- the user has not force-quit and the OS/device has not disabled location operation.

Expo documents that iOS background location requires Always authorization and a development/standalone build, that a task must be defined at top level, and that terminated apps do not automatically restart for this API. It also warns that an Allow Once foreground grant can make a same-session background request fail silently: [Expo Location background documentation](https://docs.expo.dev/versions/latest/sdk/location/). Apple treats continuous location as a supported background mode when configured, while retaining OS control over delivery and lifecycle: [Apple background location updates](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background), [Apple `allowsBackgroundLocationUpdates`](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates).

Therefore:

- **EXPECTED AND SUPPORTED:** screen locks, app becomes inactive/background, legitimate permission exists, native task remains active, batches are journaled and recovered.
- **NOT GUARANTEED:** explicit force-quit, missing/changed permission, system location disabled, hardware failure, severe OS resource restriction, or device not delivering trustworthy fixes.
- Any unsupported interval becomes degraded state and, when continuity cannot be proven, a Gap—not claimed background tracking.

## P. Segment/gap behavior

`wrong` largely respected the O42 gap truth contract:

- 7 segment IDs and 6 explicit breaks.
- Stored 547.21 m equals the sum of within-segment canonical lengths.
- Gap endpoint separation adds zero distance and zero elevation.
- Incremental Memory rows are exact canonical points and do not prove any gap connector.
- Matching operates per segment in the finish code.
- Live rendering breaks the line and intentionally emits no gap dash.
- Activity Detail groups the segment lines and deliberately renders separate dashed endpoint-to-endpoint gap features.

The “straight connector” is therefore **not fabricated walked geometry**, but the Detail dash is a literal straight chord. At fitted overview scale it can still be interpreted as a route. Future presentation should label/space/style it as unavailable recording evidence, or use endpoint break markers without a full chord when displacement is large. This is presentation semantics; Activity Detail redesign remains outside the next tracking-core scope.

O42 also over-segments some provider-unavailable transitions with negligible evidence loss (for example 10 s/1.09 m). A future **potential gap** may be opened on source loss and resolved on reacquisition:

- If time is short and the new uncertainty envelope overlaps the prior trusted state, close the potential gap without adding path/distance.
- If missing time/displacement is meaningful or continuity is implausible, finalize Segment A → Gap → Segment B.
- Never infer the path traversed during the unavailable interval.

## Q. Snap execution

Per-segment findings for `wrong`:

| Segment | Canonical points | Match eligibility | Runtime evidence | Final source |
|---:|---:|---|---|---|
| 0 | 2 | API-eligible but too little context to be useful | No retained event | Canonical raw fallback |
| 1 | 7 | Eligible | No retained event | Canonical raw fallback |
| 2 | 2 | Marginal | No retained event | Canonical raw fallback |
| 3 | 1 | Not eligible | Deterministic skip | Canonical point |
| 4 | 72 | Strongest/meaningful segment | No retained event | Canonical raw fallback |
| 5 | 4 | Eligible but sparse | No retained event | Canonical raw fallback |
| 6 | 1 | Not eligible | Deterministic skip | Canonical point |

Exact answers:

- **Matcher token available?** **INCONCLUSIVE for this run.** Checked-in public-token configuration is absent; native getter fallback is not exported by the installed iOS bridge.
- **Matcher invoked?** **INCONCLUSIVE.** No event retained.
- **Request sent?** **INCONCLUSIVE.** No request event/HTTP outcome retained.
- **Response received?** **INCONCLUSIVE.** No response event retained.
- **Quality gate result?** **INCONCLUSIVE.** No segment result retained.
- **Final geometry source?** **PROVEN canonical accepted fallback for every segment.**

The current finish loop processes segments sequentially inside a 1.8-second total budget and one-second per-call cap. With several tiny segments ahead of the 72-point segment, low-value calls can consume the budget before the best candidate. The request includes accuracy-derived radiuses but no timestamps. `snapTrack` consumes `matchings[0]` and does not retain Mapbox `tracepoints`, null outliers, ambiguity alternatives, or multiple submatching evidence.

## R. Snap quality/topology

Map matching should refine credible movement, never repair a corrupt canonical Activity. The recommended contract is:

1. Partition strictly by canonical segment; never send gap endpoints in one request.
2. Skip one-point and tiny/low-information segments.
3. Prioritize meaningful segments by point count/duration/distance or run eligible segment requests with bounded concurrency.
4. Resample only inside the segment; retain canonical-to-request index mapping.
5. Send walking profile, accuracy-derived radiuses, and monotonic timestamps. Mapbox accepts 2–100 coordinates, radiuses, and timestamps and may return null tracepoints or multiple matching alternatives: [Mapbox Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/).
6. Evaluate all submatchings/tracepoints rather than assuming the first geometry covers the input.
7. Gate minimum confidence, p50/p95/max deviation, length distortion, canonical coverage, head/tail coverage, monotonic projection, discrete Fréchet-like similarity, and reversal/crossing topology.
8. Reject a neat route if it collapses a substantiated cross-road-and-return movement onto an adjacent parallel path.
9. Produce a versioned **mixed derivative**: accepted matches for good segments and that segment's canonical raw fallback elsewhere.
10. Persist input hash, algorithm version, per-segment decision/provenance, and geometry hash so local and server Detail cannot silently diverge.

For `wrong`, the matcher never supplied useful final geometry, so it neither fixed nor worsened topology. The ugly start is a canonical-filter failure first.

## S. Head/tail policy

`wrong` head/tail findings:

- First persisted raw: accuracy 25.29 m, rejected by the quality gate.
- First canonical: 2.0 s later, about 7.19 m away, accuracy 14.95 m.
- Last canonical: 14:58:43.313.
- Two raw observations followed; final raw was 2.30 m away after 2.163 s, accuracy 12.24 m.
- Final display ends exactly at the last canonical point. There is no matcher displacement or chunk-tail loss in this Activity.

Thus `wrong` has a 2.30 m **filter-side omitted tail**, not a Snap-lost tail. Its rejection reason is absent, so whether omission was correct is **INCONCLUSIVE**.

Single policy:

- The anchor unit is the first/last trustworthy **canonical** point per segment.
- If matched endpoint deviation is within the canonical uncertainty and a small product bound, replace it with the canonical anchor.
- If Mapbox fails to cover a short credible head/tail, append a short canonical stub inside the segment's continuity envelope.
- If coverage is missing or the connector would be large/topologically implausible, fall back the segment.
- Never anchor poor raw/audit points, bridge a gap, or force a building/parking fix onto a path.

## T. Memory implications

**PROVEN:** 29 production Memory rows occur within the Activity window, and every one exactly matches a canonical point timestamp and coordinate. No Memory row derives from the final match because no match was used. The absence of later rows can be explained by spatial deduplication/existing exploration; current telemetry cannot distinguish it from an attempted no-op.

Locked truth remains:

- Memory is incremental during tracking.
- It consumes only accepted canonical evidence.
- It never waits for or consumes final Snap.
- It never bridges segments/gaps or separate Activities.
- Rollback does not erase already-created Memory.

Better canonical denoising will remove much of the jaggedness before Memory creation. Presentation can then recover old CC smoothness safely:

- For each accepted same-segment edge, optionally distance-densify inside that edge only.
- Rasterize/buffer the supported point/edge footprint with a minimum corridor width bounded by horizontal uncertainty/product policy.
- Union footprints monotonically.
- Apply renderer-only simplification/morphological smoothing clipped to that union or a declared evidence envelope.
- Reset on every gap/Activity boundary.

Current server Memory rows do not carry enough Activity/segment/edge adjacency to reconstruct safe corridors later. The next implementation must attach privacy-safe provenance/continuity to edge creation or persist the already-clipped explored cells; it must not later connect points merely because their timestamps are near.

## U. Elevation forensic

The backend session schema does not persist Activity elevation gain. Replaying the current deterministic rule over the 89 canonical points yields:

- **58.19 m cumulative positive gain**.
- 34 positive altitude contributions.
- Accepted altitude range approximately 1.23–16.16 m.
- Segment 1: +16.02 m gain and -13.99 m loss, net only +2.03 m.
- Main segment 4: +42.17 m gain and -44.18 m loss, net about -2.01 m.
- Suspicious point `X`: +12.32 m in one accepted edge, followed by roughly 10.97 m descent.

The human observed essentially flat terrain. The near-canceling up/down sequence plus positive-only accumulation is classic rectification of vertical noise: upward noise is counted, downward noise only resets the next baseline. **PROVEN:** horizontal acceptance is the only admission gate; `verticalAccuracy` is read by the native debug logger but is absent from canonical/server point contracts and ignored by the metric.

No barometer-based Activity elevation pipeline was found in current or old CC code. Old CC did not solve the quality-model problem.

## V. Elevation recommendation

Elevation must be a separate derived metric over accepted horizontal evidence:

1. Preserve raw altitude, vertical-accuracy validity, and source ordinal in the forensic record.
2. Reject/hold vertical measurements with invalid or excessively poor vertical accuracy without rejecting the horizontal point.
3. Reset vertical continuity at every segment/gap.
4. Use a robust time-aware filter (for example median/Hampel prefilter plus low-lag state estimate) rather than raw adjacent deltas.
5. Maintain an uncertainty-scaled hysteresis/deadband. Credit climb only when filtered altitude exceeds the last credited baseline by more than supported vertical uncertainty.
6. Require the rise to persist across time and/or horizontal movement; a single spike cannot earn gain.
7. Move the baseline downward on sustained descent so a later return to the same height is not repeatedly counted as fresh climb.
8. Recompute deterministically at Finish from versioned vertical evidence; live elevation may be provisional but monotonic display changes must be explained.
9. If quality is insufficient, show zero/unknown/low-confidence rather than invented ascent.
10. If barometer support is added later, fuse relative pressure change with GPS altitude. Do not require network or DEM data for truth. Terrain elevation may be a labeled derived annotation, not a rewrite of the recorded metric.

Final thresholds must be calibrated against flat, steady-climb, descent, stop, urban-canyon, and device-model replay sets. They should not be guessed from this one Activity.

## W. Telemetry coverage

### What `wrong` retained

The temporally associated QA row is 4,918 bytes and contains only nine events: session/app envelope, debug-off/upload checkpoints, and one upload failure. Its checkpoint reports at most eight local events and `bounded: false`. It has no Activity start/provider/callback/decision/journal/trace/Memory/matching/elevation events, and no ended timestamp.

This is not a backend size-cap truncation. Event loss/absence happened before or during local logger/session ownership. Coordinate sanitization is also not a sufficient explanation because it removes coordinate fields, not entire safe Activity events. The exact logger lifecycle failure is **INCONCLUSIVE**.

The backend UPSERT has an additional diagnostic hazard: it keeps `GREATEST(events_count, raw_size_bytes)` but replaces `raw_jsonl` with the latest upload. A later smaller snapshot can therefore overwrite richer content while metadata still advertises the larger count.

### Nominal code coverage versus usable evidence

| Layer | Events exist in code | Missing for self-diagnosis |
|---|---|---|
| Native GPS | callback source, timestamp, wall time, horizontal accuracy, speed; separate debug raw includes altitude/vAcc/course | Durable observation ordinal; vAcc/speed/course validity in one stream; lifecycle/auth/provider generation; callback completeness watermark |
| Canonical filter | accept/reject reason, some latency/count fields | Prior accepted age, displacement, implied/lower-bound speed, uncertainty, innovation, heading change, estimator/candidate state, altitude decision |
| Background | auth refresh/source activation/unavailable/error, background task callback paths | All transition events retained as critical; exact native permission; task-defined/started before/after; batch/drain/journal acknowledgements |
| Persistence | accepted journal/store latency in `location_sample_accepted` | Raw-ledger ordinal, failure/verification, queue watermark, completeness across process death |
| Live display | React receives point count/tail age | ShapeSource assignment/receipt/version and bounded map update latency |
| Memory | committed/deduplicated | Activity/segment/edge ordinals, continuity reset, cells/footprint decision, no-bridge proof |
| Matching | start/completed/fallback/failure/unavailable vocabulary | Credential authority enum, request actually sent, response code, tracepoints/submatches, all quality metrics, coverage/topology/head-tail decision, geometry hashes |
| Elevation | cumulative metric only | vAcc eligibility, filtered delta, hysteresis/window decision, credited gain reason |
| Transport | bounded QA snapshot/checkpoint | Append-only chunks, ack watermark, expected-vs-retained counts, overwrite protection |

**Conclusion:** current telemetry is not sufficient for `wrong`, despite many useful event names existing in source. Availability must be measured end-to-end, not by instrumentation calls in code.

## X. Missing instrumentation

All proposed telemetry is coordinate-redacted. Precise coordinates and absolute altitude remain only in the user-owned encrypted/local raw Activity audit and normal authorized Activity data; uploaded diagnostics use relative distances, deltas, validity flags, suffixes/hashes, and reasons.

| Event name | Emission point | Required fields | Sampling/coalescing | Privacy / why required |
|---|---|---|---|---|
| `activity_observation_received_v2` | Immediately inside foreground watcher or background TaskManager | Activity/owner suffix, raw ordinal, source, batch ID/index, native timestamp delta, callback delay, hAcc, vAcc validity/value, speed/course validity, app state, permission enum, provider generation | Every usable observation; no sampling during an active Activity | No coordinate/absolute course/altitude. Proves what Core Location delivered and when. |
| `activity_filter_decision_v2` | After the single canonical reducer decides | Raw ordinal, green/red/amber, reason, dt from raw/accepted, displacement, implied and accuracy-lower-bound speed, along/cross innovation, heading delta, acceleration evidence, state covariance band, mode, segment suffix, decision latency | Every observation | No coordinates. Proves why every fix was accepted/rejected/pending. |
| `activity_candidate_transition_v1` | Candidate queue open/update/resolve | Candidate ordinals, open/corroborated/rejected/promoted/timeout/gap, age/fix count, detour excess, inbound/outbound lower-bound speed, turn delta | Every transition | Makes `C-X-D` self-diagnosing. |
| `activity_segment_decision_v2` | Continuity evaluator | continue/potential-gap/new-segment/resolved, trigger, missing duration, endpoint displacement, uncertainty, previous/new suffix | Every decision that can change segment | Proves why a connector is or is not creditable. |
| `activity_journal_commit_v2` | Raw and canonical ledger commit completion | Ordinal, ledger kind, latency, verified/failed, error class, ack watermark | Every failure; every canonical commit; raw successes may batch with contiguous ordinal range | No content. Proves durability/order without coordinates. |
| `activity_store_publish_v2` | Zustand/store publication | Canonical version, point count, tail age, commit-to-publish latency | Every canonical version | Links truth to UI state. |
| `activity_live_trace_update_v2` | ShapeSource data assignment and first observable render/map-idle acknowledgment where feasible | Canonical version, route/segment counts, tail age, pending-tail flag, assignment/render timing | Coalesce to ≤1/s, but always emit first point, gap, candidate resolution, finish | Proves map layer latency without geometry. |
| `activity_background_authority_v2` | Start, AppState transition, recovery, permission refresh, start/stop task | Native foreground/background status, `canAskAgain`, request attempted, task defined, `hasStarted` before/after, start/stop result/error class, Activity/owner generation | Every transition; critical/unsampled | Proves authorization versus registration versus native start failure. |
| `activity_background_batch_v2` | Task receipt and post-journal/drain | Batch ID, count, oldest/newest relative age, ownership/generation outcome, accepted/rejected/pending ranges, journal/drain ack | Every batch | Proves callback volume and handoff loss. |
| `activity_memory_edge_v1` | Incremental Memory point/edge decision | Activity/segment suffix, canonical ordinal pair, continuity allowed, footprint/cell count, committed/deduped/no-bridge/reset | Every accepted edge; cell IDs excluded | Proves Memory authority and gap safety. |
| `activity_match_preflight_v2` | Before segment dispatch | Credential authority `env/native/none` (never value), usable flag, algorithm version/input hash, segment counts, total budget | Once per Finish | Proves token authority without exposing credentials. |
| `activity_match_segment_v2` | Request start and terminal decision | Segment suffix/index/priority, point count/duration/distance, request count, radiuses/timestamps present, HTTP/result class, confidence, submatch count, null tracepoints, p50/p95/max deviation, length ratio, monotonic/topology metric, head/tail coverage/displacement, decision/fallback, latency | Every eligible segment; critical terminal | Proves request execution and why derived geometry won/lost. |
| `activity_final_geometry_v2` | Local completion and server ack/rehydration | canonical/matched/mixed source, algorithm/input/output hashes, point/segment counts, local/server hash equality, provenance version | At local complete, sync ack, Detail rehydrate | Proves local/server consistency without coordinates. |
| `activity_elevation_decision_v1` | Vertical reducer for each accepted horizontal ordinal | vAcc eligibility, relative raw/filtered altitude delta, window support, hold/credit/descent/reset/gap reason, credited delta, cumulative gain | Every accepted horizontal point | No absolute altitude. Proves fake-gain source. |
| `activity_telemetry_health_v2` | Periodic checkpoint, background handoff, Finish | Expected raw ordinal/high-water marks vs observation/decision/journal/provider/match events, dropped/evicted counts, chunk ack, active QA/Activity binding | Every 60 s and terminal transitions | Detects missing telemetry itself. |

Transport requirements:

- Bind QA session and `clientActivityId` explicitly at Activity Start.
- Store events as immutable chunks keyed by `(qaSessionId, clientActivityId suffix/hash, chunkOrdinal, eventId)`; do not replace a full JSONL row with a later snapshot.
- Recommended bounds: ≤250 events or ≤256 KiB per chunk, a monotonic server acknowledgment watermark, periodic/background/Finish flush, and 14-day Internal-QA retention.
- Include authorization-unavailable, gap-opened, matching-unavailable, and terminal events in the unsampled critical set.
- Compare expected ordinal ranges with server acknowledgments at Finish. A session cannot claim “complete diagnostics” if health events show missing ranges.

With that contract, an Activity name/QA ID/approximate time is enough to locate raw delivery, filter decision, persistence, background authority, live publication, Memory continuity, matching result, and elevation credit without asking for a blind reproduction.

## Y. Recommended complete tracking architecture

`Core Location raw stream`

→ `append-only raw forensic record`

→ `low-latency accuracy-aware physical plausibility reducer`

→ `optional one-fix / ≤5 s amber candidate confirmation`

→ `canonical accepted Activity truth`

→ `durable journal, then store publication`

→ `low-latency causal live route`

→ `same reducer and journal in background; ordered foreground recovery`

→ `explicit Segment / potential Gap / Gap authority`

→ `incremental same-segment Memory evidence`

→ `durable Finish`

→ `per-segment trustworthy Snap/beautification derivative`

→ `versioned local/server-consistent final display`

with a parallel `vertical-quality reducer → elevation metric` fed only by horizontally accepted ordinals.

| Layer | Authority | Expected latency | May change | May never change |
|---|---|---|---|---|
| Core Location stream | iOS native observation | Device-controlled; target 1–4 s good sky | Delivery cadence/quality | Be represented as Cairn-accepted truth automatically |
| Raw forensic record | Immutable Activity ledger | Commit immediately; target <250 ms | Encoding/retention version | Observation values/order/provenance |
| Physical reducer | Versioned deterministic Activity algorithm | Green/red <50 ms CPU; amber ≤1 fix/5 s | Canonical decision before finalization under explicit version | Raw ledger, ownership, timestamps |
| Candidate queue | Reducer substate | Normally one callback | Promote/reject/open gap | Affect distance/Memory/solid line while pending |
| Canonical truth | Accepted estimator state + raw references | Journal then publish; callback-to-route <0.5 s processing | Deterministic reconciliation before Finish | Bridge gaps or include rejected raw noise |
| Live route | Canonical causal presentation | Same accepted frame; no extra persistence wait | Bounded display smoothing inside uncertainty | Rewrite metrics/Memory or draw across segments |
| Background capture | Native task + same owner-fenced reducer/journal | Batch-delivery controlled by iOS | Queue/drain after ordered journal ack | Use a permissive second truth algorithm or accept wrong owner |
| Segment/gap | Central continuity authority | At source loss/reacquisition/candidate timeout | Resolve a potential gap with no invented credit | Add distance/elevation/Memory/match connector |
| Memory | Monotonic accepted same-segment footprint | Incremental after canonical commit | Smooth/raster display inside evidence union | Use Snap, bridge gaps/Activities, roll back explored truth |
| Finish | Activity registry/journal | Durable local completion promptly | Start bounded derived work | Lose raw/canonical evidence or wait 20 s for optional work |
| Matching | Versioned per-segment derivative | Foreground budget around 2 s; later refinement allowed with provenance | Derived display per quality-passing segment | Change canonical truth/topology/gaps/head-tail silently |
| Final display | Geometry-source contract + hash | Immediate canonical or accepted derivative | Refine only to a bounded/versioned result | Let local/server choose incompatible fallbacks |
| Elevation | Independent vertical-quality reducer | Live provisional; deterministic at Finish | Filter/hysteresis/barometer fusion by version | Sum all positive raw noise or cross gaps |

Battery/CPU impact of the reducer, candidate queue, and telemetry arithmetic is negligible relative to continuous GPS. Background battery remains dominated by `BestForNavigation`, five-metre distance updates, and `pausesUpdatesAutomatically: false`; do not change those settings until native callback/battery evidence is captured. The architecture is offline-safe because all decisions, candidate state, and journals are local and serializable. Recovery must restore reducer version/state or conservatively start a new segment.

## Z. Exact NEXT implementation scope

The next Codex task should implement one bounded continuity release, not a general tracking rewrite.

### 1. Data contracts and telemetry first

- Add immutable raw observation ordinals and retain horizontal/vertical accuracy plus speed/course validity in the private Activity audit.
- Implement the section X append-only, acknowledged, coordinate-redacted telemetry contract and backend chunk storage/read tooling.
- Add a telemetry-health assertion at Activity Finish.
- Do not log tokens, exact coordinates, absolute course, or absolute altitude.

### 2. One canonical reducer

- Introduce a versioned, serializable Hike/Run motion state with adaptive covariance.
- Implement green/red/amber decisions and one-fix/≤5 s candidate resolution.
- Use native timestamps; preserve rejected-point anchor protection and all owner/generation fencing.
- Route foreground watcher, background TaskManager batches, recovery, and Simulator parity through the same deterministic reducer interface. Keep Simulator behavior functionally frozen; use its recorded samples only to exercise parity.
- Reset estimator/candidate/vertical state at segment boundaries.

### 3. Continuity

- Replace immediate provider-loss segmentation with a durable potential-gap state that can resolve only when continuity is genuinely supported.
- Finalize meaningful absence as Segment A → Gap → Segment B.
- Assert zero gap contribution to distance, pace/elevation geometry, matching, and Memory.

### 4. Live route

- Render canonical estimator positions immediately after journal commit.
- Add only bounded, causal same-segment presentation easing; no raw outlier tail in the first release.
- Measure callback→decision→journal→store→ShapeSource timing and accepted-tail age.

### 5. Background authority

- Make native permission refresh, task definition, `hasStarted`, start/stop result, ownership, batch receipt, journal ack, and foreground drain explicit and tested.
- Truthfully expose unavailable background capability; never claim active tracking after activation failure.

### 6. Matching

- Establish one verifiable public-token authority; never hardcode or log the credential.
- Prioritize/parallelize meaningful segments within a bounded completion budget.
- Include timestamps and radiuses; inspect all matchings/tracepoints.
- Add coverage/topology/monotonic/head-tail gates and the section S policy.
- Persist source/input/output hashes and prove local/server rehydration equality.

### 7. Memory and elevation

- Build incremental same-segment Memory edge footprints with explicit Activity/segment provenance, then smooth display inside the evidence union.
- Implement the independent vertical-quality reducer and flat-walk hysteresis; do not backfill historical elevation silently.

### 8. Required replay/native validation before release

- Replay `wrong`, `almost work`, earlier good/bad real Activities, synthetic `C-X-D`, true sharp turns, bridge crossings, switchbacks, stop/start, urban canyon, and post-gap reacquisition.
- Assert: `X` never reaches solid truth/Memory; `C→D` settles within one/two seconds for the recorded stream; ordinary green progression publishes immediately; accepted distance remains within a declared baseline band.
- Validate foreground callback/accepted cadence and rejection confusion table on Hike and Run.
- Validate iOS Always/When-In-Use/denied/Allow Once, lock/unlock, foreground/background, recovery, and force-quit limitations on a native build.
- Validate background batch ordering and no zombie mutation under owner changes.
- Validate gap zero-credit/no-Memory/no-match behavior.
- Validate flat-walk, sustained climb, descent, and vertical-accuracy loss.
- Verify a real production-like Mapbox request without exposing its token; exercise confidence/timeout/no-match/parallel-path/head-tail fallbacks.
- Require a complete telemetry health watermark before declaring a failure self-diagnosing.

### Explicit non-scope

- No wholesale restoration of old CC.
- No map topology as live truth authority.
- No Activity Detail redesign in this continuity release.
- No Simulator engine redesign.
- No change to Activity identity, unfinished ownership, lifecycle timer, journal/recovery/offline/sync/provenance/rollback guarantees.
- No OTA marker or production operation until implementation is separately authorized and validated.
