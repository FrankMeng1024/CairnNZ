# R1v3 Plan Review

**Verdict**: NEEDS_WORK
**Confidence**: HIGH

Fresh-context independent review. Third revision shows real engineering progress — most of the v2 ship-blockers are now genuinely closed. Three residual issues remain plus a small set of new ones. Not BLOCK, not yet PASS.

---

## Status of v2 issues (15 items)

| # | Item | Status | Evidence |
|---|---|---|---|
| 1 | §0.2 fabricated 80/15/<2/<3 frequency table | **FIXED** | §0.2 now says "**频率分布未实测,等 ship 后 telemetry 真分布**" + "**禁止**在本 plan 写未实测的频率%". Column removed |
| 2 | §11 row 8 timing "~500ms" invented | **FIXED** | Row 8 now reads "8s timeout 上限 (MAPBOX_TIMEOUT_MS=8000),超时拒收 + finally 强制清 isComputing。**生产 p50/p95 延迟未实测**". Honest |
| 3 | §11 row 5 "主流近 0" lie | **FIXED** | Row 5 now `⚠️` not `✓`, body says "接受笔中 ~1/7 是真错 snap (32/210)。主流大路/小路场景几乎不触发,真错主要在故意穿楼+对抗笔。**用户 undo 兜底必须**". Matches §0.1 truth |
| 4 | DP slice(0,100) bug | **FIXED** | §1.1 uses `uniformSample(points, 100)` with `Math.round(i*step)`; first/last preserved by construction |
| 5 | MAPBOX_TIMEOUT_MS + AbortController | **FIXED** | §1.2 defines const + signal + abort + try/catch/finally |
| 6 | finally block contract clears isComputing every path | **FIXED** | §1.2 lines 143-148: "**关键: 无条件清 isComputing + timeout,任何路径都到这**" — explicit. ✅ success / Mapbox err / abort / fence / throw all enumerated as bullet contract |
| 7 | G0 (length<2) + G0.5 (snap<2) | **FIXED** | §1.5 adds `preflightCheck` with `length<2 → G0_too_short` and `length>2000 → G0_too_long`; G0.5 = "matchings[0].geometry.coordinates.length < 2" between G2 and G3 |
| 8 | MAX_STROKE_VERTICES upper bound | **FIXED** | §1.5: `MAX_STROKE_VERTICES = 2000` |
| 9 | Telemetry 429 + queue policy as code spec | **FIXED** | §1.7 has full code: queue cap 50, drop-oldest, 10/batch flush, 429 → unshift, other failure drop, no retry, background-skip |
| 10 | schemaVersion for persisted draft | **FIXED** | §1.6 `RouteEditDraft.schemaVersion: 1` + missing/mismatch → "清掉 draft,加载原 route" backwards-compat path |
| 11 | Case 16 crash-recovery mechanism described | **FIXED** | §1.6 final paragraph: explicit recovery sequence (load → schemaVersion check → matchedPoints + committed strokes only, no in-progress restore) |
| 12 | §9 ship checklist 13/12 → 18/16 | **FIXED** | §9 line 520: "真机 18 case 至少 16 通过 (2 个边角允许失败,但 14-18 生产场景必通过)" |
| 13 | §11 row 8 ≤3s vs §1.2 8000ms internal contradiction | **FIXED** | Row 8 rewritten — no more "≤3s" claim; "生产延迟未实测" replaces it |
| 14 | Rollback trigger defined | **FIXED** | §13.2 has 5-row threshold table (Mapbox err >30%, ACCEPT <60%, undo >35%, crash >1%, telemetry-fail >50%) + manual OTA path |
| 15 | Timeline realistic vs R2v2 4-week floor | **PARTIAL** | §8 now `19-20 天 ≈ 4 周` with explicit "R3+R4 reality 2.5 天 buffer". Matches R2v2 floor. ✅ |

**14/15 fixed, 1 partial-but-honest. Genuine revision discipline.**

---

## New issues found

### N1. Case 2 in §6.2 still treats single-pass FAILURE as PASS
Row 2 expects "弹平行路, undo 重画" as PASS. R1v2 flagged this — still unchanged in v3. If a stroke needs undo + redraw to land correctly, that is a **single-pass-accept failure**. Either delete case 2, or split it into 2a (clean accept = PASS) and 2b (undo-required = ACCEPTABLE-DEGRADED, not PASS). Conflating these poisons the 16/18 ship gate.

### N2. §6.1 unit-test list does not cover cases 14-18 production scenarios
7 specs listed (strokeSimplify, strokeGate, altPreserve, undoWalkedIndex, resetEditsClean, mapMatchClient, backCompat). **None** covers:
- editOpSeq fence triggering during await (case 14/15 logic, easily unit-testable with mock fetch + manual fence bump)
- persistSession schemaVersion-mismatch path (case 16)
- AbortController timeout path (case 17, mock fetch with delayed signal)
- isComputing button-lock double-tap (case 18)

