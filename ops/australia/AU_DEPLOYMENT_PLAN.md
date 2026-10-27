# Australia deployment plan

## State definitions

- **PREPARED**: scripts and local synthetic rehearsal complete; no AU host exists.
- **AU_STAGING_READY**: AU host, isolated database, TLS and exact backend SHA pass staging/business verification; production still points to China.
- **PRODUCTION_CUTOVER_READY**: final source freeze, final sync, exact data comparison, rollback proof, client compatibility and separate Owner authorization all pass.

## Architecture

One Sydney x86_64 Ubuntu host initially runs nginx, one Node/Express backend and dedicated MySQL 8.0 in Docker Compose. Backend and MySQL admin ports bind only to loopback; nginx alone receives public API traffic. Persistent paths sit under `/srv/cairn-au`: MySQL, exports, backups, state and logs.

The initial deployment deliberately uses one backend replica because scheduled jobs run in the application process. Staging sets `DISABLE_CRON=1`; production enables cron only after the old scheduler is frozen and exactly one AU scheduler is confirmed.

## Procedure after purchase

1. Record instance ID, region/AZ, public/private IP, disk encryption, security group and purchase receipt. Confirm region is `ap-southeast-2`.
2. Add the Owner's public SSH key through the provider console. Keep provider emergency console access.
3. Copy this operations directory or clone its branch; create `/etc/cairn-au/au.env` mode 600 through a secure channel.
4. Run `au.sh ... bootstrap`; add/test the non-root `cairn` SSH key; then run `security` from an IP inside `ADMIN_CIDR`.
5. Run `preflight`. Resolve every failure; never add `|| true` around a gate.
6. Push/verify the approved source branch, then set `BACKEND_GIT_REF` plus its full reviewed `BACKEND_GIT_SHA`. Current production backend evidence is `a7effb35...`, but re-check on deployment day. Deploy fetches the named ref and refuses a SHA outside its ancestry.
7. Run `deploy --db-only`. This creates only the isolated AU MySQL service.
8. Transfer a checksummed, encrypted rehearsal backup; run `restore`, `migrate`, and source/target `db-manifest` comparison.
9. Run `deploy --backend-only` with staging hostname and `DISABLE_CRON=1`.
10. Point only `au-api.yiiling.cn` (or approved equivalent) to the AU Elastic IP. Run `install-tls`; target starts write-frozen.
11. Open staging writes only after synthetic/Owner-QA policy is confirmed; never let staging mutate the production-copy database if it will later be used for final sync.
12. Execute `AU_ACCEPTANCE_CHECKLIST.md`, monitoring, backup and restore validation. Install operations timers.
13. Lower production DNS TTL at least 24 hours before the separately authorized cutover.
14. Follow `AU_DATA_MIGRATION.md` and `AU_CUTOVER_AND_ROLLBACK.md`. Keep China intact and write-frozen through observation.

## Source/runtime differences intentionally introduced

- AU Dockerfile uses official Debian/npm endpoints rather than China mirrors.
- AU Compose owns a dedicated MySQL 8.0 service; the legacy Compose assumes a shared host database.
- AU exports use a persistent mount instead of container `/tmp`.
- Backend image carries `org.opencontainers.image.revision` for exact SHA verification.
- AU DB admin port is loopback `3307`; public 3306 is forbidden.

No application API, schema, product logic or client behavior is changed by this branch.

## Monitoring and operations

- Enable `cairn-au-health.timer` and `cairn-au-backup.timer` only after deploy.
- Send systemd/CloudWatch failures to an operator channel; the included local timer alone is not external alerting.
- Alert: public health failure, backend restart loop, MySQL unhealthy, disk 70/80/90%, backup age >26h, TLS <21 days, abnormal 5xx/rate-limit.
- Retain application logs for incident needs without logging tokens, passwords or exact private tracks.

## Failure boundaries

- Deployment fails on dirty checkout, wrong SHA, empty DB for backend start, unhealthy DB/backend, missing ledger or secret placeholder.
- Restore refuses any non-empty target and verifies adjacent SHA-256 first.
- Historical migration replay from zero is prohibited because the repository contains duplicate migration number `003` and a destructive historical `004`.
- DNS remains manual/provider-specific until the Owner supplies the selected DNS provider and separately authorizes production cutover.
