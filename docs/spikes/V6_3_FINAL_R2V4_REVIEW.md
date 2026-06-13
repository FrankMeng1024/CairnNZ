# R2v4 Plan Review (independent)

**Verdict**: PASS
**Confidence**: HIGH

Fresh-context review. 1290 LOC plan covering brush-edit ship version. The v4 round closes the v3 implementation gaps cleanly. Remaining concerns are minor and can be handled in code review or first-week telemetry — none warrants another plan revision.

---

## Status of v3 R2v3 items

1. **G0 post-simplify re-check** — FIXED. §1.5 now defines `postSimplifyCheck` returning `G0_post_simplify_too_short` when DP collapses to <2 points. Pipeline order is implied by code arrangement (G0 raw → simplify → G0_post → Mapbox → G0.5 → G1/G2/G3). Could be more explicit as a numbered diagram, but a developer reading §1.5 + §1.1 + §1.3 in order will get it right.
2. **Telemetry flush triggers (AppState/key events)** — FIXED. §1.7 spells out three triggers: 5s debounce, AppState `background`/`inactive` immediate flush (listener registered explicitly), and `brush_save_committed` / `brush_mapbox_error` immediate flush. `clearTimeout` before manual flush prevents double-fire. iOS background-task wrapper not mentioned — acceptable for fire-and-forget telemetry; data loss on a backgrounded-then-killed-in-<200ms window is tolerable.
3. **Multi-stroke partial-failure semantics** — FIXED. §1.6 explicitly chooses per-stroke commit over atomic ("不做原子回滚"). Stroke 1 stays committed if stroke 2 fails; user gets red-text retry hint or full undo. This matches the existing undo stack model. Decision is documented; UX is consistent.
4. **Storage key explicit** — FIXED. §1.6 declares `DRAFT_STORAGE_KEY = 'route_edit_draft_v6_3'` separate from `LEGACY_STORAGE_KEY = 'route_edit_draft'`. v6.3 starts with a clean slate; legacy key intentionally not migrated. Prevents silent wipe of v255 in-progress drafts on first OTA boot. Smart.
5. **Mapbox error rate denominator** — FIXED. §5.3 adds `brush_mapbox_attempt` event fired per /matching call (regardless of outcome). §13.2 now defines error rate as `error / attempt` rather than `error / preview_started`. Multi-stroke inflation gone.
6. **MAX_STROKES_PER_EDIT** — FIXED. §1.5 declares `MAX_STROKES_PER_EDIT = 8` enforced in `beginStroke` (returns null + lastError). UI "N/8" label now matches enforcement.

**6/6 v3 items fixed.** v3 partial item (token cost ceiling) still unaddressed — see new concerns.

---

## New concerns

1. **AppState 'inactive' on iOS fires very frequently** (Control Center pulldown, notification drag, incoming-call banner). §1.7 flushes on both `background` and `inactive`. Combined with `brush_save_committed` immediate flush, a user mid-edit who pulls down Control Center triggers a flush. With queue depth <10 and a 3s HTTP timeout, this is a 3s no-op blocking nothing — but on a flaky connection the queue may be partly drained then re-queued via 429. Not a correctness bug; may produce duplicate-batch posts visible server-side. Document or filter `inactive` to iOS-only-when-state-was-active.

2. **AbortController + RN fetch on Android** — historical RN versions (<0.71) leak the timer if `signal.abort()` fires after the fetch already resolved. Plan targets current RN; should be fine, but the `runPreview` finally block's `clearTimeout(timeoutId)` after a successful fetch is the right defense and is already in §1.2. No action needed; flagging for code review awareness.

3. **`metric_value` / `threshold` field types in §13.1** — declared `number` but for `gate: 'G2'` (Mapbox NoMatch) there is no numeric metric. Spec a sentinel (e.g. `metric_value: -1` or make it `number | null`). Otherwise the telemetry payload will fail JSON schema validation server-side or get coerced to `0` and pollute the rollback dashboard.

4. **`schemaVersion: 1` is a literal type, not a number** — fine for v6.3 but a future v6.4 bump to `2` requires a forward-migration plan. v3 review flagged this; v4 still says "缺 schemaVersion → 清掉". Add a one-liner: "future bumps must migrate, not wipe." Cheap to add now, expensive to retrofit when the first user loses a 5-stroke draft on upgrade.

5. **alt serialization round-trip not tested.** §6.1 has `altPreserve.test.ts` for splice/dedupe, and §6.1 has `backCompat.test.ts` for loading old routes without alt. No test for: save route with alt → reload from disk → alt still present and numerically equal. With 9 importers and 50 LOC of alt plumbing, the most likely regression is a JSON-stringify path silently dropping `alt: undefined` vs `alt: null` vs `alt: 0`. One additional test would close the gap; not a blocker.

6. **MAX_STROKES_PER_EDIT = 8 enforcement site** — §1.5 says "beginStroke 进入时". If a user already has 8 strokes committed and tries to draw a 9th, beginStroke returns null. But what if they undo back to 7 and try again? Plan doesn't say undo decrements the counter; assumed via `brushStrokes.length` (live array). Confirm in code that the cap reads live array length, not a monotonic counter. Almost certainly correct in implementation; worth a code-review checkbox.

7. **Token / API-cost ceiling never specified** (carried from v3 partial). §13.2 has no daily/per-user Mapbox call cap. Rate limit is server-side (Mapbox's quota), but a runaway client (stuck in a retry loop after a logic bug) could burn through quota in hours. Not a correctness blocker — operational concern. Acceptable to defer to post-ship monitoring.

---

## Recommendation

**PASS.** This is the third revision and the plan is shippable. Concerns 1–7 are code-review or first-week-telemetry items, not plan blockers. Author should:

- Fix concern 3 (`metric_value` nullable) in 2 lines before dev starts, since it touches the telemetry schema server-side.
- Add concern 5's serialization test to §6.1 list (1 line in the plan).
- Note concerns 1, 4, 6, 7 in the Sprint retrospective backlog.

Do not run R2v5. Start development.

Files referenced (absolute paths):
- C:/ClaudeCodeProjects/Cairn/docs/spikes/V6_3_FINAL_PLAN.md
- C:/ClaudeCodeProjects/Cairn/docs/spikes/V6_3_FINAL_R2V3_REVIEW.md
- C:/ClaudeCodeProjects/Cairn/docs/spikes/V6_3_FINAL_R2V4_REVIEW.md (this file)
