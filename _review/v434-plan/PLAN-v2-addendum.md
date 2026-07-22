# v434 Plan — Addendum after 4-eye Review (Round 1)

Round 1 reviewer surfaced 5 blockers + several sub-issues. This addendum
patches PLAN.md. Read together.

---

## User-decided rule (from clarification 2026-07-22)

**绿色跟随规则(适用于所有 layer,所有场景)**:

> **绿色跟随"用户视觉在哪 = 当前地图中心所在的 region"。**
> **Tap 国家(仅 World layer)只切列表预览,不改视觉。**
> **只有 Tap 城市(Country layer)才会 fly 地图,才真的改变视觉。**

推论:
- World layer 无论 tap 哪个国家再 ↑ 回 world,list 里绿的**永远**是"地图中心所在国家"
- Country layer tap city → fly → currentCityId 更新为该 city → refetch panel → 该 city 绿
- 面板打开中拖地图不实时更新绿(需关面板再开)

Frontend state 契约(替换 PLAN §4.1):
```
hierarchyOpen: bool
hierarchyTitleId: 'world' | <country id>
hierarchyCurrentCityId: string | null      // updates on: open, city-tap
hierarchyCurrentCountryId: string | null   // updates on: open, city-tap (via city → country lookup); NEVER on country-tap
```

关键:tap country **不** touch currentCountryId。currentCountryId 只被
"open panel" 和 "tap city" 更新。这样 World layer 绿总是"地图中心所在国家"。

---

## Blocker resolutions

### B1: level=3 dependency — RESOLVED (false alarm)

- `grep -rn "level = 3|level===3|admin1|adm1" backend/src/` → 0 hits
- `grep -rn "level = 3|admin1|adm1" app/src/` → 0 hits
- v433 已经把 highlight 相关 admin1 使用清光. Plan §1.3 `DELETE FROM regions WHERE level IN (1,3)` 安全.

### B2: HK/TW/MO + 中国边界城市 in China DataV overlay — RESOLVED

改 PLAN §2.5:
```
Don't wholesale-delete NE CHN cities before DataV overlay.
Do:
  a) For every DataV prefecture polygon, DELETE the NE cities whose
     lat/lng falls inside that polygon.
  b) After all DataV insertions, any remaining NE CHN cities (HK/TW/MO +
     any point in NE but not in any DataV polygon = frontier/coastal)
     keep as-is with their Voronoi cell (recomputed with the reduced
     CHN point set).
Result: DataV prefectures + NE fallback for HK/TW/MO/frontier.
No coverage gap.
```

### B3: Cache key not bumped — RESOLVED

改 `app/src/features/memory/services/hierarchyService.ts`:
- `const DEEPEST_CACHE_VERSION = 'v2';` (NEW; was implicit v1)
- `const PANEL_CACHE_VERSION = 'v3';` (was 'v2')
- Deepest cache key: `hierarchy:deepest:${DEEPEST_CACHE_VERSION}:${lat.toFixed(2)},${lng.toFixed(2)}`
- Panel cache key: `hierarchy:panel:${PANEL_CACHE_VERSION}:${titleId}`
- Old v1/v2 keys naturally expire (24h/60s TTL). No purge migration needed.

### B4: World layer green rule — RESOLVED per user

Answer above. Green tied ONLY to map camera center, never to tap history.
`hierarchyCurrentCountryId` **never** updates on country-tap.

### B5: Voronoi + island nations — RESOLVED

改 PLAN §2.4:
```
Per country, apply one of three strategies based on data availability:

Strategy A (Voronoi + clip): Countries with ≥5 NE cities AND
                              country polygon fully contained in one
                              hemisphere (no dateline crossing).
  Example: China (after HK/TW/MO carve-out), USA, Japan, UK, Germany,
           Malaysia, Thailand, India, Brazil.
  Result: per-city Voronoi cell clipped to country polygon.

Strategy B (Single-city country): Countries with 1-4 NE cities OR
                                   with cities spread across archipelago.
  Example: Fiji, Kiribati, Vatican, Monaco, Singapore.
  Result: each city gets a small buffer polygon (20 km radius, clipped
  to country polygon). Not Voronoi. City coverage is incomplete but
  predictable — user at unmapped island falls back to country-level
  (city=null in /deepest, panel opens with title=country, list=cities,
   no green because no city is "here").

Strategy C (Skip): Countries with 0 NE cities (rare).
  Example: uninhabited claims.
  Result: no cities table row for this country. /deepest returns country
  only. Panel opens with title=country, empty list.

Dateline handling: Fiji + Kiribati + eastern Russia — for Strategy B (they
have <5 cities), no dateline math needed. Strategy A never applies here.
Explicitly document this: v434 does NOT support Voronoi across the dateline.
```

