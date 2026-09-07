# Cairn and Activity analysis

## Terminology and current authority

**FACT:** `Marker` is the frontend/backend storage term. “Cairn” is the primary UI noun. “Plant” is the full creation workflow/verb. Run quick-plant creates the same `Marker` domain object; it is not a different backend Cairn subtype.

## Current Hike Cairn journey

1. In an active or paused Hike, expanding the action tray exposes **Cairn**.
2. Tapping it navigates to `Plant` without Activity parameters and does not pause the shared recorder.
3. Plant independently takes a five-second GPS sample, freezes that GPS anchor, lets the user move the pin up to the configured local limit, then collects type, title/body, optional local voice memo, and visibility.
4. Default type is `danger`. Current Plant configuration defaults visibility to **Just me** (`personal`); Friends (`group`) is selectable and Public is currently hidden/disabled in the Plant UI.
5. The title and body are encoded into the single Marker `note/text` field using a record-separator character.
6. `useMarkerStore.addMarker` first persists an offline entity with a client operation ID, adds a local pending Marker, and lets the marker sync daemon upload it. Full Plant works without network as long as local storage succeeds.
7. Success gives haptic feedback and replaces Plant with Marker Detail. If Plant was opened over Hiking, Back from Marker Detail returns to the still-mounted, still-recording Hike.
8. A hard local save failure keeps the user on the content step, saves a draft best-effort, and shows a native Alert. Offline success explicitly says the Cairn was saved locally.
9. Plant does not provide Activity identity. The resulting Marker has no `sessionId` and the Activity has no new `markerId` from this path.

**FACT — contradiction:** `PlantScreen` comments state that Plant no longer changes Fog, but the active common `addMarker` implementation always appends one Memory point and one H3 visit at the Marker coordinate. Full Plant therefore currently changes personal Memory/Fog immediately.

## Current Run Cairn journey

1. The expanded Run tray exposes **Cairn** and disables it until `lastCoordinate` exists.
2. One tap calls quick-plant. It uses the latest accepted tracking coordinate, type `cairn`, visibility `personal`, empty content, region code, and current local `sessionId`.
3. `addMarker` performs the same local-first pending write as Full Plant. The live Activity also appends the returned local Marker ID to `markerIds`.
4. The user gets “Cairn planted” or “Failed to plant cairn” toast feedback; there is no category/privacy/content confirmation.
5. On server acknowledgement, the Marker’s displayed `id` changes from local operation ID to server ID while `localId` and the local `sessionId` field remain in the cached Marker.
6. The Activity’s `markerIds` list is not reconciled when that Marker ID changes. Activity Detail displays the stored count, but map Cairns are selected by proximity (within 80m), not by exact association.
7. The backend create payload and Marker table omit `sessionId`. Cross-device hydration loses the local association.
8. The same common `addMarker` path adds a personal Memory/H3 point immediately.

## Option feasibility

| Option | Interaction cost | Current fit | Required architecture | Association/discoverability | Offline and migration implications | Grade |
|---|---|---|---|---|---|---:|
| **A. Hike Full Plant; Run Quick Cairn** | High interruption for Hike; lowest for Run | This is current behavior | Small flow polish; **architecture change** only for durable provenance | Hike currently unlinked; Run locally linked but not server durable; exact Activity Detail list needs new relation | Both create offline today. Additive origin fields and ID reconciliation required | **A** current UX; **C** complete foundation |
| **B. Both use Full Plant** | High and potentially unsafe while moving for Run | Hike exists; Run can navigate to it | Navigation is small; clean tracking return and durable provenance require a Plant context contract plus schema work | Plant must receive stable Activity origin and return intent | Existing offline queue reusable; drafts need origin migration/expiry semantics | **B** basic; **C** complete foundation |
| **C. Shared simplified activity-Cairn flow** | Moderate, consistent, tunable by mode | No such active flow | New shared Activity Cairn boundary and presentation; can reuse Marker store/offline entity | Natural place to require/retain Activity origin and later list exact Cairns | Offline primitive exists; payload/schema and draft version migration needed | **C** |
| **D. Run Quick, enrich from Activity Detail** | Minimal during Run; deferred work later | Quick create and Marker Detail exist | Reliable exact association/reconciliation plus an Activity Detail Cairn list/enrichment action | Highest dependency on durable origin and local/server ID mapping | Offline quick-create is strong; ID acknowledgement currently leaves Activity `markerIds` stale | **C** |

Code convenience does not resolve which interaction is correct. This is a product decision.

## Cairn ↔ Activity association

