# OTA55 calibrated dual-mode GPS Simulator

Date: 2026-09-13  
Candidate: **OTA55**

## Outcome

Activity Simulator now exposes two explicit observation modes with one shared intent/path generator:

```text
joystick / Auto Move / exact waypoint intent
                    ↓
          ground-truth position
                    ↓
        ┌───────────┴───────────┐
        ↓                       ↓
Clean Path observation    Realistic GPS model
        ↓                       ↓
        └──── Activity source adapter ────┐
                                          ↓
                 ownership + continuity + Canonical
                         ↓             ↓
                       Live         Finish/Final
```

Clean Path preserves the established deterministic contract. Raw GPS treats joystick/target movement as the simulated human's truth, generates noisy observed fixes, and sends only those fixes into Activity. Ground truth is retained solely for Debug comparison.

## Existing Clean Path

`Clean Path` remains the default for backward compatibility and deterministic QA:

- intended position is the emitted observation;
- arrival is exact;
- joystick release or a stopped waypoint freezes the observed position exactly;
- no random drift, cadence skip, or outlier is introduced;
- true Z, U-turn, switchback, corner, crossing, and exact-distance tests remain reproducible;
- the existing 1–120× accelerated virtual clock behavior remains available;
- the normal Activity adapter, lifecycle, journal, Memory, Finish, and sync contracts remain unchanged.

A Clean Path true-Z fixture retains all four exact structural vertices and `107.535 m` of path through Canonical and Live; Base Final densifies it to ten display points without changing length or erasing the Z.

## New Raw GPS

`Raw GPS` uses the `Realistic GPS` default profile calibrated in [O55_REAL_VS_SIM_GPS_CALIBRATION.md](./O55_REAL_VS_SIM_GPS_CALIBRATION.md). It combines:

- slowly changing two-dimensional bias;
- separate moving/stationary bias variance and mean-reversion time;
- smaller autoregressive jitter;
- gradual bias drift and correction;
- rare ordinary and severe outlier events with decaying recovery tails;
- hAcc that broadly follows current error while remaining imperfect;
- realistic zero/unknown/occasionally noisy scalar speed semantics;
- irregular but bounded healthy cadence;
- explicit Poor, Frozen, and Lost source behavior.

It is not `lat += random()` white noise, and no activity, route, or coordinate has a special profile.

## Ground truth architecture

The store's `current` coordinate is the exact intended/ground-truth person position. Joystick and waypoint code update that state using the existing deterministic spherical geodesy. The observation model receives truth, true movement speed/course, virtual timestamp, source condition, and a persisted model state; it returns either a due Raw fix or no healthy callback on that virtual substep.

Raw mode never exposes `current` as trusted location. The emitted coordinate, hAcc, scalar speed, and course pass through the existing simulator provider lease. The store keeps bounded `groundTruthTrail` and `rawGpsTrail` diagnostic arrays (512 points each) plus the most recent error/bias metadata. These debug arrays never enter metrics, Memory, or Final.

The generator/observation split keeps Clean Path reusable for future Route drawing, planned-path creation, manual editing, and correction tools without importing sensor uncertainty into those products.

## Observation model

The model is a seeded state machine, not per-fix independent noise. Each one-second virtual substep advances:

1. a bounded Ornstein–Uhlenbeck-style east/north bias;
2. autoregressive short jitter;
3. exponential outlier-tail decay;
4. movement/stop transition age and retained prior bias;
5. due-fix cadence;
6. observed coordinate and metadata.

Large drift mean-reverts rather than wandering forever. A Frozen signal retains the last raw observation while truth may continue; Lost suppresses observations entirely while truth may continue. Poor increases both uncertainty and timing gaps. Restoring a lost source immediately becomes eligible to emit again and normal continuity decides whether a Gap begins.

## Seed behavior

- same path + same timing + same seed → identical Raw sequence;
- a different seed → a different plausible sequence;
- seed is persisted per QA user and included in every Simulator log event;
- seed and mode may change only before binding an Activity;
- changing mode/seed clears old diagnostic/model state rather than mixing processes;
- interactive sessions default to seed `1`; QA fixtures use named stable seeds such as `550055`.

The PRNG is local xorshift32 with Box–Muller normal draws. It has no security role.

