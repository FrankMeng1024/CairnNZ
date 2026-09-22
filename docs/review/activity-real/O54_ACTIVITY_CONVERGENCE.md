# O54 Activity convergence

Date: 2026-09-13

Candidate: **O54**

Engineering verdict: **implementation complete; real-device field validation required; OTA not published.**

## Outcome

O54 closes the implementation defects demonstrated by `wrong2`, `something run`, and `bad run` without reopening GPS collection or canonical truth. BestForNavigation, the requested 1 m foreground/background distance thresholds, one Activity location authority, canonical metrics/Memory ownership, segment/Gap semantics, and offline-first identity remain intact.

The pass changes five owning layers:

1. lifecycle transitions are explicit, authoritative, single-flight, and ordered through actual native settlement;
2. Finish locally commits Base Final before optional providers, Memory repair, Mapbox, or server sync;
3. source health and puck freshness are independent of canonical movement and camera follow;
4. Live/Final geometry are display derivatives that suppress uncertainty-scale corridor chatter while protecting route structure;
5. Run Live Pace is recent-movement pace rather than cumulative Activity average.

The complete three-Activity evidence chain is in [O54_WRONG2_SOMETHINGRUN_BADRUN_FORENSIC.md](./O54_WRONG2_SOMETHINGRUN_BADRUN_FORENSIC.md).

## Activity lifecycle

`status` remains the lifecycle authority, while `transitionState` now represents `idle`, `resuming`, `pausing`, or `finishing`. The screens consume one derived operational state, so the normal Pause UI cannot appear merely because a Resume handler resolved.

Resume is one transaction:

```text
Paused
→ transitionState=resuming; lifecycle remains Paused; UI says Resuming…
→ serialize native source activation through actual settlement
→ establish durable Activity ownership/context
→ restart lifecycle clock/registry
→ publish Recording
→ location may remain Recovering until a fresh fix exists
```

Rapid Resume taps share one promise. Intent epochs prevent an old source start/stop or lifecycle handler from publishing after Pause, Finish, foreground return, or a newer action supersedes it. Resume failure leaves the session Paused and finishable.

Pause freezes lifecycle time synchronously, uses the same single-flight discipline, and cannot be overwritten by late Resume work. A late accepted observation may still finish its bounded durable append, but it cannot revive the lifecycle after its intent is obsolete.

Active Time therefore follows lifecycle truth: it progresses only after real Resume success and freezes with Pause/Finish. Restored lifecycle timestamps continue to use the existing durable lifecycle clock.

## Finish / Cancel

Opening Finish confirmation no longer calls Pause. Hike and Run retain the lifecycle at sheet entry; Cancel simply closes the transaction.

Verified contracts:

- Recording → Finish → Cancel → Recording;
- Paused → Finish → Cancel → Paused;
- Recording/location recovery → Finish → Cancel → same recovery state;
- Resuming → Finish confirmation preserves Paused + Resuming until Finish supersedes it or Cancel returns;
- double Finish is blocked at the store boundary, not just by disabled UI.

Back remains an independent navigation control. Finish is enabled while Recording, Paused, Resuming, Pausing, source-stale, or location-recovering. A restored Activity can use the existing `Save`/Finish recovery action without first running Resume.

## Fail-safe local Finish

The implemented order is:

```text
freeze accepted truth
→ bounded producer/context/drain/ingest reconciliation
→ durable pending Activity payload
→ segment-local offline Base Final
→ local Activity session (`base_ready`)
→ completed-local unfinished registry
→ Activity Detail usable
→ optional bounded Mapbox enhancement
→ optional Memory reconciliation and server sync
```

The source-stop, context, drain, and in-flight-ingest waits are individually bounded and diagnostic. The canonical completion snapshot closes explicitly after the ingest budget, so a slow pre-Finish WAL append can finish durably but cannot publish into or mutate the already-snapshotted Activity. An ancillary fence failure no longer returns the Activity to a trapped Paused state. Mapbox, network, source freshness, another GPS callback, camera state, and Resume success are not Finish prerequisites. The Base and later Enhanced writes reuse the same idempotency key and client Activity identity.

