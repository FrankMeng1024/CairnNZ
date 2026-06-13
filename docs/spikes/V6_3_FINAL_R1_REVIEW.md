# R1 Plan Review — v6.3 FINAL
**Verdict**: BLOCK
**Confidence**: HIGH

The plan repeats the v6.2.x lie pattern — different shape this time. The ACCEPT-rate numbers in §0.1 / §11 / §0.2 cite `spike-final-v63-PO-1pager.md`, but that summary contradicts a sibling spike (`spike-fresh-v63-summary.md`) run on the same 250 jury corpus. The plan picks the favorable summary, hides the unfavorable one, and never reconciles.

---

## Status of previous 7 blockers (B1–B7)

| Was | Status now | Evidence |
|---|---|---|
| B1 fabricated ACCEPT% | **STILL BROKEN (different lie)** | See N1 below |
| B2 G3 unit confusion | **PARTIAL** — plan §1.4 bans G3-bearing endpoint gate citing real spike data; correctly handled per `V6_3_BEARINGS_VERDICT.md`. But §1.3 G3 = corridor-meters (250m), not bearing — that is a *different* gate from the V6_3_BEARINGS_VERDICT.md verdict, and naming both "G3" causes confusion |
| B3 radiuses=25 unverified | **FIXED** — `spike-fresh-v63-summary.md` line 6: r15=r25=r40 produce identical output on 250 cases |
| B5 /api/edit-diag unreachable | **FIXED** — verified 200 + `{id:237,ok:true}` `V6_3_EDIT_DIAG_VERIFICATION.md:23` |
| B6 file paths wrong | **FIXED** — §7 uses `app/src/...` |
| B7 LOC underestimated | **FIXED** — §7 total ~1290 LOC matches `V6_3_CODE_AUDIT.md:135` (~1280 LOC) |

(B4 was a numbers contradiction — see N1.)

---

## New blockers

### N1. §0.1 cites ONE spike summary; the sibling spike on the SAME corpus says NOT SHIPPABLE.

Plan §0.1 quotes `spike-final-v63-PO-1pager.md` (大路 100/100, 小路 97/100, "PO 红线 MET").

But `C:/Users/I585134/spike-fresh-v63-summary.md` lines 1–8, run on the same 250-jury corpus, reports:
> **NOT shippable** under target "single-pass ACC ≥ 70% AND FA ≤ 50%". Best config (C7 G4+bearing≤25°): ACC=68.7%, FA=41.4%.
> **NOT shippable** under target "3-tries ACC ≥ 95% with FA ≤ 50%". Best 3-tries within that FA cap is 92.2%.

Both files exist. Both claim 250-case real Mapbox calls. Plan never mentions the contradicting file. Two possible reasons:
1. The two spikes used different ACCEPT-truth labelings (PO-1pager redefines "user穿楼弹合理路 = SUCCESS" → moves cases from FA bucket to TP bucket → numbers go up).
2. The PO-1pager subagent is the same hallucination pattern v6.2.x had.

`spike-final-v63-product.md:79–85` quietly admits the redefinition — Variant A "REJECT FA rate 71.6%" is the same data the fresh spike calls "FA=65.5%" on C1. The 100%/97% numbers are real ONLY under PO's relabeled truth set, which `product.md:144` itself flags as "did not separately label" and "follow-up labeling task before claiming the product is shippable end-to-end."

**The plan ships on a redefinition that the source spike says is not yet validated.** This is the v6.2.2 "99% 实测" disease in new clothing. BLOCK until either (a) the redefinition is explicitly justified in §0 with the FA breakdown shown to PO, or (b) the fresh-spike numbers (68.7% ACC, 41.4% FA) are surfaced and PO re-confirms.

### N2. §0.2 column "频率 80%/15%/<2%/<3%" is fabricated.

No source. No telemetry exists yet (telemetry is being added this Sprint per §5). These percentages cannot be measured pre-ship. Either delete the column or label it "PO assumption, unverified."

### N3. §11 row 8 "实测单笔 ~500ms 含 simplify" lacks citation.

Numbers in §11 must come from `spike-final-v63-product.md` or `spike-fresh-v63-results.md`. Neither file measures end-to-end per-stroke time including simplify. `BRUSH_EDIT_MEMORY.md` says spike-china-net measured 173ms for a different config. 500ms is invented.

### N4. §10 small-road n=31 caveat directly invalidates §0.1 "MET".

§10 says: "n=31 偏小,ship 后真用户数据再测". §0.1 says: "✅ MET 96.8% (30/31)". `spike-final-v63-product.md:143` says "single bad-luck retest could drop it to 93.5% (29/31)". A single labeling error or one different stroke flips the verdict from MET to NOT MET. §11 cannot present this as "satisfied" without an honesty caveat ("met by 1 case margin, ±5pp").

