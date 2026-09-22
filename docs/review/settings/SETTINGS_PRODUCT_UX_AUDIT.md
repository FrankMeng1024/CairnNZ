# CairnNZ Settings Product / UX Audit

**Status:** audit authority only. No Settings, preference, navigation, backend, Activity, O55 simulator, or shared visual-system implementation was changed.

**Evidence date:** 2026-09-13  
**Current client marker observed:** O55  
**Primary implementation inspected:** `app/src/screens/SettingsScreen.tsx`, the Settings/Memory stores, every located consumer, account/data endpoints, native/OS permission paths, Debug/O55 gates, current visual authority, and retained production-domain evidence.

Implementation maturity terms in this document are `COMPLETE`, `PARTIAL`, `BROKEN`, `DEAD`, `LEGACY`, and `DEBUG-ONLY`. Necessity terms are `ESSENTIAL`, `USEFUL`, `OPTIONAL`, `INTERNAL`, `REDUNDANT`, `LOW VALUE`, and `HARMFUL`.

## Settings in one sentence

Settings should own the few enduring, app-wide choices a Cairn user needs about their account, privacy and data, units, appearance, and interaction—not feature state, progress, contextual map controls, or implementation/QA tuning.

The user job is: **“Let me control the durable things about my account and how Cairn behaves everywhere, understand what happens to my data, and get help.”**

## Complete current inventory

### Normal signed-in surface

| Setting | Current user-facing label | What it actually changes | Where stored | Works fully? | User value | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| Account identity | Name, email, “Member for … days” | Read-only rendering from the authenticated user object | Server user record, hydrated into app state | COMPLETE | USEFUL context, but not itself a setting | MOVE to Account detail |
| Profile name | Edit name | Validates 1–32 characters, PATCHes `/api/auth/me`, then updates the local user | Server user name + current app state | COMPLETE | ESSENTIAL account maintenance | KEEP under Account |
| Password | Change password | PATCHes `/api/auth/password`; existing-password accounts require current password; successful change signs the user out | Server password hash/token version | PARTIAL | ESSENTIAL for password accounts | REDEFINE under Account |
| Progress statistic | places explored | Fetches `/api/auth/stats`; falls back to local Memory point count | Server-derived response; local fallback | PARTIAL | REDUNDANT; progress, not a setting | MOVE |
| Progress statistic | cairns planted | Fetches `/api/auth/stats`; falls back to local owned-Cairn count | Server-derived response; local fallback | COMPLETE as a count | REDUNDANT; progress, not a setting | MOVE |
| Progress explanation | “How is progress calculated?” | Opens explanatory modal | Ephemeral screen state | BROKEN semantically: copy says unique ~25 m cells while the server count is Memory rows | REDUNDANT | MOVE, then correct metric/copy |
| Passive exploration | Record exploration outside activities | While Cairn is foregrounded, signed in, and no Activity is active, starts the app-level passive recorder and commits eligible evidence to Memory | `cairn:memorySettings:v2.foregroundAutoUnlockEnabled` in local AsyncStorage | PARTIAL: real recorder exists, but enabling does not request permission or surface unavailable status | ESSENTIAL privacy/product choice | KEEP / POLISH |
| Units | Units — Metric / Imperial | Changes shared distance/elevation/pace formatting in many Activity, Route, History, and voice paths | `cairn_settings.units` in local MMKV | PARTIAL: some Home and other date/distance renderers bypass it | ESSENTIAL | KEEP / POLISH |
| Date presentation | Date format — DMY / MDY / YMD | Changes consumers of the shared date formatter | `cairn_settings.dateFormat` in local MMKV | PARTIAL: several screens use locale formatting directly despite “across the app” copy | LOW VALUE as a separate preference | SIMPLIFY / REMOVE |
| Interaction | Haptic feedback | Centrally gates haptic selection/impact/notification calls; enabling previews the effect | `cairn_settings.hapticFeedback` in local MMKV | COMPLETE | USEFUL | KEEP |
| Home display | Show exploration % | Shows/hides the Home exploration-percent swap affordance; disabling first opens a demo | `cairn_settings.showExplorationPercent` in local MMKV | COMPLETE | USEFUL but local to Home | MOVE to Home |
| Appearance | Appearance — Auto / Day / Sunset / Night | Sets the product-wide scenic time mode; Auto derives current scenic state from time/solar context | `cairn_settings.appearance` in local MMKV | COMPLETE | USEFUL | KEEP / POLISH |
| Release notes | What's new | Opens the bundled changelog modal | Static client constant | BROKEN: row says current O55, bundled entries stop at O35 | LOW VALUE unless maintained | REDEFINE or REMOVE |
| Weather utility | Check the weather | Opens MetService Rural in the browser | Nothing | COMPLETE as a link | LOW VALUE in Settings | MOVE or REMOVE |
| Feedback | Send feedback | Enqueues text through the diagnostic logger and best-effort uploads screenshots | In-memory logger queue; server diagnostic/snapshot storage if delivery succeeds | BROKEN: success is shown without delivery acknowledgement; screenshot failures do not fail the send | ESSENTIAL job, unsafe implementation | REDEFINE |
| Feedback subtype | Feedback | Labels diagnostic payload `feedback` | Same as above | BROKEN delivery contract | USEFUL | REDEFINE |
| Feedback subtype | Safety report | Labels diagnostic payload `safety`; placeholder includes “emergency” | Same as above | BROKEN/HARMFUL: no monitored safety/emergency contract or delivery guarantee | HARMFUL | REMOVE until a real contract exists |
| Feedback subtype | Bug | Labels diagnostic payload `bug`; can attach screenshots | Same as above | BROKEN delivery contract | USEFUL for support/QA | REDEFINE |
| Privacy | Privacy Policy | Opens the backend-hosted privacy page | Nothing | COMPLETE as a link; policy is materially out of sync | ESSENTIAL | KEEP, correct contract first |
| Terms | Terms of Service | Opens Apple’s standard EULA | Nothing | PARTIAL: link works, but copy advertises unfinished Cairn-specific terms | ESSENTIAL legal access | KEEP / REDEFINE |
| App information | About Cairn | Shows native version + O marker; five taps persistently unlock Developer tools | Client version/constants + `debugMode` | PARTIAL as About; hidden behavior is inappropriate ownership | USEFUL About, INTERNAL unlock | SPLIT: keep About, remove unlock |
| Data right | Export my data | POSTs an export job request and promises an emailed 24-hour download link | Server `data_exports` job/file + email | PARTIAL: no status/history/retry UI; email can be sent before the job is ready | ESSENTIAL | KEEP / REDEFINE |
| Memory deletion | Reset my map memory | Requires typing `reset memory`; server transaction deletes Memory points and `unlocked_regions`, then local Memory/H3 state is cleared | Server + per-user local Memory stores | COMPLETE for the requested Memory scope; safely refuses offline rather than creating split truth | ESSENTIAL data control | KEEP, rename precisely |
| Account deletion | Delete account | Requires typing `delete account`; soft-deletes account, revokes current token/push, logs out, then cron hard-deletes after grace | Server user state and related FK cascades | BROKEN/HARMFUL in deployed contract: five-minute test grace; production `unlocked_regions` lacks delete cascade | ESSENTIAL right, P0 implementation | KEEP / REDEFINE |
| Session action | Sign out | Confirms, revokes/clears auth best-effort, suspends identity-owned runtime state, clears in-memory user slices | Secure auth/local runtime; durable per-user records remain | PARTIAL: action works, but active-Activity copy says recording is discarded while current O54 ownership preserves durable recovery | ESSENTIAL | KEEP under Account |