Hike/Run pass an `onLocalCommitted` callback to open Detail as soon as Base is durable. The enhancement may update that same local/pending Activity afterward; no indefinite completion spinner is needed.

## Signal health

O54 distinguishes source evidence from route advancement:

- active source + stationary motion + no accepted distance: healthy stationary, no warning;
- recovering or temporarily stale presentation: truthful recovery state;
- inactive/genuinely stale provider: source unavailable warning;
- no accepted canonical point: not, by itself, source loss;
- every health state: Back and Finish remain available.

This corrects `wrong2` semantically rather than changing 60 seconds to another arbitrary timeout. True source loss in `bad run` still degrades.

## Background / foreground and current position

Foreground takeover now drains retained, Activity-owned background observations and promotes the newest matching coordinate/time into the presentation authority immediately when fresh enough. It does not wait unnecessarily for a new foreground callback. Presentation freshness is explicit:

- `CURRENT`: show current-position provider;
- `RECOVERING_PUCK`: do not present an old location as current;
- `STALE_PUCK`: hide the stale puck.

This does not alter canonical acceptance, route chronology, or segment provenance. Puck recovery also does not force camera movement. Existing follow intent may resume; manual pan stays manual and the recenter control remains the user's choice.

The native activation queue fix addresses the `wrong2`/O52 late-background-start signature: a caller may receive a bounded acknowledgement, but serialization is not released until the native task actually settles. Obsolete work checks its intent before and after native awaits and tears down anything it started. The installed Activity still has one foreground/background authority and no competing active Apple map provider.

## Live route

Real Hike/Run display now uses a causal, segment-local presentation reducer. It sees only accepted canonical history already observed, revises a bounded 36-point tail, finalizes 24-point cores only after 12 points of causal evidence, and never crosses a segment/Gap. Canonical points, distance, elevation, Memory, and persistence are unchanged.

The reducer uses reported uncertainty plus 6 m/30 m turn structure. Tiny local headings do not become anchors unless adjacent movement is evidence-sized; a turn that survives local and corridor scales remains protected. Alternating, uncertainty-bounded road wobble receives a stronger straight-corridor envelope. Stop boundaries remain protected.

Current synthetic comparison:

| Fixture | Canonical | Live | Result |
|---|---:|---:|---|
| straight road, 1–5 m wobble | 61 pts / 340.0 m / 27 sharp turns | 4 pts / 240.8 m / 0 sharp turns | nearly straight corridor |
| gentle bend | 41 / 104.6 m | 4 / 103.9 m | smooth bend retained |
| 90° corner | 25 / 119.9 m | 3 / 119.9 m | corner retained |
| small Z | 5 / 27.3 m | 2 / 24.0 m | removed |
| U-turn | 17 / 127.9 m | 3 / 127.9 m | chronology/reversal retained |
| switchback | 5 / 109.8 m | 5 / 109.8 m | all structural turns retained |
| true Gap | 16 / two segments | 4 / two segments | never bridged |

The 18,000-point deterministic Live construction benchmark completed in about 5.6 seconds total on the development machine (about 0.31 ms amortized per accepted append over a five-hour-sized corpus). It is display work only; GPS precision and callback policy are unchanged.

## Final route

Offline Base Final now uses effective uncertainty, multi-scale structural turns, pause boundaries, stationary-cloud collapse, and bounded same-corridor micro-excursion removal. Simple corridors use beauty-biased simplification; complex/switchback geometry uses the lower-tolerance truth-biased path. It densifies for rendering without inventing metric truth, processes each real segment independently, and never joins a Gap.

The network compositor adds `NETWORK_WEAK_SAME_CORRIDOR` / `D_WEAK_SAME_CORRIDOR`. Its acceptance requires strong corridor identity, coverage, bearing/length/end safety, low topology ambiguity, and a bounded evidence envelope. Exact lateral/side confidence is evaluated separately:

