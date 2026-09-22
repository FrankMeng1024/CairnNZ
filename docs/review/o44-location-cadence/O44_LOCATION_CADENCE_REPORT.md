# O44 controlled location cadence report

Date: 2026-09-11 (Asia/Shanghai)

Status: **first native attempt completed but invalid as an A/B: both saved walks emitted `distanceFilter5`; a valid 1 m session is still pending**.

O45 subsequently fixed the independently proven iOS no-op watcher restart,
transient-`inactive` lifecycle gap, fixed two-second real foreground takeover,
background education/permission suppression, and stationary V/Z regression.
Those corrections apply identically to both A/B variants. See
`docs/review/o45-tracking-hardening/O45_OVERNIGHT_REPORT.md`; the O44 native
cadence results remain pending. The two September 11 walks and the complete
final-stall reconstruction are documented in `O44_NATIVE_AB_FORENSIC.md`.

This is a controlled measurement change, not a tracking redesign. It preserves the 25 m gate, continuity/Candidate reducer, live smoothing, metrics, Memory, matching, gaps, persistence, background policy, and RNMapbox `UserLocation` configuration. Production/non-Debug behavior remains 5 m.

## 1. Preserved O43 baseline

The primary O43 session is `qa-mtvixnmb-iim3w848` (2026-09-10 20:49:12.659–20:58:00.573 Shanghai). Its relevant baseline is:

| Metric | O43 value |
|---|---:|
| Cairn raw interval p50 / p95 | 5.000 s / 12.977 s |
| Accepted interval p50 / p95 | 5.000 s / 15.699 s |
| Coherent-edge displacement median | 5.67 m |
| Coherent edges from 5–8 m | 64 / 71 |
| Median reported walking speed | 0.925 m/s |
| Callback → decision p50 / p95 | 0 ms / 1 ms |
| Callback → ShapeSource request p50 / p95 | 41 ms / 62.5 ms |
| Candidate count | 0 |
| Rejections | 10, all `poor-horizontal-accuracy` |

O43 strongly implicates the 5 m source filter as a major ordinary cadence contributor, but did not contain raw-to-prior-raw displacement and therefore did not prove sole causation. O44 adds that missing measurement and changes only the source filter in variant B.

## 2. O43 25 m gate counterfactual

Machine-readable evidence: [O43_ACCURACY_GATE_COUNTERFACTUAL.csv](./O43_ACCURACY_GATE_COUNTERFACTUAL.csv).

The uploaded O43 telemetry intentionally removed rejected coordinates. No precise local device trace exists in this workspace. Exact rejected→next geometry therefore cannot be reconstructed, and no absolute coordinate is included in the artifact.

### Classification

| Counterfactual class | Count | Evidence |
|---|---:|---|
| Immediate Reject | 0 proven | Accuracy-adjusted physical impossibility cannot be established for any row from retained fields alone. |
| Candidate-worthy | 4 | Raw 10, 11, 12, and 15 had a trusted anchor plus contradictory centre displacement/reported speed and short later corroboration. |
| Plausible eventual Confirm | 0 proven | Exact rejected→next geometry was redacted, so confirmation cannot be asserted. |
| Still unknown | 6 | Raw 1, 2, 4, 5, 6, and 83 had no trusted anchor in their new segment or lacked enough retained geometry. |

For the four Candidate-worthy rows, the centres implied 6.68–19.99 m/s from the trusted point while reported speed was 0–0.37 m/s. Later accepted centres returned much nearer the old trusted anchor. This is enough to say continuity reasoning would have been useful, not enough to say the inaccurate locations were valid.

Important structural finding: the hard `horizontalAccuracy > 25 m` check occurs before continuity/Candidate evaluation. The current accuracy-aware continuity thresholds expand with uncertainty; simply deleting the gate could make some of these samples immediate accepts rather than Candidates. O44 does **not** change that policy. It establishes that the gate currently bypasses Candidate reasoning for a meaningful but not yet proven-useful class.

## 3. Instrumentation added

### Cairn Expo source

`activity_observation_received_v2` now also records:

- `dtFromPreviousRawMs`;
- privacy-safe `displacementFromPreviousRawM`;
- `cadenceVariant`;
- effective foreground distance filter.

The previous raw coordinate remains only in short-lived process memory. No exact location is added to telemetry.

### RNMapbox source

`rnmapbox_location_source` is emitted only when either the RNMapbox source `CLLocation` timestamp or coordinate changes. A heading callback that reuses both is not counted as a location fix; its count is carried into the next source event.

Fields include source age/interval, callback interval, horizontal accuracy, reported speed/course validity, displacement from the previous RNMapbox location, and displacement to the latest Cairn raw and canonical points. All spatial values uploaded are relative distances.

Installed RNMapbox supplies a numeric millisecond timestamp. Its iOS event object reuses the retained location timestamp for heading events, so timestamp+coordinate deduplication distinguishes those repeats without changing the dependency.

