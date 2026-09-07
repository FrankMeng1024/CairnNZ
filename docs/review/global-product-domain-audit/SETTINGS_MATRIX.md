# Settings matrix

Most app settings are device-local in `cairn_settings`; Memory settings use `cairn:memorySettings:v2`. **FACT:** there is no global server-authoritative settings model for these fields. `prefs`/push preference tables cover different backend concerns.

## User-visible preferences

| Setting | Default | Storage | UI entry | Active consumers / real effect | Status |
|---|---|---|---|---|---|
| Appearance | `auto` | `cairn_settings` | Settings → Preferences | `useVisualTheme` and scenic-time mapping choose Auto/Day/Sunset/Night visual family across active screens | **FACT — ACTIVE** |
| Units | `metric` | `cairn_settings` | Settings → Preferences | distance, elevation, pace/speed formatters across Home/Activity/Trails/details | **FACT — ACTIVE** |
| Date format | `dmy` | `cairn_settings` | Settings → Preferences | shared date formatter in some history/profile paths | **FACT — PARTIAL:** several screens still format dates independently |
| Haptic feedback | `true` | `cairn_settings` | Settings → Preferences | gates haptic selection/interaction calls | **FACT — ACTIVE** |
| Show exploration percent | `true` | `cairn_settings` | Settings → Preferences | controls percentage/swap affordance on Home; does not change Memory data | **FACT — ACTIVE** |
| Memory always-on GPS (`foregroundAutoUnlockEnabled`) | `true` | `cairn:memorySettings:v2` | Settings → Preferences | starts foreground location watcher/cache while app is open | **FACT — PARTIAL:** watcher does not itself write/unlock Memory despite visible copy |
| Edit name | current account value | React local state → server | Settings → Profile | PATCH profile; updates user state | **FACT — ACTIVE** |
| Change password | none | React local state → server | Settings → Profile | validates current/new password, changes hash, updates token authority | **FACT — ACTIVE for password accounts** |
| Export my data | none | server job | Settings → About & Legal | queues export; background builder/email path | **FACT — ACTIVE** |
| Reset my map memory | destructive typed confirmation | server + local stores | Settings → Danger zone | deletes Memory points and clears local Memory/H3; does not delete Activities/Cairns/Routes | **FACT — ACTIVE** |
| Delete account | destructive typed confirmation | server `deleted_at` | Settings → Danger zone | soft-deletes, revokes current token/push, then cron hard-deletes | **FACT — ACTIVE; production grace is unsafe test-mode** |
| Sign out | n/a | clears auth/local slices | Settings | clears user/session/marker/memory in-memory state, detaches sync, sets logout marker, resets RevenueCat user | **FACT — ACTIVE** |

## Hidden or persisted app settings

| Setting | Default | Storage / UI entry | Consumer and real effect | Status |
|---|---|---|---|---|
| Map layer | `outdoors` | `cairn_settings`; no ordinary visible picker found | maps choose outdoors vs satellite style | **FACT — ACTIVE CONSUMER, HIDDEN CONTROL** |
| `nightMode` | `false` | `cairn_settings`; no current control | superseded by `appearance`; retained for migration/legacy mechanics | **FACT — DORMANT / LEGACY** |
| Voice guidance | `true` | `cairn_settings`; no visible control | only dormant route-following/voice code | **DORMANT / FUTURE** |
| Off-route threshold | `50m` | `cairn_settings`; no visible control | only dormant route-following hook/banner/voice | **DORMANT / FUTURE** |
| Memory record mode | `always` | Memory settings; no visible control | documented values exist; no active mutation boundary uses it to distinguish `always`/`session-only` | **FACT — DORMANT** |
| Show friend overlay | `true` | Memory settings; no visible control | no active consumer; Memory scope controls friend rendering separately | **FACT — DEAD** |
| Memory first visit done | `false` | Memory settings; internal first-visit surface | hides first-visit education after dismissal | **FACT — ACTIVE INTERNAL** |
| H3 Fog kill switch | `true` | Memory settings; no ordinary UI | suppresses Fog layer when false; debug escape hatch | **FACT — ACTIVE HIDDEN / DEBUG** |

