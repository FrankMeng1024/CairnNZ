# Cairn tracking convergence plan

Date: 2026-09-11 (Asia/Shanghai)

Mode: master analysis and implementation-plan gate. This document changes no product code, tests, tracking configuration, OTA, backend, or data.

The requested `CairnNZ_Project_Authority.md` is not present in this checkout. Repository authority for this plan is therefore the current `AGENTS.md`, current source, the O38–O45 Activity/Simulator reports, the true-1m telemetry artifacts, the Free Activity contracts, the Activity verification router, and the historical commits cited below.

## Verdict

One coordinated client release can converge the known defects without a tracking rewrite:

1. make the proven 1 m foreground cadence the internal production candidate;
2. replace the current two-layer stationary/transition decisions with one versioned, cadence-aware movement authority;
3. preserve all journal, identity, ownership, segment/gap, Memory, recovery, sync, matching, and Simulator guarantees;
4. animate only the newest confirmed display edge on the same approximately one-second visual clock as RNMapbox `UserLocation`;
5. land and retain the O45 permission/lifecycle/health corrections, then expose source health separately from canonical route health;
6. validate with deterministic incident fixtures, a short geometry course, one lock-screen course, and a one-hour load/battery soak.

No evidence supports provider unification, a native Core Location rewrite, a provisional raw tail, PDR, Watch fusion, strong live road snapping, or whole-history Kalman in this release.

## Direct decisions

1. **Five most important defects:** production's 5 m foreground cadence; scalar-speed-driven and duplicated stationary authority; cadence-incompatible Candidate confirmation; fix-stepped/phase-misaligned live rendering; and background permission/lifecycle plus health UI behavior that still needs an integrated native proof.
2. **Why true-1m Normal was good:** 19/19 outbound fixes became canonical at 1.0 s p50 / 2.0 s p95, decision latency was 0–1 ms, and callback-to-ShapeSource was about 41 ms median.
3. **Why return failed:** position-implied speed stayed roughly 1.1–1.4 m/s while native reported speed fell near 0.09 m/s. The reducer and a second store gate treated valid 1–2 m steps as stationary-like, repeatedly rejected Candidates, and kept a sticky anchor until 15–20 m catch-up edges formed.
4. **Back-and-forth model:** reversal, repeated geography, and heading change carry no negative prior. Each transition is judged only for timestamp/order, accuracy, physically possible displacement, and short temporal corroboration. Direction is useful only to recognize an isolated out-and-back measurement around a stable anchor, never to prefer forward travel.
5. **Stationary model:** a rolling robust spatial cluster plus motion-state hysteresis. Position-derived progression, net/cumulative movement, fit residual, cluster escape, and time outweigh a single reported-speed value. Stationary evidence may refine an ephemeral position estimate but cannot add traversal.
6. **Candidate model:** Candidate is exceptional, holds a small ordered raw buffer, and resolves after sufficient evidence—normally one or two subsequent 1 m fixes. Confirmation uses cumulative plausible progression rather than one fixed >=2 m step. A time bound expires stale state but does not manufacture truth.
7. **Reported speed:** never authoritative alone. It is a fallible supporting feature; invalid, stale, or contradictory values lose weight.
8. **1 m recommendation:** yes for the next internal production candidate. Normal responsiveness is proven; battery and long-duration load remain native release gates.
9. **Live smoothness:** keep confirmed history fixed and animate only the newest confirmed display edge toward each accepted target. Retarget safely; reset at gaps/background; honor Reduce Motion.
10. **Historical idea to return:** `95302b8`'s separation of a calm live display derivative from raw/metric evidence, modernized as a bounded causal derivative plus temporal head interpolation.
11. **Old ideas not to return:** whole-history strong Kalman, scalar-speed authority, sticky accuracy-radius deadbands, discarded raw outliers, replaced native timestamps, Save-dependent Memory, and permissive background ownership.
12. **Provider unification:** not now. At 1 m, RNMapbox-to-Cairn raw lead was 1 ms p50 / 1.251 s p95 and about 1.17 / 2.12 m. Canonical classification—not dual delivery—created the large return gap.
13. **Provisional presentation:** not needed in Normal conditions. Revisit only for fresh-but-uncertain Poor evidence after the confirmed pipeline ships; it must remain presentation-only.
14. **Background/lifecycle in the release:** retain the O45 iOS no-op interval fix, transient-inactive hold, ownership-driven foreground takeover, OS-authoritative background permission flow, one-owner generation fence, queue drain, and source/canonical health model. Native Always/lock validation follows.
15. **Safe deferrals:** >25 m Candidate eligibility, provider unification, native batch bridge, native Core Location layer, PDR/Watch fusion, provisional uncertain tail, barometer/DEM, and matcher algorithm changes not demanded by a failing regression.
16. **Can one release converge the known defects?** Yes. The implementation is cohesive because cadence, motion authority, presentation timing, lifecycle, and health are adjacent client boundaries. Native uncertainty affects validation, not the user-visible state architecture.
17. **Implementation sequence:** freeze/migrate contracts; build pure movement authority; integrate one canonical decision boundary; promote 1 m foreground; add confirmed-head animation; wire health UI; retain lifecycle/background fixes; then run Core verification and native gates.
18. **Native acceptance:** a short foreground geometry course, a lock-screen course, Save/reopen, and one one-hour mixed-state soak. Exact measurements appear below.

## Evidence baseline

| Metric | Valid 5 m | True 1 m |
|---|---:|---:|
| Raw interval p50 / p95 | 5.903 / 10.622 s | **1.000 / 2.000 s** |
| Moving raw fixes/min | 7.50 | **42.49** |
| Normal outbound canonical p50 / p95 | not isolated | **1.000 / 2.000 s** |
| Callback to decision p50 / p95 | 0 / 1 ms | 0 / 1 ms |
| Callback to ShapeSource p50 / p95 | 36.5 / 43.2 ms | 41 / 72.85 ms |
| RNMapbox to Cairn raw lead p50 / p95 | 3.981 / 8.961 s | **0.001 / 1.251 s** |
| RNMapbox to canonical lead p50 / p95 | 4.984 / 15.144 s | 3.001 / 18.250 s |

The true-1m whole-session canonical p95 is dominated by the known return classifier defect. It is not a source-cadence result.

## Modern movement authority

### Authorities

- `RawObservation`: immutable forensic input, always retained subject to the existing bounded/privacy-safe transport.
- `MotionState`: reducer-owned inference (`moving`, `probably-stationary`, `uncertain`); not a route point.
- `CanonicalDecision`: the only authority allowed to create canonical route evidence (`accept`, `reject`, `candidate`, `gap/reacquire`).
- `CanonicalPoint`: journal-first Activity truth used by metrics, Memory, Save, and matching input.
- `ConfirmedDisplayPoint`: bounded causal derivative of a canonical point. It may improve presentation but never metrics or Memory.

### State

```text
MotionAuthorityState v2
  lastTrusted, previousTrusted
  motionState: acquiring | moving | probablyStationary | uncertain
  recentEligibleRaw: bounded deque (<= 6 fixes, <= 8 s)
  stationaryCluster: robust centre, radius, beganAt, lastEscapeAt
  pendingCandidate: base, ordered fixes, reason, beganAt
  latestRawTimestamp
  currentSegmentId
```

Version migration preserves journaled canonical points, discards any uncommitted v1 Candidate, rebuilds a bounded tail from retained points, and uses the existing process-recovery gap. It requires no server migration.

