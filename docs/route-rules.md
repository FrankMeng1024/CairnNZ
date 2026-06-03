# Cairn Route Rules — Product Specification

**Version**: v4
**Date**: 2026-05-22
**Status**: Locked product rules. Awaiting v15+ OTA implementation.

This document captures the product rules for how routes are created, edited, navigated, and announced in Cairn. It is the single source of truth for route-related Stories in subsequent sprints.

---

## 1. Core Philosophy

**GPS Free is the foundation. Edit is an optional aid.**

Cairn does not assume the world's roads are fully mapped. The user's actual GPS trace is the truth. Map data (OSM / Mapbox / DOC) is used to *augment* and *normalize* a route, not to define what counts as a valid path.

Quote from the founder discussion (2026-05-22):

> "这条路我走过，在允许范围内我可以改到另一条，但是如果改不了，至少这条我走过的路是对的。世界上路千千万，不是所有路线都被收集了的。"

This produces three rule families:

1. **Creation** — only walked paths or shared-from-friend paths can become routes
2. **Editing** — within bounded geographic constraints, with strong "must have walked it" preservation
3. **Navigation** — direction-based voice with mode-aware thresholds

---

## 2. Route Creation Rules

### 2.1 Allowed sources
- ✅ Routes created from **a hike the user has completed** (any session in Activities)
- ✅ Routes **shared by a friend** (because the friend walked them)

### 2.2 Forbidden source
- ❌ Drawing a new route from scratch on the map without ever walking it

### 2.3 Implications
- The "+ New Route" button on the Routes tab must either be removed, or repurposed to "Choose a hike to convert".
- The RouteEditor screen is a **modifier**, not a creator. Its starting state must always be a real GPS trace.
- Hiking and Running end-of-session screens should offer a "Save as Route" CTA.

---

## 3. Route Type Classification

Routes are classified **per segment**, not as a whole. A single route can mix segment types.

### 3.1 Segment types

| Type | Description | Detection |
|------|-------------|-----------|
| **Road segment** | Trackpoints align with OSM/DOC road network | Mapbox Map Matching snap success > 80% over the segment |
| **Free segment** | Trackpoints have no road backing — bushwalk, beach, off-track, private farmland, sand, parkland | Snap success < 30% |
| **Mixed boundary** | Transitional segments (e.g. parking lot to trailhead) | 30–80% snap |

### 3.2 Classification timing
- Classification runs **after** the hike completes, **when device has signal**
- Classification is asynchronous — the user is not blocked while it runs
- Result is stored on the route and persists

### 3.3 Future enhancement (backlog)
Integrate **Department of Conservation (DOC) trail data** as a second source. NZ DOC publishes GIS data covering trails OSM does not have. The classifier should check OSM first, then DOC, then declare "free".

---

## 4. Route Editing Rules

### 4.1 When editing is allowed
- ✅ **Must be online** — Mapbox Directions API is required for road snap and pathfinding
- ❌ Editing offline is not supported (and not needed — nobody edits while hiking; editing is a planning activity at home)

### 4.2 Editing free routes (non-mappable trails)
- ❌ Free routes (entirely off-map) **cannot be edited** — there is no road network to compute valid edits against
- ✅ Free routes can still be **trimmed** at start/end (see Section 5)
- ✅ Free routes can be **followed as-is** for navigation — this is the default and most-used flow
- To change a free route, the user must walk it again (a new hike → save as route)

### 4.3 Editing road / mixed routes — the "1km Node Corridor"

**Definition of node**: A road network junction (cross-junction, T-junction, Y-junction, ferry terminal, etc.). A node is a topological intersection point in OSM/Mapbox data, not an arbitrary GPS sample.

**Editing corridor**: For each node on the **original** route, the corridor includes all nodes within **1 km** of that node. The union of all these reachable nodes defines where the user can move/add edit points.

```
For each node N in original_route.nodes:
    corridor.union(all_nodes_within_1km_of(N))
```

**Why 1km, not 3 hops**: In NZ, especially in suburbs and rural fringe, node density varies wildly. 3-hop graph traversal can jump 5+ km if the next node happens to be far. A fixed 1 km radius is predictable and matches user mental model.

