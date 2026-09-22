# Final Activity Simulator native forensic

Date: 2026-09-08

Status: written from production O36 iPhone telemetry and repository evidence before substantive O37 implementation.

## Evidence boundary

The production operations-only telemetry retrieval procedure in `QA_TELEMETRY.md` returned three recent QA rows. One was the reviewed production smoke (`qa-smoke-o36-1788868093937`). The two physical-iPhone sessions relevant to this forensic are:

- `qa-mtsmovfy-43c9lqeb`: iOS 26.6.1, five Debug transitions from 12:11:02Z through 12:12:02Z.
- `qa-mtsmpawf-lc911f5m`: iOS 26.6.1, 711 retained events / 522,308 bytes from 12:13:38Z through 12:19:42Z.

The larger row is at the 512 KiB client bound and begins at Simulator sequence 18 during an already-tracking Hike. It does not contain the Activity Start or first 17 samples. Conclusions about the omitted transition are therefore not claimed as telemetry-proven. Human O36 observations remain authoritative for visible behavior.

## O36 lifecycle reconstruction

### Hike first entry

Classification: **UNKNOWN in retained telemetry**.

The human observed a rendered map and the intended globe-to-current-location journey. Neither physical-device row retains `hike_opened`, mount, style, idle, or camera events for that first normal entry. The five-event row records only Debug transitions. The O36 client contract still deliberately sends the ordinary idle Hike through Mapbox default camera + real `UserLocation`, so the observation and source agree, but the native callback chain is not present in server retention.

### Hike second entry

Classification: **PROVEN readiness divergence; visible persistence beyond the bound remains UNKNOWN**.

At 12:16:30.288Z, while a Simulator Hike was still tracking, the retained trace records `hike_opened`. At +146 ms it records `hike_map_style_loaded` with `cameraRefAvailable=true`. Five `hike_map_loading_error` events follow between +276 ms and +563 ms. No `hike_map_loaded`, `hike_map_idle`, or fully-rendered event follows. `hike_map_readiness_timeout` fires at +8.003 s, and three further loading errors arrive roughly ten seconds later.

The installed `@rnmapbox/maps` contract says `onMapLoadingError` may fire multiple times and is not exclusive with a successful map load. O36 records it as a generic `[object Object]`, so the resource/style error payload is lost. Treating it as evidence that the entire map is unavailable is invalid. Hike does not use `style_loaded` as a display-ready signal and cannot distinguish a usable style with a failed optional resource from a terminal style failure.

The timeout callback did execute. O36 source should clear its local loading mask in that callback, so telemetry alone cannot prove why the human still saw `Loading map` after the bound. Missing MapView instance IDs prevent determining whether the timeout and visible overlay belonged to the same native mount.

### Run map lifecycle

Classification: **PROVEN false-unavailable transition**.

At 12:16:19.086Z Run begins style loading. At +136 ms, `run_map_style_loaded` reports `cameraRefAvailable=true`. Between +1.059 s and +1.341 s, three generic loading-error callbacks arrive. O36 `markRunMapError` changes product state to `unavailable` for every such callback. The installed Mapbox package explicitly documents that this callback may repeat and may coexist with success. This is sufficient to explain the human-visible `Map unavailable`; it is a false-fatal client readiness model, not proof that Mapbox failed to create a map.

The same handler is installed on both `onDidFailLoadingMap` and `onMapLoadingError`, further obscuring which native event produced each row. The error serializer reduces all callback payloads to `[object Object]`.

### Debug lifecycle

Classification: **PROVEN state history; map effect partly UNKNOWN**.

`qa-mtsmovfy-43c9lqeb` shows Debug ON/OFF can toggle while tracking is idle. The retained fields include a prior Simulator session suffix and Activity suffix while provider remains `real` and status is `idle`. That proves stale Simulator identity can remain hydrated outside a live Activity; it does not prove an active provider leak.

