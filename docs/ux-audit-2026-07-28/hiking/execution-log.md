# hiking — Playwright Execution Log

## Environment
- 414×896 iPhone Plus. Web bypass active.
- `window.__cairnStores` NOT exposed. Real tracking state requires backend `/api/sessions/start` which is CORS-blocked on web (`api.yiiling.cn`).

## Scenario S01 (idle entry): pass
- Screenshot: S01-hiking-idle.png
- Observation: HikingScreen renders with:
  - Back button (top-left, white pill)
  - "Enable GPS" pill (top-right, orange with red dot)
  - Central "Real Map (EAS Build)" placeholder + subtitle "Build with EAS to enable live tracking map"
  - Free Hiking route selector at bottom (route name + "Tap to change route" + chevron up)
  - Start Hiking primary button (white pill, green Play icon)
- Concern: On web there is no map, just a placeholder. This matches auditor's static analysis.

## Scenario S02 (route sheet): pass
- Screenshot: S02-route-sheet.png
- Observation: "CHOOSE A ROUTE" bottom sheet slides up. Only Free Hiking option visible (no saved routes in this empty state). Selected item has green tint + checkmark.
- **UX issue**: sheet is not dismissable via Escape key (attempted, no-op). Only way to close is by re-selecting an option. No visible close/dismiss button, no backdrop-tap indicator.

## Scenario S03 (start attempt without GPS): FAIL — silent failure
- Screenshot: S03-start-attempt-no-gps.png
- Steps: Free Hiking route confirmed → Start Hiking tapped
- Observation:
  - "Enable GPS" pill mutated to "**GPS Offline**" (red text/border)
  - Free Hiking selector disappeared (was replaced with a start-tracking state)
  - Start Hiking button remained visible/tappable
  - Backend request `POST /api/sessions/start` fired and got net::ERR_FAILED (CORS)
  - **No visible error toast, banner, or hint to user that start failed**
- Priority: **Critical** — user taps Start Hiking, nothing observable happens, no error UX
- Console errors added: 2 new (see console-errors.log)

## Scenarios S04+ (long tracking, background flow, foreground return, etc.): skip
- Reason: cannot mock GPS or trigger real tracking without native module. Auditor's static code review remains the primary source for these.
