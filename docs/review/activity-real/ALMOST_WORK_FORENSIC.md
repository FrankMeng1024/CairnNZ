# `almost work` — O41 real-Hike forensic

Date of analysis: 2026-09-09 (Asia/Shanghai)

Scope: read-only production data, retained native QA telemetry, current O41 source, and Git history

Product changes: none

## Status vocabulary

- **OBSERVED** — directly present in production data, retained telemetry, or the human report.
- **PROVEN** — the evidence identifies the responsible layer without a material competing explanation.
- **HYPOTHESIS** — plausible, but not established by the retained evidence.
- **INCONCLUSIVE** — required evidence was not retained or instrumented.

## 1. Identity

| Field | Value | Status |
|---|---|---|
| Server Activity/session ID | `2062` | **PROVEN** |
| `clientActivityId` | `3db88be5-4f0a-4fab-a5ae-a619c4ccfb59` | **PROVEN** |
| User | ID `72`, `frank` | **PROVEN** |
| Type/name | `hiking` / `almost work` | **PROVEN** |
| Start | `2026-09-09T13:41:54Z` (`21:41:54` Shanghai) | **PROVEN** |
| Finish/finalize | `2026-09-09T13:50:53Z` (`21:50:53` Shanghai) | **PROVEN** |
| Server row created | `2026-09-09T13:41:53Z` | **PROVEN** |
| QA session | `qa-mtu5a2gn-5mebni0q` | **PROVEN** |
| Distance | `644.893920898 m` | **PROVEN** |
| Duration | `527 s` | **PROVEN** |
| Elevation gain | `36.7613 m` | **PROVEN** |
| Pace | `13.62 min/km` | **PROVEN** |
| Segment count | `1` | **PROVEN** |
| Segment ID | `3db88be5-4f0a-4fab-a5ae-a619c4ccfb59:1788961313559:02b0d15e` | **PROVEN** |

The production session name, time window, client identity, user, and correlated telemetry make this identification unambiguous.

## 2. Evidence inventory

### Production Activity

| Boundary | Count | Meaning |
|---|---:|---|
| Server raw/audit route | 105 | Delivered samples retained for forensic truth, including samples later rejected from the Activity route |
| Canonically accepted Activity route | 42 | Reconstructed from retained `location_sample_accepted` and committed-point evidence |
| Server display route | 42 | Finish-derived route persisted as `route_points` |
| Rejected samples | 65 | Retained native rejection events |
| Pre-owner sample | 1 | Callback before an active owner was established |
| Non-monotonic sample | 1 | Delivered sample rejected before server raw serialization |
| Explicit gap/extra segment | 0 / 0 | Entire Activity remained one segment |
| Server Memory points within Activity window | 33 | Distinct raw accepted coordinates retained after Memory culling |

The arithmetic reconciles: 42 accepted + 65 filter-rejected = 107 canonical decisions; the 105 server raw rows exclude the one `before-owner` and one `non-monotonic` sample.

### Retained QA telemetry

The uploaded QA bundle contains 497 events (`338,200` bytes), uploaded at `2026-09-09T13:52:54Z`, with no cap/truncation marker. There are 331 target-correlated event records. Important counts:

| Event class | Records | Important aggregate/result |
|---|---:|---|
| Activity/source start | 1 / 6 | Foreground activation only |
| Canonical accepted / committed | 42 / 42 | All accepted evidence was committed |
| Canonical rejected | 65 | 52 `indoor-drift`, 10 `stationary`, 1 `poor-accuracy`, 1 `non-monotonic`, 1 `before-owner` |
| Journal timing / store publish | 42 / 42 | Durable journal precedes store publication |
| Memory recording | 42 | Called for every accepted sample |
| React trace state | 29 | Screen-mounted trace observations, not every store mutation |
| Foreground source callbacks | 7 aggregate snapshots | Aggregate counters reach 107 total callbacks |
| Mapbox `UserLocation.onUpdate` | 4 aggregate snapshots | Aggregate counter reaches 8,962; includes native/animated duplicate updates |
| App background transitions | 8 | Four active→inactive→background passages |
| App foreground transitions | 4 | Four resumptions |
| Background source activation/callback/error | 0 / 0 / 0 | No background provider was registered |
| Finish/save timings | 1 / 7 | Full local→server timing retained |
| Match request/result events | 0 | Matching was not invoked |

The Mapbox total must not be interpreted as 8,962 independent GPS fixes. It does establish that the puck has a separate, much more frequently updated Mapbox-native authority.

## 3. Current event path

For this Activity, the realized path was:

```text
Core Location foreground watcher
  → Expo callback (~4 s typical)
  → canonical sample
  → audit/raw append
  → canonical filter
      accepted: 42
      rejected: 65
  → durable journal append
  → tracking-store publication
  → live accepted polyline + incremental Memory

Mapbox native UserLocation
  → current-location puck (separate authority)

App backgrounds
  → foreground watcher stops
  → background activation returns without registering a provider
  → no callbacks and no points
  → foreground watcher restarts
  → next accepted point remains in the same segment

Finish
  → reconcile immutable Activity snapshot
  → matching skipped
  → Kalman-smoothed server display payload
  → local durable pending Activity
  → server save/ack
  → Activity Detail
```

## 4. Foreground latency

### Measured cadence and latency

| Measurement | N | Median | p95 | Max | Status |
|---|---:|---:|---:|---:|---|
| Retained foreground callback intervals | 72 | 4,000 ms | 6,756 ms | 9,000 ms | **OBSERVED**; telemetry retention is partial |
| Full server-raw intervals | 104 | 4,000 ms | 9,000 ms | 37,146 ms | **OBSERVED**; maximum includes background absence |
| Accepted-point intervals | 41 | 13,000 ms | 24,298 ms | 37,146 ms | **PROVEN** |
| Native sample → store publication | 42 | 118 ms | 1,952 ms | 3,457 ms | **PROVEN** |
| Canonical ingest queue | 42 | 0 ms | 1 ms | 1 ms | **PROVEN** |
| Durable journal append | 42 | 23 ms | 30 ms | 38 ms | **PROVEN** |
| Journal completion → store publish | 42 | 0 ms | 1 ms | 1 ms | **PROVEN** |
| Native sample → mounted React trace observation | 29 | 123 ms | 137 ms | 14,029 ms | **OBSERVED** |
| Store publication → React trace observation | 29 | ~5 ms | ~7 ms | ~14,002 ms | **OBSERVED** |
| Store/React → Mapbox ShapeSource render | — | — | — | — | **INCONCLUSIVE**; not instrumented |

The isolated 14-second React observation occurred while the relevant screen was absent/unmounted and then remounted. It does not characterize ordinary mounted trace latency. Ordinary accepted-point publication and React observation are fast.

### First divergence

**PROVEN:** the first material divergence is the canonical acceptance filter, not journaling, store publication, or ordinary React propagation.

The puck is rendered by Mapbox's native `UserLocation`. The Activity line is rendered from canonical `trackPoints`. Foreground callbacks arrived at a typical four-second cadence, while accepted points arrived every 13 seconds at the median and 24.3 seconds at p95. Of 107 canonical decisions, 65 were rejected; 52 were rejected as `indoor-drift`.

The current indoor-drift rule applies when reported horizontal accuracy is absent or worse than 12 m, displacement from the last accepted point is below 15 m, and accepted-point age is below 30 seconds. It does so even when reported speed is consistent with walking. In the end portion of this Activity, speeds around 1.1–2.0 m/s were rejected until displacement accumulated past the 15 m threshold:

```text
13:49:49  accepted
13:49:53  indoor-drift rejected
13:49:59  indoor-drift rejected
13:50:03  accepted
13:50:07  indoor-drift rejected
13:50:11  indoor-drift rejected
13:50:15  accepted
13:50:19  indoor-drift rejected
13:50:24  indoor-drift rejected
13:50:29  accepted (last accepted)
13:50:33  indoor-drift rejected
13:50:38  indoor-drift rejected (last delivered raw point)
```

**Answer:** the user's puck appears ahead because it follows a fresh native Mapbox stream, while the route waits for sparse canonical acceptance. The journal adds about 23 ms, and the store/React path ordinarily adds only single-digit milliseconds after the journal. Mapbox's exact final paint latency remains unmeasured, but it occurs after a much larger, already-proven acceptance delay.

## 5. Background intervals and loss layer

### AppState windows

| Background start | Foreground return | Duration |
|---|---|---:|
| 13:43:49.894Z | 13:44:23.072Z | 33.178 s |
| 13:44:31.055Z | 13:44:49.793Z | 18.738 s |
| 13:45:27.902Z | 13:45:32.144Z | 4.242 s |
| 13:46:25.004Z | 13:46:47.210Z | 22.206 s |
| **Total** | | **78.364 s** |

There are foreground provider activations at Activity start, dynamic configuration changes, and foreground re-entry. There is no background activation, callback, acceptance, rejection, or source-error event.

Current source has only two silent early-return conditions before a background activation can be logged: the Expo Location module is unavailable, or cached background authorization is false. The successful foreground watcher proves Location was available. Therefore:

**PROVEN:** cached background authorization was false, so O41 stopped foreground tracking and did not register its background provider. iOS never had a CairnNZ background tracking request from which to deliver these samples. This is not “delivered but rejected,” “accepted but unpersisted,” or “persisted but unrestored.” It is loss at provider registration/authorization.

Classification for this Activity: **A — not delivered to the client because the background provider was not active**, with the more precise cause “cached authorization unavailable,” not an unexplained iOS callback failure.

**INCONCLUSIVE:** the retained real O41 evidence does not establish how well the current background provider performs when `Always` permission is actually granted; recent retained real sessions likewise do not contain background callback evidence.

Current native configuration includes the required background mode and permission descriptions. Expo documents that iOS background location requires `Always` permission and that background updates stop if the user terminates the app. Apple documents the corresponding `allowsBackgroundLocationUpdates` and pause controls. The repository's foreground→background handoff is therefore permission-dependent by design.[^expo-location] [^apple-background]

## 6. Straight connector

The largest adjacent accepted/raw interval is:

- from approximately `13:43:46Z` to `13:44:23Z`;
- `37.146 s` temporal separation;
- `57.04 m` spatial separation;
- exactly aligned with the first background interval;
- both endpoints carry the same segment ID.

Other material same-segment gaps include `24.298 s / 16.10 m` and `20.502 s / 17.07 m`.

O41 creates a new segment for a known-loss signal, an implausible-speed recovery after uncertainty, or a long uncertain interval. The legacy fallback also requires both more than 120 seconds and more than 200 m. This 37-second/57 m interval met none of those persisted segment conditions. AppState telemetry knew that the app had backgrounded without a background provider, but that lifecycle knowledge was not converted into a route gap.

**PROVEN:** the connector is a normal polyline edge between two accepted points in the same segment after intermediate evidence was never captured. It is not an explicit gap rendered incorrectly, not a matching bridge, and not an Activity Detail fallback artifact. The system knew at the telemetry/lifecycle layer that recording continuity was unavailable, but the Activity geometry did not encode that fact.

## 7. Geometry and endpoint analysis

### Length and deviation

| Geometry | Points | Length |
|---|---:|---:|
| Server raw/audit | 105 | 789.754 m |
| Canonical accepted | 42 | 644.894 m |
| Saved display | 42 | 509.428 m |

Saved-display length is 78.99% of accepted length. Nearest-path accepted→saved-display deviation is p50 `4.642 m`, p95 `25.089 m`, maximum `48.545 m`. Same-index accepted→display displacement is median `33.735 m`, p95 `57.426 m`, maximum `85.104 m`; same-index comparison is descriptive because filtering changes geometry progress.

### Head and tail

- First canonical accepted point and first display point are identical: `31.230614880855853, 121.42404070706522`.
- Last canonical accepted point at `13:50:29Z`: `31.231544643968803, 121.42928316798924`.
- Saved display endpoint at the same timestamp: `31.231796854657834, 121.42886711875528`.
- Kalman/display displacement of that accepted endpoint: `48.491 m`.
- Final raw sample at `13:50:38Z`: `31.23145125446383, 121.429343443964`.
- Two raw samples totaling `11.861 m` of observed tail arrived after the last accepted point and were rejected as `indoor-drift`.
- Saved endpoint displacement from the final delivered raw point: `59.396 m`.

### Was Snap-to-road responsible?

No. The retained save timing records `map_matching` duration `0 ms` and `matched=false`; no matching request/result event exists. The matching branch only runs when `EXPO_PUBLIC_MAPBOX_TOKEN` is non-empty. If entered, it assigns a route even on raw fallback and records `matched=true`. The Activity qualified by length and point count. Therefore:

**PROVEN:** the current JavaScript matcher had no token authority in this runtime and was skipped. The native Mapbox map could still render because native binary token initialization is a separate authority and current initialization deliberately does not clear an already configured native token when the JavaScript environment value is absent.

The server display route came from the finish-time `trackPointsSmoothed` fallback. The start happened to remain fixed, while the Kalman output moved the last accepted endpoint almost 48.5 m. Two later delivered points were not eligible because the canonical filter rejected them.

Answers for `almost work`:

1. **Did matching drop trailing raw points?** **PROVEN NO:** matching did not execute. Canonical filtering omitted the final two samples.
2. **Did the matching request omit them?** **PROVEN N/A:** no request was made.
3. **Did chunking lose them?** **PROVEN NO:** no chunking ran.
4. **Did quality fallback trim them?** **PROVEN NO:** the matcher/fallback path did not run.
5. **Did display geometry omit/move them?** **PROVEN YES:** it excluded two rejected tail samples and moved the last accepted point through smoothing.
6. **Would first/last accepted anchors help?** **PROVEN for this example:** anchoring canonical accepted endpoints would prevent this finish-derived displacement. It would not recover samples that canonical filtering rejected.
7. **Risks of literal locking:** a low-quality building/parking fix, large accuracy ellipse, explicit gap boundary, intentional privacy transform, or legitimately offset trail entrance can make a hard anchor visually wrong. The correct unit is the first/last trustworthy accepted point per continuous segment, with an accuracy/deviation gate and raw fallback—not an arbitrary audit sample forced onto a matched path.

## 8. Live versus saved Detail

During tracking, `HikingMap` uses canonical accepted `trackPoints`. At local completion, `useSessionStore.addSession` also retains `snappedTrackPoints ?? trackPoints`; for this no-match Activity, the immediate in-memory Detail should therefore initially receive canonical accepted points. The server payload, however, uses `snappedTrackPoints ?? trackPointsSmoothed`; production row 2062 consequently holds the Kalman display route.

`MapHistoryScreen` returns early to an in-memory route when it exists. After hydration/restart/cross-device access—when local summaries no longer contain points—it is explicitly server-authoritative and fetches `route_points`. Thus O41 has two different no-match display authorities:

```text
immediate local Detail: canonical accepted route
later/server Detail:     finish-time Kalman route
```

**PROVEN:** O41 can change shape without any successful Snap-to-road request because local completion and the server payload use different fallback routes. For Activities where matching does run, both the saved local route and server payload use the matched derivative and can change immediately at Save. The human's broader observation is therefore architecturally valid; the precise first-frame route they saw for `almost work` is **INCONCLUSIVE** because no post-navigation render-source event was retained.

## 9. Memory evidence

The accepted pipeline attempted Memory recording 42 times, once per accepted point. The server has 33 distinct Memory rows in the Activity window after the Memory store's 12.5 m proximity cull. Every one corresponds to a canonical accepted timestamp/coordinate, with numerical coordinate deviation below practical GPS precision. The first and last Memory evidence points equal the canonical accepted start/end.

**PROVEN:** Memory for this Activity came from accepted GPS evidence during the Activity, not from the finish-time smoothed route and not from matching. It contains no explicit connector geometry. Its visual roughness follows from sparse, uneven accepted-point spacing plus point/cell footprint rendering, not from the saved display line.

**OBSERVED:** the current flat Memory record does not persist Activity/segment adjacency metadata. That prevents a renderer from safely distinguishing “adjacent in one proven continuous segment” from “nearby but separate Activities/gaps” after synchronization.

## 10. Finish and Save timing

| Stage | Stage duration | Cumulative | Result |
|---|---:|---:|---|
| Finish reconciliation | 40 ms | 40 ms | 42 accepted / 105 raw |
| Map matching | 0 ms | 41 ms | `matched=false` |
| Memory reconciliation | 11 ms | 52 ms | 42 input, 0 new after incremental writes |
| Payload serialization | 0 ms | 52 ms | 42 display, 105 raw, 0 unsynced Memory |
| Durable local completion | 52 ms | 104 ms | Pending Activity and recovery state committed |
| Server save request | 59 ms | 164 ms | Acknowledged |
| Server acknowledgement persistence | 17 ms | 181 ms | Synced identity persisted |
| Hiking surface unmount/navigation vicinity | — | ~225 ms | No explicit Detail-mounted timing retained |

**PROVEN:** `almost work` saved quickly because the matcher was skipped, local work was small, and the server acknowledged promptly. This Activity cannot establish that a matching quality optimization caused a regression.

For comparison, retained O38 session `2053` matched 277 accepted points to 53 display points in approximately `513 ms`; the entire recorded completion/ack path finished in approximately `890 ms`. High-quality matching is therefore not inherently a 20-second blocker for every Activity. Old reports of roughly 20 seconds are compatible with the historical 60-second matcher and 20-second network bounds, but no historical stage telemetry remains to attribute that delay exactly.

## 11. Matching comparison baselines

These metrics compare server raw/audit geometry to server display geometry. They are useful warnings, not perfect matcher-quality scores, because raw geometry includes rejected audit evidence and old sessions do not retain a canonical accepted series separately.

