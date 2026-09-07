# Activity Simulator contract

Date: 2026-09-07
Audience: internal CairnNZ Functional QA

## What the Simulator is

Activity Simulator is a build-gated virtual location provider for Free Hike and Free Run. It generates location evidence; it is not a second Activity implementation.

The enforced flow is:

`Simulator engine → Activity provider lease → useTrackingStore.addTrackPoint → journal/acceptance/segments/stats/Memory → local completion → pending sync → server Activity → Activity Detail`

The canonical boundary returns an explicit accepted/rejected decision. The Simulator records that decision but never inserts Activity points, assigns distance/pace/elevation, unlocks Activity Memory, links Cairns, finishes an Activity, or uploads an Activity itself.

## Security and activation

All three conditions must be true before Simulator can become the selected source:

1. The Expo bundle was built with `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true`.
2. hidden Debug Mode is enabled.
3. Settings → Developer → Activity Simulator is enabled.

`development-simulator`, `development`, and internal `preview` EAS profiles set the capability to `true`. The public `production` profile explicitly sets it to `false`. Five-tap Debug Mode alone is insufficient in production.

Use a dedicated approved QA account for end-to-end sync. Synthetic Activities, Memory, and Cairns are intentionally not auto-deleted.

The source is selected before Start and is fixed for the Activity. Mid-Activity switching is rejected; Finish or Discard the current Activity first. The normal global one-unfinished rule is never bypassed.

## Same as real GPS downstream

After entering `addTrackPoint`, Simulator evidence uses the same:

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

Before Start, testers can:

- type latitude/longitude and select **Start here**;
- use the current map center;
- long-press the map, then select **Start here**.

Latitude must be within `[-90, 90]`. Finite longitude is normalized into `[-180, 180]`. No device-GPS proximity check is applied. Queenstown, Shanghai, Tokyo, Yosemite, London, Iceland, high latitudes, both hemispheres, and International Date Line crossings are valid.

Changing the origin is disabled after Activity Start. While GPS is LOST, an explicit hidden-position reposition is available for reacquisition testing; it never emits Activity evidence by itself.

## Movement and frame

The joystick is 360 degree, proportional, and has a 12% dead zone. Release means stationary. Direction uses a **north-up screen frame**: up is true north, right is east. This is explicit in the panel and stable even if the tester manipulates the map.

Movement uses deterministic spherical great-circle calculations in metres. Longitude is normalized on every position update. No constant-degree step is used.

Joystick input interrupts and clears autopilot. Walking back is normal new movement: it emits new samples, draws the return segment, adds travelled distance, affects derived pace/elevation, and adds normal Memory evidence. There is no committed-history Undo.

## Speed and accelerated time

Presets are:

- WALK: 5.0 km/h
- HIKE: 3.5 km/h
- RUN: 10.0 km/h
- CUSTOM: 0.1–60.0 km/h

The exact configured speed and time scale are always visible. Speed remains the simulated person's physical speed; time scale changes how quickly that person's timeline elapses. Pace remains derived from accepted distance and accepted same-segment duration. For example, `5 km/h` at `10×` represents about ten Activity minutes and 833 m in one real minute while still deriving approximately 12:00 min/km. It does not emit 50 km/h speed metadata.

Available scales are `1×`, `2×`, `5×`, `10×`, and `30×`. Scale is chosen before Start and fixed through Finish/Discard so one Activity cannot change clocks midway.

`1×` is unchanged wall-clock behavior. Accelerated Activities use a bounded historical evidence clock:

- Start is anchored 12 hours and 60 seconds before the Start wall clock.
- Every Activity GPS, journal, segment, Activity-Memory, start, end, and pending/server payload timestamp remains an ordinary Unix epoch on that same timeline.
- Virtual time advances by `wall elapsed × time scale`, never reverses, and never enters the future.
- Finish uses the provider timeline; it does not add duration or rewrite metrics.
- The maximum accelerated Activity span is 12 virtual hours. At the limit the panel shows a failure and stops duplicate-timestamp publication; Finish or Discard is required.

Consequently, an accelerated QA Activity appears in history up to roughly 12 hours earlier than the wall-clock test session and can cross a calendar-day boundary. This is intentional, visible synthetic-time behavior; its distance, duration, pace, trace, Memory, Cairn provenance, pending state, and server representation remain normal.

The historical anchor is required because future-dating samples is not safe: current Start/append/Finish validation accepts valid ISO/positive epochs without a tight server skew bound, Memory permits timestamps up to 24 hours ahead, and recovery/owner/freshness checks compare timestamp order. Permitting future evidence would therefore store an internally valid but temporally impossible Activity instead of failing closed. No server validation was weakened and Real GPS never consults the virtual clock.

## Sampling and determinism

