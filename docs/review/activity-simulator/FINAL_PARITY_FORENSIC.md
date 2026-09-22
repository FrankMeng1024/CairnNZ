# Final Simulator parity forensic (O37/O36)

Date: 2026-09-09 (Asia/Shanghai)

This record was written before the O38 implementation. Production inspection
was read-only. Coordinates below are intentionally summarized except where the
position is synthetic Simulator evidence.

## O38 native parity addendum — written before O39 implementation

The production inspection in this addendum was SELECT/read-only. It was
recorded before changing Simulator reset or replay code.

### Target identity and telemetry

- **PROVEN:** the human-visible `hike-09/09/2026` is production session `2053`,
  user `4`, client Activity `f09a9952-4b6c-4278-ba8c-d4831c81ed2d`. It was
  created at `2026-09-09T05:23:02Z`, finalized at `05:29:17Z`, and is
  correlated by client Activity ID with automatically uploaded QA session
  `qa-mttg439c-ccqp1eyj`.
- **PROVEN:** yiiling retained 833 events / 524,245 bytes for that QA session.
  The target Activity appears in 661 events. The remote trace contains virtual
  origin selection, provider selection/lock, first generated/accepted/committed
  point, movement, Memory and metric checkpoints, Finish/Save, per-segment
  matching, server acknowledgement, completion, and origin clear. Manual JSONL
  was not used.
- **PROVEN:** the row is only 43 bytes below the client 512 KiB payload bound,
  largely because 542 `hike_map_idle` events were retained. The O38 critical
  reservation nevertheless preserved the complete Activity reconstruction
  chain. This is noisy but not a diagnostic loss in this reproduction.

### Raw GPS and metric realism

- **PROVEN:** session 2053 retains 371 raw canonical points over 370.441
  virtual seconds. Timestamps are strictly monotonic: median interval 1,001 ms,
  p95 1,002 ms, maximum 1,018 ms, with zero reversals.
- **PROVEN:** raw step displacement has median/p95 2.781 m and maximum 3.760 m.
  Inferred speed has median/p95 2.778 m/s and maximum 3.756 m/s, below the Hike
  4.17 m/s overspeed threshold. There are no accuracy rejects, overspeed
  samples, or implausible teleports. Ninety-six sub-metre steps exercise normal
  stationary handling.
- **PROVEN:** accuracy is 1 m throughout. Altitude spans 28.651–51.512 m and
  yields 22.861 m positive gain from raw same-segment evidence. The Activity
  has one segment and no gaps.
- **PROVEN:** summing raw consecutive points within the segment gives
  762.319 m, exactly the stored `distance_m` within floating-point precision.
  Stored duration is 368 s and pace is approximately 8.05 min/km. These are
  plausible Hike values and are derived from canonical point time/path rather
  than wall-clock replay time.
- **PROVEN:** real Hike 192 has 154 raw points over 775 s with irregular native
  callbacks up to 54.5 s; real Hike 193 has 89 raw points over 1,713 s with an
  interval up to 413 s. O38's deterministic near-1 Hz input is more regular,
  but it satisfies the same schema, timestamp, accuracy, speed, acceptance,
  journal, segmentation, and metric contracts. Delivery regularity is source
  metadata, not a business-data violation.

**REALISTIC ACTIVITY DATA — PASS.** Except for explicitly internal source/QA
metadata and deterministic delivery, session 2053 is valid Activity evidence
that could pass the real Hike acceptance contract.

### Shared pipeline, Memory, matching, and sync

- **PROVEN:** real foreground, real background, and Simulator samples converge
  on serialized `useTrackingStore.addTrackPoint`. Simulator branches before
  that boundary select/fence the provider; after it, acceptance, durable
  journal, segments, distance/duration/elevation, Memory, completion payload,
  and sync use the shared production path. Simulator-specific downstream code
  is diagnostic or the intentional Debug rollback only.
