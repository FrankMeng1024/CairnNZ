# Screen and domain map

Status describes ordinary current reachability, not whether a file exists. All rows are **FACT** unless another evidence class is shown.

## Active authenticated surfaces

| Screen / surface | Status | Primary domain | Secondary domains | Entry points | Stores / local owners | APIs | Backend model / table | Important outgoing actions |
|---|---|---|---|---|---|---|---|---|
| Home | ACTIVE | Product hub | Activity recovery, exploration, weather, account | Post-auth root | app, session, tracking, memory, marker, weather, settings | profile/onboarding; weather provider; no domain list API directly | users; local summaries | Start Hike, Start Run, Plant, Trails, Friends, Memory, Settings, resume unfinished Activity |
| Hiking | ACTIVE | Activity (hiking) | Route picker, Cairn, Memory | Home; unfinished Hike card | tracking, session, route, marker; JSONL writer | sessions start/append/save/delete; routes list | sessions, memory_points, routes | Start/pause/resume/finish, full Plant, select Route, completion/detail |
| Running | ACTIVE | Activity (running) | Route picker, quick Cairn, Memory | Home; unfinished Run card | same shared tracking/session owners; screen-local selected Route | sessions; markers; routes | sessions, memory_points, markers, routes | Start/pause/resume/finish, quick Cairn, select Route |
| Trails → Activities | ACTIVE | Activity history | Route generation | Home Tools | session store and per-session points | session detail/delete when remote | sessions | Filter/sort, detail, local rename, delete, Save as Route |
| Trails → Routes → Mine | ACTIVE | Route library | Activity-derived provenance is absent | Home Tools; RouteEditor success | route store | routes CRUD | routes, route_edit_envelopes | Search/filter/sort, Route Detail, edit/delete |
| Trails → Routes → Friends | ACTIVE, DETAIL PARTIAL | Friend Route library | Friendship/privacy | Trails scope | circleRoutes cache | `/api/circle/routes` | routes, friends, hidden_items | Read list; tap currently routes to own-only detail lookup and can fail |
| Trails → Cairns → Mine | ACTIVE | Cairn library | Memory, privacy | Home Tools; Plant results | marker store | markers CRUD | markers, marker_votes | Filter/sort, detail/edit/delete, Plant from empty state |
| Trails → Cairns → Friends | ACTIVE, DETAIL PARTIAL | Friend Cairn library | Friendship/privacy | Trails scope | circleMarkers cache | `/api/circle/markers` | markers, friends, hidden_items | Read list; tap currently uses own-only MarkerDetail lookup and can fail |
| Activity Detail (`MapHistory` with `sessionId`) | ACTIVE | Activity | Route generation, local linked Cairns | Trails Activity | session store + lazy local/remote points | session detail/delete | sessions | Rename locally, delete, Save as Route; no privacy/share |
| Route Detail (`MapHistory` with `routeId`) | ACTIVE for own Routes | Route | None retained | Trails Mine Route | own route store | route update/delete/detail | routes | Rename, edit, delete; no Hike/Run action |
| RouteEditor | ACTIVE | Route | source Activity geometry | Activity Detail or Route Detail | route store, route edit store, local route extras | routes detail/create/update/delete; Mapbox match where used | routes, route_edit_envelopes | Smooth/edit/name/privacy/save/delete |
| Plant | ACTIVE | Cairn creation | Location, privacy, Memory side effect | Home; Hiking; Trails Cairn empty CTA | component draft, marker store, offline marker entities | marker create via queue | markers | Confirm location/content/privacy, create, Marker Detail |
| MarkerDetail | ACTIVE for own Cairns | Cairn | privacy; Memory wording | Trails Mine; Plant success | own marker store | marker update/delete | markers, marker_votes | Edit, change privacy, delete; no Activity/Route link |
| Friends | ACTIVE | Friend/request/block | profile statistics | Home Tools | friend store | friends/request/block/profile endpoints | users, friends, friend_requests, blocked_users | Add/accept/decline/cancel/remove/block/unblock |
| Memory | ACTIVE | Fog/exploration | Cairns, Mystery Cairns, Friends, subscription | Home Tools | memory, H3, memory settings, marker, subscriptions, entitlement | memory sync; circle fog; subscriptions; public markers | memory_points, unlocked_regions, memory_subscriptions, markers | Mine/Friends scope, friend picker, paywall, inspect pins, reset via Settings |
| PaywallSheet | ACTIVE trigger, PARTIAL entitlement | Subscription | Memory subscriptions | Sixth friend selection in Memory | entitlement store + IAP service | RevenueCat SDK; subscription API remains separately capped | users.account_type, memory_subscription_limit | Purchase/restore/dismiss; purchase does not update server cap |
| Settings | ACTIVE | Settings/account | Memory, privacy-adjacent preferences, subscription/debug | Home Tools | settings stores, app, memory/marker/session statistics | profile, password, export, account delete/restore; dormant push prefs | users, data_exports, push prefs | Edit profile/password, preferences, export, reset Memory, delete, sign out, hidden Debug unlock |
| Onboarding modal | ACTIVE conditional | Account lifecycle | Hike/Run/Plant/Memory education | Authenticated root when per-user/server flag incomplete | local flag + app user | onboarding completion | users.onboarding_done_at | Complete/dismiss flow |
| Offline banner | ACTIVE global overlay | Connectivity | All domains | Root app shell | network state | health/reachability indirectly | none | Informational only |

