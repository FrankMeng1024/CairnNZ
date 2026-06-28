# v383 OTA — Plan Final (post Review#1 + Review#2 + DB fact-check)

> **Status**: Final plan after 2 independent subagent reviews and 5 backend fact-checks. Replaces `v383-plan.md`.
> **Read before coding**.

---

## 0. Backend fact-check results (replaces speculation)

| Question | Verified fact | Source |
|---|---|---|
| Is `DELETE /api/memory/points` bulk hard-delete? | **Yes — `DELETE FROM memory_points WHERE user_id = ?`, returns `{deleted: N}`** | `backend/src/routes/memory.js:180-191` |
| Does `POST /api/sessions` enforce ts strict-increase? | **No** — accepts any array of ≥ 2 points, no per-point validation | `backend/src/routes/sessions.js:36-39` |
| What does production `markers.type` distribution look like? | `cairn 18 / water 6 / junction 9 / danger 4 / hut 3` — **zero `free` legacy rows** | Aliyun DB query |
| Does `GET /api/auth/me` exist? | **Yes** — returns `{user: {id, email, name, ...}}` | `backend/src/routes/auth.js:275-287` |
| What does a real-user hike's `route_points` look like? | 9163's session id=46: 87 points / 877m / 1073s, **no `ts` field** on points (only `lat/lng/alt`) | DB |

**Major implications**:
1. R1.4.1/4.2 Blockers (ts strict-increase + 9163 spacing) **moot** — real hikes don't store ts. Mock script should DROP the ts field entirely (currently sets it). Aligns mock with real per user's "和正常 hike 没区别" rule.
2. R2.5 (free legacy) — **zero rows**, drop `free` from TYPE_ENAMEL. 18 sprites correct. But still add Mapbox `coalesce` expression to guard future drift.
3. R1.3.1 (memory wipe semantics) — clean bulk delete. One-line wipe call is correct.
4. R1.7.5 (ALLOWED_UIDS check) — fully implementable via `/api/auth/me`.

---

## A. Mock Data Quality — REVISED

### A0. Preflight (NEW — required before any data write)

Before any uid processing:

1. **Mapbox token scope assert**: `assert MAPBOX_TOKEN.startswith("pk."), "secret tokens forbidden"`. Use a **separate** token `MAPBOX_TOKEN_MOCK_SERVER` (not `EXPO_PUBLIC_MAPBOX_TOKEN`) so production app's rate-limit bucket is not consumed by mock.
2. **authLimiter preflight**: log current `windowMs, max` of `/api/auth/login` (probe via test-login with throwaway invalid creds; observe `RateLimit-Limit` header). If `< 100`, abort with instruction: "bump backend authLimiter, see `feedback_mock_data_quality_rules.md`". Document the temporary bump-and-restore procedure in script comments.
3. **ALLOWED_UIDS guard**: `ALLOWED_UIDS = {19, 20, 21, 23, 24, 25, 26, 27}`. After each `login()` succeeds, call `GET /api/auth/me`; assert `user.id ∈ ALLOWED_UIDS`. Hard exit otherwise. Same check at top of `wipe_user_data()` as belt-and-braces.
4. **`--dry-run` flag**: phase-1 dry-run does all GETs + Mapbox calls, writes `output/v383/<uid>-preview.json` + GeoJSON, but ZERO DELETE/POST. Phase-2 `--execute` only after dry-run output passes 4-eye review.
5. **Geometry validator**: each Mapbox response runs through `validate_geometry()` — checks `len(coords) ≥ 5`, `total_distance ∈ [600, 3500]`, `vertex_spacing.median() < 40`, `max_turn_angle < 170°` (no near-U-turns). Fail → flag uid for waypoint reselection, no data write.

### A1. Profile + matching strategy (REVISED — Matching-first, not Directions-first)

Per Review#1 §2.4 (better matches user's "和正常 hike 没区别" framing):

