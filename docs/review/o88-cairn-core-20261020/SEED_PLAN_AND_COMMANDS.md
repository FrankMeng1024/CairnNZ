# Shanghai fixture commands

All commands run from `backend/`. The tool defaults to planning; mutations require an explicit operation and database configuration. Use a non-production database first.

## Manifest identity

- Manifest: `scripts/cairn-shanghai-fixtures/manifest.o88.json`
- Verified SHA-256: `fef47b20c31bf1332a0e4d5b48a5360e93e6d07a4845188c17d25ffa89265567`
- Target: 60 fixtures, 34 Public / 26 Friends, TTL 14 days.

## Commands

```sh
npm run cairn:shanghai -- plan \
  --manifest=scripts/cairn-shanghai-fixtures/manifest.o88.json

npm run cairn:shanghai -- apply \
  --manifest=scripts/cairn-shanghai-fixtures/manifest.o88.json \
  --environment=isolated \
  --reader-ids=101,102 \
  --public-author-ids=201,202 \
  --friend-author-ids=301,302 \
  --field-review=/secure/path/field-review.approved.json \
  --confirm-batch=o88-shanghai-encounter-20261020 \
  --confirm-target=isolated:localhost:3306:cairn_o88_qa

npm run cairn:shanghai -- verify \
  --environment=isolated \
  --confirm-target=isolated:localhost:3306:cairn_o88_qa

npm run cairn:shanghai -- advance-revision \
  --environment=isolated \
  --field-review=/secure/path/field-review.approved.json \
  --keys=O88-JK-P01,O88-SH-F01 \
  --confirm-batch=o88-shanghai-encounter-20261020 \
  --confirm-target=isolated:localhost:3306:cairn_o88_qa

npm run cairn:shanghai -- cleanup \
  --environment=isolated \
  --confirm-batch=o88-shanghai-encounter-20261020 \
  --confirm-target=isolated:localhost:3306:cairn_o88_qa \
  --confirm-cleanup=o88-shanghai-encounter-20261020

npm run cairn:shanghai -- verify \
  --environment=isolated \
  --confirm-target=isolated:localhost:3306:cairn_o88_qa
```

Exact flags and environment validation are printed by `--help`/`plan`. Do not put database credentials, push tokens, access tokens, or user GPS exports in command history or the review package.

## Production interlock

Production mutation is rejected unless both the environment-level production-fixture gate and explicit Owner approval string match the exact `<batch>:<manifest-sha>`. Public pilot and sensitive-zone policy are re-evaluated before apply and revision advance. O88 deliberately tested the default production attempt and observed `Production fixture mutation is disabled by environment`.

Approval to merge O88 is not approval to seed. Approval to seed one batch is not approval to advance or seed another batch.

## Idempotency and cleanup

- Stable fixture keys/client UUIDs make same-batch apply idempotent.
- Target fingerprint prevents silently changing manifest contents under an existing batch.
- Cleanup scopes deletions to markers and derived collection/notification records owned by the exact QA batch.
- Cleanup does not delete users, Activities, unrelated Cairns, or friendships.
- Expiry stops discovery even if cleanup is delayed; cleanup is still required.

## Isolated rehearsal

`bash scripts/run-cairn-shanghai-fixture-rehearsal.sh` creates a uniquely named disposable MySQL 8 database, applies migrations 035–054, creates only `isolated_qa` accounts and real bilateral test friendships, runs plan/apply/verify/two revisions/cleanup/verify, asserts every count, and destroys the container. The final O88 rehearsal applied 60, advanced 2, cleaned 60, and verified zero live fixture markers. This proves tool/database mechanics only; it does not approve coordinates or prove an iPhone encounter.