**If 1 km contains zero nodes near a particular original node**: That node has no extension. The corridor is effectively "stuck to the line" at that point. Acceptable — pure trail sections can't be redirected.

### 4.4 The "original is forever" rule

The corridor is computed against the **original** node set, not the most recently saved version.

```
Edit 1: original [A, C, B] → user adds X (within corridor) → save as [A, X, C, B]
Edit 2: corridor recomputed against [A, C, B] (original), NOT [A, X, C, B]
```

**Why**: Prevents drift. Without this rule, a user could edit 1 km, save, edit another 1 km, save, and end up 3 km from where they actually walked. The original walked path is sacred.

### 4.5 The dual-line UI

Every edited route stores both:
- **Original line** — the GPS trace as walked, immutable, used as edit baseline forever
- **Current line** — the latest edited version, used for navigation

The Route Editor and Route Detail UIs let the user toggle between viewing the two. The original is always visible somehow (e.g. faded gray when current is shown).

### 4.6 Path geometry rules — "Don't break walls, prefer near, no backtrack"

When the user adds an intermediate point C between existing points A and B:

1. **Don't break walls** — connections must follow real roads. No diagonal cuts through buildings, properties, rivers, etc. Implementation: Mapbox Directions API for `walking` profile.
2. **Prefer near** — among possible road paths, pick the shortest total distance.
3. **No backtrack** — A → C should not loop back to A on its way to B (default). The user *can* explicitly add A again to force a backtrack (e.g. `A → C → A → B`); this is allowed but never recommended automatically.

### 4.7 Auto-inserted intermediate nodes (model 2)

When Mapbox Directions returns a path with junctions in the middle (e.g. A → C → B becomes A → C → D → B because the road requires going via D), **D is also a node** stored on the route.

Reason: The user *would* have added D if they'd been thinking about it. Auto-inserting it on their behalf is a natural extension of intent, not a phantom artifact.

**Performance requirement**: Auto-insertion of D must be fast.
- Don't call Directions API during drag (debounce)
- Call once when the user releases the drag
- Run A→C and C→B Directions calls in parallel
- Cache repeated endpoint pairs
- On API failure, show a placeholder gray straight line + retry in background — never block the UI

### 4.8 Mixed-corridor edits

A route can have a road segment AND a free segment. When editing:
- **In a road section**: Edit point must land on OSM road; auto-snap; auto-insert intermediate nodes; corridor enforced.
- **In a free section**: Edit point can be any GPS coordinate; no snap; connection lines are direct GPS lines (no Directions API).
- After editing, segment type for each section is **re-evaluated** — a previously free section can become road if the user routed it through mapped streets, and vice versa.

This is the single most important rule update vs earlier drafts: **type is per-segment, not per-route.**

### 4.9 Ferry / water routes

Ferry routes are part of the road network for routing purposes. Mapbox Directions includes them by default in walking and cycling profiles.
- Auckland: Devonport, Half Moon Bay, Waiheke
- Picton: Cook Strait crossing
- Bluff: Stewart Island

Edit corridors that span water are valid. Visual treatment (blue dashed line + small ferry icon) is a UI polish, not a rule.

---

## 5. Trim Rules

**Trim is allowed for any route, any time, regardless of type.**

### 5.1 What trim does
Removes the start and/or end portion of a route — typically the "from home to street" or "parking lot to trailhead" section that the user does not consider part of the actual route.

### 5.2 What trim is NOT
Trim only removes endpoints. It does not modify the middle of the route. Middle = sacred. Wilderness sections in the middle of a hike are never trimmed.

### 5.3 Algorithm (currently implemented in `routeMatcher.ts`)
For road segments:
- Find the first GPS point that is < 30 m from any OSM road → that's the route start
- Find the last GPS point that is < 30 m from any OSM road → that's the route end
- Discard anything before/after

For free segments (no roads to anchor against):
- Manual trim only — user picks start/end on the map
- Or skip trim entirely (default for fully-free routes)

### 5.4 UX
Trim should show a "removed N meters from start, M meters from end" summary so the user knows what changed. (Future enhancement.)

---

## 6. Navigation & Voice Announcement Rules

### 6.1 Mode-shared algorithm

