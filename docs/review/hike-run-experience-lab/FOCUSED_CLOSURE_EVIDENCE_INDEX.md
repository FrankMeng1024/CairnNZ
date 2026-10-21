# Focused Closure Evidence Index

This index maps the focused independent-review findings to files in `Cairn_Hike_Run_Final_Integration_CORE.zip` and `Cairn_Hike_Run_Final_Integration_VISUAL.zip`. Every path is archive-relative. `MANIFEST.sha256` in each archive covers every other file.

## Start here

- `reports/FOCUSED_CLOSURE_REPORT_CN.md` — product-facing result, A–D disposition and the three distinct gates.
- `reports/OWNER_IPHONE_ACCEPTANCE_CN.md` — finite native acceptance procedure; no claim that a phone received this source.
- `independent-review/` — the complete review instructions and independent audit/probe that defined this round.
- `identity/SOURCE_IDENTITY.json` and `identity/GIT_IDENTITY.txt` — exact tested product SHA/tree, delivered branch head, ancestry and clean/dirty interpretation.
- `identity/ab76e419-to-a9ff277.patch` — exact product delta; `identity/084a34e6-to-a9ff277.patch` retains the complete quality-upgrade delta.
- `source/changed/` — every file changed by the focused product commit; `source/dependencies/` contains the required unchanged algorithm/recording dependencies used to review those changes.
- `verification/` — exact-source targeted, CORE, FULL and performance logs, including failures and skips.

## Claim map

| Review item / claim | Primary evidence | Challenge / negative evidence |
|---|---|---|
| Q05/Q08 targets fixed before classifier | `route/FOCUSED_ROUTE_CORRECTION_TARGETS.json`; each `route/final/*/result.json` (`frozenTarget`) | `route/failures/` contains the first Q05 no-op and Q08 17.5 ambiguity |
| Real Mapbox boundary exercised | `route/final/Q05-live/result.json`, `Q08-live/result.json`: exact URL without token, request signature, status 200, response code/body hash, token authority fingerprint | `providerGeometryCommitted:false` is retained; no claim that the returned geometry was safely committable |
| Provider outage fallback | `route/final/Q05-outage/result.json`, `Q08-outage/result.json`: one deliberate 503 each, manual local segment, save/reopen assertions | Outage is not mislabeled as an unmapped-trail provider success |
| Original Activity/Memory unchanged | all four `route/final/*/result.json` hashes/assertions; VISUAL `focused-route/*/06-original-activity-unchanged.png` | Physical iPhone edit gesture remains pending |
| 20–25 m provider endpoint no-op defect | `source/changed/app/src/features/route/routePlanningProvider.ts`, its test, and focused patch | Initial failed `route/failures/Q05-live-before-fix/` retained |
| Current Run → Plant commit contract | `source/changed/app/src/screens/__tests__/cairnCommitSingleFlight.test.ts`; targeted test receipt | Previous Quick Cairn source-string assumption is not restored |
| Baseline/candidate performance A/B | `verification/performance/PERFORMANCE_SUMMARY.json`, `PERFORMANCE_TRIALS.json`, all raw Jest JSON/stdout/stderr, `reports/PERFORMANCE_AUDIT.md` | Baseline trial 2 `revision03MemoryScale` 277 ms failure retained; no native-device inference |
| Actual Start → callbacks → Finish | `backend/CLIENT_BACKEND_CLOSURE.json`, case `real-recorder-offline-finish-cold-reopen-ack`; client request/response and DB files | `failures/backend/` retains two Start failures and the dirty proof run |
| WAL survives cold reopen and is removed only after ACK | the same case’s before/after manifests, memory intent, pending state and diagnostic phases | This is Expo Web + isolated MySQL, not Core Location on iOS |
| No production records / safe cleanup | `backend/TEST_DATABASE_TEARDOWN.json`, `DB_ASSERTIONS.json`, `CLIENT_HTTP_REQUESTS.json` | No client server DELETE; disposable database only |
| Browser timer defect and fix | `source/changed/app/src/features/activity/realLocationSupervisor.ts` and test; focused patch | Expo Web watcher `.remove()` dependency mismatch remains disclosed |
| Headless raw receipt before foreground drain | `source/changed/app/src/services/backgroundLocationTask.ts`; `backgroundDiagnosticReplayIngress.test.ts`; targeted results | OS observations never delivered to JS cannot be inferred |
| Five event timeline sentinels | `activityDiagnosticEventTimelineReplay.test.ts`, `diagnosticReplayFixture.ts`, targeted results | Logs-only sentinel, not physical suspension |
| Distinct completion labels | `activityDiagnosticReplay.ts`, lifecycle tests and focused patch | Recording completeness is not presented as sync completeness |
| Selected historical Activity export | `MapHistoryScreen.tsx`, `RootNavigator.tsx`, UI contract test | Debug/owner scoped; no general export redesign |
| 18 accepted raw-only replays | `prior-accepted/diagnostic-replay/` plus independent audit | Accepted only in the independent review’s documented geometry scope; not rerun here |
| Frozen same-input corpus and earlier metrics | `prior-accepted/corpus/`, `prior-accepted/metrics/`, original contract/report | Older claims remain prior campaign evidence, not native acceptance |
| Historic Mapbox request 120 | `prior-accepted/mapbox/mapbox-request-ledger.json` | Remains `UNKNOWN/ORPHANED`; not retrospectively overwritten |
| Exact regression gates | `verification/TARGETED_TESTS.*`, `VERIFY_CORE.log`, `VERIFY_FULL.log` | `VERIFY_CORE_MISSING_BACKEND_DEPS.log` and the five FULL skips are retained |

## Visual archive

`index.html` and `IMAGE_INDEX.tsv` identify every included image by case, source commit, view state, Mapbox provenance and original source path. Direct image files remain available.

- `same-viewport/` — earlier baseline/candidate ordinary walking, running and degraded comparisons on identical viewports.
- `live-frames/` — stop/restart, repeated traversal, strong drift/recovery, off-network trail context and worst case; these are earlier accepted campaign frames, not new native captures.
- `focused-route/` — exact `a9ff277…` Q05/Q08 defect close-ups, corrected overview, saved/reopened views and unchanged source Activity, for both live provider and explicit outage modes.
- `plant-workflow/` — visible ongoing recording → Plant → return → Finish/cold reopen sequence. The prior `10-complete.png` is labeled transitional rather than settled proof.
- `negative-attempts/` — screenshots from failed/no-op/ambiguous attempts.

## Reproduction boundaries

The archive intentionally excludes `node_modules`, browser profiles/caches, credentials, Mapbox token values and disposable database files. It includes package lockfiles, source, scripts, raw inputs/receipts and response metadata. Inspecting and hashing require no absolute path or network. Live reproduction needs separately authorized credentials; native acceptance needs the Owner device.
