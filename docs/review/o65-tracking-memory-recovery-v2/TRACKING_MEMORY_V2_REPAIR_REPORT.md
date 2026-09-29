# Tracking and Memory recovery v2 — repair report

Status: `NATIVE_BUILD_REQUIRED`

This is one integrated repair on branch `codex/o65-tracking-memory-v2`. The immutable O65 reference is tag `o65-tracking-memory-v2-base` at `44d21258e0bee89e8a3c22c001d58cee816f9f00`; its app tree is `c37b40947fcbc4972bb73724b2970d61372ccf92`. The implementation commit is `6454988048bad09987f18034f97912dae525b1eb`.

The original worktree at `/Users/mzm/Desktop/cairn/CairnNZ` was not reset, cleaned, stashed, or modified. O65 remains the Home marker. No app version, runtime version, native build number, or Home marker was incremented.

No OTA, EAS cloud build/submission, backend deployment/restart, production-data operation, Public-gate change, credential change, or paid-plan change was performed.

## Outcome by owner contract

| Contract | Repair | Before/after proof | Remaining boundary |
|---|---|---|---|
| Walked route before Save; stable result afterward | `ActivityFinishResult` carries stable Activity identity and artifact revision. Hike and Run retain the result after tracking becomes idle. `StopSummarySheet` draws the still-recording walked preview, then Base, refining, validated Final, sync-pending, and recoverable failure states. | UI contracts, finish regression tests, and 390 x 844 Expo Web captures all pass. | Native Mapbox rendering and owner interaction remain device-pending. |
| Durable ordered Activity authority | Foreground append, background drain, replay, Pause, and Finish use journal projection/rebase rather than applying a stale whole transition after an await. WAL failure remains an Activity failure; asynchronous Memory projection has its own durable checkpoint. | Both replay/new-point commit orders, same-generation rebase, WAL failure, and slow/failed Memory regressions pass. | Native filesystem interruption remains device-pending. |
| One logical source, credible recovery, qualified position | Generation-fenced supervisor serializes desired consumers and native source ownership, handles terminal errors/start races with bounded backoff, and prevents OFF/logout/Finish resurrection. Source receipt health is separate from movement and display authority. Raw queued background fixes no longer overwrite the qualified puck on foreground takeover. | Supervisor, continuity, recovery cadence, store takeover, and source-authority tests pass; the final sibling-path review added explicit rejected-raw takeover assertions. | Core Location lifecycle/telemetry needs the new owner build. |
| Passive Memory during normal background/lock | Optional consent v4 persists independently of screen mounting. A top-level Expo task records fenced passive evidence with owner/epoch checks, Activity priority, OFF/logout cancellation, durable replay, and no map dependency. | Passive-only, duplicate start, late start, account switch, source loss/recovery, Activity overlap, and purge contracts pass in deterministic tests. | Build 62 is deliberately blocked. Updated native purpose/config must be baked into Build 63+ and tested on device. Force-quit/reboot are not promised. |
| Exact Memory evidence boundary | Accepted real evidence remains the only exploration authority. Final/Live geometry cannot unlock Memory. Existing 30 m footprint semantics are retained and projection is idempotent. | Activity projector, passive continuity, Memory settings, raw pipeline, and account-boundary suites pass. | Real background cadence and coverage crescents require device walking evidence. |
| Bounded local Live road awareness | `RoadContext` uses mounted RNMapbox rendered-feature queries only, records viewport/style/source generation and uncertainty, excludes app-owned layers, and refreshes on meaningful movement/context changes. Local presentation uses a short coherent tail and rejects only false obstacle crossings introduced by presentation; canonical/raw/Memory remain unchanged. | Local context, style/source generation, parallel corridor, corner/building, bridge/tunnel, seam, source replacement, pan/zoom, and no-context fallbacks pass. | No real native map/style query was exercised by Expo Web. Device test must confirm installed Maps SDK behavior and retained coverage. |
| Validated global Final without invented travel | Continuous physical segments are reconstructed independently. Local bad bursts, sparse cadence, loops, gaps, tracepoint correspondence, alternatives, safe fallback, ambiguous corridors, and obstacle checks are handled. Base remains usable when online refinement is unavailable. | Final suites and the rerun O65 deterministic matrix pass the repaired contracts; all eight mocked network cases retained a valid local result. | A local-only result is not called road matched. Real road data and poor-signal routes remain device-pending. |
| Activity-wide Mapbox cost control | A persisted owner/activity governor counts every attempted retry/failure/abort/disused request, permits at most two concurrent requests, and does not reset on segment, screen, foreground, or restart. Passive, preview, and reload phases are zero-network. | Governor, restart, retry, purge, offline, auth, and refinement-queue tests pass. Mocked Final used two Matching calls and zero Directions for the synthetic trace. | Account-wide monthly usage and real response byte/latency receipts were not available locally. |
| Honest distance and retained route coverage | A map-independent accumulator may substitute speed-derived distance only with at least four supported edges, at least 80% coverage, a 0.80–0.98 geometry ratio, and at least 97% net progress. Geometry remains the fallback; stored canonical/Memory geometry is untouched. | Calibration seed 11 and held-out seeds 29/47 keep metric error below 3% while noisy raw/canonical fixtures exceeded 15%; gap and replay equivalence pass. Ambiguous stop/start and slow-walk limits remain disclosed. | Hardware GPS limits are not certified by synthetic data. |

