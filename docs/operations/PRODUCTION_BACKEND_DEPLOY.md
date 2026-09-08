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