The engine timer and UI publication cadence are 1 Hz, representative of foreground fitness GPS and low enough to avoid frame-rate coupling. Accelerated ticks are deterministically split into ordered canonical samples no more than ten virtual seconds apart: `2×`/`5×`/`10×` normally emit one sample per wall tick, while `30×` emits a bounded batch of three. A delayed JS tick is capped at five real seconds, so one batch contains at most 15 samples. Each sample independently crosses the normal Activity acceptance/ownership/segment/Memory boundary. Joystick gesture frames update only the input vector.

The default has no random noise. The persisted/logged deterministic seed is `1`, reserved for a future bounded noise preset. Wall-clock scheduling may vary by normal JavaScript scheduling delay; coordinate calculations for the same inputs and elapsed times are deterministic.

When no Activity sink, passive Memory listener, or movement exists, the engine does not emit/log empty samples. Diagnostics and waypoints are bounded.

## Waypoints/autopilot

A map long-press creates a temporary selection. During a Simulator session the tester can **Move here** or **Queue** up to 12 waypoints. Buttons also create 10 m too-short, 20 m threshold, and 1 km north trajectories.

Autopilot follows a simple great-circle bearing at configured speed. It does not call Directions, road-match, create a Route, or upload waypoints. Waypoints are local and are cleared on stop/reset. The joystick interrupts immediately.

## Altitude

Start altitude is configurable from -500 to 9,000 m. Models are:

- FLAT: 0 m/h;
- CLIMB: +300 m/h;
- DESCEND: -300 m/h;
- CUSTOM: -3,000 to +3,000 m/h.

The engine changes only synthetic altitude. Canonical Activity calculates elevation gain between accepted same-segment samples. Cross-gap altitude contributes zero.

## GPS accuracy and signal

Accuracy presets set evidence metadata only:

- GOOD: 5 m;
- NORMAL: 12 m;
- POOR: 60 m;
- CUSTOM: 1–500 m.

The canonical quality authority decides acceptance. Current shared horizontal ceiling is 25 m, so the 60 m POOR preset is normally rejected; the Simulator does not force that result.

Signal states are NORMAL and LOST. LOST emits no location sample to Activity, Plant, Quick Cairn, or passive Memory. Virtual physical motion/autopilot/reposition may continue invisibly. Restore emits the new virtual position on the next provider sample. Canonical time/displacement/accuracy/plausible-speed logic decides whether this is continuous, rejected, or starts a `gps-reacquired` segment.

GPS LOST and PROCESS CONTINUITY LOST are different. The former relies on GPS gap authority; the latter is an explicit known gap.

## Pause, interruption, and recovery

The Simulator has no custom Pause/Resume/Finish controls. Real Activity controls apply.

While Paused, the virtual physical position and clock may move, but the Activity sink is detached and no paused distance, duration, elevation, or Memory is recorded. Resume rotates owner generation, creates a new canonical segment, and the first accepted fix anchors it without a connector to the pre-Pause coordinate. The production segmented stats exclude the paused interval.

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

Outside an Activity, Simulator samples feed the existing Settings-controlled passive producer. OFF records nothing. ON sends acceptable (≤25 m) evidence through `recordMemoryEvidence(source='passive')`. LOST and poor accuracy record nothing.

## Offline, Finish, Detail, and sync

The engine requires no network. Manual coordinates, movement, Activity journal, Full Plant, Quick Cairn, Memory, Pause/Resume, Finish, pending Detail, and recovery use existing offline stores. Map tiles may be blank when not cached; the existing offline banner applies.

Finish remains the canonical local-first flow. A saved simulated Activity is a normal pending/synced Activity. Server payload and public Detail have no Simulator-only shape. Local `locationProviderSource='simulator'` remains diagnostic metadata only. After ACK, normal cleanup and server historical authority apply.

## Diagnostics and reset

The compact panel shows position, altitude, configured physical speed, time scale/effective simulated rate, accuracy/signal, mode, lifecycle, segment/activity suffix, last accepted/rejected sample, Memory result, sync state, actual network state, and most recent failure.

JSONL diagnostics can be copied to the clipboard. Logs are local-only, user/session scoped, survive relaunch, retain full coordinates only for synthetic evidence, and never upload automatically. See `LOGGING_CONTRACT.md`.

Reset is enabled only while Activity is idle. It clears Simulator configuration, provider state, and temporary waypoints; log cleanup is a separate explicit action. It never deletes a saved Activity, committed Cairn, Memory, pending sync, or server data.

## Inherent limitations

Simulator does not reproduce radio/multipath physics, native provider batching, native background scheduling, OS permission UI, actual process lifetime, or Mapbox tile availability. Its normal JS runtime caps rather than replays a long suspension backlog. Production auto-pause observation remains wall-clock/native and is not accelerated; Activity duration itself is still correctly derived from canonical evidence. It does not replace the physical-device matrix listed in `MANUAL_QA_GUIDE.md`.