## Hidden Debug and telemetry settings

The Developer section is unlocked by five taps on the About Cairn row. **FACT:** this path is shipped because `Debug` is not `__DEV__`-guarded, although its purpose is debug/testing.

| Setting | Default | Storage / UI | Consumer | Status |
|---|---|---|---|---|
| Debug mode | `false` | `cairn_settings`; five-tap unlock then Developer toggle | enables debug logger and simulator/walker automatically; exposes Developer row | **FACT — DEBUG ONLY, production-shipped hidden path** |
| Debug annotation FAB | `true` | settings; Developer/Debug | on-device annotation workflow | **FACT — DEBUG ONLY** |
| Telemetry upload | `true` | settings; Developer/Debug | debug JSONL/telemetry sender | **FACT — DEBUG ONLY** |
| Telemetry Wi-Fi only | `false` | settings; Developer/Debug | limits debug telemetry transport | **FACT — DEBUG ONLY** |
| Telemetry backend URL | empty | settings; Developer/Debug | overrides debug backend endpoint | **FACT — DEBUG ONLY** |
| Telemetry API key | empty | settings; Developer/Debug | debug upload authentication | **FACT — DEBUG ONLY** |
| Simulator active/location | off until debug | simulator store; debug path | injects synthetic GPS and Home relocation | **FACT — DEBUG ONLY** |

## Notification preferences

| Setting | Default/source | UI | Real effect | Status |
|---|---|---|---|---|
| Friend request push | backend preference capability | Settings code behind `false && pushPrefs` | would gate enqueue/delivery; registration and enqueue are disabled | **DORMANT / FUTURE** |
| Marker reply push | same | hidden by hardcoded false gate | no active marker-reply event flow | **DORMANT / FUTURE** |
| Memory hit push | same | hidden | no active event producer | **DORMANT / FUTURE** |
| Announcements push | same | hidden | backend preference/table capability only | **DORMANT / FUTURE** |

## Feature flags and rollout controls

| Flag/path | Default / source | Current effect | Classification |
|---|---|---|---|
| Route edit mode | local static default `true`; optional AsyncStorage override | enables current Route editor capabilities | **FACT — ACTIVE LOCAL FLAG** |
| Midpoint editing | local static default `true` | controls active editor tool | **FACT — ACTIVE LOCAL FLAG** |
| Corridor threshold | local static value `1000` | editor/routing behavior | **FACT — ACTIVE LOCAL CONFIG** |
| Backend remote flags | routes/schema remnants only | active client no longer fetches remote rollout state | **LEGACY / UNUSED — CONFIRMED** |
| `__DEV__` navigator gates | build constant | exposes generated previews/component labs | **DEV / QA ONLY** |
| Web store bridges | `Platform.OS === 'web'` | lets Playwright mutate stores/navigation | **DEV / QA ONLY** |
| Generated preview state query params | preview routes | review fixtures only | **DEV / QA ONLY** |

## Removed or orphaned preference keys

**LEGACY / UNUSED — CONFIRMED:** `tripSharing`, `voiceBroadcasts`, `dangerAlerts`, `routeDeviation`, `broadcastEnabled`, `soundEffects`, `edgeWarningGlow`, `shareAfterAdd`, and `locationShare` are explicitly stripped on hydration. Old stored keys may remain on devices only until migration runs; they have no current consumer.

## Contradictions

- **FACT — HIGH:** Settings account-deletion UI reads the server deadline correctly, but deployed server code is explicitly marked five-minute test-mode, not its documented seven-day launch target.
- **FACT — MEDIUM:** “Memory always-on GPS” copy promises map filling/unlocking; the active consumer only obtains/caches a foreground position.
- **FACT — MEDIUM:** Paywall messaging promises unlimited Memory/fog and broader sharing, while server `memory_subscription_limit` remains five and no entitlement reconciliation exists.
- **FACT — LOW:** `mapLayer` has a real consumer but no ordinary visible setting; voice/off-route have persisted settings but only dormant consumers.
- **FACT — LOW:** Notifications have both UI implementation and backend infrastructure, but the UI is hard-disabled and producers/registration are commented out.
