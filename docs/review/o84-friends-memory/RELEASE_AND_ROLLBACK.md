# O84 release, deployment and rollback boundary

## Identity

- Candidate marker: `O84`, incremented exactly once from O83.
- Compatible Owner binary: iOS Build 65.
- App version: `0.2.6`.
- Runtime: `0.2.6-o66`.
- Channel: `production`.
- No native/config/dependency change requiring an EAS Build.

## EAS pre-OTA read-only verification

- The active `production` channel (`019e4879-5e08-7d10-a62e-264b6561c491`)
  maps unconditionally to the `production` update branch. Its current iOS
  update is O82, group `59588309-8fc6-4dbd-a965-7c1c7e751019`, runtime
  `0.2.6-o66`; O84 has not been published.
- EAS Build `ad38c7b4-abe0-4378-ab5a-4e43a1962cc5` is the finished Store iOS
  Build 65, app version `0.2.6`, production profile. Its source config selects
  the `production` channel and runtime `0.2.6-o66`, so an iOS-only O84 update
  on that channel/runtime is compatible with Build 65. It will not target
  binaries on another channel or runtime.
- The production profile values are API `https://api.yiiling.cn`, Playwright
  bypass `false`, and Activity simulator `false`. No project-level EAS
  Production variable with those three names currently overrides them, so the
  human command below supplies all three explicitly as an additional guard.

## Current disposition

**BACKEND DEPLOYED; OTA NOT PUBLISHED.** Production is running backend-only
commit `f35f2b745d2c9d145a49a902c595d3611673bc35`; migration ledger 047,
schema verification, backup, image/checkout identity, internal/external health
and authenticated read-only Friends/Memory APIs passed. Repository instructions
still reserve EAS Update publication for the human workflow.

## Completed backend sequence

The verified O84 candidate is based on `origin/main`, while the deploy-bearing
branch is `origin/master`. A scoped backend-only commit was created from the
latest master, verified byte-for-byte against O84, pushed by fast-forward, and
deployed through the only documented command:

```sh
ssh ubuntu@122.51.174.118 'sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh'
```

The immutable receipt, backup hash, schema counts and image ID are in
`PRODUCTION_DEPLOYMENT_RECEIPT.md`. A mutable production Journey A was not run
without dedicated account credentials; it remains the final production smoke
before publishing/installing the client.

For an authorized database rollback, first revert server/client compatibility,
then run
`backend/src/migrations/rollback/047_friend_request_lifecycle.down.sql`; it
archives every O84 attempt before the unavoidable legacy-history collapse.

## Human OTA preflight and command

After successful backend rollout and production journey verification:

```sh
cd /Users/mzm/Desktop/cairn/CairnNZ
test -z "$(git status --porcelain)"
grep -q "export const OTA_VERSION = 'O84'" app/src/components/OtaBadge.tsx
node -e 'const c=require("./app/app.config.js")(); if(c.version!=="0.2.6"||c.runtimeVersion!=="0.2.6-o66"||c.updates.url!=="https://u.expo.dev/8c80a6aa-1c08-44a7-8f21-e331ae7548fb") process.exit(1)'
cd app
EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn \
EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false \
EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=false \
npx eas-cli update \
  --channel production \
  --environment production \
  --platform ios \
  --message "O84 Friends Memory and O83 Route owner-test candidate" \
  --non-interactive
```

Run exactly once, record Update ID, Group ID, publish time, runtime and Git SHA,
then cold-launch Build 65 twice and confirm the visible O84 marker. Publication
does not itself prove device download or acceptance.

OTA rollback is a new human-published update on the same channel/runtime from
the last accepted source; never edit or reuse the O84 identity. If O84 relies on
migration 047, do not roll the backend schema back while an O84 client remains
eligible to launch.
