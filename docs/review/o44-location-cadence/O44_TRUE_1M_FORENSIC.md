# O44 true-1m real-walk forensic

Forensic date: 2026-09-11. Repository state: O45 working tree over Git `4fb85bc3173aff11fd4ff7b34ce7feefc561d9cc`. Analysis only; no runtime, test, tracking configuration, telemetry, OTA, backend, or production-data mutation is authorized or contained here.

Status terms: **OBSERVED** is human-reported or directly recorded; **PROVEN** follows from retained telemetry/current source; **SUPPORTED** fits all retained evidence but lacks a rendered-frame or physical reference; **NOT PROVEN** marks missing evidence.

## Verdict

The walk was definitively `distanceFilter1`. It proves two independent facts:

1. **Source cadence works:** on the outbound straight section, Cairn received and canonically persisted 19/19 fixes at 1.0 s median / 2.0 s p95, and requested each ShapeSource update about 41 ms after callback. This explains the tester's extremely responsive early experience.
2. **The return-leg hesitation is a canonical-classification defect, not source silence:** raw positions continued coherently at about 1.07–1.09 m/s, but Core Location reported only about 0.09 m/s. The current stationary Candidate logic trusted that low scalar, then required a corroborating step of at least 2 m even though true-1m callbacks were usually 1–2 m apart. Fourteen candidates were rejected and a second downstream stationary gate suppressed additional reducer `ACCEPT`s. The line repeatedly waited for a roughly 15 m anchor escape/catch-up.

The early line's chunkiness is a presentation-clock issue: confirmed geometry updates at each fix, while RNMapbox `UserLocation` animates each target over 1,000 ms. There is no line-endpoint interpolation.

## Session proof

| Field | Value | Evidence |
|---|---|---|
| Activity | `new 1m`, Hike, server session `2071` | Production session row, read-only |
| `qaSessionId` | `qa-mtwc6yfx-vpqea6di` | QA telemetry row and Activity suffix correlation |
| Variant | `distanceFilter1` | `activity_location_cadence_experiment_v1` |
| Foreground filter | `1 m` | Same event: `foregroundDistanceFilterM=1` |
| Desired accuracy | `BestForNavigation` | Same event |
| Canonical/RNMapbox confounds | both explicitly unchanged | Same event |
| Debug at start | `true`; Simulator `false`; provider `real` | `qa_session_started` / cadence event |
| Tracking | 10:28:15.611–10:30:19.124 Shanghai | lifecycle telemetry |
| Activity server time | 10:28:15–10:30:27 Shanghai | production row |
| QA end/upload | 10:30:28.773 / 10:30:37 Shanghai | telemetry metadata |
| App / native build | 0.2.6 / 56, iOS 26.6.1 | telemetry metadata |
| OTA marker | Current source says O45; marker is not telemetered | code-proven/current-tree, runtime marker **NOT directly proven** |
| Raw/canonical/display | 77 / 30 / 30 | completion event and production JSON |
| Stored distance/elevation | 112.173 m / 0 m | completion event |

The 5 m baseline is `qa-mtwajfzr-1w5yy6u6`, Activity `5m`, session `2069`, explicitly `distanceFilter5`.

## Main A/B evidence

| Metric | Valid 5 m baseline | True 1 m |
|---|---:|---:|
| Raw points | 16 | 77 |
| Raw fixes/min, protocol middle | 7.50 | 42.49 |
| Raw interval p50 / p90 / p95 / max | 5.903 / 9.895 / 10.622 / 12.107 s | 1.000 / 2.000 / 2.000 / 8.999 s |
| Raw displacement p50 / p95 | 5.58 / 20.88 m | 1.34 / 3.03 m |
| Accuracy p50 / p95 / max | 14.25 / 26.93 / 26.93 m | 14.25 / 14.25 / 24.64 m |
| Native timestamp age p50 / p95 | 79.5 / 98.5 ms | 107 / 124 ms (66 retained observations) |
| Canonical points | 10 | 30 |
| Canonical fixes/min, protocol middle | 5.35 | 19.67 |
| Canonical interval p50 / p95 / max, whole session | 4.999 / 16.604 / 16.981 s | 1.000 / 19.600 / 21.996 s |
| Canonical interval p50 / p95, outbound straight | not isolated | **1.000 / 2.000 s** |
| Canonical/raw persisted ratio | 62.5% | 39.0% |
| Filter decisions | 10 accept, 4 accuracy reject, 2 quarantine | 37 accept, 14 stationary reject, 17 quarantine |
| Candidates confirmed / rejected / timeout | 0 / 0 / 2 | 3 / 14 / 0 |
| Callback→decision p50 / p95 | 0 / 1 ms | 0 / 1 ms |
| Callback→ShapeSource p50 / p95 | 36.5 / 43.2 ms | 41 / 72.85 ms |
| Native timestamp→ShapeSource p50 / p95 | 128 / 134.55 ms | 142.5 / 185.4 ms |
| RNMapbox coordinate events | 63 | 96 |
| RNMapbox interval p50 / p95 / max | 1 / 6 / 7 s | 1 / 1 / 1 s |
| RNMapbox accuracy p50 / p95 | 14.25 / 26.92 m | 14.25 / 14.25 m |
| RNMapbox→latest Cairn raw lead time p50 / p95 | 3.981 / 8.961 s | **0.001 / 1.251 s** |
| RNMapbox→latest Cairn raw lead distance p50 / p95 | 2.91 / 10.74 m | **1.17 / 2.12 m** |
| RNMapbox→canonical lead time p50 / p95 | 4.984 / 15.144 s | 3.001 / 18.250 s |
| RNMapbox→canonical lead distance p50 / p95 | 4.19 / 8.34 m | 3.94 / 14.25 m |

