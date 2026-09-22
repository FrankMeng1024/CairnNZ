# REAL HIKE OLD-vs-O41 ARCHITECTURE REPORT

Date: 2026-09-09 (Asia/Shanghai)

Repository: `/Users/mzm/Desktop/cairn/CairnNZ`

Current client marker: O41

Scope: real Hike/Run architecture forensic and Git normalization; analysis/documentation only

Evidence labels used throughout:

- **OBSERVED** — directly present in production data, retained telemetry, current/historical source, or the human report.
- **PROVEN** — evidence isolates the responsible layer with no material competing explanation.
- **HYPOTHESIS** — plausible explanation or proposed behavior not established by retained evidence.
- **INCONCLUSIVE** — decisive evidence was not retained or instrumented.

The detailed point-level evidence for Activity 2062 is in [`ALMOST_WORK_FORENSIC.md`](./ALMOST_WORK_FORENSIC.md).

## A. Recommendation

### RECOMMEND HYBRID OLD/NEW IMPLEMENTATION

Keep O41's Activity identity, ownership, provider fencing, durable journal, canonical accepted truth, incremental Memory semantics, explicit segments, recovery, and offline synchronization. Selectively reuse two good historical presentation ideas: a continuous-segment corridor/union renderer for Memory and a visually stable route derivative available before/at Finish. Do **not** restore the old provider ownership, recovery, timer, permissive background writes, all-track matching, or Save-dependent Memory.

This is “hybrid” at the technique level, not a return to the old architecture. The proven failures are individually correctable, but a truthful smooth Memory corridor needs Activity/segment continuity metadata that the flat O41 Memory schema currently discards. Matching also needs one explicit derived-geometry contract shared by local Detail, server Detail, and recovery. Those two additions are more coherent as a small hybrid architecture than as unrelated symptom patches.

The highest-priority corrections are:

1. Ring-fence the immutable O41 truth pipeline.
2. Make moving-but-moderate-accuracy samples eligible without the current 15 m wait.
3. Treat “background provider unavailable” as a known recording gap, while clearly surfacing `Always` authorization state.
4. Restore JavaScript matcher availability, feed it canonical accepted points, and protect trustworthy per-segment endpoints.
5. Separate Memory evidence from a continuity-aware, bounded visual corridor derivative.
6. Give live, immediate Detail, later server Detail, and recovery one versioned display-geometry contract.

### Fifteen explicit answers

| # | Question | Answer |
|---:|---|---|
| 1 | Why does live trace lag? | **PROVEN:** the native puck and accepted route have different authorities. The indoor-drift acceptance gate reduced ~4 s callbacks to 13 s median / 24.3 s p95 accepted updates. Journal/store/React propagation was ordinarily fast. Exact final Mapbox paint latency is **INCONCLUSIVE**. |
| 2 | Why is background evidence lost? | **PROVEN for `almost work`:** cached background authorization was false, so no background provider was registered and no fixes reached CairnNZ. Authorized-background performance remains **INCONCLUSIVE** on recent real evidence. |
| 3 | Why can a straight connector appear? | **PROVEN:** a 37.146 s / 57.04 m background absence remained one segment, so adjacent accepted endpoints were rendered as a normal edge. |
| 4 | Why does saved Detail differ from live? | **PROVEN:** Finish substitutes a derived match or Kalman fallback. O41 also uses accepted points for immediate no-match local Detail but smoothed points for the server, so authority can change after hydration/restart. |
| 5 | Is current Snap-to-road losing head/tail points? | **PROVEN NO for `almost work`:** matching never ran; filtering omitted two tail fixes and Kalman moved the accepted endpoint 48.5 m. Across current matched Activities, endpoint displacement is **OBSERVED**, but matcher-specific omission versus accepted input is **INCONCLUSIVE** without full ordinal telemetry. |
| 6 | Should start/end coordinates be anchored? | Yes: use the first/last trustworthy canonical accepted point per continuous segment as accuracy-aware strong anchors, with bounded connectors or raw fallback—not unconditional raw-fix locks. |
| 7 | What did old matching do better? | It was actually available in the surviving examples and permissively beautified a whole walking path; session 193 was strong. It was not uniformly better and could cross gaps or choose adjacent paths. |
| 8 | What did old background tracking do better? | No native setting advantage is proven. With permission, its permissive writer could retain more-looking evidence, but without ownership/order/recovery safety. It would also fail in the `almost work` permission state. |
| 9 | Why did old Memory look smoother? | **PROVEN:** it simplified a matched/Kalman line, interpolated and buffered it into a wide corridor, then unioned polygons. |
| 10 | Can old Memory smoothing be reused truthfully? | Yes, only as a display derivative joining same-Activity/same-segment adjacent evidence within bounded continuity, clipped to a truthful envelope. Never reuse the 60-minute/100 m proximity inference. |
| 11 | What must O41 retain? | Global ownership, stable identity, provider fences, native ordering, journal-first durability, raw/accepted separation, recovery, explicit segments, lifecycle timer, incremental Memory, offline/idempotent sync, tombstones, and Simulator parity. |
| 12 | Best combined architecture? | O41 immutable audit/canonical truth plus optional provisional live presentation and a versioned, recomputable matched display derivative; Memory gets the same truth/display split. |
| 13 | Can Save remain fast with quality matching? | Yes. Durably complete locally first, then run an idempotent/versioned derivative refinement, with a ~1 s fast path and canonical fallback. Memory never waits for matching. |
| 14 | What is Simulator `×2`? | **PROVEN:** replay/time scale. It multiplies virtual elapsed time; it is not the separate physical movement speed. The selected value reaches the runtime engine. |
| 15 | What acceleration exists/should be exposed? | `1×`, `2×`, `5×`, `10×`, `30×`, `60×`, `120×` exist. Normal expanded UI exposes 1/5/10/30/60/120; Advanced exposes 2. Improve labels/visibility later; do not invent `4×` or change the frozen engine. |

## B. `almost work` identified

**PROVEN:** the target is production session `2062`, user `72` (`frank`), client Activity `3db88be5-4f0a-4fab-a5ae-a619c4ccfb59`. It started at `2026-09-09T13:41:54Z`, finalized at `13:50:53Z`, and correlates with QA session `qa-mtu5a2gn-5mebni0q`.