改 PLAN §2.5 (China override with carve-out per B2):
```
For each DataV prefecture polygon:
  DELETE FROM ne_cities WHERE country_id='CHN' AND ST_Contains(datav_polygon, POINT(lng,lat));
Then INSERT DataV rows.
Remaining NE CHN cities (HK/TW/MO/frontier) — recompute their Voronoi
using the reduced CHN NE point set + regions.geom CHN polygon minus
union of all DataV polygons as clipping region.
```

---

## Additional plan updates from Section A-D reviewer findings

### A.3 fresh user detection

Delete PLAN §4.2 step 3 special case. Instead:
- Always call `/panel?title_id=world&here_country_id=<or null>`.
- Server returns `items=[]` + `locked_count=<total_countries>` for a user
  with 0 memory.
- Frontend renders empty banner when `items.length===0 && locked_count>0`.
- Single source of truth: backend `/panel`.

### A.4 就近 fallback

改 PLAN §3.1 `/deepest`:
```
1. Try ST_Contains(cities.voronoi_polygon, POINT) → city + country.
2. If no city match, try ST_Contains(regions.geom, POINT) for country only → country + null city.
3. If no country match (ocean), find nearest city by ST_Distance(POINT, cities.point) LIMIT 1 → that city + its country.
4. If cities table empty (impossibly): return world only.
```

Ordering: exact match > exact country > nearest city (就近). Never
"nearest city" if the point is inside a country — that country dictates.

### C.1 Same-country city tap update semantics — CLARIFY

改 PLAN §6.2:
- On city tap: update `currentCityId=item.id`. **Also update
  `currentCountryId=data.title.id`** (since panel is at country layer,
  title = current country; city belongs to it). This keeps
  currentCountryId in sync when user moves within a country. Then
  refetch panel with new here_city_id.
- Rationale: currentCountryId updates only on "camera-changing tap"
  (i.e. city-tap). Country-tap does NOT change camera, so does not
  update currentCountryId. Preserves rule "green follows map center".

### C.2 World layer memory-to-country attribution

改 PLAN §3.2, algorithm for World layer:
- For each of user's memory_points + markers within some bbox: use
  cities.voronoi_polygon ST_Contains → city → city.country_id → attribute
  point to that country.
- Aggregate distinct country_ids where user has ≥1 point → items list.
- Alternative if too slow: pre-aggregate in a materialized view
  `user_country_stats` (user_id, country_id, has_marker, has_point).
  Refresh on memory-point insert.

For v434, start with real-time ST_Contains query, add materialized view
only if p95 latency > 500ms.

### D.1 hierarchyDrill deletion — enumeration

Places to delete in `MemoryScreen.tsx`:
1. Line ~124: `const [hierarchyDrill, setHierarchyDrill] = useState(false);` — DELETE
2. Line ~854: `drill={hierarchyDrill}` — DELETE
3. Lines 856-863: `if (isHere) { setHierarchyDrill(true); return; }` — DELETE entire block (replaced by "isHere always allowed, treated same as any city tap")
4. Line ~906: `setHierarchyDrill(false);` in city-tap flow — DELETE
5. Lines 910-923: `onGoUp` drill-branch — DELETE, replace with `onGoUp={() => setHierarchyTitleId('world')}`
6. In `HierarchyPanel.tsx`: remove `drill` prop from interface

Line numbers per current v433 file — before editing, run
`grep -n "hierarchyDrill\|drill" app/src/features/memory/**/*.tsx` to
confirm exact positions.

### D.2 onCameraCenter timing

Panel-open reads cameraCenterRef.current once at tap time. Subsequent
map moves do not affect open panel (rule: recompute at open). Race
protection: use `useRef` for a `panelOpenRequestId` counter. Increment
on each Layers tap. Inside the async fetch, capture the current id,
and only apply state changes if `panelOpenRequestId.current === capturedId`.
Aborts stale fetch results if user double-taps.

