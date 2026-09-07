# Feature inventory

Each consequential item carries the required evidence classification.

## Core active

- **FACT:** Email authentication, verification, login, JWT persistence/refresh, forgot/reset password, and Apple sign-in backend/client paths.
- **FACT:** Home as the authenticated product hub with Hike, Run, Plant, Trails, Friends, Memory, and Settings entry points.
- **FACT:** Free Hike and free Run producing the same persisted Activity domain with mode-specific metrics.
- **FACT:** Foreground/background GPS recording, pause/resume, raw and processed traces, distance/elevation/time, local JSONL persistence, and server session shells.
- **FACT:** Completed Activity local/server save, Trails history, Activity Detail, deletion, and optional Route generation.
- **FACT:** Personal Route library, Route Detail, Activity-derived Route Editor, independent geometry editing, naming, private/friends visibility, and deletion.
- **FACT:** Standalone/Hiking full Plant flow producing an offline-first Cairn/Marker.
- **FACT:** Running quick Cairn creation producing the same Marker object.
- **FACT:** Personal Cairn list/detail/edit/delete and personal marker rendering in Memory.
- **FACT:** Personal Memory point sync, Fog rendering, H3-derived cache, Mystery Cairn reveal, and Home exploration statistic.
- **FACT:** Trails as the combined Activity, Route, and Cairn library/management surface.
- **FACT:** Settings/profile, appearance/units/haptics/exploration display, export, Memory reset, logout, account deletion, and restore.

## Active secondary

- **FACT:** Friend request/send/receive/accept/decline/cancel, remove, block, unblock, and friend profile statistics.
- **FACT:** Friend-tier Route and Cairn visibility enforced by mutual friendship at circle query time.
- **FACT:** Trails Mine/Friends scopes for Routes and Cairns.
- **FACT:** Separate Memory friend subscriptions and Friend Fog scope.
- **FACT:** Nearby public Mystery Cairn silhouettes and public marker vote/report backend capability.
- **FACT:** Route edit envelopes/local extras and Mapbox-based geometry tooling.
- **FACT:** Activity save-loss pending daemon, process recovery, and user-scoped reconciliation.
- **FACT:** Account data export background worker and email completion path.
- **FACT:** Onboarding with per-user/server completion state.

## Partial

- **FACT:** Route → future Activity reuse is picker-only. The selected Route ID/geometry does not enter tracking, saved Activity, route count, or completion.
- **FACT:** Activity → Route copies geometry but persists no source Activity identity or provenance; the action can be repeated indefinitely.
- **FACT:** Activity/Cairn association is local-only for Running quick Cairns; full Plant has none; backend has no relation.
- **FACT:** Friend Route and Cairn list cards are active, but their taps use own-only detail stores and can resolve to not-found.
- **FACT:** Activity rename updates only local history; backend name can overwrite/compete after hydration.
- **FACT:** Cairn create is durable offline; update/delete are optimistic and lack equivalent durable reconciliation.
- **FACT:** Route update/delete can appear locally successful when API helpers return `null`/`false` instead of throwing.
- **FACT:** Public Route/Cairn schema and reads exist, but ordinary clients cannot publish public objects.
- **FACT:** Marker vote/report/hide backend capability exists, but active Memory inputs omit circle markers and the non-owner hide handler is not wired.
- **FACT:** Memory friend provenance is owner-grouped before render but not retained per rendered unit or originating Activity.
- **FACT:** Memory foreground GPS setting starts a watcher/cache but does not itself unlock/explore; its visible copy overstates effect.
- **FACT:** Entitlement purchase/restore exists, but paid state is not reconciled to the server's five-friend subscription cap.
- **FACT:** Date format is persisted and used in some paths; other dates remain hard-coded.
- **FACT:** Offline Mapbox behavior relies on runtime/vendor cache; no app-owned offline-region workflow is active.
- **PRODUCTION FACT:** Memory subscription authorization/cap is partial because the production trigger it relies on is missing.

## Dormant / future