1. **Default: Matching API with `walking` profile + per-coord `radiuses=10` + `tidy=true`** (matches production client `snapTrack.ts`).
2. On Matching response: scan output for `confidences[i] < 0.6` OR detect retraced segments (any edge appearing twice within < 30m total distance). If found → degrade to Matching with `radiuses=25` + log `MOCK.snap_widen uid=N r=10→25`.
3. If second Matching still backtracks → fallback to **Directions API** (per-leg, with intermediate via-points to force non-overlapping return) → log `MOCK.fallback_directions uid=N`.
4. If Directions returns `NoRoute` → try `cycling` profile in same call → log `MOCK.fallback_cycling uid=N`.
5. If everything fails: skip this uid, log loud error, continue with other 7. Do NOT silently substitute fake data.

Per-uid chosen path persisted into `output/v383/<uid>-meta.json` for reproducibility.

### A2. Densify removal (CONFIRMED — drop ts too)

- Remove `densify()` call entirely.
- **Also remove the `ts` field from each route_point**. 9163 has no `ts`. Mock matches reality.
- Backend accepts ts-less points (verified). Client `snapTrack` / replay treats missing ts as "no time info" — same as 9163.
- Mock writes `[{lat, lng}, ...]` only (no alt either — 9163 has alt but mock has no real altimeter data; safer to omit than fake).

This invalidates R1.2.1 (Directions seam ts duplication) and R1.4 series (ts strict-increase) entirely.

### A3. Memory wipe (CONFIRMED safe) + Full clean-slate wipe (NEW — user mandate)

**User mandate (2026-06-28)**: 除 9163(uid 22)外,所有 8 个 mock 账号(uid 19/20/21/23/24/25/26/27)— activity (sessions) + routes + flags + memory_points + markers — **全部清空,再 mock**。

`wipe_user_data()` 必须依次清:
1. **sessions**: `GET /api/sessions` → 对每个 id `DELETE /api/sessions/:id`
2. **routes**: `GET /api/routes` → 对每个 id `DELETE /api/routes/:id`
3. **markers**: `GET /api/markers` → 对每个 id `DELETE /api/markers/:id`
4. **memory_points (bulk)**:
   ```python
   s, _ = http_delete(f"{BACKEND}/api/memory/points", headers=h)
   if s != 200:
       print(f"  [err] DELETE memory failed: {s}")
       raise SystemExit(2)
   verify, body = http_get(f"{BACKEND}/api/memory/points?limit=1", headers=h)
   if body.get("points"):
       print(f"  [err] memory not empty after wipe: {body}")
       raise SystemExit(2)
   ```
5. **flags** — sessions table 内嵌的 flags JSON 字段;sessions 删完即随之消失。Marker 表的"flags"(用户语境里就是 markers)在 markers 步骤已处理。无独立 wipe。

**事实检查 (2026-06-28)**: Alice (uid 19) 留 1 条 routes, LDY (uid 23) 留 2 条 routes (`id=64 "Alice — home loop (saved)"`, `id=65/66 LDY ...`)。其余 6 账号 0 routes。这 3 条必须删。

Per Review#1 §3.1 — wipe 是 verified bulk + per-id 组合,所有 error 必须显式 print 不能 silent。

**9163 (uid 22) 完全不动** — 上述所有步骤前先 `assert user.id ∈ ALLOWED_UIDS = {19,20,21,23,24,25,26,27}`,任何 uid 22 出现则 hard exit。

### A4. Waypoint reselection (REVISED — Matching, not Directions)

Per Review#1 §2.4: keep using Matching, fix waypoints. Selection criteria:
1. Each pair ≥ 80m apart.
2. Anchor pre-validated via tilequery — only `class IN (street, service, footway, path, pedestrian, residential)`.
3. Loops with min 4 distinct waypoints, no waypoint pair on parallel alleys < 30m apart.
4. Total distance ∈ [800m, 3km].

Iterative selection: try waypoints → Matching → validate_geometry → 4-eye PNG → if reject, reselect. **Cap 3 iterations per uid**. After 3 failures, escalate with options (different street / shorter loop / drop uid).

