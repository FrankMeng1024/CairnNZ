# Historical CC tracking comparison

Forensic date: 2026-09-11. This is an analysis artifact only. It does not authorize or contain a runtime, test, telemetry-schema, OTA, backend, or database change.

## Historical version identified

The authoritative integrated pre-rewrite snapshot remains `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c` (`friend new ui`, 2026-09-05 23:11 Asia/Shanghai). It is the final Hike implementation before `05ec257` introduced the Free Activity/QA architecture and `cf444c0` rewrote Hike/Run.

The remembered feel does not come from one self-contained tracking commit. Its relevant provenance is:

| Commit | Date | Historical role | Classification |
|---|---|---|---|
| `d7ea3b0b84550b5d532947e792a47e82bdd6bf1b` | 2026-06-26 | Integrated the old scalar GPS gates and per-axis Kalman live derivative in the store; comments identify v74a/v75/v77 work. | Good presentation intent; filtering needs modernization. |
| `738286bc1b7d3d038a9f6f62bc1a1887ddf4c196` | 2026-08-08 | Added Hike overspeed, airport/indoor drift suppression, background Fitness/no-auto-pause settings, and incident notes K4/K7/K8/K10. | Incident-driven but structurally coarse. |
| `95302b8e97c5a970ac89671a4881864a7a8f2451` | 2026-08-17 | Made Hike render `trackPointsSmoothed` live instead of the unsmoothed accepted line. | Most direct source of the remembered calm visual feel. |
| `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c` | 2026-09-05 | Last integrated pre-rewrite Hike snapshot. | Comparison authority. |
| `05ec25786ef4f137e3c8af8493b4ebc379a0b305` | 2026-09-07 | Introduced Free Activity and QA Simulator architecture. | Replacement boundary. |
| `cf444c0445c1b5f4a4de270a182b599f3a531550` | 2026-09-07 | Rewrote Hike/Run around shared Activity semantics. | Replacement boundary. |
| `4fb85bc3173aff11fd4ff7b34ce7feefc561d9cc` plus current O45 working tree | 2026-09-10–11 | Added physical-continuity reducer, Candidate state, bounded live smoothing, durable raw/canonical telemetry, and stationary incident work. | Current comparison target. |

Git history prior to `d7ea3b0` is not a clean feature-introduction narrative: the repository's initial imported tree already contains several later-numbered GPS comments. The table therefore identifies the earliest reliable integration/blame points, not unsupported authorship claims.

## Historical pipeline

`Expo watchPositionAsync(BestForNavigation, distanceInterval 5 m)`

→ timestamp duplicate check

→ hard teleport reject (`>30 m` and point-implied `>10 m/s`)

→ raw audit append, except hard teleports were discarded entirely

→ `accuracy >25 m` reject from clean track

→ Hike reported-speed overspeed reject (`>4.17 m/s`)

→ reported-speed stationary suppression (`speed <0.5 m/s` inside `max(8 m, accuracy)`)

→ later airport/indoor suppression (`accuracy null/>12 m`, displacement `<15 m`, `<30 s`)

→ clean canonical point and raw-edge distance

→ strong per-axis Kalman derivative (`Q=1e-9`)

→ after `95302b8`, Hike live map renders that Kalman derivative.

There was no Candidate/quarantine state, no trajectory corroboration, no short mutable tail, and no temporal animation of the route endpoint. The smoother changed coordinates only when a fix was accepted.

## Semantic comparison

| Concern | Historical CC (`a915`) | Current O45 / true-1m experiment | Behavioral consequence |
|---|---|---|---|
| Source cadence | Expo BestForNavigation, 5 m displacement filter; nominal `timeInterval` had no iOS cadence effect | Same provider family; Debug A/B selects 1 m or 5 m | True 1 m produced 1.0/2.0 s raw p50/p95; old 5 m could not have supplied that factual cadence. |
| Accuracy gate | Hard 25 m clean-track boundary | Same 25 m canonical boundary | Neither reasons about 25–40 m uncertainty before the gate. Not involved in this true-1m walk because max accuracy was 24.64 m. |
| Immediate accept | Accept after scalar gates | Immediate accept after physical reducer, then a second legacy stationary suppression layer | Outbound true-1m movement accepted 19/19 at 1–2 s cadence. Some reducer `ACCEPT`s on return were still removed downstream. |
| Candidate trigger | None | Large lateral innovation, reacquisition, or reported-stationary displacement 4–accuracy radius | Candidate protects truth but was invoked 17 times in this walk. |
| Candidate timeout | None | 5 s wall-clock cap | At 1 m all candidates resolved in 1–2 s; no timeout. |
| Stationary detection | Treats reported speed `<0.5` as authoritative inside `max(8, accuracy)`; sticky anchor | Candidate based on reported speed `<0.5`, 4–15 m displacement, then legacy 2–4 m suppression/heartbeat | Both approaches can mistake sustained real movement for stationary when native reported speed is wrong. Current confirmation additionally assumes a ≥2 m corroborating step, mismatched to 1 m cadence. |
| Direction reversal | No direction model | Ordinary small edges do not use direction; stationary-candidate resolution uses reversal/progression; large-lateral Candidate uses heading only for ≥18 m edges | The true U-turn was not rejected for being 180° by itself. Low reported speed plus step-size requirements caused the delay. |
| Low-speed movement | Suppressed until outside accuracy-sized radius | Quarantine/confirm intended, but true-1m steps below 2 m repeatedly fail confirmation; downstream suppression remains | Current synthetic 5 m slow-walk test did not characterize true 1–2 m steps. |
| Smoothing | Strong history-bearing 1D Kalman per lat/lng; could move endpoints far and lag spatially | Causal convex blend (0.72/0.82 measurement weight), bounded to 2–6 m of accepted truth and reset at segment boundary | Old line looked calmer; current derivative preserves truth proximity and cannot overshoot a measurement, but neither animates between fixes. |
| Mutable tail | None | None beyond a bounded spatial derivative; no provisional raw/puck tail | The remembered version did not implement a temporal/provisional tail. |
| Display endpoint | Kalman estimate | Bounded smoothed accepted coordinate, published as GeoJSON immediately on accepted commit | Both endpoints update discretely. Current line can appear ahead of the animated UserLocation marker because the line takes the new target immediately. |
| Distance accumulation | Unsmooth clean-point edges, with crude >200 m zeroing | Canonical accepted edges per explicit segment; zero across gaps | Current system is materially safer and auditable. |
| Raw audit | Poor-accuracy/stationary fixes retained; hard teleports discarded; `Date.now()` substituted for native time | Raw observations retained with native timestamps, ordinal/source/accuracy/speed/course; rejected evidence does not move trusted anchor | Current raw authority must be preserved. |
| Gaps/ownership/recovery | Lifecycle inference, permissive dual-source dedupe, no modern Activity identity/fencing contract | Explicit segments/gaps, provider generation fencing, durable journal, unfinished ownership, recovery/offline sync | Current guarantees must be preserved. |