### N5. §6.2 case 2 expectation conflates ACCEPT with user-correctable.

Case 2: "沿主路 + 50m 斜穿小区 → 接住(可能弹平行路,undo 重画)". If "弹平行路" then undo is required = single-pass FAILED. The pass criterion "12/13 cases" lets case 2 count as PASS even when the user must undo. This is the v6.2.3 accounting trick the previous R1 review (C7) blocked. Either case 2 must succeed without undo OR it does not count.

---

## Critical

### C1. §1.3 G3 corridor metric: "snap polyline 任一点离笔 (stroke) > 250m" — should be measured against the **drawn stroke**, not the **original route**. Plan says stroke. `spike-corridor-100v-results.md:106` measured "stroke-as-corridor-anchor" → 0.5% URBAN exit rate. So plan matches spike data. OK. But `_archived_V6_3_R1_REVIEW_BLOCKED.md` C1 raised an unresolved question for **multi-stroke**: when the 4th stroke extends the route 600m beyond the original, is "原路线" the pre-edit polyline or progressively-updated polyline? §3.1 says "基于会话开始的原 walkedIndex(不被前笔影响)" but G3 uses "stroke" not "原路线" — so this looks consistent now. NOT a blocker, but §3.1 should explicitly say G3 is stroke-relative, G1 is original-route-relative.

### C2. §1.1 stroke simplify ε escalating 5/10/20/40 — algorithm correctness OK per `spike-corridor-100v-results.md:81–82`. ε=5m recovers 24/26 to ≤100 vertices, of which 21 return Ok = 81%. Math holds. But §1.1 code shows `for (const eps of [5, 10, 20, 40])` then `slice(0, 100)` fallback. On a 200-vertex stroke where ε=40 still gives >100 vertices, slicing to first 100 corrupts the geometry tail. Should fall back to evenly-spaced 100-point resampling, not head-slice. Minor algorithm bug.

### C3. §1.4 ban "G3 bearing gate(端点)" cites correct verdict per `V6_3_BEARINGS_VERDICT.md`. But the verdict's **recommendation** is "YES, post-hoc G3 = 15°" — and plan rejects it. `V6_3_BEARINGS_VERDICT.md:138–144` says G3=15° catches 2/3 short-INVISIBLE FAs at zero TP cost. Plan rejects on grounds "小路从 96.8% 跌到 87.1%" — but that 87.1% number is from `spike-final-v63-product.md` Variant D (with-bearings + bearing-gate), measuring INPUT bearings + post-hoc gate combined. The pure post-hoc G3=15° verdict isolates the post-hoc gate alone. Plan dismisses both signals together. Should run isolated post-hoc-G3-only spike before banning. (Not a blocker on the simpler "ship without bearings" path, but `§1.4` line is overstated.)

### C4. §2.3 DEM retry "200ms × 3" still unverified. Previous R1 C4 raised this; not addressed. `V6_3_CODE_AUDIT.md:33,38` confirms `queryTerrainElevation` has 0 hits in current code. Mapbox-gl-rn `queryTerrainElevation` returns null until DEM tiles load — there is no documented retry-after-N-ms guarantee. Spike this 30-min before committing to the pattern, or graceful-degrade to alt=null on first null and skip retries.

### C5. §6.1 unit tests miss multi-stroke serial test. §3.1 says "Mapbox 调用串行(避免 rate limit)". No test verifies serialization or that 4-stroke parallel collapse to serial actually happens. Add `multiStrokeSerial.test.ts`.

### C6. §6.2 case 11 "NZ Tongariro 上画 → 拒" uses real production map with no test data. `spike-final-v63-product.md` only has n=2 mountain cases — not enough to validate "拒" is reliable. Document this as "pre-ship qualitative check," not a pass criterion.

### C7. §12 missing risk: Mapbox API rate limit. 4 strokes serial × 1 user × peak (a Saturday morning hike-planning session) → bursts of 8–16 calls/min/user. Mapbox /matching free tier is ~600/min global — not a per-user throttle but a project-wide one. Plan must either cap concurrent users at <100 active editors or add backoff. Also ties into §5 telemetry: 7 events × 4 strokes × 1000 users = 28K events/day — well within `/api/edit-diag` 60/5min/IP budget per device, but worth noting.

### C8. §3 "persistSession 中途半状态 → 仅在 commit 时持久化" — but autosave drafts is a UX expectation. If user backgrounds the app mid-stroke and returns 1 hour later, current behavior is "draft lost." Plan does not call this trade-off out. Either preserve draft on app-background OR document the data-loss window.

---

## Medium

