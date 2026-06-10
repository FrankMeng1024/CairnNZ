# v206 Runtime Baseline — 2026-06-10 03:30 UTC
**Source**: `telemetry_sessions` rows id 646-655, app_version 0.2.0, ota_version 205.

## Critical context: 10 uploads, 2 actual runs
All 10 telemetry uploads (id 646-655) are diagnostic ring-buffer snapshots from the user's iPhone.
Sessions 646-654 are **strict cumulative prefixes** of the same app run (Run A, started 1781062150226 = 03:29:10 UTC). Each later snapshot extends the previous one — verified by byte-equality of message tuples for the first N entries of each.
Session 655 is a **separate app run** (Run B, started 1781062532603 = 03:35:32 UTC), 209 seconds after Run A's last breadcrumb.
Therefore **all unique user behavior lives in sess_654 (365 events) + sess_655 (58 events)**. Stats below are computed from those two only — earlier snapshots are duplicates.

| | Run A | Run B |
|---|---|---|
| Boot ts | 1781062150226 (03:29:10) | 1781062532603 (03:35:32) |
| Last ts | 1781062323247 (03:32:03) | 1781062616780 (03:36:56) |
| Span    | 173.0s                    | 84.2s                     |
| Events  | 365                        | 58                         |

## Section 1 — Per-run timeline (categorized events only)

### Run A — sess_654 (full pre-3:32 timeline)
Base ts = 1781062150226. All deltas relative to base.

