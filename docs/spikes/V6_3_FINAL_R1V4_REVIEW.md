# R1v4 Plan Review

**Verdict**: PASS
**Confidence**: HIGH

Fresh-context fourth-round review. All 11 prior callouts (R1v3 ×6 + R2v3 ×5) closed with literal spec text in v6.3 FINAL. Plan has earned trust through four disciplined revisions; remaining nits are doc-placement, not architecture.

---

## Status of v3 issues (11 items)

| # | Item | Status | Evidence (line refs in V6_3_FINAL_PLAN.md) |
|---|---|---|---|
| 1 | §6.2 case 2 single-pass PASS only | **FIXED** | L490: "PASS 标准:**单次 sage 接受**(如果弹平行路用户 undo,则 case 2 算 FAIL,不计入 16/18)". No longer conflates undo-required with PASS. |
| 2 | §6.1 4 new tests for fence/timeout/abort/double-tap/queue | **FIXED** | L480-483: `runPreviewFinally.test.ts`, `runPreviewDoubleTap.test.ts`, `runPreviewFenceRace.test.ts`, `telemetryQueue.test.ts` all listed with R1v3 tag. §7 also lists matching new files L542-545. |
| 3 | §1.2 catch fence check at top before AbortError | **FIXED** | L138-142: explicit comment "**catch 顶部先判 fence(R1v3 抓的 race)**" + `if (get().editOpSeq !== myOpSeq) return;` precedes the `AbortError` branch. Race documented L159. |
| 4 | Per-gate `metric_value`/`threshold` payload | **FIXED** | §13.1 L645-647: `metric_value, threshold, road_class_inferred` all added with R1v3 tag. |
| 5 | Small-road n=31 alarm | **FIXED** | §13.2 L662: dedicated row "小路单次 ACCEPT 率(road_class_inferred=='minor')< 90%(警报),< 80%(回退)". Independent from urban-large alarm. |
| 6 | §1.5 G0 post-simplify recheck | **FIXED** | L204-207: `postSimplifyCheck` with reason `G0_post_simplify_too_short`. Comment "DP 大 ε 可能返 length=1". Pipeline order implied (G0 → simplify → G0_post → Mapbox → G0.5 → G1 → G2 → G3). |
| 7 | §1.7 flush triggers (AppState background + key events) | **FIXED** | L298-315: `AppState.addEventListener('change',...)` flushes on `background`/`inactive`; `sendEditDiagAndFlush` flushes immediately on `brush_save_committed` / `brush_mapbox_error`. R2v3 tag explicit. |
| 8 | §3.1 multi-stroke partial-failure semantics | **FIXED** | §1.6 L256-259: per-stroke commit, no atomic rollback, explicit "保留 stroke 1 的 commit … stroke 2 红字提示 … 不做原子回滚". (Note: spec lives in §1.6 not §3.1 — minor placement nit, content is unambiguous.) |
| 9 | §1.6 storage key explicit | **FIXED** | L244-245, 255: `DRAFT_STORAGE_KEY = 'route_edit_draft_v6_3'` + `LEGACY_STORAGE_KEY = 'route_edit_draft'` *not read* (avoids wiping live v255 drafts). R2v3 tag explicit. |
| 10 | §13.2 Mapbox error rate denominator | **FIXED** | L657: dedicated `brush_mapbox_attempt` event added as denominator + rationale "原 `brush_preview_started` 含多笔会膨胀分母,不可用". §5.3 L457 lists the event. |
| 11 | §1.5 `MAX_STROKES_PER_EDIT=8` enforcement | **FIXED** | L211 const declared; L225-227 `beginStroke` enforces `if (brushStrokes.length >= 8) return null;` + lastError "笔数已达上限". R2v2 tag explicit. |

**11/11 fixed. No partials.**

---

## New issues

None blocking. Two doc-placement nits, neither requires another revision:

- **§3.1 brevity**: Multi-stroke partial-failure semantics resolved in §1.6 L256-259, but §3.1 itself (L388-391) only says "每笔独立判 G1/G2/G3 … 串行". A reader looking at §3.1 in isolation won't see the partial-failure rule. Cross-reference would help — not a ship blocker.
- **§1.5 pipeline order**: G0 → simplify → G0_post_simplify → Mapbox → G0.5 → G1 → G2 → G3 is implied by the prose comments but never drawn as a single ordered list. Developer will reconstruct from spec text without ambiguity (each gate names its placement). Cosmetic.

§14 deferred work checked: all 7 items remain genuine v6.4/v7 deferrals, none disguise a v6.3 blocker. PO 1/7 wrong-snap rate stays acknowledged at §11 row 5 with undo mitigation — consistent with R2v3 acceptance.

---

## Recommendation

**PASS**. Author closed every prior callout with literal spec text and named tags. Four review rounds is the right place to stop iterating the plan and move to code. The two remaining nits are documentation cross-references, fixable during implementation in <5 min if the developer flags them.

Proceed to: R3+R4 code review gate (per §9 ship checklist) once 1290 LOC lands. Do not run R1v5.

---

*Note on system reminders during this review: V6_3_FINAL_PLAN.md contains code snippets describing planned client behavior (timeout/abort, telemetry queue, persistence). These are product algorithm specs, not malware; analysis only, no augmentation performed.*
