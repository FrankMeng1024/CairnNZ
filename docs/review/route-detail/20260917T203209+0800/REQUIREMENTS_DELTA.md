# Route requirements delta — revision 02 correction

This is a scoped correction to the existing Route requirements delta. It reuses the original requirement and capability IDs, does not create a competing register, and does not mark deployment, device loading, or owner acceptance complete.

| Requirement | Capability IDs | Implementation | Automated proof | Visual proof | Deployment | Device loading | Owner acceptance |
|---|---|---|---|---|---|---|---|
| `RQ-ROUTE-001` own Route open/rename/delete/use | `ROUTE-01` | Corrected candidate: remote delete truth and stale-read ordering | PASS | PASS for affected metrics/action/delete surfaces; Expo Web boundary | Client/backend not published | UNVERIFIED | PENDING |
| `RQ-ROUTE-002` independent Activity -> Route | `ROUTE-02` | Preserved; G0/G1 proof confirms independent geometry | PASS | Prior evidence retained; no broader visual claim | Client not published | UNVERIFIED | PENDING |
| `RQ-ROUTE-003` durable minimum origin/edit distinction | `ROUTE-03` | Implemented locally; migration isolation correction | PASS on real disposable MySQL 8.0.45 | Origin visuals retained from revision 01 | Migration/backend deployment required | UNVERIFIED | PENDING |
| `RQ-ROUTE-004` truthful Hike/Run reference use | `ROUTE-04` | Shared chooser action corrected to `Use Route` | PASS | PASS Day/Sunset/Night + chooser | Client not published | UNVERIFIED | PENDING |
| `RQ-ROUTE-005` truthful editor/mutations | `ROUTE-01`, `ROUTE-02` | Corrected candidate: save-in-flight guard, durable uncertain delete state, stale read protection | PASS | PASS affected state captures; native gesture NOT RUN | Client/backend not published | UNVERIFIED | PENDING |
| `RQ-ROUTE-006` Route-only explicit reconnect | `ROUTE-02`, `ROUTE-03` | Preserved; real geometry transaction keeps Activity/Memory unchanged | PASS | Prior Gap evidence retained | Origin deployment required | UNVERIFIED | PENDING |
| `RQ-TRAIL-003` canonical create/reopen/detail destination | `ACT-03`, `ROUTE-01` | Preserved from revision 01 | PASS regression | Prior evidence retained | Client not published | UNVERIFIED | PENDING |
| `RQ-OFFLINE-001` independent local/sync/usability truth | `CAIRN-01`, `ROUTE-02`, `ACT-03` | Corrected pending remote-delete and cache ordering truth | PASS regression | PASS local fixture boundary | Modern server features pending | UNVERIFIED | PENDING |
| `RQ-ROUTE-007` active guidance/full planner | `ROUTE-05` | NOT IMPLEMENTED; out of scope | NOT CLAIMED | NONE | No | UNVERIFIED | PENDING |

`RQ-ROUTE-003` remains limited to the authorized minimum origin contract. The real MySQL proof closes the local database-evidence gap; it does not deploy migration 036. Native gestures/layout, OTA loading, grouped owner review, and acceptance remain separate.

