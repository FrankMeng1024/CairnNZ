# O64 Owner OTA and Public Handoff

## Candidate identity

- Visible Home marker: `O64`
- App version: `0.2.6`
- Runtime version: `0.2.6-o61`
- Production channel: `production`
- Client source commit: `389e95521d3eddee5959e62c2c3c08c15b564b29`
- Expected `app` tree: `91f736c71efefad2b0a77c68f1c5024c8cdc6a62`
- Backend deployed commit: `43c473388ee0a14955bcc71744d1f4fc3a4f4f6c`
- Backend image: `sha256:4958f0ee02fb8f8a637f7b7714016a75e96c16b4be16e904acd7f082429f02c2`
- Migration ledger: `044`
- OTA published by this recovery task: **no**
- Native build created/submitted by this recovery task: **no**

The final repository HEAD may contain only the textual handoff above the client
source commit. The `app` subtree is the publish authority.

## Exact owner OTA preflight

Run from the existing checkout. The local `_review` captures may remain dirty;
they are not deploy inputs. Every other app path must match the candidate.

```bash
cd /Users/mzm/Desktop/cairn/CairnNZ
git pull --ff-only origin master
test "$(git rev-parse HEAD:app)" = "91f736c71efefad2b0a77c68f1c5024c8cdc6a62"
test -z "$(git status --porcelain -- app ':(exclude)app/_review/**')"
node -e 'const c=require("./app/app.config.js")(); if(c.version!=="0.2.6"||c.runtimeVersion!=="0.2.6-o61"||c.updates.url!=="https://u.expo.dev/8c80a6aa-1c08-44a7-8f21-e331ae7548fb") process.exit(1)'
grep -q "export const OTA_VERSION = 'O64'" app/src/components/OtaBadge.tsx
```

If any command exits non-zero, do not publish from that checkout.

## Exact manual OTA command

The owner runs this manually. Do not change app/runtime/build versions and do
not create a native build for O64.

```bash
cd /Users/mzm/Desktop/cairn/CairnNZ/app
EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn \
EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false \
EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=false \
npx eas-cli update \
  --channel production \
  --environment production \
  --platform ios \
  --message "O64 Cairn incident recovery candidate" \
  --non-interactive
```

After publication, record the EAS update ID, group ID, publish time, channel,
runtime and source commit in a new owner round. Cold-launch twice and confirm
`O64` before executing `OWNER_RETEST_PATCH.json`. Do not overwrite the original
owner JSON.

## Public canary state

- Production gate: **ON**.
- Consumer allowlist: exactly accounts `103` and `106` (owner).
- Operator role: account `107`; it is not a consumer allowlist entry.
- Broad exposure remains controlled; there is no global Public feed/search/map.
- Production QA rows were cleaned: publications/encounters/thanks/reports are
  all zero after verification.
- Gate rollback remains the first response to a privacy/moderation incident;
  migration 044 and historical audit data do not need to be removed.

Public is genuinely usable for the authorized accounts now. The remaining
acceptance boundary is a physical two-actor walk with current native GPS; Web
or synthetic callbacks are not claimed as native proof.

## Disposition

`OWNER_OTA_CANDIDATE_READY_DEVICE_ACCEPTANCE_PENDING`