### Decision model

```text
on raw observation r:
  retainRaw(r)

  if invalid coordinate/timestamp or non-monotonic:
      REJECT immediately

  if horizontalAccuracy > 25 m:
      REJECT from canonical truth as source-only uncertain evidence
      update source/canonical health diagnostics
      never move trusted anchor

  derive:
      dt and displacement from trusted point
      accuracy-adjusted lower-bound speed
      position-implied speed
      recent cumulative path and net displacement
      robust linear-motion fit + residual over recent raw fixes
      cluster radius/escape progression
      reported speed/course consistency (supporting evidence only)

  if accuracy-adjusted physical speed is impossible for mode:
      if callback loss makes transition history unknowable:
          CANDIDATE_REACQUISITION
      else:
          REJECT immediately

  if state == moving:
      if transition is physically plausible and recent positions progress:
          ACCEPT immediately, regardless of turn/U-turn/repeated geography
      else if a single isolated innovation is ambiguous:
          CANDIDATE_OUTLIER

  if state in {acquiring, probablyStationary, uncertain}:
      if recent positions show sustained plausible velocity / cluster escape:
          confirm buffered movement in timestamp order; state = moving
      else if positions remain a bounded, reversing/low-net cluster:
          reject traversal; refine ephemeral position only
      else:
          CANDIDATE_STATIONARY_OR_MOTION

  candidate resolution:
      if ordered fixes have plausible edges and cumulative progress/escape:
          CONFIRM buffered fixes in timestamp order
      else if fixes return to trusted corridor/cluster:
          REJECT candidate as outlier
      else if stable new position is corroborated but old-to-new path is unknown:
          GAP; start new segment; do not credit old-to-new edge
      else after evidence budget (normally 2 fixes, hard stale cap <= 5 s):
          reject unresolved traversal; never accept merely because time elapsed
```

The implementation should avoid encoding a preferred heading. A line fit or direction statistic may establish *that positions progress*, but reversing relative to history is not negative evidence. Candidate resolution considers each candidate-local edge and displacement from a robust cluster, not similarity to the previous route bearing.

### Stationary versus slow movement

- Enter `probablyStationary` only from multiple observations, not one `speed < 0.5` value.
- While already `moving`, contradictory low reported speed does not demote motion when coordinate-derived progression remains plausible.
- At startup or after a stop, 2–3 coherent 1–1.5 m fixes may establish motion through cumulative progress even if no single step reaches 2 m.
- A stationary orbit has bounded spatial extent, low new-frontier growth, low net/cumulative ratio or high residual/reversal entropy, and no independent motion support.
- A slow walk may have small steps, but its estimated position translates over time and repeatedly escapes the prior robust cluster.
- A deliberate Z, circle, switchback, or repeated 20 m corridor is accepted because its local transitions are physically plausible and its occupied envelope/frontier changes. No global route-shape prior is applied.
- Very small deliberate pacing entirely inside the sensor's uncertainty envelope can be observationally indistinguishable from drift. The system should bias toward preserving already-established motion, expose uncertainty, and never pretend this ambiguity is mathematically solvable from CLLocation positions alone.

## Modern presentation pipeline

```text
canonical points (AUTHORITATIVE)
  -> bounded causal spatial derivative, per segment (DERIVED)
  -> immutable confirmed body + one short confirmed tail (DERIVED)
  -> two-coordinate animated head ShapeSource (PRESENTATION ONLY)
  -> Mapbox LineLayer
```

- Keep the existing bounded causal real-GPS derivative initially; do not restore the old Kalman.
- Render the stable body separately from a two-point animated head so old geometry never wobbles.
- For a normal new target, animate from the currently rendered head to the new confirmed endpoint over approximately 800–1,000 ms, aligned with `UserLocation`'s 1,000 ms linear target animation.
- If another fix arrives, stop at the current presentation value and retarget; do not rewind.
- Complete or promote the previous confirmed target into the body without changing any older point.
- On stop, finish at the latest confirmed target; do not predict beyond it.
- On gap, pause, background, unmount, correction, or segment change: cancel interpolation and start the next segment without a connector.
- Under Reduce Motion, update immediately or use a very short fade; never animate travel through a gap.
- Keep the animation object/map source local to `HikingMap`; do not publish frame positions into Zustand, the journal, Memory, or telemetry. Log only target/complete/interrupt checkpoints in QA builds.
- RNMapbox 10.3.1 exposes `Animated.ShapeSource`; use a dedicated tiny head geometry, not an animated whole-history array. Validate JS/native bridge cost before accepting it.

## Product state model

| Dimension | States | Authority | UI use |
|---|---|---|---|
| Location source | healthy, degraded, stale, unavailable | Provider active state + newest raw timestamp/accuracy | Puck/source availability and permission messaging |
| Canonical evidence | fresh-trusted, candidate/uncertain, stale, gap | Movement authority + latest accepted age + segment state | Route confidence/status; never claim source absence from this alone |
| Motion | moving, probably-stationary, uncertain | Pure movement reducer | Internal decisions and diagnostic wording; not a fitness dashboard |
| Continuity | continuous-segment, pending-transition, explicit-gap | Canonical segment authority | Metrics/Memory/matching boundaries and live line breaks |

Recommended user-facing mapping:

- pre-first-source/pre-first-truth: `Finding location…`;
- source healthy + canonical fresh: green `GPS good`;
- source healthy + Candidate/repeated rejection: amber `Route checking`;
- source degraded but not absent: amber `Location weak`;
- source stale/unavailable: red `Signal lost` or `Location off`;
- explicit gap/reacquisition: red/amber `Route interrupted` until trusted continuity resumes;
- paused: muted `GPS held`;
- Frozen remains distinct: callbacks/provider exist but native location time/coordinate does not advance. Simulator's established Normal/Poor/Lost/Frozen semantics remain frozen.

For a 1 m foreground source, green must not persist through a seven-second canonical stall. Use cadence-aware thresholds (initial target: canonical fresh <=5 s; source degraded after about 5 s and stale around 10–15 s) and validate them natively. Background may use a wider source budget because its unchanged 5 m filter is not a visible live cadence.

## Architecture diagram

```text
                           iOS system location estimates
                                      |
                 +--------------------+--------------------+
                 |                                         |
                 v                                         v
 RNMapbox AppleLocationProvider                    Cairn Expo providers
 separate CLLocationManager                       FG 1 m / BG 5 m
 [PRESENTATION ONLY: puck]                         one fenced owner/generation
                 |                                         |
                 |                              RawObservation journal/audit
                 |                                  [AUTHORITATIVE EVIDENCE]
                 |                                         |
                 |                           timestamp / accuracy / hard
                 |                             physical plausibility gates
                 |                                         |
                 |                               MotionAuthorityState v2
                 |                          immediate accept / reject / short
                 |                          Candidate / gap-reacquisition
                 |                                         |
                 |                            canonical segment + point commit
                 |                               journal first [AUTHORITATIVE]
                 |                          +--------------+--------------+
                 |                          |              |              |
                 |                          v              v              v
                 |                     distance/pace  elevation v2   incremental
                 |                      per segment   independent      Memory
                 |                    [AUTHORITATIVE] [AUTHORITATIVE] [AUTHORITATIVE]
                 |                                         |
                 |                            sync / recovery / unfinished
                 |                               [DURABLE AUTHORITY]
                 |                                         |
                 +---------------- visual phase -----------+
                                                           v
                                       bounded confirmed display derivative
                                                  [DERIVED]
                                                           |
                                       immutable body + animated confirmed head
                                             [PRESENTATION ONLY]
                                                           |
                                                     Mapbox line

 Finish: canonical segments -> per-segment Mapbox match -> quality/topology/
 endpoint/coverage gates -> matched-or-canonical final display [DERIVED].
 Raw and canonical evidence remain retained. No operation crosses a Gap.
```

