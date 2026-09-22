# O44 native A/B forensic

Date: 2026-09-11 (Asia/Shanghai)

## Verdict

**The attempted A/B is invalid: both saved real Hikes ran the 5 m foreground distance filter. There is no native 1 m sample in production telemetry.**

This is proven by the critical `activity_location_cadence_experiment_v1` emitted at each Activity Start. Both events contain `variant=distanceFilter5`, `foregroundDistanceFilterM=5`, and `debugMode=false`. The second Activity is named `1m`, but its name is not runtime configuration authority. Immediately before it, telemetry shows Hike opened with Debug Mode on at 09:44:22.283, then opened with Debug Mode off at 09:44:31.954; Activity Start occurred at 09:44:35.297. The experiment resolver requires Internal build **and Debug Mode on at Start**, so it correctly fell back to 5 m.

Consequently:

- the exact 1 m raw/canonical cadence is **NOT MEASURED**;
- the human-perceived improvement cannot be attributed to 1 m;
- 1 m is not yet a production candidate;
- the two walks are still valuable independent 5 m incidents, and the reported final stall is fully reconstructable.

Machine-readable evidence:

- `O44_AB_SUMMARY.json`
- `O44_NATIVE_AB_TIMELINE.csv`
- `O44_1M_STALL_TIMELINE.csv` (filename retained from the reported incident; the Activity actually ran 5 m)

No absolute coordinates appear in these artifacts.

## Sessions

| Intended role | Activity | Server ID | qaSessionId | Shanghai Activity time | Runtime identity | Events / bytes |
| --- | --- | ---: | --- | --- | --- | ---: |
| 5 m baseline | `5m` | 2069 | `qa-mtwajfzr-1w5yy6u6` | 09:41:59–09:43:46 | `distanceFilter5`, Debug off | 289 / 279,313 |
| intended 1 m | `1m` | 2070 | `qa-mtwamspt-nrelihji` | 09:44:35–09:46:30 | **`distanceFilter5`, Debug off** | 403 / 404,332 |

Both are real foreground Hikes, app version `0.2.6`, saved and server-synced. No AppState/provider restart occurred during the selected stall.

## Main metrics

These are two observed 5 m sessions, labelled A and B. They are not treatment arms.

| Metric | Walk A: named `5m`, actual 5 m | Walk B: named `1m`, actual 5 m |
| --- | ---: | ---: |
| Raw points | 16 | 21 |
| Raw fixes/min, whole Activity | 9.90 | 12.00 |
| Raw fixes/min, protocol middle window | 7.32 | 11.85 |
| Raw interval p50 / p90 / p95 / max | 5.903 / 9.895 / 10.622 / 12.107 s | 4.501 / 7.100 / 8.150 / 11.000 s |
| Raw displacement p50 / p95 | 5.58 / 20.88 m | 5.76 / 6.49 m |
| Accuracy p50 / p95 | 14.25 / 26.93 m | 14.25 / 14.25 m |
| Native source age at Cairn callback p50 / p95 | 79.5 / 98.5 ms | 96 / 106 ms |
| Canonical points | 10 | 15 |
| Canonical fixes/min, whole Activity | 6.19 | 8.57 |
| Canonical fixes/min, middle window | 5.23 | 10.94 |
| Canonical interval p50 / p95 / max | 4.999 / 16.604 / 16.981 s | 5.000 / 16.286 / 21.000 s |
| Canonical/raw ratio | 62.5% | 71.43% |
| Hard accuracy rejects | 4 (25%) | 0 |
| Other canonical suppression | 0 | 1 stationary suppression |
| Candidate creations / quarantine decisions | 2 / 2 | 5 / 6 |
| Candidate outcomes | 2 timeout-drops | 4 timeout-drops, 1 confirm |
| Callback→decision p50 / p95 | 0 / 1 ms | 0 / 1 ms |
| Callback→ShapeSource, current accepted fix p50 / p95 | 36.5 / 43.2 ms | 41.5 / 50.8 ms |
| Native timestamp→ShapeSource, current accepted fix p50 / p95 | 128 / 134.6 ms | 138.5 / 156.4 ms |
| Saved distance / elevation | 73.53 m / 0 m | 105.18 m / 0 m |

Walk B's raw p50 was 23.76% lower and raw p95 23.27% lower than Walk A, but both used 5 m. Canonical median cadence was unchanged (4.999 versus 5.000 s) and p95 improved only 1.92%. The central-window rate difference and better subjective feel correlate with Walk B's uniformly better accuracy and steadier RNMapbox delivery, not a configuration treatment.

The human's normal 2–3 second impression does match Walk B's RNMapbox→canonical time lead p50 of 3.001 s. It does **not** prove 1 m, because that walk was still 5 m.

## RNMapbox versus Cairn source

