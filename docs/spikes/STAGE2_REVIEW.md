# Stage 2 Code Review — strokeGate

**Verdict**: PASS
**Confidence**: HIGH

## Spec compliance

- [x] **G0** length 2..MAX_STROKE_VERTICES_INPUT — `checkG0` lines 138-158, both bounds checked, metric_value+threshold populated.
- [x] **G0_post_simplify** ≥ 2 — `checkG0PostSimplify` lines 162-173, exact match.
- [x] **G0.5** snap polyline ≥ 2 — `checkG0_5` lines 177-188, exact match.
- [x] **G1** stroke endpoint within ANCHOR_M of baseline — lines 203-230, `min(dStart, dEnd) <= ANCHOR_M`. Direction correct: stroke endpoint → baseline polyline.
- [x] **G3** every snap polyline point within CORRIDOR_M of stroke — lines 244-269, iterates `snap` and measures distance to `stroke`. Direction correct (snap→stroke), matches plan §1.3 wording "snap polyline 任一点离笔 > 250m → 拒".
- [x] **No bearing gate present** — verified absent. Header comment lines 14-17 explicitly documents the intentional omission citing spike-final-v63-product.md (96.8% → 87.1% recall).
- [x] **metric_value/threshold** typed `number | null` in `GateFail` (lines 70-78), matching plan §13.1.
- [x] **ANCHOR_M = 50** exact (line 28). **CORRIDOR_M = 250** exact (line 31). Both exported.
- [x] **Pure functions, no I/O** — confirmed. Only Math, no fetch/storage/console.

## Anti-cheating audit

- **Hardcode**: ANCHOR_M, CORRIDOR_M, EARTH_RADIUS_M (6_371_000) all named constants. Only literal `2` (min length) appears as `threshold: 2` — semantically tied to gate definition, acceptable. `1e-9` for degenerate-segment epsilon is a numeric tolerance, not a tunable threshold.
- **TODO/FIXME**: none found.
- **Silent fail**: no try-catch. Defensive paths return explicit `GateFail` with `metric_value: null` (lines 207-213, 246-252) — surfaced, not swallowed.
- **console.log**: none.
- **@ts-ignore / any**: none. Strict typing throughout; discriminated union `GateResult = GatePass | GateFail`.
- **Spec violation**: none. Bearing gate truly absent (grep would confirm — no `bearing` token in file).

## Geometry correctness

- **haversineM** (lines 86-96): standard formula, `2 * R * asin(sqrt(h))`. Correct at ~50m scales (haversine has no small-distance pathology).
- **perpToSegmentM** (lines 103-122): equirectangular projection anchored at `a`, then 2D segment-distance with `t` clamped to `[0,1]` (line 118) — proper segment, not infinite line. Degenerate segment (`segLenSq < 1e-9`) falls back to point-to-point distance (line 116). Correct.
- **pointToPolylineM** (lines 125-134): handles empty (Infinity), single-point (haversine), iterates all `n-1` segments. Correct.

## Edge cases

Covered:
- 0/1-point stroke in G0, G0_post_simplify, G0_5 (tests lines 65-71, 90-101, 119-121).
- Empty baseline in G1 (test line 157-160).
- Too-short stroke in G1 (test 162-165) and G3 (test 218-220).
- Empty snap in G3 (test 213-216).
- Boundary at threshold: G1 (test 167-173) and G3 (test 222-226) both verify `≤` semantics. **Note**: G3 boundary test uses 250m offset; passes because parallel-offset perpendicular distance equals offset exactly — relies on `Math.min(1, t)` clamp preventing endpoint overshoot. Valid.
- Single-outlier rejection in G3 (test 203-211) — confirms iteration covers all points, not just first/last.
- > MAX_STROKE_VERTICES_INPUT (test 73-80).

Missing (minor, non-blocking):
- No test for stroke with NaN/Infinity coords (caller responsibility, defensible).
- No explicit test of `pointToPolylineM` with single-point polyline (covered indirectly).

## metric_value sign convention

Always non-negative meters when measurable (haversine/hypot outputs ≥ 0). `null` only for defensive early-returns where the metric is undefined (G1 with empty baseline; G3 with empty snap/stroke). Consistent with plan §13.1 R2v4 amendment.

## Test rigor

- Real geometry helpers (`lineNorth`, `offsetEast`) — no mocked perpDistance. Tests exercise actual haversine + equirectangular math.
- Boundary tests at exact thresholds present for both G1 and G3.
- Defensive paths covered (empty baseline, empty snap, sub-2 stroke).
- All-gate happy path sanity test (lines 231-243).

## Recommendation

**Ship as-is.** Code matches plan §1.3/§1.5/§13.1 exactly. Bearing gate correctly absent. Geometry math is sound at the relevant 0–1km scales. Test coverage is rigorous including boundary and defensive cases. No hardcode leaks, no type evasion, no silent failures.

Optional polish (non-blocking, do not require for merge):
- Consider adding a `pointToPolylineM` unit test with mixed-segment polyline where the closest point is interior to a segment (not an endpoint), to lock the clamp behavior under regression.
- The `1e-9` degenerate-segment threshold could be a named constant but is idiomatic.