## Master issue table

| # | Issue | Evidence | Current status | Historical CC relevance | Root cause | Next action | Next-release scope? | Test |
|---:|---|---|---|---|---|---|---|---|
| 1 | 5 m source cadence | O43/O44: 5.903 s p50, 10.622 s p95; accepted edges clustered at >=5 m | CONFIRMED CURRENT BUG | Old Hike also used 5 m; no old cadence advantage | iOS `distanceFilter=5` shapes delivery; `timeInterval` is Android-only | Set real foreground production candidate to 1 m; keep BG unchanged | **Yes** | Provider options + native cadence acceptance |
| 2 | 1 m source cadence | True-1m: 1/2 s p50/p95; 19/19 clean outbound accepted | NEEDS NATIVE VALIDATION | Old code offers no evidence against it | Functional response proven; battery/long-duration cost unknown | Promote internally; validate 1 h and multi-hour telemetry/load before broad release | **Yes** | Cadence contract + native soak |
| 3 | RNMapbox/Cairn dual providers | 5 m lead material; at 1 m RN-to-raw lead 1 ms/1.251 s and 1.17/2.12 m | DESIGN WEAKNESS | Old architecture was also split | Separate managers/clocks, but no longer dominant at 1 m | Keep for release; retain source comparison telemetry | No algorithm change | Native phase metrics |
| 4 | One Cairn-owned raw source | Would simplify authority; not needed to explain true-1m failure | DESIGN WEAKNESS | Old code did not provide this safely | Map puck lifecycle and Activity ownership are separate | Defer until residual provider divergence justifies native/custom puck work | No | Architecture characterization only |
| 5 | Expo limitations | Expo achieved 1/2 s; current TaskManager/durability integration is mature | NO LONGER RELEVANT for this release | Historical Expo path accumulated fixes but also safeguards | No current cadence blocker at 1 m | Do not replace Expo now | No | Native acceptance monitors |
| 6 | Native CLLocation arrays | Installed foreground Expo exports `locations.last`; no real batch-loss proof | NEEDS NATIVE VALIDATION | Old code used the same abstraction | JS cannot observe discarded foreground batch members | Instrument only if later source gaps persist; no fork | No | Background batch test + future native evidence |
| 7 | Reported-speed over-trust | Return implied 1.1–1.4 m/s while reported ~0.09 m/s; valid motion suppressed | CONFIRMED CURRENT BUG | Old scalar gate had the same weakness | A fallible OS scalar acts as a stationary verdict | Make speed one weighted feature; contradiction lowers its weight | **Yes** | `WRONG_REPORTED_SPEED_BACKTRACK` incident |
| 8 | U-turn | True walk stalled after reversal although source remained healthy | CONFIRMED CURRENT BUG | Old deadband likely also stalled; no special safe U-turn | Low-speed stationary branch and sticky anchor, not 180° itself | Accept plausible U-turn under moving-state hysteresis | **Yes** | 180° fixture with valid/invalid speed variants |
| 9 | Backtracking | 19–20 s catch-up edges on true return | CONFIRMED CURRENT BUG | Old filter not proven better | Duplicate gates suppress 1–2 m return progression | Same authority as all motion; no route-history penalty | **Yes** | Out-and-back same-line fixture |
| 10 | Repeated traversal | Explicit product contract; current location-based heuristics could suppress low-speed repeats | DESIGN WEAKNESS | Old code had no semantic protection | No dedicated regression; stationary logic can confuse overlap with no motion | Add behavior contract; geography reuse is irrelevant | **Yes** | Same 20 m segment traversed 3x |
| 11 | Intentional Z corridor | Current teleport tests cover a turn, not sustained intentional Z | DESIGN WEAKNESS | Old Kalman could flatten corners | Shape priors risk conflating route form with noise | Judge local physical transitions, not global shape | **Yes** | Multi-leg Z fixture |
| 12 | Switchbacks | Required normal behavior; not independently covered | DESIGN WEAKNESS | Strong old smoothing could cut them | Heading persistence/presentation smoothing risk | Add alternating acute-turn fixture and bounded display assertion | **Yes** | Switchback fixture |
| 13 | Diagonal road crossing | Existing legitimate-turn tests pass | HISTORICAL BUG — FIX STILL VALID | Prior work protected off-road/diagonal movement | Strong snapping or direction bias would regress it | Preserve; regression only | Preserve | Existing turn + diagonal fixture |
| 14 | Off-road/grass/plaza/unmapped trail | Raw canonical truth does not use map topology | STABLE CONTRACT | Old live filter was also not road-authoritative | Map context is inappropriate as truth | Preserve; no live matching | Preserve | Free-form polygonal route fixture |
| 15 | Slow coherent movement | Existing 5 m-step test passes; true 1 m pairs under 2 m were rejected | CONFIRMED CURRENT BUG | Old accuracy deadband could freeze slow walk | Single-step confirmation minimum mismatches 1 m cadence | Use cumulative progress/velocity fit across 2–3 fixes | **Yes** | 1–1.5 m/s and sub-1 m/s sequences |
| 16 | Stop to start | Current state can keep a sticky stationary anchor; no native proof of fast resume | DESIGN WEAKNESS | Old deadband waited for radius escape | Motion-state exit depends on large displacement/speed scalar | Confirm cumulative cluster escape within <=3 s/2–3 fixes | **Yes** | Stop 30 s then resume slowly |
| 17 | Direction coherence | Tiny-angle Candidate pairs still rejected; direction was not primary cause | DESIGN WEAKNESS | Old filter largely scalar; old Kalman favored continuity visually | Current logic uses historical bearing and pair reversal in ambiguous branches | Use direction only for candidate-local outlier evidence, never forward prior | **Yes** | U-turn/Z/circle/outlier matrix |
| 18 | Candidate confirmation | 14/17 true-1m Candidates rejected; many corroborating steps 1.1–1.9 m | CONFIRMED CURRENT BUG | Old had no Candidate, so felt immediate but was less safe | Fixed single-step >=2 m and direct-progress rules | Ordered buffer + cumulative cadence-aware progress | **Yes** | Candidate matrix at 1 s and 2 s cadence |
| 19 | Candidate timeout | At 1 m all resolved in 1–2 s; at 5 m two timed out at 5 s | DESIGN WEAKNESS | Old had no quarantine | Wall-clock bound conflates source cadence with truth | Evidence budget first; timeout only clears stale state, never auto-accepts | **Yes** | No-next-fix, late-fix, and two-fix cases |
| 20 | Stationary V/Z/spaghetti | Historical real incident and deterministic fixture; true-1m exposes uncovered shape | HISTORICAL FIX REGRESSED | `d7ea3b0`/`738286b` suppressed coarse drift but could freeze motion | Rewrite lost old intent; O45 patch remains cadence-mismatched | Replace with rolling motion/cluster authority | **Yes** | Expanded `STATIONARY_GPS_JITTER_SPAGHETTI` |
| 21 | True-1m stationary false movement | Likely opening 19.25 m and final 16.25 m canonical traversal; stop timestamps not instrumented | HISTORICAL FIX REGRESSED | Old radius likely suppressed it, with responsiveness cost | Coherent-looking drift accepted at start; catch-up escape accepted at end | Fix now from source/test evidence; natively confirm exact magnitude | **Yes** | Privacy-safe true-1m endpoint fixture + native stop |
| 22 | Stationary cluster model | Current model uses one candidate pair and scalar speed | DESIGN WEAKNESS | Old accuracy-sized radius is useful intent, unsafe mechanism | No rolling robust centre, frontier, residual, or hysteresis | Implement bounded rolling cluster/motion state | **Yes** | Orbit, coherent drift, slow walk, pacing matrix |
| 23 | Position refinement vs traversal | Product principle exists; current point model mainly accepts or rejects | DESIGN WEAKNESS | Old filter silently discarded/smoothed | Stationary estimates and walked edges are conflated conceptually | Keep ephemeral stationary position estimate separate; only confirmed edges enter route | **Yes** | Position changes without metric/Memory writes |
| 24 | Impossible teleport/river jump | Current accuracy-adjusted speed and C-X-D tests pass | HISTORICAL BUG — FIX STILL VALID | `d7ea3b0` introduced implied-speed protection | Stable physical lower-bound gate | Preserve in new reducer | Preserve | Existing teleport/river fixture |
| 25 | Drift out-and-back vs real out-and-back | Current candidate can reject C-X-D; real backtrack currently stalls | CONFIRMED CURRENT BUG | Old immediate gates could either admit drift or freeze travel | Lacks motion-state/context separation | Reject isolated innovation returning to stable corridor; accept sustained plausible local edges | **Yes** | Paired drift-V and real out-and-back fixtures |
| 26 | 25 m gate before Candidate | O43: 10 accuracy rejects; 4 Candidate-worthy, zero proven Confirms | DESIGN WEAKNESS | Binary 25 m gate is historical | Accuracy category is coarse, but safe canonical alternative is unproven | Keep gate; classify as source-only uncertain in health/telemetry | Health only | Existing gate + future native evidence |
| 27 | Trusted position != trusted transition | Central O42/O43 contract; gaps and rejected anchors behave correctly | STABLE CONTRACT | Old architecture did not express it reliably | None; invariant | Preserve in reducer/state naming | Preserve | Reacquisition/position-refinement tests |
| 28 | Gap creation | O43 gaps correctly zeroed metrics; `almost work` showed old connector defect | HISTORICAL BUG — FIX STILL VALID | Old Hike could connect missing intervals | Missing transition must be explicit | Preserve central segment authority | Preserve | Loss/reacquisition + no-connector fixture |
| 29 | Chunky live line | True-1m Shape updates every 1/2 s but line jumps directly | CONFIRMED CURRENT BUG | `95302b8` made geometry calmer, not temporally continuous | Static ShapeSource has no endpoint animation | Add presentation-only confirmed-head interpolation | **Yes** | Deterministic render-head state machine + native visual |
| 30 | Line ahead of puck | Shape target follows ~32–55 ms after source; puck animates 1 s while line jumps | CONFIRMED CURRENT BUG | Old line also jumped, but Kalman often hid it | Different presentation clocks | Animate route head on compatible ~1 s clock | **Yes** | Target phase test + native frame observation |
| 31 | Puck/line phase alignment | Human observed ahead/behind; normal source timestamps often match | CONFIRMED CURRENT BUG | Old calmer derivative reduced salience but not authority split | Immediate line target vs animated puck; occasional dual-source phase | Align confirmed head duration; keep telemetry | **Yes** | Phase lead bounds in native course |
| 32 | Renderer-only endpoint interpolation | Installed RNMapbox 10.3.1 supports animated ShapeSource primitives | DESIGN WEAKNESS | Conceptually recovers old calm without its lag | No current line animation | Animate only tiny head geometry; body static | **Yes** | Retarget, completion, gap, Reduce Motion tests |
| 33 | Historical CC smoothing | `95302b8` rendered `trackPointsSmoothed`; tester recalls good feel | HISTORICAL BUG — FIX STILL VALID as an idea | Directly relevant visual precedent | Strong spatial smoothing masked update steps | Reuse truth/display separation, not constants/code | **Yes** | Semantic visual derivative tests |
| 34 | Whole-history Kalman | O41 fallback displaced tail ~48.5 m; old Q was extremely strong | NO LONGER RELEVANT | Historical UX benefit came with endpoint/lag risk | Recursive strong filter changes route shape and lags turns | Do not restore | No | Guard canonical/final endpoints |
| 35 | Mutable confirmed display tail | DR1 supports short mutable tail; current smoothed points are fixed once appended | DESIGN WEAKNESS | Old did not actually implement one | Smooth retargeting needs a presentation-local mutable head | Allow only current animated confirmed edge; history immutable | **Yes** | Body immutability during retarget |
| 36 | Provisional display-only tail | 1 m removes normal need; Poor-state value unproven | NO LONGER RELEVANT for Normal release | No historical implementation | Would add another evidence/UX policy before need is proven | Defer to Poor/uncertain research | No | Future presentation-only safety tests |
| 37 | Live strong snap-to-road | Canonical retains off-road movement; no demand from O44 | STABLE CONTRACT | Old final matcher was permissive but not live authority | Live map topology can be wrong | Prohibit as canonical/live truth | Preserve | Off-road/diagonal fixture |
| 38 | Green GPS during canonical stall | UI stays green until 120 s after last accepted point | CONFIRMED CURRENT BUG | Historical UI used one coarse freshness idea | Source, canonical, and UI health are conflated | Wire separate source/canonical states; amber within short stall budget | **Yes** | Fresh source + stale canonical UI contract |
| 39 | `Finding…` semantics | Mostly means no first accepted fix, not all acquisition states | DESIGN WEAKNESS | Old copy was similarly coarse | One label serves permission/source/canonical conditions | Reserve for pre-first-evidence; add route-checking/weak/lost mappings | **Yes** | State-to-copy matrix |
| 40 | Poor/Lost/Frozen distinctions | Simulator distinguishes them; real UI largely has good/lost | STABLE CONTRACT with UI gap | Simulator semantics are frozen and informative | Real state derivation lacks equivalent source/canonical separation | Preserve Simulator; define real meanings without adding debug clutter | **Yes** | State model and UI contract tests |
| 41 | iOS Android-only `timeInterval` | Installed Expo iOS ignores it; O45 prevents no-op restart | HISTORICAL FIX REGRESSED | Sprint 72 dynamic timing caused iOS churn | Platform-neutral metadata was treated as native config | Retain O45 platform gate | Preserve | `IOS_NOOP_INTERVAL_PROVIDER_RESTART` |
| 42 | Transient AppState inactive | O45 pure planner holds owner; tests cover active-inactive-active | HISTORICAL FIX REGRESSED | Earlier code equated inactive with background | UI state was mistaken for provider ownership | Retain O45 behavior; no gap until confirmed transition | Preserve | `TRANSIENT_INACTIVE_FALSE_GAP` matrix |
| 43 | Two-second foreground takeover | O43 measured ~2 s; O45 uses serialized owner completion without sleep | HISTORICAL FIX REGRESSED | Fixed delay originally coalesced churn | Mature generation fencing made arbitrary sleep unnecessary | Retain ownership-driven fast path; native validate | **Yes, already prepared** | `FOREGROUND_TAKEOVER_OWNERSHIP` + native return |
| 44 | Background education flag | O43: foreground-only, canAskAgain true, educationSeen true, no request | HISTORICAL FIX REGRESSED | v412 education/request intent was later conflated | UX acknowledgement became permission authority | Retain O45 OS-authoritative request flow | **Yes, already prepared** | `BACKGROUND_PERMISSION_EDUCATION_SUPPRESSION` |
| 45 | Background permission state machine | O45 separates grant/canAsk/request/settings/education | HISTORICAL BUG — FIX STILL VALID | Modernizes v412 without prompt loops | Previously collapsed state | Land state machine and telemetry | **Yes** | Authorization matrix |
| 46 | Background TaskManager | Top-level task, Fitness, no auto-pause, batch iteration exist | NEEDS NATIVE VALIDATION | `738286b` K10 strengthened task plumbing | O43 never exercised it because permission absent | No redesign; test Always + lock screen | Preserve | Ownership tests + native lock |
| 47 | `UIBackgroundModes`/native capability | Generated/current config contains location mode and Always description | STABLE CONTRACT | Prior v403/K10 work | No defect found | Preserve; no native config edit | Preserve | Config structural check |
| 48 | Lock-screen continuity | O43 had zero callbacks without authorization; authorized path not recently proven | NEEDS NATIVE VALIDATION | Old architecture was not ownership-safe | Permission prevented test; OS delivery remains native | Validate after permission flow; diagnose telemetry if absent | **Yes, validation** | 3–5 min lock-screen walk |
| 49 | Foreground/background ownership | Serialized boundary, task status check, queue settle, generation fence exist | STABLE CONTRACT | New architecture is materially safer than old | None | Preserve exactly while integrating reducer v2 | Preserve | Owner/handoff race matrix |
| 50 | Stale-generation callbacks | Store/background task reject wrong generation/owner | STABLE CONTRACT | Old permissive writers lacked this | None | Preserve | Preserve | Existing stale real/sim/account tests |
| 51 | Raw forensic retention | Current raw audit retains rejects/quarantine; telemetry privacy bounded | STABLE CONTRACT | Old teleport path could discard evidence | None | Preserve all raw before decisions | Preserve | Reject still retained test |
| 52 | Journal durability | Accepted samples journal before store publication | STABLE CONTRACT | v409+ durable writer improvement | None | Keep canonical commit after sole reducer decision | Preserve | delayed journal/store ordering |
| 53 | Crash/restart recovery | Registry/writer recovery restores paused and re-establishes source safely | STABLE CONTRACT | Old recovery was incomplete | None | Migrate reducer v1 state safely; preserve Activity data | **Yes, migration regression** | v1 recovery + v2 gap test |
| 54 | Atomic finish | Finish lock, snapshot, local completion, fallback exist | STABLE CONTRACT | Modern Free Activity guarantee | None | Preserve | Preserve | duplicate Finish/local loss tests |
| 55 | Pending sync | Idempotent client identity and local authority exist | STABLE CONTRACT | Old server-first paths were weaker | None | Preserve; no backend change expected | Preserve | pending/offline sync gates |
| 56 | Local 75 vs server 41 | O43 server row was unfinished periodic display snapshot; no canonical loss proven | NO LONGER RELEVANT | Historical confusion between raw/display stores | Compared different authorities/stages | Document provenance; no count-equality fix | No | Completion canonical fingerprint contract |
| 57 | One unfinished Activity | Registry/server singleton/start locks enforce it | STABLE CONTRACT | Major post-old guarantee | None | Preserve | Preserve | activity registry/start race tests |
| 58 | Incremental Memory | Current accepted canonical evidence writes during Activity | STABLE CONTRACT | Old Save-dependent Memory must not return | None | Preserve after reducer v2 acceptance | Preserve | Memory call per canonical point |
| 59 | No Memory across Gap | Explicit segment boundary and Memory continuity reset tests pass | STABLE CONTRACT | Old proximity merge could bridge | None | Preserve | Preserve | `memoryFogContinuity` gap fixture |
| 60 | No provisional/render Memory | Memory consumes canonical accepted evidence, not live matched/render tail | STABLE CONTRACT | Old v354 used smoothed Save source and conflated layers | None | Keep animation entirely map-local | Preserve | Presentation mutation produces zero Memory calls |
| 61 | Stationary false Memory | True-1m likely admitted false canonical movement, which necessarily reaches Memory | CONFIRMED CURRENT BUG | Old filters reduced it but old Memory could also derive smoothed paths | Canonical stationary error propagates correctly downstream | Fix at canonical authority, not Memory | **Yes** | True-1m stationary integration fixture |
| 62 | Memory display smoothing | Current corridor derivative is clipped to accepted footprint union | HISTORICAL BUG — FIX STILL VALID | `f2e6e17` simplification/union was useful visual precedent | None in current authority | Preserve; regression only | Preserve | No invented footprint/gap bridge |
| 63 | Per-segment final matching | Current Finish loops canonical segments; Gap excluded | STABLE CONTRACT | Old whole-track matching was unsafe | None | Preserve | Preserve | Multi-segment request isolation |
| 64 | Raw retained under matching | Raw/canonical payloads distinct from derived display | STABLE CONTRACT | Old display sometimes became de facto truth | None | Preserve | Preserve | Payload provenance test |
| 65 | Endpoint protection | Current coverage/deviation gates and bounded canonical anchors exist | HISTORICAL BUG — FIX STILL VALID | O41 Kalman displaced tail ~48.5 m | Historical fallback/matcher could move endpoints | Preserve gates | Preserve | Existing head/tail tests |
| 66 | Matching quality gate | Confidence, deviation, endpoint, length, coverage telemetry/gates exist | STABLE CONTRACT | Modern correction to permissive old matching | None proven in O44 | Preserve; no algorithm tuning | Preserve | Existing matching suite |
| 67 | Live/final consistency | O43 unified matched-or-canonical local/server fallback contract | HISTORICAL BUG — FIX STILL VALID | O41 local/server fallbacks diverged | Old authority mismatch corrected | Preserve | Preserve | local/server fingerprint equality |
| 68 | Repeated-path final topology | Length gate likely rejects collapsed out/back, but no explicit fixture | DESIGN WEAKNESS | Old matcher could choose adjacent/collapsed path | Missing topology-specific regression | Add repeated-path/loop quality fixture; change matcher only if it fails | **Regression only** | Out/back mocked matcher collapse |
| 69 | False elevation gain | `almost work` had 36.8 m; O42 independent reducer added; true-1m recorded 0 m | NEEDS NATIVE VALIDATION | Old summed positive noise | Physical flat evidence now supportive but sparse | Release current reducer unchanged; validate flat + sustained climb | Validation | Native flat/hill + existing five tests |
| 70 | Vertical-quality pipeline | Vertical accuracy, median/low-pass, hysteresis, sustained support, segment reset implemented | HISTORICAL BUG — FIX STILL VALID | Replaces old horizontal=vertical trust | No current deterministic defect | Preserve; do not add DEM/barometer now | Preserve | Flat waves/climb/gap suite |
| 71 | Apple Watch authority | O43/O44 shows iPhone owns Activity truth | STABLE CONTRACT | Old Hike did not establish safe dual authority | None | Preserve single iPhone authority | Preserve | Provider-source guard |
| 72 | Watch workout integration | Separate product capability, no causal incident evidence | NO LONGER RELEVANT for this release | None | Not tracking root cause | Defer independently | No | Future Watch contract |
| 73 | PDR/IMU | Normal 1 m source is sufficient; no proven blackout need after permission fix | NO LONGER RELEVANT | None | Complexity without evidence | Defer | No | Future research only |
| 74 | 1 m battery cost | No long-duration controlled measurement | NEEDS NATIVE VALIDATION | Old 5 m provides baseline | Higher native callback rate and journal work may cost energy | One-hour A/B-ish baseline and multi-hour internal soak | Validation gate | Battery/thermal telemetry |
| 75 | Long-duration Hike | Telemetry capacity tested synthetically; true 1 m test lasted ~2 min | NEEDS NATIVE VALIDATION | Old long hikes exposed lifecycle/sync failures | Duration/load unproven | 1 h required before candidate; 2–3 h before broad release | Validation gate | Soak with lock/unlock and Save |
| 76 | Memory/CPU/render load | 1 m means ~5.7x raw rate; line animation adds frame updates | DESIGN WEAKNESS | Old whole-line rerenders/filters could be costly | Avoidable whole-array/React work may scale | Bounded deque, batch selectors, static body + tiny animated head | **Yes** | Render-count, heap/journal-size, telemetry-cap tests |
| 77 | Incident regression coverage | Teleport/gap/lifecycle exist; U-turn/repeat/Z/true-1m cluster missing | DESIGN WEAKNESS | Historical incidents are partly captured | Fixtures overfit 4–10 m jitter and 5 m slow steps | Add privacy-safe behavioral matrix | **Yes** | Named incidents listed below |
| 78 | Avoid test overfitting | Verification docs classify contract/incident/characterization | STABLE CONTRACT | Old string guards exist where native order is hard to exercise | None | Prefer outcomes; retain named structural guards only | Preserve | Review category labels |
| 79 | Impact-based verification | `verify:changed`, GPS/Core/Full gates exist | STABLE CONTRACT | DR2 improvement over rediscovery | None | Start changed router; Core gate required for store changes | Preserve | Router explain + selected gate |
| 80 | Native evidence loop | O43/O44 proved Jest cannot certify iOS delivery/rendering | STABLE CONTRACT | Historical OTA incidents reinforce it | Native sensors/OS/render clocks are external | Implementation -> verification -> internal OTA -> native telemetry -> fixture | Preserve | Exact course below |