- **PROVEN:** 43 production `memory_points` fall on the accepted target path and
  inside its virtual timestamp range. Backend attribution logs show normal
  `activity` Memory inserts/region attribution throughout the recording. There
  is no gap connector and no Simulator-only Memory writer.
- **PROVEN:** raw authority remains 371 points. Matching ran once for the one
  continuous segment using 277 accepted clean points and completed in 513 ms;
  the derived Activity Detail geometry contains 53 points. It is stored
  separately from raw GPS. Its approximately 713.8 m geometric length is not
  substituted for the 762.319 m raw-authority metric. No gap was available to
  submit, and shared per-segment fallback remains in force.
- **PROVEN:** telemetry records Save with 371 raw / 53 display points, server
  acknowledgement, and completion. Production session 2053 has the same client
  identity/counts/metrics and a finalized timestamp, proving normal server
  synchronization.

### Fresh setup and accelerated replay diagnosis

- **STRONGLY SUPPORTED:** completion/discard calls `unbindActivity` with origin
  clearing, but a fresh Hike/Run focus does not independently reconcile the
  persisted Simulator setup against the durable unfinished-Activity registry.
  Consequently a delayed/legacy/stale pre-start snapshot can remain visible
  until the tester manually resets it. Fresh entry needs one registry-aware,
  idempotent setup reset; an exact unfinished Simulator Activity must bypass it.
- **PROVEN:** the current engine models acceleration as historical virtual time
  and subdivides a wall tick into ordered canonical samples no more than ten
  virtual seconds apart. Emitted `speed` remains the configured physical human
  speed. Existing 30x therefore preserves Activity pace/path while reducing
  wall wait.
- **PROVEN RISK:** the current five-second delayed-timer allowance permits a
  120x tick to enqueue 60 serialized samples, which is not an acceptably bounded
  UI burst. Exposing 60x/120x safely requires limiting each tick to at most 120
  virtual seconds (12 ten-second samples). Delayed JS time beyond that bound is
  intentionally not replayed; it cannot become a teleport or skipped Activity
  geometry.

### Disposition before implementation

1. Add a registry-aware fresh-entry initializer shared by Hike and Run. It
   clears origin/current/destination/reacquisition/runtime state only when no
   live or durable unfinished Activity exists, and preserves QA identity and
   the enabled preference.
2. Extend Debug time scale to 60x/120x. Cap each wall tick to 120 virtual
   seconds, retain ten-second intermediate canonical samples, serialize them
   through the existing sink, and do not change physical speed or metrics.
3. Add deterministic 1x-versus-accelerated path/metric tests plus fresh-entry
   completion/discard/recovery tests. No backend change is indicated.
4. `RENAME UI DEFERRED TO TRAILS / ACTIVITY DETAIL UI PASS`; preserve the
   already deployed durable rename contract.

## Evidence inspected

- O37 iPhone QA session `qa-mttg439c-ccqp1eyj`: 657 retained events,
  523,842 bytes, first retained event 2026-09-09T01:55:06.005Z, last retained
  event 2026-09-09T02:07:18.098Z.
- O37 short sessions `qa-mttg3xyl-bhtunp61` and
  `qa-mttg39iz-qupkuubd`: each retained only one `debug_mode_on` event.
- O36/O37-spanning session `qa-mtsmpawf-lc911f5m`: 662 retained events,
  513,721 bytes. Its old beginning had already been removed by the client
  byte bound.
- Production `sessions`, `routes`, `activity_client_tombstones`, nginx access
  logs, and backend logs for user 4 (the `debug1` test account/activity
  context).
- Representative real Hikes 192 and 193. User 4 has no finalized Run: the only
  Run row, 2028, is an abandoned zero-point shell. A production real-Run data
  comparison is therefore unavailable, although Hike and Run use the same
  recorder/provider implementation.
- Current Git source and history, including the Standard-style introduction
  (`bc03a30`), outdoor configuration (`da3c406`), initial unified Simulator
  work (`05ec257`/equivalent rewritten `cf444c0`), and the uncommitted O36/O37
  recovery changes.

