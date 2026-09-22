# O40 Simulator Regression Forensic

Date: 2026-09-09 (Asia/Shanghai)

This record was written before the O40 follow-up implementation. Human reports
are observations. A root cause is recorded only where native telemetry,
production data, and the current code establish the first divergent layer.
Production coordinates were inspected read-only; real-GPS coordinates are not
reproduced here.

## Native evidence set

- `qa-mttqqopk-ksz87ea5`, approximately 2026-09-09 14:56–16:30 Shanghai:
  878 events. It contains Simulator Activities `case00` (server session 2056,
  client suffix `28a6689d`) and `case01` (server session 2057, client suffix
  `0240eedd`).
- `qa-mttzb5nd-ottzmm7x`, approximately 2026-09-09 18:52–18:58 Shanghai:
  newest O40 Simulator checkpoint, unfinished server session 2060, client
  suffix `87a3f293`, Simulator session `sim-mttzhi8i-zp8xhtmk`. The uploaded
  bundle contains only six boot/checkpoint events; the last checkpoint proves
  `timeScale=1`, 58 emitted samples, 68 batches, and an active Simulator
  provider, but it cannot prove touch/render details.
- `qa-mttzc2gs-i5808hus`, approximately 2026-09-09 18:52–18:56 Shanghai:
  seven boot/debug/checkpoint events from the same testing period, with no
  Activity event payload.
- Production user 72 was resolved by exact email. Before any cleanup it had
  115 `memory_points`, 6 `unlocked_regions`, 6 Activities, 0 Cairns, and 0
  Routes.

## A. GPS Poor

**HUMAN OBSERVATION**

Switching Simulator GPS to `较差` made visible movement appear to stop.

**CURRENT CODE CONTRACT**

The hidden virtual position advances for every state. Poor emits samples with
hard-coded `accuracy=60m`; the shared Activity boundary rejects accuracy above
25m. The visible Simulator puck follows the latest accepted Activity point,
not hidden position.

**NATIVE EVIDENCE**

In `case01`, first Poor window was virtual time
1788894524091–1788894665201. Twenty-seven Poor samples had accuracy 60m and
the hidden/raw stream advanced about 127.1m. The second Poor window emitted
14 such samples and advanced about 54.5m. No Poor evidence became Memory;
the shared filter rejection reason is `poor-accuracy` by current code and
deterministic tests.

**PROVEN / INCONCLUSIVE**

PROVEN: hidden movement and sample emission continued; all degraded samples
were made categorically unacceptable by the Simulator's fixed 60m accuracy.

**ROOT CAUSE**

Poor was implemented as “emit only evidence guaranteed to fail the production
quality gate”, so its accepted/visible behavior was indistinguishable from a
stalled feed even though its internal feed differed.

**CHANGE**

Pending. Poor must emit a deterministic mixture of marginally usable and
unusable degraded fixes. The production filter remains authoritative.

**REGRESSION TEST**

Pending: hidden movement, emitted degraded evidence, both accept and reject
outcomes, and recovery without an Activity restart.

## B. GPS Lost

**HUMAN OBSERVATION**

The distinction from Poor/Frozen was unclear.

**CURRENT CODE CONTRACT**

Lost advances hidden position and emits no sample. Manual `重新定位` creates
a `gps-reacquired` segment. A direct Lost-to-Normal state switch does not
explicitly carry the known loss into the Activity segment authority.

**NATIVE EVIDENCE**

`case01` sample sequence stayed at 162 while batch sequence advanced from 100
to 108 during Lost. That proves no samples were emitted while the virtual
clock/hidden engine continued. A later segment began independently.

**PROVEN / INCONCLUSIVE**

PROVEN for Lost emission semantics. PROVEN code gap for direct state recovery:
only the manual relocation action establishes an explicit reacquisition
segment.

**ROOT CAUSE**

The engine has a Lost emission rule, but known-loss continuity is coupled to
one UI relocation action instead of every recovery transition.