These are pure-logic state-machine behaviors. Leaving them device-matrix-only means a regression in `runPreview` finally cleanup ships silently between OTAs. Add at minimum a `runPreviewLifecycle.test.ts` spec covering all 4. R2v2 raised this; v3 silent.

### N3. §1.2 fence-vs-timeout race ordering unspecified
§1.2 lines 132-148 has both `controller.abort()` from timeout AND `editOpSeq fence` static check after `await`. Two separate abort triggers. If timeout fires at T=8000ms AND user fence-bumps at T=7999ms, both happen. The catch-block enters AbortError → sets `lastError = '网络慢,请重试'`, but fence semantics say "静默 abort" (no error message). Spec must say: **fence-triggered aborts must be detected before catch sets lastError**. Pseudocode:

```
catch (e) {
  if (get().editOpSeq !== myOpSeq) return;  // fence won the race, silent
  if (e.name === 'AbortError') set({ lastError: '网络慢,请重试' });
  else set({ lastError: '未识别到这条路' });
}
```

The plan's `if (get().editOpSeq !== myOpSeq) return` is in the try-block before catch. If the fence-bump happens during the abort itself, it can lose. Move the check to the top of catch as well.

### N4. §1.7 telemetry queue: `flushQueue` not bound to a debounced timer
Line 248 says "flushQueue(); // debounced 5s" but no implementation, no timer ref, no app-foreground re-arm. Also: `if (queue.length === 0) return` runs synchronously — but the comment says debounced. If `sendEditDiag` is called 10 times in 200ms, do we get 10 immediate flushes or one in 5s? The contract is ambiguous. State explicitly: "single setTimeout-based debouncer; reset on each push; coalesce".

### N5. §1.7 batch loss on background-throttle is unbounded
"应用 background 不发" — but events keep enqueuing while backgrounded. With queue cap 50 and an active brush session, the user can hit 50 events in <30s and lose the early ones. Two choices: (a) flush-on-background-transition (iOS BGTaskScheduler — likely overkill), (b) accept loss + sample brush_gate_failure to 1-in-N. Pick one and document.

### N6. §0.1 says "实测 2 次成功率" but spike file naming suggests something else
"实测 2 次成功率(主流大路 + 小路)" header is unclear — does it mean two corpus runs? "Two-pass" success? Either way, "n=51" + "n=31" reads like single-run sample sizes, not "2 attempts". Wording should be "two corpora" or "两组样本" — minor but the document has otherwise been very disciplined about precision.

### N7. §13.1 telemetry payload missing `metric_value` + `threshold`
R2v2 specifically asked for these. §13.1 has `reason, stroke_idx, stroke_vertex_count, stroke_length_m, region, ms_taken, app_version` — useful but doesn't let you tune thresholds post-ship. For G3 corridor failures, you want `actual_max_dist_m` to know "did we miss by 1m or 100m?". Add `metric_value: number, threshold: number` to gate failures.

### N8. §0.1 small-road n=31 ±5pp note: math is right but rollback trigger doesn't catch it
Plan acknowledges 96.8% small-road acceptance "1 case flip → 93.5% breaches red line". But §13.2 rollback only triggers at <60% ACCEPT rate. There is no "small-road specific drift" alarm. Given small-road n=31 is the most fragile spike result, telemetry should split urban-large-road vs urban-small-road and alarm independently if small-road drops below 92%.

---

## Recommendation

**NEEDS_WORK**. Author closed 14 of 15 prior callouts cleanly. This is significantly better than v2. Remaining work is small (~1 hour plan edits, no re-spike):

**Must-fix before PASS**:
1. **Case 2** (N1) — split or delete; "undo-required" is not PASS at single-pass gate
2. **Add `runPreviewLifecycle.test.ts`** to §6.1 (N2) — fence/timeout/abort/double-tap unit-testable, must not be device-matrix-only
3. **§1.2 fence-vs-abort race** (N3) — add fence check at top of catch block
4. **§1.7 debouncer spec** (N4) — single setTimeout, reset-on-push, ~3 lines
5. **§13.1 add `metric_value` + `threshold`** (N7) — needed for post-ship tuning
6. **§13.2 add small-road-specific rollback alarm** (N8) — n=31 fragility demands it

Items N5 (background loss) and N6 (wording) can ship as-is with comments.

**Top 3 issues**:
1. Case 2 still conflates undo-required with PASS (poisons 16/18 ship gate)
2. Cases 14-18 have zero unit-test coverage despite being pure-logic state-machine bugs
3. fence-vs-timeout race in §1.2 catch path is under-specified — silent-abort UX promise can leak

**Verdict: NEEDS_WORK** — one more revision, then PASS. Do not re-spike. The plan has earned trust through three rounds of disciplined revision; the residual issues are mechanical, not architectural.