### Hidden Developer surface reachable from normal Settings

| Setting | Current user-facing label | What it actually changes | Where stored | Works fully? | User value | Keep? |
| --- | --- | --- | --- | --- | --- | --- |
| Secret unlock | Five taps on About Cairn | Enables persistent Debug mode and exposes Developer section | `cairn_settings.debugMode` | DEBUG-ONLY | INTERNAL | HIDE from normal Settings |
| Debug authorization | Debug mode | Enables internal logging/tool visibility and authorizes Debug/O55 controls where build capability exists | `cairn_settings.debugMode` | DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| O55 simulator gate | Activity Simulator | Selects the explicit simulated Activity source when supported and permitted | Per-user simulator AsyncStorage + runtime source ownership | DEBUG-ONLY | INTERNAL | DEBUG ONLY; do not move into user settings |
| Debug navigation | Open Debug screen | Opens the internal diagnostics screen | Navigation state | DEBUG-ONLY | INTERNAL | DEBUG ONLY |

### Controls inside the gated Debug screen

These are not visible to an ordinary user until the About gesture unlocks them, but they are part of the Settings-accessible control graph and therefore part of this audit.

| Internal item | Actual behavior / storage | Maturity | Necessity | Decision |
| --- | --- | --- | --- | --- |
| Status and environment readouts | Displays debug/runtime/telemetry status | DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| Scenic weather override | Overrides Auto scenery with Auto/Sunny/Cloudy/Rain/Snow | Debug runtime state | INTERNAL | DEBUG ONLY |
| Scenic time override | Overrides scenic time with Auto/Day/Sunset/Night | Debug runtime state | INTERNAL | DEBUG ONLY |
| Activity GPS A/B 5 m / 1 m | Changes persisted Activity GPS distance-filter experiment | `cairn_settings.activityGpsDistanceFilterM`; DEBUG-ONLY | HARMFUL if exposed as a preference | DEBUG ONLY; never normal Settings |
| QA Snap Review clone | Creates a diagnostic Activity/test case | DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| Telemetry upload | Enables diagnostic session upload | `cairn_settings.telemetryUploadEnabled`; DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| Wi-Fi only | Restricts diagnostic upload attempts | `cairn_settings.telemetryWifiOnly`; DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| Annotation FAB | Shows/hides diagnostic annotation control | `cairn_settings.debugAnnotationFabVisible`; DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| Telemetry backend URL | Overrides upload endpoint | `cairn_settings.telemetryBackendUrl`; DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| Telemetry API key | Persisted and consumed by uploader, but no current editing row was found | `cairn_settings.telemetryApiKey`; LEGACY/DEBUG-ONLY | INTERNAL and security-sensitive | remove stale override or restore only in secured QA tooling |
| Retry pending / session upload / export / delete / clear all | Operates on QA telemetry sessions | DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| O55 SIM MODE and diagnostics | Clean Path / Raw GPS, seed, overlays, source-loss and QA controls live in Activity’s debug simulator, not ordinary Settings | DEBUG-ONLY | INTERNAL | Keep in dedicated O55 Debug context |