## Conclusions by issue

### 1. Native Hike and Run map failure

**PROVEN:** O37 created a native MapView and reached successful style/map
callbacks. At 02:02:52Z mount `hike-map-mttgeln6-0` reported style loaded,
camera ref available, map loaded, and derived readiness true. It then reported
HTTP 401 `Not Authorized` for Standard sources including `3dbuildings`,
`composite`, `mapbox-dem`, `mapbox-3d-events`, and tiles from z0 through z15.
The intended 600 ms globe-to-location camera journey started and was recorded
as interrupted only because no idle callback followed the unauthorized tile
loads.

**PROVEN:** the Simulator Start did not replace that MapView. The same mount ID
continued after provider selection and the first synthetic point. A later
focused Hike mount, `hike-map-mttgg7oc-0`, acquired a camera ref and applied
the Simulator target, then received the same 401s.

**STRONGLY SUPPORTED:** the O37 OTA did not embed the configured EAS public
Mapbox token. The local app environment has no
`EXPO_PUBLIC_MAPBOX_TOKEN`; `initMapbox` unconditionally calls
`Mapbox.setAccessToken('')` in that condition. The EAS preview environment does
contain a `pk.` public token, and non-secret probes made with that environment
returned HTTP 200 for Standard style and walking Directions. The likely
release-path error is an OTA published without the EAS environment injection.

**PROVEN:** O36's Run `Map unavailable` also had a false-fatal component: a
generic `onMapLoadingError` callback changed Run state to unavailable even
after style load. O37 removed that fatal interpretation. O37 does not contain a
retained Run re-test; the remaining native blocker is the shared 401 transport.

**INCONCLUSIVE:** O37 does not retain a complete Debug-OFF Hike first/second/
third-entry sequence. It has two `hike_opened` events and two distinct style
load mount IDs, but the corresponding `*_map_mounted` events were evicted.
The current screen-local reset is structurally correct, but native re-entry
still needs the O38 device gate after token delivery is made fail-fast.

### 2. Map information density

**PROVEN:** `bc03a30` moved non-satellite maps from the older 2D outdoors/day,
local sunset, and dark styles to Mapbox Standard. `da3c406` then selected the
`faded` Standard theme and Spectral font while enabling pedestrian roads. The
older `outdoors-v12` path emphasized terrain/contours; the current Standard
path can provide pedestrian detail but O37 never downloaded its authenticated
sources. The 401s alone are sufficient to explain the observed empty/coarse
surface. Any O38 information-density change must stay within supported
Standard configuration and must not disguise token failure.

### 3. Simulator origin and provider transition

**PROVEN:** the second O37 Activity selected Simulator before Activity
creation. Order was:

1. `virtual_origin_selected` (synthetic coordinate);
2. `activity_provider_selected`, requested source `simulator`;
3. `activity_start_requested` with a new client Activity identity and provider
   `simulator`;
4. `simulator_first_sample_generated`, sequence 1, `providerLocked=true`;
5. `location_sample_accepted`, sequence 1, point count 1;
6. `canonical_gps_accepted`, sequence 1.

The first committed point was therefore the virtual origin. Foreground and
background real callbacks both carry the Activity identity/owner generation
and enter the same provider-source fence in `addTrackPoint`. A real callback
for a Simulator-owned Activity is rejected as `provider-source-mismatch`.

**INCONCLUSIVE (native occurrence):** no late real callback happened in the
retained O37 trace, so `real_callback_rejected_for_simulator_activity` did not
occur. The code contract must be protected with explicit Shanghai-shaped real
callback / Queenstown virtual-origin tests for both Hike and Run.

### 4. Real Activity GPS contract