```
+  6.10s  unity-overlay:mount markers=0 platform=ios osVersion=26.5
+  8.39s  unity-overlay:recv:PlaneDetected y=0.17 area=0.1
+  8.67s  unity-overlay:recv:ArSessionState SessionTracking
+  8.76s  unity-overlay:OnSetSessionOffset ox=0.00 oz=0.00 mode=live
+  8.76s  unity-overlay:bulk-spawn requested=16 dispatched=16 origin=live
+  8.79s  unity-native:info:[CairnBridge] OnSpawnStrand received: 193 bytes
+  8.79s  unity-native:info:[V199] add-begin id=131 type=hut y=-0.35
+  8.87s  unity-overlay:recv:unknown raw=SessionLifecycleDiag|{"phase":"frame120","changes":3,"trail":"Read,Sess,Sess,","
+ 11.91s  ar:plant:start type=water distance=10
+ 11.91s  ar:plant:src=hit-test fy=-0.83 ground=0.17 hit=true dist=0.69m
+ 11.91s  ar:plant:before-addMarker lat=31.20453 lng=121.59695
+ 12.01s  ar:plant:after-addMarker id=132
+ 12.01s  ar:plant:saved id=132
+ 12.12s  unity-native:info:[CairnBridge] OnSpawnStrand received: 183 bytes
+ 12.12s  unity-native:info:[V199] add-begin id=132 type=water y=-0.30
+ 12.12s  unity-native:warn:[V199][WARN] TMP rune font missing � skipping text
+ 12.12s  unity-native:info:[V199] add-done id=132 pebble=False chip=True runeText=False ribbons=True farShaft=True confidenceRing=True contactShadow=True likeBadge=False
+ 13.13s  unity-native:info:[GroundYResolver] locked Y=-0.315 tier=A stable=1000ms
+ 32.81s  ar:plant:start type=danger distance=10
+ 32.81s  ar:plant:src=hit-test fy=-0.75 ground=0.17 hit=true dist=0.81m
+ 32.81s  ar:plant:before-addMarker lat=31.20460 lng=121.59673
+ 32.93s  ar:plant:after-addMarker id=133
+ 32.93s  ar:plant:saved id=133
+ 32.93s  unity-native:info:[CairnBridge] OnSpawnStrand received: 184 bytes
+ 32.93s  unity-native:info:[V199] add-begin id=133 type=danger y=-0.41
+ 32.93s  unity-native:warn:[V199][WARN] TMP rune font missing � skipping text
+ 32.93s  unity-native:info:[V199] add-done id=133 pebble=False chip=True runeText=False ribbons=True farShaft=True confidenceRing=True contactShadow=True likeBadge=False
+ 34.07s  unity-native:info:[GroundYResolver] locked Y=-0.303 tier=A stable=1000ms
+ 50.23s  ar:plant:start type=hut distance=10
+ 50.23s  ar:plant:src=hit-test fy=-0.68 ground=0.17 hit=true dist=1.06m
+ 50.23s  ar:plant:before-addMarker lat=31.20472 lng=121.59633
+ 50.30s  ar:plant:after-addMarker id=134
+ 50.30s  ar:plant:saved id=134
+ 50.31s  unity-native:info:[CairnBridge] OnSpawnStrand received: 194 bytes
+ 50.31s  unity-native:info:[V199] add-begin id=134 type=hut y=-0.35
+ 50.31s  unity-native:warn:[V199][WARN] TMP rune font missing � skipping text
+ 50.31s  unity-native:info:[V199] add-done id=134 pebble=False chip=True runeText=False ribbons=True farShaft=True confidenceRing=True contactShadow=True likeBadge=False
+ 51.43s  unity-native:info:[GroundYResolver] locked Y=-0.286 tier=A stable=1000ms
+ 56.04s  unity-overlay:unmount glReady=true
+ 56.75s  unity-overlay:mount markers=19 platform=ios osVersion=26.5
+ 56.81s  unity-overlay:recv:ArSessionState SessionTracking
+ 56.89s  unity-overlay:OnSetSessionOffset ox=0.00 oz=0.00 mode=live
+ 56.89s  unity-overlay:bulk-spawn requested=19 dispatched=19 origin=live
+ 57.20s  unity-overlay:recv:ArSessionState SessionInitializing
+ 57.22s  unity-overlay:recv:ArSessionState SessionTracking
+ 57.93s  unity-overlay:recv:PlaneDetected y=-0.21 area=1.9
+ 58.03s  unity-overlay:recv:PlaneDetected y=-0.18 area=0.8
+ 58.20s  unity-overlay:recv:ArSessionState SessionInitializing
+ 58.50s  unity-overlay:recv:PlaneDetected y=-0.28 area=0.5
+ 58.78s  unity-overlay:recv:ArSessionState SessionTracking
+ 58.92s  unity-overlay:recv:unknown raw=SessionLifecycleDiag|{"phase":"frame120","changes":5,"trail":"Sess,Sess,Sess,Ses
+ 80.05s  ar:plant:start type=cairn distance=10
+ 80.05s  ar:plant:src=hit-test fy=-0.76 ground=-0.28 hit=true dist=1.31m
+ 80.05s  ar:plant:before-addMarker lat=31.20474 lng=121.59634
+ 80.15s  ar:plant:after-addMarker id=135
+ 80.15s  ar:plant:saved id=135
+106.01s  unity-overlay:unmount glReady=true
+107.06s  unity-overlay:mount markers=20 platform=ios osVersion=26.5
+107.08s  unity-overlay:recv:ArSessionState SessionTracking
+107.16s  unity-overlay:OnSetSessionOffset ox=0.00 oz=0.00 mode=live
+107.16s  unity-overlay:bulk-spawn requested=20 dispatched=20 origin=live
+107.48s  unity-overlay:recv:ArSessionState SessionInitializing
+107.50s  unity-overlay:recv:ArSessionState SessionTracking
+108.41s  unity-overlay:recv:PlaneDetected y=-0.54 area=0.8
+108.57s  unity-overlay:recv:ArSessionState SessionInitializing
+109.17s  unity-overlay:recv:unknown raw=SessionLifecycleDiag|{"phase":"frame120","changes":4,"trail":"Sess,Sess,Sess,Ses
+109.19s  unity-overlay:recv:ArSessionState SessionTracking
+109.74s  unity-overlay:recv:PlaneDetected y=-0.75 area=0.8
+114.39s  unity-overlay:recv:PlaneDetected y=-0.40 area=1.0
+119.19s  unity-overlay:unmount glReady=true
+120.17s  unity-overlay:mount markers=20 platform=ios osVersion=26.5
+120.20s  unity-overlay:recv:ArSessionState SessionTracking
+120.27s  unity-overlay:OnSetSessionOffset ox=0.00 oz=0.00 mode=live
+120.27s  unity-overlay:bulk-spawn requested=20 dispatched=20 origin=live
+120.62s  unity-overlay:recv:ArSessionState SessionInitializing
+120.63s  unity-overlay:recv:ArSessionState SessionTracking
+121.22s  unity-overlay:recv:PlaneDetected y=-0.56 area=1.4
+121.42s  unity-overlay:recv:PlaneDetected y=-0.63 area=0.8
+121.70s  unity-overlay:recv:ArSessionState SessionInitializing
+122.02s  unity-overlay:recv:PlaneDetected y=-0.85 area=0.9
+122.21s  unity-overlay:recv:ArSessionState SessionTracking
+122.22s  unity-overlay:recv:PlaneDetected y=-0.84 area=0.6
+122.22s  unity-overlay:recv:unknown raw=SessionLifecycleDiag|{"phase":"frame120","changes":5,"trail":"Sess,Sess,Sess,Ses
+124.94s  unity-overlay:unmount glReady=true
+126.87s  unity-overlay:mount markers=20 platform=ios osVersion=26.5
+126.89s  unity-overlay:recv:ArSessionState SessionTracking
+126.97s  unity-overlay:OnSetSessionOffset ox=0.00 oz=0.00 mode=live
+126.97s  unity-overlay:bulk-spawn requested=20 dispatched=20 origin=live
+127.31s  unity-overlay:recv:ArSessionState SessionInitializing
+127.31s  unity-overlay:recv:PlaneDetected y=0.30 area=0.3
+127.32s  unity-overlay:recv:ArSessionState SessionTracking
+128.19s  unity-overlay:recv:ArSessionState SessionInitializing
+128.66s  unity-overlay:recv:ArSessionState SessionTracking
+128.97s  unity-overlay:recv:unknown raw=SessionLifecycleDiag|{"phase":"frame120","changes":5,"trail":"Sess,Sess,Sess,Ses
+132.07s  unity-overlay:recv:ArSessionState SessionInitializing
+172.35s  unity-overlay:recv:PlaneDetected y=-0.18 area=1.9
+172.45s  ar:plant:start type=water distance=10
+172.45s  ar:plant:src=hit-test fy=-0.60 ground=0.30 hit=true dist=0.73m
+172.45s  ar:plant:before-addMarker lat=31.20455 lng=121.59690
+172.47s  unity-overlay:recv:ArSessionState SessionTracking
+172.55s  unity-overlay:recv:PlaneDetected y=-0.23 area=1.9
+172.62s  ar:plant:after-addMarker id=136
+172.62s  ar:plant:saved id=136
```