### UserLocation target phase

`map_user_location_target` marks the non-invasive JS checkpoint immediately after RNMapbox `UserLocation` has requested its state update for a new source location. It records source age, relative distances, and the known 1,000 ms Normal-mode animation duration.

This is **not** a rendered/GPU puck observation. Exact interpolation/paint would require a broader RNMapbox bridge or fork and is deliberately outside O44.

### Experiment identity

Critical event `activity_location_cadence_experiment_v1` identifies every real session as `distanceFilter5` or `distanceFilter1`, plus the effective distance, desired accuracy, and explicit statements that canonical acceptance and RNMapbox configuration are unchanged.

## 4. QA-only A/B control

The Debug screen now offers:

- `5 m baseline`;
- `1 m experiment`.

The selection affects the next foreground real Hike/Run only when both the Internal-build capability and runtime Debug Mode are enabled. Outside that double gate, the runtime forces 5 m even if a persisted internal selection says 1 m. The value is captured when a real Activity starts or restores and remains fixed for that provider lifetime. The controlled protocol must not change it during an Activity; a restore emits a new critical identity event, so an accidental variant change remains detectable rather than silently mixing evidence.

Both variants retain:

```text
accuracy = BestForNavigation
timeInterval = existing nominal value (Android-only; no iOS cadence effect)
canonical reducer = unchanged
RNMapbox UserLocation = unchanged
```

## 5. Foreground takeover forensic

**Proven code path:** on `AppState=active`, Cairn waits 2,000 ms before `transitionToForegroundSource()`.

The delay protects a real prior incident: clustered/transient AppState changes repeatedly tore down/restarted foreground location, causing GPS gaps and battery churn. After the timer, Cairn rechecks AppState, serializes source ownership, stops the native background task, fences and drains pending background writes, refreshes authorization, and only then starts the Expo watcher.

RNMapbox uses a separate AppState listener and restarts its provider immediately when active. That explains why it can resume before Cairn during the two-second window.

If a legitimate background task is active, it should continue collecting through the debounce and the ordered drain prevents loss during takeover. In O43 it was unavailable, so the debounce became a real observation hole.

**Recommendation for a later task (not implemented):** retain the ownership serialization, queue drain, and post-delay AppState recheck. Evaluate immediate or 0–250 ms foreground activation only when no background provider is running; retain debounce/coalescing when background ownership is healthy. The full two seconds is not intrinsically required by Core Location, but removing it globally without reproducing the AppState churn would regress a proven safety fix.

## 6. Background permission forensic

### Capability/configuration

- Effective Expo config includes `UIBackgroundModes = ["location"]`.
- `NSLocationAlwaysAndWhenInUseUsageDescription` is present.
- The expo-location plugin entry does not set `isIosBackgroundLocationEnabled`, but the explicit Info.plist value supplies the same required mode.
- The TaskManager task is defined at module load and registered again during app entry.
- With `Always` granted, the current code is structurally able to call `startLocationUpdatesAsync` using BestForNavigation, 5 m, `Fitness`, and `pausesUpdatesAutomatically=false`.

### Why O43 did not background

At Activity Start O43 logged:

```text
permissionState = foreground-only
canAskAgain = true
requestAttempted = false
```

The only current path that produces that combination at Start is the persisted `cairn_has_seen_always_allow_education` flag suppressing `requestBackgroundPermissionsAsync`. Cairn still refreshes status, but it no longer asks. Therefore no background provider could legitimately register, and O43 produced honest gaps.

This does **not** prove that the tester denied a prompt. O43 cannot distinguish a prior `Later`, opening Settings without changing permission, prior Allow Once/While Using, or a later permission downgrade. Expo documents that Allow Once and While Using are indistinguishable to the app, and that a same-session background request after Allow Once can silently fail; the user may need Settings. See [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/).

Classification: **device permission state plus product-flow defect/risk**, not evidence that the background TaskManager architecture is absent. The one-time education flag can suppress a still-eligible request indefinitely. O44 does not change it.

## 7. Native A/B protocol

Run two short real Hikes in the same outdoor area, close together in time. Keep the screen on throughout.

For each:

1. Stand still 20 seconds.
2. Walk straight normally for 60 seconds.
3. Make one clear 90° turn and note the approximate time.
4. Continue 30 seconds.
5. Stop for 20 seconds, then Finish/Save.

Run A with `5 m baseline`, then B with `1 m experiment`. Record Activity name, `qaSessionId`, and approximate turn time for each.

## 8. A/B result table

The first physical attempt did not produce a 1 m runtime sample. The Activity
named `1m` emitted the critical identity `distanceFilter5` because Debug Mode
was off at Activity Start. Its observed values must not be placed in the 1 m
column. See `O44_AB_SUMMARY.json` for both actual 5 m sessions.