- stable side evidence → network skeleton with evidence-supported offset;
- strong corridor but uncertain sidewalk side → evidence-centred corridor reconstruction;
- topology ambiguity, free traversal, off-network, or unsafe seam → canonical-derived Base;
- true Gap → no inference.

A 15 m synthetic same-corridor excursion remains outside the micro-excursion fuse and is preserved. Stationary cloud/stop jitter collapses without adding a reversal or spur.

## `something run` reconstruction

This is the only newest Activity with retained raw coordinates suitable for a direct replay. The local review artifact translates them to local metres before writing.

| Layer | Points | Length | Micro turns | Sharp turns |
|---|---:|---:|---:|---:|
| retained raw | 213 | 662.9 m | 106 | 19 |
| current canonical replay | 211 | 659.6 m | 107 | 18 |
| O54 Live | 23 | 620.5 m | 6 | 4 |
| O54 Base Final | 47 | 619.0 m | 3 | 4 |
| persisted O53 Detail | 61 | 641.7 m | 17 | 6 |
| chosen O54 Final | 66 | 634.3 m | 2 | 7 |

With the production EAS environment, the current compositor made 4 Matching and 3 Directions calls, all HTTP 200, capturing 11 candidates. It accepted 356.2 m of safe network-supported display and retained 303.5 m of canonical/free/off-network geometry. Two corridor ranges were accepted (confidence 0.786 Directions and 0.905 Matching); candidate-poor/null/ambiguous ranges fell back independently.

This rules out the O53 visual result being caused solely by conservative gates. In fully observed `wrong2` and `bad run` completions, telemetry recorded JavaScript Mapbox authority `unavailable` and zero requests. A production public token exists in EAS, but rnmapbox 10.3.1 iOS cannot expose its native singleton token to JavaScript. The manually published OTA must be bundled with `--environment production`.

## NZ / complex safety

Current tests directly execute the O54 Base compositor on public Kepler trail geometry with deterministic forest drift and on sparse/batched Kepler evidence. The complex route remains recognizable, retains structural turns, preserves endpoints, and remains within the bounded length envelope. A straight valley fixture is cleaned offline with zero network calls.

The regenerated Tongariro public-geometry simulation remains explicitly **SIMULATION/OFFLINE VALIDATED**, not real-device evidence. O54 accepted 2,125.3 m as weak-same-corridor network display and retained 1,566.7 m as Base/free/off-network. The fused result is 3,703.4 m versus 3,696.4 m reference (ratio 1.0019), reference displacement p50 0.7 m / p95 5.3 m, and six meaningful turns versus seven in degraded canonical evidence. The route's main mountain structure remains visually faithful; free/off-network sections are not coerced.

Ridge, forest drift, valley, mapped/unmapped/mixed, free traversal, and true-Gap safety are covered by the current Final/continuity suites and the retained O50–O52 fixtures. No DOC/LINZ/terrain dependency was introduced.

## Run pace

`LIVE PACE` semantics are now documented and implemented as recent accepted movement:

- current contiguous segment only;
- latest 35 seconds, capped at 140 m;
- at least 12 seconds and 20 m of usable evidence;
- most recent evidence no older than 12 seconds;
- at least 5 m progress in the recent 10 seconds;
- horizontal accuracy no worse than 25 m;
- plausible output range 90–1200 seconds/km;
- pause/resume/Gap/background discontinuities reset the usable window;
- insufficient, stationary, stale, or poor evidence → `--`.

Average pace remains exactly active elapsed / canonical distance and is tested independently. The Live Pace suite covers startup, steady pace, acceleration, slowing, stop, resume/segment boundary, background/foreground freshness, poor accuracy, and explicit divergence from cumulative average.

## Corpus regression

Evidence labels are strict; “replay” is not used when original raw observations are unavailable.