**CHANGE / REGRESSION TEST**

Pending: any recovery after Lost must begin evidence in a fresh segment, with
zero connector distance/Memory/matching.

## C. GPS Frozen

**HUMAN OBSERVATION**

The distinction from Poor/Lost was unclear.

**CURRENT CODE CONTRACT**

Frozen advances the hidden position, continues callbacks, and repeatedly
reports one fixed coordinate. Current direct recovery has no explicit known
discontinuity handoff.

**NATIVE EVIDENCE**

During the `case01` Frozen window, 18 raw samples were emitted with accuracy
5m and zero reported-path displacement while the batch/sample counters
continued. This distinguishes Frozen from Lost at the provider layer.

**PROVEN / INCONCLUSIVE**

PROVEN provider behavior; PROVEN missing explicit continuity handoff on direct
recovery.

**ROOT CAUSE / CHANGE / REGRESSION TEST**

Same recovery-boundary defect as Lost. Pending coverage must also prove fixed
reported coordinates during Frozen and a fresh segment on recovery if hidden
movement occurred.

## D. GPS status indicator

**HUMAN OBSERVATION**

The top-right status appeared green in Normal, Poor, Lost, and Frozen.

**CURRENT CODE CONTRACT**

Hike/Run color is derived from accepted-point freshness and a 120-second loss
threshold. It does not read the Debug Simulator state. Frozen can keep it
green with accepted stationary heartbeats; Lost and Poor remain green until
the freshness threshold elapses.

**NATIVE EVIDENCE**

The `case01` state changes were short relative to that 120-second UI threshold
at wall time. The source and timestamps therefore reproduce the observed
healthy-green state without requiring a rendering failure.

**PROVEN / ROOT CAUSE**

PROVEN. The indicator answers “recent accepted point?” rather than “which
simulated GPS condition is active?”. That is correct for real O40 freshness
but untruthful as an immediate Debug-state diagnostic.

**CHANGE / REGRESSION TEST**

Pending: retain real-GPS freshness semantics and overlay the explicit
Normal/Poor/Lost/Frozen state only for an active Simulator provider.

## E. Fast Replay

**HUMAN OBSERVATION**

60x/120x controls were not discoverable and movement felt slow.

**CURRENT CODE CONTRACT**

Source contains 1x/5x/10x/30x/60x/120x controls and a bounded engine that emits
intermediate 10-second virtual samples. The runtime starts as a small collapsed
`SIM` chip; the multiplier is visible only after expanding it.

**NATIVE EVIDENCE**

O39 `case01` recorded one `time_scale_set` to 10x and preserved intermediate
points. The newest O40 checkpoint remained at 1x. No O40 60x/120x selection
event uploaded, so actual O40 engine execution at those settings is
INCONCLUSIVE. Source/tests prove the engine and controls are present, not that
the human could discover them on device.

**PROVEN / ROOT CAUSE**

PROVEN discoverability failure: collapsed runtime state exposes neither the
current multiplier nor a replay affordance. Engine regression is
INCONCLUSIVE.

**CHANGE / REGRESSION TEST**

Pending: expose multiplier truth in the collapsed control and retain the full
expanded controls. Re-run 1x/120x equivalence and intermediate-point tests.

## F. Joystick jitter

**HUMAN OBSERVATION**

S and SE could shake violently; other directions appeared better.

**CURRENT CODE CONTRACT**

The current source derives a bearing from touch `locationX/locationY` around a
fixed center. Its math maps N/NE/E/SE/S/SW/W/NW monotonically. The responder
surface contains animated descendants but does not fence child hit targets.

**NATIVE EVIDENCE**

The older session recorded grants/releases but no move-vector events; the
newest O40 session uploaded checkpoints only. There is not enough native data
to attribute the shake to a quadrant, camera feedback, or coordinate frame.

**PROVEN / INCONCLUSIVE**

