# R8 Final Ship Review (independent)
**Verdict**: PASS

**Scope**: Final independent senior-engineer ship-readiness review of v6.3 brush-edit, after R6 fixes were applied. No prior-conversation context. Files verified by reading source + diff vs `HEAD`:

- `app/src/services/EditSessionPersistence.ts`
- `app/src/services/editDiagSender.ts`
- `app/src/services/routing/mapmatch/MapMatchingClient.ts`
- `app/src/store/useRouteEditStore.ts`

**Build sanity**:
- `npx tsc --noEmit` → 0 errors.
- `npx jest src/store src/utils src/services --detectOpenHandles` → 18 suites, 191 passed, 3 skipped. **No worker-exit warning. No open handles reported.**

---

## R6 fixes verified

### R6 C1 (Blocker) — legacy v249-v255 key cleanup runs unconditionally
**Verified.** `EditSessionPersistence.ts:207-216` calls `removeItem(LEGACY_STORAGE_KEY)` at the very top of `loadSession`, BEFORE the v6.3 read+parse `try` block. This means cleanup runs regardless of whether v6.3 has its own valid blob, regardless of whether `JSON.parse` later throws on a corrupted v6.3 blob, and regardless of which validation branch the v6.3 blob takes (224, 239, 248, 257, 266, 290, 303 — all malformed-shape rejections). The schemaVersion-mismatch branch (224-233) also re-removes the legacy key explicitly. `clearSession` (313-325) also removes both keys. **R6 C1 closed.**

Stress check — "what if removeItem succeeds but JSON.parse throws on a corrupt v6.3 blob?": legacy cleanup is in its own try/catch executed BEFORE the parse try. JSON.parse throwing falls into the outer catch at 308-310 and returns null — legacy cleanup already ran on the previous tick. Confirmed: cleanup happens.

(Caveat, NOT introduced by R6: a corrupt v6.3 blob that fails JSON.parse is not removed in the outer catch. Pre-existing behavior, low impact — orphan persists until next clearSession. Not a Blocker.)

### R6 C2 (Critical) — jest worker leak from editDiagSender AppState listener
**Verified.** `editDiagSender.ts:99-101` calls `(flushTimer as any).unref()` when available, allowing Node event loop to exit even if the debounce timer is the only handle. `--detectOpenHandles` produced **no warnings** this run, and the test suite reports clean exit. **R6 C2 closed.**

### R6 C3 (Medium) — AbortSignal listener leak
**Verified.** `MapMatchingClient.ts:76` registers external abort listener with `{ once: true }` AND keeps an explicit `cleanupExternal` removeEventListener path on both fetch resolve and reject (84, 89). Belt-and-suspenders: even an RN polyfill that silently ignores `removeEventListener` is covered by `once: true` self-detach. Even an older polyfill that silently ignores `once` is covered by the explicit `removeEventListener`. No realistic path leaks.

### R6 C4 (Medium) — lastError auto-clear race
**Verified.** `useRouteEditStore.ts:1817` increments editOpSeq inside the `set()`. `1824` reads `get().editOpSeq` AFTER the set — so `seqAtSet` correctly captures the post-bump value. The setTimeout callback at 1827 compares `live.editOpSeq === seqAtSet`; any subsequent preview that bumps editOpSeq invalidates the equality and the late timer becomes a no-op, preserving the new lastError. **R6 C4 closed.**

---

## Production risk assessment

No remaining ship-blocking risk. Pre-existing minors (acknowledged, not in scope for this Sprint):

- **Corrupt v6.3 blob with JSON.parse failure** is not auto-cleared (outer catch at 308-310 returns null silently). Low impact — orphan persists until next saveSession overwrites or clearSession runs. Pre-existing, NOT introduced by R6.
- **R6 C5 (undoStack wiped on Preview commit)** — product behavior, not bug. Already deferred to PO per R6.
- **R6 C6 (editOpSeq not bumped per stroke point)** — intentional perf optimization, documented at 1107.

## Detected open handles

None. `--detectOpenHandles` ran cleanly across all 18 suites.

## Recommendation

**SHIP NOW.** All four R6 findings (C1 Blocker, C2 Critical, C3 Medium, C4 Medium) have corresponding code changes that correctly address the root cause. Typecheck clean, 191 tests pass, no open handles, no worker leak. Independent of R7 (not consulted) and R6 (used only as input checklist), this code is ship-ready for OTA.
