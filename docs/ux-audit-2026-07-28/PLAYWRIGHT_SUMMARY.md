# Playwright Execution Summary — Cairn UX Audit 2026-07-28

## Environment
- Dev server: http://localhost:8086 (running, HTTP 200)
- Web bypass: `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true` — AuthGate skipped; app boots directly into Home
- `window.__cairnStores` / `window.__cairnNavigation` test hooks **NOT exposed** in this build → state-injection scenarios could not run
- Backend `api.yiiling.cn` blocked by CORS in the browser origin (`localhost:8086`) → all `/api/*` requests fail; hydrate scenarios and post/save flows are unreachable on web
- Screenshots captured at 414×896 (iPhone 11/Plus default), plus 375×667 (SE) and 430×932 (15 Pro Max) for Home responsiveness checks
- Screenshots saved to `docs/ux-audit-2026-07-28/<screen>/screenshots/` per project convention

## Screens processed: 12 / 12
| Screen | Status | Screenshots | Notes |
|---|---|---|---|
| auth | skipped (bypass active) | 1 (proof-of-bypass) | AuthScreen unreachable while `EXPO_PUBLIC_PLAYWRIGHT_BYPASS=true` |
| home | ran | 4 | Blocker layout bug found on iPhone SE |
| hiking | ran | 3 | Critical UX gap: silent failure on Start Hiking without GPS/backend |
| running | ran | 1 | Consistency finding: Start CTA visual differs from Hiking |
| plant | ran | 3 | Compose flow tested with real input |
| routes | ran | 2 | Blocker perf: 5-15s hang on Routes tab switch |
| mapscreen | not reached | 0 | Not linked on web; no test hook |
| mapshistory | partial | 0 | Reached via Routes > Routes tab; hangs |
| markerdetail | ran | 3 | Dev preview page tested (Forms A + B) |
| memory | ran | 2 | Onboarding modal + permission-needed state captured |
| friends | ran | 2 | Empty state + Add Friend sheet |
| settings | ran | 2 | Slow mount + full screen mapped |

## Total scenarios attempted: 22 concrete + several failure-mode observations
## Passes: ~19 (rendered as expected + captured)
## Fails: 2 (S21 iPhone SE Home layout, S03 Hiking silent failure)
## Skipped by design: >100 scenarios in the AUDIT.md files (mostly requiring iOS-only APIs, real GPS, injected store state, or authenticated backend)

## Console errors — cross-screen
- Baseline (every page): ~120x `Access to fetch at 'https://api.yiiling.cn/api/edit-diag' blocked by CORS` — global telemetry endpoint blocked on web. NOT a per-screen bug; noise only.
- Additional per-screen errors are all backend endpoints (`/api/routes`, `/api/friends`, `/api/circle/fog`, `/api/sessions/start`, `/api/memory-subscriptions`, `/api/pins/nearby`, etc.) failing CORS. Expected on web because the frontend is served from `localhost:8086` while the API sits on the remote domain.
- **No uncaught JavaScript runtime errors observed on any screen** — this is the key positive signal. All errors are network/CORS, not JS exceptions.

## Runtime bugs caught (Blocker/Critical)
- **home/S21 — iPhone SE (375×667) layout overlap**: "Leave a Cairn here" card overlaps the Running card above. Primary CTA becomes unreadable. Blocker for iPhone SE users.
- **hiking/S03 — Silent failure on Start Hiking without GPS**: "Enable GPS" pill morphs to "GPS Offline" and backend call `/api/sessions/start` fails without any user-facing feedback (no toast/banner/error). User perceives the button as broken. Critical.
- **routes — Routes tab render hang**: Switching from Activities to Routes tab causes 5-15s font-load block; screenshot/snapshot MCP calls time out repeatedly. Likely Mapbox layer or heavy component mount on the main thread. Critical perf.
- **settings — 15-20s cold render**: Settings screen from Home > Settings tool takes 15-20s to finish rendering (multiple screenshot retries needed). Perf concern on web; may still be OK on native.

## Sub-blocker findings worth backlog
- **memory — "Open Settings" CTA on web**: on web there's no OS setting to open; the button is inert. Should be hidden or copy-swapped on web.
- **routes — title/tab naming collision**: Screen title "Routes" + one of the tabs also named "Routes". Confusing hierarchy; header should be "Trails" or "History" to match Home tool label.
- **hiking vs running Start CTA inconsistency**: Hiking uses white pill with green text; Running uses solid green pill with white text. Same conceptual action, different visual weight.
- **plant — title textbox focus state**: title field has no focus border darkening; body field does. Inconsistent focus affordance.
- **friends — Add Friend sheet has no backdrop-tap dismiss**: only Cancel text link closes it.
- **friends — top-right Add pill + center CTA in empty state**: two Add affordances on empty state; the top pill should probably hide until list is non-empty.

## Notable strengths (worth calling out in cross-review)
- **MarkDetailSheet is the strongest polished UI in the app** — 4 form variants all render clean, consistent iconography, hierarchical layout (content → meta → destructive → social).
- **Memory onboarding modal is strong** — clearly communicates the fog-of-war mental model.
- **Bottom-sheet pattern is consistent** across Plant route sheet, Friends add-friend sheet, MarkDetail — good design system reuse.
- **Settings section pattern** (SectionHeader + ActionRow + card + divider + Danger Zone) is the mature baseline — other screens should follow.
- **Te Reo touch** ("Ngā mihi nui — thanks for using Cairn." footer) adds brand character.

## Recommendations to unblock deeper web audit next time
1. Expose `window.__cairnStores` (via existing `__CAIRN_EXPOSE_STORES` env flag or similar) so QA can inject session/marker/tracking states
2. Expose `window.__cairnNavigation` so QA can force-navigate to unreachable screens (MapScreen, MapsHistory replay)
3. Add per-screen dev-preview entry points on Home (parallel to `[dev] MarkDetail preview`) for at least: MapScreen, MapsHistory, HikingScreen tracking state, RunningScreen locked state, RouteEditor
4. Consider enabling a mock backend or an in-app fake data mode for web dev so the CORS-blocked flows can render successfully
5. Investigate the Routes tab and Settings screen render hangs; may be a Mapbox/heavy-component issue on web that is worse than expected on native

## Files produced
- Per-screen: `docs/ux-audit-2026-07-28/<screen>/execution-log.md` (12 files)
- Per-screen: `docs/ux-audit-2026-07-28/<screen>/console-errors.log` (12 files)
- Per-screen: `docs/ux-audit-2026-07-28/<screen>/screenshots/*.png` (~24 files total)
- This summary: `docs/ux-audit-2026-07-28/PLAYWRIGHT_SUMMARY.md`