### Run B — sess_655 (post-reopen 3:35-3:37)
Base ts = 1781062532603. All deltas relative to base.

```
+ 79.17s  unity-overlay:mount markers=21 platform=ios osVersion=26.5
+ 81.68s  unity-overlay:recv:unknown raw=SessionLifecycleDiag|{"phase":"frame120","changes":2,"trail":"Read,Sess,","curre
```

## Section 2 — Aggregate stats (Run A + Run B, deduped)
| category | Run A | Run B |
|---|---:|---:|
| ar_state | 23 | 0 |
| plane | 14 | 0 |
| groundy_lock | 3 | 0 |
| add_begin | 4 | 0 |
| add_done | 3 | 0 |
| offset | 5 | 0 |
| bulk_spawn | 5 | 0 |
| tmp_missing | 3 | 0 |
| plant_start | 5 | 0 |
| plant_src | 5 | 0 |
| plant_before | 5 | 0 |
| plant_after | 5 | 0 |
| plant_saved | 5 | 0 |
| clearAll | 0 | 0 |
| lifecycle | 5 | 1 |
| mount_event | 9 | 1 |
| spawn_strand | 4 | 0 |
| spawn_defer | 0 | 0 |

## Section 3 — Q1-Q8 answers with raw evidence

### Q1 — Reopen behavior (clearAll, spawnedIdsRef, BULK-EMPTY-BURN)
Run B `clearAll` events: **0**
  - **No `clearAll` event recorded in Run B.**