| Corpus | Validation class | O54 assessment |
|---|---|---|
| `back` | retained historical visual/forensic reference | remains a visual north star only; no historical tracker restored; route-shape protections retained |
| `snap` | retained prior direct O50 replay + current compositor regression | endpoint/Gap/off-network/network gates retained; no coordinate-specific rule added |
| `great hike` | retained O51 forensic evidence | candidate holding/puck distinction remains; canonical and bounded offset protections retained |
| `run issue` | retained O51 forensic evidence | false-gap schema fix remains; pace now separated from Activity average |
| `mstand` | retained O51 forensic evidence | uncertain road side does not become exact lateral truth; corridor confidence is separate |
| `hike ka` | retained O52 forensic evidence | obsolete background start class corrected by actual-settlement queue + intent epoch |
| `lost run` | retained O52 forensic evidence | true source-loss Gap remains; no inferred connector; segment provenance tests stay green |
| `wrong2` | retained O53 telemetry/user evidence | lifecycle/source ordering and false stationary Signal Lost corrected; no raw geometry replay claimed |
| `something run` | **direct retained raw replay** + screenshots + telemetry | background continuity retained; puck recovery, Live, Final, Mapbox, and Live Pace corrected |
| `bad run` | retained lifecycle/source telemetry | false Resume/Recording divergence corrected; lifecycle timeline used instead of invented geometry replay |
| stationary / stop-then-continue / Stop-V | synthetic + retained regression contracts | no Signal Lost solely from no movement; no route spaghetti/spur |
| straight / bend / 90° / Z / U-turn / crossing | direct synthetic O54 execution | corridor chatter removed; meaningful traversal retained |
| switchback / Kepler / Tongariro / forest / valley / ridge | public geometry + deterministic simulation | structural fidelity retained; current NZ tests green |
| mapped / unmapped / mixed / free traversal / true Gap | synthetic/current compositor contracts | safe network subsection only; offline Base and Gap independence retained |

## Tests and validation

| Gate | Result |
|---|---|
| O54 focused lifecycle/health/Live/pace/Final/NZ | **8/8 suites, 154/154 tests passed** |
| focused Activity screen/map/route presentation | **4/4 suites, 29/29 tests passed** |
| final `npm run verify:changed` | **32/33 suites, 392/399 tests passed** |
| changed-scope failure | only the pre-existing `__tests__/v409-offlineQueue.test.ts`: seven calls to removed `readQueueSnapshot` / `clearQueue` test helpers; identical before O54 and outside Activity scope |
| TypeScript | `npx tsc --noEmit --noCheck` passed |
| Simulator contracts | 35/35 passed in direct focused execution; current changed gate also passes the suite |
| Jest diagnostics | existing unknown `setupFilesAfterFramework` warning and an open-handle notice remain visible; neither was retried or hidden |
| Mapbox field reconstruction | production environment, read-only source data; 4 Matching + 3 Directions for `something run`; all HTTP 200 |
| NZ reconstruction | 5 Matching + 3 Directions on public/synthetic Tongariro evidence; current artifact regenerated |
| Expo Web | **390×844, 11/11 lifecycle assertions passed, zero captured runtime errors** |

The Expo Web QA exercised the real Run screen and store at mobile size. It verified `Resuming…`, `Restoring GPS`, Finish enabled during Resuming, Finish enabled in Signal Lost, and confirmation/Cancel preservation for Recording, Paused, and Resuming. The expected web map-unavailable fallback rendered cleanly; GPS recording/control UX remained usable.

Native source claims come from the newest retained real-device O53 telemetry (`wrong2`/`bad run` start/stop/callback/ownership generations), not Expo Web. O54 does not change iOS accuracy, distance thresholds, background task registration options, or native GPS provider configuration. A physical O54 run is still required to validate the repaired native transition ordering and puck recovery.

## Performance / energy

- no competing native location provider was introduced;
- no GPS precision or callback-frequency reduction was used to beautify geometry;
- Live work is bounded to causal chunks/tails and does not mutate canonical data;
- Final Base is local deterministic CPU work performed once at Finish;
- network Final remains bounded by per-call/total timeout and concurrency limits;
- Finish opens Detail after local Base commit rather than holding UI for Mapbox;
- source/context/drain/ingest waits have two-second safety bounds;
- no new fixed retry loop, telemetry array expansion, or whole-route per-frame projection was introduced.

