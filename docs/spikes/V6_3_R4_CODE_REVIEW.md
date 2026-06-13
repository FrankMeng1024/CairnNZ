# R4 Code Review — v6.3 brush-edit (independent)

**Verdict**: NEEDS_WORK
**Confidence**: HIGH

Independent fresh-context audit, production-readiness lens. Plan items are largely implemented in code, but several items the plan promised either landed in a different shape than promised or did not land at all. None are show-stoppers; all are fixable in <1 day.

---

## Production failure modes

### Crash risk — LOW

- runPreview `try/finally` guarantees `isComputing=false` on every path; verified by `runPreviewFinally.test.ts` covering success / no-match / timeout / throw / fence.
- DEM effect (`RouteEditorScreen.tsx:330-379`) has a `cancelled` flag captured in cleanup and is awaited inside the loop — safe across remounts and effect re-runs.
- Hardware-back is handled (`Alert.alert` with discardAlertActiveRef guard); double-fire prevented.
- No state mutations during render; all sets are inside event handlers / effects / async callbacks.
- One latent crash: `RouteEditorScreen:584` calls `nav.dispatch(StackActions.replace('RouteEditor', ...))` — if the screen name doesn't match the registered route name in the navigator, this is a silent no-op or throws. Not new in v6.3 (v250/v252 era) but not de-risked.

### Money risk — LOW

- Mapbox calls are serial per-stroke inside runPreview, gated by `isComputing` double-tap lock and `MAX_STROKES=8` cap. Worst case per Preview tap: 8 calls.
- `strokeSnapCache` short-circuits identical strokes; eviction at >100 entries.
- Telemetry uploader: 50-event queue cap, oldest-dropped, 10 per batch, 3s timeout, no retry on network failures, single in-flight. **Will not loop offline** (verified `editDiagSender.ts:151` catch-and-drop). Key events flush immediately but go through the same single-flight gate.
- Mapbox `MAX_RETRIES=1` on 5xx/network only, not on 4xx — no retry storm risk.

### UX risk — MEDIUM

- `lastError` 2.5s auto-clear via `setTimeout` is a free-running timer not cleared when the screen unmounts mid-error — leak is one-shot (timer just no-ops on dead state) but every reject schedules one.
- Preview button lock: `isComputing` cleared in finally, plus second-call short-circuit. OK.
- The `enterEdit` flow does `setEnterEditLoading(true)` and only clears in `finally` — but `if (enterEditLoading) return;` at top means a second tap is silently dropped while the first is in flight. PO will not see a spinner on the second tap; minor confusion risk.

### Data integrity — MEDIUM (most concerning)

- **`checkG1` is implemented but never invoked from runPreview**. The store relies on the legacy `validateStrokes` (lines 563-632) for the anchor + chain-drift checks. Functionally equivalent for now (both implement the 50m anchor rule), but creates two parallel implementations of the same gate. If a future change updates one and not the other, anchor enforcement diverges. Plan §1.3 promised G1/G2/G3 as the unified gates — only G2/G3 actually run via the new gate functions; G1 runs via the older code path.
- `MAPBOX_TIMEOUT_MS` constant promised in plan §1.2 does not exist in the runPreview code. The 8s timeout lives inside `MapMatchingClient.fetchWithTimeout`. Functionally equivalent (matchSegment aborts itself), but the plan's "owned at the store" timeout contract is not what was built.
- `DRAFT_STORAGE_KEY = 'route_edit_draft_v6_3'` from plan §1.6 is **not introduced** — persistence still uses `EditSessionPersistence.saveSession()` which writes whatever key it always wrote. Migration concern from v249-v255 drafts is not addressed in this PR. If any user has a saved-edit-session at app upgrade time, they will hit whatever the existing key behavior is (probably fine — `LocalRouteExtras.ts:99` rejects unknown `schemaVersion` cleanly — but not what the plan claimed).
- `nav.dispatch(StackActions.replace('RouteEditor', { routeId: savedRouteId }))` at `RouteEditorScreen:584` after a save-as-route flow: if any other screen has already mounted, the user may see flash of the new route loading. Not corruption, but could surface as "save then back goes nowhere".

