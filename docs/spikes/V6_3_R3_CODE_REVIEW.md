# R3 Code Review — v6.3 brush-edit (Stages 1-9)

**Verdict**: NEEDS_WORK
**Confidence**: HIGH

Reviewer: R3 (fresh-context, no prior session). Compared working tree vs `master @ 4cdd2e0`. Plan = `docs/spikes/V6_3_FINAL_PLAN.md`.

---

## Critical issues

### C1. `runPreview` has no top-level `catch` — fence-vs-error race not implemented as planned

Plan §1.2 explicitly mandates:

```ts
} catch (e) {
  if (get().editOpSeq !== myOpSeq) return;  // 静默 abort,不显示 error
  if (e.name === 'AbortError') set({ lastError: '网络慢,请重试' });
  else set({ lastError: '未识别到这条路' });
} finally { ... }
```

Implementation in `useRouteEditStore.ts:1563-1827` is `try { ... } finally { set({ isComputing: false }); }` — **no top-level catch**. Consequences:

- An unhandled throw (e.g., from `spliceMatched`, `deriveWorking`, `PointCloudIndex` constructor on malformed snap, `set()`/zustand listener throw) propagates to the Preview button's `onPress` callback. RN's default unhandled-rejection handler will surface a yellow box (or worse, crash the JS bundle in release).
- `finally` does clear `isComputing` (good), but `lastError` is never set, so the user sees the spinner vanish with no feedback.
- The R1v3 race scenario the plan calls out — "timeout同时fence trigger不显示'网络慢'误报" — has no test that exercises a *thrown* error during fence; `runPreviewFinally.test.ts` only mocks `matchSegment` returning a structured result. The defensive inner `try { r = await matchSegment } catch` (line 1611-1622) handles synthetic throws from the mock, but a real throw from any post-await code path is uncaught.

**Required fix**: add a top-level `catch (e)` with fence-first guard per plan §1.2 (lines 137-149 of plan). `runPreviewFinally.test.ts` should add a case where a post-`matchSegment` operation throws (e.g. mock `spliceMatched` to throw) and assert `lastError` is set + `isComputing` cleared.

### C2. Schema versioning + crash-recovery storage key isolation NOT implemented

Plan §1.6 (R2v2 + R2v3) mandates:

```ts
interface RouteEditDraft { schemaVersion: 1; ... }
const DRAFT_STORAGE_KEY = 'route_edit_draft_v6_3';
const LEGACY_STORAGE_KEY = 'route_edit_draft';
// Load: schemaVersion === 1 → load; missing/mismatch → discard, don't crash
```

Grep across `app/src/` finds zero occurrences of `route_edit_draft_v6_3` or any `schemaVersion` field on the brush-edit draft. `EditSessionPersistence.ts` has not been touched. `tasks/jira/...` real-machine case #16 ("Preview后强杀app再启动") is the explicit driver for this requirement. As shipped, a v255 draft loaded into v6.3 may surface the wrong shape (no `alt` field, no `walkedIndex` rebuild metadata) and either crash or silently corrupt state.

**Required fix**: add `schemaVersion: 1` to persisted draft, gate read on version match, fall back to original route on mismatch. Test in `backCompat.test.ts`.

### C3. AbortController for in-flight Mapbox fetch is **not plumbed from runPreview**

Plan §1.2 (lines 105-118 + 130-152) shows runPreview owning an AbortController and passing `signal` into `matchSegment`. The implementation does not — `matchSegment` (`MapMatchingClient.ts`) creates its own internal AbortController inside `fetchWithTimeout` keyed off `TIMEOUT_MS=8000` (line 37). There is **no way for runPreview to abort an in-flight HTTP call** when hardware-back / app-background fires `editOpSeq` bump.

Consequence: real machine case #14 / #15 in plan §6.2 ("Preview中按hardware-back" / "切到后台5s再回前台"). The user backs out, but the fetch keeps running for up to ~8s, and when it returns, the fence check at line 1635 catches it and silently discards. This is functionally OK (no UI error), but:
- Wastes Mapbox quota on every cancel
- Telemetry `brush_mapbox_attempt` fires even though user no longer cares
- If the user re-enters edit mode within 8s and triggers a new Preview, two fetches race

