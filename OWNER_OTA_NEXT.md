# O63 Owner OTA and Public Handoff

## Candidate

- Marker: O63
- App version: `0.2.6`
- Runtime version: `0.2.6-o61`
- Client source commit: `9a0b3f6d4b17d4f2b471195b865e8fa2453f755d`
- Expected `app` tree: `7d8b5932f8597722141375e03410aa3f7aff3a10`
- Backend deployed commit: `6854161c4f8cdf93379e81231d85d5e66deeec86`
- Public gate: OFF

The final repository HEAD may be a documentation-only handoff commit above the client source commit. Verify the `app` subtree, not just the top-level commit.

## Exact owner OTA steps

Run these manually from the clean checked-out candidate:

```bash
cd /Users/mzm/Desktop/cairn/CairnNZ
git pull --ff-only origin master
git status --short
git rev-parse HEAD:app
```

Expected:

- `git status --short` prints nothing.
- `git rev-parse HEAD:app` prints `7d8b5932f8597722141375e03410aa3f7aff3a10`.

Then publish the iOS OTA manually:

```bash
cd /Users/mzm/Desktop/cairn/CairnNZ/app
EXPO_PUBLIC_API_BASE_URL=https://api.yiiling.cn \
EXPO_PUBLIC_PLAYWRIGHT_BYPASS=false \
EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=false \
npx eas-cli update \
  --channel production \
  --environment production \
  --platform ios \
  --message "O63 JSON-driven systemic unification" \
  --non-interactive
```

Do not change the app version, runtime version, or build number. Do not create or submit a native build for this candidate.

After publishing:

1. Record EAS update ID, group ID, publish time, channel, runtime, and source commit in a new owner test round.
2. Cold-launch a production-channel device twice and confirm the Home marker is O63.
3. Execute `OWNER_RETEST_PATCH.json` in its listed order. Keep every result pending until observed on the owner device.
4. Preserve the current owner JSON and append history through the owner's normal tooling; do not replace it with the retest patch.

Public code remains unreachable with the production gate off, so the normal O63 owner OTA does not require Public activation.

## Public activation: blocked, do not perform yet

Do not enable Public until all of the following exist:

- The owner's exact numeric user ID.
- A second isolated disposable actor's exact numeric user ID.
- Native positive walking proof for Hike and Run before Finish.
- Negative proof for stale activity, wrong identity/generation, simulator data, and out-of-radius cases.
- Author publication, viewer discovery, report, hide/moderation, and capability rollback proof.
- A working isolated MySQL end-to-end harness or equivalent production-safe evidence.

The authority JSON does not provide the required IDs. Do not guess them and do not use broad matching.

## Public activation procedure after approval

These are operator steps for a later approved canary, not part of the O63 OTA:

1. Connect to production and back up the current environment file with a timestamp:

```bash
ssh ubuntu@122.51.174.118
sudo -n install -d -m 700 /var/backups/cairn
sudo -n cp -a /opt/githubRepos/Cairn/docker/.env \
  /var/backups/cairn/docker.env.pre-public-$(date -u +%Y%m%dT%H%M%SZ)
```

2. Use the privileged editor; set only these two lines, substituting the two approved numeric IDs:

```bash
sudoedit /opt/githubRepos/Cairn/docker/.env
```

```dotenv
CAIRN_PUBLIC_PILOT_ENABLED=1
CAIRN_PUBLIC_PILOT_IDS=<owner_numeric_id>,<second_actor_numeric_id>
```

3. Run the canonical deployment and wait for its health checks:

```bash
sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh
```

4. With each allowlisted account's bearer token, verify capability independently:

```bash
curl -fsS \
  -H 'Authorization: Bearer <token>' \
  https://api.yiiling.cn/api/public-cairns/capabilities
```

5. Run the approved two-actor matrix. Stop immediately on cross-account leakage, simulator acceptance, stale-session acceptance, route mutation, recording interruption, or moderation failure.

## Public rollback

Rollback is gate-first:

```bash
ssh ubuntu@122.51.174.118
sudoedit /opt/githubRepos/Cairn/docker/.env
```

Set:

```dotenv
CAIRN_PUBLIC_PILOT_ENABLED=0
CAIRN_PUBLIC_PILOT_IDS=
```

Then redeploy and confirm an authenticated canary capability response is disabled:

```bash
sudo -n bash /opt/githubRepos/Cairn/docker/deploy.sh
```

Do not roll back the database or route history merely to close the canary; the global gate is the designed kill switch.

## Disposition

`OWNER_OTA_CANDIDATE_READY_PUBLIC_BLOCKED`
