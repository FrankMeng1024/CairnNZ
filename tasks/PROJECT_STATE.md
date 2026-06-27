# PROJECT_STATE.md — Cairn

**Status**: IN_PROGRESS
**Current Sprint**: 67 CLOSED — F1 of Friend System v1 (5 sprint roadmap). Next: Sprint 68 F2.
**Last Updated**: 2026-06-27
**Governing Document**: docs/PRD2.md (PRD3.md adds NZ localization layer)

## Key Decisions
- acceptance_mode: auto
- Style: Natural Warm + Liquid Glass quality upgrade
- Tech: React Native + Expo, Mapbox, Node.js/Express + MySQL, JWT auth
- PRD2 confirmed: no user confirmation needed for any detail
- Phase 3 AR + Community: ACTIVE (社区播报 deferred, everything else builds now)
- Git: Strategy A, direct to main
- Historical Sprints 0–41: ALL CLOSED

## Phase Roadmap (from PRD2)
- Phase 1: E-001 (Map) + E-002 (GPS) — COMPLETE
- Phase 2: E-007 (Routes) + E-008 (Broadcast) + E-006 (Marker edit) + E-011 (SOS) — COMPLETE
- Phase 2.5: E-004 (Friends) + E-009 (Weather/Road) — COMPLETE
- Phase 3: E-003 (AR) + E-005 (Community) — IN PROGRESS (Sprint 51+)

## Completed Sprints (PRD2 era)
- Sprint 42: Mapbox SDK, MapScreen real rendering, Kalman filter (18 tests), GlassPanel + Elevation
- Sprint 43: Offline tile manager, HikingScreen Mapbox + track polyline, GPSStatusBar, MapBottomPanel
- Sprint 44: MapScreen full integration (panel+offline), app.json fixes
- Sprint 45: Route data model (useRouteStore), web stubs, Phase 1 complete
- Sprint 46: BroadcastService (P0/P1/P2 + rhythm), route deviation (11 tests), waypoint arrival, RouteDrawingSheet
- Sprint 47: SOS service + SOSButton (long-press+countdown+SMS), marker updateMarker
- Sprint 48: NavigationController (deviation+waypoint on GPS tick), tracking loop integration
- Sprint 49: weatherService (Open-Meteo), trailStatusService (DOC), useFriendStore (complete lifecycle)
- Sprint 50: RoutesScreen real data from useRouteStore, icon fixes
- Sprint 51: ARScreen + useCommunityStore + contentFilter + marker spacing
- Sprint 52: Unit tests expansion (51 total tests all passing)
- Sprint 53: Backend routes (friends + markers API), MapScreen edit/delete, HikingScreen SOS, glass styling all screens
- Sprint 54: Full front/backend wiring — useMarkerStore async+sync, useFriendStore authenticatedFetch, MapScreen real markers, FriendsScreen real API
- Sprint 54 cont: Edit marker modal (MapScreen), RoutesScreen navigation, loadFriendsFromBackend, AuthScreen TS fixes, SettingsScreen toggle wiring, RunningScreen real routes, session backend sync

## Test Status
- 51 unit tests: ALL PASSING
- Test suites: geo-kalman (18), geo-route (11), geo-spacing-filter (14), spike-pipeline (8)
- TypeScript: zero new errors (only pre-existing AuthScreen/SettingsScreen icon issues from Sprint 35)

## Architecture Complete
| Layer | Components |
|-------|-----------|
| Map | Mapbox MapView, offlineManager, PointAnnotation, LineLayer, ShapeSource |
| GPS | Kalman filter, dynamic sampling, speed classification, point validation |
| Routes | useRouteStore, RouteDrawingSheet, NavigationController, deviation detection |
| Broadcast | BroadcastService (P0/P1/P2), 15s rhythm, merge logic, audio ducking |
| SOS | sosService, SOSButton (long-press 3s + 5s countdown + SMS fallback) |
| Weather | weatherService (Open-Meteo, 15min cache, danger detection) |
| Trails | trailStatusService (DOC API, location filter, priority classification) |
| Friends | useFriendStore (request/accept/mute/share), API functions |
| Community | useCommunityStore (aggregation, voting, reporting, clustering) |
| AR | ARScreen (GPS→XYZ, bearing, 3D configs, permission visuals) |
| Visual | GlassPanel, Elevation system, spring animations |
| Content | contentFilter (keyword blacklist, extensible for AI) |

## Next Steps
1. Per-page functional + visual review (一个个页面看功能和美工) ← READY NOW
2. EAS build testing when Mapbox token available
3. Complete AR native integration (requires @viro-community/react-viro + EAS build)
4. Sessions sync to backend (/api/sessions) ← DONE
5. VU (Virtual User) acceptance when product is testable on device

## Sprint 67 — Friend System v1 / F1 (CLOSED 2026-06-27)

**Sprint Goal**: Schema + Backend + Spike + Data foundation for trusted-circle Friend System v1.

7 of 7 items Done:
- STORY-00524 — auth.js login does not enforce password length (verified, no code change)
- STORY-00525 — Migration 018 applied (account_type, memory_subscription_limit, routes.permission, memory_subscriptions, hidden_items, race-safe trigger) + `backend/src/constants/permission.js`
- STORY-00526 — 9163 cleanup (mysqldump backup + DRY-RUN + 5 sessions deleted + 46 Kalman-rebuilt memory_points)
- STORY-00527 — 9 mock `@cairn.demo` seed (bcrypt cost 12, exact §8 counts, geometric verify, backup/restore/clear scripts). 10 legacy 2026-05-19 friends rows deleted with user authorization (backup in `_spike/sprint67-friends-cleanup/`).
- STORY-00528 — 8 new backend endpoints (memory-subscriptions, circle/{markers,routes,fog}, markers/public, hide) + v4 H1 enforcement (POST/PUT markers/routes reject permission='public') + Route model now persists permission ('personal'|'friend'). 23/23 integration tests PASS. Arch subagent review verdict: PASS.
- STORY-00529 — node-cron weekly orphan cleanup (`cleanHiddenItemsOrphans.js`, Sun 03:00 UTC) + `docs/TECH_SPEC.md §cron`. Manual test: 5 orphans deleted, 1 valid row preserved.
- SPIKE-67-1 — Mapbox iOS fog UNION feasibility — **VIABLE_WITH_CONDITIONS** (desk research + production codepath audit; live FPS measurement deferred to F4 Sprint 70 prep on user's iPhone — honestly disclosed, no faked numbers). 3 fallback designs documented.

**Friend System next**: Sprint 68 (F2 — Mark UI + Interaction + Like/Delete), 5 stories.