The raw median improved 83.1%, raw p95 improved 81.2%, and middle-window source rate rose 5.67×. Whole-session canonical p95 is worse only because the return classifier stalls; it is not evidence against 1 m source cadence.

## Phase split

| Phase | Raw ordinals | Raw p50/p95 | Canonical points | Canonical p50/p95 | Candidates | Meaning |
|---|---|---:|---:|---:|---:|---|
| Opening | 1–12 | 1.255 / 6.999 s | 4/12 | 2.255 / 2.926 s | 1 | Probable stationary/settling interval; not a quality example. |
| Outbound straight | 13–31 | **1.000 / 2.000 s** | **19/19** | **1.000 / 2.000 s** | 0 | DR1 normal coherent immediate-accept contract works. |
| Turn/first return | 32–43 | 1.000 / 2.000 s | **1/12** | — | 4 | Source stays healthy; canonical line waits 19 s. |
| Return continuation | 44–64 | 1.000 / 2.000 s | 5/21 | 2.500 / 6.400 s | 7 | Repeating Candidate/downstream suppression. |
| Ending return | 65–77 | 2.000 / 2.000 s | 1/13 | — | 5 | Another 20 s catch-up edge. |

## Early responsive/chunky interval

Raw 13–31 (10:28:45.001–10:29:07.999) is the clean representative interval:

- all 19 raw fixes were accepted and persisted canonically;
- raw and canonical p50/p95 were 1.0/2.0 s;
- ShapeSource received 19 updates with 1.005/2.001 s p50/p95;
- reported speed p50/p95 was 0.782/1.156 m/s;
- position-implied speed p50/p95 was 1.298/1.668 m/s;
- there were no Candidates or rejections;
- every ShapeSource request represented one newly confirmed endpoint; there is no line interpolation or batching in this interval.

That establishes **low factual latency** and simultaneously explains **hard visual steps**. RNMapbox changes the `UserLocation` target every second and animates for 1,000 ms. The Activity line replaces its GeoJSON endpoint at the next accepted commit and Mapbox paints a static LineLayer.

## Why the line could look slightly ahead of the puck

**SUPPORTED, not pixel-proven.** For all 24 correlated live updates, the RNMapbox source timestamp and Activity sequence timestamp matched within 0–1 ms. `map_user_location_target` occurred first; the ShapeSource request followed 32 ms median / 54.85 ms p95 (42/55 ms in the outbound interval). Current installed `UserLocation` Normal behavior animates the marker toward its new target for 1,000 ms. The line adopts its new endpoint immediately after the durable canonical commit. During most of that one-second marker animation the line endpoint can therefore sit ahead of the rendered marker centre.

Rendered puck frames are not instrumented, so the exact pixel lead is **NOT PROVEN**. Current Activity smoothing cannot overshoot the latest accepted point: it is a convex blend between the prior live coordinate and the new observation, followed only by movement toward that observation. It can lag/cut a corner within its 2–6 m bound; it cannot extrapolate beyond the measurement.

## Turnaround/backtrack forensic

The strongest reversal is at raw 31→32, around 10:29:08–10:29:11. Raw 31 was the farthest outbound point from the start. Raw 32 turned approximately 101° relative to the previous small edge, raw 33 changed another 87°, and subsequent positions progressed back toward the origin.