INCONCLUSIVE at the native first-divergence layer. The all-direction pure math
is not the failure. A moving-descendant/local-coordinate feedback loop remains
a code-supported hypothesis and must not be presented as proven until new
vector telemetry can distinguish target-local coordinates from the fixed
joystick surface.

**ROOT CAUSE**

INCONCLUSIVE.

**CHANGE / REGRESSION TEST**

Pending: add bounded vector/displacement telemetry and fixed-surface responder
coverage; do not change Activity calculations.

## G. Save latency

**HUMAN OBSERVATION**

Saving the roughly 1.86km, 32:37 `case01` Activity blocked for more than 20s.

**CURRENT CODE CONTRACT**

Local pending payload, Activity summary, and completed registry state are made
durable before the network request. The UI nevertheless waits up to 20s for
the atomic server response before navigating.

**NATIVE EVIDENCE / TIMELINE**

- Finish: 15:03:05.556 Shanghai.
- Two segment matching calls: 519ms + 675ms (about 1.2s total).
- `activity_save_started`: 15:03:06.841.
- `activity_save_pending`: 15:03:27.040 (20.199s later).
- Payload: 142 display points, 396 raw points, 72 Memory points in the
  affected Activity range.
- Production attribution began at 15:03:07.278 and held one pass for about
  84.4s. A concurrent `/memory/points` insert hit a lock-wait timeout.

**PROVEN / FIRST DIVERGENCE / ROOT CAUSE**

PROVEN. Matching was not dominant. The server ran expensive spatial Memory
region attribution inside the Activity transaction before commit/response.
That derived operation held the transaction beyond the client's 20s bound and
created lock contention with normal Memory sync.

**CHANGE / REGRESSION TEST**

Pending: keep session + raw + display + Memory rows atomic, commit those rows,
then run derived region attribution out of the blocking transaction through a
bounded per-user queue. Navigation may use the already durable local success
without waiting for derived attribution.

## H. Snap / map matching

**HUMAN OBSERVATION**

The first `case01` segment crossed a road and returned, but derived geometry
appeared on a nearby small path.

**CURRENT CODE CONTRACT**

Each explicit Activity segment is matched independently with walking profile,
accuracy radiuses clamped to 10–40m, and only a confidence floor of 0.3. No
raw-to-derived deviation or shape/length quality gate exists after matching.

**NATIVE / PRODUCTION EVIDENCE**

Affected server Activity is 2057. Segment 1 had 78 matching-input points and
returned 42 derived points in 519ms. Against durable accepted Memory samples
from the same segment (nominal Simulator accuracy 5m), derived deviation was
about 20m at p95 and 25.4m maximum; its length was about 5% shorter. `case00`
baseline was about 1.8m p95 and 2.8m max. The matcher confidence value was not
retained in telemetry or persistence.

**PROVEN / INCONCLUSIVE**

PROVEN that the derived segment materially displaced trustworthy accepted
evidence and passed because no geometric truth gate existed. The exact Mapbox
candidate confidence and named path are INCONCLUSIVE.

**ROOT CAUSE**

The completion path treated any Mapbox result above a low confidence floor as
display-authoritative, without validating it against raw accepted evidence.

**CHANGE / REGRESSION TEST**

Pending: compute privacy-safe raw-vs-derived metrics per chunk/segment and
fallback to raw for implausible correction. Thresholds must preserve the
near-raw `case00` baseline and reject the observed segment-1 displacement.

## I. Dashed Gap rendering

**HUMAN OBSERVATION**

Gap dash looks acceptable close in and unclear/wrong when zoomed out.

**CURRENT CODE CONTRACT / EVIDENCE**

Activity 2057 persists two explicit segment IDs and Map History constructs one
gap feature only between those segment endpoints. Thus the gap data is
correct. The Mapbox layer uses constant 5px width and `[2, 1.5]` dash units at
all zooms.

**PROVEN / ROOT CAUSE**

