# CairnNZ Settings Product-DNA + Correctness Convergence

**Candidate:** O56 marker advanced for human review (`app/src/components/OtaBadge.tsx:347`)  
**Evidence date:** 2026-09-14  
**Publication status:** not published  
**Production mutation status:** none

## Product definition

Settings is the place where a Cairn user controls durable app-wide preferences, account behavior, privacy/data choices, and support/legal access.

It is not a progress dashboard, weather hub, map control panel, Activity tuning surface, or QA console. The implementation now follows that boundary in both visible information architecture and persisted authority.

## Before

The former page was a long mixed warehouse: identity, progress counts, passive exploration, units, date format, Home presentation, release notes, weather, unacknowledged feedback, an unsupported safety report, legal links, export, destructive actions, and a five-tap Debug unlock all shared one surface.

Several rows were more serious than clutter:

- Feedback announced receipt after only a best-effort diagnostic enqueue.
- Safety reporting implied a capability with no monitored emergency contract.
- Account deletion used a five-minute test grace and did not prove deletion of `unlocked_regions` or other non-cascading account references.
- Export could be requested without a comprehensible processing, ready, failed, expiry, download, or recovery path.
- Password UI assumed every user had a Cairn-owned password.
- Privacy copy disagreed with passive foreground exploration, account maintenance, diagnostics, export, and deletion behavior.
- Old preference keys could continue to act as hidden product authority.

The current-state audit remains at `docs/review/settings/SETTINGS_PRODUCT_UX_AUDIT.md`. This pass implemented its accepted direction rather than repeating it.

## New information architecture

The root now has exactly four groups and can be scanned without entering detail:

1. **Account** — identity and account actions.
2. **Preferences** — Units, Appearance, Haptics, and Explore while Cairn is open.
3. **Privacy & Data** — location truth, export, exploration-history deletion, and policy access.
4. **Help & About** — acknowledged feedback, support, legal links, and concise build information.

Account, Privacy & Data, and Help & About use calm secondary surfaces. Destructive account actions no longer crowd the root.

## Account

Account detail shows the current name, read-only account email, and sign-in method. It owns Edit name, the provider-valid password action, Sign out, and a visually separated Delete account action.

Change Email is not exposed. The current backend has no complete provider-aware mutation and verification contract, and Settings no longer implies one.

Sign-out copy now matches durable Activity ownership: saved and recoverable data remains with the account. Signing out resets the device’s passive-exploration opt-in and clears outgoing account state without representing retained recovery data as discarded.

## Provider-aware identity/password behavior

`GET /api/auth/me` returns `hasPassword` and linked providers. Settings refreshes that server profile before presenting account actions.

- A Cairn password account gets **Change password**, including current-password verification.
- An Apple/Google-only account sees that its provider manages the password; Cairn does not render a fake password action.
- An indeterminate/older response shows neither action until the profile contract is known.

Successful password change receives and persists the server’s replacement token. Other sessions are revoked by the server token-version contract while the current device remains signed in truthfully.

## Preferences

The surviving preference set is deliberately small:

- **Units:** Metric or Imperial.
- **Appearance:** Auto, Day, Sunset, or Night through the existing visual-theme authority.
- **Haptics:** one shared durable gate; all located Cairn haptic call sites use the shared service.
- **Explore while Cairn is open:** the explicit passive foreground-exploration opt-in.

Unit coverage was traced through the shared distance/elevation/pace formatters and repaired on Home Activity summaries. Date presentation now uses locale-aware shared formatting instead of a partial user selector.

Legacy `nightMode`, `dateFormat`, `voiceGuidance`, `offRouteThresholdM`, and `showExplorationPercent` keys are migration inputs only and cannot become runtime Settings authority. The dormant route-following implementation now owns fixed product behavior rather than reading hidden Settings. Memory’s dead `recordMode`, `showFriendOverlay`, and `useH3Fog` controls were removed; Fog remains a product truth rather than a hidden preference.

## Explore while Cairn is open