**ARCHITECTURE CHANGE PROPOSAL REQUIRED.**

### Current identity timing

At Start:

- **FACT:** `startTracking` synchronously generates `localSessionId` before requesting permission or creating native/server resources and places it in the tracking store while status becomes `requesting`.
- **FACT:** after foreground permission succeeds, the same local ID keys the JSONL writer and remains the local Activity/history ID.
- **FACT:** `startSession` runs asynchronously. A numeric `remoteSessionId` may arrive later or remain `null` when offline.
- **FACT:** the final local `TrackingSession.id` is the original local ID; `remoteId` is attached separately when known or after pending sync.

At Cairn creation:

- **FACT:** a stable device-local Activity identity is available after a successful Start, including offline.
- **FACT:** Run already places it in the local Marker only. Full Plant does not read or receive it.
- **FACT:** marker offline payloads send `client_op_id` for Marker idempotency but omit Activity origin.

At final save:

- **FACT:** the local Activity retains the local ID; the backend Activity is identified by numeric session ID. The backend does not persist a client session ID today.
- **FACT:** server hydration can represent remote sessions with numeric-string local IDs, while the store deduplicates via `remoteId`; this is not a durable server-side origin key for offline-created Cairns.

### Schema/reconciliation options

1. **Recommended robust shape:** add a unique client Activity identity to `sessions` (for example `client_session_id`, unique per user), plus nullable `markers.origin_session_id` with `ON DELETE SET NULL`. Allow marker creation to include `origin_client_session_id`; resolve it immediately when possible and retain/reconcile it when Marker upload beats Activity upload.
2. Add only nullable `markers.session_id` pointing to numeric sessions. This is simple online but cannot represent an offline Cairn created before the server Activity exists without a pending link operation.
3. Use an `activity_markers` join table. This supports future many-to-many semantics, but current human intent describes one optional origin Activity, so it adds complexity without current evidence.
4. Persist only an opaque client Activity ID on Marker. This handles offline order but weakens referential integrity and authorization unless the server validates ownership and reconciliation carefully.

### Required deletion semantics

- **HUMAN INTENT:** Activity deletion must not delete Cairn.
- **Recommended relational behavior:** `ON DELETE SET NULL`, never cascade.
- **HUMAN INTENT:** Cairn deletion must not change Activity or personal Memory/Fog.
- **HUMAN INTENT:** personal exploration is monotonic after genuine exploration. Origin association must never become the owner of Memory/Fog cells.
- **Product decision remains:** whether deleting Activity clears all provenance or leaves non-navigable historical origin metadata.

### Migration risk

- Additive nullable columns are low schema risk.
- Client/server dual identity, upload ordering, idempotent link reconciliation, and local Marker ID acknowledgement are medium architecture risk.
- Existing Markers require no backfill unless a reliable historical association can be proven; proximity must not be used as authoritative backfill.
- Existing local `sessionId` Marker fields cannot be assumed durable or globally resolvable.
- Account deletion remains allowed to cascade both Activities and Cairns through the user; this is separate from deleting one Activity.

### Screens that benefit

- Activity Detail can show exact created-during Cairns instead of an 80m proximity guess.
- Marker Detail can show “created during [Activity]” and navigate when the Activity survives.
- Hike/Run can provide consistent post-create feedback.
- Trails Cairns can filter by Activity origin.
- Option D enrichment can reliably find quick Cairns after sync/relaunch/cross-device hydration.

## Memory and Fog effects in this journey

| Event | Current effect | Authority finding |
|---|---|---|
| GPS point recorded during Activity | No immediate Memory/Fog write | **FACT** |
| Valid Activity Finish | Smoothed/snapped-or-fallback trace is flushed to local Memory; unsynced points join the atomic/pending save payload | **FACT** |
| Full Plant | Common Marker creation immediately adds one Memory point/H3 visit | **FACT**, despite stale Plant comments |
| Run quick Cairn | Same immediate point/H3 addition | **FACT** |
| Delete Activity | Deletes Activity/local track cache and requests server delete; does not remove Memory points | **FACT; matches human rule** |
| Delete Cairn | Removes Marker locally and requests server delete; does not remove Memory points | **FACT; matches human rule** |
| Explicit Reset my map memory | Deletes Memory by separate typed destructive action | **FACT; intentional exception** |

Fog therefore changes after Activity Finish, not continuously during recording, but may change immediately when either Cairn path calls `addMarker`. A discarded Activity can leave a Cairn-origin Memory point if a Cairn was genuinely planted during it; that is compatible with the monotonic exploration rule.
