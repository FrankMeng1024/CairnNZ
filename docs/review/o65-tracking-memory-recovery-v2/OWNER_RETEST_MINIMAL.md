# Minimal owner retest

This is a test prescription, not a passed result. It requires a physical native Build 63 or later compiled from this branch. Build 62 cannot test passive background Memory.

## Record before starting

- Device: iPhone 14 Pro Max or iPhone 15 Pro Max, iOS version, Cairn native build number, and resolved Mapbox iOS SDK from build metadata.
- Battery health and starting charge; Low Power Mode; screen brightness; Wi-Fi/cellular state; Bluetooth/location state; weather/temperature if material.
- Exact start/end time and screen-on versus locked time.
- Enable local diagnostic export. Detailed raw traces remain optional, owner-consented, local, and redacted before sharing.

## Short functional sequence

Use one mapped sidewalk/building edge and one courtyard/path where road context may be absent. Keep the whole sequence to roughly 25–35 minutes.

1. **Passive only, map unmounted** — With no Activity, enable the new background Memory consent, open another Cairn page, then lock the phone. Walk 5–10 minutes, including a brief shop/covered/weak-signal interval, and stand still for 60 seconds before walking again. Reopen Memory.
   - Accept only if evidence appears without toggle OFF/ON or manual refresh, no gap is painted as travel, stationary time does not grow a cloud, coverage remains based on 30 m accepted footprints, and the current position is marked honestly if stale/uncertain.
2. **Activity priority and Pause** — Start a Hike with passive Memory still ON. Walk, stand 60 seconds, resume, Pause, walk briefly while paused, resume the Activity, then Finish.
   - Accept only if there is one apparent live route, no duplicate Activity/passive evidence, paused Activity distance does not grow, passive intent survives, and credible movement resumes without a one-minute stall or invented connector.
3. **Finish surface** — Open Finish and inspect the walked route before Save. Save once, then leave the result onscreen through local Base and any online refinement. Open Detail, return, and restart the app.
   - Accept only if the route never vanishes to the pre-start screen, Activity UUID stays stable, Base remains available offline/failure, and Detail/reload show the same latest validated revision.
4. **Offline/restart** — Repeat a short Run in airplane mode, Save, force a normal app process restart without deleting data, then reconnect.
   - Accept only if one local entity survives, pending sync/refinement resumes idempotently, and no 404/dependency path duplicates or deletes it.
5. **Privacy fences** — Start passive permission/recording, switch Memory OFF, then sign out while a callback/refinement could be pending. Sign in to a different test account.
   - Accept only if the old owner receives no new Memory, request ledger, refinement, or Activity write and no stale callback revives the provider.
6. **Native road context** — While recording near the mapped building/corner, pan/zoom once and cross between two nearby corridors where physically safe. Also traverse the courtyard/unmapped segment.
   - Accept only if pan/zoom cannot alter canonical distance/Memory, no false new building-cutting edge is introduced, the actual crossing/turn is retained, and missing map context leaves honest geometry rather than forcing the street.

Export diagnostics after a normal app restart and verify that the export actually contains:

- provider generation/error and recovery attempt timestamps;
- observation receipt, decision, accepted/WAL checkpoint, and processing lag;
- Memory consent/consumer/epoch/project checkpoint;
- RoadContext provenance, coverage, style/source generation, and query reason;
- Matching/Directions request attempts including failed/aborted/disused/retried counts, bytes, and durations;
- finish result identity and Base/Final revisions.

Expected Navigation request receipt for the short sequence: passive/preview/reload zero; Live normally zero; Final within the duration-derived governor and never above two concurrent requests. Account and map-render usage must be read separately.

## Separate power and retention test

Do not collapse this into the short functional pass.

1. On one device, record 1–2 hours of mainly locked Hike/Run with representative walking and stationary periods.
2. Run passive Memory for 8–24 hours covering both a stationary block and an ordinary walking block, with no Activity and the map unmounted for most of the period.
3. Repeat comparable durations/settings on preserved O65/Build 62 where the comparable feature exists; passive-background comparison must be described as unavailable on Build 62 rather than fabricated.
4. Record ending charge, screen-on time, foreground/background time, radio state, thermal events, provider recovery attempts, accepted evidence count, storage delta, replay time, and rendered coverage.
5. Repeat the meaningful subset on the second listed iPhone model before release if results differ materially by device/iOS.

Power acceptance requires no duplicate provider, no restart storm in quiet stationary conditions, no per-fix routing requests, bounded storage/replay, and a disclosed battery result acceptable to the owner. No percentage threshold is invented here; the owner must decide it from comparable measurements.

## Final decision after retest

- Mark `IMPLEMENTED_DEVICE_PENDING` only after a Build 63+ installs and the short native sequence passes while the longer power test is still explicitly scheduled/pending under the owner's release policy.
- Mark an owner candidate/release only after the required physical power and retained-route coverage evidence is accepted.
- Do not increment the Home marker from O65 for this current repair state. If a later Build 63+ becomes a validated human-testable client candidate under repository policy, increment the single existing marker exactly once at that time.
- Do not publish OTA, submit, deploy backend, mutate production data, enable Public, or change a paid plan as part of this retest without separate authorization.
