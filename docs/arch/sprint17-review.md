# Arch Code Review — Sprint 17

**Sprint**: 17
**Date**: 2026-05-15
**Verdict**: PASS

## Changes Reviewed

Sprint 17 was a pure English-text conversion sprint. No new components, no new API calls, no schema changes.

### Files changed
- `app/src/screens/HikingScreen.tsx` — string literals converted to English
- `app/src/screens/RunningScreen.tsx` — string literals converted to English
- `app/src/screens/MapHistoryScreen.tsx` — string literals converted to English; **additionally**: Zustand selector bug fixed (see below)
- `app/src/screens/FriendsScreen.tsx` — string literals converted to English
- `app/src/screens/SettingsScreen.tsx` — string literals converted to English
- `app/src/screens/MapScreen.tsx` — string literals converted to English
- `app/src/screens/RoutesScreen.tsx` — string literals converted to English
- `app/src/data/mockData.ts` — MARKER_META labels, MOCK_FRIENDS lastSeen, MOCK_MARKERS text converted to English

## Interface Contract Compliance

No API contract changes. No UI_SPEC changes. String-only changes.

## Bug Fix Review — MapHistoryScreen Infinite Re-render

**Change**: `useMarkerStore(s => s.getMarkersForRegion(region.code))` → `useMarkerStore(s => s.markers)` + external filter.

**Assessment**: Correct fix. Calling a store method that returns a derived array inside a Zustand selector violates referential equality — every render produces a new array, triggering re-subscription and infinite loop. The fix correctly selects the stable primitive (`markers` array) and derives filtered data outside the selector. This is the standard Zustand pattern for derived data.

No contract violations. No new security issues. No regressions introduced.

## Issues

None.

## Spec Drift

None.
