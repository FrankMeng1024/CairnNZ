# v434 Memory Hierarchy — 2-Layer World→Country→City Plan

**Status**: locked design (2026-07-22). No drill concept. No highlight. No hardcoded region IDs.
**Model**: World → Country → City. Title is always `World` or one Country. List is always one level deeper than title.
**Prior failure count**: 4. This plan replaces v427-v433 hierarchy entirely.

---

## Part 1 — DB Schema

### 1.1 `regions` (keep, prune)

Purpose: still hosts `world` (level 0) and countries (level 2). Continents (level 1) and admin1 (level 3) get **dropped**.

Actions on the existing `regions` table:
- **Keep columns**: `id, parent_id, name_en, level, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, geom` (geom kept only for countries — needed to clip city Voronoi cells and to answer "country contains this point" as a fallback).
- **Delete rows** where `level = 1` (continents) and `level = 3` (admin1 / provinces). Set every country row's `parent_id = 'world'`.
- No column drops; only row deletes. Existing indexes stay.
- After prune the table has 1 world row + ~250 country rows. Level enum semantics become `0 = world, 2 = country` only.

Why keep the same table: `/api/hierarchy/deepest` fallback still works, migrations are reversible, and code paths in other services that read `regions` (fogFloorGeometry, unlockEngine) don't need to change if they only care about country-level bboxes.

### 1.2 `cities` (new table)

```
CREATE TABLE cities (
  id                  VARCHAR(24) PRIMARY KEY,          -- e.g. 'ne-shanghai-cn' or 'datav-330100'
  country_id          VARCHAR(8) NOT NULL,              -- FK regions.id where level=2
  name_en             VARCHAR(120) NOT NULL,
  name_local          VARCHAR(120) NULL,
  lat                 DOUBLE NOT NULL,
  lng                 DOUBLE NOT NULL,
  is_capital          TINYINT(1) NOT NULL DEFAULT 0,
  source              ENUM('ne','datav') NOT NULL,
  bbox_min_lng        DOUBLE NOT NULL,
  bbox_min_lat        DOUBLE NOT NULL,
  bbox_max_lng        DOUBLE NOT NULL,
  bbox_max_lat        DOUBLE NOT NULL,
  voronoi_polygon     GEOMETRY NOT NULL SRID 4326,      -- clipped, "influence area"
  INDEX idx_country (country_id),
  SPATIAL INDEX idx_voronoi (voronoi_polygon)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- `voronoi_polygon` MUST be SRID 4326, axis-order long-lat, closed rings. Empty geometries rejected at seed time.
- `bbox_*` denormalized from `voronoi_polygon` at seed time — spatial index is fast for ST_Contains but bbox filter still speeds up count aggregation in the `/panel` endpoint.
- `source` distinguishes Natural Earth (default worldwide) from DataV (China override). No mixed provenance per city.

### 1.3 Migration SQL (order matters)

```
-- 1. Backup
CREATE TABLE regions_backup_v433 AS SELECT * FROM regions;
CREATE TABLE cities_backup_v433 AS SELECT * FROM cities;  -- if exists

-- 2. Drop old table if a stale one exists
DROP TABLE IF EXISTS cities;

-- 3. Prune regions
DELETE FROM regions WHERE level IN (1, 3);
UPDATE regions SET parent_id = 'world' WHERE level = 2 AND parent_id != 'world';

-- 4. Create cities table (schema above)

-- 5. Seed cities (see Part 2)

