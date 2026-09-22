# O54 `wrong2` / `something run` / `bad run` forensic

Date: 2026-09-13

Verdict: **the three field failures converge on Activity lifecycle/source ordering, presentation freshness, display reconstruction, and pace semantics—not a need to reduce GPS precision.**

## Evidence and limits

Authority was recovered from current source, the O50/O51/O52 reports, Final V2/NZ, offline Activity/Route state, Hike/Run native map UI, the current O53 worktree, production read-only session rows, and retained O53 QA telemetry. `CairnNZ_Project_Authority.md` is absent; no historical tracker was restored.

The six files in `/Users/mzm/Desktop/54` were inspected at original resolution. All six show `something run`; that folder contains no identifiable `wrong2` or `bad run` screenshot. The screenshots prove visible UI state, not source ownership. Production/QA evidence supplies the lifecycle cause.

| Requested activity | Durable identity | Evidence class | Important limit |
|---|---|---|---|
| `wrong2` | client `8ff161d3-f3c4-4321-a7b2-7b18b34ba842`; QA `qa-mtzigwjd-6fab63xo` | retained O53 telemetry + user field account | no production `sessions` row or retained exact coordinate stream; geometry cannot honestly be replayed |
| `something run` | server `2080`; client `cda847c5-61c4-4cf8-8000-be22a7838012`; QA `qa-mtzioxrw-ebskppj8` | screenshots + production raw/final row + retained telemetry + direct current replay | QA upload ends about 41 s after start, so later foreground/puck state is supported by screenshots and persisted geometry rather than terminal telemetry |
| `bad run` | server `2081`; client `33dd2cb3-da3d-4141-8f4a-0efca0e725ba`; QA `qa-mtzlk93f-nbtzpz6v` | production row + retained O53 lifecycle/source telemetry | title says Run, persisted type is `hiking`; lifecycle evidence is the authority and no geometry comparison is forced |

Production was queried read-only. No row, telemetry event, persisted Activity, or deployed service was changed.

## State ownership before and after O54

O53 collapsed too much user-visible meaning into `status`. In particular, setting `status='tracking'` could make the Pause family render even while a native activation was still racing another activation/deactivation and the timer/source pipeline had not reached one coherent state.

| Concept | O53/current authority recovered | O54 contract |
|---|---|---|
| Activity lifecycle | tracking store `status`, unfinished registry, lifecycle clock | `status` remains lifecycle authority; Recording is published only after source activation/lease/registry clock succeed |
| Transition | implicit asynchronous handlers plus `isFinishing` | explicit `transitionState = idle/resuming/pausing/finishing`; Resume/Pause are single-flight |
| Location health | provider counters and canonical age were partly conflated | provider/source health is separate from accepted movement and lifecycle |
| Presentation freshness | latest foreground presentation coordinate could outlive foreground | `CURRENT / RECOVERING_PUCK / STALE_PUCK`; stale puck is hidden, fresh retained Activity-owned BG evidence can seed foreground |
| Finish confirmation | opening the sheet paused first | screen-local transaction retains prior lifecycle; opening/cancelling does not mutate it |
| Active timer | lifecycle clock plus pause/resume timestamps | lifecycle publication and clock transition are committed together; no normal Recording UI with a paused clock |
| Native source | foreground watch + Expo background task + durable context + ownership generation | intent epoch prevents obsolete late work; activation queue remains serialized until native work actually settles |
| Canonical truth | `trackPoints`, segment provenance, WAL | unchanged metric/Memory truth; Live and Final are consumer display derivatives only |
| Finish persistence | source/lease/Memory/network work could precede usable completion | frozen truth → local pending payload → Base Final session → completed-local registry → Detail; enhancement/sync follow |

The conceptual machine is now:

```text
Lifecycle:   RECORDING | PAUSED | FINISH_CONFIRMING | FINISHING | FINISHED
Transition:  IDLE | RESUMING | PAUSING | FINISHING
Health:      HEALTHY | RECOVERING | STALE | SOURCE_UNAVAILABLE
Puck:        CURRENT | RECOVERING_PUCK | STALE_PUCK
```

These dimensions are deliberately not interchangeable. `RECORDING + RECOVERING + RECOVERING_PUCK` is valid. Every lifecycle/health combination with locally sufficient evidence remains finishable.

