# OTA55 real-versus-simulated GPS calibration

Date: 2026-09-13  
Candidate: **OTA55**  
Claim: **calibrated behavioral similarity for Cairn QA, not physical GNSS/Core Location equivalence**

## Outcome

The OTA55 `Realistic GPS` observation model was fitted to the retained Cairn field corpus before its constants were chosen. It reproduces the product-relevant regime: second-scale but irregular fixes, a persistent two-dimensional error bias, smaller correlated jitter, reported accuracy that is informative but imperfect, continued drifting observations while the person is still, rare larger excursions with a recovery tail, and bias memory across stop-to-move transitions.

The strongest calibration comparison uses six sessions with direct `route_points_raw` evidence (1,072 de-duplicated fixes) and the documented raw-246 stop in `snap`. Exact production coordinates are read-only inputs and are never written to OTA55 review artifacts; retained output is aggregates and local-metre offsets only.

## Real evidence available

| Activity | Evidence class | De-duplicated fixes | Calibration use |
|---|---|---:|---|
| `back` | full raw point stream | 178 | cadence, hAcc, inferred moving residuals |
| `snap` | full raw point stream | 426 | cadence, hAcc, moving residuals, documented Stop-V/stationary/outlier recovery |
| `great hike` | full raw point stream | 99 | cadence, hAcc, inferred moving residuals |
| `run issue` | full raw point stream | 117 | cadence, hAcc, inferred moving residuals |
| `mstand` | full raw point stream | 40 | cadence, hAcc, inferred moving residuals |
| `something run` | full raw point stream | 212 | cadence, hAcc, inferred moving residuals |
| `bad run` | normalized/raw-like persisted evidence | 230 | qualitative lifecycle/source comparison only; excluded from the raw calibration pool |

`route_points_raw` is the server's retained pre-canonical point stream. De-duplication removes exact duplicate persisted fixes without re-sampling time or geometry.

## Real evidence unavailable

| Activity | Evidence class | Limitation |
|---|---|---|
| `hike ka` (server name `ka`) | canonical only | 138 canonical points are useful for route regression, not sensor-noise calibration |
| `lost run` | canonical only | 245 canonical points; raw error and fix cadence cannot be recovered honestly |
| `wrong2` | retained forensic summary only | no point-level row available; used only as product evidence for stationary/source-health behavior |

No activity has surveyed centimetre-level ground truth. Moving error therefore uses a bounded local chord inferred from four fixes on either side of each fix, only where the window spans at least 12 m and no more than 45 seconds. That supports useful lateral/longitudinal residual comparisons, but it is not an absolute receiver-error measurement. `snap` has a documented physical stop, so its stationary analysis is stronger; the raw-246 position is still an observed anchor rather than a surveyed coordinate.

## Measured distributions

Across the six full-raw sessions:

- fix interval p50 `1.000 s`, p75 `3.000 s`, p95 `6.023 s`, maximum `66.001 s`;
- `24.789%` of intervals exceeded 3 s and `2.347%` exceeded 10 s;
- one duplicate/batched timestamp occurred;
- hAcc median/p75/p95 was `14.246 m`, minimum `3.193 m`, maximum `55.779 m`;
- per-session inferred moving lateral p50 ranged from `0.537–3.291 m`, with a median-of-session-p50 of `1.417 m`;
- median-of-session moving short-step jitter p50 was `0.802 m`.

The repeated `14.246 m` hAcc plateau is a property of retained Core Location data and limits confidence in fine-grained hAcc distribution fitting. OTA55 therefore matches its central regime while allowing a smoother, broader synthetic distribution rather than cloning the plateau.

## Temporal correlation analysis

The selected short-term persistence measure is lag-one correlation of signed inferred lateral residual during coherent moving windows. Per-session values were:

| Activity | Lag-one lateral correlation |
|---|---:|
| `back` | 0.869 |
| `snap` | 0.796 |
| `great hike` | 0.157 |
| `run issue` | 0.843 |
| `mstand` | 0.765 |
| `something run` | 0.754 |

The median is `0.780`. OTA55 seed `550055` produces `0.856` on the comparable Raw GPS move/stop/move error axis. This is intentionally persistent and far from independent white noise. It is somewhat more correlated than the corpus median but remains inside the regime occupied by multiple real sessions.