**Required fix**: `matchSegment(seg, { signal })` overload, runPreview passes a controller and aborts on fence. Could be deferred if telemetry shows low cancel volume, but plan explicitly required it.

---

## Significant

### S1. Success path drops *all* `brushStrokes`, including not-yet-matched ones

Lines 1788-1808: success branch sets `brushStrokes: []` unconditionally. This is correct per plan §6.4 ("Plan §6.4: rejected strokes vanish from the canvas. Accepted ones are committed into matchedPoints"). However, in the partial-reject case (some accepted, some rejected), every stroke disappears — accepted strokes are committed as geometry into `matchedPoints` but the user loses the visual association with strokes they drew. If they hit `undo`, the undo entry restores the pre-Preview state including all strokes (good), but inside `lastError`, the message reads e.g. "画的太远了" — ambiguous about which stroke. Plan §3.1 ("每笔独立判 G1/G2/G3") and §1.6 ("不做原子回滚") imply per-stroke surfacing; consider including the rejected stroke index in the error message ("第3笔画的太远了") for multi-stroke clarity.

### S2. `editOpSeq` bump on success commit invalidates concurrent benign waiters

Line 1806: `editOpSeq: s.editOpSeq + 1` on commit. This is correct for fence semantics, but means any *other* path that captured `startSeq` and is mid-await will fence-abort. There is currently no other concurrent path because `isComputing` blocks re-entry, but if a future feature (e.g. autosave, prefetch) runs concurrently it will silently no-op. Add a comment documenting that bumping seq on commit is intentional preview→commit barrier, not just abort signaling.

### S3. `applyMatchedAltitudes` does not clear `previewMatchedPoints` / handle preview-state divergence

`useRouteEditStore.ts:1483-1513`: applyMatchedAltitudes only updates `matchedPoints` + `workingPoints`. But `previewMatchedPoints` (when non-null) is what `RouteEditorScreen` may render. If DEM backfill races with an in-flight Preview, the underlying `matchedPoints` get alt while preview overlay does not, and on commit the alt vanishes again. Currently no test covers this race.

### S4. `MAPBOX_TIMEOUT_MS` constant lives in `MapMatchingClient.ts` (`TIMEOUT_MS=8000`), not exported

Plan §1.2 references `MAPBOX_TIMEOUT_MS = 8000`. Implementation uses `TIMEOUT_MS` (different name) and is module-private. Future tuning by ops requires editing the file vs config. Minor but recommend export + named constant per plan.

### S5. Duplicate Douglas-Peucker implementations

`strokeSimplify.ts` has `douglasPeucker` (new), and the old `rdpSimplify` was removed from the store — good. However, both `strokeSimplify.ts:37-64` (`perpDistanceM`) and `strokeGate.ts:103-122` (`perpToSegmentM`) implement equirectangular projection from scratch with subtly different semantics (gate clamps t to [0,1], simplify does not). These should share a helper in `corridor/PolylineSampler.ts` to prevent drift.

### S6. `lastWarning` state field still defined despite UI removal

`useRouteEditStore.ts:139` still declares `lastWarning: string | null` in `EditState`, set to `null` in 5 places. UI consumer was removed (EditOverlayV236), but the state remains. Either remove the field entirely (preferred — eliminates dead surface area) or document why it's kept. Plan §4.1: "v6.3 dropped the lastWarning state because runPreview no longer falls back to Catmull-Rom" — implementation kept the *state*, only removed the *consumer*.

---

## Minor / nits