## Historical CC reuse table

| Commit | Exact relevant behavior | UX benefit | Correctness cost | Classification / modern use |
|---|---|---|---|---|
| `772c89b` | Plant GPS sampler used a short weighted/outlier/Kalman sampling window | Demonstrated bounded fusion for a stationary targeting task | Not the Activity recorder; future-window sampling would add route lag | **NO LONGER RELEVANT** to canonical Activity; useful evidence that task-specific filters differ |
| `d7ea3b0` | Old Activity lineage used accuracy <=25 m, implied-speed teleport gate, low reported-speed suppression inside an accuracy-aware radius, and per-axis Kalman | Reduced large jumps and stationary wool-ball appearance | Scalar speed/radius can freeze slow motion; strong recursive smoothing lags; raw outliers could be lost | **GOOD IDEA, NEEDS MODERNIZATION:** physical gate and truth/display split only |
| `f2e6e17` | RDP simplification, buffered corridor, polygon union at Memory boundary | Smoother Memory corridor and fewer holes | A fixed 10 m simplifier can erase fine topology if treated as truth | **SAFE TO REUSE only as clipped Memory display derivative**; current implementation already modernizes this |
| `1fcdfd7` | Routed old Memory through the same Kalman line used by live Activity | Made Activity and Memory look consistent | Made Memory dependent on a display derivative and Save; later proximity merge could invent continuity | **RESPONSIVE BUT UNSAFE:** do not restore authority coupling |
| `738286b` | Added 15 m/30 s indoor deadband, overspeed, top-level background task, Fitness/no-auto-pause | Calmed indoor drift; improved background survivability | Deadband produced O41 latency and does not fit 1 m slow motion | **BACKGROUND IDEA REUSED; FILTER APPROACH REJECTED** |
| `95302b8` | Passed `trackPointsSmoothed` to live Hike rendering | Strongest direct historical explanation for the good visual feel | Whole-history Kalman geometry could lag/cut corners/endpoints; no temporal interpolation | **PRIOR IDEA IMPROVED:** calm derived display plus modern confirmed-head animation |
| `a9157af` | Last integrated pre-Free-Activity Hike containing the above lineage | Reference snapshot for remembered behavior | Predates global identity, fencing, journal recovery, explicit gaps, modern Memory, sync, and Simulator | **REFERENCE ONLY; never rollback wholesale** |
| `05ec257` / `cf444c0` | Free Activity/Simulator rewrite introduced shared identity, recovery, sync, provider parity and modern stores | Major correctness/durability gains | Replaced old stationary feel with layered/duplicated transition gates | **PRESERVE ARCHITECTURE; REPLACE ONLY MOVEMENT/PRESENTATION internals** |

