# R5 Code Re-Review — v6.3 (after R3+R4 fixes)

**Verdict**: PASS

**Date**: 2026-06-13
**Scope**: Independent fresh-context re-review of v6.3 brush-edit ship code following R3 + R4 fixes (4 of 5 issues addressed; R4 #3 nav.replace deferred as pre-existing).

**Verification artefacts**:
- `npx tsc --noEmit` → 0 errors
- `npx jest src/store src/utils src/services --no-coverage` → 18 suites passed, 191 tests passed, 3 skipped (matches expected baseline)

---

## Status of R3+R4 issues

### R3 C1 — runPreview top-level catch (fence-first)
**Status**: FIXED.
- File: `src/store/useRouteEditStore.ts`, lines 1833-1860
- Outer `try` wraps the whole stroke-iteration body. `catch (e: any)` (line 1833) checks the fence FIRST via inline IIFE comparing `live.sessionId !== startSid || live.editOpSeq !== startSeq` (1839-1842), returning `{ ok: false, error: 'state-changed' }` cleanly so a hardware-back during throw is not mis-classified as a network error.
- AbortError mapped to '网络慢,请重试'; everything else falls through to '未识别到这条路'. lastError auto-clears via setTimeout (line 1846-1849).
- `finally` block (1855-1860) unconditionally clears `isComputing`, satisfying the R1v3 contract.

### R3 C2 / R4 #2 — schemaVersion + DRAFT_STORAGE_KEY
**Status**: FIXED.
- File: `src/services/EditSessionPersistence.ts`
- `EDIT_SESSION_SCHEMA_VERSION = 1` exported (line 38), typed as the literal in `EditSessionSnapshot.schemaVersion` (line 59), so the compiler enforces stamping at save.
- `STORAGE_KEY = '@cairn:edit_session_active_v6_3'` (line 30) and `LEGACY_STORAGE_KEY = '@cairn:edit_session_active'` (line 31).
- `saveSession` stamps `schemaVersion: EDIT_SESSION_SCHEMA_VERSION` (line 168) — caller-supplied type omits the field via `Omit<…, 'lastEditAt' | 'schemaVersion'>` (line 122) so callers cannot forget or override.
- `loadSession` rejects-and-clears any blob whose `schemaVersion !== EDIT_SESSION_SCHEMA_VERSION` (lines 224-227). Best-effort `removeItem(LEGACY_STORAGE_KEY)` runs both on the empty-storage path (lines 213-217) and on `clearSession()` (lines 311-315). Failures are swallowed safely.

### R3 C3 — AbortController plumbed store→matchSegment
**Status**: FIXED.
- Store: `previewAbort = new AbortController()` (line 1560). `fenceTriggered()` aborts it on fence trip (line 1568-1571). `matchSegment(seg, { signal: previewAbort.signal })` (line 1664).
- Client: `matchSegment(segment, options?: { signal?: AbortSignal })` (line 132-135). `fetchWithTimeout(url, TIMEOUT_MS, options?.signal)` (line 166).
- `fetchWithTimeout` (line 50-90): immediate-aborted short-circuit, `addEventListener('abort', …)` registers the external listener, removes it on both resolve and reject paths — no listener leak.
- `'aborted'` error mapped to `reason: 'invalid-input', detail: 'aborted'` (line 226-228), placed BEFORE the generic `if (attempt < MAX_RETRIES) continue` so it short-circuits retry. ✔

### R4 #1 — checkG1 dead code deleted
**Status**: FIXED.
- `src/utils/strokeGate.ts`: no `checkG1` export, no `G1Input` interface. Authoritative G1 logic documented (lines 200-208) as living in `useRouteEditStore.strokeAnchorsToBaseline`. `ANCHOR_M = 50` still exported (line 38) as documentation/telemetry constant. `GateName` union still includes `'G1'` (line 50) for telemetry payloads — correct.
- `src/utils/__tests__/strokeGate.test.ts`: imports list (lines 8-14) does not reference `checkG1`. Comment at lines 122-126 explains G1 is exercised end-to-end in `validateStrokes.test.ts`. No orphan `describe('checkG1')` blocks.

### R4 #3 — nav.replace fragility
**Status**: DEFERRED (pre-existing, not v6.3 scope). Confirmed not addressed; consistent with task brief.

---

## New issues

None of Blocker or Critical severity.

**N1 (Low / nit)** — `useRouteEditStore.ts` line 1839-1842: the fence re-check inside `catch` duplicates the `fenceTriggered()` closure at lines 1564-1573 instead of calling it. Functionally identical, but two copies of the fence-trip predicate is mild duplication. Not a bug; flagging only because future fence semantics changes (e.g., adding routeId comparison) would need to be made in two places. Safe to ignore for ship.

**N2 (Low / nit)** — `MapMatchingClient.ts` line 226-228: aborted maps to `reason: 'invalid-input', detail: 'aborted'`. The store's `r.reason === 'invalid-input'` branch (line 1701) maps that to '画笔不符合要求' user copy — but for a user-cancelled abort, the toast would be misleading IF the abort raced past the fence check. In practice this is harmless because the fence check at line 1679 (`if (fenceTriggered()) return { ok: false, error: 'state-changed' }`) runs immediately after the await and short-circuits before `r.reason` is examined. However, if a future refactor moves the fence check, the user could see "画笔不符合要求" after a hardware-back. Consider a dedicated `'aborted'` reason in `MatchResult` for clarity. Non-blocking.

**N3 (Low / nit)** — `EditSessionPersistence.ts` line 122: `Omit<EditSessionSnapshot, 'lastEditAt' | 'schemaVersion'>` is correct, but the JSDoc at line 121 ("schemaVersion + lastEditAt are stamped by saveSession itself") is now the only documentation of this constraint at the call site. Consider adding a TS-level comment near `EDIT_SESSION_SCHEMA_VERSION` linking to the gate in `loadSession`. Cosmetic.

**N4 (informational)** — Test count is 191 passed + 3 skipped = 194 total. Matches the expected 191. No regression in suite size.

**N5 (informational)** — No new hardcodes, TODOs, or silent-fail paths found in the diff surface. `clearSession()` swallows errors as designed (line 316). `notifyFailureListeners` wraps each listener in try/catch (line 110-115) — defensive, correct.

---

## Recommendation

**Ship.** All four R3+R4 issues that were in scope are correctly fixed, with no regressions. TypeScript clean, full test suite green at 191 passing. The three nits (N1, N2, N3) are cosmetic and can be addressed opportunistically in v6.4. R4 #3 (nav.replace) remains deferred per task brief.
