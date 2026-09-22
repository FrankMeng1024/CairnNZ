# Offline Activity / Route-state UX

Date: 2026-09-13

Verdict: **IMPLEMENTED FOR LOCAL FINISH AND ROUTE CREATION; BACKGROUND FINAL ENHANCEMENT REMAINS A FOLLOW-UP**

## Product model

One overloaded status cannot explain whether an Activity exists safely, whether the server has it, whether presentation geometry can be improved, and whether it is suitable as a future Route. The implementation now derives four independent axes:

| Internal axis | Values | Product question |
|---|---|---|
| Local readiness | `ready`, `loading`, `unavailable` | Is the Activity usable on this device now? |
| Server sync | `synced`, `pending`, `syncing`, `error` | Has the Activity reached the account/server? |
| Final enhancement | `base`, `refining`, `enhanced`, `limited`, `unknown` | How finished is display geometry? |
| Route readiness | `ready`, `needs_review`, `missing_section`, `unavailable` | Can a new independent Route be made responsibly? |

A fifth derived axis selects the useful manual action: none, keep-or-snap, or choose-or-reconnect. None of these states changes canonical Activity truth.

The implementation lives in `activityRouteState.ts`, while `TrackingSession.finalGeometryState` persists the display lifecycle independently from `syncState`.

## User-visible language

Internal terms such as canonical, tracepoints, matcher confidence, WAL, network islands, and Map Matching are not exposed. Activity Detail uses:

- **Activity saved** — local geometry and summary are available.
- **Waiting to sync** / **Syncing activity…** / **Sync issue · tap to retry** — server state only.
- **Route ready** — Base or enhanced geometry can seed a Route.
- **Saved locally** — shared badge language for a pending Cairn or Route object.
- **Refining route** — modelled for a future background enhancement worker.
- **Route needs review** — geometry is usable, but map/trail evidence is limited.
- **Missing section** — a true GPS Gap remains in the Activity.

For a Gap, the explanatory copy is explicit: “Your Activity keeps the GPS gap. You can choose a recorded section or explicitly reconnect a new Route.”

## Offline Finish

Finish validity does not depend on network availability:

1. Canonical accepted evidence remains the metric/Memory source.
2. Final V2 produces an offline-safe Base Final per real segment.
3. The local Activity summary and track geometry are committed with `syncState=pending` when necessary.
4. Detail is immediately usable and says **Activity saved**, even while server upload is pending.
5. The pending Activity upload remains idempotent and replays later.

The UI no longer equates “not on server yet” with “save failed.” A failure to durably preserve the local Activity is still a real save failure and remains fail-closed.

## Online enhancement

Mapbox is still attempted inside the bounded Finish envelope when available. Accepted evidence can yield `enhanced`; a safe mixture yields `limited_evidence`; zero accepted network distance remains `base_ready` even if candidate requests returned successfully.

The data model and copy support `refining`, but this pass did **not** add a service that mutates an already-saved Activity when the device later reconnects. That requires its own durable job, versioned comparison, and user-visible update policy. It must not silently mutate any Route already created from the Activity.

## Save as Route rules

Network state is not the gate. Route quality is:

- One real segment with at least two points: **Route ready**, including offline Base Final.
- Limited map/trail evidence with one continuous segment: **Route needs review**; keep-as-recorded remains valid.
- Multiple real segments or explicit Gap connectors: **Missing section**; the user must choose a recorded segment or explicitly reconnect in the new Route.
- Fewer than two local points: **Route unavailable**.

Route creation is now a durable B-class offline entity. The new Route:

- gets a stable local UUID and appears immediately;
- deep-copies points, original points, segments, and waypoints;
- persists in a per-user local cache and create outbox;
- uses the same local UUID as the backend idempotency key;
- maps to `remoteId` on acknowledgement without replacing the local identity;
- survives network errors, process death, account switching, and retry;
- cannot be mutated by later Activity enhancement because it owns copied geometry.

## Manual review and reconnect

The Gap action sheet now offers:

- a recorded segment on its own; or
- **Reconnect in Route**, which deliberately opens a new Route draft over the real segments.

Flattening the segments occurs only in the Route-creation navigation payload after that explicit choice. The Activity's stored segment IDs, Gap connector, metrics, and Memory are not rewritten.

For limited evidence without a Gap, the current action is “Review Route”; the editor supplies keep-as-recorded/edit behavior. A future map-aware section tool may add “Snap this section,” but no unproven matcher-specific editor was forced into this pass.

