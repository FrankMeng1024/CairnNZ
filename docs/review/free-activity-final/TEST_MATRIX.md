# Free Activity test matrix

Status vocabulary: **PASS** means executable local evidence passed. **CONTRACT PASS / DB REQUIRED** means request/schema/order is tested statically but needs a migrated staging database. **DEVICE REQUIRED** is deliberately not a pass.

| # | Required scenario | Automated test | Integration evidence | Native evidence | Status |
|---:|---|---|---|---|---|
| 1 | Online Hike normal Finish | shared completion/static screen contract | save identity/ACK contract | Hike finish on both platforms | PASS; DEVICE REQUIRED |
| 2 | Online Run normal Finish | Run freeze/universal Detail contract | same Activity endpoint as Hike | Run finish on both platforms | PASS; DEVICE REQUIRED |
| 3 | Offline Hike normal Finish | pending payload + registry/store tests | deferred start/save contract | airplane-mode Hike | PASS; DEVICE REQUIRED |
| 4 | Offline Run normal Finish | mode-preserving pending tests/contracts | deferred start uses `running` | airplane-mode Run | PASS; DEVICE REQUIRED |
| 5 | Hike Full Plant offline | committed entity + provenance contract | Cairn business-upsert contract | plant 3+ offline | PASS; DB/DEVICE REQUIRED |
| 6 | Run Quick Cairn offline | same outbox test and Run contract | same Cairn endpoint | quick Cairn 3+ offline | PASS; DB/DEVICE REQUIRED |
| 7 | Death with unfinished Hike | writer snapshots + exact registry tests | client identity shell contract | terminate/relaunch Hike | PASS; DEVICE REQUIRED |
| 8 | Death with unfinished Run | mode-preserving registry/recovery contract | client identity shell contract | terminate/relaunch Run | PASS; DEVICE REQUIRED |
| 9 | Start Run over unfinished Hike | global registry + Running resolution contract | — | interaction test | PASS; DEVICE REQUIRED |
| 10 | Start Hike over unfinished Run | global registry + Hiking resolution contract | — | interaction test | PASS; DEVICE REQUIRED |
| 11 | Resume | exact-ID registry + process segment contract | mapping echo contract | kill then Resume | PASS; DEVICE REQUIRED |
| 12 | Recovery Save | shared `stopTracking` contract | same atomic Save endpoint | kill then Save | PASS; DEVICE REQUIRED |
| 13 | Recovery Discard | tombstone-before-pending test | client-ID delete contract | kill then Discard | PASS; DB/DEVICE REQUIRED |
| 14 | Save eligibility parity | central eligibility unit/static tests | backend minimum point schema | normal/recovery UI comparison | PASS; DEVICE REQUIRED |
| 15 | Death immediately after accepted Activity point | deferred writer publication test; snapshot tests | — | instrumentation kill point | PASS; DEVICE REQUIRED |
| 16 | Death immediately after committed Cairn | outbox-before-cache and hydration tests | idempotent create contract | instrumentation kill point | PASS; DEVICE REQUIRED |
| 17 | Temporary GPS loss | multifactor segment classifier unit boundaries | canonical points accepted | short tunnel/shield | PASS; DEVICE REQUIRED |
| 18 | Long/untrusted GPS loss | long displacement/accuracy unit tests | segmented payload schema | tunnel + displaced exit | PASS; DEVICE REQUIRED |
| 19 | Process-kill gap | recovery always rotates segment contract | segment fields accepted | force quit + Resume | PASS; DEVICE REQUIRED |
| 20 | Gap excluded from metrics | distance/elevation/active-time unit tests | saved values contract | compare displayed stats | PASS; DEVICE REQUIRED |
| 21 | Gap excluded from Memory | point-only reconciliation/static contract | Memory IDs accepted | inspect Fog after gap | PASS; DEVICE REQUIRED |
| 22 | Gap excluded from Route matching | segment-only Route input static test | — | Save as Route online | PASS; DEVICE REQUIRED |
| 23 | Activity Memory incremental offline | central evidence durability/dedupe tests | independent Memory sync contract | airplane kill/discard | PASS; DEVICE REQUIRED |
| 24 | Passive Memory OFF | default/settings/recorder contract | — | walk outside Activity | PASS; DEVICE REQUIRED |
| 25 | Passive Memory ON | recorder gating contract | Memory sync contract | foreground walk | PASS; DEVICE REQUIRED |
| 26 | Activity + passive Memory dedupe | spatial authority unit test | stable `cid` contract | overlap walk | PASS; DEVICE REQUIRED |
| 27 | Activity + Cairn Memory dedupe | multi-source unit test | stable `cid` contract | Cairn on trace | PASS; DEVICE REQUIRED |
| 28 | Lost Activity Start response | immutable UUID + upsert static tests | unique `(user, clientActivity)` | proxy drops response | CONTRACT PASS; DB/DEVICE REQUIRED |
| 29 | Lost Activity Finish response | pending replay/ACK order contract | finalized replay identity contract | proxy drops response | CONTRACT PASS; DB/DEVICE REQUIRED |
| 30 | Lost Cairn create response | retained outbox tests | unique `(user, clientCairn)` | proxy drops response | CONTRACT PASS; DB/DEVICE REQUIRED |
| 31 | Lost Memory response | stable Memory ID/dedupe tests | existing idempotent Memory insert | proxy drops response | PASS; DEVICE REQUIRED |
| 32 | Death after ACK before cleanup | recovery terminal-ID exclusion + cleanup sweep contract | ACK echo/mapping contract | instrumented kill | PASS; DEVICE REQUIRED |
| 33 | Death during cleanup | registry-last repeatable cleanup contract | idempotent fetch/retry | instrument each cleanup step | PASS; DEVICE REQUIRED |
| 34 | Retry after acknowledgement loss | retained pending/outbox tests | business-key replay contract | proxy + relaunch | CONTRACT PASS; DB/DEVICE REQUIRED |
| 35 | Duplicate request does not duplicate server entity | backend route/migration assertions | actual concurrent DB requests | — | CONTRACT PASS; DB REQUIRED |
| 36 | A synced / B unsynced independent cleanup | two-record registry unit test | per-ID daemon order contract | selective proxy failure | PASS; DEVICE REQUIRED |
| 37 | Discard cancels stale Activity upload | tombstone registry/static order tests | delete/start/finalize tombstone contract | offline discard/reconnect | CONTRACT PASS; DB/DEVICE REQUIRED |
| 38 | Logout A → login B isolation | user registry test + queue gates | authenticated ownership contract | two test accounts | PASS; DEVICE REQUIRED |
| 39 | Login A again restores A pending data | per-user durable key contracts | normal reconciliation contract | two test accounts | PASS; DEVICE REQUIRED |
| 40 | Foreground/background point canonicalization | writer parser/background contract tests | Joi canonical schema tests | lock/unlock capture | PASS; DEVICE REQUIRED |
| 41 | Run too-short does not show Complete | Run screen static contract | no Save request | Run short interaction | PASS; DEVICE REQUIRED |
| 42 | Run Finish freezes before naming | operation state + Run ordering contract | — | metric freeze interaction | PASS; DEVICE REQUIRED |
| 43 | Activity Detail pending sync | local snapshot/detail contract | — | offline Detail | PASS; DEVICE REQUIRED |
| 44 | Detail after server authority handoff | ACK cleanup/snapshot contract | server Detail fetch | reconnect while open | PASS; DEVICE REQUIRED |
| 45 | Detail Back → Trails Activities | navigation static contract | — | back gesture/button | PASS; DEVICE REQUIRED |