## Implementation plan

This is one coordinated client release with reviewable sub-phases. Do not OTA between phases.

### Phase 0 — Contract fixtures and migration boundary

- Add privacy-safe incident fixtures for true-1m backtrack, false-low reported speed, stationary coherent drift, stop/start, repeated path, deliberate Z, switchbacks, and matcher path collapse.
- Define a versioned persisted motion checkpoint. During the release, persist both the new v2 checkpoint and a v1-compatible canonical-tail checkpoint so an OTA rollback cannot strand an unfinished Activity.
- Keep the existing 25 m gate and background 5 m cadence.
- Expected modules: `realGpsContinuity.ts` or a new `activityMotionAuthority.ts`, Activity tests, `backgroundLocationTask.ts` checkpoint type.
- Dependency: none. Rollback: tests/docs only at this boundary.

### Phase A — One canonical movement authority

- Implement the pure v2 state machine above.
- Remove real-GPS stationary/indoor credibility decisions from the later `useTrackingStore` mutation block. That block retains ownership, timestamp, gap, journal, metric, Memory, and Simulator-specific gates, but must not reinterpret a v2 real-GPS `ACCEPT`.
- Preserve Simulator behavior exactly; it may continue through its frozen legacy branch.
- Foreground and headless background call the same pure v2 reducer and persist the same checkpoint.
- Emit privacy-safe decision evidence: motion state before/after, position-implied versus reported speed, contradiction flag, window duration/count, cumulative/net displacement, cluster radius/escape, fit residual, Candidate evidence count/age, and result. Do not emit coordinates or every renderer frame.
- Contracts changed: stationary inference and Candidate confirmation only. Raw/accepted/gap/durability contracts remain unchanged.
- Migration: local checkpoint only; no backend/schema migration.
- Rollback: v1-compatible checkpoint remains available; an old bundle can recover canonical history and open a process-recovery gap.

