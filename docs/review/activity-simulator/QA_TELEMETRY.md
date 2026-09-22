# Activity Simulator QA telemetry

## Purpose and scope

This is an Internal-build diagnostic trail, not product analytics and not an
Activity correctness dependency. It records native map/camera/touch/provider
state so a physical-iPhone reproduction can be investigated without a manual
JSONL export. Production builds have
`EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=false`, so this trail is not created
there.

Client QA telemetry and backend logs answer different questions:

- Client QA telemetry proves screen lifecycle, Mapbox callbacks, camera
  contract, touch responders, provider selection, generated and canonical
  location decisions, and Activity lifecycle.
- Backend logs prove HTTP, sync, server, and database behavior only. They
  cannot prove that a native map rendered or that a touch reached React Native.

## Session identity

Every Internal QA run has a stable `qaSessionId` with the form
`qa-<time>-<random>`, capped at 64 characters. It is:

- shown in full under `更多` in the expanded SIM diagnostics;
- stored locally with every event as both `qaSessionId` and `session_id`;
- used as the `telemetry_sessions.session_id` on upload.

A live session is reused across Debug Mode ON/OFF transitions so the normal
Debug-OFF Hike entry and Simulator cases can be correlated. It expires after
six hours; a later Internal run gets a new ID.

## Transport and storage

- Upload endpoint: `POST /api/telemetry/sessions`
- Normal Internal API host: `https://api.yiiling.cn` from
  `EXPO_PUBLIC_API_BASE_URL` in the EAS profile
- Server storage: MySQL `telemetry_sessions`, with QA rows marked
  `activity_mode='qa_activity'`; events are newline-delimited JSON in
  `raw_jsonl`
- Client storage: AsyncStorage keys prefixed
  `@cairn:activity_simulator_logs:v1:` plus a per-session bounded upload-state
  record

The existing reviewed uploader and endpoint are reused. There is no parallel
analytics service.

### Internal OTA environment preflight

The installed Internal/preview client must receive its public/runtime values
from the named EAS environment when a new JS bundle is exported. Values under
`eas.json` `build.preview.env` belong to native builds and are not a substitute
for the EAS Update environment. Publish the human-owned diagnostic OTA with
`--environment preview` and verify presence without printing values:

```sh
npx eas-cli env:exec preview 'node -e "const t=process.env.EXPO_PUBLIC_MAPBOX_TOKEN||\"\"; const a=process.env.EXPO_PUBLIC_API_BASE_URL||\"\"; console.log(JSON.stringify({mapboxPublicTokenConfigured:t.startsWith(\"pk.\")&&t.length>=40,apiYiiling:a===\"https://api.yiiling.cn\",simulatorEnabled:process.env.EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED===\"true\"}))"' --non-interactive
```

All three booleans must be `true`. Never print the token itself. O37 proved
that an otherwise-mounted native Mapbox surface receives 401s when the OTA
bundle lacks the public token.

Upload authentication accepts either the signed-in app Bearer JWT or the
operations `X-API-Key`. Retrieval is operations-only and requires
`CAIRN_TELEMETRY_API_KEY` in the server environment. Keep that value in the
approved secret manager or shell environment; never paste it into source,
prompts, logs, or this document.

Deployment prerequisite: production must be on a commit containing the
authenticated telemetry route, server-side QA redaction/bounds, and retention
handling in `backend/src/routes/telemetry.js`, with
`CAIRN_TELEMETRY_API_KEY` configured server-side. Verify unauthenticated
retrieval is rejected before treating yiiling-side retrieval as restricted.

## Retrieval for a future Codex session

The preferred production path keeps the operations key inside the running
backend container. It does not copy, echo, or interpolate the key through the
local shell. Replace only the session ID in this read-only command:

```sh
ssh ubuntu@122.51.174.118 \
  'sudo -n docker exec -i cairn-backend node' <<'NODE'
const qaSessionId = 'qa-SESSION-ID';
const base = 'http://127.0.0.1:3001/api/telemetry/sessions';
const key = process.env.CAIRN_TELEMETRY_API_KEY;
if (!key) throw new Error('Production telemetry operations key is not configured');
(async () => {
  const response = await fetch(`${base}/${encodeURIComponent(qaSessionId)}`, {
    headers: { 'X-API-Key': key },
  });
  if (!response.ok) throw new Error(`Telemetry retrieval failed: ${response.status}`);
  const body = await response.json();
  process.stdout.write(`${body.session.raw_jsonl}\n`);
})().catch(error => { console.error(error.message); process.exit(1); });
NODE
```