### D.3 Debounce/abort on double-open

Adds to §4.2 the requestId pattern above.

---

## Playwright test additions

Add Scenario G: World→Country→World visual regression per B4 rule.

### Scenario G — World→Malaysia→World: Malaysia not green

1. User in Shanghai, has memory in CN + KL.
2. Open panel → title=China, Shanghai green.
3. Tap ↑ → title=World, China green.
4. Tap Malaysia row → title=Malaysia, list=[KL walked], **no green**
   (currentCityId=null; map still at Shanghai; KL is not "here").
5. Tap ↑ → title=World, China green **again** (currentCountryId still 'CHN').
6. Screenshot each step. PASS if step 5 shows China (not Malaysia) green.

---

## Migration order fix (B5 in original review)

改 PLAN §1.3, correct order:
```
1. mysqldump regions cities → backup file (BEFORE any DROP/DELETE)
2. CREATE TABLE regions_backup_v433 AS SELECT * FROM regions;
3. DROP TABLE IF EXISTS cities;      -- old, safe to drop
4. DELETE FROM regions WHERE level IN (1,3);
5. UPDATE regions SET parent_id='world' WHERE level=2;
6. CREATE TABLE cities (...);
7. Seed via LOAD DATA LOCAL INFILE.
8. Verify counts, verify 0 orphans.
9. On any failure: TRUNCATE + INSERT SELECT from backup, DROP cities.
```

Original PLAN had "DROP cities BEFORE backup" — fixed.

---

## Final: Version bump

- OTA_VERSION 433 → 434
- PLAN v2 checked into `_review/v434-plan/PLAN.md` (original) + this
  addendum. Do not merge them — the addendum is a review artifact showing
  what was corrected between rounds.

---

# Round-2 review fixes (2026-07-22, third pass)

Second reviewer flagged 3 blockers on top of round-1 addendum. Fixes:

## Fix 1 — Explicit second-pass Voronoi for residual NE CHN cities (B2 gap)

改 pipeline file layout (§2.1) to remove `overlay-datav.js` as a
"delete then insert" step. Replace with a **pre-Voronoi carve-out**:

```
backend/scripts/seed-cities/
  download.js         # NE 10m populated_places + DataV polygons
  compare.js          # user-facing preview
  carve-china.js      # NEW: for every NE CHN city, check if any DataV
                      #      polygon ST_Contains it → drop from NE set
                      #      (leaves HK/TW/MO/Xinjiang/Tibet frontier cities)
  voronoi.js          # runs AFTER carve. Computes Voronoi per country
                      # using cleaned-up NE point set.
                      # For CHN: Voronoi clip region = regions.geom CHN
                      #          MINUS union(all DataV polygons)
                      #          (so residual NE cells don't fight DataV)
  merge-datav.js      # NEW: appends 300 DataV rows to cities-final.json
                      # source='datav'. No Voronoi.
  seed.js             # loads cities-final.json → SQL
  deploy-seed.sh
  cleanup-post-seed.sh
```

Pipeline order:
1. download (NE + DataV)
2. compare (user review gate)
3. **carve-china** (remove NE points contained by any DataV polygon)
4. voronoi (per country, with CHN clip = country − DataV union)
5. **merge-datav** (add DataV as separate cities.source='datav' rows)
6. seed → SQL

Result: no double-provenance ambiguity, HK/TW/MO retained via NE
Voronoi in the "country minus DataV" residual region.

## Fix 2 — Playwright test-user memory pre-seed (N1 blocker)

Add PLAN §7.1:

```
### 7.1 Test user pre-seed

Playwright scenarios B/C/G require a user with memory in CN + KL.

Approach: backend adds a dev-only endpoint (already exists per v406
web-test-hooks pattern):

  POST /api/dev/seed-test-user
  Body: { email: 'v434-qa@test', memory_points: [...], markers: [...] }
  Auth: requires DEV_SECRET env var, returns 404 in prod builds.

Endpoint truncates existing memory for that user and inserts the given
rows. Playwright script calls this before each scenario.

Fixed fixtures for v434 scenarios (file
`scripts/playwright/v434-fixtures.json`):

- user-shanghai: memory_points in Shanghai (31.23, 121.47), Suzhou
  (31.30, 120.62), Beijing (39.90, 116.40). Markers: 1 in Shanghai.
- user-cn-kl: same + memory_points in KL (3.14, 101.69). Markers: 1 in KL.
- user-fresh: no rows.

Playwright script runs against aliyun production DB via the dev endpoint,
but ONLY for the fixed test emails above. Real user data is not touched.

Cleanup: after all scenarios complete, DELETE the 3 test users to prevent
accumulation.
```

