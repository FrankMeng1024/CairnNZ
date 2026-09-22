# Activity Simulator logging contract

Date: 2026-09-13 (OTA55 dual-mode revision)
Format: bounded local JSONL plus authenticated internal-QA batch upload

## Purpose

The log must answer, in order:

1. What input/configuration did the tester choose?
2. What ground-truth position and observed fix did the Simulator generate?
3. Did the real Activity/Plant authority accept or reject it, and why?
4. Which segment, metrics, Memory, Cairn, completion, sync, ACK, and cleanup effects followed?

It is internal diagnostic evidence, not product analytics or a correctness dependency. Eligible Internal/Debug sessions upload automatically through the reviewed QA telemetry route; failure is bounded and may be dropped.

## Categories

| Category | Meaning / representative events |
|---|---|
| `APP`, `SCREEN`, `DEBUG` | app/screen lifecycle and Debug/Simulator setting state |
| `MAP_STATE` | native mount ID, style/load/idle, camera and nonterminal Mapbox errors |
| `PROVIDER`, `LOCATION` | provider lock/fencing and real/synthetic canonical decisions |
| `SIM_SESSION` | bind/unbind Simulator session and its cadence/seed |
| `SIM_INPUT` | joystick, waypoint, speed, altitude, accuracy, signal restore, start selection |
| `SIM_POSITION` | deterministic virtual physical movement, including hidden LOST movement |
| `SIM_SAMPLE` | Clean or Raw synthetic observation emitted at provider cadence, before canonical decision |
| `GPS_ACCEPT` | canonical Activity/Plant acceptance result |
| `GPS_REJECT` | rejection result and stable reason |
| `GPS_GAP` | GPS LOST or explicit recording interruption |
| `GPS_SEGMENT` | canonical segment identity change after acceptance |
| `ACTIVITY_STATE` | provider pause/resume and lifecycle state |
| `ACTIVITY_POINT` | durable Activity point commit |
| `ACTIVITY_METRICS` | normal derived distance/duration/elevation snapshot |
| `ACTIVITY_RECOVERY` | activity parked/recovered under real recovery rules |
| `ACTIVITY_COMPLETION` | local completion or explicit discard |
| `MEMORY_EVIDENCE` | central evidence commit/dedupe outcome |
| `CAIRN_COMMIT` | offline-first local Cairn commit |
| `CAIRN_ASSOCIATION` | Cairn origin Activity association |
| `SYNC_STATE` | pending/syncing transition |
| `SYNC_ACK` | durable server mapping/acknowledgement |
| `SYNC_CLEANUP` | local post-ACK cleanup |
| `ACCOUNT_OWNER` | owner suspension/switch boundary using safe suffixes |
| `ERROR` | bounded error code or pipeline failure |

## Envelope fields

Every event has:

- `session_id`, `qaSessionId`: stable QA reproduction identity;
- `timestamp`: local event creation time in Unix milliseconds;
- `eventName`: stable snake_case event name;
- `category`: one taxonomy value above;
- `simulatorSessionId`: local synthetic session correlation ID;
- `clientActivityIdSuffix`: last eight characters only, or `null`;
- `ownerSuffix`: last eight characters of the local owner ID, or `null`;
- `virtualTimestamp`: sample/provider Unix milliseconds where relevant;
- `wallClockTimestamp`: log wall clock in Unix milliseconds;
- `timeScale`: configured evidence-clock scale (Clean through `120×`; Raw GPS through `10×`);
- `effectiveVirtualElapsed`: virtual milliseconds elapsed since Activity Start;
- `sampleSequence`: strictly increasing sample sequence within the Simulator Activity;
- `batchSequence`: 1 Hz engine-tick sequence used to correlate accelerated sub-samples;
- `coordinateSource`: `simulator`, `real`, or fail-private `none`;
- `debugMode`, `simulatorEnabled`, `providerSource`, `trackingStatus`;
- `simulatorMode`: `clean-path` or `raw-gps` on every event;
- `simulatorSeed`: the persisted deterministic Raw GPS seed on every event;
- `fields`: sanitized category-specific values.

Relevant `fields` include mode, lifecycle, segment ID/reason, synthetic ground
truth, Raw observation/error, outlier flag, latitude/longitude, altitude, hAcc,
configured physical speed, emitted speed, course, signal, sample/batch sequence,
`batchSampleIndex`, `batchSampleCount`, time scale, effective virtual elapsed,
acceptance, rejection reason, point count, derived metrics, Memory commit/dedupe,
Cairn suffixes, origin Activity suffix, sync state, server mapping suffix,
attempt count, and bounded error code.