-- 6. Sanity
SELECT COUNT(*) FROM regions WHERE level = 2;   -- expect ~250 countries
SELECT COUNT(*) FROM cities;                     -- expect ~7300 (NE) + ~300 datav override
SELECT COUNT(*) FROM cities WHERE country_id NOT IN (SELECT id FROM regions);  -- MUST be 0
```

**Rollback**: `TRUNCATE regions; INSERT INTO regions SELECT * FROM regions_backup_v433; DROP TABLE cities;` — reversible in one transaction if kept in a single migration file.

---

## Part 2 — Data Seed Pipeline

Follows user's data-input rule (memory: `feedback_data_compare_before_seed`): **download → compare → user reviews → seed → cleanup**. No one-shot pipe-to-DB.

### 2.1 File layout

```
backend/scripts/seed-cities/
  download.js         # NE 10m populated_places + Admin 0 countries
  download-datav.js   # DataV cities (city-level, ~300 Chinese prefectures)
  compare.js          # produces cities-preview.json + report.md
  voronoi.js          # NE cities → bounded Voronoi per country
  overlay-datav.js    # replaces China cities in Voronoi output with DataV polygons
  seed.js             # reads final cities-final.json, writes SQL
  deploy-seed.sh      # aliyun MySQL apply (backup → dry-run → apply → verify)
  cleanup-post-seed.sh
