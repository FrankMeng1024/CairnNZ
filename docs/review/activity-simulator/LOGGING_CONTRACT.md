# Activity Simulator logging contract

Date: 2026-09-07
Format: local JSONL export backed by bounded AsyncStorage arrays

## Purpose

The log must answer, in order:

1. What input/configuration did the tester choose?
2. What virtual position and canonical sample did the Simulator generate?
3. Did the real Activity/passive/Plant authority accept or reject it, and why?
4. Which segment, metrics, Memory, Cairn, completion, sync, ACK, and cleanup effects followed?

It is diagnostic evidence, not production telemetry. No Simulator log is uploaded automatically.

## Categories

| Category | Meaning / representative events |
|---|---|
| `SIM_SESSION` | bind/unbind Simulator session and its cadence/seed |
| `SIM_INPUT` | joystick, waypoint, speed, altitude, accuracy, signal restore, start selection |
| `SIM_POSITION` | deterministic virtual physical movement, including hidden LOST movement |
| `SIM_SAMPLE` | canonical synthetic sample emitted at provider cadence |
| `GPS_ACCEPT` | canonical Activity/Plant/passive acceptance result |
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

- `timestamp`: local event creation time in Unix milliseconds;
- `eventName`: stable snake_case event name;
- `category`: one taxonomy value above;
- `simulatorSessionId`: local synthetic session correlation ID;
- `clientActivityIdSuffix`: last eight characters only, or `null`;
- `ownerSuffix`: last eight characters of the local owner ID, or `null`;
- `virtualTimestamp`: sample/provider Unix milliseconds where relevant;
- `wallClockTimestamp`: log wall clock in Unix milliseconds;
- `timeScale`: configured evidence-clock scale (`1`, `2`, `5`, `10`, or `30`);
- `effectiveVirtualElapsed`: virtual milliseconds elapsed since Activity Start;
- `sampleSequence`: strictly increasing sample sequence within the Simulator Activity;
- `batchSequence`: 1 Hz engine-tick sequence used to correlate accelerated sub-samples;
- `fields`: sanitized category-specific values.

Relevant `fields` include mode, lifecycle, segment ID/reason, latitude/longitude, altitude, accuracy, configured physical speed, emitted speed, course, signal, sample/batch sequence, `batchSampleIndex`, `batchSampleCount`, time scale, effective virtual elapsed, acceptance, rejection reason, point count, derived metrics, Memory commit/dedupe, Cairn suffixes, origin Activity suffix, sync state, server mapping suffix, attempt count, and bounded error code.

At `1×`, virtual and wall clocks remain aligned. At an accelerated scale the Activity starts on a bounded historical anchor, and logs retain both clocks. Virtual timestamps are strictly monotonic, at least 60 seconds behind the Start wall-clock horizon, and capped to a 12-hour virtual Activity span. A normal 30× wall tick is one batch containing three ordered samples no more than ten virtual seconds apart. `simulator_virtual_clock_limit_reached` records the limit and no duplicate timestamp is then emitted.

## Privacy and secret handling

Full coordinates are allowed only in this local Simulator logger because they are synthetic QA coordinates and the logger itself is capability-gated. This permission does not change shared/real Activity logging.

Real GPS logs must stay under the existing redaction/rounding policy. No shared logger was changed to emit full real-user coordinates.

Field keys matching token, password, passcode, reset code, email, authorization, cookie, or secret patterns are dropped recursively. Values are depth-, array-, and string-bounded. Never add:

- access/refresh tokens;
- passwords or passcodes;
- reset/verification codes;
- raw email addresses;
- cookies or authorization headers;
- API keys or other secrets.

Owner, Activity, Cairn, and server identities use suffixes where exported. Error strings are truncated and must be stable codes/messages, not request headers or bodies.

## Retention and bounds

- maximum 5,000 events per Simulator session;
- maximum approximately 2 MiB serialized per session;
- maximum five sessions per user;
- temporary waypoint queue maximum 12 (stored by Simulator state, not log);
- oldest events within a session are dropped first;
- oldest sessions beyond five are deleted from local storage;
- normal writes are coalesced for 1.5 seconds;
- rejection/error events flush promptly;
- background/inactive lifecycle flushes dirty sessions;
- dirty buffers capture their owner/session so A→B switching cannot redirect A’s log.

These logs persist long enough for recovery diagnosis but do not accumulate without bound. They are not part of Activity sync cleanup and are removed only by retention or explicit **Clear QA logs**.

## Export and inspection

In an authorized internal bundle:

1. Enable Debug Mode and Activity Simulator.
2. Open Hike or Run and expand the Simulator panel.
3. Select **Copy JSONL diagnostics**.
4. Paste the text into a local issue/report for Codex.

Export includes the newest five sessions for the current account. Each line is one JSON object. **Clear QA logs** is available only while Activity is idle and removes only Simulator logs for that account.

## Correlation recipe

For a failed sample or downstream effect:

1. Match `simulatorSessionId`.
2. Follow increasing `virtualTimestamp`, `sampleSequence`, and `batchSequence` from `SIM_INPUT` → `SIM_POSITION` → `SIM_SAMPLE`. For acceleration, compare `wallClockTimestamp`, `timeScale`, and `effectiveVirtualElapsed`; all samples sharing a batch sequence came from one bounded 1 Hz tick.
3. Match the immediately following `GPS_ACCEPT` or `GPS_REJECT` and its `segmentId`/reason.
4. For acceptance, find `ACTIVITY_POINT`, `ACTIVITY_METRICS`, and `MEMORY_EVIDENCE` with the same Activity suffix/time.
5. For Plant/Quick Cairn, match `CAIRN_COMMIT` and `CAIRN_ASSOCIATION` by Cairn/Activity suffix.
6. At Finish, follow `ACTIVITY_COMPLETION` → `SYNC_STATE` → `SYNC_ACK` → `SYNC_CLEANUP`.
7. If the chain stops, inspect the newest `ERROR`, the panel’s failure banner, actual network state, and owner/activity suffix.

`GPS LOST` is logged as source-sample absence. `recording_interruption_forced` includes `gapReason=process-recovery` and is a known continuity break. These must never be interpreted as the same condition.