Every Simulator Activity starts on a bounded historical anchor, including one initially at `1×`, because scale may change live. Logs retain virtual and wall clocks. Virtual timestamps are strictly monotonic, never future-dated, and capped to a 12-hour virtual Activity span. A normal 30× wall tick is one batch containing three ordered samples no more than ten virtual seconds apart. `simulator_virtual_clock_limit_reached` records the limit and no duplicate timestamp is then emitted.

## Privacy and secret handling

Full coordinates are allowed only for explicitly synthetic Simulator evidence. This permission does not change shared/real Activity logging.

Precise real GPS coordinates are recursively removed before upload and again by the server. No shared logger was changed to emit full real-user coordinates.

Field keys matching token, password, passcode, reset code, email, authorization, cookie, secret, or API-key patterns are dropped recursively. Secret-shaped string values and query parameters are scrubbed by the shared uploader/server boundary. Values are property-, depth-, array-, and string-bounded. Never add:

- access/refresh tokens;
- passwords or passcodes;
- reset/verification codes;
- raw email addresses;
- cookies or authorization headers;
- API keys or other secrets.

Owner, Activity, Cairn, and server identities use suffixes where exported. Error strings are truncated and must be stable codes/messages, not request headers or bodies.

## Retention and bounds

- maximum 2,000 events per QA session;
- maximum 512 KiB serialized per session;
- maximum five sessions per user;
- walking-geometry waypoint queue maximum 256 (stored by Simulator state, not log);
- appends for one QA session serialize before the 1.5-second flush and every
  foreground/background upload drains that append tail first;
- ordinary high-volume samples are sampled/coalesced before protected app/map/
  origin/provider/first-commit/reacquisition/rollback/Cairn/Save/sync/error
  transitions; up to 256 recent critical transitions are reserved while the
  event/byte size bounds remain absolute;
- oldest sessions beyond five are deleted from local storage;
- normal writes are coalesced for 1.5 seconds;
- rejection/error events flush promptly;
- background/inactive lifecycle flushes dirty sessions;
- dirty buffers capture their owner/session so A→B switching cannot redirect A’s log.

Automatic upload is batched no more often than every 20 seconds, capped at 120 attempts/session, stopped after five consecutive retryable failures, and expires after 24 hours. The backend retains QA rows for 14 days. These logs are not part of Activity sync cleanup.

## Export and inspection

The normal workflow is operations-only retrieval by `qaSessionId` or recent UTC window as documented in `QA_TELEMETRY.md`. If automatic upload is unavailable, in an authorized internal bundle:

1. Enable Debug Mode and Activity Simulator.
2. Start Hike or Run, expand `SIM`, then open `更多`.
3. Select **Copy JSONL**.
4. Paste the text into a local issue/report for Codex.

Export includes the newest five sessions for the current account. Each line is one JSON object. **Clear QA logs** is available only while Activity is idle and removes only Simulator logs for that account.

## Correlation recipe

For a failed sample or downstream effect:

1. Match `qaSessionId`, then `simulatorSessionId`, Activity suffix,
   `simulatorMode`, and `simulatorSeed`. Never mix Raw and Clean evidence.
2. Follow increasing `virtualTimestamp`, `sampleSequence`, and `batchSequence` from `SIM_INPUT` → `SIM_POSITION` → `SIM_SAMPLE`. For acceleration, compare `wallClockTimestamp`, `timeScale`, and `effectiveVirtualElapsed`; all samples sharing a batch sequence came from one bounded 1 Hz tick.
3. Match the immediately following `GPS_ACCEPT` or `GPS_REJECT` and its `segmentId`/reason.
4. For acceptance, find `ACTIVITY_POINT`, `ACTIVITY_METRICS`, and `MEMORY_EVIDENCE` with the same Activity suffix/time.
5. For Plant/Quick Cairn, match `CAIRN_COMMIT` and `CAIRN_ASSOCIATION` by Cairn/Activity suffix.
6. At Finish, follow `ACTIVITY_COMPLETION` → `SYNC_STATE` → `SYNC_ACK` → `SYNC_CLEANUP`.
7. If the chain stops, inspect the newest `ERROR`, the panel’s failure banner, actual network state, and owner/activity suffix.

`丢失` is logged as source-sample absence; `卡住` continues timestamps at a fixed reported coordinate. Manual Lost reacquisition has protected request/commit events and an explicit new segment. Rollback has protected request/completion events with removed/retained counts and derived metrics. `recording_interruption_forced` includes `gapReason=process-recovery`; it is distinct from all GPS conditions.
