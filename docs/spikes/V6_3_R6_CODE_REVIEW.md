# R6 Code Re-Review — v6.3 (independent)
**Verdict**: NEEDS_WORK

**Scope**: Independent senior-engineer review of v6.3 brush-edit code AFTER R3+R4 fixes.
Files inspected:
- `src/store/useRouteEditStore.ts`
- `src/services/EditSessionPersistence.ts`
- `src/services/routing/mapmatch/MapMatchingClient.ts`
- `src/utils/strokeGate.ts`
- `src/services/editDiagSender.ts`

**Build sanity**:
- `npx tsc --noEmit` → 0 errors.
- `npx jest src/store src/utils src/services` → 18 suites, 191 passed, 3 skipped.
  - Worker exit warning surfaced (see C2 below).

---

## R3+R4 fixes verified

### R3 C1 — `runPreview` top-level catch
**Verified.** `useRouteEditStore.ts` 1833-1854 wraps the post-await body in try/catch.
- Fence is checked **first** (`fenceTrip` IIFE 1839-1842) so a hardware-back-induced cancel returns `{ ok: false, error: 'state-changed' }` and never surfaces as "网络慢".
- `finally` block at 1855-1860 unconditionally clears `isComputing` — confirmed across success/abort/fence/throw paths.
- Catch correctly distinguishes `AbortError` ("网络慢") from other throws ("未识别到这条路").

### R3 C3 — AbortController plumbed store → matchSegment
**Verified.** `previewAbort = new AbortController()` at 1560 fed to every `matchSegment` call (1664) via `{ signal: previewAbort.signal }`. `fenceTriggered()` (1564-1573) now calls `previewAbort.abort()` on first fence trip — Mapbox quota saved as designed. `MapMatchingClient.fetchWithTimeout` (50-90) properly forwards the external signal AND removes its `'abort'` listener on both resolve and reject paths.

### R3 C2 / R4 #2 — schemaVersion + new STORAGE_KEY + legacy cleanup
**Verified.** `EditSessionPersistence.ts`:
- `EDIT_SESSION_SCHEMA_VERSION = 1` (38), required field on `EditSessionSnapshot`, stamped by `saveSession` itself (167).
- New `STORAGE_KEY = '@cairn:edit_session_active_v6_3'` (30), `LEGACY_STORAGE_KEY = '@cairn:edit_session_active'` (31).
- `loadSession` rejects mismatched schemaVersion (224-227) AND attempts legacy cleanup on null-blob path (213-217).
- `clearSession` removes both keys (307-315).

### R4 #1 — `checkG1` removed from strokeGate.ts
**Verified.** `strokeGate.ts` has no `checkG1` export. Section 200-208 documents that the authoritative G1 lives in store (`strokeAnchorsToBaseline`). `ANCHOR_M = 50` retained as telemetry constant only.

### R4 #3 — nav.replace fragility
**Confirmed deferred.** Did not look further; consistent with stated deferral.

---

## New production concerns

### C1 — BLOCKER: legacy v249-v255 blob never cleaned on first cold-start when no session exists

`loadSession()` only attempts `removeItem(LEGACY_STORAGE_KEY)` inside the `if (!raw)` early-return (213-217) — that is, **only when the v6.3 key is empty**. As soon as the user begins their first v6.3 edit, the v6.3 key becomes non-empty, the early-return path is no longer taken, and **any orphaned legacy blob persists forever** (until the user explicitly cancels/saves and triggers `clearSession`, which DOES clean both — 307-315).

Realistic scenario:
1. User on v255 starts an edit, app killed mid-edit. Legacy key has stale blob.
2. User updates to v6.3, opens app, goes straight into a NEW edit (no resume modal because legacy key is invisible to v6.3 loader).
3. v6.3 `saveSession` writes the v6.3 key. `loadSession` is called next time but `raw` is non-empty → legacy cleanup skipped.
4. Legacy blob lingers in AsyncStorage forever consuming space.

**Fix**: move `removeItem(LEGACY_STORAGE_KEY)` to run unconditionally at the top of `loadSession`, OR run it once at module init. Same applies to your `schemaVersion !== EDIT_SESSION_SCHEMA_VERSION` clear-and-return path at 224-227 — you clear the v6.3 key but never the legacy key on that branch.

This is the exact downgrade-then-reinstall scenario the user asked about (Q3): the legacy blob is functionally invisible but accumulates forever.

### C2 — CRITICAL: jest worker leak almost certainly from `editDiagSender` AppState listener

Test output line 9: `A worker process has failed to exit gracefully... Active timers can also cause this`.

`editDiagSender.ts`:
- `ensureAppStateListener()` (66-80) attaches an `AppState.addEventListener` and stores subscription in module-level `appStateSubscription`.
- `_resetForTesting()` (166-178) detaches it — but tests must explicitly call this, and there's no global `afterEach` enforcing it.
- `flushTimer` (59) and `inflight` (60) are also module-globals with no automatic teardown.
- `editDiagSender.test.ts` exists but I'm betting at least one test that imports `useRouteEditStore` (which calls `sendEditDiag` via undo/preview) doesn't call `_resetForTesting`. The subscription survives → worker hangs.

**Fix**: register a global jest `afterEach(_resetForTesting)` in jest setup, or convert module to use a no-op AppState subscription in `process.env.JEST_WORKER_ID` mode.

