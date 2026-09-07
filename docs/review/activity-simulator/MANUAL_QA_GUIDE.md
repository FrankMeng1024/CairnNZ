# Activity Simulator manual QA guide

First internal OTA guide — 2026-09-07

## Setup (once)

1. Install an **internal** `development`/`preview` bundle that was built with `EXPO_PUBLIC_ACTIVITY_SIMULATOR_ENABLED=true`. Do not use a public production bundle.
2. Sign in with the approved dedicated QA account.
3. Open Settings, tap **About Cairn** five times within three seconds, and dismiss the Developer Mode alert.
4. In Settings → Developer, enable **Activity Simulator**.
5. Open Hike or Run. A collapsed `SIM` card must show configured physical speed, time scale, GPS state/accuracy, altitude, and the latest failure if any.
6. Expand the card. Confirm actual ONLINE/OFFLINE state, coordinate, mode/lifecycle, segment/activity suffix, last sample, Memory result, and sync state.

If Activity Simulator is absent, record the build profile/channel; do not try to bypass the capability gate. Use only the real Hike/Run Pause, Resume, Finish, Save, and Discard controls.

## Fast controls

- **10m too short:** quickly exercises the real `<20 m` Save gate.
- **20m boundary:** exercises numerical behavior at the accepted boundary.
- **Move 1km:** starts simple northbound autopilot.
- Map long-press → **Move here** replaces the temporary trajectory.
- Map long-press → **Queue** adds a waypoint (maximum 12).
- Touching the joystick stops autopilot immediately.
- Select `1×`, `2×`, `5×`, `10×`, or `30×` only before Start. Scale is fixed during the Activity.
- Keep a realistic physical speed when testing pace: Hike `5 km/h` or Run `10 km/h`. Time scale, not speed, compresses the wait.
- At `30×`, a normal 1 Hz wall tick is logged as a bounded batch of three ordered samples. This is expected, not a point flood.

## Accelerated-time closure (run first)

1. Set Queenstown, GOOD, FLAT, WALK `5 km/h`, and `10×`; start a real Hike.
2. Move continuously for one real minute. Expect approximately ten Activity minutes, 833 m, and 12:00 min/km. The panel must still show configured speed `5 km/h`, not `50 km/h`.
3. Release movement for 30 real seconds. Expect about five additional Activity minutes and no additional distance/elevation.
4. Pause, wait/move for 15 real seconds, then Resume. The paused interval and movement must add no Activity duration/distance; post-Resume evidence begins a new normal segment.
5. Finish offline if possible, inspect pending Detail, reconnect, and reopen after sync/cleanup. Start/end/point/Memory timestamps must be valid and Detail stats unchanged.
6. Repeat a shorter pass at `2×`, `5×`, and `30×`. At `30×`, move for 24 real minutes or less: the historical clock has a hard 12-virtual-hour limit and displays a failure at that boundary.
7. Resolve the Activity, disable Simulator, and start a Real-GPS Activity. Confirm Real GPS uses current wall time and does not inherit the historical clock.

Expected diagnostic difference: accelerated Activities are intentionally dated from a historical anchor roughly 12 hours before the test wall clock, so their history date may be the prior calendar day. Record that as expected unless epochs are future, reversed, or inconsistent with Detail.

## A. Queenstown Free Hike

1. Return Activity to idle. Expand Simulator.
2. Enter `-45.0312`, `168.6626`, altitude `350`, then **Start here**.
3. Select WALK `5 km/h`, `10×`, GOOD, NORMAL signal, and CLIMB.
4. Tap real **Start Hiking**. Verify first sample becomes ACCEPTED and an Activity suffix appears.
5. Use **Move 1km** or queue two map points. Confirm distance, active time, and elevation change through the normal Hike UI.
6. Use the joystick southward to walk back for 20–50 m. The old path must remain; return movement must add distance.
7. Tap the real **Leave a Cairn/Plant** action. The GPS step should lock at the simulated area. Move the pin within the 50 m ring, enter content/privacy, and commit.
8. Tap real **Pause**. Move/reposition Simulator while paused. Confirm Activity distance does not change.
9. Tap real **Resume**. Move again and confirm a new solid segment begins with no credited connector.
10. Tap real **Finish**, name/save normally, and open Activity Detail. Verify trace, elevation, Cairn association, Memory relation, and sync badge.

Expected: all samples/journal/metrics/Memory/Cairn/Finish behavior is normal Activity behavior; no Simulator summary exists.

## B. Queenstown Free Run

1. Resolve any unfinished Activity first, then open Run.
2. Use the same Queenstown start, FLAT altitude, GOOD GPS, RUN `10 km/h`, and `10×`.
3. Start the real Run and choose **Move 1km**.
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
3. Restore GOOD and continue.
4. **Short loss:** at `10×`, select Lose GPS for about 2 real seconds (about 20 virtual seconds), move only a plausible distance or stay near the expected point, then Restore. Canonical continuity may retain the segment.
5. **Long/untrusted loss:** at `10×`, Lose GPS for at least 13 real seconds (at least 130 virtual seconds), use hidden reposition/manual movement well away from the last fix, then Restore GOOD. The accepted reacquisition should create a new segment. If displacement is implausible without enough virtual elapsed time, rejection is correct—wait until the interval is long enough; do not force a Simulator gap.
6. While LOST, try Full Plant and Quick Cairn. Full Plant should show the normal no-location state; Quick Cairn should refuse. Hidden position must never be used.

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
3. Resolve all Activities. Settings → **Record exploration outside activities** OFF: move Simulator from the Hike/Run pre-start panel and confirm Memory does not grow.
4. Turn the setting ON: move with GOOD GPS and confirm passive Memory grows.
5. With passive ON select POOR or LOST and move; Memory must not grow.

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
3. Select **Copy JSONL diagnostics** and paste into the issue.
4. Record build profile/channel, platform/version, account label (not email), ONLINE/OFFLINE, Activity mode, and exact action sequence.
5. If needed, select Clear QA logs only after Activity is idle and evidence is safely copied.

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
