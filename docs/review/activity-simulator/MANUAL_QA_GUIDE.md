# Activity Simulator manual QA guide

O37 first native gate — 2026-09-09

## OTA55 dual-mode indoor gate

Run this before the older extended matrices below:

1. In an internal Simulator-capable bundle, enable Debug Mode and Activity Simulator. Open Hike and confirm `SIM MODE` defaults to **Clean Path**.
2. In Clean Path, set an origin, start, move straight, release, and intentionally draw a true Z. Confirm the position stops exactly and the true Z survives Detail.
3. Resolve the Activity. Open Run, select **Raw GPS**, record the visible `Realistic GPS` seed, set `1×` or `10×`, and start.
4. Select **Diagnostic**. Move straight for at least 60 simulated seconds, stop for 120 simulated seconds, then move again. Ground truth must stop exactly; Raw points must keep forming a drifting cloud; the product route must remain calm.
5. Switch to **Product** and judge the route without debug layers. Stationary fixes must not show Signal Lost, add meaningful distance, draw spaghetti, or produce a precise Live Pace.
6. Select GPS **Lost** for at least 61 simulated seconds. This time Signal Lost/recovery is expected. Finish must remain available. Restore the source and confirm a real segment break with no connector.
7. Exercise Recording → Finish → Cancel, Pause → Finish → Cancel, Resume ×5, Resume → Finish while recovering, and Finish ×2. Lifecycle, timer, source ownership, and local completion must retain O54 semantics.
8. Repeat Raw Run at known walk/slow-run/fast-run/slowing/stop/resume speeds. Live Pace must rebuild from recent accepted evidence and show `--` at startup/stop.
9. Finish offline, inspect Base Final, reconnect, and inspect any bounded Enhanced Final. Record seed and `qaSessionId` with any failure.
10. Disable Simulator and start a real-GPS Activity. Confirm no simulated position, Raw fix, diagnostic layer, virtual clock, or provider survives.

Raw GPS can validate JavaScript Activity state indoors. It cannot certify real
iOS suspension, Core Location batching, low-power GNSS, thermal/battery
behavior, or physical foreground/background delivery; keep the outdoor native
matrix below.

## Setup (once)

1. Install an **internal** `development`/`preview` bundle that was built with `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true`. Do not use a public production bundle.
2. Sign in with the approved dedicated QA account.
3. Open Settings, tap **About Cairn** five times within three seconds, and dismiss the Developer Mode alert.
4. In Settings → Developer, enable **Activity Simulator**.
5. Open Hike or Run. Before Start, confirm the ordinary map remains visible with a fixed `模拟起点` center picker and `从这里开始`; the runtime `SIM` console must not appear yet.
6. Pan to a virtual origin and confirm it. Start through the normal Activity button. Only after Tracking begins should the lower-left `SIM` trigger and right-side joystick appear. Expand `更多` for provider/map/sample diagnostics and the full `qaSessionId`.

## O37 first native gate

Do only this concise gate before attempting the extended matrix below:

1. Debug OFF: enter Hike, observe globe → real location, go Back, then enter Hike again. Both entries must leave `Loading map`.
2. Debug OFF: enter Run and confirm the normal map renders without false `Map unavailable`.
3. Debug ON + Simulator ON: pan the pre-start center picker to a distant city (for example Queenstown while the phone is in Shanghai), tap `从这里开始`, then normal `Start Hike`.
4. Confirm the first Activity point is the virtual origin and no real-location point, line, gap, or distance connects to it. Move with the right joystick.
5. Select `丢失` → `重新定位`, pan elsewhere, tap `从这里继续`, and continue moving. Repeat the Lost/reacquisition cycle once more.
6. Select `回退 50m`; confirm trace, distance, pace, elevation, current position, and virtual time return to the retained tail.
7. Leave a Cairn, Finish normally, and inspect Detail. Memory and any committed Cairn intentionally survive rollback.
8. Keep the app online for at least 20 seconds and report the full `qaSessionId` plus approximate Shanghai-local time.

Web/Jest evidence protects the contract but cannot certify native Mapbox or touch behavior. Do not proceed to the full matrix until this gate passes.

If Activity Simulator is absent, record the build profile/channel; do not try to bypass the capability gate. Use only the real Hike/Run Pause, Resume, Finish, Save, and Discard controls.

## Native baseline and automatic-telemetry reproduction (run first)

