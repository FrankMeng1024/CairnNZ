# Owner decisions and next gates

| Area | Status | Required next authority/action |
| --- | --- | --- |
| Cairn correctness | PASS | Independent review may inspect the committed patch and isolated evidence. |
| Cairn visual quality | PASS on Web | Native accessibility, haptics, keyboard and frame-timing acceptance remains. |
| Ready for merge review | READY | Owner may authorize a controlled integration branch/reviewer. This is not merge authorization. |
| Hike/Run integration | PENDING | Explicitly authorize semantic integration of 11 overlaps; preserve both branch contracts and rerun combined gates. |
| Native dependency matrix | PENDING | Decide whether to retain v8 legacy with documented peer metadata, change the supported Web dependency, and remove/downgrade unused view-shot; require iOS+Android build/device proof. |
| Native/field validation | PENDING | Physical GPS/background telemetry, genuine pedestrian arrival, native Mapbox, VoiceOver/Dynamic Type and real-device motion. |
| Production backend/fixtures | NOT AUTHORIZED | Separate deploy review and production runbook authorization; do not use production as QA. |
| EAS/OTA/TestFlight | NOT AUTHORIZED | Separate human release decision after integrated/native acceptance. |

The minimal next request is: authorize a controlled integration review on an isolated integration branch, with no direct-main merge and no release action. The integration reviewer must use the semantic checklist in `CROSS_BRANCH_READ_ONLY_COMPATIBILITY.md`.
