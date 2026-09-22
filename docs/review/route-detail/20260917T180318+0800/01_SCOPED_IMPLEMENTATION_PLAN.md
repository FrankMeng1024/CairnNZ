# CARD-ROUTE-01 scoped implementation plan

Run: `20260917T180318+0800`

## Already working and preserved

- Trails already separates Activities and Routes and its Route rows reach `MapHistory`.
- Activity Detail already creates an independent local-first Route draft with copied geometry.
- The existing editor already owns correction, trim, reset, undo, and corridor constraints.
- Hike and Run already provide explicit pre-start pages; recording still begins only from their Start controls.
- CARD-AD-01, CARD-CAIRN-01, O54, O55, Plant, Memory truth, and frozen Home/Friends/Auth references remain outside redesign.

## Defects fixed by this card

- Route Detail is now the one post-create, post-edit, and Trails destination.
- Route Detail is use-first and distinguishes loading, unavailable, fetch failure, cached local content, pending sync, and permanent source failure.
- Rename, edit-save, and delete no longer claim success ahead of the supported durable contract.
- The editor distinguishes `Apply to draft` from `Save Route`, guards unsaved changes, preserves the draft after failure, and removes the no-op gear.
- Activity origin and later geometry edits now have a bounded durable server representation.
- Stable client identity, owner changes, late reads, response loss, and delete/create races are guarded.
- Use Route presents Hike/Run choice, opens the matching pre-start screen, snapshots the selected reference geometry only on explicit Start, and does not enable dormant following/voice machinery.

## Minimum supporting changes

- Additive migration `036_route_origin_identity.sql` plus owner/finalized-source validation.
- Owner-scoped Route tombstones and stable client identity reconciliation.
- Shared origin/identity/reference helpers and focused tests.
- Minimal semantic-theme correction in the existing editor overlay and missing canonical icon mappings.

## Excluded work

- No new full-map planner, turn-by-turn navigation, RouteFollower activation, voice guidance, per-segment trust scoring, complete version tree, Friends/Public work, Memory redesign, deployment, production migration, OTA publication, or field validation.

