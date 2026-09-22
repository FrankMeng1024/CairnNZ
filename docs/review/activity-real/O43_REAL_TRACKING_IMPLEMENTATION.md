# O43 real tracking implementation

Status: automated candidate ready for an instrumented native walk. This is not a claim that iOS lock-screen delivery, sensor behavior, or native Mapbox paint has been certified.

Authorities: `WRONG_O42_CONTINUITY_FORENSIC.md`, `OLD_VS_O41_HIKE_ARCHITECTURE.md`, and `ALMOST_WORK_FORENSIC.md`.

## Tracking contract

- Raw Core Location observations remain diagnostic/audit evidence. They do not automatically change distance, elevation, Memory, or the route.
- `realGpsContinuity.ts` is the deterministic foreground/background motion reducer. Normal coherent fixes accept in the same callback. Strongly poor-accuracy or accuracy-adjusted impossible-speed fixes reject immediately.
- A large but physically ambiguous lateral innovation is quarantined only. One coherent following fix confirms the turn/new corridor; a return to the trusted corridor rejects the candidate; unresolved candidates expire at five seconds.
- A plausible relocation after callback loss is confirmed into a new segment. Only the corroborated edge inside that segment contributes distance; the unknown old-tail-to-new-head displacement contributes zero.
- Accepted coordinates remain canonical truth. A bounded causal live coordinate may smooth only within the same segment and stays within a small accuracy-aware envelope of the accepted tail.

The numerical continuity thresholds are **hypothesis-driven O43 calibration**. `wrong` proves the missing trajectory/outlier class but not universal threshold values. Constants are isolated and versioned, and the next walk records every privacy-safe input, decision, candidate transition, and introduced delay so calibration can be retained or revised without rewriting historical Activity truth.

Expected app-side latency is same-callback classification plus the awaited durable journal and store publication. Under good 1–3 second native callbacks the route should normally remain in that range; an ambiguous candidate may add one fix, never more than five seconds. Native callback scarcity remains outside app control and is measured separately.

## Background and gaps

Native background permission is refreshed at Activity Start, at every background activation, at foreground takeover, and on recovery. The module cache is only a mirror. A lifecycle transition never prompts; it registers only when the actual native grant exists. Registration, native-task start verification, callback batches, ownership generation, journal outcomes, drains, takeover, and errors are all recorded.

The exact O42 background failure remains **inconclusive**. The leading low-risk correction is explicitly hypothesis-driven: reuse an already verified OS task rather than stop/start churning it, preserve Fitness/no-auto-pause configuration, and instrument every boundary. Missing permission or failed registration is reported truthfully and opens continuity rather than pretending tracking remained continuous.

One central segment contract owns foreground, headless background, recovery, Resume, and Simulator-shared decisions. Gaps contribute zero route distance, elevation, matching geometry, and Memory traversal. Lifecycle time continues.

## Elevation, matching, Memory, and Save

- Elevation now has an independent causal quality reducer: valid vertical accuracy, three-sample median/low-pass filtering, accuracy-aware hysteresis, sustained time/distance support, descent anchor reset, and segment reset. Flat oscillation is not summed as climb.
- Matching resolves the existing EAS/Expo Mapbox public-token authority without logging a value, sends timestamp/radius-aware walking requests per segment, retains overlap, and records HTTP/result/quality evidence.
- A preview-environment synthetic walking request exercised that authority against Mapbox and returned HTTP 200, `code=Ok`, and one matching; neither the token nor request URL was printed.
- Confidence, coverage, raw-to-derived p95/max deviation, length distortion, and endpoint displacement gate each segment. Trusted endpoints are preserved only inside a bounded coverage envelope; otherwise that segment keeps canonical raw geometry.
- Immediate local completion, queued sync, server payload, and reopened Detail share one final matched-or-canonical geometry contract. Raw and canonical sources remain preserved.
- Memory remains incremental accepted evidence. Display-edge smoothing is clipped back to the union of existing buffered evidence, so it cannot reveal across gaps or Activity boundaries.
- Finish has a four-second total matching budget and a four-second immediate server-ack budget after local durable completion; timeout uses the idempotent pending-sync path. Derived server Memory attribution remains non-blocking.

## Diagnostic evidence

Privacy-safe telemetry covers observation quality/order/source, filter features and decision, candidate lifecycle, journal attempt/result/latency, store publication, React receipt, Mapbox source assignment request, background authorization/registration/task/callback/drain, segment decisions, Memory commits, elevation decisions, matching preflight/request/result/quality/fallback, final geometry, Save, and health watermarks. Precise real coordinates and token values are stripped.

The client keeps 2,000 events / 512 KiB with protected transition capacity and coalesced routine checkpoints. It uploads a bounded rolling snapshot every two minutes. Production merges successive snapshots by stable event identity up to 12,000 events / 8 MiB, preventing a final short window from replacing earlier provider/outlier evidence.

## Validation

- Permanent GPS gate `npm run verify:activity:gps`: 231/231 (client behavior, backend contracts, and 31 changed TypeScript files).
- Focused recovery/journal/Memory/offline/shared Activity evidence: 83/83.
- Frozen Simulator engine/store/correction regression: 52/52; no Simulator-core redesign.
- Telemetry churn self-test includes foreground, quarantine/reject, provider start, background callback, journal, gap, foreground return, elevation, matcher fallback, Save, Finish, and terminal health.
- Preview-environment iOS Expo export: pass, 4,139 modules and one Hermes iOS bundle.
- Backend commit `6c8e623f` deployed canonically; zero migrations; local/public DB health pass; backend and MySQL restart counts zero.

## Native walk

Walk normally in open sky, include one clear turn, lock the screen for 3–5 minutes while continuing, unlock and continue for 2 minutes, then Finish/Save. Report only Activity name, `qaSessionId`, approximate problem time, and a short observation. That should be sufficient to locate the first divergence without another speculative reproduction.