The decisive evidence is not angle alone:

| Phase | Position-implied speed p50 / p95 | Core Location reported speed p50 / p95 |
|---|---:|---:|
| Outbound raw 13–31 | 1.298 / 1.668 m/s | 0.782 / 1.156 m/s |
| Turn raw 32–43 | **1.069 / 1.264 m/s** | **0.085 / 0.112 m/s** |
| Return raw 44–77 | **1.091 / 1.427 m/s** | **0.092 / 0.248 m/s** |

Core Location's reported speed became contradictory to the coordinate progression at the turn and stayed low for the return. Public telemetry cannot establish why the OS produced those values; their provenance is **UNKNOWN**.

The current reducer then behaved as follows:

1. Raw 32–34 were reducer `ACCEPT:coherent-motion`, but the second legacy stationary gate suppressed them because each low-speed displacement remained within its 2–4 m radius.
2. Raw 35 was 4.46 m from the sticky canonical anchor and became `possible-stationary-jitter` Candidate.
3. Raw 36 progressed another 1.69 m, but Candidate confirmation demands at least 2 m corroboration and at least 2 m extra direct progress. It was rejected as `stationary-cluster-suppressed`.
4. The same pattern repeated for raw 37–42. RNMapbox→canonical distance grew to 15.02 m.
5. Raw 43 finally escaped the cluster radius, accepted, and requested ShapeSource 160 ms after its native timestamp—**19 s after raw 31**.
6. The pattern recurred. Candidate pairs resolved quickly but usually rejected: raw 52/53 confirmed after 1 s at ~15.2 m from the prior anchor; raw 63/64 confirmed after 2 s because the corroborating step reached 2.01 m; raw 77 created another 16.25 m catch-up edge after 20 s.

This is not H1 source silence, smoothing lag, journal lag, or ShapeSource lag. It is layered canonical suppression driven by an unreliable low reported-speed value and confirmation constants tuned around larger steps.

### Direction/reversal answer

No current rule categorically rejects a U-turn. Large-heading Candidate classification applies only to large (normally ≥18 m) innovations. The first post-turn 1–2 m fixes were accepted by the physical reducer. However, reversal/progression angles participate in stationary Candidate resolution, and the low-speed branch assumes that each corroborating fix should progress by at least 2 m. It therefore **indirectly penalizes this legitimate reversal/backtrack** after native speed became low.

The strongest proof is that many rejected pairs had tiny reversal angles—0.65°, 1.51°, 4.9°, 10–25°—yet were still rejected. Direction change was not the principal cause; scalar speed classification and cadence-mismatched progression requirements were.

## Candidate results

All 17 Candidates resolved in 1–2 seconds; none timed out. Thus 1 m makes the five-second wall-clock concept operationally viable. It does not make the classifier correct.

| Candidate raw | Resolution raw | Delay | Result | Corroborating step | Pair reversal |
|---:|---:|---:|---|---:|---:|
| 3 | 4 | 1 s | confirm | 7.12 m | 2.99° |
| 35 | 36 | 2 s | reject | 1.69 m | 34.60° |
| 37 | 38 | 2 s | reject | 1.17 m | 12.26° |
| 39 | 40 | 2 s | reject | 1.81 m | 24.60° |
| 41 | 42 | 1 s | reject | 1.24 m | 22.94° |
| 46 | 47 | 1 s | reject | 1.39 m | 4.90° |
| 48 | 49 | 2 s | reject | 1.32 m | 15.62° |
| 50 | 51 | 1 s | reject | 1.20 m | 1.51° |
| 52 | 53 | 1 s | confirm | 1.20 m | 11.89° |
| 59 | 60 | 1 s | reject | 1.36 m | 0.65° |
| 61 | 62 | 1 s | reject | 1.17 m | 20.63° |
| 63 | 64 | 2 s | confirm | 2.01 m | 0.37° |
| 67 | 68 | 1 s | reject | 1.09 m | 10.51° |
| 69 | 70 | 2 s | reject | 1.88 m | 41.29° |
| 71 | 72 | 2 s | reject | 1.72 m | 42.81° |
| 73 | 74 | 2 s | reject | 1.47 m | 26.69° |
| 75 | 76 | 2 s | reject | 1.52 m | 14.87° |

## Stationary check

The protocol timing is not separately telemetered, so physical stationarity is inferred from the approximately 20-second endpoint windows, low reported speed, and the abrupt transition to normal outbound speed. It is highly likely at the opening and consistent with the intended experiment, but exact human stop time is **NOT independently instrumented**.

