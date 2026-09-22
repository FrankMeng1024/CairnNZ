# 02 — Cairns, Encounters, Routes, and trust

## Verdict

Current Cairn creation is substantially more durable than older audits described, but Cairn retrieval, public encounter semantics, and moderation are not a coherent product system. There is no reachable All Cairns journal, no Encounter domain object or state ledger, and no normal path for a user to open and safely interact with a stranger's Cairn. Routes are durable offline and remain distinct from Activities, but their Activity origin, walked/planned segment provenance, and version lineage are not persisted by the server. The blueprint should build on these boundaries, not assume its proposed lifecycle already exists.

## Cairn capability map

| Journey/surface | Current behavior | Trust boundary |
|---|---|---|
| Plant | Offline-first create; success replaces navigation with own full detail | Durable local entity/outbox, server idempotency, ack reconciliation |
| Run quick Cairn | Offline-first create while recording | Run map passes no Cairn pins, so capture does not create an immediate detail/discovery surface |
| Hike | Own regional Cairns shown while session visible; sheet can open own edit/detail | Own objects only |
| Activity Detail | Route-associated/nearby own Cairns shown in `MapHistoryScreen` | Own marker store filtered by region/session presentation |
| Memory | Own Cairns passed as interactive `allMarkers`; public bbox results passed separately as blurred strangers | Friend `circleMarkers` are not supplied to this map |
| Trails | Activities + Routes and “Find a Route” | No All Cairns tab/list/search in current/O56 |
| Marker Detail | `MarkerDetailScreen` resolves from own marker store | Not a universal friend/public detail screen |

Normal navigation evidence: `app/src/screens/RoutesScreen.tsx:408-423`, `PlantScreen.tsx:140-215`, `HikingScreen.tsx:233-257,1214-1241`, `MapHistoryScreen.tsx:919-920`, `MemoryMap.tsx:108,538`, and `MarkerDetailScreen.tsx:105`. An older `MapHistoryScreen` contains legacy branches, but unparameterized normal navigation redirects and does not restore an All Cairns product surface.

### Creation and mutation durability

Current Cairn creation captures a user-scoped local ID/client Cairn ID and immutable creation provenance in the business-entity outbox before upload (`app/src/store/useMarkerStore.ts:225-315`; `app/src/services/markerOfflineEntities.ts:28-159`). Server acknowledgement preserves identity, and deletion writes a tombstone to prevent a late acknowledgement from resurrecting the object (`useMarkerStore.ts:452-495,855-908`; `markerTombstones.ts`). Focused local tests cover fast acknowledgements, committed entity behavior, tombstones, and ownership.

That proof does not extend uniformly to mutation:

- a still-local Cairn can be edited/deleted through the outbox;
- a synced Cairn edit calls the server and rolls back on failure rather than queuing a durable edit;
- a synced delete has tombstone/retry support, but no current physical-device/offline field proof was found.

Ordinary Cairn deletion does not remove personal Memory; that matches accepted authority.

## Retrieval and the missing personal journal

There is no stable, ordinary-user All Cairns index/search. A user can reach an own Cairn spatially from Memory/Hike, from a linked Activity presentation, or immediately after Plant, but cannot reliably browse their full Cairn history. This is a current product/reachability gap, not evidence loss.

The blueprint's proposed personal journal is compatible with the current ownership model. The smallest credible slice should reuse the marker store, offline identity, and own detail, while making list/search/detail convergence explicit. Archive semantics are a product decision and are not required merely to expose the existing objects.

## Public Cairns and interaction reachability

Client and server reject client writes with `permission='public'`; public objects are seed/operations-created (`backend/src/routes/markers.js:205-226,358-376`). The public bbox endpoint returns exact location plus light metadata for at most 50 objects (`markers.js:135-192`). Memory loads these as `strangerMarks`, but renders them blurred/noninteractive rather than as a detail journey (`MemoryScreen.tsx:824-831`; `CairnPinsLayer.tsx`).

Friend/public content APIs exist:

- `/api/circle/markers` returns exact full friend/public Cairns for current friends and applies personal hide filtering;
- `/api/circle/routes` returns full friend/public Route geometry;
- `FriendsScreen` calls `loadCircleMarkers`, but current Memory does not consume `circleMarkers`;
- `loadCircleRoutes` has no normal caller, and Trails intentionally does not render circle routes.

Thus an API capability is not a user capability. Current source even contains visibility logic able to classify a Cairn as revealed through self or friend fog, including Cairns created later inside old fog. Because the displayed Memory marker input is own-only and strangers are noninteractive, this logic is dormant for a normal public/friend discovery journey.

### Like, report, hide, moderation

The lower layers are real:

- `CairnPinsLayer` supplies Like/report callbacks to `MarkDetailSheet` (`CairnPinsLayer.tsx:473-599`).
- Marker interaction uses a server nonce, submitted client coordinates, a 50 m server range, maximum accuracy 100 m, a 60-second clock window, impossible-travel defense, one vote per user/marker, and automatic hide after five reports (`app/src/services/markerInteractionService.ts`; `backend/src/routes/markers.js:470-744`).
- `/api/hide` and local hide state exist.

But normal reachability fails:

- interactive Memory markers are the user's own; the server refuses an owner's helpful vote;
- public strangers are blurred/noninteractive;
- Hiking's own-marker sheet is not wired with Like/report;
- non-owner hide handlers in ordinary sheets remain no-op/TODO paths;
- no moderator/admin review queue, ownership, appeal, or disposition workflow exists;
- block filtering does not govern the public bbox endpoint.