## Ordered implementation record

### Phase 1 — Save, replay, and data safety

- Reproduced the Hike and Run early-return loss of the completed result and replaced boolean/lookup coupling with a stable result contract.
- Restored the walked preview before Save and kept the Base/Final route visible after the Activity store becomes idle.
- Reproduced both stale journal interleavings and changed projection to monotonic identity/rebase semantics.
- Removed the too-short post-preflight implicit discard path.
- Added stable detail revision invalidation and repaired offline dependency/404/subscription liveness.

### Phase 2 — provider, position, stop/start, and downstream isolation

- Added one owner-scoped logical source supervisor with cancellable generations, explicit desired consumers, bounded retries/backoff, and terminal/recoverable state.
- Kept recent source receipt, qualified current position, accepted movement, and canonical health as different authorities.
- Set candidate/recovery timing to tolerate ordinary sparse cadence: candidate 20 seconds, reacquisition 45 seconds, recent evidence 45 seconds.
- Made Activity-to-Memory projection WAL-first, durable, asynchronous, and replayable so Memory/Fog failures cannot stall Activity receipt/commit.
- Corrected normal stop, false stationary, closed-loop, Pause, and foreground-takeover authority behavior.

### Phase 3 — passive foreground/background Memory

- Added top-level `expo-task-manager` registration and a real `expo-location` background task.
- Added owner/consent/epoch leases, Activity priority, duplicate suppression, and OFF/logout/reset fencing.
- Passive configuration is Balanced accuracy, 15 m distance, 15 s time hint, 30 m/15 s deferred delivery, automatic pauses, and no visible iOS background indicator.
- Expanded native purpose text and required explicit background education/consent. Existing foreground consent is not silently broadened.
- Hard-gated passive background behavior to native build 63 or later.

### Phase 4 — local Live presentation and request governor

- Added presentation-only road/path/building context with explicit coverage and provenance.
- Local feature queries are event-driven (at least 12 m or 15 s unless viewport/style generation changes) and do not call Navigation APIs.
- Kept a coherent presentation tail of no more than 6 m between paired points and retained honest canonical geometry when obstacle/context evidence is missing or ambiguous.
- Added persisted Live/Final Mapbox budgets and concurrency/backoff accounting.

### Phase 5 — Final, revision propagation, and offline recovery

- Added segment-preserving Final reconstruction and corrected segment-wide p65 contamination, sparse-pause anchors, loop collapse, temporal crop mapping, alternatives counting, and safe fallback selection.
- Added a durable owner/revision/fingerprint refinement queue. Base is committed and shown immediately; Final uses a revision-specific idempotency key.
- Restart/offline recovery, deletion cancellation, account-purge cancellation, and ledger deletion are tested.

### Phase 6 — compound review and evidence

- Reran the O65 deterministic harness against the repair: 26 stateful journeys, 38 Stage 1 scenarios, 44 Final fixtures, eight Mapbox mocks, and five Final interactions.
- The harness's static metadata still says O65. Its `puckAndHealth` object is not accepted as a store-level proof because it models an obsolete raw-source dependency. The replacement evidence is the 122-test store/journal/continuity run with explicit foreground takeover assertions.
- A sequential second pass found and fixed the raw queued-background takeover leak in `useTrackingStore`: receipt freshness may advance source health, but only the qualified projected tail may advance the current coordinate.
- Expo Web mobile QA passed four explicit assertions with no runtime errors. Generated screenshots remain under `/tmp/cairnnz-tracking-memory-v2-web` and are intentionally not committed.

## Validation verdict

- Targeted functional tests: passing. See `TRACKING_MEMORY_V2_REGRESSION.json` for named groups and non-additive totals.
- Backend local regression: 109/109 passing; no backend source change or deployment.
- Full changed verifier: **failed** with 166/167 suites passing and 1,552/1,556 tests passing, one failure, three skipped. The sole failure was the frozen `revision03MemoryScale` event-loop maximum of 156.198726 ms against `<150 ms`; its measured geometry/select slices were 31/19 ms. It was diagnosed once in isolation and passed 6/6 with an event-loop maximum below the threshold, but the original full gate remains recorded as failed rather than retried to green.
- Whole-project `tsc --noEmit`: still fails on existing missing Playwright/Turf declarations, preview navigation types, and generated Friends icon keys. The changed-path verifier typecheck passed and the whole-project output did not identify a newly touched repair path.
- `git diff --check`: passing before implementation commit.

The code/config integration is implemented, but the complete product contract cannot run on installed Build 62. Battery, native background execution, real rendered-feature queries, GPS/radio behavior, and retained coverage on real routes are `DEVICE_PENDING`. The correct release status is therefore `NATIVE_BUILD_REQUIRED`, not owner accepted and not OTA-ready.
