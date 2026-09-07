# Active default-dialog inventory

Focused inventory captured 2026-09-05. Classification is based on current production route registration and static runtime imports. This is planning evidence; only Friends-family product dialogs were migrated in this correction.

## A. System / OS intentional

- `app/src/screens/DebugScreen.tsx` — developer diagnostics/export prompts. The screen is reachable only after the hidden debug-mode unlock; retain until developer tooling is reviewed.
- `app/src/features/marks/dev/MarkDetailDevPreviewScreen.tsx` — development-preview prompts; the route is guarded by `__DEV__`.

## B. Product UI — migrate in a later batch

- `app/src/screens/AuthScreen.tsx` — Apple Sign In availability/failure and account restore/deletion feedback. Auth follow-up.
- `app/MigratorRetryPrompt.tsx` — route-edit migration recovery. Activity/detail follow-up.
- `app/src/services/lowPowerModeWarn.ts` — tracking reliability warning. Activity follow-up.
- `app/src/store/useTrackingStore.ts` and `app/src/screens/HikingScreen.tsx` — active tracking confirmations/recovery. Activity batch.
- `app/src/screens/RouteEditorScreen.tsx` and `app/src/components/map/EditOverlayV274.tsx` — route-edit save/cancel/error confirmations. Details/activity batch.
- `app/src/screens/PlantScreen.tsx`, `app/src/screens/MarkerDetailScreen.tsx`, and `app/src/screens/MapHistoryScreen.tsx` — cairn/marker product confirmations and errors. Details batch.
- `app/src/screens/SettingsScreen.tsx` and `app/src/components/settings/MemorySettingsSection.tsx` — sign-out, deletion, export, memory reset, and link errors. Settings batch.
- `app/src/features/memory/components/CairnPinsLayer.tsx` — like/report/distance product feedback. Memory batch.
- `app/src/features/memory/components/PaywallSheet.tsx` — purchase/restore product feedback. Paywall/subscription follow-up.

## C. Legacy / dead

- None confirmed. Every non-preview source found has a current static runtime import or production route.

## D. Uncertain

- None in this focused static inventory. Dynamic behavior and exact reachability of individual error branches still require their owning batch’s runtime fixtures.

## Friends correction

`app/src/screens/FriendsScreen.tsx` previously used `Alert.alert` for outbound-request cancellation and the friend long-press/block flow. Both are active production interactions. They now use the shared `ModalCard`/`PrimaryButton` contract. A focused test rejects any future `Alert.alert` or browser confirmation in the active Friends screen.

## Confirmation grammar — 2026-09-05

When an action already lives inside a dismissible CairnNZ modal, sheet, or profile, a nested product-confirmation modal is rejected by default. Confirmation remains in the existing surface, presents one concise warning state, and exposes one final action. Redundant `Cancel`, `Keep`, `Never mind`, or `Back` actions are rejected when the existing X or dismissible backdrop safely abandons the action.

- **Active / corrected in Friends:** Profile removal now reveals its warning and final action inside the existing Profile. Sent-request cancellation retains one authored modal with its existing X/backdrop and one final action.
- **Active / future Friends follow-up:** the long-press Block friend confirmation remains in one authored modal but currently exposes `Back` beside its final action. It was not part of this correction request and is retained for an explicitly reviewed follow-up.
- **Active / future owning batches:** Auth account deletion/restore; tracking stop/recovery; route-editor discard/delete; cairn/marker delete/report; Settings deletion/reset/sign-out; and subscription purchase/restore confirmations require this rule to be checked during their already assigned migrations.
- **Legacy / dead:** none newly confirmed by this focused read-only check.
- **Uncertain:** individual error and recovery branches remain deferred to their owning runtime fixtures.