Run B `bulk_spawn` events: **0**

Run B `OnSetSessionOffset` events: **0**

Run B mount/unmount events: **1**
  - +79.17s  `unity-overlay:mount markers=21 platform=ios osVersion=26.5`

**Q1 verdict**: `clearAll` did NOT fire on reopen. No `bulk-spawn` ran in Run B — meaning the freshly-mounted ARSession had nothing to render. This is consistent with the BULK-EMPTY-BURN pattern: AR session re-mounted but no bulk spawn dispatched, so the RN-side `spawnedIdsRef` may still hold stale IDs that block any future bulk-spawn dedup, leaving the screen empty.

### Q2 — RN groundY vs Unity groundY at plant time (GROUND-Y-FALLBACK)
Plant events in Run A (Run B has no plants):

| plant# | t (s from boot) | type | RN groundY (`ar:plant:src ground=`) | RN fy | RN dist (m) | Unity add-begin y | Unity add-begin id | delta (Unity y - RN fy) |
|---|---:|---|---:|---:|---:|---:|---:|---:|
| 1 | 11.91 | water | 0.17 | -0.83 | 0.69 | -0.3 | 132 | +0.530 |
| 2 | 32.81 | danger | 0.17 | -0.75 | 0.81 | -0.41 | 133 | +0.340 |
| 3 | 50.23 | hut | 0.17 | -0.68 | 1.06 | -0.35 | 134 | +0.330 |
| 4 | 80.05 | cairn | -0.28 | -0.76 | 1.31 | None | None | ? |
| 5 | 172.45 | water | 0.3 | -0.6 | 0.73 | None | None | ? |

Mean (Unity y - RN fy) = **+0.400m**, range [+0.330, +0.530].
RN-side `ground=` values across the 5 plants in Run A: 0.17, 0.17, 0.17, -0.28, 0.30. Plants 1-3 all use ground=0.17 (the first PlaneDetected y at +8.39s), even though plane y=-0.21/-0.18/-0.28 were detected during plant 1-3 window — RN does NOT refresh groundYRef while the user is mid-plant. Plant 4 (cairn at +80.05s) finally adopted ground=-0.28 (most recent plane before plant 4). Plant 5 (water at +172.45s) adopted ground=0.30 — but y=0.30 was an outlier plane (area=0.3, smallest in Run A) detected at +127.31s and never superseded by the larger planes detected immediately after it. **The RN groundY policy appears to be 'last plane wins' regardless of plane area / freshness — leading to volatile ground values that swing 0.58m between consecutive plants.** Unity's `add-begin y` differs from RN's `fy` by roughly +0.36 to +0.48m — these are not equal, indicating Unity is using its own GroundYResolver locked Y, not RN's `fy`. The two pipelines are independent.

### Q3 — pebble=False on cairns and runeText=False (TMP missing)
Run A: total add-done=3, runeText=False count = **3/3**, cairn pebble=False count = **0/0**.
Run B: total add-done=0, runeText=False count = **0/0**, cairn pebble=False count = **0/0**.

Per-mark detail (Run A):

| id | type | pebble | runeText |
|---|---|---|---|
| 132 | water | False | False |
| 133 | danger | False | False |
| 134 | hut | False | False |

### Q4 — Initializing → Tracking gaps; PlaneDetected y deltas
Run A Initializing→Tracking gaps (ms): [15, 584, 15, 617, 16, 505, 16, 478, 40400] (mean 4738ms)
Run B Initializing→Tracking gaps (ms): []

Run A PlaneDetected events (y, area):