## Sync behavior

Routes and Cairns reuse the shared `SyncBadge` language:

- `pending` → **Saved locally**
- `syncing` → **Syncing…**
- `failed` → **Retry sync**
- `synced` → hidden by default

The generic durable entity gained two coherent operations: update a still-local payload, and explicitly retry a retained hard failure. A route-source `409 SOURCE_ACTIVITY_NOT_FOUND` is treated as transient because Activity and Route queues may race after reconnection.

Route create also uses the backend's existing idempotency middleware. This closes the response-loss case where retrying a successful create could otherwise make a duplicate Route. A fast-ack test proves that acknowledgement between disk commit and UI projection still yields one stable Route.

Plant uses the same retained-row/manual-retry semantics; an offline-created Cairn can be enriched or deleted locally before sync.

## Operation matrix

| Scenario | Immediate product result | Later behavior | Status |
|---|---|---|---|
| Online Finish / enhancement accepted | Activity saved; Route ready or limited | server sync and enhanced Final | implemented |
| Offline Finish / Base good | Activity saved; Route ready | Activity uploads later | implemented |
| Offline Finish / Base ambiguous | Activity saved; Route needs review | optional future refinement | implemented state/copy; no later worker |
| Online return / enhancement succeeds | existing Activity remains valid | future worker may update Activity display only | state model only |
| Online return / enhancement fails | Base remains usable | no validity loss | state model only |
| App killed before Activity sync | local Activity/pending payload remain | idempotent replay and registry recovery | existing durable path retained |
| Multi-hour no network | Detail, metrics, Base Final and local interactions work | sync waits for connectivity | implemented/automated offline evidence; real device duration needed |
| True Gap | Activity displays missing section truthfully | choose a segment or explicit Route reconnect | implemented |
| Route created before Activity enhancement | independent deep copy | Activity changes cannot mutate Route | implemented/tested |
| Route manually edited before Activity enhancement | Route editor owns its draft/object | no Activity-to-Route mutation path | implemented boundary |
| Server sync failure | local object retained | automatic backoff or explicit Retry sync | implemented |
| Delete offline — pending Activity | local tombstone + pending removal | tombstone reconciliation deletes any late server row | implemented |
| Delete offline — pending Cairn/Route | local object and create outbox discarded | no later create | implemented |
| Delete offline — already-synced Route | object remains if server cannot acknowledge | retry remains a future mutation queue | intentionally online-owned |
| Rename offline — pending Activity | pending payload and local summary update | uploaded with new name | implemented |
| Rename/edit offline — pending Cairn/Route | durable create payload updates | create later uses enriched data | implemented |
| Rename/edit offline — already-synced Activity/Route | no false success; operation fails/rolls back | retry with connection | unresolved follow-up |

## Screenshots and state boards

The reproducible Expo Web capture runs at 390×844 in Day and Night and covers Base-ready pending upload plus a true-Gap review state:

- [offline Activity state board](../../../app/_review/overnight-offline-activity/offline-activity-state-board.png)
- [capture script](../../../app/scripts/capture-overnight-offline-activity-qa.mjs)

Automated copy checks confirmed Activity saved, waiting-to-sync, Route ready, Missing section, and Review Route language with no runtime error or horizontal overflow. The board is intentionally ignored from deploy-bearing Git; the script and this textual authority are tracked.

## Tests

- `activityRouteState.test.ts`: offline-ready, enhanced, limited-evidence and true-Gap derivation.
- `useRouteStore.offline.test.ts`: disk-first create, deep geometry independence, idempotency key and fast acknowledgement.
- `offlineCommittedEntity.test.ts`: local-before-network, acknowledgement-loss retention, 4xx retention, account isolation, enrichment and explicit retry.
- `freeActivityIntegrationContracts.test.ts`: segment-local Final, canonical Memory, Activity/Route deletion and Route independence contracts.
- Visual state capture: four 390×844 Activity Detail frames, all copy assertions passing.

## Unresolved product decisions

- Whether later online Activity enhancement should happen automatically, require a visible “Refine” action, or only affect newly-created Routes.
- Whether already-synced Activity/Route rename and deletion deserve their own durable mutation queue.
- The exact section-edit interaction for “Snap this section”; shipping matcher terminology would violate current product language.
- Native VoiceOver phrasing and offline/online transition timing need device validation.

These do not block safe offline Finish or offline Route creation. They do block claiming the entire future enhancement lifecycle is complete.