```

### 2.2 Download step

- Natural Earth 10m populated_places: https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-populated-places/  → `ne_10m_populated_places.geojson` (~7342 features). Fields used: `NAME_EN`, `NAME`, `LATITUDE`, `LONGITUDE`, `ADM0_A3` (ISO3 country → maps to `regions.id`), `FEATURECLA` (filter to include only 'Admin-1 capital', 'Admin-0 capital', 'Populated place').
- DataV.阿里云 China cities: https://datav.aliyun.com/portal/school/atlas/area_selector — 城市级 (level 2 in DataV convention), ~300 prefectures. Each feature has `adcode` (6-digit), `name` (Chinese), `centroid`, `polygon`. Chinese source of truth for China only.
- NE countries admin_0 already lives in `regions.geom` (from v427); reused for Voronoi clipping. **No new download for country polygons.**

### 2.3 Compare step (user gate — mandatory)

`compare.js` produces `_review/v434-plan/cities-preview.json` + `report.md`. Fields:
- Per country: NE city count vs DataV city count vs population-weighted expected count.
- Duplicate detection: cities within 20 km of each other in the same country get flagged.
- Name sanity: NE `NAME_EN` fallback (some rows have empty EN — fall back to `NAME` transliterated).
- Chinese preview: list all 300 DataV cities so user can eyeball name_en (pinyin-based) before commit.
- **User must respond OK before seed.js runs.** Compare output is checked into `_review/v434-plan/` so 4-eye reviewer can inspect.

### 2.4 Voronoi computation

Approach: `turf.voronoi` per country (feature collection = all NE points whose ADM0_A3 matches that country), bounding box = country's own bbox +5% padding, then `turf.intersect(voronoi_cell, country_polygon)` to clip to actual coast/border.

- Countries with only 1 NE city: no Voronoi possible. Fallback = use country's own polygon as that city's voronoi_polygon (whole-country match).
- Countries with 0 NE cities (rare, tiny states like Vatican): skip cities table, `/deepest` returns country only.
- Numerical caveat: turf uses JSTS internally. Islands and multipolygon countries produce MultiPolygon output — cities table `voronoi_polygon` MUST accept MULTIPOLYGON. Column type declared `GEOMETRY` (permissive) not `POLYGON`.

### 2.5 China override — **SUPERSEDED BY ADDENDUM B2 (2026-07-22 review v2)**

**⚠️ DO NOT IMPLEMENT THIS SECTION AS WRITTEN. See `PLAN-v2-addendum.md §B2`.**

Original (obsolete) approach:
> After Voronoi runs for all countries: `overlay-datav.js` loads the 300 DataV prefecture polygons, DELETES all `cities` rows where `country_id = 'CHN'`, INSERTS the 300 DataV rows using the DataV polygon directly as `voronoi_polygon` (no clipping — DataV polygons are already province-clipped by design).

**Problem**: `DELETE all CHN` wipes HK / TW / MO / frontier cities (DataV does not include them). See addendum for the "carve-out per polygon + second-pass Voronoi for residual NE points" corrected approach.

### 2.6 Deploy

`deploy-seed.sh`:
1. `mysqldump regions cities` → `_review/v434-plan/backup-YYYY-MM-DD.sql` on aliyun host.
2. Run migration SQL from Part 1.3 in a transaction.
3. `LOAD DATA LOCAL INFILE cities-final.csv INTO TABLE cities` (chunks of 1000).
4. Verify counts + zero orphans (query in Part 1.3 step 6).
5. On failure: `ROLLBACK` and print backup path.

Post-seed: `cleanup-post-seed.sh` removes CSV + geojson intermediates from server (keep local `_review/v434-plan/` copies for audit).

---

## Part 3 — Backend API

### 3.1 `/api/hierarchy/deepest?lat=&lng=` (rewrite)

- Query strategy: **first** try `SELECT id, country_id, name_en, bbox_* FROM cities WHERE ST_Contains(voronoi_polygon, POINT(?,?)) LIMIT 1` (spatial index accelerated).
- If a city matches → return `{ city: {id, name_en, country_id, bbox}, country: {id, name_en, bbox} }` (join fetches country).
- If no city matches (open ocean, Antarctica, missing coverage) → fall back to `regions` ST_Contains at level=2 for country. If still nothing → return `{ city: null, country: null, world: {id:'world', ...} }`.
- Response shape change: response now returns city + country + world explicitly. `/deepest` no longer returns just one "region" — the client always gets the three-level context in one call. This eliminates the second round-trip that v427 needed.

### 3.2 `/api/hierarchy/panel?title_id=` (rewrite, breaking)

- **Input**: `title_id` = `'world'` OR a country id (e.g. `'CHN'`). No `region_id`, no `drill`.
- **Behavior**:
  - `title_id = 'world'`: items = every country where the user has ≥1 `memory_points` or `markers` row (i.e. "countries you've been in"). state = `marked` if any marker in country bbox else `walked`. Include one synthetic row `{name: 'N more locked', state: 'locked'}` at end representing all countries the user has NOT visited (count = total countries - visited count). No parent (world has no parent).
  - `title_id = <country id>`: items = every city whose `country_id = title_id` AND user has ≥1 point/marker inside its bbox → `marked`/`walked`. Plus one locked-summary row for the rest. Parent = `{id: 'world', name_en: 'World', level: 0}`.
- **Output contract** (fixed shape both layers):
  ```
  {
    title:  { id, name_en, level },       // level 0 or 2
    parent: { id, name_en, level } | null, // null when title=world
    items: [
      { id, name_en, state: 'marked'|'walked', bbox, is_here }
    ],
    locked_count: N
  }
  ```
  Items array contains ONLY marked/walked rows. Locked collapsed into `locked_count`. Frontend renders the summary row from `locked_count` alone.
- `is_here` calculation: server needs `here_city_id` OR `here_country_id` from client. Add `&here_city_id=` and `&here_country_id=` query params. Server sets `item.is_here = (item.id === here_city_id)` when `title_id` is a country, and `(item.id === here_country_id)` when `title_id = 'world'`. **Only one row may have `is_here=true`** — server enforces uniqueness (Part 8 review point).
- Count aggregation: reuse the nearest-bbox-center heuristic from v427 (already proven fast). Point-in-city is answered exactly by `ST_Contains(voronoi_polygon, POINT)` when needed for the "is_here" tiebreak.

### 3.3 Endpoints deleted

- `GET /api/hierarchy/polygon/:region_id` — already removed in v433, confirm still gone in the router.
- `?drill=1` query param — deleted; server 400s if present (helps catch stale clients).

### 3.4 File: `backend/src/routes/hierarchy.js`

Replace the entire file. No incremental patch. Old file has continent/admin1 code paths, drill logic, three-way state resolution — all of it moot. Length target ~180 lines vs current 353.

---

## Part 4 — Frontend State (MemoryScreen)

### 4.1 State variable changes

Replace these three (currently at MemoryScreen.tsx:119-124):
```
hierarchyOpen: bool
hierarchyRegionId: string | null   // DELETE
hierarchyDrill: bool                // DELETE
```
With:
```
hierarchyOpen: bool
hierarchyTitleId: 'world' | string | null      // country id or 'world'; null when closed
hierarchyCurrentCityId: string | null           // city under map center, computed on OPEN only
hierarchyCurrentCountryId: string | null        // country under map center, same
```

### 4.2 Panel-open flow (lines ~716-741 area)

On Layers icon tap:
1. Read map camera center (already tracked in `cameraCenter` ref at line 127).
2. `const { city, country } = await fetchDeepest(lat, lng)`.
3. If user has zero memory points anywhere (query `/api/memory/count` OR use existing store selector): set `hierarchyTitleId = 'world'`, `hierarchyCurrentCityId = null`, `hierarchyCurrentCountryId = null`. Panel will render empty items + encouragement banner.
4. Else if `city` present: `hierarchyTitleId = country.id`, `hierarchyCurrentCityId = city.id`, `hierarchyCurrentCountryId = country.id`.
5. Else (no city match — open ocean): `hierarchyTitleId = 'world'`, both current ids null.
6. `setHierarchyOpen(true)`.

**No dependency on previous panel state** (user rule): every open recomputes from map center.

### 4.3 No drill state anywhere

Search-and-delete every `hierarchyDrill` reference in MemoryScreen. Replace `HierarchyPanel drill={...}` prop with nothing (prop removed in Part 5).

---

## Part 5 — Frontend HierarchyPanel Component

### 5.1 New props

```
interface Props {
  titleId: 'world' | string;             // required, non-null when panel open
  currentCityId: string | null;          // used for is_here on country layer
  currentCountryId: string | null;       // used for is_here on world layer
  onSelectItem: (itemId: string, itemType: 'city' | 'country', bbox: [4]) => void;
  onGoUp: () => void;                    // parent decides new titleId
  onClose: () => void;
}
```

### 5.2 Internal logic

- One `useEffect` on `[titleId]`: calls `fetchPanelData(titleId, currentCityId, currentCountryId)` → sets `data`.
- Render `data.title.name_en` in header. Show ↑ button only if `data.parent !== null`.
- Render `data.items` linearly. Each row: dot + name, **no right-side count number** (user rule "所有行无右边数字"). Dot style by `item.state`: `marked` = solid sepia, `walked` = hollow sepia. `is_here` overrides both dot styles → green solid.
- After items, if `data.locked_count > 0`: single row `+ {locked_count} more locked` in grey italic (existing lockedSummary style from v433 — reuse).
- Bottom legend: 2 entries only, Marked (solid) and Walked (hollow). Delete the "here" legend if present.
- Empty state: `data.items.length === 0 && data.locked_count === 0` AND `titleId === 'world'` → render existing emptyBanner ("Head out and start walking to unlock places.").

### 5.3 Row tap dispatch

```
onPress={() => {
  const itemType: 'city' | 'country' = data.title.level === 0 ? 'country' : 'city';
  onSelectItem(item.id, itemType, item.bbox);
}}
```
Parent (MemoryScreen) decides: country layer → fly to bbox + keep panel open + refetch panel with same titleId (updated currentCityId if bbox contains a city center). World layer → do NOT fly (user rule); just `setHierarchyTitleId(item.id)`.

### 5.4 ↑ dispatch

Parent handles both cases: at country layer → `setHierarchyTitleId('world')` (do NOT fly). At world layer → panel should never expose ↑ (data.parent === null); if pressed anyway (defensive), noop.

---

## Part 6 — Interaction Contract (per action)

Every row: **user action → visible state → API call → frontend state change**.

### 6.1 Open panel — user in Shanghai, has memory
- User: tap Layers icon.
- MemoryScreen: `fetchDeepest(31.23, 121.47)` → `{ city: 'datav-310000', country: 'CHN' }`.
- State: `titleId='CHN'`, `currentCityId='datav-310000'`, `hierarchyOpen=true`.
- Panel fetches `/panel?title_id=CHN&here_city_id=datav-310000`.
- Visible: title "China", ↑ button, list of visited cities in China (Shanghai row green, others sepia by state), "+ N more locked".

### 6.2 Country title, tap another city (e.g. Suzhou)
- User: tap Suzhou row.
- MemoryScreen: `mapboxAdapter.flyTo(bbox_suzhou)`. Panel stays open. Update `currentCityId='datav-320500'`.
- Panel re-fetches `/panel?title_id=CHN&here_city_id=datav-320500`.
- Visible: same title "China", Suzhou row green now, Shanghai row reverts to sepia. Map has flown.

### 6.3 Country title, tap ↑
- User: tap ↑.
- MemoryScreen: `setHierarchyTitleId('world')`. Do NOT fly (map camera unchanged). `currentCityId` untouched (irrelevant at world layer). `currentCountryId` remains 'CHN' — used for is_here.
- Panel fetches `/panel?title_id=world&here_country_id=CHN`.
- Visible: title "World", NO ↑ button, list of visited countries with China green, "+ N more locked".

### 6.4 World title, tap country (e.g. Malaysia)
- User: tap Malaysia row.
- MemoryScreen: `setHierarchyTitleId('MYS')`. Do NOT fly (user rule "不 fly"). `currentCityId` = null (map center is still Shanghai, no city in Malaysia is "here"). `currentCountryId` remains 'CHN' (not updated — user did not move map).
- Panel fetches `/panel?title_id=MYS&here_city_id=null&here_country_id=CHN`. Server sees title_id is a country and title_id !== currentCountryId → `is_here=false` on all rows (nothing green).
- Visible: title "Malaysia", ↑ button, list of Malaysian cities user has visited (may be empty → "+ N more locked" only, or the empty banner if user has no memory in Malaysia).

### 6.5 World title, tap ↑
- Impossible. Panel never renders ↑ at world layer (data.parent === null). If it somehow triggers: noop with a log warning.

### 6.6 Map fly after row tap — is green auto-updated?
- **No**. Green only recomputes on panel-open OR on same-country city tap (6.2). If user drags map while panel is open, green stays on the previously-tapped city. Explicit user rule ("每次开面板从地图中心重新计算" — recompute at open, not continuously). Closing and reopening resyncs.

### 6.7 Locked summary row
- Rendered from `locked_count` alone. Non-tappable. Grey italic, existing `lockedSummary` style.

---

## Part 7 — Playwright Web QA Plan (pre-OTA gate)

**Rule** (user memory `feedback_web_playwright_before_iphone`): web Playwright must pass ALL scenarios before any iPhone build or OTA. `mapboxAdapter.web.tsx` bridges; DB = aliyun production. 3-4 screenshots per scenario, saved to `docs/qa/sprint-v434-evidence/`.

### Scenario A — Fresh user, 0 memory
1. Log in as a brand-new test user (0 points, 0 markers).
2. Tap Layers icon.
3. Expected: title = "World", empty banner "Head out and start walking to unlock places.", no items, no green, no ↑.
4. Screenshots: `A-01-map-before.png`, `A-02-panel-open.png`.
5. PASS if banner visible AND items array empty AND locked_count === total countries.

### Scenario B — User in Shanghai, only Chinese memory
1. Log in as user with points in Shanghai + Beijing + Suzhou.
2. Center map on Shanghai (`31.23, 121.47`), zoom 10.
3. Tap Layers icon.
4. Expected: title = "China", items = Shanghai (green), Beijing (sepia), Suzhou (sepia), "+ 296 more locked", ↑ visible.
5. Screenshots: `B-01-map-shanghai.png`, `B-02-panel-china.png`, `B-03-close-up.png`.
6. PASS if Shanghai row has green dot, is_here=true only on Shanghai, ↑ button present.

### Scenario C — Country layer, tap another city
1. Continue from B.
2. Tap "Suzhou" row.
3. Expected: map flies to Suzhou bbox, panel stays open, Suzhou row becomes green, Shanghai row reverts to sepia solid.
4. Screenshots: `C-01-before-tap.png`, `C-02-after-fly.png`, `C-03-panel-updated.png`.
5. PASS if 3 conditions met AND title unchanged ("China") AND only Suzhou is green.

### Scenario D — Country layer, tap ↑
1. Continue from C.
2. Tap ↑ button.
3. Expected: title changes to "World", ↑ hidden, list becomes visited countries with China green, map camera unchanged (still on Suzhou coords).
4. Screenshots: `D-01-before-up.png`, `D-02-after-up.png`.
5. PASS if title="World", China row green, no ↑, camera unchanged.

### Scenario E — World layer, tap another country
1. Continue from D.
2. Tap "Malaysia" row (or any country user has NOT visited if MYS not in list — pick "USA" if user has US memory too, or use a seeded test user with MYS memory).
3. Expected: title changes to "Malaysia", list changes to Malaysian cities (or empty banner if 0 memory in MYS), map camera unchanged, no green anywhere.
4. Screenshots: `E-01-tap-mys.png`, `E-02-panel-mys.png`, `E-03-map-unchanged.png`.
5. PASS if title="Malaysia", camera unchanged, is_here=false on all rows.

### Scenario F — Close panel, drag map, reopen
1. Continue from E.
2. Close panel (tap backdrop).
3. Drag map to KL (`3.14, 101.69`).
4. Tap Layers icon.
5. Expected: title="Malaysia", KL row green (if in memory) or nearest MYS city green, ↑ present.
6. Screenshots: `F-01-map-kl.png`, `F-02-panel-mys-kl.png`.
7. PASS if title recomputed to Malaysia AND KL (or nearest) green.

### Test harness
- Reuse existing `web-test-hooks` machinery (v406 hooks — user memory `project_v406_web_test_hook`). Login endpoint pre-seeds the test user with fixed points.
- Playwright script under `scripts/playwright/v434-hierarchy-qa.js`.
- Each screenshot saved to `docs/qa/sprint-v434-evidence/<scenario>-<step>.png` (Screenshot path enforcement rule from CLAUDE.md).
- Main agent Reads each screenshot, passes to QA subagent (per Playwright + subagent collaboration model). QA subagent judges PASS/FAIL per scenario.

---

## Part 8 — 4-eye Review Focus Points (next reviewer MUST challenge)

1. **Orphaned Voronoi cells**: after Voronoi + China DataV overlay, any city with `country_id NULL` or `country_id NOT IN regions`? SQL check must run inside `deploy-seed.sh` and hard-fail if count > 0. Also: any country with zero cities (small island states)? — plan says fall back gracefully but seed script needs to log and confirm every skipped country.

2. **Voronoi vs DataV overlap gap on China borders**: DataV prefectures for Xinjiang/Tibet may not exactly match NE country polygon for CHN. If a lat/lng lies in the seam, `ST_Contains(voronoi_polygon, point)` fails for both. Mitigation: for cities.source='datav', use DataV polygon UNION with a 5 km buffer OR always fall back to country-level match. Reviewer must verify seam behavior on Kashgar/Lhasa border test points.

3. **User drags map across country border while panel open**: current spec says green does NOT auto-update (Part 6.6). Is that acceptable? Reviewer must confirm this is genuinely what user wants, or if a debounced re-fetch is needed after camera idle. Currently spec = static-until-close. Documented behavior; must not silently change.

4. **`is_here` uniqueness**: server MUST enforce that at most one item has `is_here=true`. Two Voronoi cells may not overlap (mathematical guarantee) BUT if China DataV overlay creates a gap where a point is in NO DataV polygon but IS in an NE polygon that was overwritten — server could match zero cities. Reviewer must run: pick 20 random points in China, verify each returns exactly one city (or fall back to "nearest city center" tiebreak).

5. **Migration reversibility**: the backup step (Part 1.3) drops `cities` table via `DROP TABLE IF EXISTS cities` BEFORE creating `cities_backup_v433`. Order bug — must swap. Rollback must be tested on staging DB before production runs. Reviewer: verify `deploy-seed.sh` does dump BEFORE any DROP/DELETE.

---

## Version bump

- `app.json` OTA_VERSION: 433 → 434
- Backend: `hierarchy.js` header comment "v434 Memory hierarchy (World→Country→City, 2-layer)"
- `_review/v434-plan/PLAN.md` (this file) checked in with commit `v434: 2-layer hierarchy plan`