## `wrong2` timeline

Start: `2026-09-13T07:47:15.769Z` (`15:47:15` Asia/Shanghai). Retained summary: Hike, 374.693 m, 335 active seconds, 158 raw / 157 canonical observations, two segments, local `saved_pending` completion.

| Elapsed | Foreground/background | Lifecycle and source | Accepted movement / timer | Puck and controls | Persistence / Final |
|---:|---|---|---|---|---|
| +0 s | foreground | Recording; foreground Activity provider | normal accepted movement; active clock running | current puck; Pause/Finish family | Activity/WAL active |
| +60/+120/+180 s | foreground | health event says source fresh | later standing period has little/no route advancement; this alone is not source loss | O53 eventually presents `Signal lost` from accepted-age semantics | durable evidence continues to exist |
| +85.6 to +118.4 s | inactive → background → foreground | background plan/start then ordered foreground takeover | route truth retained | presentation returns | no finalization |
| +208.2 to +269.2 s | inactive/background | inactive transition is delayed; at +269.2 telemetry says app background but `backgroundTaskActive=false`, source inactive, latest accepted age 61.939 s | no new accepted movement; clock/lifecycle should remain independently controllable | stale state appears as GPS failure | durable session still exists |
| +270.3 to +285.0 s | foreground | foreground return initially has no active provider; takeover only begins +277.5; obsolete background native start completes at +280.1 while app is already active, then stops +285.0 | no coherent presentation recovery during the race | old position/control trap matches user account | no Finish dependency should exist, but O53 source transition was still on the critical path |
| +333.5 s | reopened | Resume requested; tracking state appears while source/canonical remain stale (age ~64 s) | new segment does not begin until +337.0 | user had to Resume before trying to end | unfinished Activity recovered |
| +338.7 to +348.0 s | foreground | Paused → Finish | truth frozen | controls finally exit | Mapbox authority `unavailable`; zero requests; Base Final 157 → 33 points across two segments; local `saved_pending` |

### Root cause

O53 used a timeout race to make a source transition appear bounded, but the timed-out native operation was not cancelled. The shared activation promise chain was released when the timeout won, so a later foreground takeover could overlap the still-running background start. That obsolete background start then completed after foreground return. This is the same class of ordering defect identified in O52 `hike ka`, now directly visible in `wrong2`.

O54 keeps the caller acknowledgement bounded but keeps the underlying activation queue chained to actual native settlement. Every requested lifecycle transition also carries an intent epoch; work that becomes obsolete before or after a native await cannot publish ownership and stops any provider it started.

### Why standing still became `Signal lost`

The warning was driven by the age of accepted/canonical advancement in conditions where stationary filtering legitimately suppresses movement. “No accepted movement” and “no new route vertex” were therefore treated too much like “no source.” O54 derives health from actual provider/source evidence. An active provider with a quiet stationary user does not become `Signal lost`; a genuinely inactive or stale source still degrades. Finish is independent in both cases.

## `something run` timeline

Start: `2026-09-13T07:53:30.620Z` (`15:53:30` Asia/Shanghai). Server row: Run, 662.893 m, 421 active seconds, 213 retained raw points, 61 persisted O53 Detail points.

| Elapsed | Foreground/background | Lifecycle and source | Accepted movement / timer | Puck and controls | Persistence / Final |
|---:|---|---|---|---|---|
| +0 s | foreground | Recording | startup movement begins | screenshot family starts near 23 s / 0.01 km | Activity created |
| +1.5 to +2.4 s | inactive → background | background plan; native task starts | retained raw route later proves background continuity | foreground puck coordinate remains the last presented coordinate | local source evidence continues |
| +15.4 to +15.5 s | foreground in retained telemetry | foreground takeover drains/activates | route continues | source becomes Activity foreground authority | QA telemetry later ends at +41.1 s |
| ~23–26 s | screenshot evidence | UI claims Recording | 0.01 km; timer running | `LIVE PACE` reads `37'23"/km` then `42'16"/km` | values are cumulative duration/distance, not recent pace |
| later background interval | mostly background, per user and retained raw row | background collection remains materially continuous | 213 raw points produce 662.9 m; no catastrophic missing section | route advances while old foreground puck remains at entry point | current-position presentation did not consume latest BG evidence |
| 6:09 / 0.66 km | screenshot evidence after foreground return | controls were not reliably useful; Resume felt required | timer/distance imply ~9:19/km cumulative | displayed `9'17"/km`; puck still at old start while line is newer | route exists, current-position presentation is stale |
| Finish | terminal QA unavailable | server row finalized at `08:01:39Z` | 421 s / 662.893 m | Detail remained visibly GPS-like in O53 | 61-point Final persisted |