**PROVEN:** foreground Core Location uses `BestForNavigation`, a dynamic time
interval initially 3,000 ms, a 5 m distance interval, native timestamps, and a
push callback. Hike and Run share this configuration. Background Core Location
uses the same accuracy/time/distance values, `Fitness` activity type,
`pausesUpdatesAutomatically=false`, and may deliver a native batch. The
background task canonicalizes each item, preserves native ordering/timestamps,
and fences it by client Activity, owner generation, and `acceptAfterMs`.

**PROVEN:** every foreground/background/Simulator sample converges on the same
serialized `useTrackingStore.addTrackPoint`. That authority checks active
ownership, fixed provider, valid coordinates, monotonic timestamps, maximum
25 m accuracy, implausible teleports, Hike overspeed above 4.17 m/s,
stationary/indoor drift, and segment continuity. It alone writes the durable
journal, commits point/metrics, and records normal Memory evidence. There is no
Simulator-specific distance, pace, elevation, Memory, completion, or sync
formula.

Real Hike 192 had 154 raw points with irregular 0-54,525 ms intervals (mean
5,066 ms) and 50 derived display points. Real Hike 193 had 89 raw points with
irregular 0-413,180 ms intervals. This disproves a real-world fixed 1 Hz
delivery assumption. The deterministic Simulator may use a regular cadence as
a QA input, but downstream acceptance must remain the production authority.

### 5. `debug1` Activity and Route 82

**PROVEN:** deleted Activity client ID
`a4d5611a-0297-4d27-bb79-c748d5231fbd` is tombstoned at
2026-09-09T02:02:04Z. Nginx recorded its DELETE at 10:02:04 Shanghai time.
Route 82 was created by `POST /api/routes` at 10:02:19 (201) and updated at
10:02:20. The DB gives the same creation/update timestamps. The Route was
therefore created 15 seconds *after* Activity deletion, not before it.

**PROVEN root cause:** Activity Detail deliberately retains a mount-lifetime
session snapshot after the live session disappears. That is correct for a
sync handoff but wrong after an explicit delete: the snapshot leaves rename
and Save-as-Route actions active. Delete is started without awaiting it and
then uses `goBack`, so stale stack/history and stale actions remain possible.
RouteEditor additionally retains the Activity geometry parameter even after
its reactive session lookup becomes null. The route-create API carries no
source Activity identity, so the backend cannot reject this zombie mutation.

**PROVEN product rule:** Route 82 remains independently owned now that it
exists. The correction must prevent future post-delete route creation, not
cascade-delete already committed Routes.

**STRONGLY SUPPORTED:** `debug1` was the deleted Activity's human-visible name,
but its row is hard-deleted and no retained rename request/body survives, so
the DB cannot prove the exact prior name.

### 6. Activity `hike-08/09/2026` / session 2052

**PROVEN:** production row 2052 is client Activity
`fff989b4-0629-4db1-8be4-c488e9500237`, name
`Hike — 08/09/2026` (UTF-8 em dash), 328.45 m, 200 s, finalized at
02:06:23Z. Its raw stream has 206 points at approximately 1 Hz (10-1,432 ms,
mean 991 ms), one explicit segment, 1 m synthetic accuracy, and 328.45 m raw
geometry. Its display stream has 121 points, one segment, and 328.216 m
geometry.

**PROVEN root cause of rename defect:** Detail rename only changes the local
Zustand/AsyncStorage summary. It sends no server request and reports no
failure, so a synced Activity rehydrates the server name and apparent success
is false. A dedicated authenticated server rename contract is required for a
synced Activity; a pending-local rename must update its durable pending
payload or report that it cannot.

### 7. Map matching / snapping

**PROVEN:** completion invokes `snapTrack` independently for each real segment
and never submits a cross-gap connector. Raw accepted GPS remains in
`route_points_raw`; derived display geometry is placed in `route_points` only
when all segments pass the matching safety contract. Otherwise it falls back
to the shared Kalman-smoothed stream.

**PROVEN defect:** the completion mapping currently removes accuracy, altitude,
and speed before calling `snapTrack`, even though the matcher uses these fields
to identify lost/poor evidence and can preserve altitude. This reduces parity
and observability.

