# Stage 1 Code Review — strokeSimplify

**Verdict**: PASS
**Confidence**: HIGH

Reviewed:
- `app/src/utils/strokeSimplify.ts` (213 LOC)
- `app/src/utils/__tests__/strokeSimplify.test.ts` (199 LOC)
Against `docs/spikes/V6_3_FINAL_PLAN.md` §1.1, §1.5, §6.1, §13.1.

---

## Spec compliance

- [x] **DP epsilon escalation 5/10/20/40** — `DP_EPSILON_LADDER_M = [5, 10, 20, 40] as const` (line 25), iterated in order (line 193). Matches plan §1.1.
- [x] **Pure functions, no I/O** — no `fetch`, no `AsyncStorage`, no `console.*`, no module-level state, no React deps. All exports are pure.
- [x] **uniformSample fallback (NOT slice(0,N))** — line 129 `step = (points.length - 1) / (targetCount - 1)`; line 140-142 explicitly guarantees last point retained. R2 BLOCK addressed; the regression is testable.
- [x] **MAX_STROKE_VERTICES_INPUT = 2000** — exported (line 28), enforced at line 175 with explicit `rejected_too_long` reason.
- [x] **Empirical citation: ε=5m saves 21/26 (81%)** — file header lines 9-11 cites `spike-corridor-100v-results.md` with 81% number.
- [x] **Reason field for telemetry (plan §13.1)** — `SimplifyReason` union (lines 149-153) covers all four outcomes; `dp_eps_${number}` template literal carries the actual ε used. Matches §13.1 telemetry schema for `metric_value`-style observability.
- [x] **G0_post_simplify documented as caller responsibility** — JSDoc lines 168-170: "Caller MUST check `reason !== 'rejected_too_long'` and the post-condition `points.length >= 2` (plan §1.5 G0_post_simplify) before sending to Mapbox." Correctly documents Stage 1 boundary.
- [x] **MAPBOX_MATCHING_MAX_COORDS = 100** — exported as constant, used everywhere (lines 22, 184, 195, 206). No magic 100 hardcoded.

---

## Anti-cheating audit

| Check | Finding |
|---|---|
| **Hardcode** | None. `100`, `2000`, `[5,10,20,40]`, `6_371_000` (earth radius), `1e-9` (zero-segment epsilon) all named or scoped to a single math function. |
| **TODO / FIXME** | Zero occurrences in either file. |
| **Silent fail / empty catch** | No try-catch in either file. Pure math, nothing to swallow. Pathological inputs return well-defined values (empty array, endpoints-only). |
| **console.log / debug residue** | Zero occurrences. |
| **@ts-ignore / `any`** | Zero `@ts-ignore`. The only `any` shadow is `as SimplifyReason` on the template literal — necessary because `dp_eps_${number}` is a TS template-literal type that the inferred string doesn't auto-narrow to. Justified, not evasion. |
| **Spec violation** | None found. |

---

## Edge cases