1. Cold-open the Internal build with Debug Mode OFF. Open and leave Hike twice. On both entries, confirm the original globe/world presentation travels to the real current location. Open Run once and confirm its ordinary real-GPS camera path.
2. Turn Debug Mode ON but leave Activity Simulator OFF. Repeat Hike/Run, then switch Activity Simulator ON and OFF from Settings. The map must remain the ordinary real-GPS map and Debug Mode must remain ON.
3. With Simulator ON and no configured start, open Hike and confirm the real map remains usable under the `模拟起点` picker. Pan and tap `从这里开始`; the full runtime controls intentionally remain hidden until Activity Start.
4. Start a Simulator Activity. Hold the right-side joystick, then release; verify continuous visible movement and generated → accepted → committed sequence. Exercise Pause/Resume and Finish through the normal Activity UI. Do not silently switch to Real GPS while the Activity is unfinished.
5. Keep the app foregrounded with connectivity for at least 20 seconds. Record the full `qaSessionId` from SIM diagnostics and the approximate local reproduction time. Send those two values for server-side inspection; use **Copy JSONL diagnostics** only if automatic upload did not arrive.

Physical-device evidence is the authority for Mapbox rendering, native touch ownership, and the complete joystick chain. Web/Jest evidence protects the contract but does not close those native gates.

## Legacy O36 gate (retained as historical evidence; superseded by the O37 gate)

- **0–8 s:** Settings → Developer: leave Debug Mode ON, set Activity Simulator OFF, open Hike. Confirm normal map and no SIM control.
- **8–16 s:** Return to Developer, set Activity Simulator ON, reopen Hike. Confirm the map remains visible and SIM appears.
- **16–24 s:** Use the center picker and `从这里开始`; runtime speed/time/GPS/terrain controls appear only after normal Activity Start.
- **24–29 s:** Select custom `5 km/h`, `10×`, GOOD, NORMAL; tap normal Start Hiking.
- **29–41 s:** Hold the joystick fully east for exactly 10 seconds, then release. Expect visually obvious motion and approximately 139 m; generated/accepted sequence should continue together with no rejection.
- **41–47 s:** Wait after release. Position/distance must stop increasing.
- **47–53 s:** Use `自动前往`. Automatic movement must continue; this distinguishes provider/acceptance from touch input.
- **53–57 s:** Pan the map, tap Hike recenter, and confirm camera returns to the accepted simulated position.
- **57–60 s:** Expand SIM and screenshot map style/ready, camera/display, input, generated, accepted/rejected, owner, segment, and committed point fields. Preserve the unfinished Activity for the Pause/Resume/recovery matrix or resolve it with normal Finish/Save/Discard before toggling Simulator.

## Fast controls

- **10m too short:** quickly exercises the real `<20 m` Save gate.
- **20m boundary:** exercises numerical behavior at the accepted boundary.
- **自动前往:** opens a center picker and starts simple great-circle automatic movement toward the confirmed destination.
- Touching the joystick stops autopilot immediately.
- Select `1×`, `5×`, `10×`, `30×`, `60×`, or `120×` at runtime; `2×` is under `更多`. A change affects future virtual time only.
- Keep a realistic physical speed when testing pace: Hike `5 km/h` or Run `10 km/h`. Time scale, not speed, compresses the wait.
- At `30×`, a normal 1 Hz wall tick is three ordered samples; `60×` is six and `120×` is twelve. Every sample crosses the canonical Activity pipeline, and a delayed tick never exceeds twelve samples.

## Accelerated-time closure (run first)

1. Set Queenstown, GOOD, FLAT, WALK `5 km/h`, and `10×`; start a real Hike.
2. Move continuously for one real minute. Expect approximately ten Activity minutes, 833 m, and 12:00 min/km. The panel must still show configured speed `5 km/h`, not `50 km/h`.
3. Release movement for 30 real seconds. Expect about five additional Activity minutes and no additional distance/elevation.
4. Pause, wait/move for 15 real seconds, then Resume. The paused interval and movement must add no Activity duration/distance; post-Resume evidence begins a new normal segment.
5. Finish offline if possible, inspect pending Detail, reconnect, and reopen after sync/cleanup. Start/end/point/Memory timestamps must be valid and Detail stats unchanged.
6. Repeat a shorter pass at `2×`, `5×`, `30×`, `60×`, and `120×`. At `120×`, move for six real minutes or less: the historical clock has a hard 12-virtual-hour limit and displays a failure at that boundary.
7. Resolve the Activity, disable Simulator, and start a Real-GPS Activity. Confirm Real GPS uses current wall time and does not inherit the historical clock.

Expected diagnostic difference: accelerated Activities are intentionally dated from a historical anchor roughly 12 hours before the test wall clock, so their history date may be the prior calendar day. Record that as expected unless epochs are future, reversed, or inconsistent with Detail.

## A. Queenstown Free Hike

