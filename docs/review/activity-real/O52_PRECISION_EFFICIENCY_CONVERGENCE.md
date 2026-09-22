# O52 PRECISION-FIRST ACTIVITY VERDICT

**Verdict: ENGINEERING EFFICIENCY READY. Hike / Run are READY FOR FINAL FIELD TEST. BATTERY ACCEPTED remains false until a physical-device comparison is completed.**

O52 is a convergence pass, not a tracking or product redesign. It preserves Stationary V2, the shared Hike / Run canonical reducer, the established movement envelopes, O50 Final quality gates, Activity product UI, and Memory's movement-owned exploration truth. It fixes one confirmed canonical boundary defect and removes the architectural work that made the preceding energy audit unsuitable for battery acceptance.

The OTA marker advanced once from `O51` to `O52`. No OTA was published.

## Authority and scope

The implementation was recovered from current source, `O50_USER_GRADE_FINAL_ROUTE.md`, `O51_REAL_FIELD_FORENSIC.md`, `o51-field/O51_FIELD_FORENSIC_HANDOFF.json`, `ACTIVITY_ENERGY_PERFORMANCE_AUDIT.md`, the O43–O50 convergence material, installed package/native source, and current tests/replays. Current source was treated as implementation truth.

`CairnNZ_Project_Authority.md` is not present anywhere under the repository or its parent workspace, so it could not be read. No conclusion in this report is inferred from an unavailable authority file.

The historical evidence names remain exactly `great hike`, `run issue`, and `mstand`. Their settled conclusions were not renamed, reopened, or replaced with conversational memory.

## Background precision

### Decision

Foreground and background can safely request the same precision intent on the installed Expo Location stack. O52 therefore uses the same BestForNavigation-class accuracy and the same selected 1 m spatial distance filter for Hike and Run in both lifecycle states.

