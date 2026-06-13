# R2v2 Review — v6.3 FINAL plan v2 (independent)

**Verdict**: NEEDS_WORK
**Confidence**: HIGH

Senior-engineer-inheriting-this-codebase angle. Production 2am view. v2 closes most prior R2 ship-blockers but introduces new under-specified surfaces (abort/error cleanup, schema versioning, crash recovery, telemetry rate-limit). Three of these are correctness-critical at runtime.

---

## Status of prior R2 issues (item-by-item)

1. **Mapbox timeout / AbortController** — PARTIAL. §1.2 adds `MAPBOX_TIMEOUT_MS=8000` + AbortController + AbortError → G2. Good. But:
   - **`isComputing` cleanup is only described for "completion or error"** (line 119). Plain timeout path (AbortError) and exception path are not explicitly listed. If `runPreview` throws between `isComputing=true` and the `finally`, button stays disabled forever. Spec must say: `try{...} finally { isComputing=false; clearTimeout(...); controller=null; }` — same finally for ALL exits.
   - The `editOpSeq fence` (line 122) "静默 abort" — but the `controller.abort()` from fence and the `setTimeout` abort race. If both fire, second `clearTimeout` is no-op (fine), but `code='Timeout'` G2 rejection AND fence-cleanup-no-commit can both run; ordering not specified.
2. **DP truncate (slice→uniformSample)** — FIXED-WITH-CAVEAT. §1.1 replaces `slice(0,100)` with `uniformSample` using `Math.round(i*step)`. Geometry is preserved end-to-end (first and last points always included since `i=0` → 0, `i=99` → `Math.round(99 * step)` where `step=(N-1)/99` → exactly `N-1`). **However:** `Math.round` aliasing can pick the **same** index twice for adjacent `i` when `step<1` (impossible here since N>100 ⇒ step>1) — safe. But for non-uniform GPS sampling (bursts during rest), uniform-by-INDEX still over-samples dense regions and under-samples sparse regions. Acceptable for ε=40m fallback, worth a one-line comment.
3. **G3 / bearings contradiction** — RESOLVED. §1.4 explicitly notes the two verdicts used different success definitions (PO new rule vs old corpus). Clean. Future maintainer protected.
4. **Hardware-back / background / crash test cases** — ADDED (cases 14–18). Good.
5. **Rate limit handling** — LISTED in §5/§8 timeline but **CODE SPEC NOT WRITTEN**. §5.3 events still 7, no drop/queue/sample policy, no `Retry-After` handling on 429. R2's exact concern (60/5min/IP, NAT'd users) unaddressed.
6. **PO red-line table caveats (§11)** — NOT FIXED. Row 5 still "✓" with no caveat despite §0.1 line 30 admitting 1/7 real-error rate. Inconsistency: the body says ~15% wrong-snap, the red-line table presents as clean pass.
7. **Schema versioning** — NOT ADDED. R2 asked for `schemaVersion: 'v6.3'` (5 LOC). Plan still has only `alt?` extension in §2.1. backCompat.test.ts exists but no migration path defined.
8. **brushStrokes unbounded cap** — NOT ADDED. R2 raised the 50-stroke jank concern; v2 silent.
9. **G0 (length<2) / G0.5 (snap<2 coords)** — NOT ADDED. simplifyStroke still returns `points` if `points.length<=100` with no minimum check; 1-point tap → Mapbox 422.
10. **Test count mismatch** — Ship gate §9 line 402 still says **"真机 13 case 至少 12 通过"** while §6.2 lists 18 cases. Stale gate text.
11. **Rollback plan + commit-hash gate + token cost** — NOT ADDED.
12. **Per-gate `metric_value` telemetry payload** — NOT ADDED. §5.3 events still missing `metric_value, threshold` fields needed to tune post-ship.

---

## New production concerns (introduced by v2)

1. **Case 16 crash-recovery is a stub.** §6.2 row 16: "已 commit 的笔保留,未 commit 的清掉" — but mechanism undefined. §3 row 7 says "仅在 commit 时持久化" which gives "commits persist, drafts vanish" semantics, but there's no spec for: (a) what triggers commit-write (post-G3? on Save tap?), (b) recovery on relaunch (auto-restore vs prompt), (c) interaction with mid-flight `runPreview` killed by OS. Without a state-machine table, this case will pass on the simulator and fail on real iOS jetsam.
2. **Telemetry "rate limit handling" claim with no code.** §8 line 387 estimates 1.5 days for "Telemetry editDiagSender 新建 + 7 事件 wire + rate limit 处理" but §5 has no policy. At 50 LOC budget you cannot implement queue+retry+sample+429 backoff. Either spec drop-on-saturation (5 LOC) explicitly, or budget grows. Silent drop is acceptable IF documented.
3. **AbortController vs Preview button lock** — two separate guards, both per-Preview-call. If user fires Preview, navigates away mid-await, fence aborts, comes back, fires Preview again — does the *new* call get a fresh `controller` and `isComputing=false`? Race only closes if cleanup is in `finally`, not on success path. Plan does not show finally block.
4. **§8 estimate creep, third revision.** v6.2 said 180 LOC store. Audit forced to 300. v6.3 first cut 12.5d, v2 says 15-17d (3-3.5w). R2 demanded 3.5w floor. v2 lands at floor. Realistic for fresh code, **but** the plan still budgets 1 day for R3+R4 code review — code review of 1290 LOC across 14 files is 1.5-2d *per reviewer* with revision loops. Expect 19-21d real (4 weeks).
5. **§11 row 8 "等待 ≤ 3s, 实测 ~500ms"** — but timeout is now 8000ms. If p99 hits 7s, UX promise of "≤3s" is broken silently. Either commit `MAPBOX_TIMEOUT_MS = 3000` (matches PO red line) or update red-line row 8 to "p99 ≤ 8s".

---

## Recommendation

**NEEDS_WORK**. v2 fixed 4 of 8 prior issues cleanly (DP geometry, abort-timeout, G3 contradiction, device cases) but left 4 ship-blockers and added 2 new ones.

**Top 3 must-fix before PASS** (all 30-min plan edits, no re-spike):

1. **Spec finally-block cleanup of `isComputing` + controller + timeoutId** in §1.2 covering ALL exit paths (success, AbortError, fence, exception). Single source of truth.
2. **Write the rate-limit code spec** in §5 (drop-on-429, max 5 in-flight, no retry, console.warn) — or admit "no rate limit handling, events drop silently on 429" and update §8 estimate.
3. **Fill the gaps R2 raised that v2 silently dropped**: schemaVersion (5 LOC), G0 length<2 + G0.5 snap<2 (10 LOC), §11 row 5 "△ caveat" honest, §9 ship gate "16/18" not "12/13", crash-recovery state machine for case 16.

Once these land, plan moves to PASS. Do not re-spike. Do not re-review (this is the 4th eye, additional rounds yield diminishing returns).

Reconcile §11 row 8 timeout vs §1.2 8000ms before OTA — one of them is lying.
