# v383 Plan Final 2 (post Attack-review resolution)

> **Status**: Final plan after BOTH adversarial rounds — review#1/#2 (NEEDS_CHANGES) → plan-final.md → defend (APPROVE_WITH_CAVEATS) + attack (NEEDS_REWRITE w/ 1 Blocker 4 High) → plan-final2.md (this file, all attacks resolved or downgraded).
> Replaces `v383-plan-final.md`.

---

## 0. Attack resolution log

Below — each of attack#1-#8 verified against actual code/docs, then resolved.

### Attack #1 (Blocker) — "OTA cannot ship new PNG sprites; mapboxAdapter missing SymbolLayer/Images"

**Resolution: Downgraded to Medium with concrete OTA-safe path.**

Verified facts:
1. `mapboxAdapter.ts` lines 12-22 does NOT export `SymbolLayer` or `Images` — **TRUE**. Must extend adapter.
2. `app/assets/` has no `mark-pins/` folder — **TRUE**. New PNGs would require `eas build` if shipped as `require('./pin.png')` static asset.

But — `@rnmapbox/maps` documentation (just verified via context7):
- `<Images>` accepts THREE source types: `require()`, `{uri: 'http://...'}`, OR `<Mapbox.Image name="x"><View>...</View></Mapbox.Image>` children component.
- **`<Mapbox.Image>` with children renders an arbitrary RN View tree as the sprite** — pure JS, no native asset, ships via OTA.

**Decision**: Use `<Mapbox.Image>` with RN View children for v383 sprites:
```jsx
<Mapbox.Images>
  {[...tiers].flatMap(tier => types.map(type => (
    <Mapbox.Image key={`pin-${tier}-${type}`} name={`pin-${tier}-${type}`}>
      <CairnPinV10 tier={tier} type={type} />
    </Mapbox.Image>
  )))}
  {tiers.map(tier => (
    <Mapbox.Image key={`pin-mystery-${tier}`} name={`pin-mystery-${tier}`}>
      <MysteryPinV10 tier={tier} />
    </Mapbox.Image>
  ))}
  <Mapbox.Image name="pin-stranger-blur"><StrangerBlurredPinV10 /></Mapbox.Image>
</Mapbox.Images>
<Mapbox.SymbolLayer id="cairn-pins" style={{ iconImage: ['get', 'sprite'], ... }} />
```

**Trade-offs vs original plan**:
- ✅ Pure OTA. Zero new asset files. Adapter only needs `SymbolLayer + Images + Image` exported.
- ✅ Same RN component renders sprite AND legacy PointAnnotation path → guaranteed consistent visuals.
- ✅ No build script. No Playwright bake. No PNG diff CI. Section §C3 simplified by ~70%.
- ⚠️ Sprite rendering is RN's job at mount time. Slight cold-start cost (~50-150ms for 19 sprite mounts) — acceptable.
- ⚠️ If a sprite triggers a runtime error (e.g. react-native-svg filter unsupported), iconImage resolves to fallback. Use `coalesce` per §C2.

**Updated mapboxAdapter.ts requirement**: add `SymbolLayer`, `Images`, `Image` to the interface + export.

---

### Attack #2 (High) — "ts removal breaks v382 clients in field during rollout"

**Resolution: Threat does not exist. Verified.**

Code audit: `MapHistoryScreen.tsx:706-715` already normalises server `route_points` to local `TrackPoint`:
```ts
const normalised = detail.route_points.map((p: any) => ({
  lat: p.lat,
  lng: p.lng,
  alt: p.alt ?? null,
  t: typeof p.t === 'number' ? p.t : (p.timestamp ? Date.parse(p.timestamp) : Date.now()),
}));
```

Line 713 has a 3-way fallback: `p.t || p.timestamp || Date.now()`. **No `ts` reference at all** — server side uses `timestamp`, local uses `t`. Mock writing `[{lat, lng}]` only triggers the `Date.now()` branch — every point gets the current wall clock. Downstream replay sees a tight cluster of timestamps but doesn't crash.

