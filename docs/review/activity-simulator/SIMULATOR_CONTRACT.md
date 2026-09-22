# Activity Simulator contract

Date: 2026-09-13 (OTA55 dual-mode revision)
Audience: internal CairnNZ Functional QA

## What the Simulator is

Activity Simulator is a build-gated virtual location provider for Free Hike and Free Run. It generates location evidence; it is not a second Activity implementation.

It has two explicit observation modes:

- **Clean Path**: intended position is the exact deterministic observation;
- **Raw GPS**: intended position is ground truth, while a calibrated correlated observation model produces the fixes Activity receives.

The enforced flow is:

`Simulator engine → Activity provider lease → useTrackingStore.addTrackPoint → journal/acceptance/segments/stats/Memory → local completion → pending sync → server Activity → Activity Detail`

The canonical boundary returns an explicit accepted/rejected decision. The Simulator records that decision but never inserts Activity points, assigns distance/pace/elevation, unlocks Activity Memory, links Cairns, finishes an Activity, or uploads an Activity itself.

## Security and activation

All three conditions must be true before Simulator can become the selected source:

1. The Expo bundle was built with `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true`.
2. hidden Debug Mode is enabled.
3. Settings → Developer → Activity Simulator is enabled.

`development-simulator`, `development`, and internal `preview` native build
profiles set the capability to `true`. The named EAS `preview` Update
environment also contains the required capability/API/public-map inputs; an
Internal OTA must use `--environment preview`. The public `production` build
profile explicitly sets Simulator capability to `false`. Five-tap Debug Mode
alone is insufficient in production.

Use a dedicated approved QA account for end-to-end sync. Synthetic Activities, Memory, and Cairns are intentionally not auto-deleted.

The source is selected and locked before the Activity's first accepted point and is fixed for the Activity. For Simulator Start, real foreground/background sources are fenced before the selected virtual origin is emitted. A late real callback is rejected at the canonical boundary, so physical location can never precede or connect to the virtual origin. Mid-Activity switching is rejected; Finish or Discard the current Activity first. The normal global one-unfinished rule is never bypassed.

## Same as real GPS downstream

After entering `addTrackPoint`, Simulator evidence uses the same ownership,
durability, lifecycle, and product pipeline. Raw GPS additionally uses the
real-device physical-continuity classifier before canonical acceptance; Clean
Path retains its exact deterministic acceptance semantics. Both use the same:

- owner user, `clientActivityId`, owner generation, and timestamp fences;
- coordinate, accuracy, overspeed, teleport, stationary, and ordering decisions;
- Activity journal and recovery registry;
- segment/gap authority;
- distance, active duration, pace, and elevation derivation;
- incremental central Memory evidence and spatial dedupe;
- Hike Full Plant / Run Quick Cairn product flows;
- Pause, Resume, Finish, Save eligibility, naming, local completion, and Discard;
- pending-local Activity Detail, sync, server mapping, ACK, cleanup, and historical Detail;
- Save as Route eligibility and gap exclusion already owned by Activity/Route.

There is no simulator-only Activity Detail, metric formula, Memory write, Cairn model, completion path, or sync path.

## Start location

Before Start, Debug exposes a fixed center picker over the ordinary Mapbox map. The tester pans the world beneath it and selects **从这里开始**. Exact latitude/longitude remains under **更多**. The picker is map-display state only: it is not UserLocation, an accuracy circle, a puck, or an Activity point.

Latitude must be within `[-90, 90]`. Finite longitude is normalized into `[-180, 180]`. No device-GPS proximity check is applied. Queenstown, Shanghai, Tokyo, Yosemite, London, Iceland, high latitudes, both hemispheres, and International Date Line crossings are valid.

Changing the sole initial origin is disabled after Activity Start, and its picker disappears. A picker may reappear only for **自动前往** destination selection or explicit Lost-state **重新定位**. Map center state never enters the GPS pipeline by itself.

## Movement and frame

The joystick is 360 degree, proportional, and has a 12% dead zone. Release means stationary. Direction uses a **north-up screen frame**: up is true north, right is east. This is explicit in the panel and stable even if the tester manipulates the map.

Movement uses deterministic spherical great-circle calculations in metres. Longitude is normalized on every position update. No constant-degree step is used.

