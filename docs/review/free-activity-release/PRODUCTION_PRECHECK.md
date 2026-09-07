# Free Activity production read-only precheck

Inspection date: 2026-09-07
Target: `ubuntu@122.51.174.118`
Checkout: `/opt/githubRepos/Cairn`
Mode: strictly read-only

## Operational capability

- Non-interactive SSH: PASS.
- `sudo -n true`: PASS.
- Production commit: `2e6945047e6ef63590f2ace49f4cc0d3998ddcb1`.
- Tracked checkout status: clean; existing untracked operational files were catalogued and not changed.
- Canonical deploy script exists at `/opt/githubRepos/Cairn/docker/deploy.sh`.
- Backend container `cairn-backend`: healthy, up six days, expected `127.0.0.1:3001` binding.
- `/health`: application OK and DB OK.
- MySQL container `ainews-db`: healthy, MySQL 8.0.45, up approximately five months.
- Production migration text ledger: `032`.
- Disk: 40 GiB total, approximately 16 GiB free.
- Nginx and health paths are available for post-change verification.

The local canonical deploy script builds and recreates the backend automatically with `compose up -d backend`; no human manual restart is required. MySQL and nginx are not independently restarted by the plan.

## Schema and data compatibility

Read-only `information_schema` and `SELECT` checks found:

- row counts: `users=30`, `sessions=32`, `markers=6`, `memory_points=848`;
- user/session/Marker relationship keys are `BIGINT UNSIGNED`, compatible with 034;
- no session→user or Marker→user orphan pattern relevant to the new FKs;
- `sessions`, `markers`, and `users` use `utf8mb4_unicode_ci`;
- no 034 client-ID, active-slot, or tombstone object is present yet;
- approximate `sessions` data size 409,600 bytes and `markers` 16,384 bytes;
- nullable new business IDs and MySQL unique-NULL semantics are compatible with legacy rows.

## Existing unfinished rows

Seven rows meet the legacy unfinished placeholder definition and all have zero evidence:

- user 4: five rows, approximately 475, 474, 474, 382, and 161 hours old;
- user 72: two rows, approximately 501 and 495 hours old;
- every row has distance 0, duration 0, empty `route_points`, and empty `route_points_raw`;
- the pre-034 schema means every row is identity-less.

The deterministic nondestructive production outcome is therefore known: migration 034 preserves all seven rows, marks them `legacy_stale_zero_shell`, and gives none an active slot. It performs no delete. A pre-migration SELECT must re-prove these facts immediately before authorization; any meaningful or recent row is a stop condition requiring explicit reconciliation.

## Migration bootstrap constraint

The currently deployed production script still has the historical inline/broad migration handling and must not be trusted to apply 034. The repository’s corrected runner and verifier are local changes, not production files.

Future authorized rollout must use a reviewed two-phase canonical bootstrap:

1. deploy a tooling-only commit containing `run-pending-migrations.sh`, the 034 verifier, and corrected `deploy.sh`, while 034 is not yet pending;
2. verify the production canonical script is the corrected version;
3. only then make 034/feature backend pending and invoke the same canonical deploy flow.

This preserves `sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh` as the normal mechanism without relying on the unsafe old runner for 034. No ad-hoc restart and no `git clean` is introduced.

## Result

PASS as a read-only compatibility/capability precheck for `READY FOR NATIVE QA`, with the two-phase bootstrap, fresh backup, and immediate legacy-row recheck as mandatory production-change entry conditions. This is not deployment approval.

No production DB mutation, migration, deploy, restart, DB write, file modification, git reset, push, or OTA occurred.