9163 has no `ts/timestamp/t` field on points (confirmed in plan-final §0) yet v382 clients have been opening 9163's session for weeks without crash. Empirical proof Attack #2 is moot.

**Decision**: keep plan-final §A2 (drop ts) as-is. No defensive patch needed.

---

### Attack #3 (High) — "authLimiter preflight probe consumes the limit it's measuring"

**Resolution: Reframed — drop probe, react to actual failure.**

Per Attack#3 修补建议 (2): "skip the probe entirely. If first login 429s, the script's existing error path should print 'authLimiter is too tight — bump it per [procedure]'." This is simpler AND safer.

**Updated §A0.2**:
```python
def login(email, password):
    status, body = http_post(f"{BACKEND}/api/auth/login", {"email": email, "password": password})
    if status == 429:
        print(f"\nERROR: authLimiter exhausted. Bump it per the procedure below:")
        print(f"  ssh root@122.51.174.118 'docker exec cairn-backend sed -i \"s|max: [0-9]\\+|max: 5000|\" /app/src/routes/auth.js && docker restart cairn-backend'")
        print(f"  Wait 10s, then re-run script.")
        sys.exit(2)
    if status != 200:
        return None
    return body.get("token")
```

No probe. React to actual 429 on first real login. Self-deadlock impossible.

---

### Attack #4 (High) — "shapely + Overpass silently passes when Overpass times out"

**Resolution: Switch to committed static buildings GeoJSON.**

Per Attack#4 修补建议 (2): "commit a static GeoJSON of all buildings in the bbox enclosing the 8 walking loops to `tasks/jira/sprintN-evidence/v383-buildings.geojson`. Mock script loads this file, never calls Overpass at runtime."

**Updated §A7**:
1. **Pre-mock one-time step** (manual, not in script):
   - Use `overpass-turbo.eu` web UI to query buildings in bbox `[31.222, 121.428, 31.235, 121.440]` (covers all 8 loops with 200m margin).
   - Export GeoJSON to `backend/scripts/seed/data/v383-jingan-buildings.geojson`.
   - Commit to git. ~50-200KB.
2. **Mock script load**:
   ```python
   with open("data/v383-jingan-buildings.geojson") as f:
       buildings = json.load(f)
   assert len(buildings["features"]) > 50, "buildings GeoJSON empty — re-export from overpass-turbo"
   ```
3. **shapely intersect** per uid → `output/v383/<uid>-crossings.json`.
4. **HARD STOP** if any crossings > 0 OR if asserted buildings count fails.

Network-independent. Reproducible. Sub#3 + sub#4 (and user) can all see the same buildings file.

---

### Attack #5 (High) — "B0 experiment on simulator doesn't transfer to production binary"

**Resolution: Use log-injecting OTA on real device, not simulator.**

Per Attack#5 修补建议 (2): "ship a v383-experimental OTA that ONLY adds `onLayout` logs to `CairnPinsLayer.tsx` (no behavior changes). User runs prod binary, real device, normal usage. Logs flow to backend. Main agent reads logs the next day."

**Updated §B0**:
1. **v383-exp branch** (one-line addition): add `onLayout={(e) => log('v383.pin_layout', {...e.nativeEvent.layout, marker_id: id, tier, type})}` to CairnPin parent View, crest Svg, core View.
2. **Push v383-exp OTA**. User pulls, uses Memory map normally (5-15 min). Logs reach backend `debug_snapshots` table.
3. **Main agent queries Aliyun DB next day**:
   ```sql
   SELECT JSON_EXTRACT(payload, '$.parent_h'), JSON_EXTRACT(payload, '$.core_h'), JSON_EXTRACT(payload, '$.crest_h')
   FROM debug_snapshots WHERE event = 'v383.pin_layout' ORDER BY id DESC LIMIT 100;
   ```
4. **Decision tree** runs on REAL device data, not simulator. Per `feedback_review_loop_dynamic.md` (memory note: "静态 subagent loop 会循环看自己代码漏掉真实 device 行为").

Side effect: this v383-exp OTA is **also a verification** that adapter exports + Mapbox.Image runtime sprite path works on real device, before committing to full §C migration.