Tested:
- [x] 0-length input: `douglasPeucker([], 5)` → `[]` (line 126); `uniformSample([], 0)` → `[]` (line 193).
- [x] 1-vertex input: `douglasPeucker([{lng,lat}], 5)` → unchanged (line 127). `simplifyStroke` with 1 point returns `unchanged` (covered by `≤100` branch).
- [x] 2-vertex input: returned unchanged (line 128-129; douglasPeucker line 77 short-circuits `length <= 2`).
- [x] Exact cap (100): test "passes stroke at exact cap unchanged" (line 53).
- [x] 2000-vertex hard cap: test at line 108 (`MAX_STROKE_VERTICES_INPUT + 1` → rejected); also line 156 (`douglasPeucker(2000)` doesn't blow stack — iterative stack-based traversal).
- [x] Mutation safety: explicit test at line 116 `JSON.stringify` snapshot before/after. Code: `points.slice()` is used at every return path (lines 77-78, 127, 186), and DP writes to a local `keep[]` array, never mutates input.
- [x] Uniform fallback covers full span: line 181 explicit "NOT a head slice" regression test, asserts `result[last]` ≈ `stroke[499]`.

Missing (minor, non-blocking):
- **All-same-point input** not directly tested. However: code path is safe — `perpDistanceM` line 51 short-circuits `segLenSq < 1e-9` to `Math.sqrt(px²+py²) = 0`, all distances are 0, no point exceeds ε, DP returns `[first, last]` (which equal each other but the contract holds). Could be added but not a defect.
- **Negative epsilon**: handled (`epsM <= 0` returns `points.slice()` unchanged at line 78), but only tested for `ε=0`, not negative. Trivial.

---

## DP correctness

The iterative implementation is **equivalent** to the canonical recursive Douglas-Peucker:

- The recursive form: keep endpoints; find max-perp-distance interior point; if > ε, mark it kept and recurse on `[start, maxIdx]` and `[maxIdx, end]`; else drop all interior.
- The iterative form (lines 85-105): identical algorithm with an explicit LIFO stack replacing the call stack. `keep[]` boolean array marks survivors; `stack.push([s,maxIdx]); stack.push([maxIdx,e])` mirrors the two recursive calls. Order of stack pop doesn't affect the result because each subinterval is independent — no shared mutation of the keep array except setting bits.

**Coverage of all points**: every interior point `i` in `(s, e)` is examined (line 93 loop `i = s+1; i < e`). When a max point is added, both child intervals are pushed; eventually every original point either gets `keep[i]=true` (if it's a max in some interval that exceeds ε) or remains `false` (gets dropped). The final assembly loop (107-110) iterates all `points.length` indices in original order, so output preserves original ordering. **Correct.**

Termination: each push decreases `e - s` strictly (because `s < maxIdx < e`), so the recursion tree has depth ≤ N and total work ≤ O(N²). No infinite loop possible.

Endpoint preservation: `keep[0] = true` and `keep[length-1] = true` set unconditionally at lines 81-82. Endpoints can never be dropped. Verified by tests at lines 68-69, 78-79, 137, 150-151.

---

## uniformSample correctness

R2 regression check (the slice(0,N) bug):

Old broken pseudocode would be `points.slice(0, 100)` — drops everything past index 99. On a 500-point input that's 80% data loss including the entire tail.

New code (lines 129-143):
```
step = (points.length - 1) / (targetCount - 1)   // 499/99 = ~5.04
for i in 0..targetCount-1:
  idx = round(i * step)                            // 0, 5, 10, ..., 499
  push points[idx] (deduped against previous)
ensure last point retained
```

For 500 → 100: indices 0, 5, 10, ..., 495, 499 (last one rounded up). The **last point is provably included** by the explicit guard at line 140-142. Test at line 181 asserts this with floating-point equality on `stroke[499]`.

The dedupe-against-`lastIdx` (line 134) handles the degenerate case where `step < 1` (i.e. `targetCount > points.length`), but that branch is unreachable because line 127 short-circuits to `points.slice()` first. Defensive but harmless.

**No tail loss possible.** R2 BLOCK is fully resolved.

---

## Recommendation

**PASS Stage 1, proceed to Stage 2 (strokeGate).**

Strengths:
- Plan §1.1 spec is implemented literally with no shortcuts.
- Constants exported, magic numbers eliminated.
- R2 BLOCK (`slice(0,N)` tail loss) explicitly tested as a regression.
- Iterative DP avoids stack-blow on 2000-vertex inputs (test verifies).
- Mutation safety, endpoint preservation, and post-simplify length contract all explicit.
- Telemetry-ready `SimplifyReason` union supports plan §13.1 per-gate observability.

Nice-to-have (not blocking, not requesting):
- All-same-point test case (current behavior is safe, just untested).
- Negative-epsilon test (trivial; current handler is correct).

No changes requested. Stage 2 may proceed.