Expo documents `Accuracy.BestForNavigation` as its highest navigation-oriented accuracy level, and `distanceInterval` as the minimum displacement between updates. Its background task API accepts the same location accuracy/distance options and may deliver an array of locations in one task execution. `timeInterval` is Android-only. See [Expo Location](https://docs.expo.dev/versions/latest/sdk/location/). On installed Expo Location `19.0.8`, iOS maps BestForNavigation to `kCLLocationAccuracyBestForNavigation` and `distanceInterval` to `CLLocationManager.distanceFilter`.

Apple defines `distanceFilter` as a movement threshold relative to the last delivered location, not a temporal callback promise. Background execution, radio conditions, system power management, batching, coalescing, and suspension can still change callback timing. See [CLLocationManager distanceFilter](https://developer.apple.com/documentation/corelocation/cllocationmanager/distancefilter) and [Apple's location energy guidance](https://developer.apple.com/library/archive/documentation/Performance/Conceptual/EnergyGuide-iOS/LocationBestPractices.html).

### Exact requested configurations

| Property | Foreground `watchPositionAsync` | Background `startLocationUpdatesAsync` |
| --- | --- | --- |
| Accuracy | `Location.Accuracy.BestForNavigation` | `Location.Accuracy.BestForNavigation` |
| Spatial filter | `distanceInterval: 1` in production | the same selected `distanceInterval: 1` |
| Time option | `timeInterval: 1000` ms; effective on Android, not iOS | `timeInterval: 1000` ms; effective on Android, not iOS |
| iOS activity type | foreground watch default | `Location.ActivityType.Fitness` |
| Automatic pause | foreground watch default | `pausesUpdatesAutomatically: false` |
| Background indicator | not applicable | `showsBackgroundLocationIndicator: true` |
| Android service | not applicable | ongoing `Cairn is tracking` foreground-service notification |
| Deferred delivery | not requested | not requested |

Production always resolves to 1 m. The existing Internal Debug A/B control can still explicitly select 5 m so O44 experiments remain reproducible; it is a test override, not production behavior. Foreground and background use the same selected policy within an Activity. No speed-adaptive cadence, turn-triggered accuracy change, polling loop, or secondary location client was introduced.

### Platform differences that remain

- iOS owns actual background scheduling. It may delay, batch, coalesce, or throttle callbacks despite the 1 m request.
- A 1 m distance filter creates evidence opportunity; it does not promise one callback per metre or once per second.
- Expo foreground watch callbacks arrive individually. TaskManager can deliver multiple background locations in one invocation; O52 preserves their timestamp order and performs one bounded headless batch commit.
- Android can apply the 1,000 ms time interval as well as the distance interval. iOS ignores the time interval.
- BestForNavigation is an accuracy request, not a guarantee that reported horizontal accuracy will be 1 m. The real O51 field cases commonly reported about 14.25 m hAcc.

Expected actual behavior is therefore denser background opportunity than the former 5 m request, but still OS-shaped delivery. The next field test records delivered foreground/background counts and interval/spatial percentiles rather than claiming requested cadence was achieved.

## Tracking correctness

### `acc` / `accuracy` boundary

The checksummed journal deliberately stores the compact field `acc`. `toCanonicalJournalPoint()` is now the only persisted/raw-to-runtime adapter and maps it to canonical `accuracy` before recovery, headless continuation, or segment classification. Downstream classifiers no longer recognize or branch on storage spellings.

No 120 s rule, movement threshold, Stationary V2 decision, or mode envelope changed.

The privacy-safe `run issue` regression records the actual decisive values:

```text
previous persisted background hAcc = 14.246 m
elapsed interval = 121 s
endpoint displacement = 11.937 m
known recording loss = false
result = same segment, no Gap

same evidence with known recording loss = true
result = new segment / true reacquisition Gap
```

This proves the false red-light Gap disappears for healthy accuracy while true source-loss behavior remains protected.

### Stationary and ownership result

Stationary fixtures, long uncertain stops, abrupt stop, slow walking, candidate expiry, true source loss, and true reacquisition pass without a false distance or connector regression. Background writes retain owner generation, Activity identity, raw ordinal, segment identity, provenance, and acceptance fencing. A stale owner is rejected before it can enter the journal. Foreground takeover stops the native background task, waits for its writes, drains committed evidence in timestamp order, then starts the foreground watcher. Provider overlap is measured and expected to remain zero.

Hike and Run still call one store, one Expo provider policy, one real-GPS continuity reducer, one journal, one Memory boundary, and one O50 Final implementation. Their justified maximum credible movement envelopes remain different: Hike 4.17 m/s and Run 10 m/s.

## Location ownership

### Before

Foreground Activity used two native Core Location client stacks:

```text
Expo BestForNavigation stream -> canonical truth
RNMapbox AppleLocationProvider + heading -> puck and follow camera
```

Pause stopped Expo but left the Mapbox Apple location/heading stack active while the Activity map remained mounted.

### After

Installed RNMapbox `10.3.1` exposes `CustomLocationProvider`. Its iOS implementation overrides both the map view location provider and the shared RNMapbox location/heading provider; removal restores `AppleLocationProvider`. O52 mounts that override before the camera/UserLocation consumers throughout a real, non-idle Activity. This produces:

```text
one Expo Activity stream
  -> immediate presentation coordinate (raw, never canonical authority)
  -> canonical reducer
  -> checksummed Activity WAL
  -> route / metrics / Memory

immediate presentation coordinate
  -> RNMapbox CustomLocationProvider
  -> normal puck + existing follow camera
```

The presentation coordinate is published immediately from the owned Expo callback, before reducer and journal latency, so puck/camera responsiveness is not tied to the durable commit. Canonical truth still appears only after classification and WAL success.

The current normal puck does not request a heading indicator. Follow camera requires location, not an independent compass observer. Valid Expo course is passed as best-effort custom-provider heading; invalid or stationary course is omitted. If Cairn later adds a compass-heading product, course alone will not satisfy that new requirement, but no current behavior depends on it. RNMapbox documents the custom provider surface at [CustomLocationProvider](https://rnmapbox.github.io/docs/components/CustomLocationProvider).

Before Start/after return to idle, the visible map may use RNMapbox's Apple provider for the ordinary pre-Activity puck. During an Activity it is overridden and is not a second sensor authority.

### Lifecycle

| Lifecycle | O52 location/presentation behavior |
| --- | --- |
| Foreground tracking | Expo foreground watcher active; custom provider feeds puck/camera; no Mapbox Apple provider |
| Background/inactive | foreground watcher stops before TaskManager starts; UserLocation/follow/animation inactive; passive custom override prevents Apple-provider restoration |
| Pause | both Expo sources stop and durable lease is disabled; UserLocation, camera follow, and presentation animation stop; a static canonical puck may remain |
| Resume | owner generation and segment rotate; one foreground or background Expo source starts; custom puck resumes from that stream |
| Finish | acceptance fence closes, sources stop, committed headless writes drain, presentation provider/follow/animation stop before O50 work |
| Unmount | map/custom provider unmounts; no Activity source remains |
| Account switch | sources, listeners, Activity timers, and background lease stop; the old owner's journal remains recoverable |
| Discard | sources stop and fence drains before the Activity is tombstoned and its journal is removed |

Manual browse/follow semantics and existing recenter behavior were not redesigned. Provider start/stop and presentation-active duration telemetry will show a lifecycle mismatch in the next field test if one remains.

## Energy architecture

### Journal

The full-history read/parse/rewrite/verify/swap on every accepted point was replaced by a versioned checksummed JSONL WAL. Native `expo-file-system` `FileHandle` opens at EOF and appends only the new record(s). Each foreground accepted point still awaits its one-record durable commit; a TaskManager batch appends its accepted records in one ordered operation. The small advisory metadata object is still updated in bounded O(1) work.

Each v2 record carries a checksum. Recovery stops at a torn or checksum-invalid tail. The next writer repairs that exceptional valid prefix through the existing crash-safe marker/next/backup swap; normal commits inspect only a bounded tail. Full history is read for recovery, Finish, explicit QA rollback, or exceptional corruption—not per fix. Existing plain JSONL unfinished Activities remain readable through a one-time, idempotent compatibility path.

Preserved contracts include owner generation, segment provenance, acceptance fence, one-point crash durability, process-death recovery, partial-write detection, corruption fallback, idempotent recovery, rollback truncation, and Finish recovery. Journal failure prevents canonical publication; a telemetry failure cannot do so.

### QA and debug logging

Ordinary point events now coalesce into 10-second aggregates keyed by event/decision/reason/source. Each aggregate retains a repeat count and at most 24 timing/spatial samples. Coalesce lookup examines at most the latest 256 retained events. Ordinary canonical commits no longer force an immediate full-history flush.

Durable QA flush changed from 1.5 s/full-event churn to a 30 s dirty checkpoint. Automatic upload is a 120 s delta from the durable cursor, rather than resending the complete retained snapshot. Lifecycle transitions, errors, and genuinely critical evidence can still flush immediately. The hard event/byte/session caps, 24-hour privacy retention, exact-coordinate stripping, five-failure backoff, and terminal cleanup remain.

The older real-device debug JSONL writer now performs native EOF appends rather than reading and rewriting up to 50 MB per flush. Its in-memory buffer, 30 s/100-event cadence, file cap, metadata, and failure isolation remain.

### Live route geometry

The live canonical line is represented as stable body chunks plus a changing head capped at 256 points. Normal append processing examines only new canonical points. When the head freezes, its final coordinate is also the first coordinate of the new head, preventing a seam. Explicit segment gaps stay separate; U-turns and repeated traversal retain chronological geometry. Recovery/rollback replacement rebuilds once.

Stable Mapbox sources retain identity and do not retransmit when only the head changes. The active head keeps the existing continuous line animation and latency. Route metrics record geometry builds, source updates, current approximate payload, cumulative approximate payload, and whether an exceptional full projection rebuild occurred.

### Memory

Movement still owns exploration truth and the 12.5 m spatial dedupe threshold is unchanged. Live Activity Memory evidence is already recoverable from the Activity WAL, so it no longer forces a full Memory snapshot per newly explored point. The existing 3 s debounce/15 s maximum wait performs the full durable snapshot only when a write actually fires. Pause/Finish/recovery reconciliation is batched and ends with one forced Memory flush; if that flush fails, the Activity journal remains available for retry.

Memory persistence now subscribes only to point/reference or initial-reveal changes, so sync counters no longer re-arm a full snapshot. The internal spatial bucket index and derived H3 cell map update in place with explicit render versions instead of cloning complete maps per new cell. The public Memory point array remains immutable and therefore still makes one O(n) array copy for each genuinely new 12.5 m evidence mutation; this is a WATCH item, not a 1 m-callback cost because most callbacks deduplicate.

Live Memory network push moved from a 5 s rearmed debounce to 30 s with a 60 s maximum wait. Batches, local pending evidence, idempotent cids, user epochs, aborts, and failure backoff remain. Network failure never blocks canonical truth or removes local evidence.

### Registry, context, timers, React, and network

- Accepted foreground points no longer rewrite the unfinished registry and full background context. The WAL/meta pair is point recovery authority; registry/context are refreshed at structural lifecycle boundaries. Headless background processing updates its bounded context once per native batch.
- The 1 s background-drain polling interval was removed. Headless points are projected at explicit foreground, Pause, Finish, recovery, and discard fences.
- Auto-pause's once-per-minute check requests only the last 15-minute canonical suffix instead of mapping the complete Activity history.
- The lifecycle timer still checks at 250 ms but publishes duration only when the displayed second changes. QA health, battery sampling, auto-pause, and session snapshots remain low-rate expected observability. The 30-minute auth timer and 120/300 s Activity delta-backup timer remain because their frequency is negligible compared with GPS/Mapbox and changing them would broaden recovery/auth behavior.
- Hike's live map projection is memoized against the route reference, so duration-only screen updates do not remap all canonical points. Existing narrow selectors were retained. The map alone consumes the raw presentation coordinate; Activity chrome does not subscribe to it.
- Activity route backup remains delta-only at 120 s foreground / 300 s background. Map Matching and Directions remain Finish-only. No per-callback telemetry or Memory request was introduced.

### Hot-path classification after a 1 m background assumption

| Classification | Areas |
| --- | --- |
| MUST FIX BEFORE ENERGY TEST | **Resolved:** duplicate Activity location clients, paused presentation provider, quadratic journal, full-history background tail read, QA full-log per-point flush, debug full-file rewrite, full route retransmission, per-point registry/context writes, per-Memory-mutation full snapshot/map clones, 1 s background drain poll |
| WATCH | immutable raw/canonical arrays, immutable public Memory points on a new 12.5 m cell, 250 ms lifecycle check, RNMapbox bridge/render cost while foreground, O50 Finish CPU/memory peak, actual iOS callback batching |
| NEGLIGIBLE | 30-minute auth refresh, once-per-minute battery/network/session/QA checks, once-per-minute auto-pause over a bounded suffix, 120/300 s delta route backup when no data is pending |
| EXPECTED COST | one BestForNavigation source, one WAL record per accepted point, Stationary V2/canonical classification, screen and Mapbox presentation while foreground, exact Memory mutation when a new place is explored, Finish-only O50 requests |

## Scaling

The deterministic journal model uses one-second-equivalent accepted points and a conservative 220-byte checksummed record. Values are logical algorithmic work, not claims about physical NAND writes.

| Duration | Points | O51 full-history rewrite work | O52 WAL append bytes | Reduction in modeled cumulative journal bytes |
| --- | ---: | ---: | ---: | ---: |
| 30 min | 1,800 | 356,598,000 B | 396,000 B | 900.5x |
| 2 h | 7,200 | 5,703,192,000 B | 1,584,000 B | 3,600.5x |
| 5 h | 18,000 | 35,641,980,000 B | 3,960,000 B | 9,000.5x |

O52 normal journal work is O(new record), and cumulative work is O(n). Exceptional corruption repair, rollback, Finish, and recovery may remain O(n). Runtime counters expose record count, physical append-operation count, logical bytes, actual appended bytes, repair/checkpoint count and bytes, total append commit time, and maximum commit time.

For route rendering, O51's last 18,000-point update carried approximately 288,000 coordinate bytes and cumulative growth was quadratic. O52's deterministic 1,800/7,200/18,000 scaling tests cap any one changed-source payload at `(256 + 2) * 16 = 4,128` coordinate bytes. Its conservative 5-hour cumulative upper bound is 74,304,000 bytes versus O51's 2,592,144,000 bytes; stable chunks normally make actual bridge work lower. The visible route remains exact and continuous.

Memory full snapshots remain O(total explored Memory), but occur at the existing 3 s debounce/15 s maximum checkpoint rather than every new point. Network requests are coalesced to 30–60 s. Point evidence mutation itself is spatially indexed; public-array growth is the remaining linear WATCH cost.

## Before / after efficiency

| Area | Before | After | Expected impact | Correctness risk |
| --- | --- | --- | --- | --- |
| Location providers | Expo truth plus independent Mapbox Apple location/heading during foreground; Mapbox continued on Pause | one Expo Activity source feeds truth and RNMapbox custom presentation; idle map may use Mapbox Apple | Removes duplicated native client/callback/bridge work; physical saving requires device trace | Medium; mitigated by immediate raw presentation feed, lifecycle gates, mobile UI QA, and provider telemetry |
| Background precision | BestForNavigation + 5 m | BestForNavigation + 1 m, same as foreground | More evidence opportunity; intentionally accepts reasonable GPS energy cost | Low tracking risk; delivered cadence remains OS-owned |
| Journal | full history read/rewrite/verify per accepted point, O(n²) cumulative | checksummed EOF append WAL; bounded tail inspection; exceptional recovery checkpoint | Largest I/O/CPU/GC reduction | Medium because durability is critical; migration/corruption/process-death tests pass |
| QA logging | ordinary commit could force full retained-log write; complete snapshot uploads | 10 s aggregates, 30 s durable dirty flush, 120 s delta upload | Removes telemetry-induced energy distortion | Low; error/lifecycle/terminal evidence and bounds remain |
| Route rendering | full-route rebuild and source retransmission per accepted point | stable chunks plus <=256-point changing head | Bounded bridge payload and allocation | Medium; gap/U-turn/repeat/seam/scaling tests pass |
| Memory persistence | new evidence forced or prepared repeated full snapshots; map indexes cloned | Activity WAL-backed debounce, snapshot-at-flush, in-place private indexes | Major reduction on unexplored routes | Medium; Finish/recovery force one durable snapshot and tests pass |
| Paused work | Mapbox Apple provider/heading active; 1 s drain poll | no sensor provider, UserLocation, follow, or animation; no drain poll | Removes material pause cost | Low; static canonical puck and Resume retained |
| React updates | route projection tied to broad screen updates | route memoized; raw location isolated to map selector | Less reconciliation and route allocation | Low; no architecture rewrite |
| Network | Memory rearmed at 5 s; QA full snapshots; route backup deltas | Memory 30 s/60 s max, QA deltas, existing route deltas | Fewer radio wakes and bytes | Low; durable local pending state/backoff remain |

Impacts in this table are architectural expectations. None is a measured `%/hour` claim.

## Real-case replay

### `great hike`

**PASS / no regression.** The O51 privacy-safe authority remains 99 raw callbacks -> 88 canonical points, one segment, zero Gaps, canonical 177.025 m, Final 172.516 m. The abrupt-stop Candidate/stationary behavior remains intentional. The reported 1–2 m leftward physical movement remains below useful observability under about 14 m hAcc and received no tracking change.

The small GH-3 inward bend is still classified as O50 Final-display P2, not canonical tracking failure.

### `run issue`

**PASS after adapter correction.** Historical authority remains 119 raw callbacks and the stored O51 result remains two segments/one false Gap; history is not rewritten. The exact deterministic counterfactual now reads stored `acc: 14.246` through the canonical adapter, then classifies the 121 s / 11.937 m red-light interval as continuous. Gap result: **zero false Gaps**. A test with `knownRecordingLoss: true` still creates the true Gap.

Complete historical canonical decisions were not persisted for `run issue`, so no invented canonical count or connector distance is reported.

### `mstand`

**PASS / remains continuous.** Authority remains 40 raw -> 38 canonical, one segment, zero Gaps, canonical 251.613 m, Final 249.241 m. Ending stationary evidence remains held without false distance. No network geometry was accepted.

### `snap`

**PASS on the current live O50 replay.** Current replay: 392 canonical points / 843.202 m -> 97 Final points / 823.682 m, fingerprint `f4f38b0c`, whole-route validation accepted, zero small zigzags, and U-turn/repeated traversal preserved. It made eight Map Matching and three Directions requests. Current Final processing duration was 2,929 ms, with 2,887 ms aggregate request wall duration in that run.

The replay is network-dependent; request-level durations can vary. Geometry fingerprint and quality verdict remained stable.

## Scenario coverage

The fixed-policy and shared-engine gates cover straight movement, 30 s and two-minute stationary behavior, red light, Resume, background -> foreground, crossing, 90-degree turn, abrupt stop, U-turn, repeated route, Z/switchback, slow walk, fast Run, bicycle-speed proxy, true source loss, and true GPS reacquisition. Coverage comes from the real-GPS continuity fixtures, Activity contracts, lifecycle/ownership tests, stationary historical fixtures, O50 routing tests, incremental-route tests, simulator interruption/reacquisition tests, and the current real `snap` replay.

Results across those gates: no false stationary distance regression, no duplicate canonical point contract, no stale-owner admission, no unexpected segment explosion, and no false Gap in the repaired red-light case.

## Final Snap diagnostic

`great hike` and `mstand` had broadly similar reported hAcc, but did not have the same network outcome.

- `great hike` had 99 raw / 88 canonical points, mostly foreground evidence, temporal p50/p95/max of 1/6/9 s overall, and enough stable corridor/heading evidence for two walking-Directions refinements after Map Matching timeouts. O50 accepted one road-offset section.
- `mstand` had 40 raw / 38 canonical points, 106.25 of 110 active seconds in background, temporal p50/p95/max of 2/5.2/11 s, and very small canonical step spacing. O50 still formed candidates and issued one Map Matching plus two Directions requests, but all three timed out. It therefore accepted zero network sections and correctly returned canonical-derived geometry.

**Causal verdict:** the observed reason `mstand` did not Snap was network unavailability/timeouts. Sparse background evidence may affect how many independent network windows or heading observations are available, and the former 5 m policy reduced opportunity, but it is not the demonstrated cause here: the network calls were made and did not return usable responses. There is no evidence that conservative O50 quality gates rejected a successful response. Gates were not loosened.

No interpolation was promoted to production evidence. O52's 1 m background request will provide denser real evidence where iOS chooses to deliver it.

### GH-3 endpoint blend

No code change was applied. The artifact is about 2.24 m on an otherwise stable straight mapped roadside section. The local evidence is incomplete at the exact compositor transition, and changing generic endpoint anchoring could falsify endpoints, create seams, or steal a neighboring road in other routes. A safe local invariant was not proven strongly enough to justify touching O50 in this session. It remains a documented P2.

## Observability for the next field test

The next O52 Activity automatically produces bounded, privacy-safe aggregates for:

- Location: foreground/background elapsed time; raw callback counts; callback delta p50/p95/max; spatial delta p50/p95; foreground/background provider starts/stops; provider-overlap duration.
- Canonical: Accept, Candidate, Reject and stationary-suppress counts; canonical/raw totals; segment count; Gap count and reasons.
- Persistence: journal record and write-operation counts; logical and actual append bytes; repair/checkpoint count and bytes; total and max commit time.
- Map: live-route geometry build count; source update count; latest and cumulative approximate coordinate payload; projection rebuild flag; custom/idle presentation-provider active duration.
- Memory: evidence calls, mutations, deduplications and batch flushes; point/H3 persistence writes and bytes; network sync requests and attempted points.
- Lifecycle: Pause/Resume, foreground/background/inactive, foreground takeover/drain, provider registration/stop, restore timing checkpoints, Finish start/end and phase durations.
- O50: total Final duration; Map Matching/Directions request counts and results; API wall/aggregate duration; timeout/fallback/whole-route decision.

Ordinary high-frequency events are coalesced. Timing/spatial samples are bounded, exact real coordinates are stripped from upload, durable flush is sparse, and network upload is delta-based. Tracking continues if telemetry fails.

Manual field notes are still required for start/end battery, total duration, screen-on versus screen-off interval, device warmth, and responsiveness. No universal battery-percent-per-hour threshold was invented. No thermal API or native dependency was added solely for profiling.

## Verification

| Gate | Result |
| --- | --- |
| Focused WAL + telemetry contracts after final metric adjustment | 2 suites, 51 tests passed |
| `verify:activity:gps` | 300/300 tests passed across continuity, cadence, background, gaps, elevation, O50, telemetry, integration, Memory/server/static contracts |
| `verify:activity:core` | 32/33 suites passed; 375 assertions passed; only seven assertions in pre-existing `v409-offlineQueue.test.ts` failed because two test-only exports are absent |
| Baseline confirmation | the same offline-queue suite and seven failures existed before O52 edits; it is outside Activity tracking/efficiency scope |
| Scoped TypeScript/static checks | no O52 runtime-path diagnostics; GPS static contract 27/27 passed |
| Real `snap` O50 replay | PASS, stable fingerprint and whole-route verdict |
| Expo Web mobile QA | 36 screenshots, 34 layout checks, Hike Pause/Resume 2/2, Run 2/2, no runtime errors at 360/390/430 px and both themes |

The repository's Jest configuration continues to emit its pre-existing `setupFilesAfterFramework` warning. Neither that warning nor the unrelated offline-queue fixture was hidden or counted as an O52 pass.

## Freeze-gap review

### BLOCKER BEFORE NEXT FIELD TEST

None found in the O52 tracking/efficiency scope.

### NEEDS REAL-DEVICE MEASUREMENT

- Whether iOS delivers materially denser background evidence under the 1 m request, including batching/coalescing behavior.
- Real provider overlap duration and custom-provider puck/follow latency through foreground/background/Pause/Resume on device.
- Screen-on versus screen-off battery attribution, CPU, wakeups, memory, frame time, and device warmth.
- Physical journal commit latency distribution and storage behavior on representative hardware.
- Mapbox renderer/GPU suspension while the screen is off.
- Long-session O50 Finish memory/CPU peak.

These prevent **BATTERY ACCEPTED**, not the next field test.

### P2 / CAN DEFER

- GH-3 O50 straight-corridor endpoint/offset blend.
- Immutable public Memory point-array copy on each new 12.5 m cell.
- Further React isolation only if the next profile shows meaningful reconciliation cost.
- A true compass-heading source if a future heading puck/camera product requires it.

### OUT OF SCOPE PRODUCT UX

- `LIVE PACE` naming/semantics.
- Run Finish presentation.
- Quick Cairn feedback/enrichment and `Untitled Cairn` language.
- Plant/general Hike and Run UI polish.
- Foreground-return recenter product semantics beyond preserving current follow/manual-browse behavior.

## Freeze readiness

**READY FOR FINAL FIELD TEST.** Known avoidable architectural waste that confounded the energy audit has been removed without weakening tracking evidence. Tracking/efficiency can be frozen after the physical O52 field run confirms provider lifecycle, route quality, and acceptable device behavior. Battery itself is not accepted by this engineering session.

## OTA

- Native rebuild required: **no**. Installed Expo Location, Expo FileSystem, and RNMapbox native APIs already supply every used capability.
- OTA sufficient: **yes** for this JavaScript/TypeScript convergence.
- Published: **no**. Publication was intentionally not performed.

`O52 READY FOR PRECISION / ENERGY FIELD VALIDATION`