### Persisted, legacy, dead, and currently hidden preference fields

| Stored/internal field | What it actually does now | Maturity | Necessity | Decision |
| --- | --- | --- | --- | --- |
| `mapLayer` (`outdoors`/`satellite`) | Read by Hiking Map and Map History; no current UI updater was found, so a legacy value can continue invisibly | LEGACY/PARTIAL | REDUNDANT global preference | MOVE map choice in-context, migrate/remove stale global state |
| `nightMode` | No consumer found; superseded by `appearance` | DEAD/LEGACY | LOW VALUE | REMOVE |
| `voiceGuidance` | Read only by dormant `useRouteFollowing`; hook has no runtime caller | DEAD until navigation exists | OPTIONAL future route-session control | REMOVE from normal preference authority |
| `offRouteThresholdM` | Same dormant route-following hook; exposes an algorithm threshold | DEAD | HARMFUL as user preference | REMOVE |
| `recordMode` | Retained Memory diagnostic value; no current product behavior | LEGACY | INTERNAL | HIDE/remove when migration-safe |
| `showFriendOverlay` | Former `MemorySettingsSection` setting; no current consumer | DEAD | REDUNDANT | REMOVE |
| `useH3Fog` | Hidden kill switch consumed by Fog | DEBUG-ONLY | INTERNAL | DEBUG ONLY |
| `firstVisitDone` | Internal education/onboarding state | COMPLETE internal state | INTERNAL, not a preference | Keep internal; never display as setting |
| `MemorySettingsSection` rows | Component has no mounted consumers; contains old Memory stats/clear/friend controls | DEAD/LEGACY | REDUNDANT | Remove after separate code cleanup, not in this audit |
| Friend requests / Cairn activity notification toggles | JSX is hard-gated off; preference fetch is disabled; device token registration is not active | DEAD/PARTIAL product | LOW VALUE until notifications are real | Keep hidden; do not add yet |
| Removed orphan keys (`tripSharing`, `voiceBroadcasts`, `dangerAlerts`, `routeDeviation`, `broadcastEnabled`, `soundEffects`, `edgeWarningGlow`, `shareAfterAdd`, `locationShare`) | Store migration strips them | LEGACY | LOW VALUE/HARMFUL clutter | Do not restore |

### Scale and cognitive load

- The ordinary signed-in page exposes **17 row-style actions plus one four-state Appearance control: 18 actionable controls**.
- It contains **four titled sections** (`Your progress`, `Preferences`, `About & Legal`, `Danger zone`) plus an unlabeled profile card and a separate Sign out card.
- It exposes **three toggles** (passive exploration, haptics, exploration percentage), **two inline selectors** (units, date format), and **one segmented selector** (appearance).
- It exposes **two irreversible/type-to-confirm actions** (Memory reset and account deletion), plus confirmed Sign out.
- Developer unlock adds another section and three controls.
- The page cannot be understood in one scan because identity, achievements, durable preferences, a weather shortcut, support, legal, export, destructive actions, and QA entry all share one long surface.

## Real implementation behavior

### Persistence and ownership

- User preferences in `useSettingsStore` are local, persisted under `cairn_settings`, not synced to the Cairn account. A choice therefore follows the device rather than the account.
- Passive exploration has a separate local store (`cairn:memorySettings:v2`). It is an app-level privacy choice with real Memory consequences, but it is also device-local.
- Account identity, password, exports, Memory deletion, account deletion, and account statistics are server-backed.
- Appearance is genuinely product-wide through the scenic-time/theme authority. Haptics are genuinely centralized through the haptic service.
- The current page still has stale source comments/imports/styles for older Settings concepts. They are code debt, not product authority.

### What labels overpromise

1. **“How dates appear across the app”** is not true. Shared-formatter consumers obey the preference; several Home, Trails, mystery, and account-deadline renderers use locale formatting directly.
2. **“Units — Distance and elevation”** is broadly implemented, including pace, but not universal. Home still has a local kilometre formatter for some Activity cards.
3. **“Places explored”** is presented as unique ~25 m cells, while `/api/auth/stats` counts Memory point rows. The fallback also counts raw local Memory entries.
4. **“Thanks — we got it”** is shown after enqueueing into a best-effort diagnostic logger, not after server acceptance.
5. **“Safety report”** has no monitored safety-response contract. Its placeholder’s mention of “emergency” increases the risk.
6. **“A Cairn-specific [Terms] version is coming”** exposes unfinished legal/product work as permanent Settings copy.
7. **“Latest updates in O55”** opens a changelog whose latest bundled entry is O35.
8. **Delete account’s “before we email our team”** does not describe the implementation. The API schedules deletion and sends confirmation to the user.
9. **Sign out mid-hike “will discard this session”** conflicts with current O54 durable owner-scoped Activity recovery behavior.

### Behavior that is real but incomplete