**STRONGLY SUPPORTED for session 2052:** Map Matching did not successfully
produce a matched path. Its 121-point display stream closely matches the
shared smoothed stream and contains the same Simulator metadata; O37's bundle
had no usable Mapbox token. There is no retained matching-attempt/result event,
so the precise HTTP outcome is not provable after the fact.

**INCONCLUSIVE for deleted `debug1`:** its raw Activity row no longer exists.
Route 82 contains 172 points and 482.489 m but no source identity/timestamps;
its geometry alone cannot prove the deleted Activity's raw acceptance or
matching outcome. O38 must log per-segment matching attempt/result/fallback for
real and Simulator Activities alike.

### 8. Rollback, gaps, Cairn, and Memory

**PROVEN:** O37 contains a durable Simulator-tail rollback planner and applies
the corrected point arrays/metrics to the shared Activity/journal authority.
Incremental server uploads occur every 120 seconds, but the final atomic Save
submits an authoritative complete `route_points` and `route_points_raw`
snapshot. The server transaction overwrites both JSON columns, so a local
pre-finish rollback is server-safe without a schema change. Recovery reads the
rewritten journal, so removed tail points do not resurrect. Memory and already
committed Cairns are intentionally not rolled back.

**PROVEN:** explicit manual reacquisition supplies a new segment ID with
`gps-reacquired`; distance/elevation/duration are accumulated only within the
same segment. Segment IDs are persisted in raw and display payloads. This model
is unbounded (not `beforeGap`/`afterGap`) and supports repeated gaps.

**INCONCLUSIVE (native O37):** no Lost/reacquisition/rollback/Cairn case occurs
in the latest trace. Automated contracts and an O38 native gate are required.

### 9. Telemetry transport and completeness

**PROVEN automatic upload:** nginx records authenticated iPhone POSTs to
`/api/telemetry/sessions` approximately every 20 seconds from 09:55:23 through
10:06:43 Shanghai time. Five client-cancelled 499 requests at backgrounding
were followed by successful 200 retries at 10:07:16-18. The final yiiling row
is retrievable by `qaSessionId`; manual JSONL export was not used.

**PROVEN insufficiency:** the latest row is within 446 bytes of the 512 KiB
client limit. High-frequency sample/metric/Memory events evicted important
events. The retained O37 row has no `qa_session_started`, `hike_map_mounted`,
`simulator_provider_locked`, `simulator_first_point_accepted`,
`activity_point_committed`, finish/save/sync events, or real-callback rejection.
Some never emitted under their promised explicit names; others were not in
the small protected-event set. O36's beginning was also evicted. HTTP success
therefore does not yet mean diagnostic sufficiency.

**Required O38 change:** coalesce routine samples, reserve critical lifecycle
events across map/provider/Activity/completion/sync/gap/rollback/Cairn/error,
and record bounded upload checkpoints/counts. Product correctness must remain
independent of telemetry.

## Minimal implementation direction

1. Fail fast when an Internal OTA lacks a valid public Mapbox token; never
   overwrite native Mapbox configuration with an empty token. Add a safe
   token-presence telemetry field and a documented OTA preflight. Do not store
   or log the token.
2. Keep a single stable MapView per mounted Hike/Run screen. Reset only
   screen-local readiness/camera state on each focus/mount. Treat source/tile
   errors as diagnostic; derive unavailable only from actual native component
   absence.
3. Retain the shared canonical sample boundary. Add explicit first-point and
   late-real-callback contracts for Hike and Run.
4. Clear selected virtual origin only after completed/discarded Simulator
   Activity teardown; preserve it for recovery of the same identity.
5. Replace primary straight-line auto-move with a bounded Mapbox walking
   Directions geometry. Keep explicit advanced straight-line movement only.
6. Preserve multi-segment truth, correct matcher inputs, and log matching per
   segment without modifying raw GPS.
