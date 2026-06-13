# R1 Plan Review — v6.3 simple

**Verdict**: BLOCK
**Confidence**: HIGH

This plan repeats the v6.2.x failure mode: claims that are not backed by the cited spike data, and an algorithm whose gates differ from what the spike actually tested. Below are the specific contradictions, with file/line evidence.

---

## Blockers (must fix before ship)

### B1. §1.3 ACCEPT-rate numbers are FABRICATED. Cited spike data contradicts the plan.

Plan §1.3 claims:
> "G4 + G2 + G3: 估计 ~85-88%" and "目标单次 ACCEPT ≥ 80%, FA ≤ 50%" and "**3 次累积:96%**——满足红线"

Actual data in `C:/Users/I585134/spike-clean-v623-summary.md`:
> "**NOT SHIPPABLE on cached G2/G3 sweep alone**: max ACCEPT% under FA ≤ 2% is 5.2%."
> "Strict (FA ≤ 1%): ACCEPT=5.2%. Balanced (FA ≤ 3%): ACCEPT=6.0%. Permissive (FA ≤ 5%): ACCEPT=6.0%."
> "Absolute ceiling on this cache: ACCEPT=64.2% but FA=40.5%."

`spike-jury-summary.json` "summary_for_PO_400_chars" says: "Best threshold-only config: 1.7% FA, 96% FR." That is 4% ACCEPT, not 80-88%.

The plan asserts 85-88% ACCEPT with **zero** spike to back it. The "estimate" is a hope, dressed as data. This is exactly the v6.2.2 lie ("99% 实测") that BRUSH_EDIT_MEMORY.md §7 says "永远不重蹈". **Block ship until either (a) fresh spike data demonstrates ≥70% ACCEPT under proposed gates, or (b) the plan is honest that the number is unknown.**

### B2. §1.2 G3 is in METERS but the spike sweep tested G3 in DEGREES. The gate was never tested.

`spike-work/sweep_results.json` shows g3_levels = `[10, 15, 20, 25, 30, 40]` — these are degrees (G3 in spike was bearing). BRUSH_EDIT_MEMORY.md §10 confirms the cache sweep was a degree-based G3.

Plan §1.2 G3:
> "笔每个点离 Mapbox snap 输出的 max-perp ≤ **50m** … 抓 14% 的"远弹"穿楼/穿草坪 case(实测 250 corpus 中 12 个 > 50m)"

This is a NEW max-perp gate, not the one the spike measured. The "12 个 > 50m" claim has no file reference and is not in `spike-jury-summary.json`. **G3-as-meters is unverified and the claimed catch rate is unproven.** Either re-spike with G3-perp or drop the claim that data backs it.

### B3. §1.1 radiuses=25 is unverified — cache is radiuses=8.

`spike-clean-v623-summary.md` line 7 says explicitly: **"Fresh API calls required: sweep radiuses ∈ {15, 25, 40}"**. The fresh sweep has not been run (no `spike-r25-*` or `spike-fresh-*` file exists in `C:/Users/I585134/`).

Plan §1.1 commits to radiuses=25 as a determined choice and §13 item 1 calls 25/15/40 comparison "v6.3.1 future work". This inverts the spike summary's recommendation: the pre-ship gating is the choice of radiuses, not a post-ship optimization. Plan v6.2.3 was BLOCKED for this exact pattern (memory.md §7: "v6.2.3: radiuses=8 没人测过 — 永远不在 spike 之外做参数选择").

**Run the radiuses fresh-sweep BEFORE plan freeze, not after.**

### B4. §11 PO red line table contradicts §1.3 numbers.

§11 row 1 claims "92.5% G4 通过" — but G4 is just `code === 'Ok'` and §1.3 ACCEPT-bucket only. The table presents this as "main red line satisfied" while the actual end-to-end ACCEPT (G1∧G2∧G3∧G4) is unmeasured. Row 5 ("城市误接受 → 主流近 0") is asserted with no FA% number — and the corpus shows 65% INVISIBLE-class REJECTs would slip through the proposed G3=50m. That is not "near 0".