Battery and true native foreground-return latency cannot be accepted from web/unit evidence; those remain field-validation items.

## Trails / backend / deployment

No Trails IA, Trails UI, Trails data contract, or Trails artwork was modified for O54. The dirty Trails worktree remains separate user work.

O54 has no backend requirement. No backend file was edited as part of this pass, no production backend deploy is needed, and production was not mutated. Existing dirty backend changes belong to other work and were preserved.

No app/runtime/build version changed. The one existing Home marker advanced exactly once from O53 to O54 after the implementation and mobile validation gates passed. No OTA was published. The human publish must use the production EAS environment so Final receives the JavaScript Mapbox public token, for example:

```sh
cd app
eas update --branch production --platform ios --environment production --message "O54 Activity convergence"
```

The human remains the publisher.

## Physical validation still required

On one production-like iPhone OTA session, validate:

1. stand still for more than one minute: no false Signal Lost; Finish remains available;
2. background movement then foreground: route and current puck converge immediately from fresh retained evidence; manual-pan camera stays manual;
3. Pause → Resume once and Resume ×5: one native activation, Active Time resumes, `Resuming…` is truthful, no provider overlap;
4. Resume during true source recovery: Recording clock resumes once lifecycle succeeds, recovery remains truthful, Finish works before a new fix;
5. Recording → Finish → Cancel and Paused → Finish → Cancel preserve exact state;
6. process kill/relaunch → Finish without Resume;
7. Signal Lost → Finish, offline → Finish, repeated Finish: one local Activity, immediate Base Detail, later idempotent enhancement;
8. urban Hike and Run: Live visibly stable, Final visibly more finished, safe Mapbox sections add value;
9. Run startup/steady/speed-up/slow/stop/resume: Live Pace behaves recently and shows `--` without enough evidence;
10. native telemetry: single Activity provider, no obsolete late background start, ordered foreground drain, fresh/stale puck classification, and no segment provenance reversal.

## Artifact paths

Git authority:

- `docs/review/activity-real/O54_WRONG2_SOMETHINGRUN_BADRUN_FORENSIC.md`
- `docs/review/activity-real/O54_ACTIVITY_CONVERGENCE.md`
- `docs/review/activity-real/FINAL_V2_NZ_SIMULATION_RESULTS.json`
- `app/scripts/evaluate-o54-field.mjs`
- `app/scripts/capture-o54-activity-qa.mjs`

Ignored local review output (not intended for deploy-bearing `master`):

- `app/_review/o54-activity/O54_GEOMETRY_RECONSTRUCTION.json`
- `app/_review/o54-activity/O54_GEOMETRY_COMPARISON.html`
- `app/_review/o54-activity/O54_GEOMETRY_COMPARISON.png`
- `app/_review/o54-activity/O54_EXPO_WEB_QA.json`
- `app/_review/o54-activity/run-resuming-390x844.png`
- `app/_review/o54-activity/run-resuming-finish-confirmation-390x844.png`
- `app/_review/o54-activity/run-signal-lost-finish-available-390x844.png`
- `app/_review/o54-activity/run-paused-after-cancel-390x844.png`
- `app/_review/overnight-final-v2/comparison-board.png`

Source screenshots reviewed:

- `/Users/mzm/Desktop/54/1789287526805-m943ae7em8.webp`
- `/Users/mzm/Desktop/54/1789287526813-ac9hdcp1lai.webp`
- `/Users/mzm/Desktop/54/1789287526813-ac9hdcp1lai (1).webp`
- `/Users/mzm/Desktop/54/1789287526813-ac9hdcp1lai (2).webp`
- `/Users/mzm/Desktop/54/1789287526813-ac9hdcp1lai (3).webp`
- `/Users/mzm/Desktop/54/1789287526820-rxgvc2qlgep.webp`

## Verdict

All known O54 implementation defects are closed in current source and automated/mobile-web evidence. Physical native behavior and battery remain explicitly unclaimed.

`O54 IMPLEMENTATION COMPLETE — FIELD VALIDATION REQUIRED`