- `MAPBOX_MATCHING_MAX_COORDS = 100` exported from `strokeSimplify.ts` AND re-exported from `strokeGate.ts:273`. Pick one home.
- `editDiagSender.ts:130`: `if (inflight !== null) return inflight;` — return type is `Promise<void>`, but the check `if (queue.length === 0) return;` returns `undefined` not a promise. TS infers `Promise<void> | undefined`. Should be `return;` (which becomes `Promise<undefined>` due to async). Works at runtime but messy.
- `editDiagSender.ts:117`: `if (KEY_EVENTS.includes(kind))` — the `KEY_EVENTS` array is `ReadonlyArray<TelemetryKind>`; `.includes` widening on TS 4.x can complain. Verify CI passes.
- `RouteEditorScreen.tsx:316-373` DEM backfill effect: dependency array is `[editIsOpen, editMatchedPoints]`. `editMatchedPoints` is a new array reference after every `set()` in the store, so this re-runs on EVERY edit operation, kicking off a fresh up-to-3-attempt 600ms loop. For 8 strokes drawn rapidly this is ~5s of redundant queries. Consider memoizing on length + first/last lng/lat hash.
- `useRouteEditStore.ts:1622`: comment "Defensive: matchSegment swallows almost every error itself" — true today, but if matchSegment ever throws, the structured `r` variable is referenced before assignment (TS noUninitializedLocals would catch; runtime won't). Initialize `let r: MatchResult | null = null` defensively.
- `OtaBadge.tsx`: only the version constant changed 255→256. No code path differentiates v6.3 behavior from v255 by version number — i.e., no feature flag check. If a partial OTA rolls back, the v255 draft schema mismatch (see C2) becomes a problem.
- `strokeSimplify.test.ts` and `strokeGate.test.ts` exist; `runPreviewFenceRace.test.ts` and `runPreviewDoubleTap.test.ts` from plan §6.1 line 481-482 are **missing** — `runPreviewFinally.test.ts` may cover them but separation per the plan is cleaner. Verify coverage of the fence-during-await race specifically.

---

## What was done well

- **Stroke simplify uniform fallback**: `strokeSimplify.ts:122-144` `uniformSample` is correct — preserves first and last points, dedupes after rounding, and explicitly guarantees the last point. Matches plan §1.1 and the R2 BLOCK note.
- **Alt preservation in `lerp`**: both `PolylineSampler.ts:50-59` and `useRouteEditStore.ts:248-260` (`lerpLocal`) implement the partial-knowledge-→-null rule per plan §2.2 — correct distinction between "both have alt → interpolate" and "one has alt → null" (not 0, not undefined).
- **`applyMatchedAltitudes` GPS-authority preservation**: line 1494-1500 comment + code is precise — only writes alt where existing is null, never overwrites.
- **`flattenGeometry` 3rd-element handling**: `PolylineSampler.ts:103-109` `readCoord` is type-safe and rejects non-finite alt explicitly.
- **`editDiagSender.ts` 429 head-of-queue**: line 148 `queue.unshift(...batch)` — correct head-insertion, matches plan §1.7.
- **Fence checks at every await boundary**: `runPreview` has fence checks before each stroke iteration, after `await matchSegment`, and before commit set(). Solid.
- **`undo` walkedIndex rebuild**: lines 1422-1444 — exactly what plan §3 bug #1 demanded.
- **Smoothing fallback removed**: `smoothCatmullRom`, `snapDisplacementStats`, `rdpSimplify`, `snapDisplacementFraction` all gone from store. Plan §1.4 ban honored.
- **MAX_STROKES=8 enforcement** at line 1054: present and tested in beginStroke path.

---

## Recommendation

**Do not ship without fixing C1, C2, C3.**

- **C1 (no top-level catch)** is the highest-priority blocker — it directly breaks plan §1.2's R1v3 contract. Production yellow-box / crash risk.
- **C2 (schemaVersion missing)** is shipped-once-broken-forever — once v256 writes a schemaVersion-less draft, any future v6.4 schema migration has no anchor. Fix before any device ships.
- **C3 (AbortController)** is real but lower urgency; document as known issue if deferred to v6.4, and add telemetry to measure post-cancel Mapbox waste.

S1-S6 are quality-of-implementation issues — fix in same Sprint if possible, otherwise file as backlog stories with clear plan-section citations.

If C1, C2, C3 fix takes < 1 day of work + tests, do it. If longer, escalate to PO whether to ship with C3 deferred. **C1 and C2 are non-negotiable.**
