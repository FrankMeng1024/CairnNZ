# Australia data migration

## Scope

Known mutable Cairn data is MySQL plus generated account-export JSON files. MySQL includes users/auth, sessions/Activity, Route, Memory/Fog evidence and materialized coverage, Cairns/markers, Friends/sharing, Public acquisition/moderation, push queues/receipts, diagnostics and export metadata. No Redis or general object store was found. Debug images are stored in MySQL. Reconfirm this inventory immediately before export.

Do not migrate unrelated schemas from the shared China MySQL container.

## Why restore is the baseline

There are 57 migration files through ledger `058`, with two files numbered `003`, numbering gaps and a destructive historical `004`. The current file-ledger runner would skip the second duplicate number during a fresh sequential replay. Therefore a fresh production AU database must start from a consistent dump of the verified current Cairn schema plus its ledger, not `docker/init.sql` or blind replay.

## Rehearsal migration

1. During an agreed rehearsal write freeze, set the recorded freeze flag and run `backup.sh --full-manifest`. Copy the complete bundle off the 92%-full host immediately. Routine unfrozen backups omit `--full-manifest`; they are transactionally consistent dumps but their later live-manifest scan is not cutover evidence.
   Before backup, run `capture-source-exports.sh --destination <protected-empty-dir>` against the legacy backend container and point `EXPORT_DIR_HOST` at that directory; current production exports otherwise live ephemerally inside the container.
2. Verify every `.sha256` after transfer. Do not unzip merely to “look at” sensitive content.
3. Start an empty AU database and run `restore.sh`. It refuses a database containing any table.
4. Run `migrate.sh`; it applies only numbers greater than the restored ledger. Duplicate pending numbers fail. Destructive SQL requires an independently reviewed hash manifest.
5. Generate a target full manifest and run `compare-manifests.sh`.
6. Run application/business acceptance with non-production QA accounts. Discard this rehearsal DB before final production sync unless a documented incremental method will bring it exactly current.

## Final cutover migration

1. Create a fresh source backup before freeze and prove it can restore.
2. Start recording source binlog file/position from the dump (`--source-data=2`). GTID is currently off.
3. At the authorized window, block all source mutations at the gateway while allowing GET/HEAD/OPTIONS and health. Confirm every mutation receives retryable 503 and old cron is disabled/frozen.
4. Take the final single-transaction dump and export directory archive, checksums, ledger and source manifest. For the current dataset, a short full-copy outage is simpler and safer than introducing untested replication.
5. Restore into a new/empty AU database. Apply only reviewed migrations beyond the ledger.
6. Generate full source and target manifests while writes are frozen. Require:
   - canonical schema hash equal;
   - exact row count for every table equal;
   - full table checksum equal where generated;
   - every foreign-key orphan count zero;
   - migration ledger and Git/backend protocol identity correct;
   - export archive count/hash correct.
7. Keep AU write-frozen while smoke/business checks run. Change DNS only after `cutover-preflight` passes.
8. Open writes on AU only after DNS target health is confirmed. Keep China write-frozen to prevent split brain.

## Incremental option

MySQL binlog is enabled in ROW mode with 30-day retention; GTID is off. File/position replication or a captured delta could reduce the freeze, but it has not been rehearsed for this topology. Do not introduce it during the cutover unless a staging rehearsal proves user/grant compatibility, replication lag reaches zero, DDL handling is understood and a stop position is recorded. The default runbook uses a bounded write freeze plus final full dump.

## Rollback data rule

- Before AU accepts a write: route rollback to the healthy, still-current China source is permissible after verifying source write mode.
- After AU accepts any write: **never point clients back to the stale China database**. Freeze AU, take a final AU backup, then either repair forward in AU or restore/reconcile all AU writes into a validated China replacement. Only after exact comparison may traffic move.
- If safe reconciliation cannot be proven, remain write-frozen and stop. Availability is not more important than avoiding user-data loss.

## Privacy gate

The database contains email/account data and precise location/trajectory evidence. China's PIPL explicitly identifies movement tracks as sensitive personal information and Articles 38–39 impose conditions/notice/consent duties for overseas provision. This task does not determine whether a specific exemption or mechanism applies. Obtain qualified legal review and data-subject/test-cohort authority before moving real China-hosted data.

For NZ users, Privacy Act 2020 IPP 12 governs overseas disclosure. NZ OPC guidance says an offshore processor acting only as the NZ agency's agent may not constitute disclosure, but the NZ agency remains responsible; provider terms, DPA, subprocessors and comparable safeguards still need review.

Official sources inspected 2026-10-27:

- NZ Privacy Act IPP 12: https://www.legislation.govt.nz/act/public/2020/31/en/2026-09-23/sections/LMS23342/
- NZ OPC cross-border/cloud guidance: https://www.privacy.org.nz/responsibilities/disclosing-personal-information-outside-new-zealand/decision-tree-page/
- China PIPL Articles 28, 38 and 39: https://www.samr.gov.cn/wljys/gzzd/art/2023/art_3ef1e889c1e644d4b65b5f5c7f432386.html
- AWS data privacy/location statement: https://aws.amazon.com/compliance/data-privacy-faq/

Legal checklist before real transfer: controller/processor roles, DPA/model terms, exact region for EC2/S3/snapshots/logs/support, AWS subprocessors, retention/deletion, breach procedure, privacy-policy notice, China export mechanism/consent, NZ IPP 12 basis, and access logging.