The Activity has 105 raw samples, 42 accepted points, 65 filter rejections, one segment, 42 saved display points, 33 persisted Memory evidence points, 644.894 m distance, 527 s duration, and 36.761 m elevation gain. The retained telemetry bundle is uncapped and contains 497 events. All production access was read-only `SELECT`; no data was mutated.

## C. Current foreground pipeline

```text
Expo foreground provider (BestForNavigation)
  → native callback
  → provider/owner/generation fence
  → canonical sample with native timestamp
  → ordered ingest queue
  → raw/audit append
  → accuracy/speed/stationary/indoor-drift decision
  → accepted sample
  → durable journal append
  → tracking-store publish
      → distance/elevation/pace
      → live route
      → incremental Memory evidence
  → periodic server tail append / finish reconciliation
```

**PROVEN:** current foreground provider settings request `BestForNavigation`, a 5 m distance interval, and a dynamic time interval: approximately 10 seconds when static, 1 second while walking, and 0.5 seconds while running. A three-second initial mode is also present. Actual `almost work` callback cadence was about four seconds at the median; requested intervals are hints, not delivery guarantees.

Provider callbacks do not mutate Activity state directly. The active user's global unfinished Activity record, `clientActivityId`, provider source, owner, and generation are checked before a sample enters the serialized canonical path. Accepted points are journaled before the store publishes them. This ordering is a core O41 correctness guarantee.

**PROVEN:** the Activity timer is lifecycle/wall-clock derived and no longer depends on a JavaScript `+1 second` interval remaining scheduled in background. Distance, elevation, and pace are computed from canonical accepted points per segment. Gap boundaries do not accumulate route distance.

## D. Current background pipeline

```text
AppState background
  → stop foreground watcher
  → if cached background authorization is true:
       start owner-fenced Expo TaskManager provider
       batch delivered locations
       serialize through canonical ingest/journal/store
    otherwise:
       return without registering background provider

AppState foreground
  → stop background provider
  → drain fenced late queue in timestamp order
  → restart foreground watcher after ownership/source transition
```

The background provider requests `BestForNavigation`, 5 m distance interval, approximately 1 second time interval, Fitness activity type, automatic pausing disabled, and the iOS background indicator. The Info.plist/native configuration contains background location mode and explanatory strings.

**PROVEN for `almost work`:** cached background permission was false. Four background windows totaled 78.364 seconds; there were zero background activation, callback, rejection, acceptance, or error events. The Expo Location module was demonstrably available because foreground callbacks were active. O41 therefore stopped its foreground watcher but never registered a background provider.

**INCONCLUSIVE:** no retained recent real O41 Activity proves callback/queue behavior while `Always` permission is granted. Current source and automated contracts cover that path, but real-device delivery must be revalidated before changing accuracy or batching parameters.

Expo's iOS contract requires `Always` for background location; Apple likewise makes background delivery dependent on application authorization/configuration and manager settings.[^expo-location] [^apple-background]

## E. Current live-trace latency evidence

For `almost work`:

| Layer | Median | p95 | Max | Conclusion |
|---|---:|---:|---:|---|
| Foreground callback interval | 4.000 s | 6.756 s | 9.000 s | Retained foreground intervals; partial aggregate window |
| Full raw interval | 4.000 s | 9.000 s | 37.146 s | Maximum includes background provider absence |
| Accepted interval | 13.000 s | 24.298 s | 37.146 s | First material lag |
| Sample→store publication | 118 ms | 1,952 ms | 3,457 ms | Smaller than accepted cadence |
| Ingest queue | 0 ms | 1 ms | 1 ms | Not causal |
| Journal | 23 ms | 30 ms | 38 ms | Not causal |
| Journal→store | 0 ms | 1 ms | 1 ms | Not causal |
| Store→mounted React trace | ~5 ms | ~7 ms | ~14.0 s | Max was screen unmount/remount |
| ShapeSource→final paint | — | — | — | **INCONCLUSIVE**, not instrumented |

The indoor-drift rule rejected 52 of 107 canonical decisions. When accuracy was worse than 12 m or absent, it withheld fixes until the user moved at least 15 m from the last accepted point or 30 seconds elapsed—even when reported speeds were 1.1–2.0 m/s. That produced the exact visible pattern: the native Mapbox puck continued ahead, while the accepted route advanced roughly every 13 seconds.

**PROVEN answer 1:** live trace currently lags because the route's acceptance gate is much sparser than the separate native puck authority. Ordinary journal, store, and React propagation are not the cause. Exact Mapbox paint latency is **INCONCLUSIVE**, but it is downstream of a proven, much larger acceptance delay.

## F. Current background loss evidence

Four AppState background windows were 33.178 s, 18.738 s, 4.242 s, and 22.206 s. No background provider was active in any of them.

**PROVEN answer 2:** the missing route evidence was never delivered to CairnNZ because cached background authorization was false and O41 did not request background updates. It was not delivered-and-rejected, accepted-and-unpersisted, or persisted-and-unrestored. The precise layer is provider registration/authorization.

The current lifecycle has a second defect exposed by that event: failure to activate the background provider is logged only indirectly and is not converted into an Activity gap. The foreground recovery point can therefore remain in the prior segment.

## G. Straight connector explanation

The largest connector spans 37.146 seconds and 57.04 m. It begins immediately before the first background window and ends on foreground return. Both endpoints share one segment ID. O41's gap logic requires an explicit known-loss signal, implausible speed after uncertainty, or a longer uncertainty threshold; the older compatibility threshold requires both 120 seconds and 200 m.

**PROVEN answer 3:** the line is a same-segment edge across missing intermediate samples. Matching did not run, and no explicit gap existed for the renderer to respect. Lifecycle telemetry knew continuity was unavailable, but the canonical Activity did not encode it.

## H. Current matching pipeline

Current O41's intended matching path is:

```text
accepted Activity segments
  → finish-time Kalman-smoothed input (current implementation)
  → classify runs as good/lost from accuracy and speed
  → per-segment, per-run Mapbox walking match
  → chunks of 80, overlap 10
  → confidence ≥ 0.3
  → p95 deviation, endpoint-envelope, and length-ratio gates
  → seam stitching and final 3 m/window-3 cleanup
  → raw/densified fallback per failed run
```

The architecture correctly matches per segment and has quality gates. However:

- `speed === -1` is treated as a lost run even though Core Location uses negative speed for “unavailable,” not necessarily signal loss.
- Matching input is finish-time Kalman output rather than immutable canonical accepted points.
- Chunk seam selection minimizes geometric proximity within a small overlap rather than preserving raw progress/ordinal identity.
- Lost-run fallback densifies straight bridges, which is acceptable only within proven continuity—not across gaps.
- The final cleanup preserves its own output endpoints, not the canonical segment anchors.
- The JavaScript matcher depends on `EXPO_PUBLIC_MAPBOX_TOKEN`, while native map rendering can retain a binary-configured token. Those authorities can diverge silently.

For `almost work`, matching was skipped because the JavaScript token was empty in that runtime. `matched=false`, duration zero, and no request/result events prove this.

## I. Endpoint/head-tail analysis

`almost work` retained its first accepted endpoint exactly. Its saved server endpoint was moved 48.491 m from the final accepted point by the smoothing fallback. The final two delivered points, representing another 11.861 m, were rejected by the canonical filter; the final saved point is 59.396 m from the final raw callback.

Explicit answers:

1. **Did current matching drop trailing raw points?** **PROVEN NO for `almost work`:** it never ran. Filtering dropped two trailing samples from accepted truth.
2. **Did the request omit them?** **PROVEN:** there was no request.
3. **Did chunking lose them?** **PROVEN:** no chunking ran.
4. **Did fallback trim them?** **PROVEN:** not matcher fallback; finish smoothing moved the accepted endpoint.
5. **Did display geometry omit them?** **PROVEN YES:** the display omitted rejected tail evidence and displaced the accepted endpoint.
6. **Should coordinates be anchored?** Anchor the first and last trustworthy canonical accepted point of every continuous segment, subject to accuracy/deviation gates. The middle remains matchable/beautifiable.
7. **Endpoint-locking edge cases:** a poor fix at a building/parking area, broad accuracy ellipse, intentional privacy transform, explicit gap boundary, or legitimately off-trail start/end can make literal locking wrong. Use bounded anchor connectors or whole-segment raw fallback when the match cannot reconcile safely. Never lock arbitrary raw/audit noise.

Session `2059` shows a similar current real tail symptom: raw/display length ratio `0.5913` and roughly `44.5 m` tail displacement. Retained matching evidence for that session indicates the matcher received the accepted series, so it does not prove arbitrary raw-tail omission either; it reinforces that canonical eligibility and endpoint gates must be analyzed separately.

## J. Current Save pipeline

Current Save ordering is correctness-oriented:

```text
pause/fence provider
  → reconcile journal and accepted/raw snapshot
  → optional blocking local Mapbox match
  → reconcile incremental Memory
  → serialize display/raw/Memory payload
  → durable local pending Activity + completion registry
  → blocking server save (20 s wall-clock bound)
  → persist server acknowledgement and clear pending
  → reset/navigation
```

`almost work` timings:

| Stage | Stage | Cumulative |
|---|---:|---:|
| Finish reconciliation | 40 ms | 40 ms |
| Matching, skipped | 0 ms | 41 ms |
| Memory reconciliation | 11 ms | 52 ms |
| Serialization | 0 ms | 52 ms |
| Local durable completion | 52 ms | 104 ms |
| Server request | 59 ms | 164 ms |
| Ack persistence | 17 ms | 181 ms |
| Navigation vicinity | — | ~225 ms |

A retained O38 simulator session matched 277 accepted points to 53 points in about 513 ms and completed the recorded save/ack path in about 890 ms. Therefore good matching need not imply a 20-second Save. Historical reports of ~20 seconds are compatible with network/matcher bounds, but historical stage timings were not retained.

**PROVEN answer 13:** Save can remain fast while preserving higher-quality matching, provided derived work has an immutable input, durable pending intent, idempotent/versioned result, and a safe raw display fallback. `almost work` does not prove that a speed optimization reduced quality; its matching quality was absent because matching never ran.

## K. Current Memory pipeline

```text
canonical accepted point
  → durable Activity journal/store
  → Memory point record during Activity
  → proximity/cell cull
  → local monotonic Memory
  → Save-time reconciliation of any journaled accepted points
  → atomic server source-point upload
  → server derived unlocked-region projection
```

Memory is not derived from final matching. It is incremental, monotonic, accepted-GPS based, and rollback does not erase it. Explicit Activity gaps and separate Activities do not create Memory connector evidence.

For `almost work`, all 33 persisted Memory rows correspond exactly to accepted timestamps/coordinates. Forty-two accepted events invoked Memory recording; proximity culling produced 33 distinct rows.

**PROVEN:** visual roughness comes from uneven sparse accepted points plus the point/cell rendering derivative. It is not caused by the match result. **OBSERVED:** the synchronized Memory record lacks durable Activity ID, segment ID, ordinal, and continuity metadata, so downstream rendering cannot safely infer which nearby points may be joined.

## L. Pre-rewrite CC commit/version identified

**PROVEN:** the last meaningful pre-rewrite CC Hike tree is commit `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c` (2026-09-05, `friend new ui`). It is the final Hike implementation immediately before the large Free Activity/Hike-Run rewrite.

The rewrite commit is `05ec25786ef4f137e3c8af8493b4ebc379a0b305` (2026-09-07), parent `bbcc37`, changing 76 files with roughly +10,658/−4,065 lines. Preserved local branch history includes `cf444c0` (`rewrite hike and run`), also descended from the `a915` era.

The relevant old subsystems have deeper provenance—provider/background work at `738286b`, matching at `2ea74d3`, Fog/Memory rendering at `1293717`, and Memory flush behavior at `2c56a2a`—but `a915` is the correct comparison snapshot because it integrates the last pre-rewrite Hike UI/store behavior. It was selected by graph position and subsystem meaning, not merely age.

## M. Old foreground pipeline

```text
Expo foreground provider
  → callback
  → Date.now()-based point
  → synchronous Zustand addTrackPoint
  → same family of accuracy/speed/stationary/indoor gate
  → immediate in-memory live update
  → fire-and-forget journal/raw writes
  → live Kalman-smoothed route
```

Provider accuracy and distance/time settings were materially the same as current O41. The old route looked smoother because the live map rendered `trackPointsSmoothed`, not because it received more native points. Store publication did happen before durability, so it could look instant at the cost of crash/recovery correctness.

The old filter was not better:

- it had the same core indoor-drift behavior;
- it lacked the current 30-second stationary heartbeat;
- it advanced its last-coordinate clock on rejected samples, which could delay reacquisition;
- its raw append could execute even for a no-op/rejection because it did not verify the accepted-array length changed;
- it replaced native sample timestamps with `Date.now()`, weakening ordering/provenance.