To locate the latest iPhone reproduction around a Shanghai-local time, first
subtract eight hours and replace the UTC `since` value below. Query from a few
minutes before the reported reproduction:

```sh
ssh ubuntu@122.51.174.118 \
  'sudo -n docker exec -i cairn-backend node' <<'NODE'
const since = '2026-09-08T06:10:00Z';
const base = 'http://127.0.0.1:3001/api/telemetry/sessions';
const key = process.env.CAIRN_TELEMETRY_API_KEY;
if (!key) throw new Error('Production telemetry operations key is not configured');
(async () => {
  const response = await fetch(`${base}?since=${encodeURIComponent(since)}&limit=50`, {
    headers: { 'X-API-Key': key },
  });
  if (!response.ok) throw new Error(`Telemetry retrieval failed: ${response.status}`);
  const body = await response.json();
  const qaRows = body.sessions.filter(row => row.activity_mode === 'qa_activity');
  process.stdout.write(`${JSON.stringify(qaRows, null, 2)}\n`);
})().catch(error => { console.error(error.message); process.exit(1); });
NODE
```

Use the exact-session command after selecting the matching `session_id`. These
commands rely on the reviewed operations credential already configured in the
container; they do not use a customer account.

If an approved operations shell already has the key, the external API can also
be queried as follows.

Use a shell where the operations key is already present in the environment:

```sh
export CAIRN_QA_API_BASE=https://api.yiiling.cn
test -n "$CAIRN_TELEMETRY_API_KEY"
```

Retrieve an exact session named by the tester:

```sh
curl --fail --silent --show-error \
  -H "X-API-Key: $CAIRN_TELEMETRY_API_KEY" \
  "$CAIRN_QA_API_BASE/api/telemetry/sessions/qa-SESSION-ID" \
  | jq -r '.session.raw_jsonl'
```

Locate recent sessions from an approximate UTC timestamp, then select the row
whose `activity_mode` is `qa_activity`:

```sh
curl --fail --silent --show-error \
  -H "X-API-Key: $CAIRN_TELEMETRY_API_KEY" \
  "$CAIRN_QA_API_BASE/api/telemetry/sessions?since=2026-09-08T00:00:00Z&limit=50" \
  | jq '.sessions[] | select(.activity_mode == "qa_activity")'
```

Then fetch the selected `session_id` with the exact-session command. Do not
print, echo, or commit the operations key. If the server returns `503`, the
operations key is not configured server-side. `401` means the supplied key was
missing or invalid.

For a Shanghai-local reproduction time, subtract eight hours to obtain UTC.
For example, `2026-09-08 14:20 Asia/Shanghai` is `2026-09-08T06:20:00Z`.
Query from several minutes before the reproduction, then compare each row's
`uploaded_at`, device metadata, and `qaSessionId`:

```sh
curl --fail --silent --show-error \
  -H "X-API-Key: $CAIRN_TELEMETRY_API_KEY" \
  "$CAIRN_QA_API_BASE/api/telemetry/sessions?since=2026-09-08T06:10:00Z&limit=50" \
  | jq '.sessions[] | select(.activity_mode == "qa_activity")'
```

For an iPhone that has not uploaded, the expanded panel still offers **Copy
JSONL diagnostics** as a fallback; this is no longer the normal workflow.

## Event schema

Each JSONL line contains:

| Field | Meaning |
| --- | --- |
| `session_id`, `qaSessionId` | Stable QA reproduction identity |
| `timestamp`, `wallClockTimestamp` | Client epoch milliseconds |
| `category`, `eventName` | Typed event family and action |
| `debugMode`, `simulatorEnabled` | Debug/tool state at emission |
| `providerSource`, `trackingStatus` | Fixed Activity provider and lifecycle |
| `simulatorSessionId` | Synthetic-provider session, or null |
| `clientActivityIdSuffix`, `ownerSuffix` | Correlation-safe ID suffixes |
| `virtualTimestamp`, `timeScale`, `effectiveVirtualElapsed` | Simulator clock evidence |
| `sampleSequence`, `batchSequence` | Ordered synthetic evidence |
| `coordinateSource` | `real`, `simulator`, or `none`; drives privacy scrubbing |
| `fields` | Bounded event-specific diagnostic metadata |

Important event groups include:

