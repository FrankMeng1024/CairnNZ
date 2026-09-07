# Free Activity production change plan

Review date: 2026-09-07
Status: future plan only; not executed
Current gate: `READY FOR NATIVE QA`

Production change review is not available until the signed physical-device matrix passes and an explicit deployment authorization is given.

## Exact future sequence

1. **Freeze and precheck.** Record reviewed commit/build IDs. Reconfirm tracked production cleanliness while preserving catalogued untracked ops files; SSH and `sudo -n`; disk; container health; `127.0.0.1:3001`; MySQL version; migration ledger; current client version; schema types/index names; table sizes; and absence of new-client traffic. Never use `git clean`.
2. **Bootstrap corrected migration tooling.** Because production currently has the old unsafe runner, first deploy a reviewed tooling-only commit through `sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh` while 034 is not pending. Confirm the installed canonical script calls the verifier-gated runner. The canonical flow may automatically rebuild/recreate the backend; no manual restart is required. Do not restart MySQL or nginx.
3. **Backup/snapshot.** Obtain and verify a restorable DB snapshot immediately before 034. Record snapshot ID, times, restore owner, and expected recovery time. Stop if restore readiness is not confirmed.
4. **Legacy unfinished preflight.** Repeat the exact SELECT-only evidence query. Expected: seven identity-less shells across users 4 and 72, all older than six hours with zero distance, duration, and point arrays. Any new/recent/meaningful ambiguity blocks migration for explicit reconciliation. Do not delete these rows.
5. **Migration execution.** Make reviewed 034 and the compatible feature backend pending, then invoke `sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh`. The runner must leave its ledger unchanged on any process failure or emitted MySQL `ERROR`. If a partial run completes all postconditions, a later verifier-only invocation may atomically record 034.
6. **Migration verification.** Independently query every expected column, exact type/nullability/collation, generated expression, unique index, provenance FK/action, tombstone PK/FK, reconciliation reason/count, active-slot multiplicity, and total row counts. Confirm the seven stale shells were preserved and archived, not deleted. Confirm ledger `034` only after all checks pass.
7. **Backend automatic recreate/restart.** The same canonical deploy script builds and runs `compose up -d backend`. Do not ask a human to restart it and do not use ad-hoc `docker compose restart` as the deployment mechanism.
8. **Health and logs.** Require healthy `cairn-backend`, exact localhost binding, `/health` app+DB OK, nginx/API reachability, and clean startup/session/Marker/Memory/migration logs. Compare known unrelated recurring logs; stop on new schema, 500, identity, singleton, or tombstone errors.
9. **Old-client smoke.** With a dedicated account and legacy JSON shapes, run session Start/retry/append/Save/list/detail/numeric delete and Marker create/list/numeric delete. Also attempt cross-mode Start over an unfinished shell: expect safe conflict and no second/mistyped row.
10. **Internal new-client candidate.** Only after steps 1–9, release a restricted internal OTA/build. Network configuration must prevent this client from reaching an old backend.
11. **Native QA.** Run the complete 17-step iOS/Android matrix from `INDEPENDENT_REVIEW.md`, attach device/OS/build/permission/power settings, Activity/Cairn client and server IDs, videos/screenshots, diagnostics, and SELECT-only server row-count proof.
12. **Production client release.** Obtain explicit change authorization after native evidence review. Stage release and monitor unfinished multiplicity, conflicts, duplicate identities, pending cleanup, corrupt payloads, tombstones, provenance, Memory, and account-owner rejection metrics.

## Migration recovery

- **Statement error, verifier fails:** ledger remains pre-034. Preserve output; inspect partial objects and perform a separately reviewed forward repair or snapshot restore. Do not deploy the feature backend.
- **Statement error, verifier passes:** ledger still remains pre-034 for that invocation. Re-run; verifier-only preflight records 034 without executing DDL. Then independently verify again.
- **Unknown partial schema:** block. The verifier must name the failed postcondition; never broadly classify it as “already applied.”

## Rollback / forward-fix decision tree

- **Before migration:** abort normally.
- **034 partial:** no ledger advance; repair forward or restore the immediate snapshot.
- **034 complete, no new-client writes, backend fails:** use a reviewed old-client-compatible backend and normally retain additive 034. The down migration is allowable only after proving zero client identities/provenance/tombstones exist and explicitly approving its data-destructive effect.
- **New backend live, old clients only:** rollback application only to a build proven safe with the additive schema; keep monitoring singleton behavior.
- **Any new-client write or internal candidate traffic:** do not run the 034 down migration and do not restore an old backend. Halt client rollout, keep an identity-compatible backend, and forward-fix.
- **Data-integrity anomaly:** halt rollout, preserve logs/snapshot, restrict the cohort through an approved mechanism, and choose restore versus forward reconciliation with explicit data-owner approval.

The migration down file is a structural development aid before new writes, not a universal production rollback.

No step in this plan was executed during review.
