# R2v3 Plan Review (independent senior-engineer)

**Verdict**: NEEDS_WORK
**Confidence**: HIGH

Fresh-context senior engineer about to inherit 1290 LOC. Read with implementation in hand. Closes most of v2's open items but introduces multi-stroke/queue-flush/migration ambiguities the developer will hit at runtime.

---

## Status of v2 R2v2 issues

1. **Finally cleanup (§1.2)** — FIXED. `try/catch/finally` shown literally. `isComputing=false` and `clearTimeout` unconditional. AbortError → `lastError`. Good. Minor: `controller=null` not set in finally — harmless, GC handles it.
2. **DP uniform-sample (§1.1)** — FIXED.
3. **G3/bearings contradiction (§1.4)** — RESOLVED.
4. **Hardware-back/background/crash cases (§6.2)** — ADDED (14–18).
5. **Rate-limit code spec (§1.7)** — FIXED. Queue cap 50, batch 10, 429 unshift, network drop. Acceptable.
6. **PO red-line row 5 (§11)** — FIXED. Now "⚠️ ~1/7 real wrong-snap" with caveat.
7. **schemaVersion (§1.6)** — FIXED. `schemaVersion: 1` declared.
8. **brushStrokes unbounded cap** — STILL NOT ADDED. v2 silent, v3 silent. EditOverlay shows "N/8" implying cap 8 — but no enforcement spec in store. If user hits Preview at 12 strokes, what happens? Real risk.
9. **G0/G0.5 (§1.5)** — FIXED literally, BUT execution-order placement vague (see new gap #1).
10. **Test count "16/18" (§9)** — FIXED.
11. **Rollback / commit-hash / token cost (§13)** — PARTIAL. §13.2 has thresholds. Commit-hash gate in §9 ("commit hash 与 plan 对齐"). Token-cost ceiling never set.
12. **Per-gate `metric_value` payload (§13.1)** — FIXED.

**8/12 fully fixed, 3 partial, 1 still missing.**

---

## New implementation gaps

1. **§1.5 G0/G0.5 execution order undefined.** Plan says "G0 在 simplify 之前", "G0.5 在 G2 通过之后". But what about: stroke arrives with 150 points → G0 pass → simplify → returns array of length 1 (DP edge case at high ε)? No re-check. Spec the pipeline: `G0(raw) → simplify → G0_post(simplified.length≥2) → Mapbox → G0.5 → G1 → G2 → G3`. As written a developer will skip the post-simplify length check.

2. **§1.6 migration FROM v249–v255 ambiguous.** §1.6 says "schemaVersion 缺失 → 清掉 draft, 加载原 route". But §3 row 7 says "persistSession 仅在 commit 时持久化". v249–v255 already persisted partial state under the old key. Spec needs: (a) storage key (same key? new key? if same, old payload triggers "clear" path silently losing user edits on first launch of v6.3), (b) one-shot migration log entry, (c) telemetry event so we can count silent wipes post-OTA.

3. **§1.7 queue-flush trigger undefined.** "debounced 5s" comment but no code. When does the first flush fire? On stroke-commit? On app-foreground transition? Never if user kills app within 5s of action — those events lost permanently. AppState listener not specified. For the rollback metrics in §13.2 to work, telemetry must survive crash → flush on `AppState change to background` is mandatory (with iOS background-task wrapper).

4. **§3.1 multi-stroke serial — partial-failure state undefined.** "Mapbox 调用串行". Stroke 1 succeeds → committed. Stroke 2 timeout → G2 reject. What's the persisted state? Plan implies stroke 1 stays, stroke 2 vanishes from canvas. But `editOpSeq` is per-call — if user hardware-backs between stroke 1 and 2, fence cancels stroke 2 cleanly. If stroke 2 throws mid-await, finally runs but stroke 1's commit already happened. UX: user sees one accepted, one red error, can't undo to "before this Preview". Spec needs an "atomic Preview" decision: all-or-nothing OR per-stroke commit. Currently silent.

5. **§13.2 rollback metric not measurable.** "Mapbox API 错误率 > 30%" computed as `brush_mapbox_error / brush_preview_started`. But `brush_mapbox_error` only fires on G2 NoMatch/5xx (§5.3). G3 corridor rejection ≠ Mapbox error but counts against acceptance. And `brush_preview_started` fires per-Preview-tap, not per-stroke. Multi-stroke session inflates denominator. Need a dedicated `mapbox_call_count` counter at the HTTP layer, separate from gate-level events.

---

## New edge cases

- **DEM elevation race vs strict mode (§2.3):** RN 0.74 strict mode double-invokes effects in dev. `queryTerrainElevation` called twice → 200ms × 3 retry × 2 = 1.2s blocking. Not a prod bug but will confuse the developer running locally.
- **Case 16 + schemaVersion=1 + bumped to 2 later:** the only migration path documented is "missing → wipe". When v6.4 bumps to schemaVersion=2 and someone wrote the same code path, v6.3 drafts get wiped on upgrade. Need explicit "1→2 migration TBD, never wipe forward".
- **Multi-stroke + AbortController:** if Stroke 1 mid-await, user adds Stroke 2 to canvas, taps Preview again → second `runPreview` blocked by `isComputing`. But what if Stroke 2 was added DURING Stroke 1's await? Plan doesn't restrict canvas edits during compute. Stroke array mutates under the call.
- **Test gap:** No test for "stroke length=1 after DP simplify" path. No test for "schemaVersion=2 forward-incompat" path. No test for "queue flush on background transition". §6.1 covers happy paths, not the failure interlocks the §3 bug-fixes were written for.

---

## §14 deferred work — Blocker check

All 7 v6.4 items are genuine deferrals. None disguise a v6.3 blocker. PO 1/7 wrong-snap rate is acknowledged in §11 row 5 with undo as mitigation — acceptable for ship.

---

## Recommendation

**NEEDS_WORK** — 5 implementation gaps will cause real bugs in the first week post-OTA. None require re-spiking. ~45 min of plan edits.

**Top 3 must-fix before PASS**:

1. **§1.5: spec the post-simplify G0 re-check** ("after simplify, if length<2 → reject reason='G0_post_simplify'") + add to pipeline diagram.
2. **§1.7: define flush triggers** — debounce-5s OR AppState→background OR queue-size-≥10, whichever first. Name the AppState listener. Without this, rollback telemetry §13.2 silently misses crash sessions.
3. **§3.1: define multi-stroke commit semantics** — per-stroke commit (current implication) vs atomic. Document chosen behavior + add device case 19 covering "stroke 1 OK, stroke 2 timeout".

Also nice-to-have (not blockers): brushStrokes cap=8 enforcement; storage-key strategy for v249→v6.3 migration with telemetry.

Once 1-3 land → PASS. Do not re-spike. Do not run R2v4.