This setting means: while Cairn is foregrounded and no Activity is recording, foreground location may update exploration. It defaults off under the new consent contract and does not alter Hike/Run recording.

Enabling checks the real foreground OS permission and requests it when iOS permits another prompt. A denied OS permission forces the Cairn preference off instead of displaying an inert enabled toggle. Privacy detail shows OS permission separately from Cairn’s opt-in and links to system Settings when only iOS can change it.

The persisted Memory preference contract is versioned so an unexplained pre-contract `true` value migrates safely to off, while a post-consent value remains durable.

## Privacy & Data

The detail surface distinguishes four different truths:

- OS foreground-location permission;
- Cairn’s optional passive foreground-exploration preference;
- Activity recording, which remains separate and in context;
- limited operational diagnostics and separately gated internal QA telemetry.

The hosted privacy authority now matches current behavior for identity, Active and passive location, diagnostics, export, and the seven-day deletion contract.

Operational log context is scrubbed before entering the client queue and again at the generic server endpoint. Credential-shaped values, email addresses, account-ID-shaped fields, and precise real/unknown coordinate fields are removed. Internal session telemetry also requires both an internal/dev-capable build and explicit Debug enablement at the caller and upload boundary; a normal Route editor can no longer force it on. Labelled synthetic simulator coordinates retain their QA value through that separately gated telemetry path.

## Feedback

Feedback and Bug are now authenticated, durable submissions to `POST /api/account/feedback`.

The client displays:

- **Sending** while the request is pending;
- **Delivered to Cairn** only after the database-backed acknowledgement;
- a truthful failure and **Retry delivery** otherwise.

A stable client submission UUID plus a server uniqueness constraint makes repeated delivery idempotent. A single-flight guard prevents duplicate work, and failed text remains available for retry. Safety/emergency reporting was removed; the surface explicitly states that feedback is not an emergency or monitored safety service.

## Export

Export remains exposed because it now has a coherent end-to-end product contract:

- request or recover an existing queued/building/non-expired ready job;
- display preparation state and poll while the detail screen is open;
- recover history after leaving or restarting;
- display a sanitized failure and permit a fresh request;
- open the authenticated owner’s short-lived HTTPS download URL when ready;
- explain 24-hour expiry and allow a fresh request afterward.

The worker atomically claims work, recovers stale building jobs, writes through a temporary file, marks readiness before sending email, and treats email only as a secondary notification. Feedback and unlocked-region data are now included in the bundle. Server errors are mapped to stable public categories instead of exposing implementation details.

## Account deletion

The five-minute test behavior is gone. The implemented production contract is now deliberate:

1. The server disables the account immediately.
2. The deletion timestamp and global token-version revocation commit atomically.
3. Existing sessions become invalid and push registration is removed.
4. Server-backed data can be restored by signing in during seven days.
5. The sweep locks and rechecks eligibility, then permanently deletes the account and owned data after the deadline.

The confirmation explains scope, restoration, local data, and unsynced-data loss, and requires the exact phrase `delete account`.

After server acknowledgement, the client first writes a durable owner-specific purge marker. Native builds use both normal app storage and an independent SecureStore marker; either is sufficient for cold-boot recovery. It then suspends account runtime ownership, purges account-owned device data, clears credentials, and signs out. If cleanup is interrupted, the marker is retried before another account hydrates. If neither marker nor immediate cleanup can be confirmed, the user gets an explicit fail-closed warning not to sign another account into that installation and to reinstall first.

## unlocked_regions / owned-data deletion

Migration 035 removes already-orphaned `unlocked_regions`, adds its User foreign key with `ON DELETE CASCADE`, and adds owned telemetry attribution/cascade. Feedback and all normal product tables also cascade from the user.

Hard deletion additionally and transactionally covers historical/non-cascading references:

- `unlocked_regions`;
- idempotency keys and abuse signals;
- `memory_points`, `debug_events_v2`, and `app_logs` when those deployment-specific tables/columns exist;
- account-owned telemetry;
- notification copies authored by the deleted user;
- password-reset events/codes and matching pending registration;
- export files outside MySQL before the User row can commit deletion.