## Fix 3 — Deploy without table lock (N3 blocker suggestion → mandatory)

改 PLAN §2.6:

```
Do NOT run `DELETE FROM regions WHERE level IN (1,3)` on the live table.
That's an InnoDB row-lock storm on ~2500 rows, blocks reads.

Use rename-swap:
1. `CREATE TABLE regions_v434 LIKE regions;`
2. `INSERT INTO regions_v434 SELECT * FROM regions WHERE level IN (0, 2);`
3. `CREATE TABLE cities_v434 (schema per §1.2);`
4. `LOAD DATA LOCAL INFILE cities-final.csv INTO cities_v434;`
5. Sanity checks (counts, 0 orphans).
6. Atomic swap:
   ```
   RENAME TABLE regions TO regions_v433_archive,
                regions_v434 TO regions,
                cities_v434 TO cities;
   ```
   RENAME is metadata-only, < 100ms, no read stall.
7. Rollback: `RENAME TABLE regions TO regions_v434_bad,
                          regions_v433_archive TO regions, DROP cities;`
```

`regions_v433_archive` kept for 7 days post-deploy, then DROPPED.

## Fix 4 — Cache key naming consistency (non-blocker but done together)

改 PLAN B3 addendum:
```
const DEEPEST_CACHE_VERSION = 'v3';   // was 'v2' in first addendum
const PANEL_CACHE_VERSION = 'v3';
```
Both cache subsystems bumped to v3 together. No mixed versions.

---

## Round-2 verdict outcome

Third reviewer must confirm all 3 fixes are complete + no new blockers
before implementation begins. If PASS → Challenge subagent (independent
naysayer) runs → then code.

---

# Round-3 review fixes (2026-07-22, fourth pass)

Third reviewer verdict: FAIL. 5 items required. All addressed below.

## Fix 5 — CHN clip region sliver rule (B-new-1 + carve-china seam)

Problem: `country − DataV_union` can produce hair-thin sliver polygons
along DataV/NE coastline seam. NE residual cells try to Voronoi in slivers
→ empty or invalid cells.

Rule (add to §2.4 CHN branch):
```
1. Compute DataV_union_buffered = ST_Buffer(union of all DataV
   polygons, 5000 metres). This absorbs sub-5km slivers into DataV
   ownership. 5km is smaller than any real prefecture but larger than
   dataset seam noise.
2. CHN clip region for residual NE Voronoi:
      country_geom_CHN - DataV_union_buffered
   If turf.difference throws on invalid geometry (turf.js #2058):
      fallback: martinez-polygon-clipping library difference() op.
   If still invalid: last-resort → skip residual NE Voronoi. Residual
   NE points still get inserted as single-city rows with 20km buffer
   (Strategy B treatment applied per-city).
3. Any resulting empty geometry cells are dropped with a warning log.
```

Deps: `npm i martinez-polygon-clipping` (~50 KB, MIT, no native deps).

## Fix 6 — turf.difference invalid geometry fallback (B-new-1)

Covered by Fix 5 step 2. Same 3-tier fallback applies to any Voronoi
clip step (not just CHN).

## Fix 7 — Dev endpoint production triple lock (Fix 2 gap)

改 §7.1 dev endpoint contract:
```
POST /api/dev/seed-test-user

Guard (all THREE must pass, else 404):
  1. process.env.NODE_ENV !== 'production'
  2. process.env.DEV_SECRET set AND request header
     'X-Dev-Secret' matches it (constant-time compare)
  3. body.email matches /^v434-qa@test$/
     (allow-list — extend explicitly per fixture, never wildcard)

Rate limit: 6000/hour/IP (reuse existing express-rate-limit config
from /api/edit-diag).

Audit: on every successful call, INSERT into new table
`dev_endpoint_audit` (id, endpoint_path, request_ip, user_agent, email,
called_at). Reviewable + retention 30 days.
```