The code is therefore **source-present but product-unreachable**. It must not be described as a launched community safety system.

## Encounter lifecycle: absent, not implicit

No Encounter table, API, client object, reconciliation job, or state ledger was found in current source or the production schema. These potentially distinct events are not independently persisted:

1. location/permission eligible;
2. candidate Cairn near the user;
3. presented on-screen;
4. detail opened;
5. saved/hidden;
6. explicit Thanks/report;
7. moderator disposition.

Generic marker votes and personal hides are not an Encounter ledger. A Cairn being inside a fog buffer is not proof that it was presented or seen. Likewise, the author does not receive viewer identity, time, or location from an ordinary view because there is no view event. Explicit Like/report calls would disclose authenticated user and submitted coordinates/time to the service, but those actions are not normally reachable for strangers today.

The blueprint's separation of eligibility, presentation, opening, and deliberate interaction is compatible and necessary. Exact thresholds, retention, author notification, anonymity, and abuse-handling policy remain product/privacy decisions.

## Route system: current truth

### What is solid

- Route creation is offline-first and user-scoped (`useRouteStore.ts:281-315`; `routeOfflineEntities.ts:1-70`).
- Nested arrays are copied, so later Activity enhancement cannot mutate an already-created Route.
- The backend validates that a supplied source Activity belongs to the same user and is finalized, in a transaction that races safely with Activity deletion (`backend/src/models/Route.js:20-82`).
- Once committed, the Route is an independent object and survives deletion of its source Activity.
- Personal/friend permission is stored. Public client creation/update is rejected.
- Hike/Run may select an own Route and show its full polyline as guidance; planned Route geometry does not add personal Memory, while the separately recorded Activity can.

### What is not durable trust

The backend uses source Activity IDs only to validate creation; it inserts no source ID into the Route row (`Route.js:31-42,69-82`). The table/API stores current `points`, `waypoints`, distance, elevation and permission, but no:

- source Activity identity;
- immutable original geometry;
- Route version lineage;
- walked versus planned/manual segment types;
- “used this Route” Activity relationship or start-time snapshot;
- copied/shared source and revocation semantics.

Local `originalPoints`, `segments`, and extras can support editing on the originating device (`app/src/store/useRouteStore.ts:43-75`; `LocalRouteExtras.ts`), but the create payload sends only the display geometry and waypoints. A fresh device/server reload loses those provenance distinctions. An edit replaces points, so the displayed result can look wholly walked even when portions were manually drawn or matched.

Friend Routes are fully disclosed to current friends through `/api/circle/routes`, including geometry and endpoints, with no trimming or sensitive-zone policy (`backend/src/routes/circle.js:141-189`). Current UI does not call the loader, and there is no copy/export/reference workflow.

### Guidance and corridor findings

`RouteFollower`, voice guidance, and `useRouteFollowing` are implemented and tested, but application-source search found no normal call to `useRouteFollowing()` and no call to `setFollowingRoute()` outside the store. Current product behavior is a map overlay with guidance copy, not active turn-by-turn following.

The current Route correction brush uses a 250 m baseline corridor and 50 m endpoint anchors (`app/src/store/useRouteEditStore.ts:83-86,582-641`). A further snap-result gate uses the stroke corridor. These are client editing constraints, not proof that geometry was walked and not server validation. The old “100 m” finding is **SUPERSEDED**.

Map Matching limits in source:

- initial Route creation: one request after downsampling to at most 100 coordinates (`app/src/services/routeMatcher.ts`);
- brush edits: at most 100 coordinates per request and one retry for timeout/network/5xx (`MapMatchingClient.ts`);
- backend accepts submitted geometry without independently enforcing the client corridor.

## Six-level evidence summary

| Capability | Source | User reachable | Automated proof | Deployed match | Device loaded | Real field |
|---|---:|---:|---:|---:|---:|---:|
| Plant/quick Cairn create | YES | YES | YES | PARTIAL | UNKNOWN | UNKNOWN |
| Synced Cairn edit/delete offline safety | PARTIAL | YES | PARTIAL | PARTIAL | UNKNOWN | UNKNOWN |
| All Cairns personal journal | NO | NO | NO | NO | NO | NO |
| Public Cairn discovery/detail | PARTIAL | PARTIAL | PARTIAL | PARTIAL | UNKNOWN | NO |
| Like/report/hide journey | YES | NO | PARTIAL | PARTIAL | UNKNOWN | NO |
| Moderation operations | NO | NO | NO | NO | NO | NO |
| Encounter ledger | NO | NO | NO | NO | NO | NO |
| Route offline creation/cache | YES | YES | YES | PARTIAL | UNKNOWN | UNKNOWN |
| Activity→Route source validation | YES | YES | YES | UNKNOWN | UNKNOWN | UNKNOWN |
| Durable Route provenance/version | NO | NO | NO | NO | NO | NO |
| Active Route following | YES | NO | YES | PARTIAL | UNKNOWN | NO |
| Friend Route consumption/copy | PARTIAL | NO | PARTIAL | PARTIAL | UNKNOWN | NO |

## Recommended trust order after product approval

1. Establish release truth first (M0 in report 05).
2. Make existing personal Cairns reliably retrievable before adding public discovery.
3. Define and persist Encounter states before claiming exposure, engagement, or author feedback.
4. Add moderation ownership and block/hide behavior before a public pilot.
5. Persist Route origin/version/segment semantics before presenting edited/shared Routes as evidence-backed.

No part of that sequence was implemented by this audit.