| Metric | Walk A, actual 5 m | Walk B, actual 5 m |
| --- | ---: | ---: |
| RNMapbox coordinate fixes while tracking | 63 | 106 |
| RNMapbox interval p50 / p95 / max | 1 / 6 / 7 s | 1 / 1 / 1 s |
| RNMapbox displacement p50 / p95 | 1.11 / 11.97 m | 1.26 / 2.23 m |
| RNMapbox accuracy p50 / p95 | 14.25 / 26.92 m | 14.25 / 14.25 m |
| RNMapbox source age p50 / p95 | 99 / 354 ms | 1.087 / 1.094 s |
| RNMapbox lead over latest Cairn raw p50 / p95 | 3.991 / 8.961 s | 2.001 / 6.001 s |
| RNMapbox distance from latest Cairn raw p50 / p95 | 2.91 / 10.74 m | 3.13 / 6.07 m |
| RNMapbox lead over latest canonical p50 / p95 | 4.996 / 15.144 s | 3.001 / 14.851 s |
| RNMapbox distance from latest canonical p50 / p95 | 4.19 / 8.34 m | 4.66 / 11.96 m |

RNMapbox did not show a materially worse accuracy population. When a Cairn raw observation existed, the nearest RNMapbox source estimate was usually the same system estimate: accuracy difference p50 was 0 m in both sessions; Walk B p95 difference was 0.22 m. Walk B's matching RNMapbox JS event arrived about one second after the Cairn callback, but RNMapbox received many additional one-second source coordinates between Cairn's sparse 5 m callbacks. “Fresher stream” therefore means more source estimates, not that RNMapbox always receives a shared estimate earlier.

In Walk A, 57 RNMapbox events had accuracy ≤25 m; 48 were more than one second ahead of the latest Cairn raw and 25 were more than five seconds ahead of canonical. In Walk B the corresponding values were 106, 81, and 38.

This proves the current dual-5 m arrangement creates phase divergence. It does not answer whether dual providers remain materially divergent when Cairn genuinely runs at 1 m.

## Selected final stall

The best match is in `qa-mtwamspt-nrelihji` from 09:45:57.154 to 09:46:18.152 Shanghai.

The complete route stall was **20.998 s**, not only seven seconds. The human-reported seven seconds corresponds to the raw 19→20 subinterval. During the complete stall:

- RNMapbox emitted 21 events with 21 unique source timestamps and 21 changed coordinates;
- RNMapbox source interval was exactly 1 s;
- cumulative one-second step displacement was 18.40 m;
- distance from last canonical grew to 14.92 m;
- RNMapbox accuracy remained exactly 14.25 m;
- Cairn received only raw 19, 20, and 21 at 6, 7, and 8 s intervals;
- all Cairn callback decisions took 0–1 ms;
- no lifecycle transition, watcher restart, 25 m rejection, or downstream render delay occurred.

### Causal chain

1. Raw 18 was accepted and ShapeSource version 14 published at 09:45:57.154.
2. Raw 19 arrived after 6 s: 5.37 m displacement, reported speed 0.40 m/s, accuracy 14.25 m. It became `possible-stationary-jitter` Candidate.
3. Candidate 19 reached its 5 s wall-clock bound before another 5 m Cairn callback and was dropped without canonical publication.
4. Raw 20 arrived 7 s after raw 19: another 5.13 m raw-to-raw progression, reported speed 0.10 m/s. It became a new Candidate.
5. Candidate 20 also timed out after 5 s before the next Cairn callback and was dropped.
6. Raw 21 arrived 8 s later: another 5.73 m raw-to-raw progression and reported speed 0.87 m/s. It bypassed stationary quarantine, was immediately accepted, and ShapeSource version 15 was requested 48 ms later with a 14.92 m edge from raw 18.

Classification:

- **S1 — Cairn source silence: PROVEN contributor.** RNMapbox had changed coordinates each second between 5 m Cairn callbacks.
- **S2 — 25 m rejection: ABSENT.** Accuracy was 14.25 m throughout.
- **S3 — Candidate/quarantine: PROVEN contributor.** Two coherent-looking low-speed callbacks were dropped because the five-second Candidate clock was shorter than the next 5 m callback interval.
- **S4 — accepted but display late: REJECTED.** Raw 21 reached ShapeSource in 48 ms.
- **S5 — lifecycle/provider restart: REJECTED.** No relevant lifecycle/ownership event occurred.
- **S6 — UI semantic mismatch: PROVEN.** “GPS good” tolerated this whole interval.
- **S7 — separate presentation path: PROVEN.** RNMapbox continued receiving changed source coordinates and assigning UserLocation targets.

This is a mixed source-cadence plus Candidate-policy interaction. It is not smoothing or React/Mapbox line-render latency.

## Why the GPS indicator stayed green

Hike's real-GPS green state is:

```text
tracking
+ locationAvailable
+ at least one canonical track point exists
+ age of last canonical track point <= 120 seconds
```

`locationAvailable` means the Activity provider is active; it is not per-fix quality. `Finding GPS` appears only before a first canonical point (or when permission/provider availability fails). `Signal lost` requires more than 120 seconds without an accepted point.