| Metric | 5 m | 1 m |
|---|---:|---:|
| raw fixes/min moving | 7.32 | not measured |
| raw interval p50 | 5.903 s | not measured |
| raw interval p95 | 10.622 s | not measured |
| raw displacement p50 | 5.58 m | not measured |
| raw displacement p95 | 20.88 m | not measured |
| accepted interval p50 | 4.999 s | not measured |
| accepted interval p95 | 16.604 s | not measured |
| horizontal accuracy p50 | 14.25 m | not measured |
| horizontal accuracy p95 | 26.93 m | not measured |
| reject rate | 25% hard accuracy | not measured |
| Candidate rate | 12.5% creations | not measured |
| callback→accept p50 | 0 ms decision | not measured |
| callback→ShapeSource p50 | 36.5 ms | not measured |
| stationary raw fixes/min | 12 in nominal first window | not measured |
| stationary accepted distance | 0 m in nominal first window | not measured |
| visible turn lag | inferred 7 s Candidate/source interval | not measured |
| RNMapbox coordinate interval p50 | 1 s | not measured |
| RNMapbox coordinate interval p95 | 6 s | not measured |
| RNMapbox→canonical lead distance p50 | 4.19 m | not measured |
| RNMapbox→canonical lead distance p95 | 8.34 m | not measured |

Machine-readable placeholders and schema are in [O44_AB_SUMMARY.json](./O44_AB_SUMMARY.json) and [O44_SOURCE_TIMELINE.csv](./O44_SOURCE_TIMELINE.csv). They contain no fabricated native results.

## 9. Architecture decision rule

No production path can be selected honestly before the native A/B. The evidence-backed sequence is:

1. Test Path A's smallest premise: whether 1 m materially improves the Cairn raw/canonical cadence without stationary distance inflation, worse accuracy population, visible jitter, or unsafe telemetry/journal load.
2. If 1 m closes most of the RNMapbox lead, prefer **Path A** because it preserves current authority and has the smallest architectural surface.
3. If RNMapbox remains materially fresher even at 1 m, investigate **Path B**: one Cairn-owned raw source feeding canonical and presentation, while Cairn—not the map component—remains Activity authority.
4. Consider **Path C** only if conservative handling of 25–40 m evidence still creates meaningful weak-signal divergence after source cadence is fixed. A provisional source must remain display-only.
5. Escalate to **Path D** only if 1 m shows Expo/Core Location cadence, batching, or lifecycle behavior is still an important limitation that a Cairn-owned native provider can measurably improve.

A visual provisional tail is not the first correction while the 5 m bottleneck remains untested. It cannot affect Activity truth, metrics, Memory, matching input, or gaps.

## 10. Validation

- New deterministic cadence/privacy tests: 5/5 pass.
- Focused tracking/cadence/telemetry retention set: 47/47 pass across 3 suites.
- Changed-file verification routing selects Activity Core as intended.
- The existing Core router completed 30/31 suites and 301/308 tests. Its only failure was the unrelated pre-existing `v409-offlineQueue.test.ts`, whose seven tests import legacy `readQueueSnapshot`/`clearQueue` functions that the current module does not export. Neither file was changed for O44; this was classified as an existing test/contract mismatch, not retried to green.
- Scoped TypeScript output contains no diagnostics for the O44-touched files.
- No backend source, telemetry schema, native dependency, RNMapbox configuration, canonical filter, or Activity business rule was changed.
- The single Home marker was incremented once from O43 to O44 after focused validation. No OTA was published and no app/runtime/build version changed.

## 11. Current answers pending native evidence

1. **5 m causally confirmed?** Strong O43 evidence; final controlled causal confirmation pending A/B.
2. **1 m callback p50/p95?** Pending native B.
3. **1 m accepted p50/p95?** Pending native B.
4. **Stationary noise worse?** Pending native B.
5. **Route quality worse?** Pending native B and human turn observation.
6. **RNMapbox stream advantage?** O44 can now measure coordinate fixes correctly; magnitude pending.
7. **RNMapbox lead?** O44 can now measure relative metres; distribution pending.
8. **25 m gate bypassing Candidate evidence?** Yes structurally; usefulness of the points is not proven.
9. **Counterfactually Candidate-worthy?** Four of ten, with medium confidence; zero can be called eventual Confirms from retained evidence.
10. **Why ~2 s takeover?** Explicit AppState debounce protecting source-restart churn; RNMapbox restarts independently and earlier.
11. **Why no O43 background?** Foreground-only permission plus the persisted education flag suppressing a new request despite `canAskAgain=true`.
12. **Architecture path?** Final selection pending A/B; Path A is the first premise under test, with B/C/D gated by measured failure modes.
13. **Unproven:** 1 m native cadence/quality/load, exact RNMapbox advantage, exact rejected-point geometry/confirmability, rendered-dot timing, whether Always authorization works reliably on this physical build, and the final architecture path.