Activities, Routes, Cairns, Memory, friendships/blocks/subscriptions, device tokens, exports, feedback, OAuth identities, tombstones, and route-owned derived data are covered by User/Route cascades. Any explicit cleanup or personal export-file failure rolls back before the User row is removed, so the sweep retries rather than declaring a partial hard deletion successful.

On-device deletion removes owner-scoped Activity/session artifacts, pending/offline entities, Routes and extras, Cairns, Memory/H3, hierarchy caches, Plant drafts, emergency recovery payloads, simulator logs and uploads, legacy unscoped operational logs, stale precise location, and unsafe pre-owner-scoped caches. Device-wide presentation preferences and internal-build capability are deliberately retained.

## Help & About

The surviving content is concise: Feedback/Bug, support email, Privacy Policy, Apple Standard EULA, and native version/build. Stale What's New content and its false O55 freshness claim are absent.

## Removed settings

The normal product no longer contains:

- progress statistics or progress explanation;
- Show exploration percentage;
- Date format;
- Weather;
- What's New;
- Safety report/emergency language as a service option;
- global map layer, camera/follow, guidance, or route-threshold controls;
- simulator, GPS, telemetry, diagnostics, environment, or QA controls;
- the five-tap About developer unlock;
- legacy Memory/Fog settings.

No global offline-download manager was invented. Offline actions remain with Route/Trail/map contexts.

## Debug separation

Debug and the O55 simulator retain a separate, explicit owner. An internal/dev-build-only Home entry opens the dedicated Debug screen. That screen owns QA enablement and the Activity Simulator gate, and enforces build capability again at the destination.

Ordinary production Settings has no Debug entry, unlock gesture, simulator mode, O-marker, endpoint, API key, telemetry control, or engineering threshold. This refactor did not modify Clean Path, Raw GPS, location-source ownership, Canonical, Live, Final, Stationary, lifecycle, matching, or pace behavior. The only shared QA hook change is an additional uploader authorization check requiring the existing internal build capability and Debug opt-in.

## Product DNA

Settings now reuses Cairn’s established scenic backgrounds, `ContentSurface`, typography roles, spacing/radius/icon tokens, `BackButton`, `SegmentedControl`, `TextField`, `PrimaryButton`, `ModalCard`, and shared destructive treatment.

The hierarchy is page → section → row → secondary detail → separated destructive action. It avoids nested card piles, icon overload, badges, implementation language, and unnecessary subtitles. The visual comparison shows the product change, not merely recoloring: a mixed Settings warehouse became a short durable control surface.

## Day / Sunset / Night

All root, detail, async, permission, and destructive states derive their colors and surfaces from the existing Cairn theme/background authorities. There are no local hexadecimal colors in Settings.

Expo Web mobile evidence covers:

- root Day, Sunset, and Night at 390×844;
- root at 320×568 and 430×932;
- password and Apple-provider Account variants;
- deletion confirmation;
- ready Export and permission-limited Privacy states;
- normal and failed Feedback states.

The capture recorded no runtime errors. Sunset remains luminous; Night uses Cairn’s cool mineral/slate family rather than black panels.

## Backend changes

Backend deployment is required for:

- migration `035_settings_correctness.sql`;
- durable/idempotent feedback acknowledgement;
- export status/download/recovery semantics;
- seven-day deletion scheduling and hard-delete coverage;
- `unlocked_regions` and telemetry ownership foreign keys;
- server-side generic diagnostic scrubbing;
- the updated hosted Privacy Policy.

No production backend or data was changed during this implementation.

## Tests

Focused client validation: **32/32** assertions across seven suites:

- four-section IA and removed rows;
- provider-aware account behavior;
- truthful feedback/export/deletion states and single-flight guards;
- account-local purge ownership and cold-boot recovery;
- telemetry privacy;
- haptic gating;
- units/date behavior;
- Memory preference migration.

