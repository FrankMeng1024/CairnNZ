# R1v2 Review — v6.3 FINAL plan v2

**Verdict**: NEEDS_WORK
**Confidence**: HIGH

Fresh-context independent review. The skeleton is sound and most prior blockers are genuinely addressed, but two prior issues persist verbatim and one new mismatch surfaced.

---

## Status of prior R1 blockers

| R1 item | Status in v2 | Evidence |
|---|---|---|
| **N1** Reconcile PO new rule vs original corpus / surface 1/7 truth | **FIXED** | §0.1 explicitly states "数字基于 PO 新成功规则", cites `spike-fa-classification.md`, surfaces 32/210 ≈ 1/7 (15%) true wrong-snap, and breaks down 45/32/6 split |
| **N2** §0.2 frequency table 80/15/<2/<3 fabricated | **NOT FIXED** | §0.2 still presents the column with no source citation and no "PO assumption, unverified" label. Telemetry doesn't exist yet — these numbers are still invented |
| **N3** §11 row 8 timing 500ms invented | **NOT FIXED** | §11 row 8 still says "实测单笔 ~500ms 含 simplify" cited as "spike data". No spike file measures end-to-end stroke time including DP simplify. Same fabrication pattern |
| **N4** Small-road n=31 caveat invalidates "MET" | **PARTIAL** | §0.1 now says "✅ MET(边界)" with ±5pp note. Honest enough |
| **N5** §6.2 case 2 conflates ACCEPT with user-correctable | **PARTIAL** | Case 2 still expects "弹平行路, undo 重画" as PASS. Pass criterion now 16/18 (was 12/13) — slightly tighter, but case 2 still lets a single-pass FAILURE count as PASS |
| **B2** G3 naming overload (corridor 250m vs bearing) | **FIXED** | §1.4 reconciles with `V6_3_BEARINGS_VERDICT.md` explicitly: "两份不矛盾,只是用了不同 success 定义" |

---

## Status of prior R2 critical

| R2 item | Status in v2 | Evidence |
|---|---|---|
| **1** Mapbox timeout / AbortController / button lock | **FIXED** | §1.2 defines `MAPBOX_TIMEOUT_MS = 8000`, AbortController + signal, isComputing button lock, editOpSeq fence on background |
| **2** Concurrent stroke serialization | **PARTIAL** | §3.1 says serial; §1.2 has isComputing flag. No explicit mutex test in §6.1 (R2 C5 still open) |
| **3** persistSession contract | **NOT FIXED** | §3 row 7 still "仅在 commit 时持久化" without the explicit "drafts ephemeral" contract. Case 16 tests crash-resume but PO red line table never states the data-loss window |
| **4** brushStrokes unbounded (jank) | **NOT FIXED** | No max-stroke cap mentioned anywhere in plan v2 |
| **5** DP slice(0,100) bug | **FIXED** | §1.1 now uses `uniformSample(points, 100)` evenly-spaced fallback. Code shown |
| **6** G0 (1-vertex) / G0.5 (snap<2) edge cases | **NOT FIXED** | No mention in §1.3 gates |
| **7** G3 bearing contradiction with verdict | **FIXED** | §1.4 has explicit reconciliation paragraph citing `V6_3_BEARINGS_VERDICT.md` and PO new vs old rule |
| **8** Telemetry queue / rate-limit policy | **NOT FIXED** | §5 still ~30-50 LOC; no fire-and-forget cap, no 429 handling, no sampling for `brush_alt_dem_null` |
| **9** Device matrix hardware-back / bg / crash / slow-net / double-tap | **FIXED** | §6.2 cases 14-18 added explicitly: hardware-back, background, crash-resume, weak-network 8s timeout, double-tap |
| **10** Schema version on persisted routes | **NOT FIXED** | §2.4 still no `schemaVersion: 'v6.3'` |
| **11** Rollback trigger + per-gate metric payload | **NOT FIXED** | §9 ship checklist has no numeric rollback trigger; §5.3 `brush_gate_failure` has no `metric_value, threshold` payload |
| **12** Timeline 2.5w → 3.5w | **FIXED** | §8 now 15-17 days ≈ 3-3.5 weeks with R2 reality check label |

---

## New issues

### N6. §9 ship standard contradicts §6.2 pass criterion
§9 says "真机 13 case 至少 12 通过" — but §6.2 was expanded to **18 cases** with "16/18 通过". §9 was not updated. Stale checklist will mislead the PO at OTA gate.

### N7. §11 still has 13 rows but device matrix has 18
Internal consistency: §11 PO red line check table is fine, but the §6.2/§9 row-count mismatch means the document failed a final read-through.

### N8. Test list (§6.1, 7 specs) does not cover cases 14-18
Cases 14-18 (hardware-back, background, crash-resume, weak-net, double-tap) are device-matrix-only. No corresponding unit/integration test specs — same gap R2 flagged for state bugs (eraseAt, beginTrimDrag, editOpSeq fence, persistSession). State the unit-test gap explicitly or add specs.

---

## Timeline check

15-17 days for 1290 LOC + 7-bug state cleanup + 18-case device matrix on iOS+Android + R3+R4 review loops.

- 1290 LOC at ~150 LOC/day senior pace = ~8.6 days code
- 18-case matrix on 2 platforms = 1.5 days is tight but feasible
- 1 day buffer for R3+R4 cycles is unrealistic (R2 said 2-3 days; v2 kept 1)
- No bug-fix loop budget after device matrix

Believable as a **floor**, not a mean. Expect 17-19 actual. Timeline language "15-17 天" is honest improvement over original 2.5w but R3+R4 buffer should be 2-3 days.

---

## Recommendation

**NEEDS_WORK**, not BLOCK. Fixes are mechanical (~2-3 hours of plan revision, no re-spike).

Required before re-review:
1. Delete §0.2 frequency column or label "PO assumption, unverified" (R1 N2 — still broken)
2. Cite §11 row 8 timing to a real spike file or remove (R1 N3 — still broken)
3. State persistSession ephemeral-draft contract explicitly in §3 + PO red line (R2 #3)
4. Add max-stroke cap (e.g. 20) in §3 (R2 #4)
5. Add G0 / G0.5 pre-checks in §1.3 (R2 #6)
6. Spec telemetry fire-and-forget cap + 429 handling in §5 (R2 #8)
7. Add `schemaVersion` in §2.4 (R2 #10)
8. Add rollback trigger + `metric_value, threshold` payload (R2 #11)
9. Sync §9 row "13 case" → "18 case, 16/18 pass" (N6)
10. Decide §6.2 case 2: either delete or re-spec so undo-required is FAIL (R1 N5)
11. R3+R4 buffer 1d → 2-3d (timeline reality)

Genuine progress: PO data-truth reconciliation (R1 N1), DP slice bug (R2 #5), timeout/AbortController (R2 #1), G3 bearing reconciliation (R2 #7), device matrix expansion (R2 #9), timeline pad (R2 #12). Six real fixes. Two repeated lies (N2, N3) and several unaddressed production-failure items (#3, #4, #6, #8, #10, #11) keep it short of PASS.

The §0.2 frequency table and §11 row 8 timing being still-fabricated after explicit R1 callouts is the single most concerning signal — it means the revision author saw the BLOCK reasons and chose not to fix two of them. That is the v6.2.x lie pattern reasserting itself in two specific cells. Fix those and items 3-11, this goes to PASS.