**PROVEN:** the remembered smoother/fresher appearance came principally from rendering a heavily smoothed live derivative and from publication-before-durability. The old architecture does not provide a sound acceptance algorithm to restore.

## N. Old background pipeline

The old provider configuration was essentially the same as O41: Expo TaskManager, `BestForNavigation`, 5 m, ~1 second, Fitness, automatic pause disabled, background indicator. Its one-time permission education/request path was also materially the same. It therefore would also have failed to register background tracking in the `almost work` permission state.

When permission was available, the old task pushed native rows into an in-memory queue. If the normal logger was inactive, it could directly read/modify/write a raw JSONL file using only a “hike active” flag and session ID. That permissive path might have retained more apparent evidence in some historical runs, but it had no user fence, generation fence, global owner, segment identity, strict ordering, or safe late-queue lifecycle. In one logging mode it returned after logging and left data only in the queue. Draining depended on `backgroundTaskActive`, so late rows could strand.

Old recovery selected a recent file by Activity mode within 72 hours, not by exact global Activity/user ownership. It could rehydrate all journal rows and connect them as one distance path.

**Answer 8:** no source evidence shows old CC requested more native callbacks or used stronger iOS options. Its perceived continuity can be explained by a device that had `Always` authorization and by more permissive, less fenced persistence/rendering when callbacks existed. Those semantics were less trustworthy. The old native settings are not worth restoring.

## O. Old matching pipeline

Old Finish submitted one whole smoothed track with only latitude, longitude, and timestamp. Omitting accuracy and speed made nearly all points “good” under the matcher defaults, with roughly 15 m radiuses. It used the same walking profile and broadly similar 80-point/10-overlap chunking, seam proximity, bridge densification, and window cleanup, but it had no O41 per-segment contract and fewer quality gates.

This could create visually strong continuous snaps where the map and GPS agreed. It could also match across real recording gaps, force an adjacent path, or invent a connector. It did not preserve canonical raw start/end anchors.

Historical production examples are mixed:

- session `193`: p50/p95/max raw→display deviation `2.796/11.468/16.428 m`, length ratio `1.0031`, head/tail `4.608/7.066 m` — credible;
- session `192`: `24.220/70.121/79.527 m`, length ratio `1.1414`, head/tail `10.512/0.385 m` — poor.

**Answer 7:** old matching did better when it was actually available and when its permissive whole-track input let Mapbox produce a visually coherent route. It did not do better consistently or safely. The reusable ideas are reliable matcher availability, walking-profile middle beautification, overlap, and visually stable fallback—not all-track continuity or omission of evidence metadata.

## P. Old Memory pipeline

Old Memory was produced at Save, not incrementally. It used matched route output if matching succeeded, otherwise a Kalman-smoothed route, then Ramer–Douglas–Peucker simplification around 3 m before H3/flat persistence. The Fog renderer inferred “segments” primarily from a 60-minute time gap, then could merge segments whose endpoints were within 100 m. It simplified lines around 5 m, buffered them around 30 m with interpolation steps, and unioned the polygons.

**PROVEN answer 9:** old Memory looked smoother because it converted a smoothed/matched, simplified line into wide buffered/unioned corridors. The shape was not merely a nicer renderer over the same truth. It could depend on Save/matching and join evidence across true GPS gaps or separate Activities.

**Answer 10:** the corridor-buffer/union concept can be reused only when constrained by O41 evidence: join adjacent points only when they share Activity ID and segment ID and pass bounded time/distance/accuracy continuity. Clip any renderer smoothing to the union of truthful point buffers and verified segment corridors. Do not reuse old 60-minute/100 m inference, matched-route authority, or Save dependence.

## Q. Old vs current comparison matrix

