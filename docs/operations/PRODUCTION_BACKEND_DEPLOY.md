# Production backend deployment

## Server

- Host: `122.51.174.118`
- SSH user: `ubuntu`
- Checkout: `/opt/githubRepos/Cairn`
- Backend container: `cairn-backend`
- MySQL container: `ainews-db`
- Backend binding: `127.0.0.1:3001`

## Canonical deploy

```sh
ssh ubuntu@122.51.174.118 'sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh'
```

The canonical script owns Git fetch/reset, pending migrations, backend image
build, backend recreation/restart, and health verification. Do not substitute
manual production Git commands, file copying, image builds, or container
restarts.

## Rules

If backend/server/deployment code changed:

1. Create a scoped backend-only commit from current `origin/master`.
2. Run relevant backend tests, syntax checks, and `git diff --check`.
3. Push normally to `origin/master`; never force push.
4. Complete the read-only production precheck.
5. Run the canonical deploy command.
6. Verify checkout commit, migration ledger, backend/DB health, public health,
   and new backend logs.

If backend did not change, do not push, deploy, restart, or otherwise touch
production merely for client OTA work.

Client OTA publication is performed manually by the human from the normal
local app directory. Backend deployment does not authorize an OTA.

Do not:

- use ad-hoc backend restarts;
- manually pull/reset the production checkout;
- run `git clean`;
- restart MySQL unless explicitly required;
- restart nginx unless explicitly required.

## Deferred operational debt: deploy fetch amplification

The 2026-09-08 O36 telemetry deployment spent about 38 minutes fetching a
72.9 MB pack even though its backend-only commit was small. Production was
also behind asset-heavy client/review commits on deploy-bearing `master`:
the missing range contained 771 changed files and about 79.7 MiB of
uncompressed blobs. Transport over GitHub SSH port 443 averaged only about
32 KB/s. Disk pressure, stale locks, and local I/O wait were ruled out.

Do not change production Git/deployment architecture as an incidental part of
an application rollout. Track a deliberate future operations task to prevent
generated QA screenshots, runtime captures, and review boards from being
committed heavily to deploy-bearing `master` (prefer bounded external build/QA
artifacts). Separately evaluate a backend-focused checkout or artifact deploy
and fetch progress/watchdog logging. Do not rewrite repository history merely
to address this debt.
