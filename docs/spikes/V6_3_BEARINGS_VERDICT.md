# Bearings Contradiction Resolution

Resolves the apparent contradiction between BRUSH_EDIT_SPIKES.md §3
("bearings 5e+05× confidence") and BRUSH_EDIT_MEMORY.md §5.1
("spike-final-NT 杀 3/4 FA"), and a draft v6.3 dismissal of bearings.

## What the older spike actually measured

Source: `C:/Users/I585134/spike-deep-tests.txt` lines 53-59.
The "5e+05×" claim is about the **input `bearings` parameter** sent IN
the /matching API call, measuring Mapbox's returned **confidence VALUE**
on **one** adversarial test case (ADV4, parallel road).

Direct quote (lines 53-58):
```
BEARINGS DRAMATICALLY IMPROVE CONFIDENCE:
  ADV4 parallel road no bearings: conf=6.5e-7
  ADV4 with bearings=N±45: conf=0.226 (350,000× higher)
  ADV4 with bearings=S±45 (opposite of intent): conf=2.5e-13

  Bearings ALSO reduce alternatives_count (from 11→3 in same test).
```

Sample size: **n=1** case (ADV4). Metric: confidence value, not snap
correctness. Same file lines 34-37 explicitly conclude confidence itself
is unreliable: *"WHY confidence IS USELESS FOR US ... Anything outside
ratio in [0.95, 1.05] gets near-zero confidence."*
So the "5e+05× improvement" is improving a metric the same document
declares unusable.

Source: `C:/Users/I585134/spike-final-NT.txt` lines 237-271.
The "杀 3/4 FA" claim is the **post-hoc G3 bearing-mismatch judge**,
measured on the V7-ACCEPT subset (12 cases) of the 250-case corpus,
pure geometry on cached responses, NO extra Mapbox calls. Direct quote
(lines 244-256):
```
J4-SH-007  REJECT  13.2m   52.7°   *** FA -- caught at >15°, >20°, >45°
J4-SH-010  REJECT  13.6m   15.0°   *** FA -- caught at >10°, >15°
J4-SH-011  REJECT   6.5m   18.2°   *** FA -- caught at >10°, >15°
J2-039     REJECT 119.7m    6.4°   *** FA -- bearing-judge MISSES
```
Threshold scan (lines 258-262): >15° catches 3/4 FAs with 1 new FR
(J4-SH-003).

These are TWO different things: input bearings parameter vs post-hoc G3
geometry gate. They are not in conflict — they measure different signals
on different sample populations.

## Empirical re-check on 250 corpus

Source: `C:/Users/I585134/spike-work/sweep_results.json` (cache verified
at `C:/Users/I585134/spike-cache/*.json` — responses contain only
`matchings/tracepoints/code` with no echoed bearings input, confirming
the cache is from radiuses=8 calls without input bearings).

Corpus split per spike-jury expected labels: ACCEPT=134, REJECT=116.

G3-degrees sweep (TP = correct ACCEPTs / 134; FA = false ACCEPTs / 116):

**G2=40m (perp gate effectively wide, isolates G3 effect):**
| G3°  | TP  | FA  | TP%   | FA%   |
|------|-----|-----|-------|-------|
| 10   | 67  | 27  | 50.00 | 23.28 |
| 15   | 72  | 35  | 53.73 | 30.17 |
| 20   | 79  | 42  | 58.96 | 36.21 |
| 25   | 81  | 45  | 60.45 | 38.79 |
| 30   | 84  | 45  | 62.69 | 38.79 |
| 40   | 86  | 47  | 64.18 | 40.52 |

**G2=18m (mid):**
| G3°  | TP  | FA  | TP%   | FA%   |
|------|-----|-----|-------|-------|
| 10   | 23  |  9  | 17.16 |  7.76 |
| 15   | 24  | 11  | 17.91 |  9.48 |
| 20   | 28  | 16  | 20.90 | 13.79 |
| 25   | 29  | 17  | 21.64 | 14.66 |
| 30   | 30  | 17  | 22.39 | 14.66 |
| 40   | 31  | 17  | 23.13 | 14.66 |