## Authentication and account recovery

| Surface | Status | Primary domain | Entry / owner | APIs | Consequences |
|---|---|---|---|---|---|
| Auth landing / sign in | ACTIVE | Account/session | Logged-out root, app/auth state | login, Apple auth, token issuance | Establishes local JWT and hydrates domain stores |
| Create account | ACTIVE | Account | Auth | register + verification | Creates user pending verification, then active session |
| Email verification | ACTIVE | Account | Registration | verify/resend | Activates account |
| Forgot/reset password | ACTIVE | Account security | Auth | password-reset request/verify | Password hash update, token-version bump |
| Google sign-in control | PARTIAL | Account | Auth | backend Google route exists | Client reports configured build is required; not a normal successful local flow |
| Pending-deletion restore modal | ACTIVE | Account lifecycle | Login response hint | `/api/auth/account/restore` | Clears soft deletion and revokes older token versions |
| Session-expired handling | ACTIVE | Auth recovery | Authenticated fetch / hydration | refresh/login | Returns user to authentication without deleting server data |

## Sheets, modals, and nested actions

| Surface | Status | Domain | Host | Authority / result |
|---|---|---|---|---|
| Route picker | ACTIVE but semantic effect PARTIAL | Route → Activity | Hiking, Running | screen-local selection; does not reach tracking/session save |
| Unfinished Activity recovery | ACTIVE in local HEAD; production OTA lacks Running parity | Activity | Hiking and Running | shared JSONL recovery adapter; restore or discard |
| Too-short Activity decision | ACTIVE | Activity | Hiking/Running completion | keeps live recording or discards |
| Save-loss Retry/Discard | ACTIVE in local HEAD for both modes | Activity recovery | Activity screens | durable SAF-01 payload |
| Completion summary | ACTIVE | Activity | Hiking/Running | locally saved Activity; navigation to history/details |
| Hiking Cairn sheet / delete confirmation | ACTIVE | Cairn | Hiking | local Activity-linked marker display where IDs exist |
| Friend profile / add / destructive confirmations | ACTIVE | Friend | Friends | API mutations with Friends-store optimistic rollback |
| Memory friend picker | ACTIVE | Fog sharing | Memory | manages separate Memory subscriptions |
| Mystery Cairn / Mark detail sheets | ACTIVE / PARTIAL | Cairn discovery | Memory | own/public pins; friend-marker feed is not included in active Memory marker input |
| Account delete confirmation / restore | ACTIVE | Account lifecycle | Settings/Auth | soft delete and restore |

## Non-ordinary surfaces

| Screen / path | Classification | Why it is not ordinary current product |
|---|---|---|
| Debug | **FACT — DEBUG ONLY, hidden but production-shipped** | Reachable only after five taps on Settings About/version; exposes logs/simulator/backend diagnostics. It is not guarded by `__DEV__`. |
| Friends/Home/Hiking/Running/Routes preview screens | **DEV / QA ONLY** | Navigator registrations are guarded by `__DEV__`; generated reference UI. |
| MarkDetail preview, transient contract preview, component lab, icon sheet | **DEV / QA ONLY** | Test/review harness registrations are guarded by `__DEV__`. |
| Web `__cairnStores` bridge | **DEV / QA ONLY** | `Platform.OS === 'web'`; exposes navigation/stores for Playwright. |
| `MapHistory` without `sessionId`/`routeId` | **DORMANT / FUTURE / LEGACY COMPETITION** | Contains an older combined history/index implementation, but current product callers pass a detail ID or enter Trails instead. |
| Route-following overlays/voice/off-route UI | **DORMANT / FUTURE** | Components/hooks/tests exist; active screens never set/call the following owner. |
| Bottom-tab navigator interpretation | **LEGACY / UNUSED — CONFIRMED** | RootNavigator explicitly uses Home + stack; no active bottom-tabs component. |

## Reachability conclusions

- **FACT:** File presence was not treated as product reachability; active status was proven through RootNavigator plus incoming navigation calls and controlled Expo Web mounting.
- **FACT:** Friends Activities and public Activities do not exist as active product surfaces or APIs.
- **FACT:** Public Route/Cairn rows can appear only through server seed/discovery behavior; client create/update accepts only personal/friend.
- **FACT:** The only active saved-Route creation entry is an Activity detail. The only Route reuse entry is the pre-start picker, whose chosen identity is currently discarded at the tracking boundary.