## What made the old version feel good

The evidence supports one direct answer: `95302b8` routed Hike's live line through the strong Kalman derivative already created by the store. This made the *shape* calmer. It did not provide more frequent iOS locations, animate the line endpoint, or implement a mutable tail.

The old scalar filter also had no Candidate pause. That made accepted fixes appear immediately after its gates, but it was not unconditionally more responsive: its reported-speed stationary gate held the same trusted anchor until movement exceeded `max(8 m, accuracy)`. Replaying the true-1m return conceptually against `a915` therefore predicts a similar approximately 14 m deadband because accuracy was about 14.25 m and reported speed was near 0.09 m/s. The old code cannot be credited with safe U-turn handling from repository evidence.

## Safety classification

| Historical idea | Classification | Reason |
|---|---|---|
| Separate canonical truth from a smoother live derivative | **SAFE TO REUSE** | Correct separation, provided the derivative stays bounded, causal, segment-local, and non-authoritative. |
| Render the live derivative consistently in Hike and Run | **SAFE TO REUSE** | Current code already does this. |
| Temporal interpolation of the confirmed live endpoint | **GOOD IDEA, NEEDS MODERNIZATION** | The old version did not implement it, but it is the smallest response to the observed chunkiness and need not alter truth. |
| Accuracy-aware stationary cluster reasoning | **GOOD IDEA, NEEDS MODERNIZATION** | Old intent was correct; scalar speed plus one radius is not. |
| Strong `Q=1e-9` whole-history Kalman | **RESPONSIVE/CALM-LOOKING BUT UNSAFE** | It can lag, cut turns, and materially displace the final endpoint; prior forensic measured a 48.5 m tail displacement in a fallback path. |
| Treat reported speed `<0.5` as stationary truth | **RESPONSIVE BUT UNSAFE** | This real return progressed at ~1.09 m/s position-implied while reported speed stayed ~0.09 m/s. |
| Suppress until leaving `max(8 m, accuracy)` | **RESPONSIVE BUT UNSAFE** | Creates a sticky 10–20 m anchor for real slow/reported-stationary motion. |
| Hard teleport rejection concept | **GOOD IDEA, NEEDS MODERNIZATION** | Physical impossibility is valid; current accuracy-aware reducer and audit retention are safer. |
| Discard hard teleports from raw audit | **RESPONSIVE BUT UNSAFE** | Removes forensic evidence. |
| `Date.now()` instead of native sample timestamp | **RESPONSIVE BUT UNSAFE** | Corrupts cadence and physical-speed evidence. |
| Old provider/background ownership | **NO LONGER RELEVANT** | Superseded by global identity, journal, generation fences, recovery, and gaps. |

## Modern combination

1. Keep the current raw audit, native timestamps, accuracy-aware impossibility gates, Candidate concept, explicit segments/gaps, journal, ownership, recovery, Memory, and final-match separation.
2. Use the measured 1 m foreground cadence as the production-candidate source policy, subject to battery/load validation.
3. Replace scalar reported-speed stationary authority with a motion-state estimator that uses a rolling uncertainty-aware cluster *and* cumulative directional progression. Reported speed is evidence, not a veto.
4. Make Candidate confirmation cadence-aware: several coherent 1–2 m steps may prove walking without requiring any individual corroborating step to exceed 2 m. A legitimate U-turn is normal after the new heading stabilizes.
5. Remove the redundant second stationary suppression decision after the continuity reducer, or make one reducer the sole canonical transition authority. Preserve a zero-distance stationary heartbeat as an explicit output rather than silently contradicting `ACCEPT` telemetry.
6. For Normal accepted evidence, animate only the newest confirmed display endpoint on the presentation clock. Keep confirmed history immutable and snap/cancel the animation at a gap or Candidate correction.
7. Do not restore the old strong Kalman or make RNMapbox/puck evidence canonical.

This yields the old implementation's calmer presentation intent plus the current architecture's truth and recovery guarantees, without a wholesale rollback.