### A5. Public markers (DEFERRED — drop SQL seed)

Per Review#1 §5.1 (SQL bypass = wrong tool):
- v383: keep current "silent demote to group" behavior in `post_marker()`. Add explicit `[info] uid=N public→group fallback` log so it's not silent.
- v384: backend adds `POST /api/admin/markers` with service token. Mock then uses this for Public-tier seeds.
- Public-tier visual coverage in v383 = data driven by existing Public markers in DB (zero today). Plan acknowledges this gap; UX deficit for Public-tier review is **a separate UX task**, not a Mock data task.

### A6. Production-DB safety (NEW)

- **Two-phase always**: dry-run output → 4-eye review → execute. No single-step.
- `MOCK_REVISION = "v383"` constant baked into all written records (as `name` suffix for sessions, custom field if available for markers) so forensic separation from real data is possible.
- Rollback path documented: re-run `wipe_user_data()` for all uids in ALLOWED_UIDS, then re-run v382 mock script. Tested: requires authLimiter bump.
- **No concurrent-user concern in production**: ACCOUNTS 1-3, 5-9 are mock-only — documented in `feedback_mock_data_quality_rules.md` + new script header comment.

### A7. 4-eye Playwright gate (REVISED — adversarial + geometric)

Per Review#1 §6.1/6.2 — image-LLM mode-collapse + z14 invisibility:

- **Visual gate uses z17 minimum** (z14 is blind to building polygons).
- **`shapely` building-intersection check (NEW, programmatic gate)**:
  1. Query Overpass API for `building` polygons in bbox of mock polylines (one-time).
  2. For each uid's snapped polyline, compute polyline ∩ buildings via `shapely.intersects`.
  3. Output `output/v383/<uid>-crossings.json` with crossing lat/lng + OSM way id.
  4. Mock script aborts if any uid has crossings > 0.
- **Adversarial subagent framing**:
  - sub#1 prompt: "You are reviewing for the strongest reason this polyline LOOKS LIKE A REAL HIKE. Defend it."
  - sub#2 prompt: "You are reviewing for the strongest reason this polyline is BROKEN. Find at least 3 problems."
  - Different evidence: sub#1 gets z17 PNGs; sub#2 gets z14 + per-uid crossings.json + bbox overlay against OSM building polygons.
- **Quantitative output required**: each sub returns numeric (turn-angle deg, marker-to-polyline distance px, building intersection count). Disagreements on numbers are detectable.

---

## B. Pin Visual Restore to v10 — REVISED (with experiment-first gate)

### B0. Root-cause experiment (NEW — mandatory before B code)

Per Review#2 §1: "iOS clips PointAnnotation children" is unverified and contradicts evidence. Run this experiment BEFORE writing B code:

1. Add temporary diagnostic build to `CairnPinsLayer.tsx`:
   - `onLayout` callback on parent View + crest Svg + core View, log measured size + position.
   - Explicit `overflow: 'visible'` on parent View (RN default but make it explicit).
   - Render a single test marker at known location, screenshot iOS native at 3x.
2. Compare measured dimensions against expected (52×72 parent / 20×16 crest / 44×44 core).
3. Decision tree:
   - If all measured sizes match expected AND visual screenshot shows core present but visually buried by shadow/border-thinness → **root cause = shadow bleed / z-order**, NOT clipping. Fix = stronger contrast, not bigger View.
   - If core measured size = 0 OR position outside parent bounds → **root cause = layout bug**. Fix layout.
   - If core measured fine but native screenshot shows it missing → **root cause IS clipping / SymbolLayer migration is the right answer**.

This 30-min experiment **gates** which B-section path we take. No B code lands without this evidence.

### B1. Layout fix (CONDITIONAL on B0 result)

If B0 confirms clipping or layout bug:
- Apply v10 layout: `parent: 52×60 relative` / `crest: absolute top:-2 left:50% marginLeft:-10 width:20 height:16 zIndex:3` / `core: marginTop:8 width:44 height:44 borderRadius:22`.

