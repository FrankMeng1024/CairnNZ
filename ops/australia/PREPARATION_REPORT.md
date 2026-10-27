# Australia infrastructure preparation report

Date: 2026-10-27

## Verdict

**PREPARED for Phase 2 staging work; not deployed and not production-cutover-ready.**

This branch adds only `ops/australia`. It does not change Cairn UI, product logic, API behavior, schema, runtime/build version or the existing production configuration.

## Source identities inspected

- Infrastructure branch base at start: local `main` `d46ca04ddd8d3d8c3c10901a21a9bd4fc62de976`, tree `ca219ad30df6d32263aeb2d740de3c60531409af`.
- `origin/main` matched that SHA after the initial read-only inspection.
- The cited #34/Memory/Visual work is already represented in the current main ancestry; no old candidate was re-merged.
- Current production backend read-only checkout: `a7effb35c25c989c29b246e42235aee17fe37f70`, tree `c68a93b835f4094e9f2455a579ff067d32f69aeb`, matching `origin/master` at inspection.
- Backend/docker product source content relevant to deployment was compared; this infrastructure branch does not alter it.

Final branch commit/tree are recorded in the task handoff after commit.

## Prepared today

- Provider/region and server sizing decision with official source links.
- Verified current production inventory: host, containers, MySQL version/size, storage, traffic upper bounds, TLS, cron, outbound services, backups and source identity.
- Dedicated AU Docker Compose and portable Node 20 image without China-only package mirrors.
- Strict environment template with no real credentials.
- Host bootstrap, SSH/firewall hardening, exact-SHA deploy, TLS, backup, empty-target restore, migration, data manifest, verification, write freeze, cutover preflight and rollback gate scripts.
- Persistent account-export storage, local-only DB admin port, exact image revision label, health checks and service restart policy.
- Daily backup and minute health systemd timers plus log rotation template.
- Runbooks for data migration, cutover/rollback, environment and real business acceptance.
- Privacy checklist covering NZ IPP 12, cloud-agent boundaries and China cross-border review.

## Verified locally

- All shell files passed `bash -n`.
- Compose model validates using a synthetic secret file.
- Node 20 dependency installation from the lockfile passed in an isolated container.
- Disposable MySQL 8.0.36 synthetic rehearsal passed:
  - consistent single-transaction dump;
  - SHA-256 verification;
  - restore into an empty database;
  - canonical schema hash equality;
  - exact per-table count equality;
  - per-table logical content SHA-256 equality;
  - foreign-key orphan scan;
  - migration ledger preservation;
  - export-directory archive preservation.
- Negative tests passed: non-empty target overwrite rejected, altered checksum rejected, injected foreign-key orphan rejected.

The local Docker engine is 20.10.8 and its default seccomp profile cannot create threads for current Node/MySQL images during a Docker build/start. Node 20 dependency installation passed only when the local container was explicitly run with an unconfined seccomp profile; the full Dockerfile build therefore remains **LOCAL_ENV_BLOCKED**, not PASS. The synthetic DB rehearsal used cached MySQL 8.0.36. Current production is MySQL 8.0.45 and AU Compose targets 8.0.45. Build plus exact 8.0.45 must pass under the purchased, current Ubuntu/Docker host before AU_STAGING_READY.

## Not verified / Phase 2 required

- No Australia server has been purchased, bootstrapped or measured.
- No live NZ-to-Sydney latency, AWS billing/quota, live price, EBS/S3 or snapshot behavior has been tested.
- No real production data was exported or restored.
- No DNS, TLS certificate, production configuration, current server, OTA, TestFlight or backend was changed.
- No real iPhone/current installed client has reached an AU backend.
- Email, push, Apple/Google, Activity, Memory/Fog, Friends, Cairn and Route acceptance await AU staging.
- Production backup restore, final manifest equality, cutover and data-safe rollback remain mandatory.
- Legal/Owner authority for exporting any China-hosted precise-location/personal data is pending.

## Owner inputs needed tomorrow

- Sydney instance public IP/instance ID, chosen AZ and confirmation of x86_64 Ubuntu 24.04, encrypted disk, Elastic IP and security group.
- SSH public-key installation and access through an SSH agent/provider console; do not send a long-lived private key in chat.
- Secure `/etc/cairn-au/au.env` values or secret-store access; never chat/commit them.
- DNS provider access for a staging hostname; production DNS change is separately authorized later.
- Exact final backend SHA, approved staging hostname, operator alert destination and Owner QA accounts/devices.
- AWS S3/snapshot retention decision, DPA/subprocessor review and legal clearance for China-to-Australia transfer.
- Separate maintenance window and explicit production-cutover authorization after staging passes.

## Current blockers to production cutover

Server absent; actual AU staging not verified; production restore/rollback unproved; client business acceptance absent; privacy/export authority unresolved; source host disk is 92% full; source lacks scheduled Cairn backup. Therefore **PRODUCTION_CUTOVER_READY = NO**.