### Puck cause and O54 recovery

Background observations were durable and the route/canonical pipeline consumed them, but foreground presentation waited on its foreground-specific coordinate path. Therefore route truth and “you are here” used different freshness histories. O54 drains the newest matching Activity-owned background observation on foreground takeover and immediately publishes its time/coordinate if fresh enough. Presentation freshness then decides whether to show it. A stale retained coordinate is not labelled current.

This is independent of camera behavior. The puck can recover without recentering. Follow resumes only when follow intent remained active; manual pan remains manual.

### Pace cause

The screenshot arithmetic is diagnostic:

- about 23 s / 0.01 km is about 38 min/km;
- about 26 s / 0.01 km is about 43 min/km;
- 6:09 / 0.66 km is about 9:19/km.

Those are whole-Activity averages and closely reproduce the displayed values. O54 Live Pace instead uses recent, accepted, contiguous-segment movement: at most 35 seconds or 140 m, at least 12 seconds and 20 m, a fix no older than 12 seconds, recent movement in the last 10 seconds, horizontal accuracy no worse than 25 m, and a plausible 90–1200 s/km result. Startup, stop, stale/poor evidence, and segment/resume boundaries show `--`. Average pace remains a separate exact duration/distance calculation for Summary/Detail.

## `bad run` timeline

Start: `2026-09-13T09:13:50.859Z` (`17:13:50` Asia/Shanghai). Server row `2081`: persisted type Hike, 353.691 m, 635 active seconds, 230 retained raw/canonical-format points, 32 Final points, three segments.

| Elapsed | Foreground/background | Lifecycle and source | Accepted movement / timer | Puck and controls | Persistence / Final |
|---:|---|---|---|---|---|
| +0 s | foreground | Recording | initial movement | current presentation | session active |
| +17.2 to +19.2 s | inactive → background | background task starts and reports active | only 13 raw / 8 canonical observations then no callbacks | last coordinate remains displayable in O53 | WAL/session retained |
| +60/+120/+180/+240/+300 s | background | `backgroundTaskActive=true`, but source observations are stale | no meaningful movement | true degraded source condition | Activity must still be finishable |
| +350.3 to +360.7 s | foreground | takeover/drain; source later fresh | retained counts jump to 241 raw / 227 canonical | presentation has evidence again | no finish yet |
| +364.0 s | foreground | Paused | lifecycle clock freezes | Resume shown | durable pause |
| +367.4 to +381.0 s | foreground; rapid taps | several refresh/QA generations and foreground activation attempts; native starts at +375.1/+379.2/+381.0 | callback arrives while still Paused | O53 interaction feedback is ambiguous | parallel generations/watchers are in flight |
| +382.9 s | foreground | `activity_resumed`; UI now derives Pause because `status='tracking'` | health at +383.6 says source inactive/canonical degraded, age 22.455 s; timer behavior contradicts UI | **false Recording**; Signal Lost remains | source starts/stops both reach five |
| +384.2 to +386.3 s | foreground | another activation/callback, another `activity_resumed`, then Pause | source may be fresh momentarily but canonical remains degraded | repeated buttons do not yield one stable state | no coherent ownership publication |
| +386.3 to +393.3 s | foreground; more rapid taps | callback accepted into a resume segment only after a 4.353 s WAL commit; multiple Resume events alternate with Pause | accepted publication lands while lifecycle is Paused; distance remains 353.691 m | Pause/Resume family flips while puck/Signal state remains confusing | durable work belongs to competing generations |
| +675.7 to +678.2 s | reopened | restored recovery then Paused; source age ~270 s | clock held | user can finally choose Finish | unfinished state retained |
| +686.1 to +687.8 s | foreground | Finish | existing truth freezes | exits trap | token authority `unavailable`; zero Mapbox requests; Base fallback 230 → 32 points, three segments; `saved_pending` |