### C3 — MEDIUM: `removeEventListener` on RN's AbortSignal polyfill — listener leak per matchSegment call

`MapMatchingClient.fetchWithTimeout` 76 attaches `externalSignal.addEventListener('abort', externalListener)`. Resolve/reject handlers (81, 86) call `removeEventListener`. **However**:
- React Native 0.72+ ships with `AbortController` that supports `addEventListener`/`removeEventListener` correctly on Hermes — confirmed in RN source.
- **BUT** if a future RN downgrade or a custom polyfill (e.g. `event-target-shim` versions) silently drops `removeEventListener`, the listener will leak per call. Closure captures `controller`, `timer`, full URL, and a reject function — small per-call but unbounded over a session.
- More immediately: the `fetch().then().catch()` chain (78-88) runs **after** the external abort listener has already rejected the outer promise. If `externalSignal.aborted` fires, `controller.abort()` is called, which triggers fetch's own abort path — and that synchronously runs the `.catch` handler at 84, which calls `removeEventListener` AGAIN on a listener that already fired (no-op, but the abort listener fired and wasn't removed before invocation — V8 holds the closure until the listener self-detaches).

The leak is per-stroke per-preview, on the order of 1-8 KB per stroke. Not a Blocker but worth a `signal.removeEventListener` in the `externalListener` body itself (self-detach on fire).

### C4 — MEDIUM: partial-reject sets lastError on a successful preview — `setTimeout` race with subsequent successful preview

`useRouteEditStore.ts` 1819-1825: when 1+ stroke is rejected but 1+ accepted, `lastError = partialRejectMsg` is set, plus a 2.5s `setTimeout` that clears it **only if** `live.lastError === partialRejectMsg`.

Race scenario:
1. Preview completes with partial reject. `lastError = '画的太远了'` set, timer scheduled.
2. User immediately runs another preview within 2.5s. The new preview at line 1547 sets `lastError: null` at the start, then runs successfully (no rejects). At line 1815 it sets `lastError: null` again (because `partialRejectMsg = null`).
3. The original 2.5s timer fires. It checks `live.lastError === '画的太远了'` — false (it's null) — so does nothing. **OK.**
4. **BUT**: if the second preview ALSO partial-rejects with the **same** message, line 1815 sets `lastError = '画的太远了'` again, line 1821-1824 schedules a NEW 2.5s timer. Now BOTH timers will fire; first checks → match → clears lastError. Second timer fires later (1-2.5s after the second preview), checks → `live.lastError === '画的太远了'` is false (cleared) → no-op. **Also OK.**
5. **Real race**: original timer fires AFTER second preview sets the same msg again — original timer clears the second preview's still-fresh error before its own 2.5s window. Result: error toast disappears < 2.5s after second preview.

Symptom: user does 2 partial-reject previews back-to-back, second toast vanishes prematurely. Minor UX bug, not data integrity.

**Fix**: capture a per-attempt nonce; timer compares both `lastError` AND nonce.

### C5 — MEDIUM: undo with brushStrokes pushed → snapshot retains POST-strokes geometry, not pre-strokes

`runPreview` at 1804-1806 sets `undoStack: []` on successful preview commit. That means **after a successful preview, the user CANNOT undo back to before they drew strokes** — only forward gestures (next stroke / erase / trim) push new undo entries. Comment 1804 says "v6.3: clean Mapbox-only path" but doesn't justify wiping the entire undo stack.

User flow:
1. User has 5 strokes drawn carefully.
2. Hits Preview → 5 accepted. `undoStack` cleared.
3. Hits Reset (intending to start over) → wipes everything, walkedIndex back to original.
4. Tries to undo → undo stack only contains the post-Reset snapshot of the post-Preview state. Cannot get the 5 strokes back.

This is documented behavior per plan §6.4 ("rejected strokes vanish from the canvas. Accepted ones are committed into matchedPoints"), but **the wholesale `undoStack: []` is not strictly necessary** — keeping pre-Preview history would let users back out of an unwanted Mapbox snap. This is a product call, not a code bug; flag for PO.

### C6 — LOW: `editOpSeq` not bumped in `appendStrokePoint` (intentional per comment 1107-1111) means fence may not trip mid-stroke

Comment at 1107-1111 explains the optimization. Correct — but during a long stroke (5+ seconds drawing a curve), if the user backgrounds the app mid-stroke, `editOpSeq` is unchanged, and a runPreview launched before backgrounding will not see the fence trip on session ID alone (sessionId hasn't changed either if user doesn't fully exit). This is a tiny edge case but worth noting that `editOpSeq` is no longer monotonic-per-edit-event.

---

## Recommendation

NEEDS_WORK. Three items must land before OTA:

1. **C1 (Blocker)**: Move legacy key cleanup to unconditional path in `loadSession`, plus add a one-shot module-init cleanup. ~5 LOC.
2. **C2 (Critical)**: Add jest `afterEach(_resetForTesting)` to `editDiagSender` test setup OR module-detect jest and skip AppState subscription. ~10 LOC.
3. **C4 (Medium)**: Per-attempt nonce on lastError auto-clear. Optional but recommended. ~6 LOC.

C3 (RN AbortSignal) — defer; current RN/Hermes behaves correctly. Add a note in `routing/mapmatch/README` if one exists.
C5 — escalate to PO; if PO accepts current behavior, document in user-facing changelog.
C6 — note in code comment near 1107.

After C1 + C2 land, this is PASS.