- Passive exploration records only while the app is open/foregrounded, the user is signed in, and Activity is idle. If foreground location permission is absent, switching it on does not create a permission/status flow; it can look enabled while doing nothing.
- Password change is not provider-aware. The server supports adding a password to an OAuth-only account, but Settings always says “Change password” and always renders “Current password.”
- Export creation is a real server job, but Settings provides no state/history/download affordance even though a history API exists. The backend can send the link email before the export is ready.
- Reset Memory has a bounded and relatively clear contract: server-first deletion of Memory/derived regions, then local clear, without deleting Activities, Cairns, or Routes.
- Account deletion is technically implemented, but the current source and retained production evidence both establish a five-minute **TEST-MODE** restore window. Retained production schema evidence also establishes that `unlocked_regions` lacks a User delete cascade and can orphan after hard deletion.

## Core settings

The enduring user-facing control set should be deliberately short:

1. **Account** — identity summary, name, sign-in method/password appropriate to provider, Sign out, and account deletion behind a secondary detail screen.
2. **Units** — one Metric/Imperial choice; it should consistently cover distance, elevation, speed, and pace.
3. **Appearance** — Auto, Day, Sunset, Night.
4. **Haptics** — one app-wide interaction preference.
5. **Explore while Cairn is open** — the current passive-exploration choice, with permission/status truth and a clear distinction from Hike/Run recording.
6. **Privacy & Data rights** — export personal data and delete exploration history; delete account belongs in Account but shares the same complete data contract.
7. **Help and legal access** — reliable support/feedback, Privacy Policy, Terms, and concise version information. These are Settings-owned destinations, not preferences.

This is the long-term core. Notification categories, cache controls, map rendering choices, GPS tuning, route thresholds, simulator modes, and exploration-product fundamentals do not qualify today.

## Useful secondary settings

- **Account detail:** Edit name; password/add-password flow; eventual email-change decision; Sign out; Delete account.
- **Privacy & Data detail:** Explain OS location state, export status/history, delete exploration history.
- **About detail/footer:** version and O marker, Privacy, Terms, acknowledgements/Mapbox attribution where legally required.
- **What’s new:** only if the release process makes current, useful notes reliable. Otherwise a stale release-notes feature is worse than no feature.
- **Offline storage manager:** only after Cairn has explicit user-owned downloads with known size/status/removal semantics. It is not justified by today’s automatic caches.

## Debug/internal items

The following belong exclusively to explicit QA tooling:

- O55 `Clean Path | Raw GPS`, simulator source enablement, seed, truth/raw/live overlays, and synthetic source loss.
- Debug mode, Debug-screen navigation, telemetry inspection/upload/retry/export/delete.
- GPS distance filter/A-B controls, stationary/canonical/smoothing thresholds, Mapbox confidence, pace windows, and any other Activity algorithm knob.
- Scenic weather/time overrides.
- Diagnostic annotation controls, endpoint/API-key overrides, internal environment information, and O-marker unlock behavior.
- Fog implementation kill switches such as `useH3Fog`.

The build/runtime can retain these for QA, but normal Settings must not be their discoverability or authorization boundary. “Five taps on About” mixes a legitimate About row with a persistent internal entitlement and should not survive.

## Redundant items

- **Your progress** duplicates stronger owners in Home, Memory, Profile, and Trails and displaces actual preferences.
- **Show exploration %** controls one Home affordance and should be owned by Home.
- **Weather** is contextual to deciding/starting an Activity, not an enduring app preference.
- **Global map layer** overlaps individual map contexts and is already inconsistently consumed.
- **Date format** duplicates device locale behavior and is incomplete. Locale should be the default authority unless explicit user research proves override value.
- **Notification toggles** would duplicate OS permission while no complete notification product exists; they are correctly hidden for now.
- **OS location permission** should not be represented as a Cairn toggle. Settings may explain and deep-link; only iOS can grant/revoke it.
- **Cairn visibility** remains a Plant/object decision; no evidence supports a global privacy default today.

## Low-value items

- A standalone external weather link in Settings.
- A manual date-order preference with incomplete coverage.
- “Member for X days” in Settings; harmless, but it is profile context rather than control.
- Technical version/OTA metadata as a full row; a concise About/footer treatment is enough.
- A large release-notes modal if it is not maintained release by release.
- Generic cache clearing, pending-sync toggles, battery/GPS precision choices, or a catalogue of notification switches.

## Broken settings

### P0 — false feedback and safety delivery

`SettingsScreen` calls `log('user_feedback', ...)`, whose public contract is an in-memory best-effort queue. It does not await server delivery, has no durable support retry/receipt, and Settings immediately says **“Thanks — we got it.”** Attachment upload is also best-effort; `attachments_ok` can be lower than requested without changing success. The payload includes the user’s name, email, and free text even though the diagnostic logger’s privacy guidance says to avoid PII; the diagnostic endpoint is optional-auth and this call does not establish an authenticated support case.

**Decision:** Keep the user job, not this implementation. Build a reliable authenticated support/feedback contract with acknowledgement and explicit failure. Remove “Safety report”/“emergency” language until a monitored, time-bounded safety channel exists; Cairn must never imply it is emergency response.

### P0 — unsafe account-deletion contract

