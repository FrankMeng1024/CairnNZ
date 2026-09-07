# Batch 2 remaining migration inventory

Reachability was checked against `RootNavigator` and direct runtime imports. This is planning evidence only; none of the deferred surfaces below were migrated in Batch 2.

## Batch 3 — Friends

- **ACTIVE:** `FriendsScreen` Add Friend sheet, friend-profile overlay, request/remove/block confirmations, loading, empty, unavailable and failure states.
- **ACTIVE:** remaining Friends `TextInput`, button-equivalent actions, manual scrims and tab-local state treatments.

## Batch 4 — Trails

- **ACTIVE:** `RoutesScreen` route/activity/cairn loading and empty states, map-unavailable fallback, search/filter/sort control states and associated action areas.

## Batch 5 — Activity

- **ACTIVE:** `TooShortSheet`, `UnfinishedRecoveryModal`, `StopSummarySheet`, Hiking/Running permission and unavailable-map states, `HikingMap` loading/offline frames, activity alerts and bottom action trays.
- **ACTIVE:** `PlantScreen` / `GpsLockStep` loading, permission, recovery and offline-save states.

## Batch 6 — Details

- **ACTIVE:** `MarkDetailSheet`, `MarkerDetailScreen` edit sheet, `MapHistoryScreen` marker/detail overlays, route-data-unavailable and empty states, `RouteEditorScreen` unavailable/error/loading states and bottom actions.

## Batch 7 — Memory

- **ACTIVE:** `MemoryFriendPickModal`, `MysteryCairnSheet`, Memory loading/slow/permission/error/recovery states, unlock guidance modal and map-adjacent loading states.
- **ACTIVE:** direct `AppButton` usage in `MemoryScreen`; evaluate during the Memory batch rather than replacing it globally.
- Keep Memory's atmospheric composition; use the shared state parts without flattening it into a generic card.

## Batch 8 — Settings

- **ACTIVE:** `TypeToConfirmModal`, theme/help preview modals, account/memory destructive dialogs, feedback/loading/error states and manual modal scrims in `SettingsScreen`.

## Auth follow-up

- **ACTIVE:** legal full-screen modal, restore-account confirmations, provider/loading/error states and platform alerts in `AuthScreen`.
- Preserve Auth composition and validate before replacing platform alerts or legacy field/button treatments.

## Paywall / subscription follow-up

- **ACTIVE:** `PaywallSheet` and purchase/restore success, failure, pending and empty-offering dialogs. It already consumes `BottomSheetFrame`; its remaining `AppButton` usage and subscription-specific action behavior remain deferred.

## Other active scope

- **ACTIVE:** first-run `OnboardingModal`, root `OfflineBanner`, `OtaBadge` status/detail modal, and current platform `Alert` dialogs that remain intentionally native until their domain batch evaluates them.

## Legacy / dead-code inventory

- **LEGACY / UNUSED — CONFIRMED, RETAINED:** `AuthPreviewScreen.tsx` has no navigation registration and no runtime/test import; it is superseded by the active Auth screen and existing Auth QA capture path. Retained because Batch 2 is not a dead-code cleanup pass.
- **REVIEW-ONLY, RETAINED:** generated preview screens and `Gate1IconSheetScreen` are explicitly `__DEV__`-registered QA tools, not production migration targets and not dead code.
- **UNCERTAIN / DEFERRED:** none found in this focused reachability pass.