Additionally: DEV_SECRET must be a >=32 char random string, never
committed. Set at container start time (aliyun docker env var).
Rotate quarterly.

## Fix 8 — Dev endpoint cleanup cascade (Fix 2 gap)

Cleanup after all Playwright scenarios:
```
DELETE FROM markers WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@test');
DELETE FROM memory_points WHERE user_id IN (...);
DELETE FROM debug_snapshots WHERE user_id IN (...);
DELETE FROM telemetry_sessions WHERE user_id IN (...);
DELETE FROM debug_events_v2 WHERE user_id IN (...);
DELETE FROM users WHERE email LIKE '%@test';
```

Explicit order (child tables first, users last) avoids FK constraint
violations. Do not rely on ON DELETE CASCADE (schema audit shows
inconsistent CASCADE across tables — some are RESTRICT).

Add cleanup script `backend/scripts/dev/cleanup-test-users.sh`,
callable via same `/api/dev/*` guard.

## Fix 9 — Rate limit + audit already covered in Fix 7

Combined.

---

## Round-3 verdict

All 5 required items addressed with concrete rules. Ready for Challenge
subagent (independent naysayer, no rubber stamp allowed).

---

# Challenge round fixes (2026-07-22, final pass)

Challenge subagent surfaced 6 real user-visible / data-destroying blockers.
All resolved below. **This is the final round — no more reviews. Code next.**

## Fix 10 — Panel-open three-tier fallback for null camera (U1)

`fetchDeepestRegion` MUST NOT be called with null lat/lng. MemoryScreen
line ~730 area:
```
// PLAN §4.2 step 1 mandatory implementation:
const anchor =
  cameraCenterRef.current      // 1st: most recent map center
  ?? persistentCoord           // 2nd: user's GPS if map hasn't emitted yet
  ?? { lat: 0, lng: 0 };       // 3rd: world default (fetchDeepest will
                                //      return world region)
const { city, country } = await fetchDeepestRegion(anchor.lat, anchor.lng);
```

If anchor is `(0,0)`, backend `/deepest` returns `world` region → panel
opens with `title='world'`, empty banner. No crash.

## Fix 11 — TWN / HKG / MAC handling (U3)

Before seed runs, `compare.js` MUST include this section in
`report.md`:
```
### Political boundary regions

Present in regions table:
  - <list from `SELECT id FROM regions WHERE id IN ('TWN','HKG','MAC','CHN')`>

Cities that need a country_id but the country row is missing:
  - <list any orphaned NE city with country_id not in regions>

User decision required:
  - How to handle TWN cities: (a) create regions row id='TWN' name='Taiwan'
    parent_id='world'; (b) attach to CHN; (c) drop.
  - Same for HKG, MAC.

Seed will not proceed until user marks each decision in
_review/v434-plan/political-decisions.json.
```

Default recommendation (documented, awaits user override): create separate
`TWN`, `HKG`, `MAC` regions rows all with `parent_id='world'`, since NE
dataset already treats them as ADM0 entities. This is the most neutral
representation. User can override.

## Fix 12 — Panel-open race with requestId ref (U4)

Concrete implementation:
```
// MemoryScreen.tsx (near hierarchyOpen state)
const panelOpenRequestIdRef = useRef(0);

// Layers icon onPress:
onPress={async () => {
  if (hierarchyOpen) { setHierarchyOpen(false); return; }
  const myId = ++panelOpenRequestIdRef.current;
  const anchor = cameraCenterRef.current ?? persistentCoord ?? {lat:0, lng:0};
  const { city, country } = await fetchDeepestRegion(anchor.lat, anchor.lng);
  // Race guard: if user tapped again meanwhile, drop this stale response
  if (panelOpenRequestIdRef.current !== myId) return;
  setHierarchyTitleId(country?.id ?? 'world');
  setHierarchyCurrentCityId(city?.id ?? null);
  setHierarchyCurrentCountryId(country?.id ?? null);
  setHierarchyOpen(true);
}}
```

Same pattern for city-tap refetch panel.

## Fix 13 — Delete PLAN §1.3 obsolete CTAS backup (D1)

改 PLAN §1.3: strike out the `CREATE TABLE regions_backup_v433 AS SELECT ...`
line. The rename-swap in Fix 3 handles backup via `regions_v433_archive`.
Two backup strategies = one implementer runs both = corruption risk.