The retained map failure sequence occurs with Debug ON, Simulator enabled, and an active Simulator Hike. No retained normal Run lifecycle exists for direct callback comparison. The human reports Run unavailable in both modes, which agrees with the unconditional Run error-to-unavailable handler.

### Simulator Start transition

Classification: **UNKNOWN in retained telemetry**.

The large row starts at sample sequence 18 with provider `simulator`, tracking status `tracking`, Simulator Activity suffix `773c4961`, and segment `043c76df-8475-480e-973a-d594773c4961:1788869601228:e22d942c`. The virtual-origin selection, `activity_provider_selected`, `activity_start_requested`, provider lock, first generated sample, and first accepted point were evicted before upload. O36 therefore cannot prove or disprove a real-first-point contamination for this Activity.

Source evidence strongly supports fencing after Start: the tracking store clears coordinates before activation, fixes `locationProviderSource`, deactivates both real sources before activating Simulator, and rejects any source mismatch at the canonical boundary. O37 still requires an explicit regression test and non-evictable transition telemetry.

## MapView mount instances and camera

Classification: **PROVEN telemetry deficiency**.

None of the retained map rows contains a MapView mount instance ID. Consequently Hike re-entry cannot be correlated across focus, mount, style, error, timeout, and unmount.

The trace contains 18 `hike_camera_initial_target_applied` events from 12:13:38.460Z through 12:14:16.663Z. They occur as accepted Simulator coordinates update because O36's instant-camera effect depends on latitude/longitude. An initial-camera event is therefore being emitted and applied repeatedly during runtime movement. This is a camera lifecycle conflation, not a MapView lifecycle requirement.

No retained normal-mode camera start/completion events exist. Run reports a camera ref at style load but no retained Run fly-to start/completion.

## Provider, Activity, and location tail

Classification: **PROVEN** unless noted.

- Provider remains `simulator`; Activity remains `tracking` throughout the large row.
- App background/inactive transitions cause duplicate `simulator_provider_resumed` events because both inactive and background transitions reactivate the already-bound source.
- Joystick evidence is complete for two interactions: grant, continuous bearing/magnitude updates, and release. The first retained movement advances accepted positions at roughly one-second wall cadence.
- Retained totals: 194 generated samples, 24 canonical accepts, and 171 canonical rejects. Every reject is `stationary-suppressed`.
- Latest generated sample: sequence 212 at 12:19:42.220Z, synthetic position retained in the Simulator-safe payload, zero emitted speed.
- Latest accepted sample: sequence 210 at 12:19:40.584Z, `accepted-stationary-heartbeat`, committed point count 31, Memory committed/deduplicated.
- Latest rejected sample: sequence 212, `stationary-suppressed`.
- Dedicated `ACTIVITY_POINT` events are absent from the retained row. Because `location_sample_accepted` is emitted only after journal append, store publication, registry update, and Memory recording return, durable point commitment is **STRONGLY SUPPORTED**, but the dedicated committed-point trace is unavailable.

## Exact divergence points

### PROVEN

1. Run converts a non-exclusive Mapbox loading-error callback into terminal product `unavailable`, even after style load and a valid camera ref.
2. Mapbox callback error details are destroyed by `String(object)`, preventing resource/style classification.
3. No MapView instance ID exists, so re-entry events cannot be assigned to a native mount.
4. Hike's instant initial-camera effect re-runs with changing accepted position; 18 applications are retained.
5. The 512 KiB session bound evicts the virtual-origin/provider-lock/first-point sequence before upload because stationary generated/rejected pairs dominate the trace.

### STRONGLY SUPPORTED

1. Hike's second-entry mask relies on too narrow a readiness set: style load is observed but does not make the display ready.
2. Run duplicates separate pre-start and active MapView trees. The Activity Start state change can replace the native MapView even though provider data, not map lifecycle, changed.
3. Stale Simulator identifiers remain visible in idle state and require explicit separation from active provider authority.

### UNKNOWN