| Window | Raw | Raw path/net | Reported speed p50 | Canonical | Canonical path/net | Finding |
|---|---:|---:|---:|---:|---:|---|
| 5 m opening 20 s | 4 | 49.10 / 6.87 m | unavailable | 0 | 0 / 0 m | Accuracy >25 m rejected all; no false canonical movement. |
| True-1m opening 20 s | 10 | 22.65 / 13.47 m | 0.074 m/s | 4 | **19.25 / 14.51 m** | Stationary contract not controlled; likely false movement entered truth. |
| True-1m final 20 s | 14 | 17.64 / 16.25 m | 0.099 m/s | 2 | **16.25 / 16.25 m** | One large catch-up edge; likely false if tester had already stopped. |

The opening canonical path/net ratio is 1.33—not a severe wool ball, but still a V/Z-like false traversal and distance. The current synthetic `STATIONARY_GPS_JITTER_SPAGHETTI` fixture oscillates in larger 4–10 m steps; its slow-walk counter-test uses 5 m steps. Neither covers coherent-looking 1–2 m drift plus contradictory reported speed. True 1 m exposes that fixture gap.

## RNMapbox versus Cairn at 1 m

RNMapbox still emitted more coordinate events (96 versus 77 Cairn raw), but the ordinary phase divergence mostly disappeared:

- RNMapbox interval was 1.0/1.0 s p50/p95; Cairn raw was 1.0/2.0 s.
- RNMapbox→Cairn raw lead was 1 ms median, 1.251 s p95, and 1.17/2.12 m.
- Accuracy populations were indistinguishable at p50/p95 (14.25/14.25 m).
- In the outbound interval, ShapeSource and RNMapbox source timestamps matched to 0–1 ms.
- The large RNMapbox→canonical lead on return (3.0 s median, 18.25 s p95, 14.25 m p95) was created after both source managers delivered evidence, by Cairn's canonical gates.

Therefore dual providers are no longer the principal Normal-condition problem at 1 m. A single Cairn-owned high-cadence source remains a clean long-term authority model, but these walks do not justify paying its native/custom-puck complexity as the next fix. It would not solve the return hesitation.

## Historical conclusion

See `HISTORICAL_CC_TRACKING_COMPARISON.md`. The final integrated old tree is `a9157af`; `95302b8` is the direct live-render change that made the Hike line use the strong Kalman derivative. The old implementation did not have a mutable tail or line animation, and its reported-speed stationary radius would also be vulnerable to this return trace.

The reusable old idea is a deliberately calm presentation derivative separate from metric truth. The unsafe details are strong whole-history Kalman lag/endpoint movement, scalar-speed authority, sticky accuracy-sized stationary radius, lost raw teleports, native-timestamp replacement, and old lifecycle ownership.

## Recommended next design (not implemented)

1. Treat 1 m as a credible production candidate for factual responsiveness, pending battery/long-duration load validation.
2. Make one physical-continuity reducer the sole canonical transition authority; remove or formalize the contradictory downstream stationary suppression.
3. Replace `reported speed <0.5` as a stationary verdict with a rolling, uncertainty-aware motion state. Accept sustained position-implied progression over several 1–2 m fixes even when reported speed is low; stationary jitter should remain bounded/reversing inside a confidence region.
4. Make Candidate confirmation cumulative/cadence-aware rather than requiring one ≥2 m corroborating step. Do not penalize a U-turn once a new coherent direction is established.
5. Add a renderer-only temporal interpolation for the newest **confirmed accepted** endpoint in Normal conditions. It changes no distance, Memory, persistence, matching, gap, or canonical truth.
6. Keep RNMapbox's provider for now. Reconsider one Cairn-owned source only after the reducer/presentation fixes, or if later evidence shows residual source-phase divergence.
7. Defer a provisional raw/puck tail to genuinely ambiguous/weak-signal states. It is not needed to hide normal source cadence after 1 m and must never affect Activity truth.

## Evidence artifacts

- `O44_TRUE_1M_TIMELINE.csv`: every saved raw point with privacy-safe relative motion, decisions, canonical membership, nearest RNMapbox source, and ShapeSource checkpoint.
- `O44_BACKTRACK_TIMELINE.csv`: raw 20–77, covering the complete outbound-to-return transition and hesitation.
- `HISTORICAL_CC_TRACKING_COMPARISON.md`: commit archaeology and semantic comparison.

No absolute coordinate, account identity, token, cookie, or secret is included.