| Area | Old CC | Current O41 | Old advantage | Current advantage | Old risk | Best future design |
|---|---|---|---|---|---|---|
| 1. Foreground raw GPS cadence | BestForNavigation, 5 m, dynamic intervals | Materially same settings | None proven | Better native timestamps/provenance | Assumed `Date.now`; weak audit | Keep config initially; instrument actual unique fixes |
| 2. Accepted filtering | Same indoor gate; no heartbeat; rejection advances clock | Same core gate plus heartbeat and better ordering | None proven | Safer reacquisition/order | Sparse line and worse rejected-state semantics | Motion-aware coherent acceptance; retain hard accuracy/speed gates |
| 3. Puck authority | Native Mapbox | Native Mapbox | Fresh | Fresh and isolated | Diverges from Activity truth | Keep fresh puck; explicitly design relationship to trace |
| 4. Live trace authority | Kalman-smoothed accepted derivative | Canonical accepted points | Cosmetically fluid | Truthful and identical to metrics | Spatial endpoint lag hidden by smoothing | Canonical truth plus strictly provisional visual tail if needed |
| 5. Live trace latency | Store published before durability | Journal before store | Immediate appearance | Crash-safe | Lost/unjournaled visible point possible | Preserve journal-first; fix acceptance, not durability |
| 6. Smoothing | Strong live Kalman | No live smoothing; server fallback Kalman | Softer line | No invented live truth | Lag/overshoot and endpoint movement | Bounded renderer-only smoothing clipped to truth envelope |
| 7. Foreground persistence | Fire-and-forget journal/raw | Ordered durable journal before publication | Low apparent cost | Durable and restorable | Crash race/duplicates | Keep O41 |
| 8. Background native tracking | Same TaskManager options | Same essential options plus fencing | None proven | Owner/provider isolation | Unowned writes | Keep O41; make authorization/gap explicit |
| 9. Background batching | In-memory queue and permissive direct JSONL fallback | Fenced ordered canonical queue | Could retain rows under permissive state | Same filter/truth path | Stranded/duplicated/cross-owner rows | Keep O41; add metrics and bounded drain acknowledgement |
| 10. Background recovery | Recent file by mode within 72 h | Exact Activity/user registry and journal | Simple | Correct identity/crash recovery | Wrong-user/zombie recovery | Keep O41 |
| 11. Gap detection | Time heuristics; mostly continuous | Known-loss/uncertainty rules | Fewer visual breaks | Can represent truth | Connects missing evidence | Emit gap immediately when provider unavailable/background continuity unknown |
| 12. Segmentation | Effectively one path; renderer inferred gaps | Explicit segment IDs/reasons | Smooth-looking | Correct distance/match/render partitions | Invented connectors | Keep O41; persist lifecycle gap reason |
| 13. Activity timer | JS `+1 s` interval | Wall/lifecycle/provider clock | Simple | Accurate across background/suspension | Timer freezes/drifts | Keep O41 |
| 14. Distance | Continuous point chain | Canonical per-segment accepted chain | Simple | No gap distance | Counts connectors | Keep O41; improve eligibility only |
| 15. Elevation | Accepted/smoothed-era accumulation | Canonical per-segment filtering | Visually stable | Provenance/recovery safe | Gap/noise coupling | Keep O41; evaluate separately after trace fix |
| 16. Pace | Depends on JS timer/continuous distance | Wall duration + canonical distance | Familiar | Lifecycle-correct | Background timer error | Keep O41 |
| 17. Memory evidence | Save-time matched/smoothed route | Incremental accepted GPS | Smooth input | Truthful, monotonic, Save-independent | Snap can invent territory | Keep O41 data truth |
| 18. Memory rendering | Simplified 30 m line buffers + union; heuristic merge | Sparse point/cell footprints | Smooth corridor | Avoids connector invention | Cross-gap/activity fabrication | Reuse corridor rendering only with durable continuity metadata and clipping |
| 19. Finish reconciliation | Loose in-memory/file state | Fenced journal/raw/accepted reconciliation | Less work | Crash-safe immutable snapshot | Lost late samples | Keep O41 |
| 20. Map matching | Whole smoothed route, permissive points | Per-segment runs + gates | More likely to return a strong snap | Safer fallback/quality | Matches across gaps/adjacent paths | O41 segmentation/gates with canonical middle input and reliable token |
| 21. Matching chunking | 80/10, proximity seam | 80/10, proximity seam per run | Proven practical | Segment isolation | Seam can jump progress | Overlap with raw ordinal/progress constrained stitching |
| 22. Start endpoint | Matcher output | Matcher/output gate, not raw anchor | Sometimes close | Endpoint envelope gate | Can move start | Trustworthy canonical segment-start anchor with bounded connector |
| 23. End endpoint | Matcher output | Matcher/output gate, not raw anchor | Sometimes close | Endpoint envelope gate | Can truncate/move tail | Trustworthy canonical segment-end anchor; never Kalman-move it |
| 24. Display geometry | Matched/smoothed | Live accepted; saved matched or smoothed; local/server fallback differs | Consistent-looking when match works | Raw truth remains stored | Hidden shape substitution | One versioned derivative contract across live/Detail/server |
| 25. Save blocking stages | Match + Memory flush + network | Reconcile + match + Memory reconcile + local commit + network | All work finished before exit | Durable local pending first | Long/fragile Save | Navigate after durable local completion; bounded fast-path derivative; durable async refinement |
| 26. Activity Detail route source | Server/local legacy route | In-memory local first; server after hydration | Often same finish derivative | Offline local fallback | Authority ambiguity | Explicit raw and derived versions; same selection rule everywhere |
| 27. Raw-data preservation | Loose JSONL, mixed accepted/rejected semantics | Raw audit + canonical accepted + provenance | More permissive capture | Forensic, ordered, identity-safe | Duplication/cross-owner mutation | Keep O41 |
| 28. Offline/recovery safety | Mode/time-based file recovery | Pending payloads, idempotency, registry, tombstones, exact ownership | Simpler | Strong correctness | Orphans/zombies/data crossover | Keep O41 unchanged |

## R. What old implementation did better

- **OBSERVED:** live route presentation looked smoother because it rendered the Kalman derivative.
- **PROVEN:** Memory looked like a coherent corridor because it simplified, buffered, interpolated, and unioned line geometry.
- **OBSERVED:** successful old matching examples had a functioning matcher and permissive route eligibility; session 193 was geometrically strong.
- **HYPOTHESIS:** on devices with `Always` permission, permissive background raw writes could make historical tracks appear more complete.
- The old product treated finish geometry as one visible presentation result more consistently than O41's current local/server no-match split.

None of these findings proves that the old canonical capture was more correct.

## S. What old implementation did worse

- Published route state before durable journaling.
- Used `Date.now()` instead of preserving native sample time.
- Had no global unfinished Activity ownership, generation/provider fences, or robust client identity.
- Had unsafe direct background file writes and queue lifecycle.
- Recovered by mode/time recency rather than exact owner and Activity.
- Used a JavaScript interval timer that could suspend.
- Had no explicit gap/segment truth and could count/render straight connectors.
- Fed whole smoothed paths through matching across missing evidence.
- Generated Memory only at Save and could use matched geometry as exploration authority.
- Inferred/merged Memory segments with broad 60-minute/100 m heuristics, which could fabricate explored territory.
- Had weaker offline, idempotency, deletion/tombstone, and zombie-mutation protections.

## T. What O41 must preserve

**Answer 11:** all of the following are locked architectural gains:

- one global unfinished Activity and exact user ownership;
- stable `clientActivityId` and server identity mapping;
- provider source, owner, and generation fencing;
- native timestamp/order handling and late-queue protection;
- durable journal before visible accepted publication;
- raw audit evidence separate from canonical accepted truth;
- crash recovery from exact Activity state;
- explicit gaps/segments and per-segment metrics/matching;
- wall/lifecycle-correct duration;
- incremental, monotonic, accepted-GPS Memory independent of Save;
- rollback semantics that do not erase exploration already recorded;
- durable pending sync, idempotent save, offline start, acknowledgements, and tombstones;
- provenance and zombie mutation protections;
- Simulator provider parity and all frozen Simulator core behavior.

## U. Recommended combined architecture

**Answer 12:** use four explicit layers with immutable authority boundaries:

```text
1. Audit evidence
   Every ordered delivered native fix, reason codes, accuracy/speed/source

2. Canonical Activity truth
   Accepted points + Activity/segment/ordinal + gaps
   Owns metrics, journal, recovery, incremental Memory evidence

3. Provisional live presentation
   Canonical route plus optional bounded, ephemeral preview tail
   Never owns distance, persistence, Memory, or saved truth

4. Versioned derived presentation
   Per-segment matched/beautified geometry with quality/provenance
   Recomputable; must retain canonical anchors/envelope; raw fallback available
```

Memory follows the same truth/derivative split:

```text
Memory data truth: accepted evidence carrying Activity/segment continuity identity
Memory display: bounded corridor/union derivative generated only inside proven continuity
```

This architecture takes the old renderer's visual coherence and finish consistency while keeping O41 as the only source of truth.

## V. Live route proposal

First correct the proven acceptance behavior. The indoor-drift gate should distinguish credible motion from static drift: when accuracy is moderately degraded but speed, bearing/progression, time ordering, and recent fixes form a coherent walking path, it should not require a full 15 m displacement. Hard poor-accuracy, overspeed, timestamp, provider, and ownership rejection remains.

Do not reduce journal guarantees; 23 ms median is not a UX problem. Do not change native GPS configuration until real authorized-background telemetry establishes a need.

Maintain two visible representations:

- fresh native puck, clearly current-position authority;
- canonical accepted line, normally close behind after filter correction.

If real validation still exposes a distracting 4-second physical gap, add an optional live-only preview tail from the most recent fix only after hard plausibility checks. Style it subtly, cap its age/distance, and remove/reconcile it on the next canonical decision. It must not update distance, pace, elevation, persistence, Memory, or saved route. Interpolation may occur only between known time-ordered points in the same continuous provider interval; never extrapolate across background loss.

**Answer 1 status:** filter cause **PROVEN**; need for a preview tail after filter correction **HYPOTHESIS**.

## W. Background tracking proposal

1. Before an Activity enters background, expose whether full background tracking is authorized. “While Using” must not imply that route capture will continue.
2. When background activation cannot occur, durably record a `background_provider_unavailable` gap immediately. On foreground return, the next accepted point starts a new segment. Never render/count the missing interval as movement.
3. With `Always` granted, keep O41's owner-fenced TaskManager and canonical ingestion. Add explicit activation attempt/result, batch size, oldest/newest timestamp, drain acknowledgement, and source-stop telemetry.
4. Validate several real-device background cycles before considering accuracy/time/distance changes. Compare callback, accepted, journal, and restore counts end-to-end.
5. Handle late rows only when owner, generation, Activity ID, source, timestamp order, and gap boundaries agree.

Battery impact is low for permission/gap/telemetry changes. Changing BestForNavigation cadence would have a higher battery impact and is not evidence-supported yet.

**Answer 8:** do not restore the old background writer. There is no old native-option advantage to recover.

## X. Matching / beautification proposal

Use canonical accepted points as immutable input; smoothing is a display operation, not matcher evidence. Match each continuous segment independently with the walking profile.

Recommended steps:

1. Pre-filter only clearly invalid accepted anomalies; retain stable source ordinals and timestamps.
2. Distance-resample the **middle** for matcher stability without removing first/last canonical anchors.
3. Classify negative speed as “unknown,” not automatically “lost.”
4. Chunk with overlap, but stitch by monotonic source progress/ordinal plus geometry—not proximity alone.
5. Preserve the first/last trustworthy accepted point per segment. If the matched path begins/ends within a bounded accuracy-aware threshold, connect it to the anchor; otherwise reject/fallback that segment.
6. Apply confidence, p50/p95/max deviation, endpoint displacement, length distortion, topology, and off-route gates.
7. Never bridge an explicit gap. A failed chunk falls back to its canonical subpath; no densified straight line across missing evidence.
8. Simplify/smooth only after the matched path passes gates, while retaining anchors.
9. Store raw canonical and derived geometry separately with algorithm version, match status, confidence/quality metrics, input hash, and timestamps.
10. Unify native map and JavaScript matcher token authority. Treat unavailable matching as an explicit state, not a silent visually different fallback.

**Answer 6:** start/end should be strong accuracy-aware canonical anchors, not unconditional locks to arbitrary raw fixes.

## Y. Memory smoothing proposal

### MEMORY DATA TRUTH

Keep each accepted Memory evidence point monotonic and irreversible. Extend source evidence, locally and through sync, with optional:

- `clientActivityId`;
- `segmentId` and segment-start reason;
- source ordinal/native timestamp;
- accuracy/source/continuity class.

Do not alter old rows and do not infer connector identity across Activities.

### MEMORY DISPLAY BEAUTIFICATION

Build a recomputable corridor derivative:

1. Always buffer truthful evidence points by the existing minimum radius.
2. Join only adjacent points with the same Activity and segment identity.
3. Require bounded time, distance, plausible speed, accuracy, and no known-loss boundary.
4. Densify/interpolate only inside that proven adjacent segment interval.
5. Simplify the centerline conservatively, buffer it to a minimum corridor width, and union it with source point buffers.
6. Apply morphological/renderer smoothing only within—or clipped to—the evidence-plus-continuity envelope.
7. Cache/version this polygon derivative, but keep the evidence points as authority so it can be rebuilt.

For legacy Memory lacking identity, render point buffers and allow only boundary smoothing that does not expand outside their union. Do not use spatial proximity alone to join them.

**Answers 9–10:** old smoothness came from line simplification, interpolation, broad buffering, and polygon union over match/smoothed input. The visual operations can be reused safely only with O41 segment continuity and clipping; the old truth semantics cannot.

## Z. Save latency proposal

Split completion into two crash-safe stages:

### Stage 1 — must block navigation

- fence/stop the provider;
- reconcile journal and immutable canonical/raw/Memory evidence;
- compute final canonical metrics;
- durably store a local completed Activity, raw/canonical geometry, and a pending derived-work/sync intent;
- render Detail immediately using the same canonical or already-available bounded preview derivative used at Finish.

### Stage 2 — may refine after local durability

- perform final versioned per-segment matching on the immutable snapshot;
- atomically publish the derivative only if quality and visual-delta gates pass;
- sync source Activity and derived version idempotently;
- retain a pending intent across crash/offline state;
- never delay or rewrite Memory evidence.

A bounded fast path may wait roughly up to one second for matching; retained evidence shows a 513 ms match is possible. Otherwise navigate with canonical geometry and show a quiet “Refining route” state. Swap only if the result is close enough to avoid a surprising route B. Endpoint anchors and using the same lightweight derivative during live/Finish further minimize the transition.

Server support is likely required for versioned derived-geometry update/provenance if source sync completes before refinement. That endpoint must be idempotent by `clientActivityId + input hash + algorithm version` and must never overwrite raw evidence.

**Answer 4:** saved Detail differs because current code substitutes matched or Kalman geometry at Finish and even chooses different no-match fallback authority locally versus after server hydration. A single versioned derivative contract removes this ambiguity.