`backend/src/routes/auth.js` defines `RESTORE_GRACE_MS = 5 * 60 * 1000` and labels it TEST-MODE. The sweep uses the same minute-based value. Retained production verification in `docs/review/global-product-domain-audit/` confirms that production runs this five-minute grace and that production `unlocked_regions` has no User foreign-key cascade.

**Decision:** Account deletion must remain available, but it is not product-ready until the real restore/retention contract replaces test mode and deletion coverage is proven for every owned/derived record. Settings copy must describe the actual server contract, not a generic “permanent” flow.

### P0 — privacy explanations do not match behavior

The backend privacy page says diagnostics are tied to an account only when opted in through Settings, yet the app-wide diagnostic logger is not gated by a clear normal-user consent and feedback explicitly adds name/email/text. The policy says account email can be edited, but no email-edit function exists. Its export and deletion descriptions do not match the current in-app job and scheduled-deletion flows. Auth-screen privacy copy says GPS is used only when a user starts tracking, while the user can now opt into foreground passive exploration outside Activities.

**Decision:** Establish one current privacy authority across app and web. Correct collection, identity, retention, passive-location, export, and deletion statements before visual redesign.

### Other broken/partial controls

- Passive exploration can appear on but remain unavailable for lack of location permission.
- “Places explored” explanation does not match the counted quantity.
- What’s New claims O55 but stops at O35.
- Units and date formatting are not app-wide despite their labels.
- Change Password is not adapted to password vs OAuth identity.
- Export has no job readiness/status/recovery surface.
- Terms explicitly advertises an unfinished Cairn-specific document.
- Sign-out-during-Activity copy contradicts current durable recovery.
- A hidden persisted `mapLayer` can keep affecting two screens without any current way to change it.

## Missing high-value controls

Only four gaps clear the “real user job” threshold:

1. **Provider-aware Account detail.** Show enough sign-in-method context to render `Change password` or `Add password` truthfully. Do not invent account linking/switching.
2. **Email maintenance decision.** Email is primary account identity and policy says it is editable, but the app has no change flow. Product/security must choose either a verified change-email contract or explicitly read-only identity with support recovery.
3. **Passive-location status.** The user needs to know whether “Explore while Cairn is open” can actually operate and how to open iOS Settings if permission is unavailable. This is explanation/status, not a duplicate permission toggle.
4. **Reliable support and data-job status.** Feedback needs a delivery receipt; data export needs queued/processing/ready/failed state and an available download/retry path.

Potential offline-download management does **not** yet clear the bar. It should be revisited only when Routes/Trails have explicit downloadable regions, known storage size, status, and removal behavior.

## Settings vs contextual controls

| Current/future choice | Correct owner | Reason |
| --- | --- | --- |
| Units, appearance, haptics | Settings | Enduring and app-wide |
| Passive exploration outside Activities | Settings → Privacy & Data | Enduring app behavior with privacy consequences |
| Exploration % affordance | Home | Only changes Home presentation |
| Progress / places / Cairns counts | Home, Profile, Memory, or Trails | Product state, not configuration |
| Weather | Home or Hike/Run start context, if retained | Relevant when deciding to go out |
| Map style/layer, north-up, follow, labels | The active map | Task/session context; camera follow is transient state |
| Route-specific guidance and off-route behavior | Route/Activity session | Only meaningful while following a route; algorithm thresholds stay internal |
| Cairn visibility | Plant/object editor | Object-specific privacy decision |
| Offline map download | Route/Trail/map context | The user chooses a place/route to make offline, not an abstract cache |
| Pending sync | Contextual status surface | System truth, not a preference |
| OS permissions | iOS Settings, explained/deep-linked by Cairn | Cairn cannot enforce an OS toggle |
| Simulator, GPS logs, diagnostics | Dedicated gated Debug/QA | Internal verification, never normal product preference |

## Privacy/location

- **Keep:** the app-level opt-in to foreground passive exploration. Rename toward the actual contract, e.g. “Explore while Cairn is open,” with concise explanation that Hikes/Runs record independently.
- **Do not add:** GPS accuracy, update distance, background-mode, stationary threshold, smoothing, matching, pace, or battery controls. Those are Cairn product responsibilities.
- **Do not duplicate iOS:** Settings can display permission state and offer “Open iOS Settings,” but must not render a fake permission toggle.
- **Clarify foreground/background:** the passive recorder is foreground-only; active Hike/Run background recording is a separate, in-context permission/job.
- **Keep object privacy contextual:** Cairn/Plant visibility stays with creation/editing. A global visibility default would be a new privacy product decision without evidence.
- **Fix disclosure:** analytics/diagnostics and support payload identity must be documented and controlled consistently. Debug telemetry preferences are not a substitute for a normal privacy contract.

## Offline/data

- Local Activity finish, pending sync, bounded caches, and Memory storage are system behaviors; they do not require a catalogue of toggles.
- Sync queues already have contextual status treatments. “Sync now,” “pending sync,” or retry controls should remain in status/error recovery, not global Settings.
- The app silently prewarms broad Mapbox regions. That is worth a later storage/energy audit, but there is no complete user-owned offline-download product to expose in Settings today.
- Route/Trail-specific “Download for offline” would be the correct first product, because it gives the choice a place, size, purpose, and deletion scope.
- **Keep data rights:** export account data and delete exploration history. Their contracts must show real server state and precise scope.
- **Do not add generic Clear cache/Reset app/Clear Activities.** A destructive action without a complete local/server/offline contract is not acceptable.