Focused backend validation: **14/14** assertions:

- transactional scheduling and global session invalidation;
- explicit/cascading owned-data deletion;
- restored-account race protection;
- export-file failure rollback;
- feedback durability/idempotency;
- export recovery/readiness;
- seven-day contract;
- privacy-copy and two-boundary diagnostic scrubbing.

Required changed-scope verifier: **527/527 PASS**.

| Gate | Result |
| --- | ---: |
| continuity | 35/35 |
| location cadence | 5/5 |
| background | 25/25 |
| Gap | 14/14 |
| elevation | 5/5 |
| matching | 42/42 |
| telemetry | 38/38 |
| integration | 99/99 |
| Memory/Gap | 3/3 |
| journal recovery | 34/34 |
| Memory | 16/16 |
| offline sync | 35/35 |
| simulator shared | 56/56 |
| server | 23/23 |
| static | 97/97 |

Targeted diff whitespace validation passed. Expo Web review at the required mobile sizes recorded `runtime-errors.txt: none`.

The repository-wide ad hoc `npx tsc --noEmit` command is not a clean baseline gate: it still reports unrelated pre-existing missing `@playwright/test`/i18n modules, generated Friends-preview icon keys, legacy geo/corridor test exports, and preview navigation typings. Filtering the same compiler output to every file changed by this Settings pass returned no matches. The maintained changed-scope verifier above is the project gate and passed completely.

## Visual evidence

Reproducible capture and composition scripts:

- `app/scripts/capture-settings-product-dna-qa.mjs`
- `app/scripts/render-settings-before-after.mjs`

Ignored local review output:

- `app/_review/settings-product-dna/settings-product-dna-board.jpg`
- `app/_review/settings-product-dna/settings-before-after.jpg`
- `app/_review/settings-product-dna/root-day-390x844.png`
- `app/_review/settings-product-dna/root-sunset-390x844.png`
- `app/_review/settings-product-dna/root-night-390x844.png`
- `app/_review/settings-product-dna/root-day-small-320x568.png`
- `app/_review/settings-product-dna/root-night-large-430x932.png`
- Account, Privacy/export/permission, and Feedback success/failure state captures in the same directory
- `app/_review/settings-product-dna/runtime-metrics.json`
- `app/_review/settings-product-dna/runtime-errors.txt`

Generated image outputs are review evidence and should remain outside deploy-bearing Git under the current repository convention. Textual review authority and the reproducible scripts belong with the implementation.

## Deployment requirements

Follow `docs/operations/PRODUCTION_BACKEND_DEPLOY.md` exactly.

Required order:

1. Back up and preflight the production database/environment.
2. Apply `backend/src/migrations/035_settings_correctness.sql`.
3. Verify `feedback_messages`, `telemetry_sessions.owner_user_id`, the telemetry-owner FK/index, and the `unlocked_regions` User FK/cascade.
4. Deploy the matching backend routes/models/worker, hosted Privacy Policy, and seven-day sweep configuration.
5. Run the runbook’s health, schema, log, feedback acknowledgement, export request/status/download, deletion scheduling, restoration-window, and dry/non-destructive sweep checks.
6. Only after backend verification, perform human review of the O56 client candidate.
7. Publish the production OTA manually if human review passes.

The client changes are JavaScript/assets only. No native dependency, entitlement, Info.plist, or configuration change was added, so a native rebuild is not required. Backend-first deployment is required; publishing this client before the matching backend would expose unsupported feedback/export contracts. Mapbox configuration is unchanged. No backend deployment or OTA publication was performed in this pass.

## Remaining product decisions

These are future product choices, not known defects in the implemented Settings contract:

- Whether Cairn should offer Change Email after a provider-aware verification and recovery design exists. It is truthfully read-only today.
- Whether Cairn should own bespoke Terms instead of continuing to link the current Apple Standard EULA.
- Whether notifications warrant user-facing categories when a maintained notification product and permission lifecycle exist. They remain absent today.

No known P0/P1 Settings implementation defect is deferred under this section.