## AA. Simulator acceleration explanation

Simulator core remains functionally frozen. No change is recommended outside acceleration discoverability.

**PROVEN answer 14:** visible `×2` is replay/time scale, not physical movement speed. Physical speed remains a separate choice (slow/walk/brisk/hike/run/custom). The engine advances virtual elapsed time by wall elapsed × selected scale, then moves distance using physical speed over that virtual time. Emitted location `speed` remains the physical speed. The selected scale is persisted in the Simulator store and read by the runtime engine every tick.

**PROVEN answer 15:** implemented replay scales are `1×`, `2×`, `5×`, `10×`, `30×`, `60×`, and `120×`.

- Normal expanded native UI exposes `1×`, `5×`, `10×`, `30×`, `60×`, and `120×` in the Time Scale row; the row may require expansion/scrolling.
- `2×` is exposed in Advanced/More beside custom physical speed and can appear in the collapsed chip as `SIM · 2×`.
- `60×`/`120×` are still implemented, reachable, and exercised by engine contracts; they did not regress.
- The runtime limits each emitted virtual step to 10 seconds, permits up to 12 samples/120 virtual seconds per tick, and caps a run at 12 virtual hours.

A new `4×` concept is unnecessary. The smallest later correction is to label the chip `Replay 2×`, move/keep Time Scale near the primary controls, ensure its horizontal choices are visibly scrollable, and perhaps expose a quick selector. Users already have 5× through 120×. No Simulator provider, movement, gap, rollback, Memory, joystick, Auto Move, or business-pipeline behavior should change.

## AB. Three implementation options

| Dimension | Option A — Minimal O41 correction | Option B — Hybrid old/new | Option C — tracking pipeline redesign |
|---|---|---|---|
| Components changed | Filter motion exception; background-unavailable gap; matcher token/anchors; conservative Memory renderer; unify no-match fallback | Option A plus continuity metadata, corridor derivative, versioned local/server display geometry, crash-safe derived refinement | Replace ingest/accept/presentation/derived stack and schema broadly |
| Expected UX | Line advances faster; honest background break; safer endpoints; somewhat smoother Memory | Close-to-live truthful line; honest gaps; smoother truthful Memory; minimal Save transition; later route refinement | Potentially best long-term uniformity, but delayed benefit |
| Correctness risk | Low–medium | Medium, bounded by immutable O41 truth | High |
| Battery impact | Low if GPS config unchanged | Low; derived rendering/processing mostly CPU/network after capture | Unknown; likely medium until tuned |
| Offline/recovery | Preserved | Preserved and extended with durable derived intent | Must be re-proven end-to-end |
| Complexity | Small–medium | Medium | Large |
| Migration/backend | Maybe token/config and minor display metadata | Optional Memory metadata migration + derived geometry/version endpoint | Broad schema/API/client migration |
| Testing cost | Focused real hikes and contracts | Multi-layer contracts, migrations, offline/crash, real-device matrix | Full system recertification |
| Main limitation | Legacy Memory cannot safely become a continuous corridor; derivative authority remains thin | Requires careful metadata/backward compatibility | Evidence does not justify the risk |

### Option A — Minimal correction

Keep O41 and patch only proven issues. This is the safest first increment and could be shipped in slices. It cannot fully restore the old smooth corridor without either risking invented joins or adding provenance metadata.

### Option B — Hybrid old/new

Keep O41 truth and reuse only old visual concepts under stronger constraints. Add the minimum data contract needed to make corridor rendering and asynchronous derived route refinement truthful. This best satisfies the full product goal.

### Option C — Larger redesign

Not recommended. The evidence shows O41's truth and recovery architecture is structurally sound; the failures occur at acceptance policy, permission-to-gap propagation, derived-geometry authority, and presentation metadata. Replacing the pipeline would endanger proven guarantees without evidence of necessity.

## AC. Recommended implementation sequence

1. Freeze baselines: commit forensic fixtures for `almost work`, session 2059, one good historical match, explicit gaps, and authorized-background telemetry format.
2. Add diagnostic contracts first: unique callback/publication/render identifiers, explicit background activation result, match-unavailable reason, derived input/output metrics.
3. Correct the indoor-drift moving-user gate behind focused unit/replay tests; validate outdoors before adding preview-tail behavior.
4. Persist `background_provider_unavailable` as a known gap and new segment; add clear authorization UX. Validate `Always` granted and denied paths.
5. Unify Mapbox token authority; switch matching input to canonical accepted per-segment points; implement ordinal-aware overlap and anchor/deviation gates.
6. Define/version one local/server Detail display contract and durable derived-work intent. Preserve raw/canonical geometry independently.
7. Extend new Memory evidence with Activity/segment continuity metadata; keep old data readable.
8. Add the bounded corridor/union renderer and prove polygon output never crosses a gap or exceeds the allowed evidence envelope.
9. Move slow matching/server refinement after durable local completion; retain a short fast path and explicit pending state.
10. Only after real-Hike approval, make the separate tiny Simulator label/discoverability change without touching its engine.

Each product step requires separate human implementation authorization. No step was implemented in this analysis.

## AD. Risks

- A looser indoor gate can admit stationary urban drift. Mitigate with coherent multi-sample motion, speed/bearing/accuracy bounds, and fixtures from real static traces.
- A provisional tail can imply movement not yet accepted. Keep it visually distinct, short-lived, non-metric, and removable; omit it unless filter correction alone is insufficient.
- Encoding permission loss as a gap can create short visual breaks during rapid app switching. That is more truthful than a connector; debounce only before provider stop if iOS lifecycle evidence supports it.
- Hard endpoint anchors can preserve a bad fix. Use trustworthy accepted endpoints and accuracy-aware bounds, not raw last callback.
- Matcher availability/config changes can increase request volume/cost. Cache by immutable input hash and algorithm version.
- Asynchronous refinement can race deletion, rename, user switch, or resync. Require owner/client ID/tombstone/version fences and idempotent updates.
- Memory continuity metadata requires backward compatibility. Legacy rows must remain point-only and must never be proximity-joined by guesswork.
- Corridor smoothing can accidentally expand territory. Test containment against the allowed evidence/continuity envelope at multiple latitudes/zoom levels.
- Production matching metrics based on raw audit geometry can overstate deviation. Future telemetry should compare against canonical accepted inputs.
- Changing GPS settings without authorized-background evidence could worsen battery without addressing the proven permission issue.

