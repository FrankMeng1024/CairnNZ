# Product flow

## Evidence-backed primary loop

```mermaid
flowchart LR
  A[Home] --> B{Start mode}
  B -->|Free Hike| C[Hiking Activity]
  B -->|Free Run| D[Running Activity]
  E[Selected Route] -. currently not retained .-> C
  E -. currently not retained .-> D
  C --> F[Completed Activity]
  D --> F
  F --> G[Processed trace + metrics]
  F --> H[Memory points]
  F --> I[Activity Detail]
  I -->|optional Save as Route| J[Route Editor]
  J --> K[Independent Route]
  K -. human-intended future reuse .-> E
  H --> L[Personal Fog / Memory]
```

- **FACT:** Solid edges are active.
- **FACT:** The selected-Route edges are visually present but semantically incomplete: screen-local selection does not reach the Activity payload.
- **HUMAN INTENT:** The reusable cycle should be `Route → Hike/Run → new Activity`, retaining provenance. Current code does not complete it.

## Activity lifecycle

```mermaid
sequenceDiagram
  participant UI as Hiking/Running
  participant TS as Tracking store
  participant FS as JSONL/filesystem
  participant API as Sessions API
  participant DB as sessions + memory_points
  participant SS as Session history

  UI->>TS: startTracking(mode)
  TS->>TS: idle -> requesting (duplicate guard)
  TS->>FS: create active recording
  TS->>API: POST session shell
  TS->>TS: establish real location source -> tracking
  loop GPS fixes
    TS->>FS: append point
    TS->>API: batched append backup
  end
  UI->>TS: pause / resume
  UI->>TS: finish (single in-flight lock)
  TS->>TS: map-match or smoothing fallback
  TS->>API: PATCH atomic save + Memory points
  API->>DB: finalize session and insert memory_points transactionally
  alt offline or server failure
    TS->>FS: durable pending sync / SAF-01 payload
  end
  TS->>SS: add local completed Activity
```

**FACT | LOCAL HEAD ONLY:** duplicate Start/Finish protection, mode-aware recovery parity, and Running map-readiness behavior are committed at local HEAD but absent from the currently deployed OTA.

## Cairn loop

```mermaid
flowchart TD
  HOME[Home] --> FULL[Full Plant]
  HIKE[Hiking] --> FULL
  TRAILS[Trails Cairns empty] --> FULL
  RUN[Running] --> QUICK[Quick Cairn]
  FULL --> MARKER[Marker/Cairn object]
  QUICK --> MARKER
  MARKER --> OWN[Own Cairn library]
  MARKER --> MEMORY[Memory pin]
  MARKER --> POINT[Memory point at coordinate]
  POINT --> FOG[Fog/exploration]
  QUICK -->|local ID only| ACT[Current Activity markerIds]
  FULL -. no association .-> ACT
```

- **FACT:** Both paths create the same Marker domain object.
- **FACT:** Full Plant is offline-first, category/content/privacy capable; Running Quick Cairn is private, blank, and one-tap.
- **FACT:** deleting the Marker does not delete the Memory point or Fog.
- **HUMAN INTENT:** the Hike/Run divergence is not a locked product decision.

## Friends cross-cutting effects

```mermaid
flowchart TD
  REQ[Friend request accepted] --> FRIEND[Mutual friendship]
  FRIEND --> FR[Friend-tier Routes]
  FRIEND --> FC[Friend-tier Cairns]
  FRIEND --> CAN[May select Memory subscription]
  CAN --> SUB[Memory subscription]
  SUB --> FF[Friend Fog]
  REMOVE[Remove or block friend] -->|implemented| NOFR[End mutual friendship]
  NOFR -->|fresh query| NOOBJ[End friend-tier Route/Cairn access]
  REMOVE -. missing cleanup .-> SUB
  SUB --> FF
```

- **FACT:** Friendship and Fog subscription are distinct relationships.
- **FACT:** current remove/block stops fresh friend-tier Routes/Cairns but does not stop Friend Fog.
- **PRODUCTION FACT:** missing subscription trigger further weakens intended authorization and the nominal cap.

## Memory and Fog source union

```mermaid
flowchart LR
  ACT[Completed Activities] --> SELF[Personal memory_points]
  PLANT[Plant creations] --> SELF
  F1[Subscribed friend A points] --> UNION[Spatial union]
  F2[Subscribed friend B points] --> UNION
  SELF --> UNION
  UNION --> MASK[Turf Fog mask]
  SELF --> H3[Derived H3 cache]
  MASK --> MAP[Memory map]
  H3 --> HOME[Home percentage proxy]
```

- **FACT:** Friend ownership is known before flattening; Activity/source provenance is not.
- **FACT:** overlaps are reconciled spatially, not by reference-counted explored cells.
- **FACT:** Home percentage is a point-count proxy, not exact unique explored area.

## Trails role

```mermaid
flowchart TD
  TRAILS[Trails screen]
  TRAILS --> A[Activities: Mine only]
  TRAILS --> R[Routes: Mine / Friends]
  TRAILS --> C[Cairns: Mine / Friends]
  A --> AD[Activity Detail]
  AD --> GR[Generate Route]
  R --> RD[Own Route Detail / Editor]
  C --> CD[Own Cairn Detail / Edit]
  R -. friend card detail currently broken .-> RD
  C -. friend card detail currently broken .-> CD
```

**FACT:** Trails currently combines history, library, management, friend content, search/filter/sort, and discovery-adjacent Cairn presentation. It is not itself a Route domain and it is not a bottom tab.

## Product loops

### Primary product loop

**FACT:** `Home → free Hike/Run → Activity → trace/metrics → Memory/Fog → history/detail` is the only complete end-to-end loop.

### Secondary loops

- **FACT:** `Activity → optional Route generation → Route editing/library` is complete through Route creation, but reuse into a new Activity is not.
- **FACT:** `Home/Hiking → Plant → Cairn → Trails/Memory` is complete for create/view, with inconsistent Activity linking and deletion semantics.
- **FACT:** `Friend request → friendship → friend Routes/Cairns` is active, with detail-routing and cache-revocation gaps.
- **FACT:** `Memory friend selection → friend Fog union` is active, with authorization/revocation and entitlement gaps.

### Management/library loops

- **FACT:** Trails Activities supports filter/sort/detail/local rename/delete/generate Route.
- **FACT:** Trails Routes supports Mine/Friends, search/filter/sort, own detail/edit/delete.
- **FACT:** Trails Cairns supports Mine/Friends, category/permission filters, sort, own detail/edit/delete.
- **FACT:** Settings owns profile, account/export, Memory reset, display preferences, and hidden diagnostics.

## Loop verdict

The proposed global model is mostly supported but must be qualified:

`ROUTE / FREE EXPLORATION → HIKE / RUN → ACTIVITY → TRACE / METRICS / CAIRNS → MEMORY / FOG → OPTIONAL ROUTE`

- **FACT:** Free exploration through Activity, trace/metrics, Memory/Fog, and optional Route works.
- **FACT:** Cairns are not consistently Activity-associated and are not part of the atomic session save.
- **FACT:** Route → new Activity identity/provenance is absent.
- **FACT:** Friends cross-cut Routes/Cairns through mutual friendship but Fog through separate subscriptions.
- **FACT:** Trails hosts history/library/management; it is not yet a coherent public discovery surface.
