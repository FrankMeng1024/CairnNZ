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

- shown by suffix in the expanded SIM header and in full in SIM diagnostics;
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
- The backend independently rejects `qa_activity` uploads over 2,000 events or
  512 KiB before storing them.
- Automatic attempts are capped at 120 per session. Five consecutive retryable
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
