# Current infrastructure inventory

Evidence date: 2026-10-27. Production checks were read-only. No service, database, configuration or data was changed.

## Verified production shape

| Area | Verified state | Migration implication |
|---|---|---|
| Provider / region | Tencent Cloud CVM, Shanghai (`ap-shanghai-5`) | Current production remains source/rollback host. |
| Host | x86_64 KVM, Ubuntu 24.04, 4 vCPU, about 3.6 GiB RAM | Australia x86_64/Ubuntu 24.04 minimizes change. |
| Disk | 40 GB root, about 37.0 GB used / 92% | Critical source-host risk; avoid large on-host staging archives. Copy verified backups off-host promptly. |
| Runtime | Docker 29.3; nginx 1.24; Certbot; no PM2 application runtime | Reuse Docker + nginx. |
| Backend | One `cairn-backend`, Node 20 / Express 5, loopback `127.0.0.1:3001`, healthy at observation | One AU backend initially; cron is embedded in process. |
| Database | Shared `ainews-db`, MySQL 8.0.45, Cairn is one schema among unrelated services | AU must use a dedicated MySQL service and migrate only Cairn. |
| Cache/queue | No Redis or external queue found | Push/export queues live in MySQL; no cache dataset to migrate. |
| TLS | nginx terminates `api.yiiling.cn`; certificate observed valid to 2026-12-16 | Reissue on staging/AU and test renewal before cutover. |
| Source | Deployed backend checkout `a7effb35c25c989c29b246e42235aee17fe37f70`; tree `c68a93b835f4094e9f2455a579ff067d32f69aeb` | Freeze an exact final backend SHA again on deployment day. |
| Migration ledger | `058` | Restore the current DB plus ledger; do not bootstrap production by replaying all history. |

The production checkout has 17 dirty/untracked paths, including local backup/admin material and `.migrations_applied`. The deployed tracked commit is known, but this is a deployment-hygiene risk: do not copy the checkout wholesale and do not infer data identity from `git status` alone.

## Resource and traffic observations

- Sample container use: Cairn backend about 74 MiB RAM and near-zero CPU; shared MySQL about 509 MiB and about 3% CPU at the sample instant.
- Nginx daily line counts observed across current/rotated access logs: about 2,326–15,033/day; partial current day 4,146; previous day 5,363.
- Sample peak: 1,566 requests/hour and 267/minute. This includes internet scanners and is only a sizing upper bound, not verified Cairn-user demand.
- Production source checkout is about 4.08 GB because repository assets/history are much larger than the runtime application.
- Observed nginx logs totalled only about 3.8 MB and backend `/app/logs` about 4 KB at inspection; future disk sizing is driven more by Docker/source/backups and database growth than current log volume. Log rotation remains required.

## Backend/service inventory

| Dependency | Actual implementation | Persistence / egress |
|---|---|---|
| REST API | Express routes for auth, sessions, routes, friends/sharing, markers/Cairns, Memory, push, account/export, telemetry and diagnostics | MySQL |
| WebSocket / SSE | None found in current backend | None |
| Authentication | Email/password, Google token verification, Apple token verification, JWT, nonce/token blacklist | MySQL; outbound Apple/Google HTTPS |
| Scheduled work | Hidden-item cleanup, auth sweep, push drain/purge, export build/purge, diagnostics purge | Runs inside backend process; exactly one scheduler required |
| Push | Expo push API and MySQL outbox/receipts | Outbound HTTPS; access token may be required |
| Email | Resend HTTP API | Outbound HTTPS; current China deployment moved away from SMTP reachability |
| Uploads/images | No general object-upload service found | Debug PNG snapshots are MySQL LONGBLOB; marker voice URL is a reference |
| Data export | JSON files in `EXPORT_DIR`, current fallback `/tmp/cairn-exports` | Current container storage is ephemeral; AU mounts `/srv/cairn-au/exports` |
| Map/navigation | Mapbox is primarily client-side; operator scripts exist; no core server tile proxy | Client outbound Mapbox; no tile data migration |
| Weather | Open-Meteo is client-side | No server dataset |

Current cron code has the auth sweep scheduled every minute even though an inline TODO says to revert before App Store. That is an existing application/release issue, not changed by this infrastructure branch.

## Database/storage

- MySQL 8.0.45, InnoDB, `utf8mb4_unicode_ci`, repeatable-read.
- 74 Cairn tables; about 250.6 MB data + 101.4 MB indexes = about 352 MB.
- Largest observed tables: `debug_events_v2` about 176.6 MB, `regions` about 109.9 MB, `telemetry_sessions` about 43.4 MB.
- Aggregate non-sensitive counts at observation: 33 users, 55 sessions, 23 routes, 12 markers, 4,118 memory points, 26 friend rows.
- MySQL binary log is enabled in ROW mode, GTID is off, server-id 1, and retention is 30 days. File/position incremental replication may be possible but must be rehearsed and explicitly authorized.
- No separate Cairn object store was found. The database plus persistent export directory constitute the known mutable data surface.
- Current MySQL container publishes port 3306 on all interfaces. This is a source security issue. The AU design binds admin access to loopback only and does not modify the existing host.

## Backup/restore state

- Several ad-hoc/pre-deploy compressed Cairn dumps exist; the latest observed was about 93 MB.
- No scheduled Cairn backup timer was found. Existing scheduled backup activity on the host belongs to an unrelated service.
- No recent documented Cairn restore proof was found.
- Binary logs reduce some risk but are not a substitute for an independently stored, restore-tested backup.

## Client and third-party coupling

- iOS/EAS production profiles and code fallback use `https://api.yiiling.cn`; no production hard-coded IP was found.
- Hard-coded IPs found in QA scripts/comments are not production routing.
- Required outbound HTTPS: GitHub/container registry, Apple JWKS, Google OAuth, Resend, Expo push/receipts. Mapbox/Open-Meteo are primarily client outbound.
- CORS, OAuth audiences, email sender, push token and Public Cairn fail-closed policy must be migrated as configuration, never printed.

## Unknown / owner confirmation

- Genuine-user request percentile/latency, current monthly egress and NZ-to-Shanghai/Sydney latency.
- AWS account quotas, exact live price and billing restrictions.
- Whether all existing data subjects and test-data operators have authorized China-to-Australia export.
- Exact DNS provider API and whether automated DNS mutation is desired. Current tooling deliberately does not change DNS.
- Current off-host copies, encryption state and successful restoration history for the ad-hoc dumps.