**Hiking and Running share the exact same navigation engine.** They differ only in:
- UI presentation (detailed for hiking, large-text simplified for running)
- Threshold constants (running has wider tolerances because the user is moving faster)
- Interaction guards (running screen requires unlock to plant flags; hiking does not)

A single `useRouteFollowEngine` hook should serve both screens.

### 6.2 Threshold constants

| Constant | Hiking | Running |
|----------|--------|---------|
| Off-route warning threshold | 50 m | 80–100 m |
| Marker approach announcement distance | 50 m | 100 m |
| Off-route announcement minimum interval | 30 s | 30 s |
| GPS sample rate | 1 Hz (default) | 1 Hz (same) |

### 6.3 Direction announcement (relative, not compass)

Off-route guidance uses **left / right / behind**, not north/east/south/west. Most users have no mental compass. Voice phrases:

| Situation | Phrase |
|-----------|--------|
| User is on route | (silent) |
| User is 20–50 m off, route on left | "Route is on your left, head left" |
| User is 20–50 m off, route on right | "Route is on your right, head right" |
| User is 50+ m off | "You've left the route" + direction phrase |
| User has turned around | "Route is behind you, turn around" |

Distance numbers are **not** spoken in normal flow. They are used internally to decide whether to trigger.

### 6.4 Off-route segment-aware threshold

In **road segments**: tight 50 m threshold (the road is precise, deviation is intentional or wrong).
In **free segments**: relaxed 100–200 m threshold (the GPS trace itself is approximate; sand, beach, parkland may "pull" the user a few dozen meters off).
In **beach / parkland mode** (future, manual toggle): off-route announcements disabled entirely. The user knows they're off-trail; nagging is unwelcome.

### 6.5 Announcement events

The voice engine triggers on **events**, not on GPS sample frequency. GPS points are the path, not the speaker triggers. Events:

| Event | Phrase example |
|-------|----------------|
| Off-route deviation | "Route is on your left" |
| Approaching marker (cairn) | "Cairn ahead, 50m" |
| Approaching waypoint (junction) | "Junction ahead" |
| Progress milestone | "Halfway", "1 km left", "Almost done, 100m" |

Events that we are **explicitly NOT making**:
- "Are you stopped?" — rude. Users stop when they want to.
- "You're going slowly" — patronizing.
- Frequent encouragement ("Great pace!" etc.) — not Cairn's tone.

### 6.6 Frequency control
- No announcement triggers within 30 seconds of the previous announcement of the same event type
- Off-route state announces at most once every 30 s while user remains off-route
- Marker / waypoint announcements fire once per approach (not on every GPS tick)

---

## 7. Hiking vs Running — UI & Interaction Differences

### 7.1 Hiking screen
- Full stats display (distance, duration, elevation, current pace)
- Direct flag-plant button visible at all times
- Map prominent
- User is expected to glance at screen frequently

### 7.2 Running screen
- Large, simplified display: distance, pace, time
- Map smaller or hidden by default (user not looking)
- **Lock overlay enabled by default** to prevent accidental taps from arm motion
- Flag plant requires **unlock first** (e.g. long-press 1.5 s, or two-finger tap, or swipe)
- Pause is one-tap (frequent, must remain accessible)
- Lock toggle is one-tap (so user can disable lock easily when they want to plant a flag without unlock)

### 7.3 Flag-planting philosophy difference
- **Hiking flag** = casual record (water source, a junction, a nice view)
- **Running flag** = significant moment (a place worth stopping for)

The unlock barrier on running is intentional friction — it ensures flags planted while running are *meaningful*. The user actively decided to break stride to mark this place.

---

## 8. Offline Behavior

### 8.1 What works offline
- ✅ Following a previously-loaded route (the polyline is in local storage)
- ✅ GPS recording during hiking/running
- ✅ Off-route detection and direction announcement (pure math against the local polyline)
- ✅ Marker approach detection
- ✅ Voice announcement (Speech is local TTS)

### 8.2 What requires signal
- ❌ Editing a route (Mapbox Directions API needed)
- ❌ Map tiles outside cached region (Mapbox tiles)
- ❌ Initial classification of free vs road segments (Mapbox Map Matching API)
- ❌ Sync with backend (sessions, markers, friend shares)

### 8.3 Implication
A user can plan a hike at home (online), download the route, then go out into a NZ Great Walks signal black hole, and follow it perfectly. This is the intended scenario.

