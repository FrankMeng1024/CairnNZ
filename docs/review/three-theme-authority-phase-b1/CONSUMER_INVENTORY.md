# Phase B-1 production consumer inventory

Classification is based on current production navigation registration and runtime imports. This is an inventory, not a migration list.

| Shared primitive | ACTIVE production consumers | Phase B-1 effect |
|---|---|---|
| `SegmentedControl` | `FriendsScreen`, `RoutesScreen` | Material-only: one containing track and related active/inactive states; screen layout and product hierarchy unchanged. |
| `PrimaryButton` | `FriendsScreen`, `PermissionDeniedModal` | Semantic color/contrast only; legacy icon geometry and actions unchanged. |
| `TextField` | `FriendsScreen` Add Friend | Semantic material/focus/error/disabled rendering only; form composition and behavior unchanged. |
| `BottomSheetFrame` | `MarkDetailSheet`, `PaywallSheet` | Theme material/scrim and shared X color only; height, safe area, scrolling, keyboard, and dismissal APIs unchanged. |
| `ModalCard` | `PermissionDeniedModal`, `MemoryScreen` unlock guidance | Theme material/scrim and shared X color only; geometry and behavior unchanged. |
| `BackButton` | `RoutesScreen`, `SettingsScreen`, `HikingScreen`, `RunningScreen`, `MapHistoryScreen`, `RouteEditorScreen`, `MarkerDetailScreen`, `MemoryScreen`, Plant `ContentStep`/`PinAdjustStep`, `DebugScreen` | Neutral semantic foreground calibration only; placement, variants, navigation, and hit behavior unchanged. |
| `GlassPanel` | `AuthScreen` | Receives calibrated tokens mechanically; accepted landing capture shows no meaningful regression and no Auth composition changed. |
| `ContentSurface` | none yet | New material-only authority proven in the dev lab; production adoption is deferred to screen batches. |
| `DismissButton` | shared `BottomSheetHeader`, shared `ModalCardHeader` | Centralizes X size/weight/foreground; placement remains top-right in the shared headers. |

## Reachability classification

- **ACTIVE:** all production consumers listed above.
- **LEGACY / UNUSED — CONFIRMED:** none identified among the changed primitive consumers.
- **UNCERTAIN / DEFERRED:** none identified among the primitives changed in Phase B-1.
- Existing `*PreviewScreen`, `MarkDetailDevPreview`, `TransientContractPreview`, and `ThreeThemeComponentLab` routes are development-only QA infrastructure rather than production consumers. They were retained; this phase performed no dead-code cleanup.