The selected stall's maximum canonical age was 21.1 s, so the UI remained green by design. Even O45 diagnostic `canonicalHealth` uses a 30 s freshness boundary and therefore remained `fresh`. Green meant roughly “provider active and not missing canonical GPS for two minutes,” while a user could reasonably read it as “fresh route evidence.” Recommendation only: future UI should separately communicate source availability and route-evidence freshness, or define green against a much more explicit semantic contract.

## Stationary check

There is no 1 m stationary comparison.

- Walk A first nominal 20 s: four raw observations wandered 49.11 m cumulatively with ~26.93 m accuracy; all were rejected, adding zero canonical distance. This is a successful protection case.
- Walk A final nominal 20 s was not stationary according to telemetry: speed p50 1.01 m/s and 27.21 m canonical movement.
- Walk B first nominal 20 s: five raw observations moved 20.29 m cumulatively at speed p50 0.07 m/s. Raw 2 was suppressed and raw 3 quarantined/dropped, but raw 4 was accepted as a 14.15 m canonical edge. The protocol plus low reported speed support a stationary-jitter interpretation, although exact human stop timing was not instrumented.
- Walk B final nominal 20 s: raw 19 and 20 were quarantined/dropped, but raw 21 added a 14.92 m edge. The protocol suggests a stop; reported speed 0.87 m/s prevents proving from telemetry alone that the final edge was false.

Thus the O45 stationary Candidate works in some cases but is not proven sufficient. Raw 4 demonstrates its accuracy-aware cluster radius can be narrowly exceeded by low-speed stationary evidence. No code is changed here.

## Turn behavior

Exact human turn timestamps were not supplied, so these are inferred:

- Walk A's strongest coherent direction change is 09:43:10–09:43:17. Raw 10 was quarantined at 94.81°/0.04 m/s; RNMapbox continued one-second updates; raw 11 was accepted seven seconds later with an 88.51° heading delta. The line then stabilized through raw 12–16.
- Walk B's strongest sustained change is approximately 09:45:20–09:45:28. Raw 10 accepted promptly, raw 11 became Candidate, and raw 11+12 were published together when confirmed four seconds later.

Both used 5 m, so no 1 m turn-preservation conclusion is possible.

## Architecture evidence

| Architecture | What these walks establish | Remaining risk / unknown | Current forensic position |
| --- | --- | --- | --- |
| Dual providers, Cairn 5 m | RNMapbox is commonly 2–9 s ahead of Cairn raw and 3–15 s ahead of canonical | Ordinary phase divergence and Candidate timeout interaction | Not an acceptable final answer without further correction |
| Dual providers, Cairn 1 m | Nothing native—the intended variant did not activate | Battery, stationary quality, callback/load, residual lead | Must be measured before selection |
| One Cairn-owned high-cadence raw source | A common raw clock would remove provider-phase ambiguity; presentation and canonical policies can still differ | Requires native/provider/lifecycle design; does not by itself fix bad Candidate classification | Supported for investigation, not selected |
| Canonical plus provisional display evidence | The stall had 21 accurate-looking changed RNMapbox coordinates while canonical froze | Must never become metrics, Memory, persistence, matching input, or gap repair | Potentially useful for uncertainty only; not a substitute for valid 1 m or Candidate repair |

A common high-cadence source would likely remove most *provider* phase divergence. It would not automatically remove canonical pauses: the final stall also shows Candidate timeouts discarding coherent raw-to-raw progression. The safer sequence is to obtain a valid 1 m sample, then decide whether residual dual-provider lead justifies unification, and separately correct Candidate behavior using incident evidence.

## What remains unproven

- Any iOS 1 m callback, accepted, stationary, accuracy, battery, journal, or telemetry-load metric.
- Whether dual providers remain meaningfully out of phase at 1 m.
- Whether a real 1 m cadence would corroborate ambiguous Candidates before their five-second bound.
- Exact physical stop and 90° turn timestamps.
- Rendered 60 fps UserLocation position; O44 instruments source coordinates and target assignment, not GPU interpolation.
- Whether the final 14.92 m edge was genuine slow movement or stationary drift.
- Battery impact and long-session storage behavior at 1 m. Both 5 m sessions remained within QA bounds, though Walk B reached 404,332 bytes in 105 seconds; protected critical retention, not full routine-event retention, is the long-session guarantee.

## Smallest valid follow-up

Repeat only the intended `1 m experiment` walk. Keep Debug Mode on through Activity Start and verify the visible selection immediately before starting. The first required proof is the uploaded critical event:

```text
variant=distanceFilter1
foregroundDistanceFilterM=1
```

No second 5 m walk is necessary; Walk A is a valid baseline. No architecture or product-policy change should be made from the invalid comparison.

## Data sources and safety

- Operations-only telemetry list/exact-session endpoints inside the production backend container.
- Read-only production `sessions` lookup by privacy-safe client Activity suffix.
- Current source for the experiment resolver, continuity reducer, telemetry, and Hike GPS UI.
- No telemetry row, database row, runtime source, test, configuration, backend, OTA, or deployment was mutated.