## Timing

Clean Path retains the existing 10-second maximum virtual sample slices and scales through 120×. Raw GPS advances its model at one-second virtual substeps and is capped at 10×, with at most 12 substeps in one wall tick. It emits only when its calibrated cadence says a fix is due. This preserves bias/cadence dynamics and prevents hundreds of callbacks per second.

Default Raw cadence has a 1 s mode, bounded timing jitter, common delayed intervals, and rare longer intervals. Source Lost is the only ordinary control that deliberately creates complete callback silence; a stationary person continues to produce Raw fixes.

## hAcc and other location fields

Raw hAcc is bounded to 3.5–65 m and combines a central baseline, current error magnitude, outlier-tail magnitude, and an independent positive perturbation. Poor mode widens it. This creates broad correlation without falsely reporting every bad point as 3 m accurate.

Timestamp, speed, course, altitude, and source provenance use the existing normalized Activity coordinate shape. Altitude remains the existing debug terrain model. Scalar speed/course help exercise normalization and continuity but are not the sole Live Pace authority; O54 Live Pace remains recent accepted movement.

## Debug UI

Before Activity Start the compact `SIM MODE` selector shows:

```text
Clean Path | Raw GPS
```

Raw selection explicitly displays `Realistic GPS · seed …`; Clean shows `Exact deterministic position`. During an Activity, the collapsed control reads `SIM · RAW GPS` or `SIM · CLEAN`, and the expanded header includes `RAW GPS · REALISTIC` plus seed, speed, and scale. Both mode buttons are locked while bound so no Activity can mix observation semantics.

The existing panel remains compact. Advanced controls expose seed before Start, while manual accuracy remains Clean-only. Raw hAcc is model-owned, and the existing GPS Poor control provides bounded degradation without a settings console.

## Overlays

`Product | Diagnostic` is available only in Debug Simulator UI. Product view is the normal Cairn screen. Diagnostic view may render:

- a thin dashed blue ground-truth trail;
- small translucent orange Raw GPS fixes;
- the normal green/blue processed Live route already rendered by Activity.

The bounded overlay child is mounted only for a Simulator-owned Activity. Its
trail updates remain isolated from the parent map, and it returns no map layers
unless Raw Diagnostic view is active. Hidden overlays do not affect real
tracking. Canonical remains available through diagnostics/export rather than
adding another permanent map layer.

## Source ownership

The O54 single Activity location authority remains the hard boundary:

- source is selected before the Activity lease binds;
- Simulator Start fences/stops real foreground and background Activity sources;
- every synthetic callback carries `clientActivityId` and owner generation;
- a late Apple/background callback is rejected by provider-source mismatch;
- Raw and Clean use the same simulator adapter/sink;
- mode cannot change while the lease exists;
- Finish/Discard releases Simulator ownership; the next real Activity selects and starts the real provider normally.

There is no Raw-only tracking store or fake canonical implementation.

## Activity pipeline integration

Clean Path retains the legacy exact simulator acceptance path so its purpose does not change. Raw GPS is explicitly marked `simulatorObservationMode='raw-gps'` and enters the same physical-continuity classifier used for live device observations: source freshness, raw audit, Accept/Candidate/Reject/Refine, segment/Gaps, then the existing canonical journal/metrics/Memory boundary. Existing simulator accuracy, overspeed, stationary, indoor-drift, ownership, and teleport gates remain downstream.

This is the nearest safe common normalized source boundary in the current architecture. Raw fixes do not call Canonical, Live, pace, Final, or Memory directly. Real GPS follows exactly the previous branches when Simulator is inactive.

Each diagnostic event includes `simulatorMode` and `simulatorSeed`, and Raw observation events carry calibrated cadence/provenance. Simulated QA evidence can therefore be separated from real field sessions during later forensic work even though the public saved Activity schema remains unchanged.

## O54 integration

The automated Raw scenarios exercise the current O54 owners rather than copies:

- stationary fixes update source freshness and do not become false Signal Lost;
- complete source silence degrades separately and recovers as a new segment;
- Pause/Resume uses the real single-flight lifecycle and resets segment/pace evidence;
- Finish/Cancel remains transactional for Recording and Paused;
- Finish remains available during source loss and recovery;
- Raw display selects O54 causal `trackPointsSmoothed`; Clean continues to show exact canonical geometry;
- Base Final stays offline and segment-local;
- Live Pace consumes accepted movement, not Raw scalar speed or cumulative average.