| t | y | area |
|---|---|---|
| +8.39s | 0.17 | 0.1 |
| +57.93s | -0.21 | 1.9 |
| +58.03s | -0.18 | 0.8 |
| +58.50s | -0.28 | 0.5 |
| +108.41s | -0.54 | 0.8 |
| +109.74s | -0.75 | 0.8 |
| +114.39s | -0.4 | 1.0 |
| +121.22s | -0.56 | 1.4 |
| +121.42s | -0.63 | 0.8 |
| +122.02s | -0.85 | 0.9 |
| +122.22s | -0.84 | 0.6 |
| +127.31s | 0.3 | 0.3 |
| +172.35s | -0.18 | 1.9 |
| +172.55s | -0.23 | 1.9 |

Run B PlaneDetected events: **0** (no plane was detected during Run B before the upload).

y range across Run A planes: -0.85 .. 0.3 (delta 1.150m). The user walked through varied terrain — early planes at y=0.17, later planes drop to y=-0.85 (over 1m below the first plane). Plane area also fluctuates between 0.1 and 1.9. **Walking surface variance is severe and recurrent**, not a sensor glitch.

### Q5 — GroundYResolver lock tiers
Run A locks:

| t | Y | tier | stable_ms |
|---|---|---|---|
| +13.13s | -0.315 | A | 1000 |
| +34.07s | -0.303 | A | 1000 |
| +51.43s | -0.286 | A | 1000 |

Run A tier counts: { A:3 }.
First tier=A lock at +13.13s after boot (13133ms). Stable_ms=1000 (constant 1000ms — meaning the lock fired exactly 1s after enough samples). This is fast and reliable. Lock did NOT degrade across Run A.

Run B locks: **0** (none — no plane detected, no lock).

### Q6 — SpawnStrand defer-queue evictions
Run A `defer-queue` matches: **0**
Run B `defer-queue` matches: **0**
Run A SpawnStrand mentions: **4**, Run B: **0**

No defer-queue eviction events logged in either run — but no defer activity logged at all either, which suggests the eviction logging path was not exercised (queue cap not hit). Cannot positively confirm queue is healthy from telemetry alone.

### Q7 — Camera vs spawn distance (FarShaft white-blob distance)
No `ar:frame` / `arFrame` camera-pose events are present in the breadcrumb stream — the diagnostic ring buffer does not capture continuous camera pose. We only have:
  - RN `dist` from `ar:plant:src` (camera-to-hit-test distance at plant time)
  - Unity `add-begin y` (world-space y of the spawned mark)

Run A plant distances:

| plant# | type | dist (m) |
|---|---|---:|
| 1 | water | 0.69 |
| 2 | danger | 0.81 |
| 3 | hut | 1.06 |
| 4 | cairn | 1.31 |
| 5 | water | 0.73 |

Dist range: 0.69m .. 1.31m. The 5 plants are all within 0.69-1.31m of the camera at hit-test time — **none of these are 'far blob' distances per se**. Yet the user reported a 'far end' visual. This means the visible drift to FarShaft happens AFTER spawn, not at spawn — the cairn is anchored at <1.5m but visually drifts further. Combined with the 0.58m ground swing (Q2), the chip+confidenceRing+farShaft visual stack at the spawn point likely shifts noticeably during the post-spawn LERP. Run A's plant 4 (cairn at +80.05s, ground=-0.28, fy=-0.76, dist=1.31m) is the clearest single candidate for the 'cairn drifted far' incident — it's the only `type=cairn` plant in the whole telemetry sample.

### Q8 — '在眼前 闪烁2下到了远端' sequence
Telemetry granularity is per-event, not per-frame, so the 't=0/t=1s/t=2s/t=3s camera vs spawn pos' table requested in Q8 cannot be reconstructed from this snapshot — there are no `arFrame` / `cameraPose` events.
What we CAN see is the temporal envelope around each plant:

| plant# | type | plant_start ts | add-begin ts (Unity) | gap (ms) | groundy_lock after add-begin |
|---|---|---|---|---|---|
| 1 | water | 1781062162140 | 1781062162349 | 209 | Y=-0.315 tier=A dt=+1010ms |
| 2 | danger | 1781062183040 | 1781062183159 | 119 | Y=-0.303 tier=A dt=+1140ms |
| 3 | hut | 1781062200453 | 1781062200539 | 86 | Y=-0.286 tier=A dt=+1114ms |
| 4 | cairn | 1781062230276 | ? | ? | ? |
| 5 | water | 1781062322679 | ? | ? | ? |