**G2=10m (tight, V7-like):**
| G3°  | TP  | FA  | TP%   | FA%   | FA ids                         |
|------|-----|-----|-------|-------|---------------------------------|
| 10   |  6  |  1  |  4.48 |  0.86 | J2-039                          |
| 15   |  7  |  1  |  5.22 |  0.86 | J2-039                          |
| 20   |  7  |  3  |  5.22 |  2.59 | J2-039, J4-SH-010, J4-SH-011    |
| 25   |  7  |  3  |  5.22 |  2.59 | J2-039, J4-SH-010, J4-SH-011    |
| 30   |  7  |  3  |  5.22 |  2.59 | J2-039, J4-SH-010, J4-SH-011    |
| 40   |  8  |  3  |  5.97 |  2.59 | J2-039, J4-SH-010, J4-SH-011    |

**Specific FA contribution at the V7-relevant operating point (G2=10):**
Tightening G3 from 20°→15° eliminates J4-SH-010 + J4-SH-011 from the FA
list (FA drops 3→1) without losing TP. From 15°→10° loses 1 TP, no FA
gain. So G3 is discriminating in the 15°-20° band on V7's tight-perp
operating curve, consistent with spike-final-NT's >15° finding.

**On the 65% INVISIBLE-class FA cases (perp ≤ 20m)**: at G2=10, G3=15°
the only surviving FA is J2-039 (perp small, bearing diff 6.4°), exactly
the case spike-final-NT explicitly identifies as unkillable by any
geometric or tile-based check (its stroke direction mimics the adjacent
residential street).

## Verdict

**Verdict A** — both claims are correct, but they refer to different
signals.

Evidence:
- "5e+05×" is about the **input bearings parameter** affecting Mapbox's
  returned confidence value on **n=1** test (ADV4) — `spike-deep-tests.txt`
  lines 53-58. The same file (lines 34-37) declares confidence unreliable
  in general, so this micro-result does not generalize to snap quality.
- "杀 3/4 FA" is about the **post-hoc G3 bearing-mismatch gate** on the
  250-case corpus — `spike-final-NT.txt` lines 244-271, reproduced in
  `sweep_results.json`. G3 measurably reduces FAs at the V7 operating
  point (G2=10, G3=15° → FA=1 vs FA=3 at G3=20°).

The draft v6.3 dismissal that "bearings is INVISIBLE 65% 上无效" conflates
the two. Post-hoc G3 IS effective for J4-SH-010 and J4-SH-011 (both
short, perp ≤ ~14m, INVISIBLE class) at G3=15°. It is ineffective ONLY
for J2-039 (bearing diff 6.4°, mimicking the parallel street). So the
correct statement is "G3 catches 2 of the 3 short-INVISIBLE FAs but
cannot catch parallel-mimic strokes like J2-039."

## Recommendation

- **Input bearings parameter in /matching call**: **NO, not without a
  fresh dedicated spike.** The only existing evidence is one ADV4 case
  measuring an unreliable metric (confidence). There is no 250-corpus
  evidence that input bearings improves snap-correctness. Sending wrong
  bearings would actively degrade results (ADV4 with reverse bearings
  drops confidence by 13 orders of magnitude — `spike-deep-tests.txt`
  line 56). On a brush stroke, the user's intended bearing is itself
  noisy and would have to be derived from the stroke chord. Adding this
  introduces a new failure mode without 250-case validation.
  Defer until a v6.4 spike runs the corpus with bearings=stroke_chord
  ±45° and compares FA/TP curves.

- **Post-hoc G3 bearing gate (geometry only)**: **YES, threshold = 15°.**
  Empirically catches 2/3 short-INVISIBLE FAs (J4-SH-010, J4-SH-011) at
  the V7 operating point, costs zero TP loss vs G3=20°, requires no extra
  API quota, runs on the cached /matching response.
  Limitation: J2-039 leaks (bearing diff 6.4° because Mapbox snaps to a
  parallel residential street). Document as known limit per
  `spike-final-NT.txt` lines 285-294.

## Files cited

- `C:/Users/I585134/spike-deep-tests.txt` lines 34-58
- `C:/Users/I585134/spike-final-NT.txt` lines 237-294
- `C:/Users/I585134/spike-work/sweep.py` (G3 algorithm definition,
  lines 7, 163-168)
- `C:/Users/I585134/spike-work/sweep_results.json` (250-case results)
- `C:/Users/I585134/spike-cache/J1-001_*.json` (verified no bearings
  input echoed in tracepoints)