If B0 shows shadow bleed:
- Reduce `shadowRadius` from 7 → 4. Use solid `borderColor` (no shadow on border).

If B0 shows z-order issue:
- Reorder children so core renders FIRST, crest SECOND (later sibling = on top in RN).

### B2. Per-context pin sizing (FIXED — was REVERSED in original plan)

Per Review#2 §2: removing `scale 0.75` makes detail bigger, user complaint is too-big.

Introduce explicit constants:
```ts
const PIN_SIZE_MEMORY = 52;   // memory map (many pins, fullscreen)
const PIN_SIZE_DETAIL = 36;   // detail screen hero (single pin, smaller map area)
```

`CairnPin` accepts a `size` prop with default `'memory'` and `'detail'` variant. Detail screen passes `size="detail"`, no `transform: scale` wrapper.

Detail at 36px is smaller than v382's effective 39px (52 × 0.75). User's complaint is addressed.

### B3. Crest contrast (REVISED — platform-split, dark-mode aware)

Per Review#2 §3 — flat stroke is platform-inconsistent. Correct split:

- **iOS**: use SVG `<Defs><Filter id="crestGlow"><feDropShadow dx=0 dy=0 stdDeviation=1.5 floodColor={tierGlow}/><feDropShadow dx=0 dy=1 stdDeviation=1 floodColor="rgba(0,0,0,0.6)"/></Filter></Defs>`. Apply `filter="url(#crestGlow)"` on crest paths. Match v10 HTML rendering closely.
- **Android (filter ignored)**: render crest twice — first as larger-by-1-unit `fill={tierGlow}` (creates a halo), then normal crest on top. Visually approximates iOS glow without SVG filters.
- **Dark map style**: detect via `useMapStyleStore` (or whatever provides current style). If style ID matches dark variants, swap stroke colour to `rgba(255,255,255,0.7)` (light halo on dark map) on Android path; iOS filter floodColor unchanged (glow works on both backgrounds).
- **Crest geometry stays 20×16** — no stealth size change to 24×20. Spec Drift avoided.

### B4. Playwright SSIM gate (REVISED — calibrated + qualitative)

Per Review#2 §4 — uncalibrated SSIM 0.92 is meaningless because v382 has flat color (no radial gradient) vs v10's radial gradient.

Two choices, plan picks (b):

(a) Full v10 fidelity: add `<RadialGradient>` to core fill, SVG filter to crest. Then SSIM 0.92 attainable. **Cost**: more RN code, gradient/filter cross-platform fragility.

(b) **Sprite-as-canonical** (chosen): SymbolLayer (Section C) bakes sprites FROM v10 HTML via Playwright. Sprite IS the v10 rendering. iOS/Android show the same PNG. No SSIM gate needed for the SymbolLayer path; PointAnnotation legacy path uses simpler RN-svg approximation as a **fallback only**.

Visual gate replaced with:
- **v10 baseline**: 18 PNGs captured from HTML (DONE — see `docs/ux/mark-tier-explorations/baseline/`).
- **Sprite check**: bake script outputs PNGs; main agent diffs baked PNG vs HTML PNG via Playwright pixel compare. Threshold: ≥ 95% pixels within delta-E < 8. Calibrated by running v10 HTML vs itself (should be 100%) and v10 HTML vs v382 RN-svg flat render (should be ~60%). Pick threshold above the flat-render lower bound.
- **iOS native check**: 4-eye qualitative review of native screenshots taken on iOS sim (Expo dev client, not eas build).

### B5. v382 baseline regression measurement (NEW)

Per Review#2 §9.10: before any v383 code lands, run a dry-pass of D3 gates against current v382. Document what passes, what fails. v383 must improve on every fail AND not regress on any pass.

---

## C. Pin Zoom Scaling (SymbolLayer + Sprite) — REVISED

### C1. SymbolLayer migration (CONFIRMED)