### Ten required answers

1. **What did tapping Resume actually change?** It launched authentication/QA/source activation work and, on more than one attempt, wrote `status='tracking'`; callbacks and a late WAL publication also occurred. It did not establish one serialized, durable recording-capable pipeline.
2. **Why did Pause appear?** The controls derived directly from `status='tracking'`. O53 published that lifecycle value before all competing source generations had cohered.
3. **Why did Active Time remain frozen?** Lifecycle UI publication and the authoritative lifecycle clock were not one success transaction. Competing Pause/Resume work and late callbacks allowed the label to advance while the clock remained/returned paused.
4. **Why did current position remain frozen?** Presentation was still tied to stale/foreground-specific state while provider activation and canonical publication raced. A late accepted point is not the same as a current, stable presentation provider.
5. **Why did Signal Lost remain?** Health still saw inactive/stale or canonically degraded evidence; changing `status` could not make the source fresh.
6. **Why did Back/Finish remain stuck?** O53 control/finish behavior was entangled with lifecycle/source transition work and the user reasonably tried to restore Recording first. Finish itself could still wait/fail on provider/context/ingest/Memory work. O54 makes Back a normal navigation action and Finish available during Recording, Paused, Resuming, Pausing, recovery, or stale source.
7. **Was source subscription running?** Intermittently. Telemetry shows repeated starts/stops and callbacks, not one stable subscription owned by the final UI generation.
8. **Was the canonical pipeline connected?** Intermittently. One callback was accepted and published after a 4.353 s WAL commit, while status had already changed again. That proves partial connection, not a coherent resumed pipeline.
9. **Was only UI state changed?** No. Some native and WAL work occurred. The P0 defect is that UI lifecycle state was allowed to claim success independently of whether that work formed one authoritative recording pipeline.
10. **What now constitutes real Resume success?** One single-flight transition has activated the appropriate Activity source, durably established ownership/context, restarted the lifecycle clock/registry, and atomically published Recording. A new accurate fix is not required: the valid result may be `Recording + Recovering location`, with `Resuming…` shown until lifecycle success and no stale puck presented as current.

## Resume/Finish corrections

Resume now coalesces repeated taps onto one in-flight promise. The screen remains Paused with `transitionState='resuming'` and renders `Resuming…`; only a successful source/lease/clock transaction publishes Recording. Failure returns truthfully to Paused, logs the failure, and leaves Finish available. Finish increments the transition/source intent epochs, so a late Resume cannot overwrite finalization.

Pause uses the same single-flight/epoch discipline and freezes the clock synchronously. Repeated Pause, Resume, Finish, or Cancel actions therefore cannot create parallel lifecycle ownership.

Finish confirmation is a screen transaction, not a pause operation:

```text
Recording → Finish confirmation → Cancel → Recording
Paused → Finish confirmation → Cancel → Paused
Recording + Recovering → Finish confirmation → Cancel → Recording + Recovering
```

The previous state is retained when the sheet opens; it is not inferred after Cancel.

## Finish is fail-safe

The O54 order is:

```text
freeze accepted Activity truth
→ bounded producer/context/drain/ingest fence
→ durable local pending payload
→ segment-local offline Base Final
→ local Activity session + completed-local registry
→ Activity Detail callback
→ optional bounded Mapbox enhancement
→ optional Memory reconciliation / server sync
```

A source-stop, durable-context, drain, or ingest wait receives a two-second bound. The canonical snapshot then closes explicitly: a slower pre-Finish WAL append may finish durably but cannot publish into the completed snapshot. Failure is diagnosed but cannot reopen acceptance or trap the user. Memory repair and Mapbox cannot prevent the local commit. The same client idempotency key updates the Base row/payload if an enhanced Final later succeeds. Repeated Finish sees the store-boundary finalization lock and cannot duplicate completion.

## Mapbox forensic

### What happened in the O53 field Activities