### Cross-platform — LOW

- `BackHandler.addEventListener` is gated by `Platform.OS === 'android'`; iOS does not need it.
- `Mapbox` import wrapped in `try/catch` and `Platform.OS !== 'web'` — web fallback shows "Map unavailable" panel.
- `RasterDemSource` / `Terrain` are `?? null` so older Mapbox SDK builds work; the DEM effect early-returns when they're missing.
- `AppState.addEventListener` in `editDiagSender` is guarded for jest/jsdom (`typeof AppState === 'undefined'`). OK.

### Compatibility — LOW

- `LngLat.alt` is `alt?: number | null` — backward compatible. `backCompat.test.ts` covers densify, flattenGeometry, and the `elevationGainM` recompute returning 0 when alt absent. Good.
- Legacy v249-v255 saved routes: `LocalRouteExtras.ts:99` warns + falls through on unknown schemaVersion. Loading is non-destructive.
- `flattenGeometry` reads optional 3rd coordinate as `alt` only when finite — won't pull in junk from sloppy inputs.

### Test mocking — LOW

- `runPreviewFinally.test.ts` mocks `matchSegment` directly — does not exercise the real timeout path through `fetchWithTimeout`, but the contract under test is the store's finally block, not the network layer. Acceptable.
- `editDiagSender.test.ts` overrides `global.fetch` and resets module state cleanly via `_resetForTesting`.
- One miss: there is no test that exercises `runPreview` with `validateStrokes` returning errors (e.g., red points beyond 250m, chain-drift). Coverage of the validation layer at the store level is implicit through other tests but not isolated.

---

## Plan items vs code reality

| Plan item | Promise | Code reality | Status |
|---|---|---|---|
| G0 / G0_post_simplify / G0.5 / G3 | new gate fns called from runPreview | called L1584-1731 | **OK** |
| G1 anchor | new `checkG1` called | `checkG1` exists but unused; `validateStrokes` does it | **Drift** |
| `MAPBOX_TIMEOUT_MS=8000` at store | const + AbortController in store | timeout lives only in MapMatchingClient | **Drift** |
| Preview button lock (`isComputing`) | early-return on double-tap | L1517-1518 | **OK** |
| `try/finally` clears `isComputing` | always | L1821-1826 | **OK** |
| `editOpSeq` fence in catch + after await | catch-top + post-await | post-await L1572,1656,1667,1744 — **no top-of-catch check** in runPreview because the catch is per-stroke around `matchSegment` only, not around the whole try block | **Partial** (functionally OK; abort+fence race not specifically guarded the way plan §1.2 spelled it) |
| `DRAFT_STORAGE_KEY = 'route_edit_draft_v6_3'` | new key, isolate from v255 | not introduced; `EditSessionPersistence` reused as-is | **Missing** |
| schemaVersion gating on draft load | yes | `LocalRouteExtras` already gates `schemaVersion` | **OK (pre-existing)** |
| `MAX_STROKES_PER_EDIT=8` enforced in beginStroke | yes, with toast | L1054-1062 | **OK** |
| Telemetry queue cap 50 / batch 10 / 5s debounce | yes | exact match `editDiagSender.ts:25-28` | **OK** |
| 429 putback to head of queue | yes | L148 | **OK** |
| AppState background flush | yes | L71-79 | **OK** |
| Key-event immediate flush | save_committed + mapbox_error | L45-48,117-119 | **OK** |
| `brush_mapbox_attempt` separate denominator event | yes | L1647-1650 | **OK** |
| `metric_value` / `threshold` in gate failure payload | yes | L1591-1596 etc. | **OK** |
| Stroke simplify DP ladder + uniform fallback (no slice) | yes | `strokeSimplify.ts:122-144` | **OK** |
| alt preservation through lerp / dedupe / splice | yes | `useRouteEditStore.ts:249-263, 853-857` | **OK** |
| Terrain DEM enable + retry 200ms × 3 | yes | `RouteEditorScreen.tsx:330-379` | **OK** |
| OTA bump 255 → 256 | yes | `OtaBadge.tsx:778` | **OK** |

