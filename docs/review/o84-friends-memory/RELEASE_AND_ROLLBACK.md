# O84 release, deployment and rollback boundary

## Identity

- Candidate marker: `O84`, incremented exactly once from O83.
- Compatible Owner binary: iOS Build 65.
- App version: `0.2.6`.
- Runtime: `0.2.6-o66`.
- Channel: `production`.
- No native/config/dependency change requiring an EAS Build.

## Current disposition

**OTA NOT PUBLISHED. BACKEND NOT DEPLOYED.** Repository rules reserve both
operations for the human workflow. O84 also changes the backend schema and API,
so publishing the client before migration 047 and matching backend source are
live is prohibited.

## Human backend sequence

The Owner/operator must follow `docs/operations/PRODUCTION_BACKEND_DEPLOY.md`.
The verified O84 candidate is based on `origin/main`, while the deploy-bearing
branch is `origin/master`; do not push the mixed client/backend candidate to the
deployment branch as an incidental shortcut:

1. From current `origin/master`, create and review the required scoped
   backend-only commit containing the exact O84 backend changes. Push normally;
   never force push. Record both that deployment SHA and the source O84 SHA.
2. Confirm the backend files match the reviewed O84 candidate, then complete
   the read-only production precheck and database backup.
3. Confirm migration 047 and its rollback archive procedure are present.
4. Run only the canonical deployment command:

   ```sh
   ssh ubuntu@122.51.174.118 'sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh'
   ```

5. Record checkout SHA, migration ledger including 047, image digest, health
   responses and post-deploy logs. Re-run Journey A and the authorized sharing
   API checks against production test accounts before OTA publication.

If rollout fails, stop before OTA. For an authorized database rollback, first
revert server/client compatibility, then run
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
