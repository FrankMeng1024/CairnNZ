# Route requirements delta

This is a scoped delta against the existing UI requirements register. It does not replace that register and does not mark the page device- or owner-accepted.

| Requirement | Capability IDs | Implementation | Automated proof | Visual proof | Deployment | Device loading | Owner acceptance |
|---|---|---|---|---|---|---|---|
| `RQ-ROUTE-001` own Route list/open/rename/delete/use | `ROUTE-01` | Implemented candidate | Pass | `ROUTE-VIS-003`–`012` | Client pending OTA; origin backend not required for legacy behavior | Unverified | Pending |
| `RQ-ROUTE-002` independent Activity -> Route | `ROUTE-02` | Implemented candidate | Pass | `ROUTE-VIS-001`–`005` | Client pending OTA | Unverified | Pending |
| `RQ-ROUTE-003` durable minimum origin/edit distinction | `ROUTE-03` | Implemented locally; bounded minimum only | Pass, including model persistence/reload | `ROUTE-VIS-003`, `005`, `007`, `014` | Migration/backend deployment required | Unverified | Pending |
| `RQ-ROUTE-004` truthful Hike/Run reference use | `ROUTE-04` | Implemented candidate | Pass | `ROUTE-VIS-009`–`011` | Client pending OTA | Unverified | Pending |
| `RQ-ROUTE-005` truthful editor/mutations | `ROUTE-01`, `ROUTE-02` | Implemented candidate | Pass | `ROUTE-VIS-002`, `006`, `008`, `012`, `016` | Client pending OTA; modern tombstone endpoint requires backend | Unverified | Pending |
| `RQ-ROUTE-006` Route-only explicit reconnect | `ROUTE-02`, `ROUTE-03` | Implemented candidate | Pass | `ROUTE-VIS-013` | Origin deployment required for fresh-device survival | Unverified | Pending |
| `RQ-TRAIL-003` canonical create/reopen/detail destination | `ACT-03`, `ROUTE-01` | Implemented candidate | Pass | `ROUTE-VIS-003`–`005` | Client pending OTA | Unverified | Pending |
| `RQ-OFFLINE-001` independent local/sync/usability truth | `CAIRN-01`, `ROUTE-02`, `ACT-03` | Implemented Route scope; prior Cairn/Activity work preserved | Pass | `ROUTE-VIS-003`, `012`, `013` | Modern server features pending | Unverified | Pending |
| `RQ-ROUTE-007` active guidance / later planner scope | `ROUTE-05` | Not implemented; out of scope | Not claimed | None | No | Unverified | Pending |

`RQ-ROUTE-003` is closed only for the explicitly authorized minimum contract. Complete per-segment walked/planned lineage, a version tree, collaborator provenance, safety claims, and active navigation remain outside this delta.