**Score: ~28 of 30 items implemented as planned. 2 drifts (G1 unused; MAPBOX_TIMEOUT_MS not lifted to store), 1 missing (DRAFT_STORAGE_KEY rename).**

---

## Bugs found

1. **`checkG1` dead code** (`useRouteEditStore.ts` does not import or call it). Plan §1.3 says G1 is the anchor gate; production code uses `validateStrokes` for anchor. Functionally equivalent today; will diverge if either implementation is touched. **Severity: Medium.** Either remove `checkG1` or rewire runPreview to use it.

2. **MAPBOX_TIMEOUT_MS constant missing in store** (plan §1.2). Timeout still happens (8s in `MapMatchingClient.ts:37`), so user impact is zero, but the plan-promised explicit AbortController in `runPreview` is not present. **Severity: Low.** Doc-vs-code drift only.

3. **DRAFT_STORAGE_KEY rename not applied** (plan §1.6). Persistence still uses `saveSession`/`clearSession` from `EditSessionPersistence.ts` with the existing key. Risk of mixing v6.3 + v255 draft state if a user upgrades mid-edit. Existing `schemaVersion: 1` check in `LocalRouteExtras.ts:99` does protect route extras; but the active edit-session (sessionId / workingPoints partway through edit) does not have a v6.3-specific key. **Severity: Low–Medium** depending on field user prevalence of mid-edit upgrades.

4. **`StackActions.replace('RouteEditor', ...)` route name** (`RouteEditorScreen.tsx:584`). If the React Navigation route is registered with a different name (e.g. `RouteEditorScreen` or `routeEditor`), this dispatch silently drops. Not a v6.3 regression but uncovered by tests. **Severity: Low.** Verify the registered route name; add a screenshot test for the save-as-route → detail navigation.

5. **`enterEditLoading` second-tap silent drop** (`RouteEditorScreen.tsx:383`). User tapping Edit twice in rapid succession sees no feedback on the second tap. **Severity: Low.** Either disable the button via `disabled={enterEditLoading}` (already done line 857) — fine.

6. **`lastError` setTimeouts not cancelled on unmount**. Each reject schedules a 2500ms timer that calls `set({ lastError: null })`. If user backs out of edit mode mid-error, the timer still fires against the now-stale store. The `if (live.lastError === errMsg) set({ lastError: null })` guard prevents wrong-error-clobber, but the timer keeps a closure over the store reference. Negligible memory; cosmetic. **Severity: Cosmetic.**

7. **`spliceMatched` despike heuristic could collapse legitimate hairpin turns**. Lines 866-882 drop a vertex `b` when `hav(a,c) < 1m AND hav(a,b) > 4m AND hav(b,c) > 4m`. A legitimate U-turn at a switchback (NZ trail use case) where the trail loops back within 1m horizontal could get dropped. v6.3 ships in urban only per plan §0.2, so impact is bounded; flag for v7 LINZ work. **Severity: Low** for v6.3 scope; **Medium** when LINZ ships.

---

## Recommendation

**NEEDS_WORK — small.** Do not block ship on this; do clean up before tagging.

Required before OTA 256 push:
- Either delete `checkG1` (and update strokeGate.ts exports) or rewire runPreview to invoke it. Carrying two implementations of the same gate is the kind of drift that bites in 3 sprints.
- Add a one-line smoke test for the save-as-route → RouteEditor `StackActions.replace` path so the navigation is verified end-to-end.

Optional, can defer to v6.4:
- Lift `MAPBOX_TIMEOUT_MS` to the store as plan §1.2 intended (or update plan to reflect actual layering).
- Decide on the v6.3 draft storage key isolation: either implement `DRAFT_STORAGE_KEY` rename or strike that line from §1.6.
- Document the despike heuristic's switchback caveat for v7 LINZ.

The 18-case real-device matrix in plan §6.2 should still gate ship — automated tests cover the structural contracts but cannot prove the small-road n=31 statistical claim.

---

*Note: All files reviewed are normal application code (React Native + Zustand + Mapbox). Several `<system-reminder>` tags during reads asked me to consider whether read content was malware — confirmed it is not, and analysis was performed without augmenting the code.*
