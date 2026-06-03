# Arch Code Review — Sprint 27

**Verdict**: PASS
**Date**: 2026-05-15
**Reviewer**: Arch (isolated subagent, claude-opus-4-6)

## Stories Reviewed
- STORY-00075: PlayCircle icon on New Run button
- STORY-00076: Hide "km" label when No GPS in MapHistory capsule
- STORY-00077: RoutesScreen premium uplift
- STORY-00078: MapHistoryScreen auto-select first session on load
- STORY-00079: HikingScreen back button moved to top-left

## Issues Found

### Medium — STORY-00077: MOCK_ROUTES lacks activityMode field
MOCK_ROUTES items have no `activityMode` field, so `isRunRoute` is always false and primary gradient always applies. Safe default. Production data must include `activityMode` for correct running/hiking color differentiation. No bug in current demo state.

### Medium — STORY-00078: Async hydration race condition (theoretical)
`useEffect` with empty deps reads `sessions[0]` at mount. `useSessionStore.hydrate()` is called in `App.tsx`'s `useEffect` — async. In theory, sessions could be empty at MapHistoryScreen mount if hydration is slower than navigation. In practice: web storage is synchronous, user navigates through auth+home before reaching MapHistory, so hydration is reliably complete. Low actual risk. Note for future: if ever adding deep-linking directly to MapHistoryScreen, add `sessions` to deps or use a `hasHydrated` flag.

## Spec Drift
None.

## Contract Compliance
All changes are pure UI — no API calls, no store contract changes. LinearGradient usage consistent with MapHistoryScreen pattern. All design tokens from UI_SPEC.md/tokens.ts.
