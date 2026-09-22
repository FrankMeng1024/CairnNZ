# “What you walk is what you see” tracking implementation

Date: 2026-09-11 (Asia/Shanghai)  
Target: Cairn Internal, manual OTA candidate **O48**  
Verdict: **READY FOR ONE COMPREHENSIVE NATIVE VALIDATION**

This is an implementation verdict, not a claim that tracking correctness is
complete. Core Location delivery, lock-screen execution and the native Mapbox
animation still require the single physical protocol at the end of this file.

## Authority and evidence

Read before implementation:

- `docs/review/activity-real/TRACKING_CONVERGENCE_PLAN.md`
- `docs/review/activity-real/TRACKING_CONVERGENCE_IMPLEMENTATION.md`
- `docs/review/activity-real/almost-done/ALMOST_DONE_MASTER_FORENSIC.md`
- O43–O47 Activity evidence under `docs/review/`
- the true-1 m, 5 m, backtrack, background and historical CC evidence cited by
  those reports
- current movement, journal, Memory, matching, completion and Detail geometry
  code
- `docs/VISUAL_SYSTEM.md`, `docs/VISUAL_MIGRATION_STATE.md`,
  `docs/VISUAL_ASSET_MANIFEST.json` and the locked QA boards

`CairnNZ_Project_Authority.md` is not present in this checkout. This was already
recorded in `TRACKING_CONVERGENCE_PLAN.md`; the repository authorities above
were used instead.

The replay artifacts are:

- `WYSIWYG_OFFLINE_REPLAY.json`: current movement authority loaded directly
  from TypeScript, six production Activities, no persisted coordinates
- `WYSIWYG_MATCHER_DRY_RUN.json`: current matcher loaded directly from
  TypeScript, live Mapbox responses, no token or persisted coordinates
- `build-wysiwyg-replay.mjs` and `build-wysiwyg-matcher-dry-run.mjs`: repeatable,
  SELECT-only harnesses

Important limitation: sessions 2062, 2067, 2069, 2070 and 2071 retain exact
server raw observations. Session 2072, `almost done`, did not upload
`route_points_raw`; the server holds 222 timestamped canonical points while the
phone’s immutable pending clone authority inventories all 239 raw points.
Therefore the new `almost done` server replay is exact for the available ordered
subset, not a claim to have reconstructed raw-only rejected observations.

## Selected implementation

The implementation deliberately has four separate authorities:

```text
raw CLLocation evidence (immutable)
        |
        v
bounded movement reducer
  |- positionEstimate (may refine)
  `- traversalAnchor + canonical points (walked truth)
        |
        +--> journal / distance / elevation / Memory
        |
        +--> one-source live presentation (display only)
        |
        `--> per-segment conservative Final matching
               |- accepted contiguous matching subsection
               `- exact canonical fallback subsection