1. Return Activity to idle. Expand Simulator.
2. Pan the center picker to `-45.0312`, `168.6626` and select `从这里开始`.
3. Tap real **Start Hiking**. Verify the origin is the first accepted sample and an Activity suffix appears.
4. Select `徒步`, `10×`, `正常`, and `上坡` in the runtime console.
5. Use `自动前往`. Confirm distance, active time, and elevation change through the normal Hike UI.
6. Use the joystick southward to walk back for 20–50 m. The old path must remain; return movement must add distance.
7. Tap the real **Leave a Cairn/Plant** action. The GPS step should lock at the simulated area. Move the pin within the 50 m ring, enter content/privacy, and commit.
8. Tap real **Pause**. Move/reposition Simulator while paused. Confirm Activity distance does not change.
9. Tap real **Resume**. Move again and confirm a new solid segment begins with no credited connector.
10. Tap real **Finish**, name/save normally, and open Activity Detail. Verify trace, elevation, Cairn association, Memory relation, and sync badge.

Expected: all samples/journal/metrics/Memory/Cairn/Finish behavior is normal Activity behavior; no Simulator summary exists.

## B. Queenstown Free Run

1. Resolve any unfinished Activity first, then open Run.
2. Use the same Queenstown origin, then start the real Run.
3. Select `跑步`, `10×`, `正常`, `平地`, and use `自动前往`.
4. After stable acceptance, use the real Quick Cairn action.
5. Confirm pace approaches 6:00 min/km over a sufficiently long steady interval; short start/stop timing may vary slightly.
6. Finish/save normally. Verify Detail trace, pace, Quick Cairn origin association, pending/synced behavior.

Expected accelerated variant: one real minute approaches 1.67 km and ten Activity minutes while pace remains approximately 6:00 min/km.

## C. Global start and geodesy

Repeat a short 25–50 m Run or Hike at each location. Use manual Start or map long-press where tiles exist.

| Place | Latitude | Longitude |
|---|---:|---:|
| Tokyo | 35.6762 | 139.6503 |
| London | 51.5072 | -0.1276 |
| Queenstown (Southern Hemisphere) | -45.0312 | 168.6626 |
| Yosemite | 37.8651 | -119.5383 |
| Iceland | 64.1466 | -21.9426 |
| Longyearbyen (high latitude) | 78.2232 | 15.6469 |
| Date Line west edge | 0 | 179.999 |

For the Date Line case, move east at least 500 m. Longitude must wrap negative and stay valid; distance must remain sane. Also enter longitude `499.6503` and confirm it normalizes near Tokyo’s `139.6503`.

## D. GPS quality and loss

1. Start with GOOD and move normally; samples should be ACCEPTED.
2. Select POOR (`±60 m`). Continue moving; the panel should show `GPS rejected: poor-accuracy`, distance/Memory should not advance from those points, and raw audit evidence may still exist.
3. Restore `正常` and continue.
4. Select `卡住`: timestamps/samples continue at the frozen reported coordinate while hidden movement may continue. Restore `正常`; central continuity remains authority.
5. Select `丢失`: no valid samples emit while hidden movement may continue. Restore `正常` directly for automatic recovery; central continuity decides whether the segment continues.
6. While still `丢失`, use `重新定位` → pan → `从这里继续`. Confirm a new segment with zero credited connector. Repeat this at least three times to prove the model is unbounded.
7. While `丢失`, try Full Plant and Quick Cairn. Full Plant should show the normal no-location state; Quick Cairn should refuse. Hidden position must never be used.

## E. Known interruption and Detail gap

1. While a Simulator Activity is tracking, select **Simulate recording interruption**.
2. Confirm the UI says Paused/recoverable; it must not say GPS LOST.
3. Tap real **Resume** after any interval, even one real second and at any selected scale.
4. Move 25+ m, Finish, and inspect Activity Detail.
5. Confirm two solid trace segments and a dashed gap; gap distance, time, elevation, pace contribution, and Memory are zero.
6. Export diagnostics and confirm `recording_interruption_forced`, `gapReason=process-recovery`, provider resume, and the new segment identity.

This action does not replace a real process kill.

## F. Offline

1. Start online long enough to render/cache the target area if desired, then enable Airplane Mode.
2. Confirm panel says OFFLINE; do not use any fake network toggle.
3. Start a Simulator Hike, move, plant a Full Cairn, Pause/Resume, and Finish.
4. Open pending-local Detail. Trace, segments, stats, Cairn, and Memory must be present even if map tiles are unavailable.
5. Repeat with Run and Quick Cairn.
6. Reconnect. Observe pending → syncing → synced; do not delete the synthetic data before inspection.

## G. Recovery

Run separately for Hike and Run.