PROVEN rendering-only issue: fixed screen-space dash styling does not adapt to
summary zoom. No data/segment change is justified.

**CHANGE / REGRESSION TEST**

Pending, P2 after core work: zoom-interpolated width/opacity/dash distinction.

## J. Memory bridge

**HUMAN OBSERVATION**

Disconnected virtual locations appeared connected in Memory.

**CURRENT CODE CONTRACT**

Durable Memory stores a flat chronological point list with no Activity or
segment identity. `FogLayer.segmentByGap` converts every consecutive point
less than 60 minutes apart into one Turf LineString, then buffers that line.

**NATIVE / PRODUCTION EVIDENCE**

Both missing boundaries are present in the captured data:

- Cross-Activity: `case00` ended in New Zealand and `case01` began in
  Shanghai 123.512 virtual seconds later, a roughly 9,364km discontinuity.
- Same Activity: `case01` segment 1 ended and segment 2 began 262.780 virtual
  seconds later, about 154.5m apart.
- Another fresh-origin boundary connected Russia to New Zealand about 99.9
  seconds apart, roughly 12,926km.

The `memory_points` table contains only observed points at the component ends;
it contains no interpolated rows along any connector. `unlocked_regions` is
also point-attributed. The visible corridor is synthesized by the client
LineString buffer.

**PROVEN / CLASSIFICATION / ROOT CAUSE**

PROVEN rendering-derived bridge, not persisted traversal rows. It affects both
same-Activity segment gaps and fresh-Activity boundaries. The root cause is
the flat, time-only LineString reconstruction, which discards the central
Activity/segment continuity authority and invents traversal between unrelated
point evidence.

**CHANGE / REGRESSION TEST**

Pending: Memory rendering must be a union of bounded evidence footprints (or
equivalent explicit components), never an inferred global line between flat
points. Tests must cover same segment, two gaps, fresh Activity, and monotonic
rollback.

## K. Home Memory summary

**HUMAN OBSERVATION**

Home could show `is waiting` until Memory was opened, then about 0.1km2.

**CURRENT CODE CONTRACT / NATIVE EVIDENCE**

Home subscribes to `useMemoryStore.points.length`. Cold auth hydration loads
only local storage and attaches push sync. The only full server pull/reconcile
is owned by `ForegroundUnlockManager`, which is mounted by MemoryScreen and
explicitly not mounted at app root. Production held 115 Memory rows, so an
empty/stale local cache can remain zero on Home until that screen side effect.
The earlier native observation exactly follows this lifecycle. The newest O40
checkpoint bundle does not contain a Memory-screen lifecycle, so that specific
O40 launch is otherwise INCONCLUSIVE.

**PROVEN / ROOT CAUSE**

PROVEN architectural defect. Server hydration is screen-owned instead of a
shared authenticated Memory authority. Home correctly subscribes to the
store, but nothing guarantees that store has reconciled before MemoryScreen
mounts.

**CHANGE / REGRESSION TEST**

Pending: app/account lifecycle initializes local Memory, sync, and bounded
server reconciliation independently of either screen. MemoryScreen consumes
the same store without owning global initialization. Test cached offline,
online empty/local-empty, reset, relaunch, and later new evidence.

## L. Worldwide cold loading

Low priority and not investigated in this pass before P0/P1 closure. Status:
INCONCLUSIVE. No tile/source change is justified by current evidence.

## Post-implementation evidence addendum

This addendum is append-only and supersedes each earlier `Pending` line. It
does not reinterpret the native evidence: O41 device behavior remains the
human acceptance gate.

### GPS states and status

- **CHANGE:** Poor now uses a deterministic degraded accuracy cycle
  (`18m, 48m, 22m, 60m`). The hidden person and callback stream continue,
  while the unchanged production 25m gate yields both accepted and rejected
  evidence. Poor is no longer an alias for Lost/Frozen and no sample is forced
  through the filter.