| Activity | Matching | Directions | Candidate/tracepoint evidence | Final decision |
|---|---:|---:|---|---|
| `wrong2` | 0 | 0 | completion preflight recorded token authority `unavailable`; no candidate or tracepoint existed | Base/canonical-derived, 374.693 m fallback; 157 → 33 display points, two segments |
| `something run` | terminal request telemetry unavailable | terminal request telemetry unavailable | persisted Detail is 61 GPS-like points; no defensible claim about an O53 network candidate | O53 Detail remained visibly jagged |
| `bad run` | 0 | 0 | completion preflight recorded token authority `unavailable`; no candidate or tracepoint existed | Base/canonical-derived, 353.691 m fallback; 230 → 32 display points, three segments |

The generic reason Snap appeared to do nothing for the two fully observed completions was not a conservative geometry gate: the JavaScript Mapbox authority was absent from the O53 OTA bundle, so no request was made. The installed RNMapbox 10.3.1 iOS singleton does not export a usable `getAccessToken`; Final API work requires `EXPO_PUBLIC_MAPBOX_TOKEN` to be embedded by EAS Update. The production EAS environment does contain a valid public token. Therefore the manual O54 publish must use `--environment production`; no token is logged or committed.

### Direct current reconstruction of `something run`

The retained 213-point raw stream was replayed through the current Run reducer: 207 immediate accept decisions, one rejection, five quarantines, no terminal pending candidate, yielding 211 canonical points and 659.6 m. Exact coordinates were never written to the report artifact; all visual output is translated to local metres.

| Layer | Points | Length | Micro turns | Sharp turns |
|---|---:|---:|---:|---:|
| retained raw | 213 | 662.9 m | 106 | 19 |
| current canonical replay | 211 | 659.6 m | 107 | 18 |
| O54 causal Live | 23 | 620.5 m | 6 | 4 |
| O54 offline Base Final | 47 | 619.0 m | 3 | 4 |
| persisted O53 Detail | 61 | 641.7 m | 17 | 6 |
| chosen O54 enhanced Final | 66 | 634.3 m | 2 | 7 |

With the production EAS token, current code made four walking Map Matching requests and three walking Directions requests, all HTTP 200, within the bounded budget. It captured 11 candidates. The four Matching windows had, respectively, 24/0 null tracepoints and four rejected candidates; 24/0 and one rejected; 24/0 and two accepted; 23/4 and three rejected. Directions accepted two spans and rejected one.

The compositor accepted 356.2 m of network-supported display and kept 303.5 m canonical-derived/free. Source ranges 35–100 (Directions, Mode B road offset, confidence 0.786) and 111–150 (Matching, Mode B, confidence 0.905) were refined. Unsupported or free-traversal ranges remained evidence-derived. No whole-route coercion, centerline forcing, or Gap bridge occurred.

This is visible value: O54 chosen Final has two micro turns versus 17 in persisted O53 Detail while preserving the route's principal turn structure. Exact match/side confidence remain separate: stable evidence uses an offset; strong corridor identity with unstable sidewalk side can enter `NETWORK_WEAK_SAME_CORRIDOR` and use an evidence-centered corridor representation instead of reverting to serrated GPS geometry.

## Geometry artifact classification

- `something run`: **DIRECT RETAINED RAW REPLAY** through current canonical, Live, Base, and enhanced Final code.
- `wrong2`: **RETAINED FORENSIC EVIDENCE ONLY**; no raw coordinate stream survives, so no geometry replay is claimed.
- `bad run`: **RETAINED LIFECYCLE FORENSIC**; lifecycle timeline is the appropriate comparison.
- straight, gentle bend, 90° corner, small Z, U-turn, switchback, and true Gap: **SYNTHETIC VALIDATION**.

The reproducible local artifact is generated by `app/scripts/evaluate-o54-field.mjs`. Its HTML/PNG/JSON outputs live under ignored `app/_review/o54-activity/` and are intentionally not deploy-bearing Git artifacts.

## Root-cause conclusion

`wrong2` and `bad run` were not evidence that BestForNavigation or the 1 m foreground/background request should be weakened. `wrong2` exposed a native transition whose timeout released serialization without cancelling the timed-out operation, plus accepted-movement age masquerading as source loss. `bad run` exposed unsynchronized Resume generations and lifecycle/clock/source publication. `something run` positively proves materially improved background collection while exposing a stale-presentation branch and a cumulative-average metric mislabeled Live Pace.

O54 fixes those meanings at their owning layers and leaves raw/canonical evidence, metrics, Memory truth, true Gaps, and GPS precision intact.
