# Historical `back` control forensic

Status: read-only. Identity label: `historical-back-control`. The source account email is intentionally excluded from this artifact.

## Selection and privacy boundary

The requested account has exactly one real Hiking Activity named `back`: server Activity **46**, recorded 2026-05-29 13:15:55–13:33:51 Asia/Shanghai. It has no `clientActivityId`, which is consistent with its age. It contains 178 raw observations and 87 saved route vertices, has 877.4 m saved distance over 1,073 s, and has no modern Segment/Gap metadata.

This Activity belongs to a different user than `snap`. It was read only. No data, ownership, geometry, or account context crossed between users, and no clone was created.

## The key archaeological result

`back` did **not** run a Mapbox Map Matching pipeline when originally saved.

- The recording is dated May 29.
- The available Git repository begins at `aad6fd2` on June 3.
- The first `snapTrack.ts` history visible in Git is `9de77bd` on June 17.
- That June 17 file’s own header says its v6.4 implementation was “validated by spike on session 46.” In other words, `back` became a matcher test corpus later; it was not produced by that matcher on May 29.

The exact pre-repository producer cannot be recovered from Git, so assigning `back` to `d7ea3b0`, `738286b`, `95302b8`, or `a9157af` would be false. All four are later commits.

## What the stored evidence shows

- Raw cadence: p50 5.016 s, p95 9.020 s.
- Raw spatial spacing: p50 5.444 m, p95 6.653 m.
- Saved route: 87 points and 877.356 m path length, matching the stored 877.4 m metric.
- Saved vertices are not a raw subset: nearest-raw displacement is p50 3.828 m and max 18.011 m.
- Replaying the closest recoverable early CC acceptance family against raw produces 166 points and 965.765 m, not the stored 87-point route. That proves the exact pre-root reducer is not recoverable.

The earliest repository snapshot already documents the relevant visual family: accuracy/teleport cleanup, stationary collapse, and a low-process-noise one-dimensional Kalman pass (`Q=1e-9`) in both live and historical Detail. This, plus the naturally sparse five-second evidence, is the credible source of the remembered straight/attached appearance.

Classification of the “good snap” causes:

- H1 preprocessing/resampling: **contributing** — sparse evidence was matcher-friendly later.
- H2 radii: **not an original-save cause**.
- H3 profile: **not an original-save cause**.
- H4 looser gates: **only in later v6.4 controls**.
- H5 whole-route/subsection behavior: **later v6.4 accepted whole chunks; unsafe as a modern contract**.
- H6 historical smoothing: **primary likely cause**.
- H7 post-match smoothing/dedupe: **later v6.4 visual contributor, not original-save provenance**.
- H8 Detail geometry selection/cleanup: **primary likely cause**.
- H9 aggressive road stealing: **later v6.4 risk, not proven for the May save**.

## Reconstructed pipelines

### Original May save (best evidence)

```text
~5s raw observations
→ pre-root tracking acceptance (exact source unavailable)
→ strong low-lag/low-Q smoothing family
→ 87-point saved route
→ historical Detail cleanup/smoothing
```

No Mapbox request/response, confidence, radii, tracepoint, or matching artifact exists for that save.

### Closest later `back`-validated matcher (`9de77bd`, v6.4)

```text
GOOD = speed != -1 and accuracy <=20m
→ fixed 80-point chunks, overlap 10
→ Mapbox walking, tidy=true, radii round(clamp(accuracy,10,40))
→ accept first matching if confidence >=0.3
→ otherwise raw fallback densified to <=20m
→ geographic seam scan/optional straight bridge
→ global 3m dedupe + window-3 smoothing
```

It did not inspect tracepoint provenance, apply current deviation/endpoint gates, or preserve explicit matched/fallback subsection authority.

## Controlled replays

### `back` through O48

O48 sends 87 saved points. Because inferred timestamps are not strictly increasing, timestamps are omitted. The first 80-point request returns `Ok`, confidence 0.983880, but only 33/80 non-null tracepoints. O48 rejects it as non-contiguous. The final eight-point request returns `NoSegment`. Result: 0% matched, 100% canonical fallback.

With `tidy=false`, 52 inputs form a contiguous response, but the 29.222 m max and 29.189 m endpoint displacement fail modern gates. This shows `back` is partly an easy mapped dataset, while also validating the need for endpoint truth.

### `back` through v6.4 control

The closest later historical control accepts one chunk, emits 61 points, and produces 816.842 m: a 0.931 length ratio. Source-to-output displacement is p50 0.398 m, p95 16.714 m, max 24.723 m. It looks cleaner but is not metric-equivalent or endpoint-safe enough for current authority.

### `snap` through v6.4 control

The old-style matcher accepts two of six chunks and emits 147 points, 813.066 m versus 843.202 m (ratio 0.9643). Source-to-output displacement is p50 0.397 m, p95 14.775 m, max 19.029 m. It accepts a whole 80-point head chunk even though 68 tracepoints are null, and a 42-point tail chunk with 37 nulls. That is visually effective but provenance-unsafe: a few retained points are allowed to reshape entire chunks.

The low-Q Kalman-only control on `snap` is more revealing: 759.514 m, with p50/p95/max displacement 4.968/17.698/20.944 m. It straightens the route at the cost of lag and truth.

## Three-route-class audit

### Mapped

The historical visual/matcher family is more willing to produce a road-attached line. Its useful reusable idea is **sparser ordered matcher input**.

### Unmapped

Whole-chunk acceptance from sparse tracepoints, geographic seam search, invented bridge lines, global dedupe, and smoothing can pull or reshape true off-network movement. This violates current authority.

### Mixed

v6.4 had chunk-level fallback but no trustworthy temporal subsection provenance. It could not guarantee `MATCHED → CANONICAL → MATCHED` at the actual network transitions.

## Reuse ledger

### Reuse

- Deliberately reduce dense stationary/redundant matcher input.
- Keep the walking profile and uncertainty-aware bounded radii.
- Use `back` as a permanent positive-control dataset.

### Reuse with modern guardrails

- Accept mapped islands independently, but only after explicit resampling, `tidy=false`, tracepoint support, current topology/deviation/endpoint gates, and canonical boundaries.
- Consider the head corridor’s consistent 15–16 m network offset only under a high-confidence corridor-specific gate; never loosen the global gate for one Activity.

### Do not reuse

- Low-Q whole-history Kalman.
- Scalar-speed stationary authority or 8–accuracy-metre sticky deadbands.
- Accepting whole Mapbox geometry when most tracepoints are null.
- Ten-point geographic overlap stitching, invented seam bridges, global 3 m dedupe, or final window smoothing across route-class boundaries.

## Conclusion

`back` was both an easier, sparser dataset and a visually more aggressively smoothed presentation. The later historical matcher would make `snap` look more road-attached, but less auditable and less safe for Mixed routes. The best combination is current O48 canonical truth plus sequence-aware 3–5 s matcher input, `tidy=false`, independently gated temporal islands, and exact canonical fallback.

## Sources

- Git `aad6fd2` (2026-06-03), earliest available repository state.
- Git `9de77bd` (2026-06-17), v6.4 matcher explicitly validated against session 46.
- Current `app/src/services/routing/snapTrack.ts`.
- [Mapbox Map Matching API](https://docs.mapbox.com/api/navigation/map-matching/).
