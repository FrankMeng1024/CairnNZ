# Minimal Targeted iPhone Follow-up

Use a compatible existing development/TestFlight build. Do not create an EAS Build for this review and do not publish OTA until the evidence below is accepted.

1. Record one 12–20 minute urban Hike with two corners, a 60–90 second standstill, an out-and-back retrace and a normal Finish. Export native telemetry before cleanup.
2. Record one 8–15 minute Run. While recording, tap Cairn, add title/note, plant, return to the same Run, then Finish. Verify exact Activity linkage and placement accuracy/timestamp in the local export.
3. During one Activity, independently toggle airplane/network availability without disabling GPS. Save offline, terminate the app, reopen offline, then restore network. Verify one Activity, one refinement terminal state, no duplicate upload and no premature local cleanup.
4. In a separate Activity, induce real GPS loss without changing network state (for example an indoor/tunnel transition), then recover outdoors. Confirm the UI distinguishes source loss from offline state and preserves an explicit route gap.
5. Exercise foreground → background/locked screen → foreground for at least five minutes. Capture TaskManager callback batches, app state, observation/delivery timestamps, provider kind and WAL commit order.
6. Force-quit after at least two durable points, relaunch, resume or finish through the supported recovery UI, and export the complete evidence bundle.
7. Open the saved Activity repeatedly in day/sunset/night themes and navigate between three Activities. Confirm the native map never goes blank and no route layer disappears. The Web `undefined.send` fix does not count as native proof.
8. Confirm server ACK, local terminal retention and cleanup order on a non-Owner test account. Never delete the last replay package before export/hash verification.

For each case record device/iOS/build/runtime/OTA identity, foreground/background authorization, battery/thermal state, timestamps, raw and accepted points, lifecycle events, stage ledger, sync receipts, screenshots and the exported bundle SHA-256. Stop after these targeted cases unless a new native-only defect requires a narrower reproduction.