### Phase B — 1 m foreground production candidate

- Change the real iOS/Android foreground Activity source to `distanceInterval=1 m` for the internal production candidate. Keep BestForNavigation and every canonical threshold otherwise fixed.
- Retain Debug experiment identity long enough to distinguish production candidate versus explicit baseline; make telemetry report effective native options.
- Keep background TaskManager at 5 m initially to avoid mixing battery and background variables.
- Do not add a timer-based iOS cadence claim.
- Contracts changed: foreground source density only.
- Rollback: one isolated provider option restores 5 m; canonical data format is unchanged.

### Phase C — Confirmed-head presentation

- Add a map-local live-route presentation helper and a separate tiny animated head source.
- Keep confirmed segment body immutable; interpolate only the newest accepted display edge.
- Align Normal duration initially with RNMapbox's 1,000 ms linear target animation; use observed cadence to clamp around 800–1,000 ms rather than extrapolating.
- On interruption, retarget from the current presentation value. Cancel on gaps, pause, background, unmount, Reduce Motion, or source change.
- Add target/start/complete/interrupted QA checkpoints only; no per-frame upload.
- Contracts changed: presentation only. Canonical points, metrics, Memory, persistence, and matching are untouched.
- Rollback: disable/remove the head layer; static canonical display remains valid.

