# PROJECT_STATE.md — Cairn

**Status**: IN_PROGRESS (Sprint 72 CLOSED — 6 user asks landed via web Playwright; F5 iPhone gates still pending)
**Current Sprint**: 72 CLOSED (Sprint 71 SPEC WRITTEN awaits iPhone session; Sprint 72 = Auth 无感 + 后台生存)
**Last Updated**: 2026-07-06
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

## Sprint 68 — Friend System v1 / F2 (CLOSED 2026-06-27)

**Sprint Goal**: Land the user-facing Mark surface for Friend System v1: tri-tier visibility on create, tier-aware visual treatment, the 4-form Detail Sheet, fake Like/Report UI, dual-semantic Delete, and Hide-from-me with client-side cache wipe.

5 of 5 stories Done:
- STORY-00530 — Mark create UI: visibility toggle (default Friend). `defaultLevel: 'self' → 'friends'`, `enablePublicOption: false`. Playwright verified: 2-chip toggle, Friends highlighted, no Anyone chip.
- STORY-00531 — Mark visual treatment by tier. New `markTier.ts` pure function + `colorFromUserId` stable hash (8-color palette). MapScreen RealMap accepts viewerId + friendIds; per-marker tier computed inline; self = inline pin, friend = +2px colored ring, stranger = opacity 0.6.
- STORY-00532 — Detail Sheet 4 forms. `markVisibility.ts` (iron law 1) + `MarkDetailSheet.tsx` (modal switching A/B/C/D). 9/9 logic tests PASS. Playwright screenshots for forms A-personal, A-public, B-friend, B-public-anon, C — `docs/qa/sprint68-evidence/`.
- STORY-00533 — Like/Report fake + Delete dual. `useMarkLikeStore` session-only. NO HTTP for Like/Report. Delete dual-semantic: own → DELETE marker, other → Hide. Like toggle visually verified (♡ → ❤ Liked red).
- STORY-00534 — Hide-from-me + cache wipe. `useMarkerStore.hideMark()` action: optimistic local filter + MMKV write + POST /api/hide. Strong-warning Alert modal. Dev preview wired to real action for end-to-end testing.

**Dead-code cleanup**: `useCommunityStore.ts` deleted (zero refs). ARScreenLegacy LikeReportSheet left intact (active kill-switch fallback — not dead).

**Web testing infrastructure built**: Platform.OS==='web' GPS mock in GpsLockStep; `MarkDetailDevPreview` route + HomeScreen `__DEV__` entry link. Enables Playwright verification for all Friend-system / Trails UI; only Memory tab fog requires iPhone (SPIKE-67-1 deferred).

**Sprint 68 follow-up (NOT done — explicit deferral)**:
- `loadCircleMarkers()` consuming `GET /api/circle/markers` (Sprint 67 endpoint) so subscribed-friend marks reach MapScreen render. Tier visuals + Detail Sheet B/C forms only fully activate with this load wired.
- Live iPhone device verification — F5 hardening Sprint.

**Friend System next**: Sprint 69 (F3 — Route + Trails), 4 stories per v4 §14.

## Sprint 69 — Friend System v1 / F3 (CLOSED 2026-06-27)

**Sprint Goal**: Extend Friend System visibility model from Marks to Routes + Trails.

4 of 4 stories Done:
- STORY-00535 — Route create UI visibility toggle (default Friend). RouteEditorScreen + useRouteStore + routeService thread `permission`. v4 §11 no-Public binding satisfied.
- STORY-00536 — Trails Activities stays Mine-only. Defensive verification — code is already correct, no Friends sub-tab present (v4 §10 binding).
- STORY-00537 — Trails Flags Mine|Friends sub-tab. New shared ScopeTabBar component. useMarkerStore got `circleMarkers` slice + `loadCircleMarkers()` action. fromBackend now reads `user_id` + `author_name`. **Closes Sprint 68 follow-up** "wire loadCircleMarkers".
- STORY-00538 — Trails Routes Mine|Friends sub-tab. useRouteStore got `circleRoutes` slice + `loadCircleRoutes()`. RouteSheet gained `readOnly` prop — Friends-tab routes don't show Edit affordance.

**Playwright verified** (web Trails screen): Activities has NO sub-tab; Flags + Routes both have Mine|Friends sub-tabs with correct empty states; Friends scope triggers correct network call (/api/circle/markers + /api/circle/routes). Evidence: `docs/qa/sprint69-evidence/`.

**Friend System progress**: 3/5 F-buckets complete (F1+F2+F3). Sprint 70 (F4 Memory) next — fog UNION render gated on SPIKE-67-1 iPhone live FPS check.

## Sprint 70 — Friend System v1 / F4 (CLOSED 2026-06-27)

**Sprint Goal**: Memory tab fog + subscriptions + paywall — landed every UI surface, fog UNION render deferred to F5/iPhone gate.

4 of 5 stories Done + 1 explicitly Deferred:
- STORY-00539 — Memory tab Mine|Friends scope toggle in top bar. `useMemoryScopeStore` + `MemoryScopeToggle` component.
- STORY-00540 — 5-friend pick modal. `useMemorySubscriptionsStore` (wraps Sprint 67 `/api/memory-subscriptions` CRUD). `MemoryFriendPickModal` + FAB visible only in Friends scope.
- **STORY-00541 — fog UNION render — DEFERRED to F5/Story-546** (iPhone-only per SPIKE-67-1 verdict). Honest disclosure per `feedback_unity_visual_test`.
- STORY-00542 — Paywall sheet UI. `PaywallSheet` component; Subscribe button → "Coming soon" Alert (NO real IAP per v4 §12).
- STORY-00543 — Stranger Public mark blurred icon. `StrangerBlurredPin` in CairnPinsLayer; 24px gray opacity 0.6, no tap handler.

