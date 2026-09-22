# Plant Product-DNA redesign

Date: 2026-09-13

Verdict: **CAIRN CORE IMPLEMENTED; PUBLIC FIELD-REPORT LAYER DEFERRED**

## Final product model

The user-facing object is a **Cairn**. **Plant** is the deliberate verb that creates one at a real place.

A Cairn v1 is a personal, durable place trace:

- location is the essential fact;
- name and note are optional enrichment;
- the default is personal;
- Activity provenance is retained when it was created during an active Hike/Run;
- offline creation is a valid completion, not an error state;
- rediscovery happens through the map, Activity association, Trails/Cairns list, and detail;
- editing enriches the same stable Cairn identity;
- Plant does not reveal Memory/fog. Movement and exploration remain the authority.

Danger, Water, Junction, and Hut are field-report concepts, not harmless styling choices. Asking a moving user to classify a personal trace as public trail intelligence mixes two products with different trust, moderation, expiry, and sharing requirements. Plant v1 therefore creates a Cairn and hides both taxonomy and audience selection in the moving compose flow. The existing broader type system remains available to legacy/detail code; a future report layer can make a deliberate product contract before exposing it.

## Authority and audit

The redesign began from [PLANT_PRODUCT_UX_AUDIT.md](./PLANT_PRODUCT_UX_AUDIT.md), current source, shared visual authority, and the existing [Plant current-state review](./PLANT_CURRENT_STATE_REVIEW.html). It did not treat the existing three-step form as the desired product.

The audit's strongest value survived: a locally durable on-site trace, stable client identity, Activity provenance, and later encounter. The following conflicts were not papered over:

- Plant/Mark/Marker/Cairn/Flag naming was fragmented.
- `cairn` was both the product noun and one field-report-like subtype.
- Quick Cairn intentionally saved empty content but surfaced as “Untitled Cairn.”
- Plant could contribute Memory evidence even though fog is movement-owned.
- offline pending enrichment could update UI while leaving the durable create payload stale.
- the backend schema rejected the client-supported `hut` type.
- failed sync badges looked actionable but did not perform a retry.
- map logo/attribution were disabled in pin adjustment.
- a fast server acknowledgement could beat the UI placeholder and leave duplicate/stuck state.

## Correctness fixes

| Defect | Fix | Boundary |
|---|---|---|
| Plant revealed unexplored fog | removed Cairn/reconciliation Memory writes | movement/exploration remains sole Memory authority |
| Pending edit changed only UI cache | `offlineEntity.updateLocal` updates the durable create payload | synced edits still require server acknowledgement |
| Failed Cairn had no real retry | shared badge invokes `offlineEntity.retry` | row is retained on hard failure |
| Synced edit swallowed failure | checks HTTP result and rolls back instead of claiming save | no false success offline |
| Stable client ID was replaced/ambiguous | keep client identity; store `serverCairnId` mapping | delete/edit select correct endpoint |
| Fast acknowledgement race | acknowledgement can materialize missing projection; later add is idempotent | one Cairn, one stable identity |
| Empty Quick Cairn leaked “Untitled” | deterministic `Cairn · <date>` rediscovery label | stored note remains truthfully empty |
| Client `hut` failed Joi validation | added `hut` to create/update schemas with tests | backend deployment required; none performed |
| Pin-adjust map hid legal UI | native logo/attribution enabled and placed | native visual compliance still needs device review |

No user coordinate is made editable through the generic Marker edit endpoint. The backend regression test explicitly preserves location immutability.

## Interaction depths

### Quick Cairn — Run

Quick Cairn stays a one-tap movement action:

1. use the last canonically accepted, fresh Activity fix;
2. create a personal Cairn in the durable local outbox;
3. link its stable local identity to the Activity;
4. haptic + “Cairn planted” confirmation;
5. continue running.

It never opens a form and never waits for the network. An unavailable/stale fix fails closed with “Current GPS location unavailable.” The resulting empty-content object now redisplays as `Cairn · <date>`, and detail supports later naming, notes, retry, or deletion.

### Hike Plant

During an active Hike/paused Hike with a fresh trusted fix, Plant enters directly at **Leave a Cairn** instead of making the user wait through another five-second GPS ceremony. A compact “Using your Activity location” surface explains the trusted source and offers **Tap to adjust**.

The compose decision is intentionally small:

- Name (optional)
- Note (optional)
- Plant Cairn

Submitting returns to the Activity after a success haptic. The user is not asked to choose a report taxonomy or audience while moving.

If the Activity fix is stale/unavailable, or Plant is entered standalone, the existing bounded GPS lock and pin-adjust steps remain. That preserves location trust rather than inventing convenience.

## Offline behavior

The Cairn is committed to a per-user durable outbox before UI success. Offline success says **Cairn planted (offline)** and **Saved locally**; the retained row uploads later with its stable UUID as both business identity and idempotency key.