### B5. /api/edit-diag endpoint reachability not verified.

`curl -X POST https://yiiling.io/api/edit-diag` returned HTTP 000 (no response within 8s timeout) at review time. Plan §5.1 + BRUSH_EDIT_MEMORY.md §6 both assert the endpoint exists. No evidence in repo (`grep edit-diag` finds zero matches in source code). Cannot ship telemetry without first verifying the endpoint accepts traffic. Add to ship checklist: live POST returning 2xx within last 24h.

### B6. §7 file paths are wrong — files live at `app/src/...`, not the plan's paths.

Plan lists `services/routing/corridor/PolylineSampler.ts` etc. Actual paths verified:
- `app/src/services/routing/corridor/PolylineSampler.ts`
- `app/src/services/routing/mapmatch/MapMatchingClient.ts`
- `app/src/store/useRouteEditStore.ts` (2013 LOC)
- `app/src/screens/RouteEditorScreen.tsx` (914 LOC)

Not blocking on its own, but signals plan was written without opening repo. Combined with B7 below this becomes a red flag.

### B7. §7 LOC estimates are off by 2-5x.

useRouteEditStore.ts is **2013 lines**. Plan estimates 180 LOC change for: "4 道门重写 + undo/reset 修 + 删 5 旧判据 + 删 smoothCatmullRom 调用 + 多笔串行 + alt 保留". That's 6 distinct workstreams in one file. Realistic surface ~400-600 LOC. Combined with §3.1 multi-stroke serial rewrite + §3 the 7 state-management bugs (each touches push sites), the true change is closer to 500 LOC. This will compress test/review time at end of Sprint — same v6.2.x failure mode where developers run out of time and skip QA.

Either (a) split into 2 stories or (b) raise the budget honestly.

---

## Critical (likely fix)

### C1. §1.2 G2 250m and §3.1 multi-stroke math don't match.

§3.1: "每笔独立判 … 基于编辑会话起始的原 walkedIndex". §1.2 G2: "snap 输出的任一点离原路线 ≤ 250m". For the 4th stroke that legitimately extends the route 600m from the original, G2 will reject it because "原路线" still means the pre-edit route. Plan does not specify whether G2 evaluates against pre-edit polyline or progressively-updated polyline. This bug bit v249 (BRUSH_EDIT_MEMORY.md §7).

### C2. §0.2 N-times accumulation math assumes independence.

The 70/91/97/99 table is `1 - (1 - p)^N`. That assumes attempts are independent. They are not: a user redrawing the same flawed stroke through the same plaza will hit the same Mapbox snap to the same wrong street. Real accumulation is far worse than the table. The "97% at 3 tries" claim is provably optimistic.

Either drop the math table or qualify it as best-case.

### C3. §11 row 8 "单笔 ~200ms,4 笔 ~800ms" — number is fabricated.

No spike measures 200ms per-stroke for the **proposed** profile=walking + radiuses=25 + tidy=false. Spike-china-net.txt apparently measured 173ms but for a different config (BRUSH_EDIT_MEMORY.md §8). With radiuses=25 and tidy=false, response time is unverified. Don't promise "≤3s" on guessed numbers.

### C4. §2.3 DEM retry "200ms × 3" — Mapbox SDK retry pattern unverified.

`grep queryTerrainElevation` returns zero matches in the repo. The retry pattern is invented. Mapbox-gl-rn `queryTerrainElevation` returns null until DEM tiles are loaded; there is no documented "retry-after-N-ms" guarantee. This needs a 30-min spike, not an estimate.

### C5. §1.4 says ❌ "G3 bearing INVISIBLE 65% 上无效" but BRUSH_EDIT_SPIKES.md §3 spike-deep-tests.txt says "bearings 提升 5e+05×".

