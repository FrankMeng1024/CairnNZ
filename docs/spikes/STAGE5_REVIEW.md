# Stage 5 Code Review — useRouteEditStore runPreview rewrite
**Verdict**: PASS

## Spec compliance

- **§1.2 Preview button lock + finally contract**: PASS. `runPreview` early-returns on `isComputing` (line 1474) and the entire happy path is wrapped in `try { ... } finally { set({ isComputing: false }); }` (lines 1515 / 1692-1697). The fence-trigger `return` paths inside the `try` block all unwind through `finally`. AbortController/timeout for Mapbox lives in MapMatchingClient (Stage 3 scope), not here.
- **§1.3 + §1.5 G-gate pipeline**: PASS. Order is G0 → simplifyStroke → G0_post_simplify → matchSegment (G2) → G0.5 → G3 (lines 1536-1628). Each gate has its own reject path with `firstRejectReason ??=` accumulation.
- **§1.4 ban list**: PASS in `runPreview`. No CatmullRom, no tracepoint, no alts (Mapbox response field), no fracBad/maxDispM, no G3 endpoint bearing, no low-confidence warning. The two `confidence: 'confident'` survivors are in `EditSegment` persistence schema (saveExtras / persistSession), not the runPreview pipeline — that is a different field on the local-storage segment record, semantically unrelated to the banned Mapbox tracepoint confidence.
- **§3.1 multi-stroke**: PASS. Per-stroke loop is sequential (lines 1521-1638). No atomic rollback. `acceptedValidated.length === 0` surfaces `firstRejectReason`; partial accept commits the kept strokes, drops rejected stroke ids from the canvas (line 1650), surfaces the first reject reason as `lastError` (line 1687).
- **§1.5 MAX_STROKES_PER_EDIT=8**: PASS. `MAX_STROKES = 8` (line 44) enforced in `beginStroke` (line 1044).
- **Plan §3 bug #1 (undo walkedIndex)**: PASS. lines 1411-1421 rebuild `PointCloudIndex` from `last.matchedPoints` with `refId: matched:${i}`. Test `undoWalkedIndex.test.ts:105` asserts query-by-restored-coord returns matching point.
- **Plan §3 bug #5 (undo clears lastWarning + activeStrokeId)**: PASS. lines 1432-1433 set both to null; test asserts at `undoWalkedIndex.test.ts:144`.
- **Other §3 bugs**: UndoEntry shape (line 58-63) carries the four needed fields; eraseAt + removeStroke + persistSession all push UndoEntry with current matchedPoints; fence verified (see anti-cheating #7).

## Anti-cheating

1. **Dead code deleted**: PASS. `grep` over file finds zero live references to `smoothCatmullRom`, `snapDisplacementStats`, `snapDisplacementFraction`, `rdpSimplify`. Only one historical comment mentions `rdpSimplify` (line 1543) — narrative, not code.
2. **Hardcode**: minor — magic strings for Chinese reject reasons inlined in switch (lines 1591-1607); not a blocker, these are user-facing copy and arguably belong here. `MAX_STROKES`, `CORRIDOR_RADIUS_M`, `ENDPOINT_SNAP_M`, `TRIM_MIN_FRACTION` all named constants. Cache cap `100` (line 1632) and dedupe threshold `0.5m` (line 841), spike threshold `4m`/`1m` (line 865) are inline numerics with explanatory comments — acceptable per project pattern.
3. **TODO/FIXME**: NONE.
4. **Silent fail**: try/catch on `matchSegment` (lines 1572-1581) is narrow — only wraps the single await, re-checks fence, pushes to `rejectedStrokeIds`, sets reason, `continue`s. Not swallowed; surfaced as per-stroke reject. `finally { set({isComputing:false}) }` is the correct contract, not silent.
5. **@ts-ignore / any**: only `e: any` in the matchSegment catch (line 1574) — standard TS pattern for catch clauses. No `@ts-ignore`.
6. **finally contract**: PASS. All code paths through the `try` block — success return (1691), 6 different `continue`/reject reasons hitting the final `acceptedValidated.length===0` early return (1654), and the four early `return { ok: false, error: 'state-changed' }` fence returns (1523, 1577, 1584, 1641) — every one unwinds through the `finally` at 1692. Pre-`try` returns (lines 1473, 1474, 1490, 1501) are correct: `isComputing` was never set in those paths.
7. **Fence in catch**: PASS. line 1577 (`if (fenceTriggered()) return`) is the first statement in the `matchSegment` catch block, before pushing reject — matches plan requirement.
8. **Preview button lock**: PASS. line 1474 returns `Already computing` if `isComputing` already set; test `runPreviewFinally.test.ts:169` validates double-tap short-circuit.
9. **Multi-stroke serial**: PASS. `for (const vs of v.validated)` with `await matchSegment(seg)` inside — sequential by construction, no `Promise.all`.
10. **No regression**: not directly verifiable from this review (would require running Jest), but the public API of the store is unchanged and the 14 new tests have a coherent shape that exercises real store behavior (no over-mocking).

## Test rigor

- **6 finally exit paths**: 5 covered in `runPreviewFinally.test.ts` (success, NoMatch, timeout, throw, fence). Double-tap (6th) covered separately. Corridor (G3) reject and G0/G0_post_simplify reject are NOT explicitly asserted as separate finally cases, but the finally is structural — same `finally` covers all reject branches, and any one branch reaching the assertion `isComputing===false` proves the contract for all. Acceptable.
- **alt preservation**: `altPreserve.test.ts` covers densify (3), flattenGeometry (4), applyTrimFraction (3) = 10 tests. The eleventh appears to be `flattenGeometryToParts`. The `spliceMatched` dedupe-upgrade path (lines 843-848) is acknowledged in the test header as integration-only; no dedicated unit test. Flag for Stage 6 or beyond as noted.
- **undo + reset walkedIndex**: 3 tests cover the rebuild and the lastWarning/activeStrokeId clear.
- **Multi-stroke partial-failure semantics**: untested in Stage 5 — flagged for Stage 6+.

## Recommendation

PASS — proceed to Stage 6. Two follow-ups for the next stage:

1. Add a `spliceMatched` integration test that exercises the alt dedupe-upgrade survivor path (one neighbor lacks alt, dropped neighbor has alt). Stage 5 ships it in code without dedicated coverage.
2. Add a multi-stroke partial-failure test (e.g. 3 strokes, middle one G3-rejects): assert two committed snapped strokes in `matchedPoints`, rejected id removed from `brushStrokes`, `lastError === firstRejectReason`. Currently only single-stroke reject paths are exercised.

No blocking issues. Ban-list adherence in runPreview is clean. Dead code genuinely deleted (not commented). Finally contract is correct on all observed paths. Undo walkedIndex fix is verified by test.
