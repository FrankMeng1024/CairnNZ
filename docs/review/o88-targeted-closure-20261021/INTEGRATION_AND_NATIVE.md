# Integration readiness and native checklist

## Read-only delivery comparison

- Cairn candidate: `eec4ce0eeb31bcbe2bf7357525016372123f55a3`
- Hike/Run candidate: `3ffe7078fdb46384dd312182b15ff4ddda8cc98c`
- Common fork: `79b99a2b4b48f99658d4dc7cc564579d50603486`
- Hike was clean and one commit ahead of its remote when observed.
- The Hike worktree was not edited, stashed, cleaned, checked out, merged,
  rebased, served, stopped or otherwise manipulated.

## Exact direct overlap since the common fork

1. `app/src/components/__tests__/mapboxWebConsumerCoverage.test.ts`
2. `app/src/features/memory/services/mapboxAdapter.web.tsx`
3. `app/src/navigation/RootNavigator.tsx`
4. `app/src/screens/PlantScreen.tsx`
5. `app/src/screens/RunningScreen.tsx`
6. `app/src/screens/SettingsScreen.tsx`
7. `app/src/screens/__tests__/plantActivityContext.test.ts`
8. `app/src/screens/__tests__/plantActivityLinkage.test.tsx`
9. `app/src/services/markerOfflineEntities.ts`
10. `app/src/store/useMarkerStore.ts`
11. `backend/scripts/personal-friends-harness/current-schema-fixture.sql`

## Semantic overlap requiring deliberate reconciliation

- Hike owns current tracking/location supervisors, stage ledger, final
  refinement, background task, `useTrackingStore`, `useSessionStore`, Hiking
  and Running behavior.
- O88 changes Cairn placement linkage, passive/background delivery,
  `activityJournalProjection`, Memory/Fog layers and map rendering.
- Plant and quick-Cairn behavior share business identities even where the exact
  source file differs. Preserve Hike/Run single-flight and Run quick-empty
  semantics while carrying O88’s exact draft/place/provenance fences.
- Map adapter changes must preserve both Hike route rendering and O88’s
  supported Web theme/image capability behavior.
- Root navigation must combine Hike lifecycle ownership with O88 notification
  retry/exact-revision behavior; a clean textual merge is insufficient.

## Migration authority

- Both worktrees contain migrations through 051.
- O88 adds 052 placement provenance, 053 QA fixture cohorts, 054 explicit
  Memory-hit push opt-in, 055 delivery outbox and 056 per-target receipt
  reliability, with matching rollback files.
- Hike currently adds no 052–056 migration. Do not renumber, rewrite or squash
  an applied migration to manufacture compatibility. Reinspect the ledger at
  integration time because Hike may advance again.

## Ordered future integration plan — do not execute without Owner approval

1. Create a new integration branch/worktree from the exact newly approved Hike
   and Cairn commits; leave both source branches untouched.
2. Inventory Git and semantic overlap again, including any new migrations,
   lockfiles, EAS/config and generated source.
3. Integrate schema/config first in immutable numeric order; rehearse up/down/
   reapply only on a disposable database.
4. Reconcile identity and authority primitives: marker IDs, owner generations,
   Activity linkage, offline tombstones, draft scopes and notification targets.
5. Reconcile RootNavigator and background ownership so one collector, one
   Activity authority and one notification-consumption path remain.
6. Reconcile Plant/Running/Hiking UI handlers while preserving Hike/Run
   single-flight behavior and O88 reversible adjustment/exact draft identity.
7. Reconcile the Web/native map boundary and rerun Hike route plus O88 density,
   symbol, theme and failed-resource tests.
8. Run migration, backend, full app, Activity, real isolated auth/DB and all
   cross-module journeys. Diagnose flakes; do not retry them to green.
9. Only after an integrated green candidate, obtain a compatible native build
   and execute the checklist below.
10. Owner separately decides field fixture approval, production deployment,
    O-marker increment, EAS Build/OTA/TestFlight and publication.

## Minimal native acceptance checklist

- Real iPhone Plant: first-entry Cancel/Back, Adjust GPS Cancel, Adjust pin Back,
  background/suspend/kill/reopen, offline save/retry, keyboard at supported
  sizes and no duplicate Cairn.
- Real GPS provenance: fresh/stale/poor/lost/reacquired, Activity generation
  change, no fabricated freshness, and telemetry tied to one collector.
- Locked/background/headless: accepted evidence survives; later callback with
  no new movement drains bounded durable work; account switch cannot replay it.
- Push: opt-in/out, multiple devices, partial provider acceptance, receipt
  failure/absence, visible OS delivery, cold tap, failed-open retry and exact
  acquired revision.
- Native Mapbox: Day/Sunset/Night Standard presets, glyphs, same-place and
  distributed clusters, camera/back/latest intent, failed tile recovery.
- Accessibility: VoiceOver names/order, Dynamic Type, Reduce Motion, contrast,
  44 pt effective targets, modal focus and destructive confirmation.
- Device quality: haptics, safe areas, status/permission sheets, transition
  interruption, thermal/battery and first-usable-frame responsiveness.
- Integrated Hike/Run: ready/active/pause/resume/finish, quick Cairn, route
  Draw/Point/Trim dirty Back/Cancel and Activity source protection.

Until all applicable rows pass on the integrated candidate, the release verdict
remains HOLD.