- `APP`, `SCREEN`, `DEBUG`: app foreground/background, Hike/Run open/close,
  Debug and Simulator setting changes.
- `MAP_STATE`: MapView mount, style start/load, map load/idle/full render,
  error, camera target/ref, fly-to start/complete/interruption, and recenter.
- `SIM_INPUT`: panel, Start Here, Use Map Center, destination/waypoint, speed,
  time scale, altitude, accuracy, signal, and joystick responder events.
- `SIM_SAMPLE`, `GPS_ACCEPT`, `GPS_REJECT`, `ACTIVITY_POINT`: generated,
  accepted/rejected, and durably committed sample evidence.
- `ACTIVITY_STATE`, `ACTIVITY_RECOVERY`, `ACTIVITY_COMPLETION`, `ERROR`:
  start/tracking/pause/resume/finish/recovery and JS/Mapbox/state errors.

For O44/O45 real-location work, read the following additional chain:

1. `activity_location_cadence_experiment_v1` identifies the fixed 5 m or 1 m
   foreground variant;
2. `rnmapbox_location_source` counts only a changed RNMapbox source timestamp
   or coordinate, while carrying the coalesced heading-only repeat count;
3. `activity_observation_received_v2` records the Expo raw-to-raw interval and
   relative displacement;
4. `activity_filter_decision_v2` and `activity_candidate_transition_v1` explain
   canonical acceptance/quarantine/rejection;
5. `activity_location_lifecycle_plan_v1` records the ownership decision for
   `active`, `inactive`, or `background` without treating transient inactive as
   a GPS fact;
6. `background_location_authorization_refreshed` and
   `activity_background_authority_v2` distinguish OS permission, request
   eligibility/result, Settings-required state, registration, native task
   ownership, callbacks, drain, and foreground takeover;
7. `activity_telemetry_health_v2` reports `sourceHealth` separately from
   `canonicalHealth` and gives the canonical degradation reason.

All spatial comparisons in this chain are relative distances. Exact real
coordinates are never added to the upload payload.

`simulator_first_point_accepted` is the canonical decision. The later
`simulator_first_point_committed` proves the same point passed the verified
Activity journal boundary; neither should be inferred from the other.

## Privacy rules

- Precise real GPS coordinates are removed recursively at upload. Real events
  retain only diagnostic metadata such as accuracy, source, timestamps,
  sequence/ownership suffixes, and acceptance/rejection reason.
- The backend repeats the same fail-private scrub for `qa_activity` rows before
  storage. It does not trust the client version or use client redaction as the
  sole privacy boundary.
- Precise coordinates are retained only when `coordinateSource` is explicitly
  `simulator`/`simulated`.
- Secret-bearing keys are removed recursively. Bearer strings, JWT-like values,
  email addresses, and secret-looking URL query values are redacted from string
  fields before upload.
- Passwords, access/refresh tokens, authorization headers, reset codes, raw
  email credentials, cookies, API keys, and other secrets must never be added
  as telemetry fields.
- The QA ID may correlate client and server evidence; backend request logs still
  do not become evidence of native rendering.

## Bounds and retention

- Uploads batch at most once per 20 seconds per session.
- Client sessions retain at most 2,000 events, 512 KiB, and five session files.
- Same-session appends are serialized and drained before storage/upload, so
  sibling provider/accept/commit events emitted in one promise turn cannot
  overwrite one another.
- Routine generated/position/accept/reject/metric/Memory observations are
  sampled, and repeated native loading errors or real-map location observations
  are coalesced. Up to 384 recent critical lifecycle transitions are reserved
  against ordinary sample churn; the total byte/event limits remain absolute.
- The backend independently rejects `qa_activity` uploads over 2,000 events or
  512 KiB before storing them.
- Automatic attempts are capped at 300 per session. Five consecutive retryable
  failures stop automatic retries. Counts persist across app restarts.
- Upload eligibility expires after 24 hours. Debug telemetry may be dropped;
  Activity, Cairn, and Memory product data do not use this policy.
- The server opportunistically deletes only `qa_activity` rows older than 14
  days. Other historical telemetry is untouched.
- Upload obeys the telemetry enable switch, connectivity state, and optional
  Wi-Fi-only setting.

## Fast trace reading order

For a native map failure, sort JSONL by `timestamp` and read:

1. `app_start` and `debug_mode_*`;
2. `hike_opened` or `run_opened`;
3. map mount/style/load/idle plus `cameraInitialTarget`;
4. `*_camera_fly_to_*` or action-attempt/rejection events;
5. `activity_provider_selected` and `activity_tracking_started`;
6. joystick grant/update/release;
7. synthetic generation, canonical acceptance/rejection, and committed point.

That chain distinguishes a missing native map callback, a blocked touch, a
missing camera ref, a provider gate, and a canonical Activity rejection.

For the O37 virtual-origin and correction contract, preserve order and read:

1. `virtual_origin_selected` (synthetic coordinate is permitted);
2. `activity_provider_selected` → `activity_start_requested` →
   `simulator_provider_locked`;
3. any `real_callback_rejected_for_simulator_activity`;
4. `simulator_first_sample_generated` → `simulator_first_point_accepted` →
   `simulator_first_point_committed` (routine `activity_point_committed` is
   sampled separately);
5. `simulator_gps_state_changed`, then for explicit Lost recovery
   `simulator_manual_reacquisition_requested` →
   `simulator_manual_reacquisition_committed` and the new segment ID;
6. `simulator_rollback_requested` → `simulator_rollback_completed`, including
   requested/actual metres, removed/retained point counts, recalculated
   metrics, and the explicit `memoryRolledBack=false` /
   `cairnsRolledBack=false` decisions.

Every map event carries the screen-specific `mountId`. Separate mount IDs on
successive Hike/Run entries are the evidence that screen-local style/readiness
and initial-camera state were recreated. The transition events above are
protected from ordinary stationary-sample churn; event count and payload size
remain hard bounded, so pathological diagnostic input may still drop the
oldest event rather than affect product behavior.

## O37 transport proof and O38 sufficiency boundary

Production session `qa-mttg439c-ccqp1eyj` was automatically uploaded from the
iPhone in repeated authenticated batches. Nginx recorded 200 responses at the
20-second cadence; five client-cancelled 499 requests during backgrounding were
followed by successful retry uploads. Operations retrieval returned 657 events
and 523,842 bytes, beginning at `virtual_origin_selected` and ending at
`app_backgrounded`.

That remote payload is a useful negative comparison against the O37 client
buffer: it has no upload checkpoint/local-count event and is missing map mount,
provider lock, first commit, Finish, Save, and sync transitions. An exact local
versus remote event-count comparison is therefore **inconclusive for O37**—the
iPhone-local file is not remotely readable, and pretending otherwise would
overstate the evidence. It does prove that the previous remote row was not
diagnostically sufficient.

O38 closes the identifiable client-side losses with serialized appends,
pre-upload draining, critical-event reservation, sampling/coalescing, and
`qa_upload_checkpoint` records containing bounded local event count and upload
bytes. Tests prove forty same-turn events survive immediate export and the
critical reconstruction set survives more than 2,000 routine events.

### O38 native automatic-upload proof

Production session `qa-mttg439c-ccqp1eyj` now contains the completed O38
Activity `f09a9952-4b6c-4278-ba8c-d4831c81ed2d` (`hike-09/09/2026`).
Operations retrieval returns 833 parsed events / 524,245 bytes; 661 events
carry that Activity identity. Nginx records authenticated iPhone POST 200s at
approximately 20-second cadence throughout the reproduction. Manual JSONL was
not used.

The retained chain includes virtual origin, provider selection/lock, first
generated/accepted/committed point, sampled movement and stationary rejection,
Memory/metric checkpoints, Finish, per-segment matching, Save, a
`syncState='synced'` server acknowledgement, completion, and origin clear.
Upload checkpoints at local event counts 683, 730, and 785 are present. The
row is close to its hard byte bound because native Mapbox emitted 542 idle
events, but the critical reservation preserved enough evidence to reconstruct
the Activity. This establishes that O38 telemetry is automatically uploaded
and diagnostically sufficient for this native forensic; JSONL remains fallback
only.

### O38 production operations smoke

After backend commit `8900028e` was deployed through the canonical SOP on
2026-09-09, session `qa-o38-smoke-1788927556466` proved the complete operations
path without a customer account:

- anonymous upload and anonymous exact retrieval returned `401`;
- operations-key upload and exact `qaSessionId` retrieval returned `200`;
- recent-timestamp listing located the same session;
- a synthetic Simulator coordinate survived;
- real-coordinate-shaped fields were removed; and
- password/token/authorization/cookie/email-shaped fields and values were not
  stored.

The smoke validates transport/auth/privacy and does not claim native client
event completeness. That remains the first O38 device-session check described
above.