Joystick input interrupts and clears automatic movement. Walking back is normal new movement: it emits new samples, draws the return segment, adds travelled distance, affects derived pace/elevation, and adds normal Memory evidence. Debug-only **回退** is a distinct accepted-tail correction described below.

## Speed and accelerated time

Presets are:

- WALK: 5.0 km/h
- HIKE: 3.5 km/h
- RUN: 10.0 km/h
- CUSTOM: 0.1–60.0 km/h

The exact configured speed and time scale are always visible. Speed remains the simulated person's physical speed; time scale changes how quickly that person's timeline elapses. Pace remains derived from accepted distance and accepted same-segment duration. For example, `5 km/h` at `10×` represents about ten Activity minutes and 833 m in one real minute while still deriving approximately 12:00 min/km. It does not emit 50 km/h speed metadata.

Available default scales are `1×`, `5×`, `10×`, `30×`, `60×`, and `120×`; `2×` remains under **更多**. The tester may change scale while Tracking. Each change affects subsequent virtual time only and never rewrites earlier timestamps.

Every Simulator Activity, including one that begins at `1×`, uses a bounded historical evidence clock so it can safely change to an accelerated scale later:

- Start is anchored 12 hours and 60 seconds before the Start wall clock.
- Every Activity GPS, journal, segment, Activity-Memory, start, end, and pending/server payload timestamp remains an ordinary Unix epoch on that same timeline.
- Virtual time advances by `wall elapsed × time scale`, never reverses, and never enters the future.
- Finish uses the provider timeline; it does not add duration or rewrite metrics.
- The maximum accelerated Activity span is 12 virtual hours. At the limit the panel shows a failure and stops duplicate-timestamp publication; Finish or Discard is required.

Consequently, an accelerated QA Activity appears in history up to roughly 12 hours earlier than the wall-clock test session and can cross a calendar-day boundary. This is intentional, visible synthetic-time behavior; its distance, duration, pace, trace, Memory, Cairn provenance, pending state, and server representation remain normal.

The historical anchor is required because future-dating samples is not safe: current Start/append/Finish validation accepts valid ISO/positive epochs without a tight server skew bound, Memory permits timestamps up to 24 hours ahead, and recovery/owner/freshness checks compare timestamp order. Permitting future evidence would therefore store an internally valid but temporally impossible Activity instead of failing closed. No server validation was weakened and Real GPS never consults the virtual clock.

## Sampling and determinism

The engine timer is 1 Hz and remains independent of joystick render frames.
Clean Path retains ordered exact samples no more than ten virtual seconds apart:
`2×`/`5×`/`10×` normally emit one sample per wall tick, `30×` emits three,
`60×` emits six, and `120×` emits twelve. Raw GPS instead advances its
correlated model in one-second virtual substeps, emits only when a calibrated
fix is due, and is capped at `10×`. Both modes cap a wall tick at twelve
substeps and discard unbounded suspended-JS backlog.

Clean Path has no random noise. Raw GPS uses a persisted/logged seed and
xorshift32/normal draws. Same path, timing, and seed reproduce the same Raw
sequence; another seed produces a different plausible sequence. Bias, jitter,
outlier tail, last truth/observation, and next due time persist as model state.

When no Activity sink, passive Memory listener, or movement exists, the engine does not emit/log empty samples. Diagnostics and waypoints are bounded.

## Automatic movement

The runtime action **自动前往** reopens the center picker. On confirmation,
the client requests Mapbox `walking` Directions geometry from the last
canonically accepted/current Simulator position to that destination. The
bounded future-point queue then supplies bearings to the same location engine,
using current speed, time scale, GPS state, and terrain. It is Simulator input
only: no CairnNZ Route is created and raw Activity GPS is never replaced by
this geometry.

If the device is offline, the public Mapbox token is unavailable, or a usable
walking geometry cannot be returned, the panel stops and shows
**无法获取步行路径，请使用摇杆**. It never silently crosses buildings or terrain.
**直线移动** remains an explicit Advanced QA action. Waypoints are local and
cleared on stop/reset; joystick input interrupts immediately.

## Altitude

Start altitude is configurable from -500 to 9,000 m. Models are:

- FLAT: 0 m/h;
- CLIMB: +300 m/h;
- DESCEND: -300 m/h;
- CUSTOM: -3,000 to +3,000 m/h.

The engine changes only synthetic altitude. Canonical Activity calculates elevation gain between accepted same-segment samples. Cross-gap altitude contributes zero.

## GPS accuracy and signal

In Clean Path, accuracy presets set evidence metadata only:

- GOOD: 5 m;
- NORMAL: 12 m;
- POOR: 60 m;
- CUSTOM: 1–500 m.

Raw GPS `Realistic GPS` derives hAcc from current correlated error plus imperfect
confidence variation and bounds it to 3.5–65 m. Manual hAcc is intentionally
hidden in Raw mode. The shared quality authority decides acceptance in both
modes; the Simulator never forces the canonical result.

Signal states are **正常**, **较差**, **丢失**, and **卡住**.

- **正常** emits exact Clean observations or calibrated Raw observations.
- **较差** emits the existing deterministic degraded Clean metadata or widens Raw hAcc/cadence; the production quality filter, not the Simulator, decides acceptance.
- **丢失** emits no Activity samples while the hidden virtual person may move.
- **卡住** continues timestamps/samples at the frozen reported observation while the hidden virtual person may move.

Stationary is not Lost. Clean remains exactly fixed; Raw continues a correlated
drifting cloud around fixed ground truth. Only explicit source silence stops
observations. This distinction is the indoor regression for O54 source health.

Returning from an ordinary Lost/Frozen interval simply resumes at the hidden position and lets the central continuity authority decide acceptance or segmentation. **丢失 → 重新定位 → 从这里继续** is different: it explicitly starts a new `gps-reacquired` segment at the selected coordinate. No connector point is recorded and the unknown displacement contributes zero distance, elevation, pace, route matching, or Memory. This operation is repeatable without a one-gap limit.

GPS LOST and PROCESS CONTINUITY LOST are different. The former relies on GPS gap authority; the latter is an explicit known gap.

## Pause, interruption, and recovery

The Simulator has no custom Pause/Resume/Finish controls. Real Activity controls apply.

While Paused, Simulator movement and its virtual clock are frozen and the Activity sink is detached. Resume rotates owner generation, creates a new canonical segment, and the first accepted fix anchors it without a connector to the pre-Pause coordinate. The production segmented stats exclude the paused interval.

**Simulate recording interruption** parks a Simulator Activity through the recovery contract: source callbacks are fenced, writer/monitor activity is stopped, the unfinished identity remains durable, and Resume creates a `process-recovery` segment even after a one-second interruption. It is not a substitute for killing the native process.

Simulator state is user-scoped in AsyncStorage and persists origin/current location, speed, time scale, historical clock anchor/current timestamp/effective elapsed, altitude state, accuracy, signal, sample/batch order, bounded waypoints, session ID, and bound Activity ID. After real termination/relaunch, the normal unfinished Activity dialog owns Resume/Save/Discard. Recovery aligns a lagging coalesced clock to the newest durable journal point without rewinding, then Resume establishes the normal `process-recovery` segment. Simulator JavaScript does not invent elapsed time while the process is dead; it continues from the last durable virtual position/time.

Account A state is never hydrated into B. Logout parks A’s unfinished Activity and Simulator binding; B sees defaults and cannot resume A. A can later recover through normal rules.

## Cairns

Hike uses the real Full Plant flow. Its GPS window obtains deterministic readings from the selected provider and then runs the normal quality/fusion decision. The readings use the current virtual epoch and remain historical/non-future under acceleration. The immutable GPS anchor and existing approximately 50 m correction boundary remain authoritative. Final adjusted coordinate, content/category/privacy, `clientCairnId`, `originActivityClientId`, local commit, Memory evidence, sync, and association are normal.

Run uses the real Quick Cairn flow at the latest fresh accepted Activity coordinate. Freshness is measured on the selected provider timeline, so a historical accelerated fix is not incorrectly declared stale. It keeps normal immutable identity, origin Activity, local durability, Memory, and sync behavior.

Cairn creation/receipt timestamps remain owned by the normal Cairn pipeline and server wall clock, as they also do for offline real Activities. Provenance is the immutable `originActivityClientId`, not a synthetic temporal join; the Simulator does not alter this contract.

