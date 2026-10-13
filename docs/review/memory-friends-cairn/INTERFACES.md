# Shared implementation interfaces

Updated: 2026-10-13 Asia/Shanghai

This file records the actual shared contracts. It is updated in place so later
Routes/Home work does not create competing concepts.

## Location and canonical truth

- Native ownership remains `nativeRealLocationSupervisor`; Activity and passive
  Memory are consumers, not parallel native collectors.
- Activity GPS filters, WAL, segment boundaries, canonical geometry, distance,
  Local Final and Selected Final are unchanged.
- `memory_presence_witnesses` holds bounded proximity evidence. An
  `activity_real` witness is discovery-eligible only when timestamp (±1 s),
  coordinate (≤5 m) and segment identity exist in the owned server Activity's
  acknowledged active `route_points` or finalized `route_points_canonical`.
- `passive_real` remains eligible through its accepted witness lifecycle. Two
  fresh accepted observations, existing accuracy and span policy, and the
  independent 50 m Cairn radius are always required.
- Offline walking may persist local truth but never creates a retrospective
  Cairn entitlement after reconnect. Existing committed request retry remains
  server-idempotent.

## Memory sharing and Union

- `memory_share_grants` is directional. New explicit grants use
  `full_history_delayed_v1`; legacy rows retain legacy scope.
- `memory_points.received_at` provides the durable server frontier. Shared
  contribution eligibility is `max(observed_at, received_at) + 30 minutes`.
- `memory_projection_preferences` distinguishes an explicit empty selection
  from an uninitialized selector.
- Exact points, timestamps and route lines are not returned to the viewer.
  Server projection returns fixed coarse cells after endpoint/private-place
  masking. Union is display-only and never writes to Mine/Fog truth.
- Client sharing state is fenced by `ownerId` and `expectedUserId`; owner change
  synchronously removes exact private-place coordinates and grants before the
  next render, and late prior-owner responses are ignored.

## Cairn revision/acquisition

- `cairn_revisions` stores immutable authorized snapshots by marker, content
  revision, audience and epoch/publication. It does not synthesize unpublished
  history.
- `markers.content_changed_at` is the millisecond-precision material-content
  frontier. It is updated in the same transaction as `content_revision`; the
  whole-second legacy `updated_at` is not used to order a Friend revision
  against visit entry.
- `cairn_acquisitions` retains snapshot-row uniqueness and is also atomically
  unique by logical `(viewer_id, marker_id, content_revision)`, so the same
  logical revision cannot be acquired again through another audience snapshot.
  `cairn_local_visit_acquisitions` additionally prevents a source redraw inside
  the same persisted visit.
- `cairn_collections` groups revisions by source for Left/Found, archive and a
  reader-owned remove tombstone. Remove blocks library, history, read, Thanks
  and future reacquisition for that source.
- `opened_at`, `thanked_at`, presentation `announced_at` and collection archive
  are independent state. Unread is one count per readable source group.
- Friend-acquired identity is snapshotted at acquisition. Public identity is
  exposed only while a current reciprocal friendship remains authorized.

## Discovery transaction

- `POST /api/cairn-memory/discover` locks the viewer, reads fresh evidence,
  restores/creates the durable locality visit, applies authorization and
  temporal boundaries, chooses all eligible current-Friend Cairns, then fills
  ordinary capacity from UPDATED/NEW_PUBLIC.
- Publication, friendship and Friends-audience epoch must have begun no later
  than the visit entry frontier; an edit/authorization change while stationary
  does not create a feed.
- Friend eligibility includes the current content revision's update frontier.
  Public candidates additionally require the viewer-side Public pilot gate;
  the gate does not suppress eligible Friend-only Cairns.
- `/api/cairn-memory/discover` is the only acquisition authority. The old
  `/api/friend-content/encounters/verify` endpoint fails closed with HTTP 410,
  and screen load is read-only.
- All acquisitions from one request share one preferred presentation group,
  even if a 20/100 Friend overflow transaction crosses the wall-clock merge
  window. This changes presentation only, never acquisition eligibility.

## Moderation

- A review case targets one logical immutable revision. Operator decisions
  require an explicit `decision_scope` of `revision` or `source`; revision scope
  applies to every audience snapshot for the same marker/content revision.
- Revision scope changes only that revision. Source scope gates current/future
  source discovery and all nonremoved acquired revisions.
- Confirmed removal is irreversible through the restore endpoint. It purges the
  scoped text/exact position/public snapshot and preserves metadata-only audit.
- Archive/Hide/Remove/Block are separate contracts and are not conflated.

## Queued Routes boundary

- One draft is an ordered traversal whose components may include imported
  segments and explicit unresolved gaps. Draw and Point are intent labels on
  edits, not separate permanent Route types.
- Route data may contain explicit geometry/provenance only. Friend Fog cells,
  private Activity timestamps, Cairn text and discovery state must not enter a
  saved/shared Route.
- Recipient sharing will create an immutable direct snapshot with idempotent
  exact delivery and a new delivery for revised content. It grants no Fog,
  Activity or Cairn entitlement.