- **CHANGE:** recovery from either Lost or Frozen routes through the shared
  Activity reacquisition operation and creates a fresh durable segment before
  the next Normal/Poor/Frozen evidence. A rejected first Poor reacquisition
  retains the boundary marker until the first accepted point.
- **CHANGE:** the Hike/Run top-right status shows `正常`, `较差`, `丢失`, or
  `卡住` immediately when the Simulator owns the Activity. Real GPS continues
  to use O40 accepted-fix freshness without reading Debug state.
- **TEST:** deterministic engine/provider/store contracts prove hidden Poor
  movement, mixed acceptance, Lost no-emission, Frozen fixed-coordinate
  callbacks, recovery segmentation, repeated recovery, and retained boundary
  state after an initially rejected Poor fix.
- **STATUS:** IMPLEMENTED AND AUTOMATED; O41 NATIVE STATE TRANSITION CHECK
  REQUIRED.

### Fast Replay and joystick

- **CHANGE:** the collapsed control now says `SIM · <multiplier>x`; the normal
  runtime panel exposes 1x/5x/10x/30x/60x/120x without requiring Advanced QA.
  The existing bounded 12-sample/120-virtual-second engine remains unchanged.
- **TEST:** 1x and 120x at 5km/h produce equivalent physical distance,
  duration, pace basis, segment identity, and endpoint while retaining
  intermediate canonical samples. The 390x844 Expo-Web board shows all six
  options, a lower-left collapsed chip, and a separate right-side joystick;
  all five board assertions pass with zero runtime errors.
- **JOYSTICK EVIDENCE:** the bearing formula itself is correct in all octants.
  The source violated its fixed-coordinate premise by allowing the animated
  knob/labels to participate in hit testing while consuming `locationX/Y`.
  Because those descendants move down and right with the finger, that can
  change the local event frame during a sustained S/SE gesture. Native O40
  telemetry was too sparse to prove that this was the only contributing
  mechanism.
- **CHANGE:** a single fixed `box-only` responder surface now owns all touch
  coordinates; one pure center-relative vector function owns bearing and
  magnitude. Bounded input and requested/actual movement telemetry was added.
- **TEST:** N/NE/E/SE/S/SW/W/NW plus twenty sustained samples per direction are
  stable and monotonic in the pure input contract. S and SE remain the focused
  O41 native confirmation.
- **STATUS:** IMPLEMENTED AND AUTOMATED; NATIVE FIRST-DIVERGENCE CONFIRMATION
  REMAINS REQUIRED.

### Save latency

- **CHANGE:** backend source durability remains transactional, but derived H3
  Memory attribution starts only after commit through a per-user coalescing
  queue. Save no longer waits for that expensive derived projection. A reset
  fence prevents an in-flight pre-reset projection from recreating cleared
  regions. Client telemetry now records Finish reconciliation, matching,
  Memory reconciliation, payload serialization, local durable completion,
  server request, and acknowledgement persistence separately.
- **DEPLOY:** scoped backend commit
  `f5d0127c44eb98dc95cc8687711679f23fd10f61` was pushed to `origin/master`
  and deployed with the canonical script. Zero migrations ran. Production
  checkout is `f5d0127c`; backend and MySQL are healthy with zero restarts
  after deployment, and the local health endpoint reports database `ok`.
- **TEST:** 17 focused backend contracts pass, including immediate queued
  attribution, range coalescing, reset fencing, source-row durability, and a
  Save contract that acknowledges committed source rows before derived
  attribution. The observed 84.4-second blocking function is no longer in the
  response transaction. Exact O41 wall-clock Save time requires a new native
  Activity; no number is manufactured here.
- **STATUS:** PROVEN BLOCKER REMOVED AND DEPLOYED; O41 NATIVE LATENCY MEASUREMENT
  REQUIRED.

### Matching and dashed gaps

