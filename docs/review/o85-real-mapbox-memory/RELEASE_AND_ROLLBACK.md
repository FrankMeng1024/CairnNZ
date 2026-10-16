# O85 release and rollback disposition

## Baseline and candidate

- Current production iOS update remains O84: update
  `01a1438a-9341-7774-8b04-a87afe660228`, group
  `c83a6def-8777-48c1-9ebc-ff0453080601`, runtime `0.2.6-o66`, compatible
  installed iOS Build 65.
- O85 client source is the tip of `codex/o85-real-mapbox-closure`; the single
  Home marker is `O85`. App version, runtime, build version and native
  dependencies are unchanged.
- Production backend is `ec8e169dd0aa444e7936d2e2327414a493a5ce0c`, healthy,
  with migration ledger 050. The pre-change verified backup is
  `/opt/cairn-backups/o85-phase2/cairn-pre-o85-phase2-20261017T0250CST.sql.gz`
  (SHA-256 `900b79b19ac34bb694ed137f15fb258f5adbf4aecc9ab1dce45ce6d671452019`).

## Disposition

**SOURCE READY — HUMAN OTA NOT PUBLISHED.** The former M3 production-data HOLD
is cleared: the production API returns 68 authorized cells and both Memory and
Route visibly render both source regions through live Mapbox WebGL. No physical
iPhone/native GPS/Mapbox PASS is claimed. No EAS Build was run.

## Exact human publication command

Run from the clean reviewed client SHA only:

```sh
cd /Users/mzm/Desktop/cairn/CairnNZ
test -z "$(git status --porcelain)"
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/codex/o85-real-mapbox-closure)"
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

Record Update ID, Group ID, runtime, publish time and Git SHA. Cold-launch Build
65 twice and confirm O85. Then replay Memory → Friends and Route Editor → Mine &
Friends across both source cities, background/foreground once, reload the map
style, perform one short real walk and verify its delayed Fog after 30 minutes,
then revoke one grant and confirm immediate disappearance.

## Rollback

If O85 must be rolled back after human publication, publish a new iOS update on
the same channel/runtime from the last accepted clean source. Do not reuse an
O85 receipt, downgrade runtime, run an EAS Build, or roll back migrations 049/050
while O84/O85 clients remain active.