Plan dismisses bearings; spike archive endorses it. Reviewer cannot tell which is true. This contradiction must be resolved or the §1.4 claim cited to a specific file/line.

### C6. §5.3 claims 50 LOC for telemetry, but §5.2 lists 7 events with payload computation (region detection, undo_stack_depth tracking, ms_taken timing, has_alt boolean derived). Realistic ~120-150 LOC including types, region helper, and 7 call sites. Underestimate by 2-3×.

### C7. §6.2 case 2: "可能弹平行路, undo 重画" — happy-path test that allows "弹错" is not a happy-path test.

If case 2 is allowed to fail-then-undo, it cannot count toward the §0.2 single-pass ≥70% claim. The test matrix conflates "ACCEPT" with "user-correctable". This is the same accounting trick as v6.2.3.

---

## Medium (nice to fix)

- **M1.** §13 item 1 ("radiuses 真值优化") is a Blocker not future work — see B3.
- **M2.** §4.5 拒收文案 G3 says "没识别到这条路" but G4 says "未识别到这条路" — same Chinese phrasing for two different gates makes user-side debugging impossible. Differentiate.
- **M3.** §3 table row "editOpSeq fence … Mapbox await 期间 fence 触发 → 静默 abort" — silent abort is a known Sprint-7-class bug source (memory.md "feedback_review_loop_dynamic"). Should log telemetry on every silent abort.
- **M4.** §2.4 "v249-v255 saved route 加载正常,海拔图显示 0" — display=0 vs display=hidden is a UX choice the plan doesn't justify. RouteDetail will look broken on old routes.
- **M5.** §6.1 unit-test list misses negative case for G2 under multi-stroke (C1).
- **M6.** §9 ship-标准 checklist missing item: "fresh /api/edit-diag POST returns 2xx" (B5).
- **M7.** §1.2 G1 anchor ≤50m — same threshold as v6.2 spike-validated. Good. But §4.6 "起笔规则" duplicates the rule informally; consolidate.

---

## Things plan got RIGHT (preserve)

1. **§1.4 deletion list** is correct and well-cited — confidence/null/alts/Catmull-Rom/profile=driving all backed by BRUSH_EDIT_MEMORY.md §4.
2. **Honest framing** that single-pass FA cannot be 0% (§0.1, §0.2) is the right philosophical reset after v6.2.x.
3. **§3 state-bug list** (7 items) maps to real v249-v255 bugs documented in memory.md §7.
4. **§4 single-row XOR error** is the right UX call.
5. **§7 separating new files (`utils/strokeGate.ts`, `services/editDiagSender.ts`)** is correct factoring — pure functions are testable.
6. **§9 R1+R2+R3+R4 four-eye gate** is preserved from the working v6.2.3 review process.
7. **§10 "已知不做"** is honest about what's deferred.

---

## Recommendation

**BLOCK.** The plan repeats the v6.2.x lie pattern: it asserts ACCEPT-rate numbers (80-88%, 96% at 3 tries) that no spike has measured, and replaces the spike's degree-based G3 with a meter-based G3 without re-spiking. Two separate v6.2 reviewers (R1+R2) both BLOCKED v6.2.3 for "未实测的数字"; v6.3 has the same disease.

Required before re-review:
1. Run the fresh radiuses {15,25,40} sweep that `spike-clean-v623-summary.md` line 7 explicitly demands, on the same 250-case corpus. Until that runs, B1+B2+B3 cannot be cleared.
2. Replace §1.3 estimates with measured numbers OR mark them honestly as "estimate, unverified".
3. Verify /api/edit-diag with a live POST and add to ship checklist.
4. Fix §7 file paths and re-estimate LOC honestly (B6+B7).
5. Resolve §1.4 vs spike-deep-tests.txt bearings contradiction (C5).

Once those four are addressed, this can return for re-review. The skeleton (gates G1/G4 + UX + state fixes + telemetry) is sound. The numbers and the unverified G3-meters claim are not.