- **CHANGE:** matching now computes per-segment confidence plus raw-to-derived
  p95/max deviation, endpoint displacement, and length ratio. A result outside
  the accuracy-bounded envelope falls back to that segment's raw accepted
  geometry. It never changes historical raw authority or joins segments.
- **TEST:** the near-raw `case00` baseline passes; a nearby-path displacement
  shaped like the observed `case01` segment is rejected; segment-local
  fallback and existing matching contracts pass.
- **CHANGE:** the existing gap feature remains unchanged. Only its Mapbox line
  width/opacity now interpolate across zoom so the dash remains legible at
  summary scale.
- **STATUS:** IMPLEMENTED AND AUTOMATED; O41 VISUAL MATCH/GAP CONFIRMATION
  REQUIRED.

### Memory continuity, cleanup, and Home authority

- **CHANGE:** `FogLayer` no longer turns flat chronological Memory rows into
  LineStrings. It subtracts bounded 30m footprints around actual persisted
  evidence. Overlapping evidence still forms a corridor; neither a segment
  gap nor a new Activity can acquire a synthesized connector. Empty evidence
  also replaces the module/instance fog cache with solid fog, preventing old
  holes from surviving reset/account change.
- **TEST:** continuous A/B/C evidence overlaps; same-Activity gaps, two repeated
  gaps, and fresh-Activity discontinuities have no midpoint hole; rollback's
  monotonic persisted Memory contract remains unchanged. The database evidence
  already proved there were no interpolated connector rows, so no writer or
  Activity calculation was altered.
- **CLEANUP:** exact account `frankmeng920313@gmail.com` resolved to user 72.
  The pre-mutation snapshot was 115 `memory_points`, 6 `unlocked_regions`, 6
  Activities, 0 Cairns, and 0 Routes, with about 0.062215km2 derived explored
  area. A narrow transaction deleted only the 115 Memory rows and 6 derived
  regions. Independent post-commit checks remained at zero Memory/regions;
  all 6 Activities and the zero Cairn/Route counts were unchanged.
- **CHANGE:** authenticated app initialization now hydrates the durable local
  Memory store, attaches sync, and independently starts a bounded full server
  reconcile. `MemoryScreen` no longer owns this global initialization. An
  empty authoritative server result drops synced stale cache but retains
  genuinely unsynced offline evidence; the supported reset path cancels
  pending work before clearing local Memory.
- **TEST:** cold Home initialization without MemoryScreen, cached offline
  display, server-empty reconciliation, unsynced preservation, reset cache
  invalidation, and later store publication are covered.
- **STATUS:** IMPLEMENTED, SERVER BASELINE RESET, AND AUTOMATED; O41 COLD-LAUNCH
  DEVICE CONFIRMATION REQUIRED.

### Release regression evidence

- Focused O41 matrix: 7 suites / 123 tests pass for Simulator states, replay,
  joystick, Memory authority/continuity/reset, and matching quality.
- Full Simulator directory: 9 suites / 146 tests pass, including walking-route
  fail-closed behavior, virtual clock, store, correction, and telemetry
  concurrency. Jest exits successfully but reports a post-run open-handle
  warning from the existing test harness.
- O40 real-GPS protection matrix: 9 suites / 169 tests pass for tracking-store,
  lifecycle timer, background ownership/handoff, timestamp normalization,
  canonical Activity contracts, and Simulator/real provider isolation.
- Expo-Web mobile QA: 5 screenshots, all assertions pass, zero runtime errors.
- `git diff --check` passes. Repository-wide TypeScript remains non-zero on
  pre-existing missing Playwright/i18n/generated-preview typings and legacy
  test exports. The only diagnostic in a touched production file is the same
  unresolved `@turf/helpers` declaration category already present in the
  pre-change `FogLayer`/existing Memory service; no new task-local semantic
  TypeScript diagnostic was identified.
- Rename UI remains deferred to the Trails / Activity Detail UI pass.
- Worldwide cold-load remains INCONCLUSIVE and unchanged because P0/P1 work
  took priority.
