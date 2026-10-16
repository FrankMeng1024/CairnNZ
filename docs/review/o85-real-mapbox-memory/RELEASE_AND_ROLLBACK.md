# O85 release and rollback disposition

## Verified current baseline

- Client base / current O84 OTA Git SHA:
  `71a1f3ab89460db3e55e59e8b24d11310d353089`.
- Current production iOS update: ID
  `01a1438a-9341-7774-8b04-a87afe660228`, group
  `c83a6def-8777-48c1-9ebc-ff0453080601`, published 2026-10-16 07:08:37Z,
  message `O84 Friends Memory and O83 Route owner-test candidate`, runtime
  `0.2.6-o66`, branch/channel `production`, clean Git source at the SHA above.
- Compatible installed binary: Store iOS Build **65**, EAS build
  `ad38c7b4-abe0-4378-ab5a-4e43a1962cc5`, app `0.2.6`, runtime
  `0.2.6-o66`, production channel.
- Production backend / `origin/master`:
  `f35f2b745d2c9d145a49a902c595d3611673bc35`, migration 047.

This supersedes the earlier O84 handoff statement that O82 was still current;
the O84 update was published externally after that record. O85 work made no
backend, native dependency, app version, runtime or build changes.

## Current disposition

**HOLD — O85 OTA NOT PUBLISHED.** M3 has no genuine selected production Friend
cell and no native visible-map proof. R2/R3 also lack their historical native
gesture/provider traces. Under the repository guardrail, a HOLD does not earn
an O marker increment: `OtaBadge.tsx` remains `O84`. The human-only OTA rule is
an additional publication authority boundary, but it is not the reason for
this technical HOLD.

No backend deployment is required because no backend source changed. No EAS
Build was run or requested.

## Exact human publication route after the HOLD is cleared

Only after nonzero authorized production friend cells visibly render on the
Owner's Build 65 and the final iPhone route checks pass:

1. Increment the single `O84` marker in `app/src/components/OtaBadge.tsx` to
   `O85` exactly once. Do not change app/runtime/build versions.
2. Re-run the focused tests, `npm run verify:changed`, real-basemap QA and
   `git diff --check`; commit the marker and evidence on a clean reviewed SHA.
3. A human operator runs exactly one iOS update:

```sh
cd /Users/mzm/Desktop/cairn/CairnNZ
test -z "$(git status --porcelain)"
grep -q "export const OTA_VERSION = 'O85'" app/src/components/OtaBadge.tsx
node -e 'const c=require("./app/app.config.js")(); if(c.version!=="0.2.6"||c.runtimeVersion!=="0.2.6-o66"||c.updates.url!=="https://u.expo.dev/8c80a6aa-1c08-44a7-8f21-e331ae7548fb") process.exit(1)'
cd app
EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn \
EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false \
EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=false \
npx eas-cli update \
  --channel production \
  --environment production \
  --platform ios \
  --message "O85 Route integrity and Friend Fog closure" \
  --non-interactive
```

Record Update ID, Group ID, runtime, publish time and Git SHA. Cold-launch
Build 65 twice and confirm O85 before acceptance. Publication is not proof of
device behavior.

## Rollback

Until O85 is published there is nothing to roll back: production remains O84.
If a future O85 is published, rollback is a new human-published iOS update on
the same channel/runtime from the last accepted clean source. Never reuse an
O85 receipt, downgrade runtime, run an EAS Build, or roll back migration 047
while eligible O84/O85 clients remain active.