### Phase D — Lifecycle, permission, and health convergence

- Retain the existing O45 fixes: iOS nominal-interval no-op, transient-inactive hold, ownership-completion takeover, and OS-authoritative background permission flow.
- Wire `activityLocationHealth.ts` into Hike and Run instead of deriving green from a 120-second accepted-point window.
- Preserve Simulator's established status semantics and keep the real UI restrained: Good, Route checking/Location weak, Signal lost, Location off, GPS held.
- Make health transitions telemetry events rather than periodic noise.
- No native configuration change is currently required: location background mode, Always description, TaskManager definition, Fitness activity type, and automatic-pause disablement already exist.
- Rollback: presentation health labels can revert independently; provider fences and permission corrections remain because they repair proven bugs.

### Phase E — Stable-boundary regression and candidate gate

- Run `npm run verify:changed`; because `useTrackingStore.ts` changes, the router must escalate to `verify:activity:core`.
- Also run the presentation contracts and a production-like iOS export. Do not run `verify:full` unless package/native architecture changes.
- Explicitly verify journal/recovery, unfinished authority, offline sync, Memory gaps, final matching, endpoint gates, elevation, Simulator/Real isolation, and telemetry retention.
- Do not change the known unrelated `v409-offlineQueue` mismatch merely to produce green output; report it separately unless the next task explicitly authorizes repair.
- Only after automated gates pass should the single O marker increment occur. The human remains OTA publisher.

## Conflict analysis and resolving invariants

| Conflict | Resolving invariant |
|---|---|
| 1 m responsiveness vs stationary jitter | Raw density may rise without canonical density. Only the movement authority creates traversal; stationary evidence never reaches distance/Memory. |
| Fast acceptance vs teleport rejection | Immediate acceptance applies only to physically plausible transitions. Accuracy-adjusted impossible speed remains an immediate hard reject. |
| Slow movement vs stationary suppression | Cumulative position progression and cluster escape can prove motion; no single minimum displacement or scalar speed decides it. |
| Backtracking vs direction coherence | Direction change has no negative prior. Direction is used only to detect an isolated candidate returning to the trusted cluster. |
| Smoothing vs latency | Spatial smoothing is causal/bounded and waits for nothing; temporal interpolation changes presentation frames only. |
| Line/puck alignment vs dual providers | Use compatible target animation clocks; never import RNMapbox coordinates into Activity truth. |
| Poor-accuracy freshness vs canonical safety | Source health may remain alive while canonical health is uncertain. The 25 m gate stays; UI says Route checking/Location weak, not GPS good. |
| Stationary position refinement vs walked path | Position estimate and trusted transition are separate state. Refinement creates no route edge, metrics, elevation, or Memory. |
| Background reliability vs duplicate providers | Exactly one generation-fenced canonical provider owner; takeover waits for owner completion, not arbitrary time. |
| Candidate confirmation vs gaps | Corroborated new position cannot prove unknown old-to-new travel. After loss, start a new segment with zero connector. |
| Visual tail vs durable truth | Only confirmed canonical targets feed the Normal animated head; no frame or provisional point is persisted. |
| Final beautification vs repeated topology | Matching stays per segment and derived; length/topology/endpoint gates fall back to canonical when an out/back collapses. |
| Elevation quality vs horizontal acceptance | Altitude has an independent reducer and resets at gaps; a horizontal accept never forces vertical credit. |
| Modern reducer vs unfinished O45 Activity | Dual-format local checkpoint plus process-recovery gap makes upgrade and rollback safe. |

## Acceptance criteria

### Normal open-sky Hike/Run

- Foreground raw cadence: p50 <=1.5 s, p95 <=3 s while moving.
- Canonical cadence for accuracy-eligible coherent movement: p50 <=2 s, p95 <=4 s; no unexplained stall >5 s.
- Callback-to-decision p95 <=5 ms and callback-to-ShapeSource request p95 <=150 ms.
- RNMapbox-to-canonical lead under Normal conditions: p50 <=2 s/3 m, p95 <=5 s/6 m.
- Visible route head normally feels within about two seconds of the person and advances continuously rather than in hard one-metre steps.
- Confirmed history does not move when a new fix arrives.

### U-turn, backtracking, repeated route, Z, switchback

- A plausible 180° turn is represented within the next two eligible raw fixes and no later than approximately three seconds under 1 m cadence.
- No 10–20 second anchor stall or large catch-up edge.
- Every deliberate pass over the same 20 m corridor remains in canonical order and contributes its actual traversal once.
- Z/switchback/diagonal/off-road turning topology remains visible; no heading-based flattening.

### Stationary and stop/start

- After a five-second settling allowance, 60 seconds stationary adds <=3 m canonical distance; total window target <=5 m.
- No accepted V/Z excursion, catch-up edge, elevation credit, or Memory corridor from rejected stationary evidence.
- Slow restart becomes canonical within two to three eligible fixes/approximately three seconds.

### Noise, uncertainty, and gaps

- A wrong-style isolated lateral spike never reaches canonical/display/metrics/Memory.
- Fresh but rejected/candidate evidence changes canonical health to amber within the next UI render; it does not remain green for seven seconds.
- Source silence changes source health independently of canonical health.
- A corroborated relocation after missing transition evidence opens a new segment. Connector distance, elevation, Memory, and matching are zero/absent.

### Lifecycle/background

- With Always permission and existing capability, an ordinary 3–5 minute lock-screen walk produces background callbacks, journal commits, and correct foreground drain.
- At most one foreground/background owner is active; stale generations contribute zero points.
- `active -> inactive -> active` changes neither owner generation nor segment.
- Foreground return begins as soon as background stop/drain ownership completes; no fixed two-second hole.
- If iOS supplies no callbacks despite correct registration, telemetry proves source silence rather than fabricating continuity.

### Finish, recovery, and derived systems

- Save/reopen retains raw and canonical fingerprints, segment count, endpoints, and overall route topology.
- Matching never crosses a gap or collapses an out/back; a failed quality gate uses canonical fallback.
- Crash/reopen restores the same Activity identity and journaled evidence, paused, then resumes through a process-recovery gap.
- Flat native route stays approximately flat; a sustained real climb remains credited in a separate native calibration test.

### Load and battery

- One-hour mixed foreground/lock run completes without thermal warning, runaway memory, dropped journal writes, or lost critical telemetry.
- Compare battery percentage/hour against a same-device 5 m baseline; candidate target is no more than roughly 3 percentage points/hour additional foreground drain. Treat OS battery granularity as approximate.
- Journal and raw arrays grow linearly; no O(N²) work per fix. Critical telemetry remains present after routine-event churn.
- Before broad release, perform one 2–3 hour internal Hike soak; it need not block the first instrumented internal OTA.

