# Activity Detail requirements delta

This is a small delta against `docs/review/ui-requirements-baseline/20260916T131638+0800/REQUIREMENTS_REGISTER.json`. It does not replace or fork the requirements register. Original capability IDs are preserved.

| Requirement | Original capability | Implemented candidate | Automated proof | Visual proof | Device/user acceptance |
|---|---|---:|---:|---|---|
| `RQ-ACTD-001` one truthful Detail | `ACT-03` | Yes | Yes | Expo Web fixture | Pending |
| `RQ-ACTD-002` predictable Back | `ACT-03` | Yes | Yes | Forced-route capture is not navigation proof | Pending |
| `RQ-ACTD-003` truthful state language | `ACT-03`, `ROUTE-02` | Yes | Yes | Pending/error/Gap fixtures | Pending |
| `RQ-ACT-006` geometry roles remain distinct | `ACT-01`, `ACT-02`, `MEM-01`, `DIAG-01` | Page scope | Yes | Expo Web fallback | Pending |
| `RQ-ACT-007` no connector across Gap | `ACT-01`, `ACT-02`, `ROUTE-02` | Yes | Yes | Disconnected Expo Web segments | Native/device pending |
| `RQ-ROUTE-002` independent Route copy | `ROUTE-02` | Yes | Yes | Draft entry only | Pending |
| `RQ-ROUTE-003` durable Route origin | `ROUTE-03` | Local minimum only | Local proof | Hidden metadata | Backend/fresh-device pending |
| `RQ-CAIRN-002` Quick Cairn association/retrieval | `CAIRN-01`, `ACT-02` | Yes | Yes | Linked-own-Cairn fixtures | Pending |
| `RQ-OFFLINE-001` independent readiness/sync/usability | `CAIRN-01`, `ROUTE-02`, `ACT-03` | Activity Detail scope | Yes | Pending/error fixtures | Pending |
| `RQ-FINAL-001` no unsupported later-work promise | `ACT-03`, `ROUTE-02` | Copy boundary | Yes | Normal/exception fixtures | Pending |

The candidate does not receive whole-page acceptance from source, tests, or screenshots. Deployment was not performed; device loading, native Mapbox, real-field behavior, and explicit owner acceptance remain `UNKNOWN`/`PENDING`.

The machine-readable row-by-row detail, clause mapping, and evidence IDs are in `REQUIREMENTS_DELTA.json`.