For the 174-second synthetic stationary sample, lag-one east/north error correlation is `0.876/0.877`, median error-vector direction persistence is `0.965`, and the cloud centre drifts `11.524 m`. The ordinary pre-outlier part of the short real `snap` stop is less stable on simple east/north lag correlation (`0.233/-0.024`), but the full stop plus recovery has `0.582/0.826` and direction persistence `0.976`. The real sample is small, so moving-corpus persistence plus the full stop/recovery pattern is the more defensible authority.

## Stationary cloud analysis

The ordinary `snap` stop before its rare large excursion contains 13 fixes across `102.841 s`:

- radius from robust local centre: p50 `4.866 m`, p95 `16.753 m`, maximum `19.499 m`;
- false raw path length: `101.434 m`, or `59.179 m/min`;
- local cluster-centre drift: `6.159 m`.

OTA55 stationary seed `550059` contains 55 fixes across `174 s`:

- radius: p50 `7.297 m`, p95 `11.865 m`, maximum `13.388 m`;
- false raw path length: `173.707 m`, or `59.899 m/min`;
- local cluster-centre drift: `11.524 m`.

The simulated centre is a little broader at p50 and narrower at p95 than this one ordinary real stop, while its false path accumulation is almost identical. It is therefore appropriately similar for Stationary, false-distance, route-spaghetti, puck drift, Live Pace, and false-Signal-Lost QA. It is not a claim that every real stop has this cloud.

When passed through current Activity processing, the same synthetic 174 m raw cloud produces two stationary heartbeat points at one canonical position: canonical, Live, and Base Final each credit `0 m` route distance. Raw observations continue, so Activity source health remains healthy rather than becoming Signal Lost.

## Moving error analysis

The selected simulated comparison has moving lateral error p50 `2.199 m` versus real median-of-session p50 `1.417 m`. Moving short-step jitter is `1.250 m` versus `0.802 m`. OTA55 is therefore mildly conservative/noisier at the middle of the distribution, while still tracking the true movement direction and staying far from a random scribble.

On a perfectly straight 288 m truth path, seed `550056` produces 65 raw fixes and `397.568 m` of raw polyline. Normal Activity processing reduces that to 39 canonical points/`324.585 m`, 8 causal Live points/`290.135 m`, and 23 densified Base Final points/`290.898 m`. The diagnostic is deliberately capable of exposing residual processing bias; ground truth never participates in those decisions.

## Outlier analysis

Using an inferred moving residual threshold of 15 m, the full real corpus has an estimated `2.031%` tail share. The selected four-minute comparison seed happens to contain no such event; that is plausible for a rare stochastic process and must not be read as a zero-probability model. The default profile evaluates an ordinary outlier event on `0.6%` of due fixes and a severe event on `0.12%`, after an eight-fix warm-up. Seeded tests also force an event deterministically when a scenario specifically needs one.

The documented `snap` stop contains a roughly `134.899 m` large excursion followed by 11 correlated recovery fixes and return within 20 m in `9.983 s`. The forced OTA55 scenario peaks at `112.801 m` and returns within 20 m in `12 s`. The `38.095%` real and `26.667%` simulated values in the artifact are explicitly **conditional recovery-tail shares within those two selected episodes**, not population event frequencies.

Current production processing rejects seven poor-accuracy fixes from the forced scenario and bounds the remaining Live/Base Final lateral excursion to about `12.2 m`; no 113 m teleport reaches the product route.

## Stop/move transitions

The closest honest real authority is `snap` raw 230 onward:

- documented stop anchor: raw 246, 19 s into the retained slice;
- stationary interval used for comparison: up to 120 s;
- physical movement resumes about 126 s after the stop anchor;
- 73 raw fixes are retained in the selected move/stop/move slice.

OTA55 uses a separate `movementAgeS` and changes the Ornstein–Uhlenbeck bias target/tau at the transition. It does not reset bias on stop or restart. The first moving observation therefore inherits the end-of-stop error vector and gradually realigns with the moving ground truth. Automated tests require the first resumed error vector to remain within 15 m of the last stop vector.

## Chosen simulator model

The default `Realistic GPS` model is:

```text
intended path / joystick
→ exact ground-truth position
→ slowly changing 2D mean-reverting bias
→ correlated short-term jitter
→ optional decaying outlier vector
→ observed GPS coordinate + imperfect hAcc/speed/course
→ normal Activity provider adapter
```

Parameters:

| Parameter | Moving | Stationary / common |
|---|---:|---:|
| bias sigma | 4.2 m | 5.8 m |
| bias mean-reversion time | 24 s | 46 s |
| short jitter sigma | 1.05 m | 1.45 m |
| jitter autoregression | — | 0.28 |
| ordinary event probability | — | 0.006 per due fix |
| severe event probability | — | 0.0012 per due fix |
| outlier recovery time | — | 6 s |
| hAcc range | — | 3.5–65 m |

Reported hAcc starts near 10.4 m, grows with current error/outlier magnitude, includes independent positive variation, and worsens in the Debug Poor state. It is correlated with uncertainty without pretending to be exact. Stationary scalar speed is usually `0`, sometimes unknown (`-1`), and rarely a bounded false low speed; downstream Live Pace remains canonical recent-movement based.

Cadence uses a bounded discrete distribution with a one-second mode, common 2–6 s delays, and rare 8–25 s moving or 12–30 s stationary intervals. Poor mode stretches intervals. Raw replay is capped at `10×` and at 12 generated virtual substeps per wall tick so acceleration remains interactive without flooding Activity.

## Real-versus-Sim table

| Metric | Real | Simulated | Assessment |
|---|---:|---:|---|
| Fix cadence p50 | 1.000 s | 1.000 s | matched |
| Fix cadence p95 | 6.023 s | 8.000 s | Sim modestly gappier |
| hAcc median | 14.246 m | 14.066 m | matched |
| hAcc p95 | 14.246 m | 17.320 m | Sim broader; avoids cloning plateau |
| Moving lateral deviation p50 | 1.417 m | 2.199 m | Sim mildly noisier |
| Moving short-step jitter p50 | 0.802 m | 1.250 m | Sim mildly noisier |
| Stationary radius p50 | 4.866 m | 7.297 m | Sim broader centre |
| Stationary radius p95 | 16.753 m | 11.865 m | Sim narrower ordinary tail |
| Stationary false path length | 59.179 m/min | 59.899 m/min | matched |
| Short-term error correlation | 0.780 | 0.856 | same persistent-error regime |
| Inferred moving residual ≥15 m | 2.031% | 0% in selected seed | fixed sample too short for frequency estimate |
| Severe episode peak | 134.899 m | 112.801 m forced | same rare-failure class |
| Recovery to <20 m | 9.983 s | 12.000 s | similar recovery scale |

Overall: the default is slightly noisier during ordinary movement, closely matched in stationary false path, and deliberately temporally correlated. It is appropriate for Cairn QA. It is not tuned to reproduce a named route, city, or Activity.

## Reproducibility

Run:

```sh
cd app
node scripts/evaluate-o55-gps-simulator.mjs
```

The evaluator obtains production evidence through read-only `SELECT`, strips coordinates into local metres, compiles and runs the current Raw model plus current continuity, causal Live, Base Final, and recent Live Pace authorities, and regenerates the ignored artifacts under `app/_review/o55-gps-sim/`.

Same truth path plus same seed produces byte-identical observations. A different seed produces a different plausible sequence. Ground truth and raw observations remain separately available in Debug state and exports.

## Known differences

- Cairn's retained data is not surveyed ground truth, and some hAcc values are quantized/plateaued.
- The corpus is small, device/environment-specific, and uneven across Hike, Run, city, and trail settings.
- OTA55 is a two-dimensional observation model; altitude remains the existing deterministic terrain model because production route/pace validation does not require a fake high-fidelity barometer.
- It does not simulate RF propagation, satellite geometry, iOS filtering internals, real callback batching, thermal state, low-power behavior, native suspension, or device-specific antenna effects.
- Rare-event frequency cannot be estimated confidently from one stop. The forced outlier fixture calibrates shape/recovery, not population prevalence.
- The chosen comparison seed has no ≥15 m moving event; separate seeded forced-outlier coverage proves the event/recovery mechanism deterministically.

## Why the model is adequate for QA

It recreates the classes that affect Cairn decisions—persistent corridor wobble, stationary cloud and false length, imperfect confidence, irregular cadence, degraded evidence, one bad-fix recovery, stop/restart bias memory, and total source silence—while retaining exact ground truth for diagnosis and keeping that truth out of production logic. Those properties are sufficient to exercise Stationary, source health, Candidate/Reject/Refine, Canonical, causal Live, Base/Enhanced Final, pace, Pause/Resume, and Finish indoors without claiming that simulation replaces an outdoor iPhone walk.

