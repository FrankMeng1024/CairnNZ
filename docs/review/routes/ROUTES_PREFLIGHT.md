# Routes targeted preflight

Candidate inspected: `27865c744da76224a1f898a1719ee0eafb648efc` on
`codex/memory-friends-cairn-implementation`. This work continues from the
preserved Memory/Friends/Cairn checkpoint; it is not based on O72/O75.

## What already exists and will be reused

- `app/src/screens/RoutesScreen.tsx`: Trails keeps Activities and Routes as
  separate object families, with local-cache-preserving search/list states.
- `app/src/screens/RouteEditorScreen.tsx`: native Mapbox canvas, theme family,
  attribution, route detail/create handling, existing Point Directions call,
  draft-before-save flow, safe late-navigation coordinator and source-Activity
  provenance.
- `app/src/store/useRouteEditStore.ts`, `app/src/components/map/BrushOverlay.tsx`,
  `EditOverlayV274.tsx`, `TrimSlider.tsx`: existing Draw coordinate capture,
  Preview, Trim, Reset and Undo building blocks. The brush mapper uses the
  `mapbox/walking` Map Matching profile.
- `app/src/services/routing/planWalkingRoute.ts`: user-initiated
  `mapbox/walking` Directions adapter, separate from Activity Snap.
- `app/src/store/useRouteStore.ts`, `app/src/services/routeOfflineEntities.ts`:
  owner-scoped local Route cache/outbox and stable client identity.
- `app/src/features/route/routeContracts.ts`: immutable Route snapshot pinned
  when a Hike/Run starts. Planned geometry is not recorded truth.
- `backend/src/models/Route.js`, `backend/src/routes/routes.js`: server-owned
  origin identity, Activity/source locking, independent Route lifetime.
- `backend/src/routes/friend-content.js`: current live Friend Route listing and
  temporary use lease. This is evidence for safe snapshot consumption but does
  not satisfy direct, durable recipient delivery.

## Confirmed deltas

1. Routes has no single Create action offering Plan / Use an Activity. Empty
   Routes sends the user to Activities; Activity Detail owns Save as Route.
2. Blank Point planning silently starts at current GPS and supports only one
   destination. It does not establish a deliberate distant-city start or a
   chain of one-target transactions.
3. Existing Draw is an overdraw of a flat baseline. It lacks a durable ordered
   multipart/gap model and cannot prove append, adjacent-gap repair, or
   occurrence-safe A→B replacement at repeated coordinates.
4. The current visible editor exposes Beautify. The governing contract removes
   it as a prominent tool and keeps resolution inside Draw/Point.
5. Current Route persistence stores a flat `points` JSON. It cannot reopen
   inherited gaps or manual/matched/Point provenance without loss.
6. Friend Routes are live-authorized content plus a temporary use lease.
   Direct immutable delivery, identical re-send idempotency, recipient removal
   tombstones, changed re-share history and partial-recipient status are absent.
7. `Route.delete` deletes active leases; a new delivery table must be
   independent so ordinary source edits/deletion cannot cascade.

## Provider and debug separation

- `app/src/features/activitySimulator/simulatorWalkingRoute.ts` is a QA-only
  target route for simulated evidence. It must not enter production Route
  planning or presence collection.
- `planWalkingRoute.ts` calls Directions `mapbox/walking`. The Route brush
  adapter calls Map Matching `mapbox/walking`. Activity refinement continues
  through its own locked `pedestrianFinalRoute.ts` / `snapTrack.ts` path and is
  not modified for planner policy.
- Current Mapbox documentation says Directions walking accepts 2–25 input
  coordinates, while Map Matching accepts at most 100 and may return multiple
  matchings/null tracepoints. Planner adapters therefore use bounded,
  order-preserving input and reject/review split or disconnected results; they
  never silently keep only the longest match.
- References checked 2026-10-13:
  - https://docs.mapbox.com/api/navigation/directions/
  - https://docs.mapbox.com/api/navigation/map-matching/
  - https://www.mapbox.com/legal/product-terms
- The public terms link was checked, but the actual Cairn account agreement and
  any negotiated result-storage/sharing terms are not available here. Durable
  provider-derived Route storage/sharing is therefore a release gate requiring
  Owner/account confirmation, not a reason to substitute route-on-open.

## Initial technical decisions

- Add an additive ordered-draft contract alongside legacy flat points. Legacy
  continuous Routes remain compatible; no mass rewrite.
- A part contains ordered points plus `recorded`, `point`, `draw-matched` or
  `draw-manual` provenance. Only imported Activities may begin with gaps.
- Unknown gaps are stored separately and excluded from length. Unresolved
  drafts may recover locally but cannot be shared or used for Hike.
- Ordered positions use part ID + point index; repeated coordinates are not
  globally deduplicated.
- Each edit returns a new revision. Async provider replies are fenced by owner,
  draft, base revision and operation. Invalid edits create no Undo entry.
- Initial tunables are Route-specific: 20m attachment, 25m provider endpoint
  review, 45m shape-review and 90m manual-recovery thresholds; they do not reuse
  Cairn discovery or Fog radii.

## Gates

- No native iOS/physical-device gesture evidence is available yet. Source,
  deterministic provider fixtures and Web component evidence will be separated.
- No live provider batch calls are authorized or required for deterministic
  closure. Token/style validity remains a device/live-provider acceptance item.
- Migration 046 will remain local and additive. It must be rehearsed in an
  isolated database; it will not be run in production.

