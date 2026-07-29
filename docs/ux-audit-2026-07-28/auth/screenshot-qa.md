# Screenshot QA — auth

Reviewed by A-SSQA on 2026-07-28. Compared each screenshot to the auditor's "预期 UI" in `auth/AUDIT.md`.

## S01-splash-bypassed.png — PARTIAL (wrong screen but flagged as bypass)
- Expected (S01 splash): SafeAreaView with animated Cairn (3 stones + flag), 56pt "Cairn" wordmark, "Leave a mark. / Guide the next." tagline, OtaBadge slot, Sign In primary + Create Account secondary buttons, "Your hiking data is securely stored..." hint.
- Observed: **Home screen rendered instead of splash**. This is because A-PLAY hit the bypass path (`__cairnStores` web test hook or `?bypassAuth=1`). The AuthScreen splash is never shown when bypass is active.
- Filename `S01-splash-bypassed.png` explicitly acknowledges this — the test setup bypassed auth, so the true splash cannot be verified via web Playwright. AUDIT.md S30 notes: "无源码级 bypass hook on AuthScreen" — QA needs a real test account, or the shot must be taken with `localStorage.clear()` and no bypass.
- Cannot judge splash-specific bugs (animation, wordmark, tagline, OtaBadge inline, Apple/Google button rendering) from this shot.
- Note: no visible errors — home fully rendered — so at least the bypass path works.

### Suggestion for A-PLAY re-shoot
To verify auth S01 through S38 as designed, A-PLAY needs to:
1. Clear localStorage AND ensure `__cairnStores` bypass is not applied.
2. Navigate to `/` with no query params.
3. Wait 500ms + screenshot (checking splash-0s), wait 1500ms + screenshot (mid-anim), wait 2000ms + screenshot (final).

---

## Summary for auth
- **PASS**: 0
- **FAIL**: 0
- **PARTIAL**: 1 (S01 splash-bypassed — rendered Home instead of splash; test hook active, not a UI bug)
- **Not shot yet**: S02-S38 (all pending A-PLAY output)

### Broken UI caught (visual evidence beyond audit text)
- None from this single screenshot. Splash visuals themselves not verified — A-PLAY needs to re-shoot without bypass hook active.