When Signal is LOST, Full Plant receives no readings and Quick Cairn is blocked. Hidden virtual position is never privileged as trustworthy GPS.

## Memory

Accepted Activity samples call `recordMemoryEvidence(source='activity')` after the Activity journal commit. The Simulator never calls Memory directly. Spatial dedupe, offline flush, owner isolation, and discard semantics are unchanged; explored evidence survives Activity discard according to the accepted product contract. Gaps contain no samples and therefore add no Memory.

Before an Activity, the Simulator emits no canonical samples and creates no passive Memory evidence. The selected center is configuration only. During an Activity, only canonically accepted Simulator samples enter the existing Activity Memory producer.

## Debug route rollback

Runtime **回退 10m / 25m / 50m / 100m** removes approximately that much accepted same-segment distance from the committed Activity tail. It pauses production and drains the canonical ingest queue, writes a crash-safe journal truncation marker and corrected snapshot, recalculates route/distance/active duration/elevation, restores the virtual position/time to the retained tail, and then resumes the same locked provider. Rejected/raw-only samples are not rollback authority.

The final Activity save is an authoritative complete snapshot and overwrites any temporary incremental server backup, so the finished server route matches the corrected local journal. A process death after the truncation marker cannot recover a pre-correction tail. Memory is intentionally monotonic and is not removed. Committed Cairns are independent objects and are not deleted or moved.

## Offline, Finish, Detail, and sync

The engine requires no network. Manual coordinates, movement, Activity journal, Full Plant, Quick Cairn, Memory, Pause/Resume, Finish, pending Detail, and recovery use existing offline stores. Map tiles may be blank when not cached; the existing offline banner applies.

Finish remains the canonical local-first flow. A saved simulated Activity is a normal pending/synced Activity. Server payload and public Detail have no Simulator-only shape. Local `locationProviderSource='simulator'` remains diagnostic metadata only. After ACK, normal cleanup and server historical authority apply.

## Diagnostics and reset

Before Start, `SIM MODE` clearly selects **Clean Path** or **Raw GPS**. Raw is
labeled **Realistic GPS** with its seed. Mode and seed lock for the whole
Activity. After Tracking begins, the compact lower-left **SIM** trigger and
right-side joystick appear. Expanded **模拟行走** exposes Product/Diagnostic
view, human-language live controls, and **更多** with ground truth, Raw fix,
hAcc, seed, map/provider, generated/accepted/rejected/committed evidence,
segment/owner, `qaSessionId`, and JSONL fallback.

Raw Diagnostic view overlays a thin ground-truth line and translucent Raw
fixes beside the normal processed Live route. Product view hides them. Trails
are bounded to 512 points and hidden diagnostics do not subscribe the parent
map to per-fix updates.

Diagnostics are user/session scoped, bounded to 2,000 events / 512 KiB, privacy-redacted, and automatically batch-uploaded through the authenticated QA telemetry transport. Critical origin/provider/first-point/reacquisition/rollback events survive ordinary stationary-sample churn. Synthetic coordinates may upload; precise real coordinates and credential-shaped values are removed client- and server-side. JSONL copy remains a fallback. See `QA_TELEMETRY.md`.

Every newly focused Hike/Run with no live or durable unfinished Activity automatically initializes that same clean pre-start state: no old origin, hidden position, destination, reacquisition picker, runtime signal, speed, terrain, or clock survives. A recoverable unfinished Activity is checked in the durable registry before reset and retains its exact provider/origin/runtime state. The manual Reset action remains available while idle but is not required between completed/discarded Activities. Reset never deletes a saved Activity, committed Cairn, Memory, pending sync, QA session identity, or server data.

## Inherent limitations

Raw GPS is calibrated behavioral simulation, not a physical receiver. Simulator
does not reproduce radio/multipath physics, satellite geometry, device antenna,
native provider batching, native background scheduling, OS permission UI,
actual process lifetime, low-power/thermal behavior, or Mapbox tile
availability. Its JS runtime caps rather than replays a long suspension backlog.
Production auto-pause observation remains wall-clock/native and is not
accelerated; Activity duration itself is still derived from canonical evidence.
It does not replace the physical-device matrix in `MANUAL_QA_GUIDE.md`.