The explicit O54/O55 regression run passed 28 suites/420 tests. The diff router additionally exposed the unchanged repository baseline failure in `v409-offlineQueue.test.ts`, where tests call already-removed `readQueueSnapshot` and `clearQueue` exports. It is not a simulator or Activity failure and was not retried or hidden.

## Automated scenarios

| Scenario | Result through current pipeline |
|---|---|
| move → stop 120 s → move | 91 Raw / 27 Canonical / 7 Live / 18 Base Final; Raw bias survives restart |
| straight | 397.6 m Raw becomes 290.1 m Live and 290.9 m Base Final for 288 m truth |
| gentle bend | meaningful bend retained; 7 Live and 21 Base Final display points |
| 90° corner | corner retained; no topology shortcut |
| GPS-created small Z | straight truth; Raw chatter reduced to 7 Live / 21 densified Final points with ≤2.8 m lateral display residual |
| true Z in Clean | exact 107.535 m intent retained through Final |
| stationary 180 s | 173.7 m Raw wander becomes 0 m Canonical/Live/Final credited route |
| temporary degradation | 7 poor-hAcc fixes rejected; later normal observations recover |
| forced 120 m outlier | 7 poor fixes rejected; product display excursion bounded to about 12.2 m |
| source silence 141 s | zero fixes during silence; two Raw/Canonical/Live/Final segments; no connector |
| controlled pace | startup/stop unavailable; walk/run/slow/resume values rebuild from recent evidence |

The visual board intentionally overlays truth, Raw, Canonical, Live, and Base Final so remaining product behavior can be judged rather than concealed. On the straight and small-Z fixtures Live is already close to consumer-clean, so offline Base Final is visually similar/densified rather than dramatically different. That is a useful O54 observation, not a reason to distort the Simulator; network-supported Final can be assessed separately on a real mapped corridor.

## Live and Final QA

The instrument makes three truths simultaneously inspectable:

- Raw is visibly imperfect and can contain a stationary cloud, lateral wobble, poor interval, or outlier;
- Live is the causal route actually shown during Activity;
- Final is the one-time local/network consumer geometry used by Detail.

The evaluator runs the current continuity, causal Live, and Base Final modules. Mapbox is not faked: interactive Raw GPS sessions may invoke the normal bounded network Final only when the real token/network/corridor permits it. True source-loss segments remain separate and are drawn as separate lines on the board.

## Run Pace QA

Controlled truth phases are stationary start → 1.4 m/s walk → 2.6 m/s slow run → 3.5 m/s fast run → 2.0 m/s slowing → stop → 2.8 m/s resume. Current checkpoints are:

| Phase | Truth | O54 Live Pace |
|---|---:|---:|
| stationary startup | unavailable | `--` / stale |
| walk | 714.3 s/km | 707.9 s/km |
| slow run | 384.6 s/km | 364.3 s/km |
| fast run | 285.7 s/km | 279.6 s/km |
| slowing | 500.0 s/km | 432.9 s/km (bounded recent-window lag) |
| stop | unavailable | `--` / stale |
| resumed run | 357.1 s/km | 373.3 s/km |

The pace window responds without using perfect truth or Raw scalar speed. Average pace remains the independent active-time/canonical-distance calculation protected by O54 tests.

## Offline

Raw model, source adapter, Canonical, Live, Base Final, lifecycle, and local Finish require no network. Lost, Poor, Frozen, Pause/Resume, ground-truth/raw diagnostics, and seed replay work offline. Map tiles/Directions/Enhanced Final retain their ordinary optional network behavior; a missing token never blocks local Finish or Base Detail.

## Performance and energy

- realistic default cadence, not frame cadence or hundreds of fixes per second;
- 10× Raw cap and 12-substep burst limit;
- two bounded 512-point debug arrays;
- bounded map overlay child exists only for Simulator ownership and creates no layers outside Raw Diagnostic view;
- no extra Apple/Core Location provider and no native callback-policy change;
- no production hot-path work when Simulator is inactive.

