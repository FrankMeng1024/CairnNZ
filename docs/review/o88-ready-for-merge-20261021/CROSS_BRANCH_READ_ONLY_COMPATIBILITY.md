# Read-only Hike/Run compatibility assessment

Observed at 2026-10-22 Asia/Shanghai:

- Cairn executable SHA: `c3b765e0c8bc5f1b16c1e72f0eefdcd9a954434d`.
- Current primary/Hike worktree SHA: `db731e8ca3c744f4f6da620f4a09727a71cd4e6b`.
- Merge base: `79b99a2b4b48f99658d4dc7cc564579d50603486`.
- The primary worktree was not edited or tested. It changed concurrently from the historical SHA. During this work it briefly showed modified generated `app/_review/settings-product-dna/` captures only; those concurrent changes resolved independently, and the final read-only status was clean.

There are 146 Cairn-changed and 102 Hike-changed tracked paths from the merge base, with 11 exact overlaps:

1. `mapboxWebConsumerCoverage.test.ts`
2. `mapboxAdapter.web.tsx`
3. `RootNavigator.tsx`
4. `PlantScreen.tsx`
5. `RunningScreen.tsx`
6. `SettingsScreen.tsx`
7. `plantActivityContext.test.ts`
8. `plantActivityLinkage.test.tsx`
9. `markerOfflineEntities.ts`
10. `useMarkerStore.ts`
11. `current-schema-fixture.sql`

A read-only three-way preview reports 11 conflict hunks across five files: one Mapbox coverage test, two Web adapter, three Plant, one offline-marker and four marker-store hunks. The other six overlaps auto-merge textually but still require semantic review.

## Required semantic resolution

- Plant must retain Cairn's owner/origin-scoped v5 draft session fences, delayed-write protection, sample/capture provenance and Public policy while incorporating Hike's latest activity-identity/freshness behavior. Do not pick a whole file.
- Running must keep Hike's deliberate navigation into the full Plant flow and Cairn's acquired-cluster marker ID routing. Cairn's older inline quick-plant implementation must not replace the newer Hike behavior.
- Marker/offline storage must retain Cairn's server-versioned placement tuple and richer public update failure/status handling while preserving Hike's identity-safe Activity cleanup model.
- Root navigation must retain Cairn's optional exact `revisionId`, notification/presentation routing and QA authority alongside Hike's durable Activity QA/restore hooks.
- The Web adapter must retain the official GL2 `/mapbox-legacy` entry, Cairn cluster/theme/Fog behavior and Hike performance/diagnostic changes.
- Settings and Plant linkage tests need both feature contracts, not whichever side happens to merge automatically.
- Hike's latest `useSessionStore`, Activity registry and final-artifact deletion retry commits do not overlap Cairn changes and should be carried forward unchanged during an authorized integration.

## Migrations

Hike adds no migrations from the merge base. Cairn adds forward migrations 052–056 and matching rollbacks. The shared schema fixture changes are in separate textual regions—Hike expands telemetry fields, Cairn adds marker vote/abuse fixtures—but the combined fixture and ledger must be rerun after integration. No schema was applied here.

Verdict: compatible in product intent, **not safe for an automatic or ours/theirs merge**. A separately authorized integration must resolve the five text-conflict files and six semantic overlaps, then run combined clean install, TypeScript delta, app/backend/Activity suites, native Mapbox build/device checks and the connected Cairn journey.