## Test plan

### Deterministic gates

- `NORMAL_1M_COHERENT_MOVEMENT`: same-callback accepts at 1–2 s cadence.
- `FALSE_REPORTED_SPEED_BACKTRACK`: reported 0.05–0.15 m/s plus position-implied walking preserves return.
- `U_TURN_IS_NORMAL`, `REPEATED_SEGMENT_THREE_PASSES`, `DELIBERATE_Z_CORRIDOR`, `SWITCHBACKS`, `DIAGONAL_OFFROAD`.
- `SLOW_CUMULATIVE_PROGRESS`, `STOP_START_RECOVERY`.
- Expanded `STATIONARY_GPS_JITTER_SPAGHETTI`: oscillating, coherent-drift, broad-accuracy, and post-moving stop variants.
- Existing impossible teleport, C-X-D return, long-loss reacquisition, gap, zero cross-gap metrics, and Memory fixtures.
- Candidate resolution at 1 s, 2 s, late callback, timeout, rejoin, and gap-reacquisition.
- Presentation: immutable body, one moving head, retarget, stop, U-turn, gap cancel, pause/background cancel, Reduce Motion.
- Health: source-fresh/canonical-uncertain, source-stale/canonical-recent, candidate, accuracy reject, continuity reject, explicit gap, permission unavailable.
- Lifecycle/background permission/ownership matrix already named in `ACTIVITY_VERIFICATION.md`.
- Matching: mocked match that collapses an out/back must fail length/topology quality and retain canonical order.
- Recovery: v1 and v2 checkpoint upgrade/rollback; no pending Candidate becomes durable traversal.
- Performance: 10,000 raw observations with bounded window, linear journal behavior, compact telemetry retention.

### Minimal native suite

1. **Foreground geometry course, about 8–10 minutes:** stand 45 s; walk straight 60 s; 90° turn; 180° U-turn; traverse the same 20 m segment three times; walk a deliberate Z; walk slowly for 30 s; stop 60 s; resume. Screen on. Mark approximate phase times.
2. **Weak/lifecycle course, about 8–10 minutes:** start in open sky; pass through a safe covered/urban stretch; lock screen and continue 3–5 minutes; unlock; briefly open/close Notification Center; continue and Save/reopen. Do not force-quit or create an unsafe GPS-loss condition.
3. **Load course:** one-hour ordinary Hike with at least 15 minutes screen on, 30 minutes locked, two foreground returns, and Finish/Save. Capture start/end battery and any thermal warning. Later complete one 2–3 hour internal soak before broad release.

Return only Activity names, qaSessionIds, approximate phase timestamps, battery start/end for the soak, and brief visual observations. Telemetry must answer all processing questions.

## Risks and rollback

| Risk | Mitigation | Rollback boundary |
|---|---|---|
| Motion model over-accepts drift | Paired stationary/slow/Z incident fixtures; raw retained; telemetry decision features | Switch reducer selection back to v1 in a rollback OTA; recover from compatible checkpoint |
| Motion model over-suppresses unusual real paths | No route-shape prior; U-turn/repeat/Z/switchback fixtures | Reducer-only rollback; canonical journal remains valid |
| 1 m battery/load cost | One-hour comparison; bounded raw window; no frame telemetry | Restore 5 m provider option independently |
| Animated head consumes JS/bridge budget | Animate only two coordinates; static body; profile render count | Disable head layer; static display remains correct |
| Puck/line still phase-shift | Target timing telemetry and native observation | Tune duration only; no truth change |
| Background prompt regression | One-attempt-per-flow state machine and Settings path | Permission module rollback independent of reducer |
| Upgrade/downgrade unfinished Activity | Dual-format checkpoint and process-recovery gap | Old bundle reads v1-compatible tail |
| Stable Memory/matching/sync regression | Core gate and unchanged authorities | Phase commits allow revert without data/schema rollback |

## Native build and OTA requirements

- Planned reducer, 1 m Expo option, UI health, presentation, and permission-flow changes are JavaScript/TypeScript and should be OTA-compatible with the existing Internal shell.
- No app/runtime/build version change is needed.
- No backend or database migration is expected.
- No new native build is required unless implementation discovers that the installed shell lacks the already-declared location background capability; current evidence says it does not.
- The final validated client candidate increments the single Home `O<number>` marker once. The human publishes the OTA.
- Provider unification or a custom native Core Location layer would require a separate native design/build and is intentionally outside this release.

## Files/modules expected to change

Likely product modules:

- `app/src/features/activity/realGpsContinuity.ts` or new `activityMotionAuthority.ts`
- `app/src/features/activity/activityLocationHealth.ts`
- `app/src/features/activity/locationCadenceExperiment.ts` or its production option selector
- `app/src/features/activity/backgroundAuthorization.ts` and `activityLocationLifecycle.ts` only to retain/integrate current O45 work
- `app/src/store/useTrackingStore.ts`
- `app/src/services/backgroundLocationTask.ts`
- `app/src/screens/HikingMap.tsx`
- `app/src/screens/HikingScreen.tsx`
- `app/src/screens/RunningScreen.tsx`
- `app/src/features/activitySimulator/simulatorLog.ts` for coalesced diagnostics only
- the single Home OTA-marker component, once and only after validation

Likely tests/configuration:

- `app/src/features/activity/__tests__/realGpsContinuity.test.ts`
- new or renamed movement-authority incident tests
- `app/__tests__/useTrackingStore.test.ts`
- Activity lifecycle, authorization, health, contracts, Memory-gap, matching, recovery, and presentation suites
- `app/scripts/activity-verification-map.json` only if new test paths need routing
- concise updates to `docs/operations/ACTIVITY_VERIFICATION.md` and the implementation report

Expected untouched authorities:

- backend source and schema;
- Memory data authority and persistence algorithms;
- final matching implementation unless the new repeated-path regression proves a defect;
- elevation algorithm;
- Simulator engine/semantics;
- Watch authority;
- app/runtime/build versions.

## Contracts that must not regress

- raw observations survive reject/quarantine;
- only one canonical movement authority;
- rejected/candidate evidence never advances the trusted traversal anchor;
- direction reversal and geographic repetition are normal;
- Trusted Position is not Trusted Transition;
- gaps create new segments and zero connector metrics/elevation/Memory/matching;
- accepted evidence journals before publication;
- one global unfinished Activity identity and one provider owner/generation;
- stale callbacks cannot mutate an Activity;
- timer follows Activity lifecycle, not GPS cadence;
- Memory remains incremental canonical evidence and monotonic under rollback;
- provisional/render animation never affects metrics, persistence, Memory, or matching;
- per-segment matching is derived, quality-gated, endpoint-aware, and falls back to canonical;
- local and server Detail share one derived/fallback geometry contract;
- offline completion, recovery, tombstones, and idempotent sync remain safe;
- Simulator/Real isolation and frozen Simulator semantics remain intact;
- Watch does not become a second location authority.

## Remaining native evidence—not planning blockers

1. One-hour and multi-hour 1 m battery/load behavior.
2. Actual iOS lock-screen delivery after the corrected Always-permission flow.
3. Native visual judgment of head/puck phase and Reduce Motion.
4. One flat and one sustained-climb elevation calibration.
5. Foreground native CLLocation batch membership only if 1 m telemetry still shows unexplained source gaps.

These measurements follow the coordinated implementation. None requires another pre-implementation forensic round.