## Account

Account belongs in Settings, but its editing forms should not dominate the root page.

- Root row: avatar/name/email summary with a chevron to Account.
- Account detail: name; email; sign-in method; provider-aware Add/Change password; Sign out.
- Bottom, clearly separated: Delete account with exact data scope, actual restore deadline, and recovery contract.
- Do not invent account switching or connected-service management. The backend exposes provider information only insofar as it can make password UI truthful.
- Decide email change explicitly. Current policy/product mismatch cannot remain implicit.
- Fix active-Activity Sign out copy using Activity authority; do not claim discard when durable recovery is retained.

## Appearance

Manual control is justified because Day/Sunset/Night materially changes Cairn’s visual atmosphere, while Auto remains the recommended owned behavior. Keep one product term—**Appearance**—rather than exposing light/dark implementation concepts. No separate map-theme or `nightMode` setting should exist.

Current visual evidence shows that the main Settings surface belongs to the Home family in Day, Sunset, and Night, with readable scenic veils and cards. The implementation nevertheless diverges internally:

- The screen constructs local cards, rows, inline selectors, segmented control, forms, and modals instead of using canonical `ContentSurface`, `SegmentedControl`, `TextField`, `ModalCard`, and button primitives.
- Numerous hard-coded light colors remain in icons, form fields, chips, badges, and modal styles. Main-screen tokens adapt, but expanded/modal states have weaker Day/Sunset/Night guarantees.
- The visual direction should be preserved. A future redesign should consolidate onto Product-DNA primitives, not invent a new Settings aesthetic.

## Units

One Metric/Imperial setting is sufficient. It should consistently define:

- distance: km/m vs mi/ft;
- elevation: m vs ft;
- pace: min/km vs min/mi;
- speed where shown: km/h vs mph.

Initial default should come from locale/region when product support is ready, then preserve the user’s explicit override. Do not add separate distance, elevation, pace, and speed selectors. Before polish, audit and remove local formatters that bypass the central unit authority.

Date order should default to the device locale. The current three-way date selector adds configuration while still failing to govern the whole app. Remove it unless real user evidence establishes a need for an override; if kept, it must become one complete formatting authority.

## Notifications

No normal notification setting should be added now.

- The visible notification section is correctly hard-disabled because device token registration is not active end-to-end.
- Backend preference tables and a partial friend-request pipeline do not constitute a user-facing notification product.
- iOS owns permission. Cairn categories are justified only once corresponding notification events are real and testable.
- Activity idle/auto-pause local notification behavior belongs to the Activity product contract. Its internal timer or thresholds must not become Settings knobs.
- When notifications ship, show only categories tied to real events, and only after permission/on-device delivery are verified.

## Legal/About

The current `About & Legal` card is not a coherent category: it combines release notes, weather, feedback, legal links, version, and export.

The durable set should be:

- Help & Support (only after reliable delivery);
- Privacy Policy;
- Terms;
- app version/build marker in a quiet About/footer location;
- required Mapbox attribution/licenses/acknowledgements, preferably behind About rather than as root rows.

Move Export to Privacy & Data. Move weather out. Keep What’s New only with a maintained release-note contract. Remove the five-tap Debug unlock from About. Reconcile app/web legal copy before changing presentation.

## P0/P1/P2

### P0 — broken or dangerous behavior

| Finding | Why P0 | Required future action |
| --- | --- | --- |
| Feedback/Safety reports claim receipt without server acknowledgement | A user can reasonably rely on a false delivery claim; “emergency” copy is especially unsafe | Reliable authenticated channel, durable status/receipt, honest failure; remove safety/emergency option until operationally supported |
| Account deletion uses deployed five-minute TEST-MODE grace | Destructive account/data consequence is materially different from intended seven-day language/design | Replace test configuration, verify sweep/restore end to end, make server deadline authoritative |
| Account hard-delete can orphan production `unlocked_regions` | “Delete account” may not delete all account-derived exploration data | Add/verify cascade or explicit transactional cleanup; production schema gate |
| Privacy explanations contradict live data behavior | Users cannot make an informed choice about diagnostics, passive GPS, export, editing, and deletion | One reconciled legal/product data map across app and web |

### P1 — product architecture and truthful ownership

- Passive exploration can be enabled with no permission/status recovery.
- Progress is not Settings content, and “places” semantics are inaccurate.
- Units/date labels claim broader coverage than the implementation.
- Global `mapLayer` remains invisibly active without a control.
- Home-only exploration-percent control is globally located.
- About & Legal mixes unrelated jobs; weather is misplaced.
- What’s New is stale and Terms announces unfinished work.
- Password UI is not provider-aware; email maintenance has no product decision.
- Export lacks visible job state and recovery.
- Sign-out-during-Activity copy contradicts current lifecycle authority.
- A secret About gesture is the authorization/discovery path for production-bundled QA controls.
- Dead/legacy settings retain accidental authority (`nightMode`, route thresholds, friend overlay, record mode, old notification state).

### P2 — visual/cognitive polish

