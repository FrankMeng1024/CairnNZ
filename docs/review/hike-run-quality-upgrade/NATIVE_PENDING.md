# Exact physical-iPhone pending checks

Use a compatible production binary; do not change runtime or native dependencies for this review branch.

1. Enable Owner Debug explicitly, start a genuine Hike and Run, and verify the first OS callback is present in the local replay export.
2. Exercise foreground, lock screen/background, app switching, OS batching, suspension, force termination and recovery. Preserve provider, receipt and monotonic order.
3. Create GPS loss/recovery independently from airplane/offline network state; record provider-ready→receipt, receipt→acceptance and acceptance→visible latencies.
4. Stand still, restart, make normal and U-turns, walk a repeated corridor and end with a supported local maneuver.
5. Open Plant while input continues; repeat with a stale fix and confirm fresh reacquisition retains Activity identity.
6. Save while offline, kill the app, reopen, reconnect, observe one server mapping/ACK and safe cleanup.
7. Copy the diagnostic after Save and after cold reopen; replay it in a fresh process and compare canonical/local/selected fingerprints.
8. Measure a representative long session for battery, working set, chunk size and retention eviction.

Release remains HOLD until these native checks pass. Only then may a separately authorized human increment O87 to O88 and publish OTA.