## Executed local evidence

- Focused client: **9 suites, 74 tests, all passed**.
- Backend overall: **15 tests passed**, including **7 Free Activity identity/schema/tombstone contracts**.
- Changed Free Activity TypeScript filter: **no errors**.
- Expo Web export: **PASS**, 3,388 modules bundled to `/tmp/cairnnz-free-activity-web-final`.
- Full repository Jest: **40/56 suites passed; 408/460 tests passed; 3 skipped**. The 16 failing suites are pre-existing and listed in FA-023; focused Free Activity suites are all green.
- Native and migrated-database claims remain unverified.

## Exact iOS / Android OTA candidate test plan

No OTA is published by this task. After code review, schema rollout rehearsal, and creation of a reviewed internal candidate, run every case on one current iPhone and one current Android phone. Use dedicated accounts, record OS/app version, permission state, battery mode, start/end wall time, local IDs, server IDs, screenshots/video, and exported diagnostics.

1. **Install/baseline:** install the same reviewed candidate on both devices; grant foreground and background location; verify passive exploration defaults OFF.
2. **60+ minute locked Hike:** record at least 60 minutes, lock for at least 45, unlock, Pause/Resume, Finish. Compare elapsed/distance to a reference track and inspect segments.
3. **60+ minute locked Run:** repeat step 2 in Run; verify follow-first UI, pace, low-interaction controls, and frozen metrics during naming.
4. **Airplane Hike/Run:** enable airplane mode before Start; complete one eligible Hike and Run; relaunch before reconnect; verify both are completed “Waiting to sync,” locally openable, and not resumable.
5. **Offline Cairns:** during the airplane Hike commit at least three Full Plant Cairns, including one valid corrected coordinate. During Run commit at least three Quick Cairns. Kill immediately after individual Save confirmations and verify reconstruction/provenance after relaunch.
6. **Crash and process termination:** separately trigger a development crash, OS process kill, and app-switcher termination during each mode. Relaunch; verify one Home card, exact Resume, and a dashed zero-metric gap.
7. **Deliberate force quit:** force quit iOS, walk elsewhere, relaunch, and record samples the OS never delivered. Repeat Android swipe-away/OEM process termination. Verify CairnNZ claims/draws neither missing interval.
8. **Immediate recovery actions:** after a kill, test immediate Resume; separately test Recovery Save without resuming; separately test Recovery Discard and reconnect to prove no resurrection.
9. **Low power:** repeat a 30+ minute locked recording with iOS Low Power Mode / Android Battery Saver. Note OS sampling changes; accepted points must persist and missing continuity must gap.
10. **Background restrictions:** iOS Background App Refresh OFF and Android background/battery restriction enabled. Verify truthful readiness/copy and no fabricated continuity.
11. **Accuracy/permission downgrade:** turn Precise Location OFF, downgrade Always→While Using, deny background, and revoke foreground mid-test in separate cases. Verify recording pauses/fails truthfully while earlier evidence remains.
12. **Tunnel/GPS blackout:** create a short stationary blackout and a long blackout with displaced exit. Verify credible short continuity stays one segment and untrusted reacquisition starts a new segment; inspect distance, elevation, time, pace, Fog, dashed connector, and Route input.
13. **Lost/reordered responses:** with Charles/Proxyman or equivalent, let the server accept then drop responses for Start, Finish, Cairn create, and Memory. Delay/reorder retries, relaunch between steps, and prove one server row per client ID.
14. **Cleanup death injection:** kill after server acceptance, after local mapping, after pending removal, after journal rename, and during file deletion. Relaunch after each and verify no disappearance, duplicate, or unfinished resurrection.
15. **Independent cleanup:** keep Activity B failing while A succeeds. Verify A hands off/cleans without touching B. Repeat with three completed offline Activities reconnecting in deliberately reordered sequence.
16. **Detail open during sync:** hold pending local Activity Detail open, reconnect, wait for cleanup, verify visible data remains; navigate Back to Trails → Activities; reopen online from server.
17. **Account isolation:** create unsynced Activity/Cairn/Memory as A, log out, log in as B, verify no visibility/resume/upload; log A back in and verify pending recovery/sync.

Release evidence must distinguish screen lock/background continuity from force-quit/OS-termination discontinuity. Native reliability remains **DEVICE REQUIRED** until signed evidence from all cases is attached.
