# `almost done` — O46 confirmed-head presentation forensic

Status: forensic complete; design only; no production presentation fix implemented.

## Finding

The 900 ms duration is not the primary defect. O46 renders two separately capped and separately cased line sources, and it advances the body only after an animation completes. On this Activity, 234 of 270 targets were interrupted and only 38 completed. The stable body therefore rarely commits, while a mutable two-to-eight-vertex head repeatedly retargets. Its round start cap and opaque casing paint above the body's endpoint and make each target read as a small independent line.

Authority:

- `app/src/screens/HikingMap.tsx`: `ConfirmedRouteHead`, `CONFIRMED_HEAD_ANIMATION_MS`, body/head layers.
- `app/src/features/activity/confirmedRoutePresentation.ts`: `planConfirmedHeadTargets`, eight-target cap.
- installed `@rnmapbox/maps/src/classes/AnimatedCoordinatesArray.js`: array-index interpolation and add/remove behavior.
- `qa-mtwhxdio-22iczr8v`: the recorded presentation checkpoints for `almost done`.

## Exact render evolution for A → B → C → D

Assume A is already stable and B, C, D arrive as canonical points.

| Event | `stableCount` | Static body | Animated-array start | Animated target | What is painted |
|---|---:|---|---|---|---|
| A only | 1 | hidden because it has fewer than two coordinates | `[A,A]` | none | no confirmed line yet |
| B arrives | 1 | hidden | `[A,A]` | `[A,B]` | a separate round-capped A→B mini-line grows for 900 ms |
| B completes | 2 | A→B | reset to `[B,B]` | none | body atomically gains B; head disappears |
| C arrives after completion | 2 | A→B | `[B,B]` | `[B,C]` | a new round-capped B→C mini-line grows above the body |
| D arrives after C completes | 3 | A→B→C | `[C,C]` | `[C,D]` | a new round-capped C→D mini-line grows above the body |

The observed high-cadence case is worse:

| Event | Stable body | Current animated value | New target | Consequence |
|---|---|---|---|---|
| B is 140 ms into A→B | still A | approximately `[A,A+0.16(B−A)]` | `[A,B,C]` | the prior animation is stopped; B and new C vertices are interpolated by array index/from the prior last vertex |
| D arrives before completion | still A | a partially reflowed A→B→C head | `[A,B,C,D]` | another stop/reflow; body still does not commit |
| mutable tail exceeds eight | advances to `length−2` without a completed visual handoff | reset near the recent tail | recent head resumes | bounded memory, but another visible topology reset |

`AnimatedCoordinatesArray` interpolates coordinates by array index. When the target has more vertices, each added target starts from the previous array's last coordinate. Retargeting freezes the current interpolated array and then starts another index-wise interpolation. This is not an arc-length endpoint advancing along one immutable polyline.

## Why the seam is visible

Body and head both use:

- casing: 8 px, 0.86 opacity, round cap, round join;
- core: 4.5 px, round cap, round join.

The head source is declared after the body source. At their shared coordinate its casing paints over the body's green core, and its core adds a second round terminal. Even a perfectly timed 900 ms animation can therefore show a bead/start node at B, then C, then D. Non-atomic commit adds a possible gap or overlap while the head disappears and the body gains vertices. React state, Mapbox source updates, and native layer frames are not one transaction.

Recorded evidence:

- targets: 270;
- interrupted: 234;
- completed: 38 (14.07% of targets);
- interruption elapsed: p50 137 ms, p95 893.7 ms, max 912 ms;
- mutable target count: 2 (177), 3 (55), 4 (20), 5 (9), 6 (6), 7 (2), 8 (1).

## Options

Scores are 1 (poor) to 5 (best). Complexity is scored inversely: 5 means simplest.

| Option | Visual continuity | Truth isolation | Performance | Retarget | Turns | Stationary | Lifecycle/background | Complexity |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| P1 — one ShapeSource: stable coordinates plus one interpolated presentation endpoint | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 4 |
| P2 — static body + head with butt start cap, underlap and atomic commit | 4 | 5 | 4 | 4 | 4 | 5 | 5 | 3 |
| P3 — Mapbox line-trim/progress | 5 | 5 | 5 | 3 | 5 | 5 | 4 | 2 |
| P4 — precomputed arc-length samples with source crossfade | 4 | 5 | 3 | 4 | 4 | 5 | 4 | 2 |

### Recommendation: P1

Keep canonical truth immutable. Maintain presentation state as:

```text
stable canonical prefix + one interpolated endpoint
```

On a new canonical point, interpolate the single endpoint from its current rendered position toward the new point. If another point arrives, retain the current endpoint and retarget along the ordered pending polyline by arc length. Publish one LineString to one source, with one casing/core pair. Once the endpoint reaches a target, fold that target into the stable prefix without changing the rendered coordinates for that frame.

This produces one growing route, preserves turns and gaps, and does not alter canonical, Memory, distance, matching, or Save. On foreground restoration, install the already-confirmed background history immediately and animate only points confirmed after the handoff.

P2 is the lower-risk fallback if one-source updates prove expensive. The head must begin under the body's last segment, use no visible start cap, share exact paint properties, and atomically commit. P3 is visually attractive, but `line-trim-offset` remains an experimental style property and whole-line progress/retarget bookkeeping is more complex than this problem requires ([Mapbox style specification](https://docs.mapbox.com/style-spec/reference/layers/#paint-line-line-trim-offset)).

## Verdict

Changing 900 ms alone will not remove the mini-line origins. A shorter duration would merely reduce their lifetime; a longer one increases interruption. The defect is the two-source/cap/commit topology plus array-index retarget behavior. Fix topology first, then tune duration against native evidence.