Type-check clean across all 5 modified files. Sprint 70 follow-up explicit: wire `loadCircleFog()` + `loadStrangerPublicBbox()` in F5 alongside iPhone gate.

## Sprint 71 — Friend System v1 / F5 (SPEC WRITTEN, EXECUTION QUEUED 2026-06-27)

**Sprint Goal**: iPhone-only hardening — fog UNION FPS gate, real-device visual review, TestFlight build, Virtual User acceptance.

5 stories written:
- STORY-00544 — 18 Playwright scenarios (web subset). **Done (spec written)**: `app/tests/sprint71/friend-system-v4-scenarios.spec.ts` + `playwright.config.ts`. 11/18 scenarios web-runnable; 5 deferred to iPhone (Story-545); 2 cross-referenced to Sprint 67 (Story-528 integration test + migration 018 trigger).
- STORY-00545 — iPhone real-device visual review. **Queued for user iPhone session.**
- STORY-00546 — fog UNION live FPS + Story-541 impl. **Queued; SPIKE-67-1 gate.**
- STORY-00547 — 5-friend UNION < 3s perf acceptance. **Queued.**
- STORY-00548 — TestFlight build + Virtual User score ≥ 9.5/10 → v1 COMPLETE. **Queued.**

**Friend System v1 status**: All implementation Sprints complete (67/68/69/70 + 71 spec). v1 closes when user runs the iPhone-gated F5 stories and Virtual User scores ≥ 9.5/10.

## Sprint 72 — 后台生存 + Auth 无感 (CLOSED 2026-07-06)

**Sprint Goal**: 6 条用户诉求 —— 后台 hiking 持续记录 / 息屏 / 记录时省电 / 无端不回 login / hiking token 不过期 / 产品持续记录本质.

**9 of 9 stories Done (all via web Playwright acceptance)**:

- STORY-00549 — 冷启动 auto-login + 注销硬清. `useAppStore.hydrate` 重写 + logout marker + AuthScreen 清 marker. Playwright: 有效 token → Home; marker → AuthScreen (token preserved); 无 token → AuthScreen; 全部有 breadcrumb.
- STORY-00550 — JWT 30d + refresh endpoint + iron rule. Backend `.env` 30d + `POST /api/auth/refresh` + `authenticate.js` sets `X-Cairn-Auth-Invalid: true` + body `code: TOKEN_INVALID`. Frontend apiService 4-rule iron law (fetch throw / 401 no signal / 401 hard signal / tracking guard). 7/7 jest pass + real backend curl + Playwright iron-rule via `apiService:401_ignored` breadcrumb in production.
- STORY-00551 — 未结束 session 恢复 banner. `UnfinishedSessionBanner` + hydrate detect `cairn_bg_active_session_id`. Playwright: seeded id → banner shown → End&save → cleared. Full UI + breadcrumb loop verified.
- STORY-00552 — Auto-pause / 静止提醒. `autoPauseMonitor` service + 15min/30min thresholds + expo-notifications. 5/5 jest.
- STORY-00553 — 后台 GPS 采样降频. `getSamplingInterval(movement, batteryLow, opts)` with appState + battery + charging. 9/9 jest + 10/10 real-web matrix via `__cairnGetSamplingInterval`.
- STORY-00554 — 非 tracking 时后台定时器 pause. Flush interval fg 120s / bg 300s via `__cairnRestartFlush(newMs)` + `timer:flush_interval_adjust` breadcrumb.
- STORY-00555 — Hiking 中主动续 token (30min interval). `tokenRefreshInterval` in `startTracking()`. Iron rule preserved (refresh fail NEVER clears token). Real refresh endpoint verified live.
- STORY-00556 — AuthScreen "Your tracks stay on this device" + iOS LPM warning. Playwright screenshot verified; LPM 24h dedupe via AsyncStorage.
- STORY-00557 — Web breadcrumb hook `__cairnBreadcrumbs` (Platform.OS==='web' guard, no __DEV__ gate). All Sprint 72 breadcrumb tags round-trip.

**Backend deployed to aliyun**: `.env` JWT_EXPIRES_IN 7d→30d + docker compose recreate + `docker cp` new `auth.js`+`authenticate.js` into `cairn-backend` container + restart. Verified: login token exp = 30d, refresh endpoint 200, invalid token → 401 + `code:TOKEN_INVALID` header+body.

**Blocker fixed during QA**:
- CORS strips `X-Cairn-Auth-Invalid` header from browser fetch → apiService now falls back to `body.code === 'TOKEN_INVALID'`. Native iOS/Android fetch has no CORS restriction so header path still works there.
- Dev hooks were `__DEV__`-gated → didn't expose under `--no-dev`. Changed to `Platform.OS === 'web'` only (still safe — native bundle never enters this branch).

**Arch verdict**: PASS (docs/arch/sprint72-review.md)
**QA verdict**: PASS (docs/qa/sprint72-verdict.md)
**UX review**: PASS 0 friction items (docs/ux/sprint72-review.md)

**Medium items → Sprint 73 backlog**:
- M1: tokenRefreshInterval/autoPauseMonitor safety cleanup in reset()/logout() (hygiene)
- M2: apiService ← useTrackingStore circular import runtime verify on real device
- M3: UnfinishedSessionBanner End&save should write ended-status to sessions row (currently only clears marker)

**Deferred to real iPhone gate (not web-testable)**:
- Sprint 71 F5 stories (fog UNION FPS, TestFlight, Virtual User) — still queued
- STORY-552 auto-pause real notification delivery
- STORY-553 real battery savings measurement
- STORY-556 LPM real device alert