```

No derived position is written back into raw evidence. No presentation
coordinate reaches distance, pace, elevation, Memory, journal, sync or matching.
No matched coordinate reaches Activity metrics or Memory.

### Movement authority

`realGpsContinuity.ts` is now checkpoint version 3. It keeps:

- an explicit fixed `traversalAnchor`;
- an independent ephemeral `positionEstimate`;
- a bounded six-observation/eight-second accuracy-eligible window;
- a bounded four-observation Candidate;
- `acquiring`, `moving`, `probably-stationary` and `uncertain` motion state;
- cumulative and net progression, progress ratio, robust coordinate median,
  cluster radius, robust dispersion, median/MAD step speed, coherent-step
  fraction and local direction variability;
- horizontal accuracy as uncertainty evidence, never an exact correction;
- reported speed/course as supporting evidence only, with optional
  `speedAccuracy`/`courseAccuracy` retained through foreground, background,
  checkpoint and telemetry paths.

Accepted canonical coordinates remain accepted CLLocation coordinates. The
reducer rejects, quarantines or accepts; it does not move canonical truth to a
prettier invented line.

Candidate confirmation is ordered and cumulative. A one-metre progression can
establish movement within three short coherent fixes; no 10–15 m escape step is
required. A true source-loss relocation uses a separate 20 s bounded Candidate
so normal background cadence can corroborate a new segment. The first fix after
that loss is held, then promoted with the next coherent fix. The gap edge itself
contributes no distance, elevation, active time or Memory.

### Stationary V2

O46’s exact defect was not merely “GPS drift.” A short directionally coherent,
low-speed Candidate could be promoted as movement. Once state became `moving`,
fresh plausible edges were accepted until the stricter five-fix stationary
cluster demoted it. At the second stop a 23 s low-speed edge fell outside the old
20 s ambiguity branch, and the next 2.12 m edge fell below its 3 m trigger, so
both inherited `moving` authority.

V3 closes those routes by:

1. applying low-speed ambiguity even while previously `moving`;
2. preventing a long-delayed Candidate from satisfying the fast two-fix escape;
3. refusing to retroactively promote a stationary Candidate tail when the user
   later starts walking;
4. refining only `positionEstimate` when the bounded cluster is stationary;
5. keeping `traversalAnchor` fixed until cumulative physical evidence confirms
   progression;
6. retaining reported scalar speed as corroboration rather than a veto.

The old CC idea restored is the fixed accepted walking anchor. The old sticky
radius/time gate is not restored.

## Real replay result

### Stationary windows

| Evidence window | Prior recorded/O46 | Historical K8 | V3 |
|---|---:|---:|---:|
| `almost done` first stop, ordinals 9–14 | 11.790 m false canonical | 8.204 m | **0 m** |
| `almost done` second stop, ordinals 224–226 | 5.350 m false canonical | 0 m | **0 m** |
| true-1 m opening, ordinals 1–12 | about 19.25 m recorded | 15.698 m | **0 m** |

The `almost done` first stop retains one anchor observation (ordinal 9) and the
second retains no new canonical observation. Position evidence remains in raw
provenance. The first stop-to-start window advances 3.411 m from ordinal 9 to
the first accepted departure at ordinal 24; that is outside the stationary
subwindow. At the second restart, ordinal 227 is promoted when ordinal 228
corroborates it, then normal one-metre-class acceptance resumes.

The true-1 m ending window (65–77) is not labelled stationary by authoritative
telemetry. Its coordinates progress coherently for 16.430 m at walking-like
implied speed while scalar reported speed is low. V3 correctly does not discard
this proven false-low-speed pattern based on a retrospective assumption. The
comprehensive native protocol provides explicit stop markers to resolve this
remaining evidence ambiguity.

### Historical CC trade-off

The K8 family introduced at `738286b` remains the **LIKELY MATCH** for the
remembered calm stationary feel; `95302b8` is the likely later visual snapshot.
`d7ea3b0` is possible but less suppressive, and `a9157af` is not a distinct
stationary algorithm.

On the available `almost done` sequence K8 retained only 28 of 222 points,
reduced path length from 428.590 m to 365.524 m, reduced the U-turn window to
three points with no detected reversal, reduced the deliberate Z to seven
points with no detected reversal, and retained only one point in the second
stop-to-start window. On true-1 m it retained 6 of 77 points and only three
points across the false-low-speed return. Its cleanliness came from a sticky
accepted-anchor deadband that lost real movement. That behavior must not return.

V3 retains 205 available `almost done` points. It preserves:

- straight window: 95 points, 135.265 m;
- U-turn window: 11 points, 33.859 m, reversal retained;
- deliberate Z: 18 points, 74.400 m, reversal retained;
- repeated internal corridor: 21 points, 37.050 m, reversal retained;
- second stop-to-start: 10 moving points, 12.262 m.

For true-1 m, V3 retains 65 of 77 raw points and 108.189 m versus the recorded
30-point/112.173 m display. The false-low-speed return retains 45 points and
62.881 m; D7 retained four and K8 retained three.

Whole-session replay totals are diagnostic, not ground-truth scoring. Historical
Activities were recorded under different acceptance rules and several include
known defects. In particular, `almost done` is missing raw-only server evidence.

| Session | Input | V3 canonical points/path | Raw-to-live-display adjustment p50/p95/max |
|---|---|---:|---:|
| 2062 `almost work` | 105 exact raw | 53 / 632.846 m | 0.666 / 1.710 / 2.000 m |
| 2067 `somethingwrong` | 85 exact raw | 54 / 344.791 m | 0.624 / 1.081 / 1.664 m |
| 2069 `5m` | 16 exact raw | 9 / 56.954 m | 0.583 / 1.304 / 1.630 m |
| 2070 `1m` | 21 exact raw | 15 / 100.474 m | 0.647 / 1.557 / 1.585 m |
| 2071 `new 1m` | 77 exact raw | 65 / 108.189 m | 0.145 / 0.276 / 1.567 m |
| 2072 `almost done` | 222 available canonical | 205 / 393.520 m | 0.161 / 0.562 / 2.000 m |

Accepted raw-to-canonical displacement is exactly zero: V3 does not shift an
accepted GPS point. The last column is the bounded display-only filter.

## GPS jitter and visual stabilization

Canonical cross-track projection was evaluated and removed. It helped the
straight true-1 m sample but worsened the local p95 on `almost done` and imposed
a direction prior at exactly the point turns must be released. The evidence did
not justify changing traversal truth.

The selected display-only filter uses a 0.8/0.9 adaptive measurement weight and
keeps the rendered endpoint within 1–2 m of the latest canonical coordinate.
It does not use whole history. On locally straight windows:

| Activity | Raw local wobble p95/max | Presented p95/max | Change |
|---|---:|---:|---:|
| true-1 m | 0.809 / 0.835 m | 0.733 / 0.757 m | p95 -9.4% |
| `almost done` | 0.378 / 1.101 m | 0.359 / 0.935 m | p95 -5.0% |

This is intentionally modest. If GPS evidence does not support a straighter
canonical line and no road match passes, Cairn does not fake one.

## One continuous route presentation

The separate static-body and capped animated-head ShapeSources were removed.
The active segment now has one `Animated.ShapeSource`, one LineString and one
shared casing/core stroke pair. For A → B → C → D the same geometry grows:

```text
[A,A] -> [A,B] -> [A,B,C] -> [A,B,C,D]
```

There is no second head origin, second round start cap, opacity overlap or
z-order seam. Completed prior segments remain static, so a Gap never becomes a
line. The stable prefix is immutable and at most eight not-yet-settled points
remain mutable; callback bursts atomically catch the presentation up and reset
that suffix. New targets retarget the same source. Normal one-second cadence
uses 720 ms, with a bounded 180–850 ms adaptive duration.

Reduce Motion, pause, screen inactivity, unsupported animation primitives and
old foreground-restored history all render immediately. Background history is
never replayed: initial animation is allowed only when the latest canonical
point is at most three seconds old. New live points then resume normal smoothing.

The old ~900 ms duration was not the root defect. The independent source/layer
and separately capped head topology created the perceived mini-lines. The
selected one-source design fixes that topology and then shortens/adapts timing.

`lineTrimOffset` was not selected. It would require a second progress authority,
care around changing line length and a final static source transition while
offering no advantage over direct endpoint-array interpolation in the installed
RNMapbox animation implementation.

## Source health and calm UI

Provider health and canonical health are now separate. A fresh source with a
temporary Candidate or filtered fix remains internal and does not flash
“Candidate”, “Untrusted GPS” or accuracy engineering language. A user-facing
warning appears only when:

- the source is stale/unavailable (15 s freshness threshold), or
- the source remains fresh but canonical route evidence has been degraded for
  30 s and the reducer is not confidently stationary.

The second case uses the simple copy “Location is too uncertain to record
reliably.” Permission and background-permission guidance remain actionable.

## Core Motion decision

Core Motion is **not included in this candidate**.

The app has an `NSMotionUsageDescription`, currently worded for device
orientation, but has no `expo-sensors` dependency, no checked-in iOS project and
no CMMotionActivity bridge. Adding CMMotionActivity/CMPedometer authority would
therefore be a native dependency/configuration change and requires a new native
build plus permission-copy review:

**NATIVE BUILD REQUIRED for a future Core Motion integration.**

The six-session GPS-only replay and deterministic conflict tests meet this
release’s acceptance criteria without that cost. The observation model retains
an optional future evidence seam. Motion may later increase or decrease
movement confidence; it must never provide coordinates, traversal distance or
Memory.

## Background preservation

The working background architecture was not redesigned. `BestForNavigation`,
the proven foreground 1 m direction, background task ownership, journal-first
commit, segment IDs, Gap authority and foreground takeover remain intact.
Only optional scalar uncertainty fields were carried through existing event and
checkpoint structures.

O46 `almost done` remains the authoritative proof that screen-off callbacks,
canonical decisions and journal commits continued in one segment without a
hidden gap. Immediate full-history restoration on foreground is correct; only
the new live endpoint animates.

## Conservative hybrid Final Snap

Final matching now operates independently per canonical Segment and never
crosses a Gap. Within a segment:

- accuracy over 20 m is canonical fallback and is not sent to Mapbox;
- eligible runs are chunked at 80 observations with one exact temporal boundary;
- walking profile uses `tidy=true`, strictly increasing timestamps when valid,
  and accuracy-derived radii clamped to 10–40 m;
- a Mapbox matching is used only when its tracepoints map to one contiguous
  ordered source span;
- null/unassociated observations, disjoint matching spans, low confidence,
  network failures and failed quality gates remain exact canonical geometry;
- matching endpoints are anchored to their canonical subsection endpoints;
- canonical fallback retains exact coordinates and timestamps;
- only vertices inside an accepted matched subsection receive monotonic,
  arc-length-proportional timestamp interpolation;
- no global dedupe, union, nearest-pass stitch, fake connector or smoothing is
  run after assembly.

Quality requires confidence ≥0.3, p95 deviation inside the bounded
`min(15,max(8,1.25×accuracyP95))` envelope, bounded max deviation, covered
endpoints and length ratio 0.67–1.5. These are general truth gates, not tuned to
make `almost done` attractive.

Repeated A→B→A→B remains ordered because chunk overlap is an exact canonical
instant and no spatial deduplication exists. A collapse to one pass fails length
distortion. Deterministic tests preserve three direction runs `[+1,-1,+1]`, both
turnarounds and exact fallback boundaries. Exact pixel overlap on the road is
allowed.

### Production matcher dry-run

The current code was run unchanged against persisted segment inputs using the
existing preview Mapbox environment. Across six sessions, no matching subsection
passed. This is an honest fallback result, not a tuning failure:

- `almost done`: four calls; 77/80 and 71/80 null tracepoints on two responses;
  the other two returned `NoSegment`; zero contiguous accepted subsections;
- true-1 m: `NoMatch`;
- the other references returned partial coverage whose non-null observations
  did not prove a contiguous usable span.

Accordingly, a current save of this same `almost done` canonical subset would
remain canonical, preserve the U-turn/repeated corridor, and would not steal the
internal path onto a nearby external road. Synthetic and deterministic tests
prove that a future response containing valid mapped islands produces matched
subsections plus exact canonical fallback between them.

## Performance

The reducer does no full-history work per observation. The repeatable direct
replay processed 10,000 coherent observations in 1,118 ms on this development
machine. The recent raw window peaked at 6 and Candidate at 0 in that run;
deterministic ambiguous tests cap Candidate at 4. No per-frame business-state
write or telemetry event was added. Presentation completion/retarget telemetry
is event-level only.

The native animated ShapeSource necessarily owns the current active LineString;
the mutable interpolation suffix is bounded at eight points. A callback burst
resets atomically rather than accumulating an unbounded animation backlog.

## Deterministic regression matrix

Covered outcomes include:

- stationary: tight orbit, good/moderate accuracy jitter, low-speed V/Z,
  isolated/broad outlier, `almost done` first and second stops;
- movement: normal 1 m, slow cumulative walking, 90°/180° turns, out-and-back,
  repeated corridor ×3, deliberate Z, switchback, circle, diagonal, off-road,
  stop/start and false-low scalar speed;
- faults: impossible teleport, outlier-and-return, non-monotonic callback,
  Candidate timeout, source loss, corroborated reacquisition and repeated gaps;
- presentation: one source, append-only stable prefix, rapid retarget cap,
  segment/Gap separation, background-history immediate mount and Reduce Motion;
- downstream: journal-before-publish, zero stationary Memory, zero gap Memory,
  background ownership, recovery, matching fallback, repeated matching,
  internal-road anti-stealing and local/server geometry equality.

## Verification

- `npm run verify:activity:gps`: **PASS, 289/289**
  - continuity 32, cadence 5, background 22, gap 10, elevation 5,
    matching 31, telemetry 36, integration 90, Memory-gap 3, server 23,
    static contracts 32
- focused matcher/store run after subsection timestamp preservation:
  **PASS, 75/75**
- routed CORE run: **352/359 pass, 32/33 suites pass**
  - the only seven failures are the unchanged baseline
    `__tests__/v409-offlineQueue.test.ts` calls to missing legacy test helpers
    `readQueueSnapshot`/`clearQueue`; all tracking, journal, recovery, Memory,
    pending-sync, shared Simulator and server suites in the routed set pass
  - this is deterministic pre-existing repository test debt, not a flaky retry
    and not caused by this implementation
- Expo Web Hike/Run QA: **25/25 layout checks**, 390×844 plus 360×640 and
  430×932, Day/Sunset/Night, tracking/paused/degraded, all control interactions,
  **0 runtime errors**
- native Mapbox continuous-stroke rendering: pending the protocol below

The existing Jest configuration warning for the misspelled
`setupFilesAfterFramework` and the known post-test open handle also remain
unchanged.

## Production deviations from suggested techniques

- No geometric-median coordinate replacement of canonical truth: robust centre
  is position/state evidence only.
- No canonical cross-track filter: the real matrix did not support it.
- No whole-history Kalman or long moving average.
- No Core Motion/native dependency in this OTA candidate.
- No `lineTrimOffset`: one animated LineString is simpler and safer here.
- No matcher resampling yet: current segment evidence remains within bounded
  chunk limits and mandatory topology is clearer without another transform.
- No live or final road-radius expansion for internal paths.
- No PDR, raw IMU, Watch fusion, live network matching or ML model.

## Delivery and safety

- Client code and deterministic tests changed: **YES**
- Home OTA marker advanced exactly once for this candidate: **O47 → O48**
- App/runtime/build versions changed: **NO**
- Native dependency or native configuration changed: **NO**
- Backend production logic changed by this implementation: **NO**
- Backend deployed: **NO**
- OTA published: **NO**; publication remains manual
- Production Activity/Memory/database rows mutated: **NO**
- Production access by replay scripts: **SELECT-only**
- Raw observations overwritten or deleted: **NO**
- Existing background cadence changed: **NO**

## One comprehensive native validation protocol

Use Cairn Internal with the new O marker visible. Start with battery percentage,
Low Power Mode state, thermal state, background permission and the QA session ID
recorded. Use a safe route containing a mapped public road/path and a known
internal or unmapped path.

1. Open Hike, wait for a normal location fix, then start. Stand physically still
   for 60 s. Keep the phone naturally in hand but do not walk.
2. Walk straight at a normal pace for 2–3 min. Note whether the puck and one
   continuous route endpoint feel phase-aligned; look specifically for a second
   start cap or independent mini-line.
3. Slow-walk in short roughly one-metre progressions for 60 s.
4. Make a clear 90° turn, then a sharp 180° U-turn. Return along the same path.
5. Traverse one short corridor A→B→A→B. Do not alter the path merely to make
   passes visually separate.
6. Walk a deliberate Z and one small switchback/diagonal section.
7. Stand still for another 60 s. Then resume with short slow steps; record the
   wall time/fix count until the route advances.
8. Traverse the internal/unmapped path, then a mapped section. Include grass or
   plaza movement only where safe.
9. Turn the screen off for 3–5 min while continuing to walk. If safe, include a
   brief stop during this period. Return foreground and verify all confirmed
   history appears immediately rather than replaying.
10. While foregrounded, briefly open Notification Centre/control overlay and
    return. Confirm no provider restart, false Gap or history rewind.
11. Pause, move only enough to make the pause state obvious, Resume, and walk
    normally for at least 30 s.
12. Finish, name and Save. Open Activity Detail. Compare live versus Final:
    mapped parts may refine, internal parts must remain truthful, U-turn and Z
    must remain, and A→B→A→B must not be collapsed.
13. Record ending battery percentage and thermal state. Do not infer a long-term
    battery result from this single session.

Pass criteria:

- each 60 s stationary window adds at most 3 m canonical distance after a
  five-second settling allowance and produces no visible V/Z/spaghetti or
  Memory corridor;
- normal movement has no sustained visible lag; slow movement resumes within
  three coherent fixes under one-second-class foreground delivery;
- one continuous line, no second origin cap, no rewind;
- U-turn, Z, switchback and all three corridor passes remain ordered;
- no hidden background Gap; foreground history restores immediately;
- pause/resume creates only the intended truth boundary;
- Final Snap improves only proven mapped subsections and never steals the
  internal path;
- no user-facing Candidate/untrusted-fix vocabulary or status flicker;
- telemetry shows raw retention, bounded state, journal-before-publish, correct
  segment ownership and no stationary/gap Memory.

If the native run fails, preserve its raw evidence and QA telemetry, add a
privacy-safe deterministic incident fixture, and do not call tracking complete.
After it passes, a separate 10,000-observation/native-duration or 4–6 hour
soak—not this protocol—should certify long-session render and battery behavior.

**READY FOR ONE COMPREHENSIVE NATIVE VALIDATION**