- Eighteen root-level actions create a long, mixed-purpose page.
- Progress cards dominate before preferences.
- Locally built rows, segmented control, forms, chips, and modals diverge from Product-DNA primitives.
- Hard-coded colors make expanded/modal states less robust across Sunset/Night.
- Icon backgrounds/tints, spacing, radii, divider behavior, and form treatments are not fully unified with Home/Friends/Auth/Hike/Run/Plant/Trails.
- Existing Day/Sunset/Night boards validate the overall world, but small/large-phone and expanded/modal state coverage should be part of the future redesign—not this audit.

## What should not survive

Normal Settings should lose progress, contextual Home/map/weather controls, incomplete pseudo-products, hidden implementation thresholds, and every QA/simulator/telemetry control. The explicit removal list follows.

# WHAT SHOULD NOT SURVIVE

The following should disappear from **normal Settings**:

1. Your progress statistics and explanation.
2. The global Show exploration % toggle.
3. Check the weather.
4. The current Date format selector, unless explicit user evidence justifies making it complete.
5. Safety report/emergency wording in the current best-effort feedback form.
6. A stale What’s New row that labels old content as the current OTA.
7. “Cairn-specific Terms coming” placeholder copy.
8. Five-tap About unlock and the Developer section as part of ordinary Settings.
9. All GPS, telemetry, simulator, scenic override, endpoint, API-key, annotation, and QA-session controls from the normal-user graph.
10. Hidden global `mapLayer`, `nightMode`, `voiceGuidance`, `offRouteThresholdM`, `recordMode`, and `showFriendOverlay` as user-preference authority.
11. Any attempt to expose canonical, smoothing, Stationary, Mapbox-confidence, battery, pace-window, or Activity-source implementation choices.
12. Any future generic cache, pending-sync, or notification catalogue until a real user-owned product exists behind each row.

# CORE SETTINGS

The compact long-term set is:

- Account
- Units
- Appearance
- Haptics
- Explore while Cairn is open
- Privacy & Data (export and exploration deletion)
- Help, Privacy, Terms, and concise About

Account deletion remains essential but lives at the bottom of Account detail. Debug/QA remains a separately gated tool. Everything else must prove a durable, app-wide user job.

## Product decision table

| Current item | Decision | Why | Future action |
| --- | --- | --- | --- |
| Profile identity card | MOVE | Account context, not a root setting | One compact Account row → Account detail |
| Edit name | KEEP | Real account-maintenance job | Retain in Account detail |
| Change password | REDEFINE | Must adapt to password vs OAuth identity | Render Add/Change password from real provider state |
| Email identity | NEEDS PRODUCT DECISION | Core identity is displayed but cannot be changed despite policy wording | Choose verified change-email flow or explicit read-only/support contract |
| Member-for count | MOVE | Profile context, not control | Put in Profile/About account detail or remove |
| Places explored | MOVE | Progress/product truth, not preference; current semantics are inaccurate | Move to Home/Memory/Profile and fix metric authority |
| Cairns planted | MOVE | Progress/product truth, not preference | Move to Home/Profile/Trails |
| Record exploration outside activities | KEEP / POLISH | Real privacy/product choice | Rename for foreground truth; show permission/status and OS link |
| Units | KEEP / POLISH | Enduring app-wide need | One complete Metric/Imperial authority |
| Date format | SIMPLIFY | Device locale solves most need; current setting is incomplete | Remove and use locale, or prove need and complete it |
| Haptic feedback | KEEP | Working app-wide interaction preference | Retain |
| Show exploration % | MOVE | Only affects Home | Put in Home context/menu if continued |
| Appearance | KEEP / POLISH | Meaningful Cairn-wide preference | Retain Auto/Day/Sunset/Night using shared control |
| What's new | REDEFINE | Useful only when release notes are current | Automate/maintain it or remove it |
| Check the weather | MOVE | Activity-planning context, not Settings | Home/Hike/Run context if it earns a place; otherwise remove |
| Send feedback | REDEFINE | Essential support job; current delivery is false | Build acknowledged support channel and honest status |
| Safety report | REMOVE | Current transport cannot support safety/emergency reliance | Reintroduce only with explicit monitored response contract |
| Privacy Policy | KEEP | Essential transparency/right | Reconcile policy with implementation first |
| Terms of Service | KEEP / POLISH | Required/useful legal access | Use final accurate terms; remove “coming” copy |
| About Cairn/version | SIMPLIFY | Useful, but should be quiet | Secondary About/footer; no secret QA unlock |
| Export my data | REDEFINE | Essential data right, partial job UI | Move to Privacy & Data; show queued/ready/failed/history/download |
| Reset my map memory | REDEFINE | Essential scoped deletion, but name can be more precise | “Delete exploration history” with exact retained/deleted scope |
| Delete account | REDEFINE | Essential right, unsafe deployed contract | Fix grace/cascade/privacy contract; keep in Account danger area |
| Sign out | KEEP | Essential account action | Put in Account; correct Activity copy |
| Debug mode | DEBUG ONLY | Internal authorization/tooling | Dedicated gated QA entry, absent from normal Settings |
| Activity Simulator | DEBUG ONLY | O55 QA instrument, not preference | Keep in simulator/Activity Debug context |
| Open Debug screen | DEBUG ONLY | Internal diagnostics | Dedicated gated QA entry |
| `mapLayer` | MOVE | Contextual and currently orphaned | Map-local control; migrate stale stored value |
| `nightMode` | REMOVE | Dead duplicate of Appearance | Delete in a later migration/cleanup |
| `voiceGuidance` | MOVE | Dormant, route-session concern | Add only when route following ships and proves need |
| `offRouteThresholdM` | REMOVE | Algorithm threshold, not user preference | Keep product-owned internally |
| `recordMode` | REMOVE | No current user behavior | Remove migration-safely |
| `showFriendOverlay` | REMOVE | Dead/no consumer | Remove migration-safely |
| `useH3Fog` | DEBUG ONLY | Implementation kill switch | Keep internal only |
| Notification rows | HIDE | No complete token/event/permission product | Reassess when real notifications ship |
| Generic offline/cache controls | HIDE | No defined user-owned storage job today | Prefer route/trail downloads; later manager only if needed |

