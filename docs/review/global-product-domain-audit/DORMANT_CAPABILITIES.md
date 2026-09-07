# Dormant and hidden capabilities

“Implemented” here does not mean active. Each row identifies why ordinary current users do not receive the capability.

| Capability | Implementation maturity | Current status | Why not ordinary active flow | Dependencies | Future relevance |
|---|---|---|---|---|---|
| Route following | Store field, `RouteFollower`, hook, overlays, tests and map calculations exist | **DORMANT / FUTURE** | No active screen calls `useRouteFollowing` or sets `followingRouteId`; Route selection remains screen-local | Persistent Route → Activity relation, foreground/background policy, device map QA | Central to planned reusable Route loop, but must not be inferred active |
| Off-route detection | Threshold setting, geometry utilities, banner/voice logic in dormant following stack | **DORMANT / FUTURE** | Same missing caller/owner as Route following | Route geometry delivery, GPS error policy, safety/product research | High future navigation relevance |
| Voice guidance / turn cues | Expo Speech integration, `voiceGuidance`, waypoint models | **DORMANT / FUTURE** | No active navigation session invokes it; no visible setting | Guidance design, interruption/audio/background behavior, route-following activation | Optional future navigation layer |
| Waypoint announcements/editing | Waypoint fields and route model remain | **DORMANT / FUTURE / PARTIAL** | Store mutators were removed for zero callers and current editor does not provide a completed waypoint workflow | Route editor/product rules | Future planned-route utility |
| Route run count | DB/model field and display data exist | **DORMANT / FUTURE** | Client increment caller was removed; saved Activity retains no Route ID | Route → Activity provenance and idempotent completion mutation | Useful recurrence metric after relationship exists |
| Public Route creation | DB permission enum/query paths | **DORMANT / FUTURE** | Client UI/type restricts personal/friend and backend rejects client public writes | Moderation/discovery/privacy policy | Potential discovery, not current capability |
| Public Cairn creation | Marker schema/public snapshot/votes/report capability | **DORMANT / FUTURE / PARTIAL** | Plant public option is disabled; API rejects client public writes; only seed/existing public rows can appear | Moderation, safety, identity/privacy | Potential shared discovery |
| Public Cairn interaction | Nearby silhouettes, reveal, votes/report tables/routes | **PARTIAL / DORMANT** | Friend markers are omitted from active Memory marker input; stranger markers are intentionally blurred/noninteractive; hide handler is no-op | Clear reachability and moderation UX | Could support community trail knowledge |
| Voice Cairn/media | Voice fields/components and dev preview traces | **DORMANT / FUTURE** | Active Plant passes no persistent voice content; backend Marker does not own a media upload lifecycle | Storage, consent, upload/offline, moderation | Product decision required |
| Push notifications | Expo notifications service, backend device/pref/log tables, drain/purge cron | **DORMANT / FUTURE** | registration/unregistration and friend enqueue call sites are commented; Settings section is hard-disabled | Provider credentials, consent UI, event policy, delivery testing | Friend/request and safety notifications later |
| Paid Memory entitlement | RevenueCat purchase/restore/cache and PaywallSheet | **PARTIAL / DORMANT EFFECT** | purchase success does not change backend `memory_subscription_limit`; `hasProEntitlement` has no feature-gate caller | Provider dashboard, webhook/server reconciliation, product limits | Must be repaired before monetization claims |
| Google sign-in | Backend token verification and client control | **PARTIAL** | client reports a configured build is required in current flow | Native OAuth configuration and device validation | Account-access expansion |
| Unparameterized MapHistory | Large combined history/index implementation | **DORMANT / FUTURE / LEGACY COMPETITION** | active callers use Trails or pass Activity/Route IDs | Decision to delete/migrate/repurpose; no action in this audit | Low unless adopted as a unified map history surface |
| Map layer picker | real persisted `mapLayer` and map consumers | **HIDDEN ACTIVE SETTING** | no ordinary visible Settings entry found | Product visibility decision | Useful map preference; not a dormant map engine |
| Memory H3 kill switch | persisted `useH3Fog` controls Fog layer | **HIDDEN DEBUG** | no ordinary UI | Diagnostics only | Operational escape hatch |
| Memory record mode | persisted `always/session-only` | **DORMANT** | no active behavior branches on it | Define foreground exploration policy | Relevant to privacy/battery policy |
| Friend overlay setting | persisted boolean | **DEAD** | no active consumer; scope UI governs rendering | Remove or implement later | Low until sharing model fixed |
| Remote feature flags | historical backend/schema concepts | **LEGACY / UNUSED — CONFIRMED** | active flag service uses static local defaults/overrides | New rollout infrastructure if ever needed | None currently |
| Offline map regions | historical/deleted service references | **LEGACY / UNUSED — CONFIRMED** | no active download/manage surface or owner | Mapbox license/SDK product research and storage UX | Important only for future navigation safety |
| Debug/simulator | full hidden screen, logs, GPS injection, telemetry inputs | **FACT — DEBUG ONLY, production-shipped** | five-tap unlock; purpose is testing, not normal product | Remove/restrict before store release as appropriate | QA only |
| Generated preview families | spec-generated screens and state gates | **DEV / QA ONLY** | `__DEV__` navigator registration | Development build | Visual review only |
| Web QA bridge | direct navigation/store/file queue bridge | **DEV / QA ONLY** | web-only platform guard | Expo Web | Automated audit/testing only |

## Dependencies that must precede navigation activation

1. **FACT:** selected Route ID and full geometry must enter the shared tracking boundary and persist to `sessions.route_id`.
2. **FACT:** production must have the intended Route/session referential behavior or an explicit replacement policy.
3. **HUMAN INTENT:** each reuse must create a new Activity; Route must remain independently editable.
4. **UNKNOWN:** whether navigation follows a snapshot of Route geometry or live edited geometry after Activity start.
5. **UNKNOWN:** product thresholds, voice defaults, waypoint behavior, lock-screen/battery policy, and NZ outdoor safety expectations need explicit decisions/research.
6. **FACT:** dormant hooks must not be made active merely by wiring the existing `selectedRoute`; current tests do not establish user-ready native behavior.