---

## 9. NZ-Specific Considerations

### 9.1 Verified contexts
- Auckland city / Devonport ferry → ✅ Standard road network applies
- Wellington urban + bush mix (Mt Vic, Tinakori) → ⚠️ Mixed segments; classifier will handle
- Tongariro Crossing, Routeburn, Milford, Kepler, Abel Tasman → ⚠️ OSM has the trails but signal is near-zero. Edit before going. Follow-only on track.
- Off-track tramping, hunter / fisher tracks → ❌ No map data; pure free-route flow
- Beach running (Mission Bay, Lyall Bay, Sumner) → ⚠️ Sand is not on the map; treat as free segment with relaxed off-route threshold
- Mountain biking trails (Rotorua, Queenstown) → ⚠️ OSM has them; activity mode is "Running" or future "Trail Run"
- Coast to Coast crossing private farmland → ❌ No data; pure free flow

### 9.2 DOC integration (future backlog)
NZ Department of Conservation publishes GIS trail data that often covers trails OSM lacks. The segment classifier should consult DOC as a second source after OSM.

### 9.3 Ultra-running culture
NZ has a strong ultra/trail running community (Tarawera Ultra, Old Ghost Road, etc.). The Running screen and route logic must work on **trails**, not just on streets. The shared algorithm in §6.1 already supports this — no special branch needed.

---

## 10. Implementation Roadmap (high-level)

The full ruleset above is **not implemented as of v14**. Current state implements only the most basic version: route record + save-as-route + simple endpoint trim.

A phased implementation plan, drawn from this document:

### Phase 1 — Foundation (v15 OTA candidates)
- Dual-line storage (original + current) — data model only
- Threshold constants extracted into config
- Running lock-overlay + unlock-to-plant
- Off-route detection (pure math, no voice yet)

### Phase 2 — Segment classification (sprint)
- Per-segment type detection (road / free / mixed)
- Async classification after hike completes
- Visual differentiation in route preview

### Phase 3 — Edit engine (sprint)
- 1 km node corridor calculation
- Mapbox Directions integration with debounce + caching
- Auto-insert middle nodes
- Free-segment edit support (direct GPS lines)
- Online-only enforcement

### Phase 4 — Voice navigation (sprint)
- Direction announcements (left/right/back)
- Event-driven triggering (marker, waypoint, milestone, off-route)
- Mode-aware thresholds (hiking vs running)
- Frequency throttling

### Phase 5 — Polish & specials (sprint)
- DOC data integration
- Beach / parkland mode toggle
- Trim summary display ("removed N m from start")
- Original-vs-edited line UI toggle

---

## 11. Glossary

| Term | Meaning |
|------|---------|
| **Free route** | A route whose GPS trace has no underlying map road data — bushwalk, beach, off-track, private trail |
| **Road route** | A route fully aligned with OSM/DOC mapped roads or trails |
| **Mixed route** | A route with both road and free segments (most NZ hikes that start at home and end on a trail) |
| **Cairn** | A user-planted flag/marker at a meaningful location. Both the product name and the in-app concept |
| **Node** | A topological junction in the road network (intersection, T-junction, ferry terminal). Not an arbitrary GPS sample |
| **Original line** | The exact GPS trace as recorded during the original walk. Immutable. The eternal baseline for edit corridors |
| **Current line** | The latest edited version of the route, used for navigation |
| **Corridor** | The set of map nodes a user is allowed to edit toward, computed as the 1 km neighborhood of original nodes |
| **Free segment** | A continuous stretch of trackpoints not aligned with any mapped road |
| **Road segment** | A continuous stretch of trackpoints that snap to OSM/DOC roads |
| **Snap success rate** | The proportion of trackpoints in a segment that Map Matching successfully aligns to a road. Used to classify segment type |

---

## Document History

- **v1** (2026-05-22 morning) — Initial sketch from late-night discussion
- **v2** (2026-05-22 morning) — Added trim universal rule, direction announcement
- **v3** (2026-05-22 morning) — Added 1km node corridor, original-is-forever, dual-line UI
- **v4** (2026-05-22 morning) — **Added per-segment classification (key shift), GPS Free as foundation philosophy, Running/Hiking shared algorithm**

End of document.