The detail screen supports:

- retrying a retained failed create;
- editing a pending local Cairn by changing its durable payload;
- deleting a pending local Cairn by tombstoning and discarding its create row;
- retaining ownership isolation across account changes;
- server-backed edit/delete only when the server can acknowledge them.

Plant does not call a geocoder or map service to establish validity. Pin adjustment can lose its map while the coordinate and Cairn remain locally meaningful.

## Features kept, removed and deferred

Kept:

- trusted GPS sampling and bounded manual pin adjustment;
- one-tap Run Quick Cairn;
- optional name/note and existing title/body wire compatibility;
- personal default;
- durable offline outbox and stable client identity;
- Activity provenance and detail/list rediscovery;
- Day/Sunset/Night shared visual system;
- legacy type display/edit compatibility outside the moving v1 capture.

Removed from current Plant creation:

- required content;
- type selection;
- visibility/audience selection;
- Plant-created Memory/fog evidence;
- “Untitled Cairn” fallback;
- disabled Mapbox legal ornaments.

Deferred:

- a public field-report system, moderation and expiry;
- making Danger/Water/Junction/Hut claims from the moving flow;
- photo upload and voice memo production behavior;
- public discovery/social encounter expansion;
- reverse-geocoded place naming;
- destructive cleanup of historical Memory data.

No production data migration or cleanup was performed.

## Shared components and Product DNA

The redesign reuses current Cairn roles instead of adding a Plant-only design language:

- `BackButton`, `Icon`, `ContentSurface`, `SyncBadge` and existing sheet/navigation roles;
- shared spacing, radius, typography and visual-theme tokens;
- theme-aware input surfaces, borders, foreground hierarchy and primary actions;
- compact geometry and plain outdoor language;
- the same Saved locally / Syncing / Retry sync vocabulary used by Routes.

`MarkForm` gained scoped `showTypePicker` and `showVisibilityPicker` controls and theme-aware fields; existing edit surfaces retain both by default. This avoids duplicating a second Plant form.

Home, Friends and Auth source/layout were not edited. Shared `SyncBadge` can affect callers that show pending state, but its change is semantic/theme-role alignment rather than layout direction: fixed light colors became shared visual-theme tokens.

## User journey

```text
Run + fresh fix -> Quick Cairn -> durable local object -> haptic/toast -> keep moving
                                               |
                                               v
                                  list/map/detail enrichment later

Hike + fresh fix -> Leave a Cairn -> optional words -> durable commit -> return to Hike
                         |
                         +-> Adjust location -> bounded pin step

Standalone/no trusted fix -> GPS lock -> bounded pin -> optional words -> detail
```

The durable object is always a Cairn. The interaction depth changes with context; the data contract does not fragment.

## Visual before/after

Before authority:

- [current Plant review](./PLANT_CURRENT_STATE_REVIEW.html)
- [Home reference](../activity-ui/before/references/home-day-390x844.png)
- [Friends reference](../activity-ui/before/references/friends-day-390x844.png)
- [Hike/Product family reference](../activity-ui/after/product-family-review-board.png)

After evidence:

- [Plant convergence board](../../../app/_review/overnight-plant/plant-convergence-board.png)
- [capture script](../../../app/scripts/capture-overnight-plant-qa.mjs)

The 390×844 board shows standalone pin/compose and Activity compose in Day/Night. Automated checks prove that an empty Cairn can be planted, Activity-location copy is present, type/audience decisions are absent from moving compose, and there are no runtime errors. The local board is ignored from deploy-bearing Git; script and textual authority remain tracked.

## Tests

- `noteEncoding.test.ts`: stable date identity, legacy body fallback and title/body round trip.
- `plantTitleBody.test.ts`: multiline compatibility and no data loss.
- `useMarkerStore.fastAck.test.ts`: one stable synced Cairn under immediate acknowledgement.
- `offlineCommittedEntity.test.ts`: durable-before-network, retained failures, owner isolation, enrichment and retry.
- `plantSchema.test.js`: client `hut` create/update and immutable location.
- `freeActivityIntegrationContracts.test.ts`: committed provenance before cache and no Plant Memory producer.
- Expo visual capture: four 390×844 states, product-copy contract green, zero runtime errors.

## Remaining product decisions

- Define a separate field-report contract before exposing Danger/Water/Junction/Hut: who can see it, evidence/expiry, moderation, offline conflict resolution and correction.
- Decide whether Hike needs an in-Activity recent-Cairn tray; the map marker plus success return is the current rediscovery surface.
- Decide whether photo capture is part of quick enrichment or a later detail action.
- Run real iPhone VoiceOver, keyboard, haptic, GPS freshness and pin-drag review.
- Deploy the backend `hut` schema fix before treating Hut as accepted production input. No backend deployment occurred in this pass.

PLANT READY FOR PRODUCT-DNA VISUAL REVIEW