Unit/Expo performance is suitable for indoor QA. Real device thermal/battery impact still requires physical observation, especially with Diagnostic view left visible.

## Future Route-drawing compatibility

Path intent is still deterministic, exact, and independent of observation. A future Route/manual drawing feature can reuse joystick, waypoint, geodesy, and Clean observation without depending on the Raw error state or Activity acceptance. Raw GPS remains a detachable consumer of truth, not the owner of path creation.

## Expo Web visual validation

The existing long-lived Activity Simulator capture was extended and run through the actual Expo Web app at `390×844` with `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true`:

- six mobile captures and one board;
- Clean/Raw pre-start selection visible;
- Raw Realistic label/seed visible;
- Product/Diagnostic controls reachable;
- mode locked during Activity;
- Raw 120× disabled and 10× usable;
- Settings toggle independent of Debug;
- Debug off hides all simulator UI;
- zero captured runtime errors.

## Production isolation

Real location behavior is unchanged when Simulator is inactive. Capability, hidden Debug Mode, explicit Simulator toggle, Activity provider lease, owner generation, and mode lock must all agree before a synthetic fix can enter Activity. The production native build profile continues to compile with Simulator capability false; internal development/preview profiles compile it true.

No native dependency, entitlement, permission, Info.plist, TaskManager registration, app version, runtime version, or build number changed for OTA55. No backend change is required and no backend should be deployed.

## Deployment and publication

OTA55 was published to the iOS `production` update branch on
`2026-09-13T14:35:15.402Z`, after the O55 marker advanced exactly once. The
bundle used the `production` EAS environment so the established Mapbox public
input remained present, while the command explicitly enabled the internal
Simulator capability required by this QA instrument. Runtime compatibility is
unchanged at `0.2.6`.

- update group: `b4f426e2-4ddf-482c-9df2-4789cc8cd89b`;
- iOS update: `01a09b31-9e4a-713d-b6ad-3ebaae45a2fa`;
- branch read-back: OTA55 is newest, immediately ahead of O54;
- native rebuild: not required;
- backend deploy: not performed or required;
- production data mutation: none.

This OTA intentionally bundles Simulator code for the user's device, but it
still requires hidden Debug Mode plus the explicit Activity Simulator setting
before selection. The source lease and provider mismatch fence remain the
final isolation boundary.

## Real-world limitations

Indoor Raw simulation does not prove iOS Core Location suspension, genuine native callback batching, physical background execution, process pressure, low-power GNSS, radio multipath, thermal/battery behavior, or device antenna performance. Simulator lifecycle participation can test much of the JavaScript foreground/background state machine, but the final outdoor/background validation remains mandatory.

## Artifact paths

- calibration report: `docs/review/activity-sim/O55_REAL_VS_SIM_GPS_CALIBRATION.md`
- implementation report: `docs/review/activity-sim/O55_DUAL_MODE_GPS_SIMULATOR.md`
- evaluator: `app/scripts/evaluate-o55-gps-simulator.mjs`
- real aggregates: `app/_review/o55-gps-sim/O55_REAL_FIELD_METRICS.json`
- comparison metrics: `app/_review/o55-gps-sim/O55_REAL_VS_SIM_METRICS.json`
- stationary sequence: `app/_review/o55-gps-sim/O55_STATIONARY_SEQUENCE.json`
- move/stop/move sequence: `app/_review/o55-gps-sim/O55_MOVE_STOP_MOVE_SEQUENCE.json`
- straight comparison: `app/_review/o55-gps-sim/O55_STRAIGHT_PATH_GEOMETRY.json`
- small-Z comparison: `app/_review/o55-gps-sim/O55_SMALL_Z_NOISE_COMPARISON.json`
- Live/Final comparison: `app/_review/o55-gps-sim/O55_LIVE_VS_FINAL_COMPARISON.json`
- scenario board: `app/_review/o55-gps-sim/O55_GPS_SIMULATOR_BOARD.png`
- Expo Web evidence: `app/_review/o55-gps-sim/expo-web/runtime-evidence.json`
- Expo Web board: `app/_review/o55-gps-sim/expo-web/activity-simulator-runtime-board.jpg`
- OTA publication receipt: `docs/review/activity-sim/O55_OTA_PUBLICATION.json`
