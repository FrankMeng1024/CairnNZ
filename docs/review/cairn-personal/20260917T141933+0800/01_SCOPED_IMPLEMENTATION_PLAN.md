# CARD-CAIRN-01 scoped implementation plan

Run ID: `20260917T141933+0800`

## Already working and preserved

- Plant and Quick Cairn creation remain the creation authorities.
- Existing client-generated Cairn identity, pending-create storage, server acknowledgement, and tombstones remain the persistence foundation.
- CARD-AD-01's Activity Detail, its explicit Activity-to-Cairn association, and candidate marker `O57` remain intact.
- Memory remains the spatial rediscovery surface; Trails remains the two-library Activities/Routes surface.
- Existing shared Cairn typography, controls, sheets, and Day/Sunset/Night roles remain the visual authority.

## Defects addressed in this slice

- Own Cairn Detail did not provide a complete, truthful edit/delete experience for pending and synced Cairns.
- Empty Quick Cairns exposed weak storage-oriented presentation instead of a valid date-based Cairn identity.
- Personal Cairns had no normally reachable, owner-only management list outside the map boundary.
- Identity matching and late acknowledgement handling could duplicate or overwrite a newer local projection.
- Existing retrieval was region/cache-shaped and could not honestly claim complete owner history.
- The CARD-AD-01 product-family board mislabeled historical Trails, Plant, and Hike/Run screens as current references.

## Minimum supporting changes

- Add stable identity/merge helpers shared by Detail and All Cairns.
- Make pending edits rewrite durable pending payloads and make synced mutations acknowledge real server outcomes.
- Add an authenticated, owner-only paginated/searchable history endpoint locally, with an old-backend client fallback that identifies its partial scope.
- Add a normal Memory-to-All Cairns route and reuse the existing Own Cairn Detail for every row.
- Preserve tombstones through create/update acknowledgements and account changes.
- Correct the Web map availability boundary so a blank fallback is not treated as Mapbox proof.

## Excluded work

- Activity Detail redesign; Route Detail; Route Planner; Memory/Fog redesign; Friends/Public/Encounter; non-owner Cairn Detail; sharing; media; full sync-framework replacement; production deployment; OTA publication; native/field validation.

