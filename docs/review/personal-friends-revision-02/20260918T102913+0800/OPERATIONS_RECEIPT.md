# Operations and deployment receipt

## Change manifest

Production payload was limited to 14 backend files in commits `2504778fc515bf45493befd9ae2bfb2bcb35c6b1` and `393338b5c159e7341d22b94086b5c29455386bdf`. It contains migrations 038–039, Memory witness ingestion, Encounter policy/query, friend projection geometry, borrowed-Route authorization/terminal fields, tests, and migration/harness verifiers. Client files, QA captures, unrelated dirty work, credentials, and local report files were not included in the production deployment.

The final test-only ordered-race addition to `abcdn-api-mysql.js` has SHA-256 `29c5635cd1ca1c38ccdaf8e0d61ee6ebcf9ff77b3309420d9b5e1282b6b4f6e2`. It was mounted into a one-off review harness after image deployment and is not represented as production runtime code.

## Backup and rollback/safe-forward authority

- Protected directory: `/var/backups/cairn/personal-friends-rev02-pre038-20260918T045735Z`, root-owned, mode 600 contents.
- Production full backup: 77,792,841 bytes, SHA-256 `27e191263655bd9dafaefddda78091e19811cc0a2501f45a91eb59e2b1a279e8`.
- Production schema backup: SHA-256 `55434d9ad84adb30c7305d434a0e278655edce2d862b568083d3f3d332cb5132`.
- Review full backup: SHA-256 `229d8f8f5b96d118166af73f6e8eb519092aa45f24a360a6b2d5b12f0cdec8f0`.
- Server configuration backup: SHA-256 `cadcb2a4d78ccaefbed405f92c5badd9877943c49728237923817cfdbb9f14be`.
- Gzip integrity: PASS.
- Migrations are additive/corrective. The old review image was health-checked on the migrated schema. Safe-forward is the primary plan; prior images and full/schema backups are retained for exact rollback if required by the runbook.

## Rehearsal and review-first deployment

- Disposable MySQL schema: `cairn_pf_rev02_rehearsal_2504778`.
- Migrations 038 and 039 applied; presence table, Encounter kind, three lease acknowledgement columns, legacy tables, 20 fixture users, and 10 fixture friendships verified.
- The first post-migration evidence query used the wrong historical table name (`friendships` instead of `friends`). The migrations had already succeeded; the query error and corrected postconditions are both preserved in `operations/review-migration-rehearsal.log`.
- Final review image: `sha256:6368de97533007f8db79998b7b2bcb7c590233929fe6c4198ae334160a49e87d`, label commit `393338b5c159e7341d22b94086b5c29455386bdf`, schema `cairn_pf_review_2f8cd36`, container `cairn-pf-review-393338b`.
- The first replacement omitted a previously unrecorded host-gateway mapping, failed DB resolution, and was immediately rolled back to the healthy old container. The corrected replacement restored the mapping and passed loopback and HTTPS health before production work.
- Final review A/B/C/D harness: MySQL 8.0.45, four distinct connections, 17/17 grouped assertions PASS. Synthetic data exists only in the isolated review realm.

## Production deployment

The only production mutation command was the canonical runbook command:

```sh
ssh ubuntu@122.51.174.118 'sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh'
```

It fetched `393338b5c159e7341d22b94086b5c29455386bdf`, applied migrations 038 and 039, verified both migration postconditions, built the image, recreated only `cairn-backend`, reached healthy state, and passed the registered-route smoke check. MySQL, nginx, and unrelated services were not restarted. No real-user journey, broad delete, reset, or fabricated production Encounter was performed.

Final production identity:

- Source/checkout/origin: `393338b5c159e7341d22b94086b5c29455386bdf`.
- Image: `sha256:24c6e1d6862fc302490ec90531c8190d8c62d405d209a3fa5788b9a98d5f3e0d`.
- Migration ledger: 039.
- Route source SHA-256: `0266a17f5836343daeb24a92acb247e32d921be2602d383b8353c3e7c44381af`.
- Migration 038 SHA-256: `390aecffc1061d1ed9fc3820acb1c39ba492220be134d2988e9c2d1414784448`.
- Migration 039 SHA-256: `5807b012edef706214ec537cacfbdfc9cd9cd0ecb6966dcdf834f00a6b867278`.
- Loopback and public HTTPS health: PASS.
- Projection/content/legacy Fog without authentication: 401, confirming authenticated route boundaries.
- Restart account sweep: `hardDeleted=0`; seven-day semantics remained active.

No OTA, App Store, billing, new service, or unrelated deployment occurred.

