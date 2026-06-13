# R2 Plan Review — v6.3 FINAL (independent)

**Verdict**: NEEDS_WORK
**Confidence**: HIGH

Senior-engineer-inheriting-this-codebase angle. R1 covers citation traceability; I do not. I look for what bites you in production at 2am after OTA-256 ships.

---

## Production failure modes the plan ignores

1. **No timeout / cancel contract for the Mapbox call.** §11 row 8 claims "等待 ≤ 3s, 实测 ~500ms" but there is no client-side `AbortController`/`signal` mentioned for `MapMatchingClient`. China-net spike showed 173ms median — that's not a worst case. p99 cellular = 8–15s. Plan does not specify: (a) what timeout value, (b) what UI shows after timeout, (c) whether the brush stroke survives or is removed. §3 mentions "editOpSeq fence + 静默 abort" only for hardware-back / background, not network timeout. Define `MAPBOX_TIMEOUT_MS = 6000` explicitly with G2-route-to-rejection on AbortError.

2. **Concurrent strokes are silently assumed to be impossible.** §3.1 says "Mapbox 调用串行 (避免 rate limit)" — but **what enforces serialization?** If `runPreview` is invoked twice (Preview button mashed, or stroke 2 finishes during stroke 1's await), is there a mutex? `editOpSeq` is named but not specified. Without an explicit `if (state.isComputing) return;` guard at button entry AND a queue-or-drop policy for in-flight, you have a TOCTOU race that will produce ghost strokes in production.

3. **persistSession on commit only = data loss is the contract.** §3 row 7 says "仅在 commit 时持久化". This is fine if and only if losing in-progress edits on background-kill is acceptable. iOS jetsams photo-heavy apps aggressively. PO red line table doesn't address this. State the contract explicitly: "drafts are ephemeral; user must hit Save". If unstated, QA will find users complaining "lost my edits".

4. **brushStrokes array unbounded.** No max-stroke cap mentioned. After 50 strokes the React render of `BrushStrokeLayer.tsx` (398 LOC, renders all strokes) will jank. v249 already had a "越画越卡" bug (memory.md §7). Cap at e.g. 20 strokes per session, with UX "max strokes reached".

5. **DEM tile race is hand-waved.** §2.3 says "null → 200ms × 3 重试 → 仍 null = alt = null". This means **600ms blocked on terrain queries per snap point**. A 100-vertex polyline = up to 60s blocking if tiles aren't cached. Plan needs: parallel queries, cap on retries per session, and `alt = null` is documented as expected for offline use.

---

## Algorithm edge cases not tested

1. **1-vertex stroke (tap).** `simplifyStroke([p1])` — DP on length-1 returns it; Mapbox /matching with 1 coord returns 422. Add G0 minimum-2-points pre-check.

2. **DP fallback truncation distorts geometry.** §1.1 line 53: `points.slice(0, 100)` — picks the **first** 100 points. If user drew 500m and DP=40m still produces 130 points, you keep the first 38% of the route and lose the rest. The corridor will be measured against a partial stroke and G3 will pass when it shouldn't. Use evenly-spaced sampling instead: `every Math.ceil(N/100)`.

3. **Mapbox returns Ok with degenerate polyline.** Spec doesn't guarantee `geometry.coordinates.length >= 2`. If matching returns 0 or 1 coords, G3 corridor calc (Haversine on adjacent pairs) divides by zero. Add G0.5: `if (snap.length < 2) reject as G2`.

4. **DP epsilon == 0 / coincident points.** GPS plus brush sampling on iOS sometimes emits identical consecutive points. DP with ε≥5 handles this, but the `points.slice(0,100)` fallback doesn't dedupe. Confirm.

5. **G1 anchor on closed-loop routes.** "起点或终点 ≤ 50m 离原线" — if the original route is a loop, both endpoints will pass G1 even when stroke is on the wrong half of the loop. Not tested in the 13-case matrix.

---

## State / persistence concerns

1. **walkedIndex rebuild after undo is mentioned but not specified.** Plan §3 says `buildWalkedIndex(last.matchedPoints)` on undo. What if `last.matchedPoints` is undefined (first stroke undone)? What if the new walkedIndex disagrees with the rendered polyline by 1 segment? Reproducer: draw, save, reopen, undo. There's no test #14 for "save → reopen → undo".

2. **Cross-version saved-route compat is asserted, not tested.** §2.4 line 147: "v249-v255 saved route 加载正常,海拔图显示 0". But v255 stored `matchedPoints` snapshots that may include fields v6.3's reducer doesn't expect. The `backCompat.test.ts` (50 LOC) is in the test list but its content isn't specified. Need explicit: "load fixture from `app/test-fixtures/route-v255.json`, assert no throw, assert distance recomputed."

3. **No schema version on persisted routes.** `LocalRouteExtras.ts` has `alt?` but no `schemaVersion`. When v6.4 inevitably needs another field, you'll do another silent-migration debugging session. Add `schemaVersion: 'v6.3'` now; cost = 5 LOC; saves 2 days later.

---

## Telemetry under failure

1. **No queue / no retry policy for /api/edit-diag.** §5 says new `editDiagSender.ts` ~30-50 LOC. At that LOC budget you have no offline queue, no retry, no de-dup. The endpoint **is** rate-limited (60/5min/IP — confirmed via real probe in `V6_3_EDIT_DIAG_VERIFICATION.md`). On corporate WiFi 3 users on the same NAT × 7 events × edit cycles will throttle within minutes; events drop silently. Spec a fire-and-forget-with-cap policy: drop on >5 in-flight, no retry on 429, log to `console.warn` only.

2. **`brush_alt_dem_null` event fires per session — but plan doesn't say sampling rate.** If user draws 100 strokes with bad DEM, that's 100 events, ~1.6× the IP rate limit alone. Sample at 1-in-N or send aggregate.

3. **Endpoint host is out-of-tree.** `V6_3_EDIT_DIAG_VERIFICATION.md §verdict` notes the route handler lives in the external yiiling backend, not in this repo. Plan does not flag this as a coupling risk. If yiiling backend goes down or schema changes, v6.3 telemetry silently breaks. Ship-blocking? No. Worth a one-liner in §12 risk table.

---

## Test plan gaps

The 7 unit tests cover only ~5 of the 7 §3 state bugs. Specifically missing:
- **eraseAt / removeStroke / beginTrimDrag undo push** — the plan lists these in §3 row 4 but no test covers them. `undoWalkedIndex.test.ts` only covers undo+reset, not the per-action push paths.
- **editOpSeq fence on hardware-back / backgrounding** — §3 row 6, no test. This is the easiest bug to regress and the hardest to debug.
- **persistSession in-flight invariant** — §3 row 7, no test.

The 13-case device matrix has zero coverage for:
- Hardware Android back button mid-Preview (§3 row 6 requirement)
- App backgrounding during /matching await (§3 row 6 requirement)
- Crashed-resume (kill app while editing, relaunch)
- Slow network (cellular 3G or airplane-mode-toggle)
- Rate-limit hit on /api/edit-diag

"12 / 13 cases pass" with 1 freebie is too lenient given v249-v255 history. Tighten to 13/13 with 2 explicit "expected fail" cases listed.

**Navigation regression step is also missing.** CLAUDE.md (Integration step 5a) requires console-error check after every page TO/AWAY/BACK. Plan §6 device matrix doesn't have it. This is the regression that has bitten Sprint 7 and 12 — it will bite again.

---

## Timeline reality check

§8 says **2.5 weeks for 1290 LOC across 14 files**, this being attempt #8 after 7 OTA failures.

Senior-engineer pace with proper test+review cycles: ~150 LOC/day = **8.6 days for code only**. Add:
- 4-eye review cycles R1+R2 plan (done) and R3+R4 code (planned 1 day in §8 — unrealistic; code review of 1290 LOC across 14 files takes 1.5-2 days each reviewer with revision loops, plan it as 2-3 days)
- Real-device matrix on iOS + Android (§12 row 6 acknowledges the platform-difference risk; but §8 budgets 1 day for both platforms — unrealistic)
- Bug fix loops from the QA matrix (always 2-3 round-trips on a brush feature this gnarly)
- OTA build + cert + push

Realistic floor: **3.5 weeks**. The 2.5-week estimate has the same understatement pattern as the rejected v6.2 plan claiming "180 LOC for store" when audit said 300. **Pad §8 to 3.5 weeks or accept the slip will happen mid-sprint.**

---

## Internal contradictions

1. **§0.2 + §11 row 5** vs reality. Row 5 says "城市误接受 → 主流近 0,用户 undo 兜底 ✓" — but the only evidence cited is `po decision`, not data. Memory.md §10 says "REJECT-truth 一半是真 wrong-snap, v6.4 用 per-segment bearing 优化". So real wrong-snaps are happening at meaningful rate (~14% of strokes if half of 28.4% FA is true wrong-snap from §0.2 spike data). The "✓" should be a "△ accepted with caveat".

2. **§1.4 bans G3 bearing gate** but `V6_3_BEARINGS_VERDICT.md §recommendation` recommends post-hoc G3 at 15° (catches 2/3 short-INVISIBLE FAs at zero TP cost). Plan and bearings verdict disagree. Either (a) plan §1.4 is wrong to ban G3, OR (b) bearings verdict was overruled with reason. The plan should explicitly note "G3 bearing gate considered but **rejected** because spike-final-v63 small-road test showed it dropped recall 96.8%→87.1% — overrides V6_3_BEARINGS_VERDICT recommendation." Without this, future maintainer will re-add G3 and break recall.

3. **§7 file LOC**. Lots of "--" in the "真 LOC" column (only useRouteEditStore.ts and RouteEditorScreen.tsx have numbers). The audit doc has the actual counts (e.g. EditOverlayV236.tsx=515, BrushStrokeLayer.tsx=398). Fill these in for honesty — the "--" suggests the plan author didn't open those files.

---

## What plan got right

- §0.1 honest sample-size disclaimer ("n=31 偏小, ±5pp")
- §1.4 ban list is concrete and cites death causes — good institutional memory
- §2.3 DEM graceful degradation (`alt = null` instead of blocking)
- §5.1 endpoint actually verified live (matches `V6_3_EDIT_DIAG_VERIFICATION.md`)
- §7 LOC ~1290 matches the audit (correct upward revision from earlier 180 estimate)
- §10 explicit "已知不做" list — defers wisely

---

## What's MISSING from the plan entirely

1. **No rollback plan.** What if v6.3 ships and is worse than v255? Plan needs: "If 7-day post-OTA `brush_gate_failure` rate >X% OR `brush_save_committed` drops Y% vs v255 baseline, rollback by republishing OTA-255 binary as OTA-257." Without numeric trigger this becomes "we'll see how it goes".

2. **No pre-OTA QA gate gating commit hash.** §9 says "OTA 推前 commit hash 与 plan 对齐" but doesn't say what stops a hotfix commit sneaking in after 4-eye review. Add: "OTA build is from the exact commit on which R3+R4 verdict = PASS; any post-review commit forces re-review."

3. **Nothing about /matching token cost.** Mapbox /matching is billable. 7 events × N strokes × M users + the spike's 466 dev calls already used quota. §12 says "Mapbox 国内挂...实测 0 超时" but doesn't address cost. Confirm with PO that production budget covers expected volume.

4. **No structured logging on the gate decisions.** §5 telemetry events fire at outcomes but no event captures **why** G1/G2/G3 failed (what was the perp distance? what was the Mapbox code?). Without these payload fields, the post-OTA "tune the thresholds from real data" promise (§0.1, §12 row 1) is impossible. Add to §5.3: `brush_gate_failure { ..., metric_value, threshold }`.

---

## Recommendation

NEEDS_WORK — fixable in ~half a day of plan revision, no re-spike. Ship-block items:

1. Specify network timeout + concurrent-stroke serialization (§3 + §1.2)
2. Fix `points.slice(0,100)` to evenly-spaced (§1.1)
3. Add G0 (length<2) and G0.5 (snap<2 coords) cases (§1.3)
4. Resolve G3-bearing contradiction with V6_3_BEARINGS_VERDICT.md (§1.4)
5. Specify telemetry queue/rate-limit policy (§5)
6. Add hardware-back / background / crashed-resume / slow-net / rate-limit cases to device matrix (§6.2)
7. Add rollback trigger and per-gate metric-value payload (§9, §5.3)
8. Pad timeline to 3.5 weeks or split into 2 OTAs (§8)

Items 1, 2, 4 are correctness-critical. Items 6, 7, 8 are ship-readiness. Once 1-8 land, plan moves to PASS.