- **DORMANT / FUTURE:** RouteFollower, `useRouteFollowing`, turn cues, waypoint announcements, off-route thresholds, and voice guidance.
- **DORMANT / FUTURE:** `followingRouteId` store state; no active caller sets it.
- **DORMANT / FUTURE:** Push notification registration, visible preferences, and friend event enqueue calls; server tables/cron remain capable.
- **DORMANT / FUTURE:** Voice Cairn recording/preview; voice data is not persisted by the active Plant flow.
- **DORMANT / FUTURE:** Public user publishing for Routes and Cairns.
- **DORMANT / FUTURE:** RevenueCat entitlement as an actual expansion of server capability.
- **DORMANT / FUTURE:** MapHistory's unparameterized combined history/index path.
- **DORMANT / FUTURE:** `showFriendOverlay` and Memory `recordMode`; persisted but without active product behavior.
- **DORMANT / FUTURE:** Route `run_count` increment; backend field exists but current client has no caller.
- **DORMANT / FUTURE:** Waypoint editing; model fields exist but active editor has no completed waypoint-management flow.

## Debug / development

- **FACT — DEBUG ONLY:** Settings five-tap unlock exposes Debug in production builds.
- **FACT — DEBUG ONLY:** Debug logs, simulated GPS/walker, backend URL/API-key inputs, annotation/upload tools, and diagnostics.
- **DEV / QA ONLY:** `__DEV__` Home/Friends/Hiking/Running/Routes previews and generated screen fixtures.
- **DEV / QA ONLY:** MarkDetail preview, transient-contract review, three-theme component lab, and icon sheet.
- **DEV / QA ONLY:** Expo Web `__cairnStores`, offline queue, and writer bridges for Playwright.
- **DEV / QA ONLY:** Local AsyncStorage feature-flag overrides with no user-facing setter.

## Legacy / unused — confirmed

- **LEGACY / UNUSED — CONFIRMED:** Bottom-tab product shell; the active navigator explicitly restored a Home-led stack.
- **LEGACY / UNUSED — CONFIRMED:** Removed backend feature-flag service/table access; effective flags are static local defaults/overrides.
- **LEGACY / UNUSED — CONFIRMED:** Removed offline map service and app-owned region downloader.
- **LEGACY / UNUSED — CONFIRMED:** Old all-in-one Activity POST save; current code uses start/append/atomic save.
- **LEGACY / UNUSED — CONFIRMED:** `setActiveRoute`, client route run-count increment, waypoint mutators, and muted-marker methods removed for zero callers.
- **LEGACY / UNUSED — CONFIRMED:** Pre-visual-system generated implementations are review fixtures, not active screen authority.

## Uncertain

- **UNKNOWN:** RevenueCat dashboard product IDs, pricing, offerings, trial configuration, and whether production entitlements are provisioned.
- **UNKNOWN:** Whether current production has any valid device tokens or queued notifications; no sensitive row inspection was required.
- **UNKNOWN:** Intended product policy for multiple Routes generated from one Activity.
- **UNKNOWN:** Intended deletion relationship between Activity/Cairn and already-contributed Memory/Fog.
- **UNKNOWN:** Whether public discovery should become an ordinary product scope.
- **UNKNOWN:** Vendor-supported offline map guarantees under the current Mapbox configuration without external documentation research.

## Product debt ranking

### High

- **PRODUCTION FACT:** Missing `trg_memory_subscription_cap` removes the relied-upon mutual-friend and cap enforcement, while `/circle/fog` trusts subscription rows.
- **PRODUCTION FACT:** Five-minute account deletion grace and one-minute auth sweep are explicitly test-mode values running in production.
- **FACT:** Friend remove/block does not revoke Fog subscription/access, contradicting stated human intent.
- **FACT:** Selected Routes do not survive into Activities, contradicting the intended reusable Route cycle.
- **FACT:** Route update/delete false-success paths can diverge local UI from server authority.

### Medium

- **FACT:** Cairn deletion copy/behavior contradicts the surviving Memory/Fog point.
- **FACT:** Plant comments say planting no longer unlocks while marker store inserts a Memory point.
- **FACT:** Friend Route/Cairn detail taps use own-only store lookup.
- **FACT:** Activity rename is local-only; Activity delete has no rollback.
- **FACT:** Production `sessions.route_id` lacks the repo-declared FK; `unlocked_regions` lacks account-delete cascade.
- **FACT:** Paywall promises capability the server cannot presently grant.
- **FACT:** Memory “always-on GPS” copy implies exploration mutation that the consumer does not perform.

### Low

- **FACT:** Hike/Run share a domain but preserve duplicated presentation/completion logic.
- **FACT:** Settings date formatting is not consumed consistently.
- **FACT:** Home exploration percentage counts points rather than unique explored cells/area.
- **FACT:** Dormant voice/off-route settings remain persisted without visible settings controls.
- **FACT:** Type-checking and parts of the test suite have substantial pre-existing failures, reducing auditability.
