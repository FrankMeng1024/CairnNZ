# Free Activity compatibility matrix

Review date: 2026-09-07

| Client | Backend | Classification | Evidence / constraint |
|---|---|---|---|
| OLD | OLD | SUPPORTED | Current production combination; unchanged by this local review. |
| OLD | NEW | TEMPORARILY SAFE | Real MySQL/HTTP legacy Start, append, Save, list, detail, delete, Marker create/list/delete passed. Same-mode lost Start response reuses one shell. A cross-mode Start while another unfinished Activity exists returns deterministic conflict; an old UI may show generic failure but cannot create a second Activity or finalize the wrong type. |
| NEW | NEW | SUPPORTED FOR NATIVE QA | Stable Activity/Cairn IDs, singleton, offline completion, provenance, tombstones, owner fencing, Memory, ACK and cleanup tests pass. Physical-device proof remains. |
| NEW | OLD | UNSUPPORTED | Old backend lacks identity echo, singleton semantics, tombstones, provenance, and reconciliation contracts required by the new client. |

## Required ordering

Backend-before-client is mandatory:

1. bootstrap the corrected production migration runner/verifier;
2. backup, migrate 034, verify schema and reconciliation;
3. deploy and smoke the new backend while old clients remain in use;
4. publish only a restricted internal new-client candidate;
5. complete native QA;
6. authorize/stage the production client release separately.

No new client may be allowed to hit an old backend. Once any new-client identity or tombstone is written, neither the 034 down migration nor an old-backend rollback is safe. Keep an identity-compatible backend and forward-fix.

## Legacy singleton behavior

- No active shell: legacy Start creates an identity-null shell.
- Same-mode retry/lost response: returns the one existing identity-null shell.
- Different mode while a shell exists: returns conflict and creates nothing.
- New-client attempt while a legacy shell exists: assigns that shell one durable server-generated `clientActivityId`, commits it, and returns deterministic existing-Activity metadata so the new client can resolve it.
- Stale zero-evidence legacy shells older than six hours are archived nondestructively. Meaningful ambiguity fails closed.

This transitional limitation is preferable to either a second unfinished Activity or a wrong-type replay. It must be included in old-client smoke and rollout monitoring.
