# Docker environment and yiiling maintenance report

Date: 2026-10-21

## Attribution and root cause

Status: `VERIFIED`

The failed Docker daemon was the local Mac's Docker Desktop `default` context, not yiiling and not a remote QA host. Its Linux VM identifies as `docker-desktop` with Docker root `/var/lib/docker`.

The three isolated MySQL harnesses removed containers with `docker rm -f`. The MySQL 8 image declares `/var/lib/mysql` as an anonymous volume, so every run stranded about 220 MB. There were 199 detached volumes whose database names exactly matched the disposable `cairn_public_*`, `cairn_pf_*` or `cairn_shanghai_*` harness conventions, plus the anonymous volume from the failed run, which had no database directory.

Before cleanup Docker reported 254 local volumes using 53.25 GB, of which 52.74 GB was reclaimable.

## Local recovery operations

| Operation | Status | Result |
| --- | --- | --- |
| Record candidate names, ownership metadata, database inventories and sizes | `EXECUTED` and `VERIFIED` | Evidence saved before deletion |
| Delete 199 positively identified detached disposable harness volumes | `EXECUTED` and `VERIFIED` | 43,576,500,000 Docker-reported bytes removed |
| Delete failed-run anonymous empty volume | `EXECUTED` and `VERIFIED` | additional 741.4 kB removed |
| Change all three harness traps to `docker rm -fv` | `EXECUTED` and `VERIFIED` | later runs returned to baseline |
| Global Docker prune | `SKIPPED` | prohibited and unnecessary |

After cleanup and the sealed final rehearsals:

- 54 volumes remain, 2 attached;
- volume usage is 9.671 GB;
- zero `cairn-public-mysql-*`, `cairn-pf-mysql-*` or `cairn-shanghai-mysql-*` containers remain;
- local Data filesystem has 44 GiB available and 1% inode use;
- the final two disposable MySQL runs removed both their containers and anonymous volumes.

The recovered-byte figure is Docker's logical volume usage, not a claim that Docker Desktop's sparse VM image immediately returned an identical number of physical host bytes.

Pre-delete evidence is in `/Users/mzm/Downloads/Cairn_O88_Final_Closure_20261021/docker-recovery`. The deleted data was disposable isolated QA data and is reproducible by rerunning the harnesses; no business-data restore is applicable.

## Resources deliberately protected locally

Status: `VERIFIED`

- attached `cc-builder_mysql_data`;
- attached Cairn closure data volume `7de663…`;
- every named volume;
- all `cairn_hike_client_*` volumes;
- ambiguous `cairn`, `cairn_test`, `cairn_quality` and project-generator resources;
- any volume without positive harness/database ownership evidence.

## yiiling read-only inventory

Status: `INSPECTED` and `VERIFIED`; no remote maintenance was necessary.

Host identity: `ubuntu@122.51.174.118`, hostname `VM-0-5-ubuntu`, Ubuntu 24.04.

Final observation:

- root filesystem: 40 GB total, 25 GB used, 13 GB available, 66%;
- inode use: 16%;
- available memory: 994 MiB; swap 1.9 GiB used;
- Docker: 5.102 GB images, 10 containers/3 active, 3.145 GB volumes/2 active, 5.691 GB build cache;
- running and healthy: `cairn-backend`, `cairn-pf-review-393338b`, shared `ainews-db` MySQL;
- active systemd services inspected: Docker, nginx, `cairn-feature-map`, `clip`, and `k0-api`;
- `ainews-backend` has been stopped for approximately five months and has an approximately 145 MB log;
- `k0-api` is independent of Cairn, but was not paused because there was no genuine server pressure;
- no current disk, inode or load emergency was present.

Service names were not treated as ownership evidence. Dependency and database inspection established that `ainews-db`/`ainews_mysql_data` is shared infrastructure. It contains Cairn (67 tables, approximately 333.1 MB), ainews (approximately 92.5 MB), K0 (approximately 34.9 MB) and other application/review databases.

## Remote operations and protected state

| Operation | Status | Result |
| --- | --- | --- |
| Stop non-Cairn workload | `SKIPPED` | host healthy; no justification |
| Remove remote logs, images, cache or volumes | `SKIPPED` | host healthy; no justification |
| Modify Docker/systemd/restart policy | `SKIPPED` | no remote mutation |
| Restart host, Docker, MySQL, proxy or Cairn | `SKIPPED` | prohibited and unnecessary |
| Cairn health before/after | `VERIFIED` | local and `https://api.yiiling.cn/health` both `status/db: ok` |
| Shared MySQL health before/after | `VERIFIED` | MySQL 8.0.45, server UUID unchanged |
| Cairn migrations before/after | `VERIFIED` | ledger through 051; SHA-256 `adf074118ef51e58a4c08a0a8696e3660967ba1ff9db32ba9eb9e11a7486f0d4` unchanged |
| Cairn DB metadata before/after | `VERIFIED` | fingerprint `298113722ede5e2840a1aff5f3c582cb0995c87063659dc7e2cff63fdcf79238` unchanged |
| Production checkout | `VERIFIED` | `041c90caec568e21f2056a859de078ba23718996`, unchanged |

Protected without exception: shared MySQL and `ainews_mysql_data`, Cairn API/review services, nginx/TLS/networking, Docker engine, all Cairn tables/data/migrations/jobs, K0 retained records, source, secrets, unknown volumes and unknown application data.

No remote backup or restoration command was needed because no remote state changed. No service was paused, so no service restoration procedure exists. Optional cleanup of stopped application logs or Docker build cache was deliberately skipped. If future remote pressure develops, ownership, dependency, backup and exact recovery measurements must be repeated before any itemized deletion.

## Maintenance verdict

The local isolated-QA leak was corrected and verified. yiiling was healthy and was left unchanged. There is no remaining remote deletion requiring Owner approval from this incident.