---

### Attack #6 (Med) — "D3 gate #5 v382 baseline diff is circular for 4/6 gates"

**Resolution: Restate as new-gate vs regression-gate classification.**

**Updated §D3**:
| # | Gate | Classification |
|---|---|---|
| 1 | Mock route reality | **regression** (v382 has mock data, v383 has mock data) |
| 2 | v10 sprite fidelity | **new** (v382 has no sprites) |
| 3 | iOS native pin render | **regression** (v382 has pins, v383 has pins) |
| 4 | Zoom scaling | **new** (v382 has no zoom scaling) |
| 5 | Memory wipe verification | **new** (v382 mock didn't wipe) |
| 6 | (was v382 baseline) — folded into regression gates above | — |

v383 must:
- Pass all **new** gates (the whole point of v383).
- For each **regression** gate: v382 fail set ⊆ v383 fail set's complement (v383 fixes what v382 fails). v382 pass set ⊆ v383 pass set (no regression).

---

### Attack #7 (Med) — "routes table not wiped"

**Resolution: ALREADY RESOLVED in plan-final §A3 amendment (committed earlier this session).**

`wipe_user_data()` now explicitly deletes routes too:
> "2. **routes**: `GET /api/routes` → 对每个 id `DELETE /api/routes/:id`"

DB query confirms Alice has 1 route, LDY has 2. User confirmed "全部清空 然后重做 mock". `DELETE /api/routes/:id` endpoint verified to exist at `backend/src/routes/routes.js:140`.

---

### Attack #8 (Med) — "D1 adversarial review has no termination"

**Resolution: 2-round cap, file-citation requirement.**

**Updated §D1**:
- Maximum **2 adversarial rounds** (this round counts as round 1).
- Round 2 (if needed): only after main agent + user agree some round-1 attacks were unresolved.
- **Citation requirement**: each sub#4 attack MUST cite a specific file:line OR Mapbox/RN documentation URL. Pure abstract concerns ("might fail") without citation are downgraded to backlog.
- After round 2: remaining sub#4 findings recorded in `tasks/PARKED_PROPOSALS.md` with rationale, NOT auto-promoted to Blockers.

---

## 1. Updated A — Mock Data Quality

Inherits plan-final §A with these revisions:

- **§A0.2**: drop the probe. Use try-login + 429-catch as per Attack#3 resolution.
- **§A1**: keep Matching-first, Directions fallback. Per-uid profile logged.
- **§A2**: drop ts AND alt fields from mock route points (match 9163: `[{lat, lng}, ...]`). Attack#2 verified safe.
- **§A3**: wipe order: sessions → routes → markers → memory_points (bulk). All verified per-user-scoped. ALLOWED_UIDS = {19,20,21,23,24,25,26,27} guarded.
- **§A4**: waypoint reselection 3-iter cap per uid (sub#3 caveat).
- **§A5**: Public marker SQL seed REMOVED. Deferred to v384 admin endpoint.
- **§A6**: --dry-run mandatory before --execute.
- **§A7**: use committed static `v383-jingan-buildings.geojson` instead of live Overpass (Attack#4).
- **§A8 (NEW)**: 7-out-of-8 acceptance — if 1 uid's loops can't satisfy all gates after 3 reselect iters, escalate to user with options (skip uid / shorter loop / different street). Don't silently substitute.

---

## 2. Updated B — Pin Visual Restore

Inherits plan-final §B with these revisions:

- **§B0**: replaced simulator experiment with **log-injecting v383-exp OTA on real device** (Attack#5).
- **§B1-B3**: unchanged from plan-final (PIN_SIZE_DETAIL=36, platform-split contrast, no stealth crest size change).
- **§B4**: SSIM gate REMOVED entirely (sub#2 §4). Replaced with:
  - Visual gate = sprite-as-canonical (Mapbox.Image children renders v10 `CairnPinV10` component).
  - 4-eye qualitative review of iOS dev-client screenshots vs v10 HTML baseline (18 PNGs already captured at `docs/ux/mark-tier-explorations/baseline/`).
- **§B5**: v382 baseline regression measurement now uses §D3 regression-gate classification (Attack#6).

---

## 3. Updated C — Pin Zoom Scaling

Inherits plan-final §C with these revisions:

- **§C1**: SymbolLayer migration confirmed.
- **§C2**: 18 sprites (no stranger as sprite — render via SymbolLayer with separate `iconImage: 'pin-stranger-blur'`, total 19 mapbox image names). `coalesce` fallback unchanged.
- **§C3**: REPLACED — no Playwright bake, no PNG files. Use `<Mapbox.Image name="..."><CairnPinV10 .../></Mapbox.Image>` children component (Attack#1 resolution).
- **§C4**: onPress spec unchanged.
- **§C5**: zoom/opacity interp unchanged.
- **§C6**: zoom < 13 disables tap (touch target floor).
- **§C7**: aboveLayerID on cairn-pins SymbolLayer.
- **§C8**: cache invalidation simplified — since sprites are rendered at runtime by RN, no PNG to cache. Mapbox internal image cache keyed by image name; we just need unique-per-OTA name if visuals change. Plan: bake the OTA version into image name only if v10 design changes between OTAs (rare).
- **§C9-C11**: unchanged.

---

## 4. Updated D — Review Workflow

- **§D1**: 2-round cap + citation requirement (Attack#8).
- **§D2**: per-commit review unchanged.
- **§D3**: gates classified new vs regression (Attack#6).
- **§D4**: OTA gate unchanged.

---

## 5. Updated E — Implementation order

1. **Plan-final2 user approval** (now).
2. **B0 experiment via v383-exp log-OTA** — push minimal onLayout-log OTA, wait for user to use map, query Aliyun DB for layout data.
3. **Parallel tracks**:
   - **2a** Mock script rewrite (A1-A8) with `--dry-run` first.
   - **2b** Pin component extraction (`CairnPinV10`, `MysteryPinV10`, `StrangerBlurredPinV10`) — design source-of-truth.
   - **2c** mapboxAdapter.ts extension (add SymbolLayer, Images, Image exports).
   - **2d** SymbolLayer migration in CairnPinsLayer using Mapbox.Image children.
   - **2e** Buildings GeoJSON one-time capture from overpass-turbo.eu.
4. **Per-track 4-eye review** (max 2 rounds per Attack#8).
5. **iOS dev client + Android dev client** integration (Expo dev client, no eas build).
6. **D3 6-gate visual review**, classified per Attack#6.
7. **v383 OTA push** if all gates green + user explicit approval.

---

## 6. Compared to plan-final.md

Key changes:

| Section | Change |
|---|---|
| §0 Attack resolution log (NEW) | Every sub#4 attack #1-#8 verified + resolved |
| §A2 | Drop alt field too (match 9163 exactly) |
| §A3 | Already amended for routes wipe (mid-session) |
| §A5 | Public SQL seed REMOVED entirely |
| §A6 | Static buildings GeoJSON instead of live Overpass |
| §A7 | Buildings file path, ≥50 features assertion |
| §A8 (NEW) | 7-out-of-8 acceptance escalation |
| §B0 | Log-injecting OTA replaces simulator experiment |
| §B4 | SSIM gate REMOVED |
| §C3 | Mapbox.Image children replaces Playwright PNG bake |
| §C8 | Cache invalidation simplified |
| §D1 | 2-round cap + citation requirement |
| §D3 | Gates classified new vs regression |
| §E2 | B0 via log-OTA is first implementation step |

---

## 7. Verdict

Plan-final2 is **READY FOR USER APPROVAL**. All sub#1 + sub#2 Blockers, sub#3 caveats, and sub#4 attacks have either been resolved or verified non-threats.

The remaining risk surface is execution risk (sub#3 caveat #1, #2: B0 experiment ambiguity, fallback chain success rates). These are managed by:
- B0 → log-OTA approach moves from speculative to data-driven.
- §A8 7-out-of-8 escalation gives a clear human-in-the-loop path.

Recommend proceed to Implementation step 2 (push v383-exp log-OTA).