1. The underlying Mapbox resource named by the generic native loading errors.
2. Whether the Hike timeout updated the exact React instance whose mask remained visible.
3. The first accepted point and provider-lock order for the retained Simulator Activity.
4. Normal Hike first/second mount callback chains and normal Run callbacks, because they were not retained in the uploaded rows.

## Minimal implementation direction

1. Give every native map mount a screen-local instance ID and reset its readiness/camera refs with that mount.
2. Treat style/load/idle/render callbacks as positive readiness evidence. Treat `onMapLoadingError` as diagnostic unless a separately proven terminal state exists; preserve its structured native payload.
3. Keep one Run MapView identity across pre-start to Tracking and change only layers/camera targets.
4. Make Debug origin selection map-only. Lock Simulator provider before the first canonical Activity sample and make a late real callback produce explicit `provider-source-mismatch` telemetry.
5. Emit high-value transition events in a protected bounded prefix/summary so sample noise cannot evict origin/provider/first-point evidence.
6. Reuse canonical acceptance, journal, metrics, Memory, Cairn, completion, recovery, and sync paths. Implement rollback only if durable journal truncation and server-final-snapshot consistency are both proven.

## Real provider contract (implementation authority)

### Foreground

- `useTrackingStore.activateForegroundSource()` owns one `expo-location` `watchPositionAsync` subscription.
- It requests `Accuracy.BestForNavigation`, begins with a 3,000 ms requested interval, and uses a 5 m distance interval. The existing dynamic sampler may later change the requested interval; Core Location delivery is therefore neither exactly periodic nor guaranteed one-at-a-time.
- Each callback is canonicalized to latitude, longitude, altitude, horizontal accuracy, speed, and the native timestamp. It carries the immutable Activity ID, owner generation, and current segment lease before entering `addTrackPoint()`.
- Hike and Run share this provider. Their acceptance difference is the Hike-only 4.17 m/s overspeed rejection.

### Background

- The background task uses the same Best-for-Navigation accuracy and 5 m distance interval, allows native batching, disables automatic Core Location pausing, and identifies the native activity type as Fitness.
- A durable owner context (`clientActivityId`, user ID, owner generation, segment ID, mode, and `acceptAfterMs`) fences stale native batches.
- With live JS, drained batches enter the same `addTrackPoint()` boundary. In a headless wake, the same owner, accuracy, speed, timestamp ordering, and segment-continuity rules run before accepted points enter the same Activity journal.

### Canonical acceptance and durability

- `addTrackPoint()` is the single serialized acceptance boundary for real and synthetic foreground evidence.
- It rejects inactive/unowned, stale Activity, stale generation, wrong-provider, invalid, pre-owner, non-monotonic, implausible-teleport, poor-accuracy, Hike-overspeed, stationary, and indoor-drift samples with explicit reasons.
- Accepted evidence is assigned to an explicit segment and durably journaled before Zustand publication. Only same-segment edges contribute distance, elevation gain, and active duration. Memory evidence is emitted from the accepted point afterward.
- Simulator cadence must model compatible variable callbacks. Its 1 s wall scheduler may emit an ordered bounded batch under acceleration, but downstream acceptance and metrics remain this production path.

## Rollback persistence and server conclusion

Classification: **PROVEN**.

- Every accepted foreground or Simulator point is synchronously committed to the owner-scoped active Activity journal before it becomes visible state.
- Active sessions may append incremental backup points to the server. Final `PATCH /api/sessions/:id/save` replaces `route_points`, `route_points_raw`, metrics, and finalization state with the complete client snapshot in one transaction. An append arriving after finalization cannot mutate that route.
- A Debug tail correction can therefore remain client-only if it first performs a crash-safe journal truncation, then replaces in-memory Activity state and Simulator clock/position. Final Save is the authoritative corrected server snapshot.
- Memory and Cairns remain independent committed objects by design. During an active online Activity, an earlier incremental backup can temporarily contain the pre-correction tail; local recovery uses the corrected journal and final Save replaces the backup.
- No backend route or schema change is required.