Consolidated Part 1.3:
```
Migration order (single authoritative version):
1. Build regions_v434 + cities_v434 in parallel (Fix 3 rename-swap steps 1-5).
2. RENAME atomic swap.
3. Keep regions_v433_archive for 7 days, then DROP.
```

No CTAS backup. Rely solely on the rename-swap archive.

## Fix 14 — Cleanup email allow-list (D2)

改 Fix 8 cleanup SQL:
```
-- OLD (dangerous): DELETE ... WHERE email LIKE '%@test'
-- NEW (safe):
DELETE FROM markers WHERE user_id IN (SELECT id FROM users WHERE email IN ('v434-qa@test'));
DELETE FROM memory_points WHERE user_id IN (SELECT id FROM users WHERE email IN ('v434-qa@test'));
DELETE FROM debug_snapshots WHERE user_id IN (SELECT id FROM users WHERE email IN ('v434-qa@test'));
DELETE FROM telemetry_sessions WHERE user_id IN (SELECT id FROM users WHERE email IN ('v434-qa@test'));
DELETE FROM debug_events_v2 WHERE user_id IN (SELECT id FROM users WHERE email IN ('v434-qa@test'));
DELETE FROM users WHERE email IN ('v434-qa@test');
```

Explicit allow-list. If more test emails are added later, they must be
listed here explicitly. No LIKE, no wildcards.

Also改 Fix 7 dev endpoint guard: default-deny.
```
// backend /api/dev/seed-test-user handler entry:
if (process.env.NODE_ENV === 'production' || !process.env.DEV_SECRET) {
  return res.status(404).end();
}
```

Explicit `=== 'production'` check + secret required. If NODE_ENV is unset
(container misconfig), it does NOT default to accepting requests.

## Fix 15 — Rollback runbook (Challenge Section 3)

Add PLAN §9:
```
## §9 Rollback runbook

If v434 seed or backend deploy fails after RENAME swap:

### T+0 (detect): Client crash or /panel 500s

### T+30s (server rollback):
ssh root@122.51.174.118
docker exec -i ainews-db mysql -uroot -p'Mzm920313@950824' cairn <<'SQL'
RENAME TABLE regions TO regions_v434_bad,
             regions_v433_archive TO regions;
DROP TABLE cities;
SQL

### T+60s (backend restart):
scp app/backend/src/routes/hierarchy.js.v433 root@122.51.174.118:/tmp/
ssh root@122.51.174.118 "docker cp /tmp/hierarchy.js.v433 cairn-backend:/app/src/routes/hierarchy.js && docker restart cairn-backend"

### T+90s (client OTA rollback):
cd app && npx eas update --branch production --message "v434 rollback → v433"
(client will pick up OTA within 60s of app foreground)

### Total time to rollback: ~90 seconds

### Staging dry-run (mandatory before production deploy):
Run all above on aliyun-staging DB first, verify /deepest + /panel return
v433 shape after rollback.
```

## Fix 16 — Scenario G-mirror (Playwright)

Add:
```
### Scenario G-mirror — User in KL, verify Malaysia stays "here" across country-tap

1. Seed user-cn-kl (CN + KL memory). Center map on KL (3.14, 101.69).
2. Open panel → title=Malaysia, KL green (currentCountryId='MYS').
3. Tap ↑ → title=World, Malaysia green in list.
4. Tap "China" row → title=China, list=Chinese cities (no green,
   because currentCountryId still 'MYS' and no city in China is here).
5. Tap ↑ → title=World, **Malaysia** green again (not China).
6. PASS if step 5 shows Malaysia green.
```

This is the mirror of scenario G. Confirms `currentCountryId` correctly
follows map center, not tap history.

---

# Final PASS-gate

After Fixes 10-16, plan is ready to implement. **No more review rounds.**
Any new blocker discovered during implementation gets fixed immediately,
not routed through another review.

Implementation order:
1. Backend hierarchy.js rewrite
2. Frontend HierarchyPanel + MemoryScreen state
3. Seed pipeline scripts (download → compare → carve → voronoi → merge → seed)
4. Migration on aliyun staging → dry-run → aliyun production rename-swap
5. Playwright web QA all 7 scenarios (A-G + G-mirror)
6. If all PASS: bump OTA_VERSION 433→434, commit, git push, eas update
7. Real-device verification post-OTA
