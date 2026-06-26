# Spike H — GPS Degradation Robustness

Compares unlock styles A (corridor 50m polyline) / B (blob 25m per-point) / C (B + cream line) under 4 degraded-GPS scenarios. Truth = 30m radius around real user position.


## Scenario: dropout

| Style | Unlocked m² | False positive m² | Break length m | Components |
|---|---:|---:|---:|---:|
| A_corridor | 453,515 | 286,015 | 0 | 1 |
| B_blob | 356,171 | 194,375 | 248 | 2 |
| C_combo | 356,171 | 194,375 | 248 | 2 |

## Scenario: stationary

| Style | Unlocked m² | False positive m² | Break length m | Components |
|---|---:|---:|---:|---:|
| A_corridor | 218,320 | 101,132 | 0 | 1 |
| B_blob | 225,000 | 106,796 | 0 | 1 |
| C_combo | 225,000 | 106,796 | 0 | 1 |

## Scenario: highspeed

| Style | Unlocked m² | False positive m² | Break length m | Components |
|---|---:|---:|---:|---:|
| A_corridor | 646,640 | 269,296 | 0 | 1 |
| B_blob | 675,664 | 297,265 | 0 | 1 |
| C_combo | 675,664 | 297,265 | 0 | 1 |

## Scenario: indoor

| Style | Unlocked m² | False positive m² | Break length m | Components |
|---|---:|---:|---:|---:|
| A_corridor | 108,359 | 65,273 | 0 | 1 |
| B_blob | 109,414 | 65,976 | 0 | 1 |
| C_combo | 109,414 | 65,976 | 0 | 1 |

## Recommendation

### Key findings per scenario

**1. Dropout (60s GPS loss, ~160m gap)**
- A corridor: 0m break — the polyline just *bridges* the gap with a straight line. Looks "intact" but is actually showing 50m of unwalked territory as unlocked (FP 286k m², +47% vs B). User wouldn't notice the lie.
- B blob: visible 248m break, 2 disconnected components. Honest but ugly: looks like the map glitched.
- C combo: same break + 2 components as B, but cream line glues them visually — same data, but the eye reads it as one trail with a fade. **Best perceptual recovery.**

**2. Stationary (5min standing, 300 jittered pts)**
- All three nearly identical (~225k m² unlocked, ~106k FP). Blob/combo +3% FP vs corridor. Visually B/C show a denser "puddle" at the stop, A shows a thin line. **Tie.**

**3. Highspeed (80km/h, ±15m accuracy)**
- All ~675k m² unlocked; A actually has *lower* FP (269k vs 297k) because the polyline filters jitter, but B/C still come out as 1 component (the 22m spacing < 25m radius means blobs merge). The "bead-string" failure mode did NOT trigger here — blobs stayed connected. **A slightly cleaner, but B/C acceptable.**

**4. Indoor drift (50m random walk)**
- All three paint ~109k m² of "unlocked" non-walked area (FP 65k m² each). They lie equally. The cream line in C makes the lie *more* convincing by drawing a fake "path" through random noise. **All three fail. C arguably worst because it commits hardest to the fiction.**

### Verdict: which one disappoints users least?

**C (blob + cream line) wins overall** — but it's a perceptual win, not a data win:

| | A corridor | B blob | C combo |
|---|---|---|---|
| Dropout honesty | Lies (bridges gap silently) | Honest break (ugly) | Honest break + visual glue |
| Dropout user feel | "Worked fine" | "Map broken" | "Took a detour" |
| Indoor lie | 65k m² fake area | 65k m² fake area | 65k m² + fake path line |
| Sparse-point look | Smooth | Bead-string risk | Bead + line = unified |
| Failure mode | Invisible | Visible | Visible but softened |

**The deciding factor is dropout behaviour.** A corridor's polyline silently fabricates connectivity — user gets a "complete" map that's actually 47% phantom. B is honest but its visible gap reads as a bug. C carries B's honesty but uses the cream line to make gaps read as *intentional rendering*, not failure.

**Recommendation: ship C.** It loses to A on FP-area in dropout/highspeed by a small margin, but it wins on the only metric users can verify with their own memory — *did the unlocked area match where I actually walked?* — and it degrades gracefully where A degrades deceptively.

**One caveat**: in the indoor scenario C is marginally worst because the cream line dignifies random noise. Mitigation: gate the cream-line draw on a min-speed filter (e.g. only segments with >1 m/s travel) so static / indoor drift never gets a path drawn through it. That single guard turns C from "tied worst indoors" to "best across all 4 scenarios".

| Failure mode | Worst style | Why |
|---|---|---|
| Break length (dropout) | B_blob | A's polyline hides the gap; B exposes it as 2 components |
| False positive (indoor) | B_blob (tied with C) | Random walk paints same fake area for all 3 |
| Components (highspeed) | A_corridor | A=1, B/C=1 — blobs merged at 22m spacing, no bead string |
| False positive (stationary) | B_blob (tied with C) | Blob radius union > corridor width at jitter cluster |