## Recommended future structure

### Root Settings

Aim for four scannable groups and roughly 7–9 root rows.

1. **Account**
   - Account summary → secondary Account detail

2. **Preferences**
   - Units
   - Appearance
   - Haptics

3. **Privacy & Data**
   - Explore while Cairn is open
   - Export my data → status/detail
   - Delete exploration history → detail/confirmation

4. **Help & About**
   - Help & Support / Send feedback, only after reliable delivery
   - Privacy Policy
   - Terms
   - Quiet version/about footer or secondary About row

### Account detail

- Name
- Email / email-change state
- Sign-in method and provider-aware password action
- Sign out
- Separated danger area: Delete account

### Hidden behind contextual owners

- Home: exploration-percent presentation; progress if retained.
- Hike/Run/Home planning: weather if retained.
- Map/Route/Trail: layer, camera/follow, route options, offline download.
- iOS Settings: permission grant/revoke, with explanatory deep-link from Privacy & Data.
- Dedicated QA: all O55 simulator, GPS, telemetry, scenic override, diagnostic, environment, and test controls.

### Visual direction for the later redesign

- Preserve the current Home-family scenic background and veil; Settings already belongs to Cairn visually.
- Rebuild surviving content with canonical surfaces, segmented control, fields, modal card, buttons, typography, spacing, radii, dividers, and theme tokens.
- Validate root, expanded rows, forms, confirmations, error/success, and destructive states in Day/Sunset/Night at 390×844, a small iPhone, and a larger iPhone through Expo Web.
- Do not redesign until P0 behavior and ownership decisions are settled; visual polish must not make false contracts more convincing.

## Open product decisions

1. **Email:** Will Cairn support verified in-app email change, or keep email immutable with a defined support/recovery path?
2. **Date order:** Is there demonstrated demand for overriding device locale? Default recommendation: remove the setting.
3. **What’s New:** Can release notes be made reliably current as part of OTA preparation? If not, remove the row.
4. **Support:** What response and retention contract can Cairn actually promise? Default recommendation: ordinary support/feedback only; no safety/emergency category without staffed operations.
5. **Delete-account grace:** What is the approved production restore/retention interval? It must replace TEST-MODE and match policy/copy/server.
6. **Passive exploration sync:** Should this privacy preference remain device-local or follow the account? Either choice must be explicit, especially on a second phone.
7. **Offline maps:** Is a real Route/Trail download product in scope soon? If not, do not add Settings storage rows.

## Audit evidence and boundaries

### Source authority inspected

- `app/src/screens/SettingsScreen.tsx`
- `app/src/store/useSettingsStore.ts`
- `app/src/store/useMemorySettingsStore.ts`
- Settings consumers across Home, Hike/Run, Routes, Map History, Memory/Fog, theme, haptics, Debug, O55 simulator, formatting, passive recording, and logout
- `app/src/services/appLog.ts`, feedback snapshot upload, auth/data export services
- `backend/src/routes/auth.js`, `account.js`, `memory.js`, `edit-diag.js`, `debug-snapshot.js`, push routes/services
- `backend/src/models/User.js`, export worker, auth sweep, and relevant migrations
- `backend/public/privacy.html` and in-app Auth privacy copy
- `docs/review/global-product-domain-audit/` retained production verification

### Product-DNA evidence inspected

- `docs/VISUAL_SYSTEM.md`
- `docs/VISUAL_MIGRATION_STATE.md`
- `docs/VISUAL_ASSET_MANIFEST.json`
- `docs/qa/visual-migration/final/settings-day.png`
- `docs/qa/visual-migration/final/settings-night.png`
- `docs/qa/visual-north-star/sunny-3-time-final-correction/sunny-settings-3-state-review.jpg`
- `docs/qa/visual-migration/final/product-unity-board.jpg`
- Current O55 Settings capture at `app/_review/o55-gps-sim/expo-web/captures/settings-simulator-toggle-390x844.png`

The older three-state board contains historical content that is no longer rendered, so it was used only for the locked visual family—not as current Settings inventory authority. No redesigned mockup was produced because this phase is audit-only.

### Deliberate non-actions

- No production code or preferences changed.
- No Activity/O54 or simulator/O55 path changed.
- No backend request, deployment, or production data mutation occurred.
- No O marker/version/build/runtime change occurred.
- No generated QA capture was added or committed.
