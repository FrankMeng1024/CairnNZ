# routes — Playwright Execution Log

## Environment
- 414×896. Web bypass. Reached via Home > Trails tool button.

## Scenario S01 (Activities tab empty): pass
- Screenshot: S01-routes-activities-empty.png
- Observation: RoutesScreen renders with:
  - Back button top-left, "Routes" title centered
  - Segmented tabs: **Activities / Routes / Flags** — Activities selected in green pill
  - Empty state: "No tracks walked yet" + "Start hiking or running. Your tracks will live here." + mountain trail illustration (nice friendly artwork)
- **Naming issue**: Screen title is "Routes" but there are 3 tabs, and one of them is *also* named "Routes". Confusing hierarchy — the "Routes" title should probably be "Trails" or "History" (to match the Home tool label "Trails") to disambiguate.

## Scenario S02 (Routes tab): partial — page hang
- Attempted: Click "Routes" tab
- Result: Page rendered "Mine/Friends" sub-tabs + empty state "No saved routes yet" + "View Activities" CTA, but subsequent screenshot commands timed out (5s font-load hang). Recovered after full navigate reset.
- Observation from snapshot: sub-tabs "Mine" and "Friends", empty text explains how to save a route, CTA "View Activities" navigates back to Activities tab
- **Blocker/perf concern**: 5+ second render hang when switching to Routes tab — likely from Mapbox map layer load. Font loading blocks page.screenshot; suggests main thread work in tab switch is heavy.

## Scenario S03+ (Flags tab, RouteEditor, save/edit flows, etc.): skip
- Reason: Time budget preservation after S02 hang. Would need `__cairnStores` to inject saved routes to test non-empty state.

## ROUTE_EDITOR_AUDIT (separate file exists)
- Not executed on web. RouteEditor is opened from Activities > Save as Route flow, which requires an existing session. No sessions in this dev build → RouteEditor unreachable via UI.