| Session | Era/type | Raw/display points | Nearest-path p50 / p95 / max | Display/raw length | Head / tail displacement |
|---|---|---:|---:|---:|---:|
| `192` `v406-real-snap-verified` | Older real | 154 / 50 | 24.220 / 70.121 / 79.527 m | 1.1414 | 10.512 / 0.385 m |
| `193` `v406-KL-real-snap-verified` | Older real | 89 / 96 | 2.796 / 11.468 / 16.428 m | 1.0031 | 4.608 / 7.066 m |
| `2053` | Current simulated | 371 / 53 | 0.036 / 6.951 / 12.274 m | 0.9364 | 0.371 / 0.578 m |
| `2059` | Current problematic real | 48 / 20 | 8.506 / 27.658 / 44.515 m | 0.5913 | 0 / 44.465 m |
| `2062` `almost work` | Current real, no match | 105 / 42 | 4.642 / 25.089 / 48.545 m | 0.6449* | 0 / 59.396 m** |

\* `2062` display/raw ratio; display/canonical-accepted ratio is `0.7899`.

\** Versus final delivered raw sample; displacement versus last canonical accepted point is `48.491 m`.

**PROVEN:** older matching quality was not uniformly superior—session 193 is credible, session 192 is not. The old runtime did, however, have working JavaScript match authority in those examples and submitted a more permissive whole-track input. O41's current failure mode is worse in a different way: matching can silently be unavailable, and the no-match server fallback can move an endpoint substantially.

## 12. Root-cause answers

| Question | Answer |
|---|---|
| Why does the live trace lag? | **PROVEN:** accepted-point filtering, especially the accuracy/15 m/30 s indoor-drift rule, makes the route much sparser than the native Mapbox puck. Downstream journal/store latency is small. Exact final Mapbox line paint latency is **INCONCLUSIVE** but is not the first divergence. |
| Why is background evidence lost? | **PROVEN:** cached background authorization was false, so no background provider was registered. Performance with `Always` granted is **INCONCLUSIVE** from retained current real evidence. |
| Why can a straight connector appear? | **PROVEN:** the 37.1 s/57.0 m background interval remained one segment, so normal polyline rendering connected its accepted endpoints. |
| Why can Detail differ from live? | **PROVEN:** finish has a separate derived display path, and O41 even has different local versus server no-match fallbacks. For this Activity, no matcher ran; server Detail geometry is Kalman-smoothed. |
| Is Snap-to-road losing the tail here? | **PROVEN NO:** it never ran. Filtering removed two tail samples and smoothing moved the final accepted endpoint. |
| Is Memory raw and incremental? | **PROVEN YES:** each accepted sample attempted Memory creation during tracking; server Memory rows match accepted coordinates. |
| Was Save quality traded directly for speed here? | **INCONCLUSIVE/unsupported:** Save was fast principally because matching was unavailable, not because a measured matcher optimization degraded output. |

## 13. Evidence limitations

- There is no retained per-frame ShapeSource commit/Mapbox paint timestamp; final renderer latency cannot be quantified.
- Aggregate callback snapshots are bounded QA telemetry, not an exhaustive native event log. The server raw series supplies the complete persisted callback cadence for this Activity.
- No real current session with an actually activated O41 background provider was found in the recent retained window. Code and tests describe that path, but do not replace field evidence.
- Old sessions lack a separately stored canonical accepted series, so raw→matched comparison includes audit/rejected noise.
- No post-navigation Detail render-source event identifies exactly which first route the human saw.

## 14. Read-only provenance

The analysis used:

1. Production database `SELECT` queries for session `2062`, its raw/display routes, Memory rows, and QA events. No writes or production mutations were issued.
2. Current source at local O41 commit `dac817a4d79756b33a313ded747326f897b3b945`.
3. Current key files: `app/src/store/useTrackingStore.ts`, `app/src/features/activity/locationProvider.ts`, `app/src/services/hikeTrackWriter.ts`, `app/src/screens/HikingMap.tsx`, `app/src/screens/MapHistoryScreen.tsx`, `app/src/store/useMemoryStore.ts`, `app/src/services/mapMatching.ts`, and the atomic session-save backend path.
4. Production comparison sessions `192`, `193`, `2053`, and `2059`.
5. Official platform documentation for background-location requirements and behavior.

[^expo-location]: [Expo Location documentation](https://docs.expo.dev/versions/latest/sdk/location/)
[^apple-background]: [Apple — Handling location updates in the background](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background?changes=latest_maj_8__2&language=objc), [`allowsBackgroundLocationUpdates`](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates?changes=_1_6), and [`pausesLocationUpdatesAutomatically`](https://developer.apple.com/documentation/corelocation/cllocationmanager/pauseslocationupdatesautomatically)