Reasoning unchanged: PointAnnotation can't zoom-scale without per-frame render thrash. SymbolLayer scales via GL on GPU.

### C2. Sprite atlas (REVISED — 18 sprites, no `free`, `coalesce` fallback)

DB confirms zero `free` rows. Final sprite list:

| Tier × Type | Count | Notes |
|---|---|---|
| 3 × 5 main pins | 15 | self/friend/public × danger/junction/water/hut/cairn |
| 3 mystery (per tier) | 3 | unexplored cairn placeholder |
| Stranger blur | 1 | flat grey dot, no crest |
| **Total** | **19** | Bake to PNG via Playwright |

Plus Mapbox style expression `iconImage: ['coalesce', ['get', 'sprite'], 'pin-self-cairn']` so any future type drift falls back to cairn-default instead of disappearing.

### C3. Sprite bake (REVISED — pin Chromium version)

- `scripts/build-pin-sprites.mjs` — Playwright opens `docs/ux/mark-tier-explorations/round2-family4-1-v10.html`, screenshots each of 19 cells at 3x DPR (rendered 156×180 px).
- Pin `playwright` version in `package.json` so all builds produce byte-identical PNGs. CI bakes on Linux, dev bakes on Windows — if PNGs differ, fail CI.
- Commit PNGs to git (~285KB total per Review#2 §6 corrected estimate).
- Sprite names: `pin-{tier}-{type}.png` + `pin-mystery-{tier}.png` + `pin-stranger-blur.png` — 19 names total.
- TS index `app/assets/mark-pins/v10/index.ts` enumerates `require()` for `<Images>` registration.

### C4. onPress wiring (REVISED — specified)

```tsx
const features = useMemo(() => ({
  type: 'FeatureCollection',
  features: classified.map(c => ({
    type: 'Feature',
    id: c.marker.id,                    // STABLE id for Mapbox incremental diff
    geometry: { type: 'Point', coordinates: [c.marker.lng, c.marker.lat] },
    properties: {
      id: c.marker.id,
      tier: c.tier,
      type: c.marker.type,
      explored: c.isExplored,
      isSelf: c.tier === 'self',
    },
  })),
}), [classified]);

const onPress = (e: { features: Feature[] }) => {
  // Mapbox returns features sorted by symbolSortKey (we set self pins to lowest sortKey = drawn last = top)
  const f = e.features[0];
  if (!f) return;
  const m = markers.find(x => x.id === f.properties.id);
  if (!m) return;
  setSelection({
    kind: f.properties.explored ? 'revealed' : 'mystery',
    marker: m,
    tier: f.properties.tier,
  });
};
```

Style expression for sprite selection (explored vs mystery in single layer):
```js
iconImage: [
  'case',
  ['==', ['get', 'explored'], true],
  ['concat', 'pin-', ['get', 'tier'], '-', ['get', 'type']],
  ['concat', 'pin-mystery-', ['get', 'tier']]
]
```

### C5. Zoom + opacity + sort (REVISED — smooth interp, self priority)

```js
iconSize: [
  'interpolate', ['linear'], ['zoom'],
  11, 0.3,
  13, 0.55,
  15, 0.8,
  17, 1.0
]
iconOpacity: [
  'interpolate', ['linear'], ['zoom'],
  10, 0,
  11.5, 0.5,
  13, 1.0
]
symbolSortKey: ['case', ['get', 'isSelf'], 0, 1]  // self drawn last (top)
iconAllowOverlap: true  // never cull (avoid invisible-pin bug at zoom 17)
iconIgnorePlacement: true
```

- Smooth linear interp on iconSize + iconOpacity (no hard step).
- `iconAllowOverlap: true` always — Review#2 §8(b) flags that step expression on layout properties may not be supported in rnmapbox 10.3.x. Tradeoff: at zoom 17 dense areas may show overlapping pins. User can zoom further to disambiguate. Acceptable.
- `symbolSortKey` keeps self pins on top in overlap.

### C6. Touch target at low zoom (NEW per Review#2 §7(d))

At zoom 12 with iconSize 0.4, sprite renders ~21×24 device px. Below iOS 44pt accessibility minimum.

Mitigation: gate selection by zoom level — `if (mapZoom < 13) return; // pin too small to tap reliably`. Pinch in further to interact. Documented in user-facing copy ("放大查看").

### C7. UserLocation z-order (NEW per Review#2 §9.8)

Add cairn-pins SymbolLayer with `aboveLayerID="mapbox-location-indicator-layer"` (or whatever rnmapbox names the UserLocation layer). Cairn pins always on top.

### C8. Image cache invalidation (NEW per Review#2 §9.4)

Sprite names include version suffix: `pin-{tier}-{type}-v383.png`. Bump suffix on every OTA that changes sprites. Forces Mapbox image cache miss → fresh load. Costs nothing.

### C9. Dark mode pin (NEW per Review#2 §9.1)

For v383: silver public pin on dark map is acceptable degradation (current behavior). Document as known limitation. v384 considers dual sprite atlas (light/dark) selected via Mapbox style condition. Add `tasks/lessons.md` entry.

### C10. SymbolLayer a11y (NEW per Review#2 §9.2)

v383 ships SymbolLayer with a11y regression (markers not in OS a11y tree). Document as known. v384 considers off-screen marker list overlay for VoiceOver. Add lessons.md entry.

### C11. featureCollection rebuild cost (per Review#2 §9.3)

Current store has ≤ 100 markers per user. featureCollection rebuild at 100 markers/tick is trivial. Defer scalability (clustering, viewport windowing) to v385 when needed.

### C12. Trail layer hide-threshold (NEW per Review#2 §8(a))

Trail line layer (separate from pins) should hide at same zoom < 11 to avoid "trails without pins" desync. Audit current trail rendering location (out of scope here — flag for B-implementation phase).

---

## D. 4-Eye Review Workflow — REVISED

### D1. Plan stage (this round)

Already done:
- Plan → Review#1 (A only, adversarial) → Review#2 (B+C, adversarial).
- Both reviews flagged Blockers. Plan-final integrates all Blockers.

Next:
- **Plan-final review** by user (you reading this now).
- After user approval: 2 NEW adversarial subagents review plan-final:
  - sub#3 prompt: "Defend this plan — find the 3 strongest reasons it's correct."
  - sub#4 prompt: "Attack this plan — find the 3 most likely failure modes that this plan does NOT address."
- sub#3 + sub#4 outputs synthesized. Any new Blocker → revise plan. Iterate.

### D2. Implementation stage

Each commit slice:
- 2 subagents review diff cold:
  - sub#A reads diff + plan-final, judges plan adherence.
  - sub#B reads diff WITHOUT plan-final, judges code correctness in isolation.
- Disagreements flagged.

### D3. Pre-OTA visual gate (REVISED)

| # | Gate | Method |
|---|---|---|
| 1 | Mock route reality | 8 uids × z17 PNGs + crossings.json. Zero crossings, sub#3 + sub#4 adversarial review. |
| 2 | v10 sprite fidelity | Bake script PNGs vs HTML PNGs, ≥ 95% pixels within delta-E 8. |
| 3 | iOS native pin render | Expo dev client screenshots (not eas build) at 3 viewports + dark+light map. 4-eye qual review. |
| 4 | Zoom scaling | 3-sec screen recording, pinch z17 → z11. Verify smooth scale + fade. |
| 5 | v382 baseline diff | Run same gates on v382 bundle, document fail set. v383 must pass v382-fails AND not regress on v382-passes. |
| 6 | Memory wipe verification | After mock dry-run, manual `GET /api/memory/points` returns empty for ALLOWED_UIDS. |

### D4. OTA gate

All 6 D3 items pass + user explicit "ship v383" + release notes in `docs/release-notes/v383.md`. **No `eas build`** (永禁 per user memory). OTA only.

---

## E. Implementation order (REVISED)

1. **Plan-final user approval** (now).
2. **Plan-final adversarial review** (sub#3 + sub#4). Iterate until clean.
3. **Backend fact-check is DONE** — already gathered in §0.
4. **B0 root-cause experiment** (30 min — onLayout log + iOS sim screenshot).
5. **Parallel tracks**:
   - 2a: Mock script rewrite (A1-A7) with `--dry-run` first.
   - 2b: B-implementation gated on B0 result.
   - 2c: C-implementation (bake script + SymbolLayer + Images).
   - 2d: Playwright harness + shapely building intersection script.
6. **Per-track 4-eye review**.
7. **Integration on iOS dev client + Android dev client** (Expo dev client, NOT eas build).
8. **D3 6-gate visual review**.
9. **OTA push** if user approves.

---

## F. Risk register (REVISED)

| Risk | L | S | Mitigation |
|---|---|---|---|
| B0 experiment shows surprise root cause | Med | High | Plan B branches based on B0. Time-boxed 30min experiment. |
| Mapbox Matching with `tidy=true` still backtracks on 8 uids | Low | Med | Per-uid retry: r=10 → r=25 → Directions → cycling. Cap iterations. |
| `shapely`/Overpass setup adds Python deps | Low | Low | Lightweight; only mock-author needs it, not production app. |
| Sprite bake produces sub-pixel-different PNGs Win vs Linux | Med | Low | Pin Chromium version. CI lints. Manual rebake if drift. |
| 9163 has no ts but client-side replay assumes ts | Med | Med | Audit `app/src/services/sessionReplay*` (out of scope here) — if it crashes on no-ts, client patch is independent track. |
| Public mark UX gap (no Public pins to test against) | High | Low | Deferred to v384. Document. |
| iOS clipping is real after all → SymbolLayer is needed for both paths | Med | High | Already plan: SymbolLayer is primary, PointAnnotation only fallback. |
| `DELETE /api/memory/points` cascades to fog cache stale on client | Med | High | Wipe instruction includes "force-quit + relaunch app" or bump memory_version. |
| ALLOWED_UIDS missing 9163 by accident | VL | Critical | Compile-time set in script + runtime /me check. Two layers. |

---

## G. Open questions (deferred or out-of-scope)

1. v384: backend admin endpoint for Public markers (defers Review#1 §5).
2. v384: dual sprite atlas for dark-map (defers Review#2 §9.1).
3. v384: a11y overlay for SymbolLayer (defers Review#2 §9.2).
4. v385: clustering / viewport windowing at scale (defers Review#2 §9.3).
5. v384: client-side memory_version cache-bust signal (defers Review#1 §3.2 client-stale).

---

## H. Compared to v383-plan.md

Material changes:

- **Section A**: switched from "Directions API" default to "Matching-first with tighter params, Directions as fallback" (R1.2.4). Dropped densify AND ts field (R1.4 + 9163 fact). Added preflight (A0), shapely building-intersection (A7), --dry-run (A6). Replaced SQL Public seed with deferred-to-v384 (R1.5.1).
- **Section B**: Added B0 root-cause experiment as gate (R2.1). Reversed B2 sizing — added PIN_SIZE_MEMORY/DETAIL constants instead of removing scale (R2.2). Split B3 by platform with dark-mode (R2.3). Replaced SSIM gate with sprite-as-canonical + qualitative iOS review (R2.4). Added B5 v382 baseline regression (R2.9.10).
- **Section C**: Locked 19 sprites with `coalesce` fallback (R2.5). Specified onPress feature.id + style expression + symbolSortKey (R2.7). Smooth interp, no hard step (R2.8). Added C6 touch target, C7 z-order, C8 cache version, C9 dark mode, C10 a11y, C11 scale, C12 trail desync.
- **Section D**: Added new adversarial subagent round (sub#3 defend / sub#4 attack) on plan-final.
- **Section F**: Risk register rebuilt with verified facts.