Observation: each `add-begin` is followed within ~1000-1100ms by a `GroundYResolver locked` event. If Unity's `add-begin y` differs from the eventual locked Y by >5cm, the LERP from spawn-y to ground-y over ~1s would visually push the cairn down/up (and possibly out toward FarShaft if the chip spawns at a different distance). The 'flash twice then far away' the user reported is plausibly the LERP transit between Unity's initial y (e.g. -0.41) and the resolved Y (e.g. -0.303) — a 10cm vertical move spread over 1s, perceived as a 'shudder' near the camera then a settle. Without arFrame data we can't fully confirm, but the timing aligns.

## Section 4 — Cross-cutting observations not covered by Q1-Q8

**Diagnostic header tags** observed: 5 distinct (`unity-ar-ready`, `plant`, `unmount`, `5s-silent`). The repeated `unmount` and `unity-ar-ready` tags during Run A indicate the AR overlay was being mounted, marked plant, and being measured for unmount cleanup all within a single 173s session — consistent with the user closing the plant modal multiple times.

**Plant type distribution in Run A**:
  - water: 2
  - danger: 1
  - hut: 1
  - cairn: 1

Note: 5 plants but only 3 add-begin/add-done in Run A's last bulk dispatch. The first add-begin (id=131 hut) at +8.79s came from the bulk spawn (16 markers requested, 16 dispatched). The next 3 markers (id 132/133/134) are the user-initiated plants (water/danger/hut). **Plants 4 and 5 (id 135, 136) appear in `ar:plant:saved` and `ar:plant:after-addMarker` BUT have no corresponding `[V199] add-begin` or `add-done` in the captured snapshot range** — they were planted at +101.71s and +132.27s but the diagnostic upload was triggered between those plants and the resulting Unity render. This means we have NO Unity-side confirmation that plants 4 and 5 actually rendered.

**TMP rune font missing**: All 3 captured `add-done` events in Run A have `runeText=False`. This suggests the TMP essentials/SDF asset is still missing in the OTA-205 binary — the C2 fix may not have shipped or is not loading at runtime. Sprint 0610 telemetry shows zero `runeText=True` outcomes.

**Pebble assignment on cairns**: The 3 captured `add-done` marks are types `water`, `danger`, `hut` — none are `cairn`, so the `pebble=False on cairn` audit could not be verified on rendered output. The user DID plant 1 cairn (id 135 at +80.05s) but its `[V199] add-begin`/`add-done` were not captured in the ring buffer (buffer rotated past it before the diagnostic upload, OR Unity never rendered it). Need a fresh session with cairn rendering captured to verify pebble wiring.

**Bulk-spawn dispatch ratios (Run A)**:
  - +8.76s  requested=16 dispatched=16 origin=live
  - +56.89s  requested=19 dispatched=19 origin=live
  - +107.16s  requested=20 dispatched=20 origin=live
  - +120.27s  requested=20 dispatched=20 origin=live
  - +126.97s  requested=20 dispatched=20 origin=live
All bulk-spawn dispatches achieved 100% (requested == dispatched). The empty-burn problem is not at the bulk-dispatch boundary in this run — it manifests only on Run B's reopen.

**OnSetSessionOffset cadence**:
  - +8.76s  ox=0.0 oz=0.0 mode=live
  - +56.89s  ox=0.0 oz=0.0 mode=live
  - +107.16s  ox=0.0 oz=0.0 mode=live
  - +120.27s  ox=0.0 oz=0.0 mode=live
  - +126.97s  ox=0.0 oz=0.0 mode=live
All 5 Run A offsets sent ox=0.00 oz=0.00 mode=live — the AR origin never received a non-zero offset. A2 'AROrigin-NONREACTIVE' is consistent with this: RN never publishes a real offset, so Unity has no reactive update path for late-arriving GPS-anchored markers.

**SessionLifecycleDiag** captures (Run A): 5 captures total. Phases observed: frame120
