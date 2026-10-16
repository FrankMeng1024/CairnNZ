# O84 production backend receipt

## Scope and identity

- Deployment time: 2026-10-16 UTC.
- Deploy-bearing commit: `f35f2b745d2c9d145a49a902c595d3611673bc35`.
- Integration base: `origin/master` at
  `cefcba8753e7da908724218092a2fda138db5d43`.
- Commit scope: eight backend-only files; their Git blobs match the reviewed
  O84 client candidate exactly.
- Deployment used only the canonical command from
  `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`.

## Preflight and backup

- Production checkout had zero tracked modifications. Existing untracked
  operational/backup files were enumerated; the canonical reset does not run
  `git clean` and did not remove them.
- Migration ledger was 046. The existing schema used the legacy
  `pending/accepted/rejected` enum and had none of the three O84 lifecycle
  columns.
- Existing `friend_requests`: 14 total, 13 accepted, 1 rejected, zero pending
  unordered-pair conflicts, zero self requests and zero orphan requests.
- Backend and MySQL containers were healthy. Database size was approximately
  343 MB and the host had approximately 13.1 GiB free.
- Backup:
  `/opt/githubRepos/Cairn/backup/o84-predeploy-20261016T025717Z.sql.gz`
  (mode 600, 84,079,811 bytes). `gzip -t` passed. SHA-256:
  `33ae6643ff6a2b61acf5ce8dda99da91d756d84716344af55d934110f881ce9f`.

## Deployment and postconditions

- Canonical deployment fetched and checked out the exact backend commit,
  applied migration 047, advanced the ledger to 047, built and recreated only
  the backend service, and completed its registered health/public smoke gates.
- Production checkout and `origin/master` both resolve to the backend SHA.
- `verify-migration-047.sh` passed after deployment.
- All 14 request rows remain. `pair_key` has zero nulls and active-pair
  duplicate count is zero.
- Backend state: running/healthy. Built and running image ID:
  `sha256:08ce4ad4a5fb6464f51e329eddbbc02b044cd3fa52180985252305a76b208b18`.
- Local and public health passed. Unauthenticated Requests returned 401.
  An existing authorized smoke token received 200 from read-only Requests,
  Outbound, Grants, Sources and an empty Projection request. Backend logs had
  zero error/fatal/unhandled lines in the post-deploy window.

## Remaining production boundary

No dedicated pair of mutable Friends test credentials was available. The
state-changing decline/relogin/reverse/accept/grant/revoke journey was therefore
not run against Public pilot identities. It remains an explicit pre-OTA/device
acceptance item and is not represented as production-verified.

Rollback must coordinate the eligible client first. Do not run the 047 down
migration while O84 clients can launch. The down migration archives all O84
attempts before collapsing to the legacy direction-unique representation; the
verified backup above is the independent recovery point.