1. Start at `10×`, move at least 25 m, and note Simulator coordinate, virtual elapsed, scale, and settings.
2. Background/lock briefly, return, and confirm coherent continuation.
3. Start/move again, then manually terminate the app.
4. Relaunch as the same QA account. The normal unfinished Activity prompt must appear and Simulator settings/position must restore.
5. Test **Resume**: the next accepted point begins a process-recovery segment and virtual time continues forward without replaying dead-process wall time.
6. Repeat and test recovery **Save** after eligibility.
7. Repeat and test recovery **Discard**. Activity product data is removed according to normal discard, but already committed Memory remains.
8. Also test a zero/too-short recovered Activity: Save must remain unavailable; resolve through normal Resume/Discard.

## H. Memory

1. During an Activity, move across several 12.5 m dedupe radii. Confirm panel Memory changes from COMMITTED to DEDUPED as appropriate and Memory grows incrementally before Finish.
2. Discard the Activity; confirm explored Memory remains under the accepted contract.
3. Resolve all Activities. Pan or change the pre-start virtual origin and confirm it produces no Activity or passive Memory evidence.

## Debug rollback

1. During a Simulator Activity, move at least 150 m in the current segment.
2. Exercise `回退 10m`, `25m`, `50m`, and `100m` in separate runs or after rebuilding sufficient tail.
3. Confirm only accepted committed track evidence is removed; rejected samples are irrelevant.
4. Kill/relaunch after a rollback and recover the Activity. The removed tail must not return.
5. Finish online and confirm server-backed Detail matches the corrected final route. Previously committed Memory and Cairns remain by design.

## I. Sync and historical authority

1. Finish offline and open pending Detail; take a screenshot.
2. Reconnect and wait for sync ACK.
3. Reopen Activities/Detail after local acknowledged cleanup.
4. Confirm server-backed Detail retains trace, segments/dashed gaps, stats, Cairns, and normal actions such as Save as Route.
5. Export diagnostics. Follow `ACTIVITY_COMPLETION → SYNC_STATE → SYNC_ACK → SYNC_CLEANUP` using the Activity suffix.

## J. Account isolation and singleton

1. As Account A, start a Simulator Activity and move.
2. Attempt to start the other mode: the normal one-unfinished resolution must block a second Activity.
3. Log out and log into B. B must not see/resume A’s Activity or Simulator coordinate/session; B starts with its own defaults.
4. Start/finish or remain idle as B, then log out.
5. Return to A. A’s unfinished Activity should be offered through normal recovery with A’s Simulator context.
6. Export A and B diagnostics separately and confirm owner/session suffixes do not cross.

## Diagnostics after any failure

1. Do not reset or discard until the failure is captured unless that action is the test.
2. Screenshot the expanded panel and Activity UI.
3. Record the full `qaSessionId` shown in SIM diagnostics and the approximate local failure time. Leave the app connected for at least 20 seconds so the bounded automatic upload can complete.
4. Record build profile/channel, platform/version, account label (not email), ONLINE/OFFLINE, Activity mode, and exact action sequence.
5. If automatic retrieval fails, select **Copy JSONL diagnostics** and paste it into the issue. Select Clear QA logs only after Activity is idle and evidence is safely copied.

## Tests the Simulator cannot replace

Physical signed iOS/Android validation remains required for:

- iOS locked-screen/background CoreLocation behavior;
- Android background service/Fused Location behavior;
- OS memory-pressure termination;
- deliberate force-quit semantics;
- Background App Refresh restrictions;
- Low Power Mode and device battery policy;
- foreground/background permission downgrade;
- Precise Location disabled;
- actual device GPS, tunnels, urban canyon/multipath, and radio loss;
- native callback batching, ordering, and scheduling differences.

The Simulator can reduce walking in these tests: start Simulator movement, lock/background/terminate as the case requires, then inspect native lifecycle and recovery. It cannot manufacture native delivery proof.

## O38 first native gate

Run this short gate before the wider matrix:

1. Open normal Hike twice, backing out between entries; both entries must show the globe-to-current-location journey.
2. Open normal Run; its map must render without a false `Map unavailable` state.
3. Enable Debug and choose a virtual origin far from the phone's real location, then start Hike. Confirm no real-to-virtual connector or credited distance appears.
4. Move with the joystick, select `丢失`, use `重新定位` → `从这里继续`, then repeat that loss/reacquisition once more.
5. Move at least 60 m and select `回退 50m`.
6. Leave a Cairn, Finish, and open Activity Detail.
7. From Detail select Back, then from Trails select Back. The saved Detail must not reopen.
8. Rename a newly saved Activity and confirm the server-backed name after reopening it.
9. Record the `qaSessionId` and approximate Shanghai-local time, then leave the app connected for at least 20 seconds for automatic upload.