## AE. Exact next Codex implementation task

After human authorization, start a new implementation session with this bounded first slice:

> Implement and validate O42 real-Hike correctness slice only: (1) make the indoor-drift filter motion-aware without admitting static drift; (2) persist `background_provider_unavailable` as an explicit gap/new segment on foreground recovery; (3) instrument unique callback→accept→journal→store→ShapeSource timing and explicit matcher-unavailable reason. Preserve all O41 ownership, journal, recovery, Memory, matching, offline, and Simulator contracts. Add unit/replay tests plus a real-device QA checklist. Do not yet change Memory rendering, matching geometry, Save concurrency, backend schema, or Simulator UI. Increment the single Home marker only after validation produces a human-testable OTA candidate.

This first slice attacks the two proven capture/presentation causes and improves evidence for the subsequent matching/Memory slice without mixing migrations or asynchronous behavior.

## Git reconciliation

### Initial state

After read-only fetch/inspection:

- Local `master`: `ffdac952ba07a3b8f4fc0aeb62adc0415c224ed6` (`sim freeze`).
- `origin/master`: `f5d0127c44eb98dc95cc8687711679f23fd10f61`.
- Relationship: local ahead 1, behind 4; merge base `c00cc39b93d1aa25239c9dde8cc7158775aa42fa`.
- Uncommitted state: no staged files; 33 Git-visible paths. They comprised `AGENTS.md`; 13 backend implementation/test/schema/privacy paths; production deployment documentation; simulator review documents/runtime evidence; six simulator QA images/boards; and five new simulator forensic documents. The exact snapshot is the safety commit listed below.

### Divergence

Local-only commit:

- `ffdac95 sim freeze` — 70 app/client files, containing the current O40/O41 client/Simulator work.

Remote-only commits:

- `7278553 feat(backend): secure internal QA telemetry`
- `1070b81 chore: ignore generated QA visual artifacts`
- `8900028 fix: guard Activity rename and Route provenance`
- `f5d0127 fix: decouple Memory projection from Activity save`

**PROVEN:** the remote side contains legitimate previously published backend/operations work; the local side contains the unpushed client line. `--left-right --cherry-pick` plus patch-ID inspection found no duplicated logical commit under a different hash. There was no material path overlap between the one local client commit and the four remote commits. The divergence arose because remote backend work advanced from the common base while the client-only `sim freeze` commit remained local.

### Safety preservation

- `local-safety-pre-master-reconcile-2026-09-09` → original local HEAD `ffdac952ba07a3b8f4fc0aeb62adc0415c224ed6`.
- `local-safety-working-tree-2026-09-09` → snapshot commit `507c6a3714d5b6b9acb3692a19aa8e4faf567471`, preserving the exact Git-visible uncommitted state.

Both local safety references remain present.

### Action taken

The working state was preserved, then the single legitimate local client commit was replayed onto the fetched `origin/master` with a clean local rebase. This was the smallest safe reconciliation because:

- origin is the shared/deployment authority and was not rewritten;
- only one unpublished local commit needed replay;
- it had no logical duplicate and no material path collision;
- a merge commit would add unnecessary history for a simple unpublished local line.

The original file bytes were restored. Some formerly dirty backend/QA paths became clean because identical content was now present in the remote base; remaining differences stayed dirty. `AGENTS.md`, which contained meaningful local and remote instruction additions, was preserved as a semantic union. No product code was edited for reconciliation.

No force push, normal push, `git clean`, destructive reset, or remote history rewrite occurred. No pull strategy was configured.

### Final state

- Local `master`: `dac817a4d79756b33a313ded747326f897b3b945` (`sim freeze`, rebased hash).
- `origin/master`: `f5d0127c44eb98dc95cc8687711679f23fd10f61`.
- Relationship before these new uncommitted review docs: ahead 1, behind 0.
- Master contains all four remote commits and the complete rebased local O40/O41 client commit.
- Working tree remains intentionally dirty with 14 modified pre-existing paths, five pre-existing untracked simulator forensic documents, and these two new untracked analysis documents; nothing is staged.
- No unresolved conflicts, accidental deletions, or duplicate logical commits exist.
- The original client commit and exact pre-reconciliation working snapshot remain recoverable from the two safety references.

An optional future repository-local safety policy is `pull.ff=only`: it would fail closed whenever a new divergence needs inspection. It was not configured because the current SOP intentionally allows local client commits to remain ahead; future remote backend advances should still be fetched, inspected, and the unpublished client line consciously replayed.

### Push

**NO.** Client-only work remains intentionally local under project SOP. Git was normalized without changing remote state, and no commit needed publication to resolve a shared-history inconsistency.

## Evidence and sources

Primary local authorities:

1. Current source at `dac817a4d79756b33a313ded747326f897b3b945`, especially `app/src/store/useTrackingStore.ts`, `app/src/store/useSessionStore.ts`, `app/src/screens/HikingMap.tsx`, `app/src/screens/MapHistoryScreen.tsx`, `app/src/features/activity`, `app/src/features/memory`, `app/src/services/hikeTrackWriter.ts`, `app/src/services/pendingSyncStore.ts`, and current matching/Simulator contracts.
2. Historical tree `a9157af0e20c19cb19c55ff2bc52a5846bf2fe8c` and rewrite graph around `05ec25786ef4f137e3c8af8493b4ebc379a0b305`/`cf444c0`.
3. Read-only production session/Memory/telemetry evidence for Activity `2062` and comparison sessions `192`, `193`, `2053`, and `2059`.
4. Git graph, cherry-pick/patch-ID comparison, tree/path diffs, and the named safety references.
5. Repository tests and prior review documents used to cross-check intended contracts. Human observations were treated as observations until corroborated.

Official external contract checks:

[^expo-location]: [Expo Location documentation](https://docs.expo.dev/versions/latest/sdk/location/)
[^apple-background]: [Apple — Handling location updates in the background](https://developer.apple.com/documentation/corelocation/handling-location-updates-in-the-background?changes=latest_maj_8__2&language=objc), [`allowsBackgroundLocationUpdates`](https://developer.apple.com/documentation/corelocation/cllocationmanager/allowsbackgroundlocationupdates?changes=_1_6), and [`pausesLocationUpdatesAutomatically`](https://developer.apple.com/documentation/corelocation/cllocationmanager/pauseslocationupdatesautomatically)