7. Invalidate Detail immediately on explicit delete, reset navigation to
   Home/Trails, and add a non-schema server guard for Activity-derived Route
   creation. Add truthful synced rename and pending-local rename persistence.
8. Strengthen bounded telemetry retention instead of increasing it without
   limit.

## O38 implementation disposition

This section records the evidence-backed disposition after the forensic above;
it does not retroactively change the pre-implementation classifications.

- **Map transport — fixed for the next candidate:** native code no longer
  overwrites Mapbox's singleton with an empty token. The EAS `preview`
  environment now contains the public Mapbox token, yiiling API base, and
  Internal Simulator capability (presence/expected-value checks only; no value
  was printed or committed). O38 must be published with
  `--environment preview`. Map events record only
  `mapboxTokenConfigured:boolean`.
- **Map lifecycle — characterized:** Hike and Run retain one Mapbox owner
  across pre-start and Tracking. Focus rotates a screen-local map key/mount ID
  and resets readiness/camera guards. A loading/resource error is diagnostic,
  never by itself `Map unavailable`. Debug OFF and Debug ON/Simulator OFF both
  render real `UserLocation` and the original native follow/fly-to contract.
- **Provider parity — tested:** both modes use the same `addTrackPoint`
  acceptance/journal/metric/Memory authority. Shanghai-shaped foreground and
  background callbacks are rejected after a Queenstown Simulator lease; the
  first accepted and durably committed point is Queenstown and contributes
  zero initial distance.
- **Runtime Simulator — implemented:** pre-start exposes only the fixed
  virtual-origin picker. Tracking exposes the lower-left `SIM`, right joystick,
  Chinese speed/time/GPS/terrain/auto-move/rollback controls, and Advanced
  diagnostics. Normal/Poor/Lost/Frozen are provider-input states; they do not
  directly mutate Activity decisions.
- **Walking Auto Move — implemented:** the primary action requests bounded
  Mapbox `walking` Directions geometry and feeds its future positions through
  the existing provider. Failure/offline shows
  `无法获取步行路径，请使用摇杆`; straight movement is explicit Advanced QA.
- **Gap/rollback — implemented:** repeated manual Lost relocation creates
  unbounded `gps-reacquired` segments with zero connector metrics/Memory.
  Rollback truncates only accepted journal evidence, recalculates Activity
  metrics/current virtual time and position, and survives interruption through
  the write-ahead truncation marker. Memory and Cairns remain intentionally
  monotonic/independent. The normal final Save remains the corrected
  authoritative server snapshot.
- **Derived geometry — corrected:** accuracy/altitude/speed now enter the
  existing matcher. Each continuous segment independently yields matched
  display geometry or its own raw fallback; one failed segment no longer
  discards successful matching for other segments. Raw accepted GPS remains in
  `route_points_raw`, and gaps never enter matching.
- **Delete/navigation/rename — corrected:** post-save Detail Back always resets
  to `Home → Trails/Activities`; delete invalidates the mounted object before
  awaiting I/O. Activity-derived Route creation now carries source identity and
  is transactionally serialized against deletion. Synced rename is server
  authoritative; pending-local rename first updates the durable outbox.
- **Telemetry — corrected and bounded:** same-turn appends serialize before
  flush/upload, routine samples are coalesced/sampled, and a reserved critical
  set retains map/provider/origin/first-commit/gap/rollback/Cairn/finish/save/
  sync/error events. The O37 automatic transport is proven, while O38 native
  coverage remains the explicit human retest gate.
- **Production backend — deployed:** scoped commit `8900028e` contains only
  completed-Activity rename authority, Activity-derived Route provenance and
  deletion serialization, plus their contracts. Canonical deploy ran zero
  migrations, recreated only `cairn-backend`, and passed local/public health.
  MySQL and nginx retained their prior start times. Operations telemetry smoke
  `qa-o38-smoke-1788927556466` proved restricted upload/retrieval and
  server-side privacy sanitization.