- **M1.** §4.5 G3 文案 "画的太远了" vs G2 "未识别到这条路" — clear. OK. (Previous M2 fixed.)
- **M2.** §11 row 5 "城市误接受 → 主流近 0" — still optimistic. Variant A FA = 71.6% per `spike-final-v63-product.md:38`. Even after PO redefinition (~50% are designed-success), residual true-wrong-snap FA ~35%. "主流近 0" overstates.
- **M3.** §6.2 13 cases — "12/13 通过" allows 1 case to fail. If case 1 (沿主路画) fails, that is NOT acceptable — it is the primary happy path. Pass criterion should be: case 1 + case 12 (UI) MUST pass; up to 1 of cases 2–11, 13 may fail. Differentiate.
- **M4.** §9 ship checklist missing: live POST to `/api/edit-diag` returning 2xx within 24h of OTA push (per `V6_3_EDIT_DIAG_VERIFICATION.md:63`).
- **M5.** §7 "OtaBadge 255 → 256" — `V6_3_CODE_AUDIT.md:90` confirms current 255 at L778. OK.
- **M6.** §10 "API 调用优化" deferred — fine, but C7 above means rate-limit handling cannot all be deferred. At minimum need request serialization in v6.3.
- **M7.** §3.1 "Mapbox 调用串行" — spec'd but no LOC budget in §7. Adding `await` chain to multi-stroke runPreview is ~20 LOC; absorb into store rewrite estimate.

---

## What plan got right

1. **Real spike data for radiuses (B3 fixed)** — `spike-fresh-v63-summary.md:6` empirically shows r15=r25=r40 identical, plan locks in 25.
2. **/api/edit-diag verified live (B5 fixed)** — `V6_3_EDIT_DIAG_VERIFICATION.md:23` shows 200 + `{id:237,ok:true}`.
3. **File paths corrected (B6 fixed)** — §7 uses `app/src/...`.
4. **LOC honest (B7 fixed)** — §7 total 1290 LOC matches `V6_3_CODE_AUDIT.md:135` ~1280.
5. **Stroke simplify backed by real data** — 81% recovery from `spike-corridor-100v-results.md:96`.
6. **G3 corridor 250m backed by real data** — 0.5% URBAN exit rate from same file:106.
7. **§1.4 ban list** correctly cites real spike data per `V6_3_BEARINGS_VERDICT.md`.
8. **§3 7-bug list** maps to real v249–v255 bugs.
9. **§7 separating new files** (`utils/strokeGate.ts`, `services/editDiagSender.ts`) is clean factoring.
10. **§9 R1+R2+R3+R4 four-eye gate** preserved.
11. **§10 deferred-work list** is honest.

---

## Recommendation

**BLOCK.** B3, B5, B6, B7 from previous review are genuinely fixed. But the plan now leans entirely on `spike-final-v63-PO-1pager.md` while a sibling spike (`spike-fresh-v63-summary.md`) on the same corpus says NOT SHIPPABLE. The 100%/97% numbers are real only under a PO truth-set redefinition that `spike-final-v63-product.md:144` itself flags as "follow-up labeling task before claiming the product is shippable."

Required before re-review:
1. **Reconcile the two contradicting spike summaries in §0.** Either show the FA breakdown (~50% designed-success vs ~50% true-wrong-snap, per `spike-final-v63-product.md:88–89`) and have PO sign off on the redefinition explicitly, OR surface the fresh-spike numbers (68.7% ACC, 41.4% FA) and have PO re-confirm under the original truth set.
2. **Delete §0.2 frequency column** or label "PO assumption, unverified."
3. **Cite §11 row 8 timing** to a real spike file or remove.
4. **§6.2 case 2 cannot count toward 12/13** if "弹平行路 → undo" is the outcome.
5. **Add multi-stroke serial test** (C5).
6. **30-min queryTerrainElevation spike** (C4) or graceful-degrade-on-first-null.
7. **Risk §12: rate limit + draft persistence** (C7, C8).

The skeleton (G1+G2+G3, simplify, alt, telemetry, state fixes) is sound. The verdict-framing in §0 / §11 is what needs to be honest before ship.

---

**Cited files**:
- `C:/Users/I585134/spike-final-v63-PO-1pager.md`
- `C:/Users/I585134/spike-final-v63-product.md`
- `C:/Users/I585134/spike-fresh-v63-summary.md`
- `C:/Users/I585134/spike-fresh-v63-results.md`
- `C:/Users/I585134/spike-corridor-100v-results.md`
- `C:/ClaudeCodeProjects/Cairn/docs/spikes/V6_3_CODE_AUDIT.md`
- `C:/ClaudeCodeProjects/Cairn/docs/spikes/V6_3_EDIT_DIAG_VERIFICATION.md`
- `C:/ClaudeCodeProjects/Cairn/docs/spikes/V6_3_BEARINGS_VERDICT.md`
- `C:/ClaudeCodeProjects/Cairn/docs/spikes/_archived_V6_3_R1_REVIEW_BLOCKED.md`
