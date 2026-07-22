# v428 Plan v2 — Post-review Revision

**Date**: 2026-07-22
**Author**: main agent
**Status**: Draft v2 — awaiting second-round independent review by subagent A + B

## Changes from v1

Reviewer A + B unanimous verdict: `PASS_WITH_CHANGES`. This v2 addresses every critical blocker and high-priority concern raised. Below each section, in-line footnotes cite which reviewer raised the issue (A/B/both).

---

## 1. Scope — no changes from v1

Still 3 changes: (A) global city highlight, (B) hierarchy 4-bug fix, (C) sim-walker debug gate.

---

## 2. Data model (revised) `[A#1 blocker resolved, A#2 blocker resolved]`

### 2.1 `regions` table schema (v428)

```sql
ALTER TABLE regions
  ADD COLUMN geom GEOMETRY NOT NULL SRID 4326 DEFAULT (ST_GeomFromText('POLYGON EMPTY', 4326)),
  ADD SPATIAL INDEX idx_geom (geom);
```

**Only one polygon column: `geom GEOMETRY SRID 4326`.**

- Storage: MySQL native geometry (~10-15% smaller than GeoJSON JSON text).
- Query: `ST_Contains(geom, ST_SRID(ST_GeomFromText('POINT(lng lat)'), 4326))` — spatial index accelerated
- Output: `ST_AsGeoJSON(geom)` on the fly (< 5ms per polygon per aliyun spike)
- No LONGTEXT column. Eliminates drift risk.

### 2.2 Antimeridian handling `[A concern]`

geoBoundaries CGAZ for Russia / Fiji / NZ Chatham Islands crosses ±180°. Seed script must detect features where `bbox.minLng > bbox.maxLng` (or geometry has coordinates in both `[-180,-170]` and `[170,180]` ranges) and:
- **Split the polygon at the antimeridian into two MultiPolygon parts**
- OR set `geom` to a MultiPolygon with west and east halves

Test: Russia deepest lookup with GPS `(60, 179)` and `(60, -179)` must both return "Russia".

---

## 3. Attribution algorithm — unified `[A#3 blocker resolved]`

**Both `/deepest` and `/panel` use the SAME algorithm.**

### 3.1 `/deepest` (used for "you are here")

```
1. bbox pre-filter: SELECT candidate regions where lat/lng within bbox (uses idx on bbox columns; fast)
2. For each candidate, run ST_Contains(geom, point) — polygon precision
3. If multiple hits at same max level (rare, e.g. exclave), pick smallest area
4. Return deepest polygon-hit region + full ancestor chain
```

### 3.2 `/panel` sibling counting (memory_points + markers)

**Old algorithm** (nearest-center among overlapping bboxes) is **removed**.

**New algorithm** (single-pass):

```
For each memory_point / marker (batch by user):
  Run ST_Contains against all sibling geoms
  Assign point to the sibling whose polygon contains it
  If multiple hits (should not happen with clean geoBoundaries), pick smallest area
```

SQL:
```sql
SELECT s.id AS sibling_id, COUNT(p.id) AS point_count
FROM regions s
LEFT JOIN memory_points p ON
  s.parent_id = ? AND
  ST_Contains(s.geom, ST_SRID(ST_GeomFromText(CONCAT('POINT(', p.lng, ' ', p.lat, ')')), 4326))
WHERE p.user_id = ?
GROUP BY s.id;
```

**Consequence**: no more Shanghai-Jiangsu enclave heuristic. Exact polygon match.

### 3.3 Fallback for regions without geom (Continent, World)

Continents (Asia/Europe/...) have no polygon in geoBoundaries. Solution:
- **Seed continents by unioning ADM0 country polygons at seed time**: `ST_Union` all countries where `continent = 'Asia'` → stored as continent's `geom`.
- Alternative if `ST_Union` slow: precompute at seed script via turf.js and insert.

World level (`geom = whole earth`) uses the polygon `POLYGON((-180 -90, 180 -90, 180 90, -180 90, -180 -90))`.

---

## 4. Levels & data source (revised) `[both spike + user decision]`

| Level | 名称 | 数据源 | Row 估计 | Polygon 来源 |
|---|---|---|---|---|
| 0 | World | 硬编码 | 1 | 硬编码 |
| 1 | Continent | 硬编码 (7) | 7 | ST_Union of member countries |
| 2 | Country | geoBoundaries ADM0 simplified | ~200 | 直接 |
| 3 | **City / State / Region** (最低) | **geoBoundaries ADM1 simplified** | ~4000 | 直接 |

**ADM2 not included** — per user decision "最低=城市, 不支持区就城市为底".

---

## 5. Naming convention `[both]`

### 5.1 Rules

1. **CN ADM1** (34 entries) — hardcoded lookup table, e.g. `Shanghaishi → Shanghai`. See Appendix A.
2. **Other countries' ADM1** — suffix strip regex:
   - Remove trailing ` Region`, ` State`, ` Province`, ` Territory`, ` Prefecture`, ` District` (case-sensitive, at end only)
   - Exception override table (see Appendix B) for cases where stripping breaks semantics (e.g., "Wellington City" should stay "Wellington City" to disambiguate from ADM1 "Wellington Region")
3. **ADM0 country names** — geoBoundaries `shapeName` mostly OK, edge cases:
   - "United States of America" → "United States" (override)
   - "Russian Federation" → "Russia" (override)
   - Others as-is

### 5.2 UI accommodation for long names `[both]`

`HierarchyPanel.tsx` current `numberOfLines={2}`. Update:
- If `name.length > 25`: apply `adjustsFontSizeToFit={true} minimumFontScale={0.75}` (RN native, works on iOS/Android/web)
- 3-line fallback for names > 30 chars (Democratic Republic of the Congo etc.)
- Test: "Bosnia and Herzegovina" (22 chars) and "Democratic Republic of the Congo" (33 chars) both display without truncation

### Appendix A — CN ADM1 name lookup (draft)

Will be maintained in `backend/scripts/seed-geoboundaries/cn-adm1-names.json`:

```json
{
  "Shanghaishi": "Shanghai",
  "Beijingshi": "Beijing",
  "Tianjinshi": "Tianjin",
  "Chongqingshi": "Chongqing",
  "Xianggang": "Hong Kong",
  "Aomen": "Macao",
  "Taiwan": "Taiwan",
  "Hebeisheng": "Hebei",
  "Shanxisheng": "Shanxi",
  "...": "..."
}
```
Full 34 entries drafted at seed time by main agent.

### Appendix B — Country override table (draft)

```json
{
  "United States of America": "United States",
  "Russian Federation": "Russia",
  "Republic of Korea": "South Korea",
  "Democratic People's Republic of Korea": "North Korea",
  "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
  "Iran (Islamic Republic of)": "Iran",
  "Bolivia (Plurinational State of)": "Bolivia",
  "Venezuela (Bolivarian Republic of)": "Venezuela"
}
```

---

## 6. Backward compatibility for v427 client `[A#1 blocker, B#1 blocker]`

### 6.1 Client-side state normalize

`hierarchyService.ts`:

```typescript
function normalizeSibling(s: any): SiblingRow {
  // v427 backend returns state ∈ {'explored', 'locked'}
  // v428 backend returns state ∈ {'marked', 'walked', 'locked'}
  // A v427 client should never see v428 backend fields (marker_count etc.)
  // A v428 client hitting v427 backend needs fallback:
  const state = s.state === 'explored'
    ? (s.marker_count > 0 ? 'marked' : 'walked')  // impossible on v427, but safe
    : (s.state ?? 'locked');
  return {
    id: s.id,
    name_en: s.name_en,
    level: s.level,
    bbox: s.bbox,
    is_here: !!s.is_here,
    state,
    point_count: s.point_count ?? 0,
    marker_count: s.marker_count ?? 0,
  };
}
```

### 6.2 Backend-side backward compat for v427 clients

`hierarchy.js` `/panel` response includes both old and new fields (already done in v428 draft: `explored_here`, `here_point_count`, `explored_count`, `locked_count` all preserved).

**Test**: check-in v427 client's `hierarchyService` types compile against v428 response — old client will pick up new fields it doesn't know (no crash), and required v427 fields are all present.

### 6.3 AsyncStorage cache version bump `[both blocker]`

`hierarchyService.ts` cache key changes:
- v427: `hierarchy:panel:{regionId}` → v428: `hierarchy:panel:v2:{regionId}` (or `:drill:{regionId}`)
- Add cache version constant `PANEL_CACHE_VERSION = 'v2'` at top of file
- On first read of missing v2 cache, purge any orphan `hierarchy:panel:*` keys

---

## 7. Highlight rendering (revised) `[B#2, B#4, A concern]`

### 7.1 Layer stack (final) `[A open Q3]`

Bottom-up:
```
1. base map (streets-v12)
2. fog layer (existing)
3. hl-region-fill      ← NEW: FillLayer, sage 0.25 opacity
4. hl-region-line      ← NEW: LineLayer, sage 2px
5. tracks (existing)
6. markers (existing)
7. user location dot (existing)
```

Markers must sit **above** highlight (user assets never occluded).

### 7.2 Highlight always-visible policy `[user decision]`

Highlight remains on when zoom changes; no auto-hide.
- Zoom 14: user sees roads, Auckland outline off-screen — accepted (per user)
- Zoom 3: whole Asia visible with Auckland fill — visually small but works

**Additional**: At zoom < 4, drop fill opacity from 0.25 → 0.12 to prevent world-view color pollution (B concern). This is one setting change, not a fade animation (per A open Q2, no animation).

### 7.3 Region-switch transition `[B#2 blocker]`

When user picks sibling B while sibling A is highlighted:
- Do NOT clear A immediately
- Fetch B polygon → source data
- Update source data (Mapbox `setData()` on the shape source) atomically → A disappears, B appears at the same tick
- No white-frame flicker

### 7.4 Fetch caching

- Client caches polygon per `regionId` with 24h TTL in AsyncStorage
- Cache key: `hierarchy:polygon:v2:{regionId}` (v2 for compat with future schema changes)
- Backend endpoint sets `Cache-Control: public, max-age=86400`

---

## 8. Polygon size discipline `[A#4 blocker]`

### 8.1 Seed-time simplification

For each ADM1 feature during seed:
```js
turf.simplify(feature, { tolerance: 0.001, highQuality: true })
```
Post-simplify, verify `JSON.stringify(feature.geometry).length <= 200_000` (200KB).
If any feature exceeds, apply another pass at `tolerance: 0.005`.

### 8.2 Endpoint gzip

Verify docker/nginx serves `Content-Encoding: gzip` on `/api/hierarchy/polygon/:id`:
```bash
curl -H "Accept-Encoding: gzip" -I https://api.yiiling.cn/api/hierarchy/polygon/CN-SH
```
If not gzipped, add `compression` middleware to Express.

### 8.3 Response budget

- Per-polygon: ≤ 200KB gzipped hard limit
- p95 latency: < 500ms (aliyun → NZ)
- iOS AsyncStorage total for hierarchy: budget 50MB, alarm at 30MB

---

## 9. Empty state `[B#1 blocker]`

New user, first-open memory tab:
- No `lastFix` → default region = `world`
- All siblings = `locked` (continents, since no data)
- HierarchyPanel shows all 7 continents as locked (they can drill in)
- **New**: add a top banner: `"Head out and start walking to unlock places."` (English only, per user)
- Banner only visible when `explored_count === 0 && marker_count === 0 && here_state === 'locked'`

---

## 10. Sim-walker gate (revised) `[A#5, B#3 concerns]`

### 10.1 Gate logic

```typescript
// HikingScreen.tsx
const debugMode = useSettingsStore((s) => s.debugMode);           // persistent, 5-tap toggle
const simWalkerActive = useSimWalkerStore((s) => s.active);       // in-memory only

{debugMode && simWalkerActive && <SimWalkerOverlay />}
```

### 10.2 New `useSimWalkerStore` (in-memory only, not persisted)

```typescript
// app/src/dev/simWalker/useSimWalkerStore.ts
export const useSimWalkerStore = create<SimWalkerState>()((set) => ({
  active: false,
  toggle: () => set((s) => ({ active: !s.active })),
}));
```

No middleware. `zustand/persist` NOT applied. Cold restart = `active: false`.

### 10.3 Settings UI

`SettingsScreen.tsx` inside `debugMode && (...)` block, add:
```
[Switch]  Sim walker (fake GPS)
Sub-copy: "Off on next app launch."
```

### 10.4 Overlay draggable

`SimWalkerOverlay` current position: fixed bottom-right 140x140. **Change**: wrap in draggable container, save position to `useSimWalkerStore` (in-memory). Long-press to reset. Prevents obstruction of Save/Marker FAB.

### 10.5 Env var removal

Remove `EXPO_PUBLIC_SIM_MODE` gate. Only `debugMode && simWalkerActive` gates the overlay. Simplifies dev setup.

---

## 11. Stale-content clarity `[A#3 concern]`

`HierarchyPanel.tsx` — when regionId or drill changes and old data is preserved (per v1 flicker fix):
- Wrap panel body in `<View style={{ opacity: loading ? 0.5 : 1 }}>` while new fetch in flight
- Show a small `Loading…` label in header replacing name during fetch
- This preserves layout (no flicker) but signals staleness (no ghost)

---

## 12. Testability additions `[B testability gaps]`

### 12.1 Add `data-testid` / `testID` attributes

`HierarchyPanel.tsx`:
```tsx
<View testID="hierarchy-panel" ...>
  <Text testID="hierarchy-title">{data?.current.name_en}</Text>
  <View testID={`hierarchy-row-${sib.id}`} data-here={isHere}>...</View>
  <View testID="hierarchy-legend">...</View>
</View>
```

`SettingsScreen.tsx`:
```tsx
<Switch testID="settings-sim-walker-toggle" .../>
```

### 12.2 Playwright test hooks

Ensure `__cairnStores.settings.setState({ debugMode: true })` and `__simWalkerStore.getState().toggle()` are reachable. Verify by inspection in web dev server.

### 12.3 Test data set (5 cities)

Point-in-polygon assertions:
| City | GPS | Expected deepest |
|---|---|---|
| Shanghai People's Square | 31.2304, 121.4737 | ADM1 = Shanghai |
| Auckland CBD | -36.8485, 174.7633 | ADM1 = Auckland |
| Tokyo Shibuya | 35.6595, 139.7005 | ADM1 = Tokyo |
| New York Times Square | 40.7580, -73.9855 | ADM1 = New York |
| London Trafalgar Sq | 51.5081, -0.1281 | ADM1 = Greater London |

### 12.4 Enclave / edge tests

- Chatham Islands (`-43.9, -176.5`) → ADM1 = Chatham Islands Territory (NZ), not "outside" — validates antimeridian
- Russian Kamchatka (`53, 158`) → ADM1 = Kamchatka Krai
- French Guiana (`4, -53`) → ADM1 = France (or Guyane, depending on data) — cross-continent country test

---

## 13. Legend copy `[B#2 concern]`

Change from `"mark / visit / locked"`:
- 实心 sepia dot: `Marked` (has flags/cairns)
- 空心 sepia dot: `Walked` (visited but no flag)
- 灰实心 dot: `Never` (not visited)

Layout unchanged, just three terms clearer.

---

## 14. Rollback plan `[A concern, B#5]`

Rollback = deploy v429 revert commit + backend restore:

1. Client: OTA v429 re-uploads v427 client bundle
2. Backend:
   ```sql
   ALTER TABLE regions DROP COLUMN geom;
   DROP INDEX idx_geom ON regions;
   ```
3. Redeploy backend from v427 tag: `git checkout v427 && docker compose up -d`
4. Test: `curl api.yiiling.cn/api/hierarchy/panel?region_id=world` returns v427 shape

**Rollback playbook to be committed as `docs/runbook-v428-rollback.md`** before OTA push.

---

## 15. Definition of Done — v428 可以推 OTA 的条件 (revised)

- [ ] MySQL 8 spatial VERIFIED on aliyun (spike done ✅)
- [ ] geoBoundaries seed complete, regions table row count > v427 (~4200)
- [ ] All 4000+ ADM1 polygons ≤ 200KB gzipped
- [ ] `/api/hierarchy/polygon/:id` returns gzipped GeoJSON for 5 test cities
- [ ] `/api/hierarchy/panel` returns three-state siblings for 5 test cities
- [ ] `/api/hierarchy/deepest` returns correct ADM1 for all 5 test GPS points + 3 enclave points
- [ ] Playwright web build 5 cities: highlight fill visible in DOM (`map.getSource('hl-region-fill').serialize().data.features.length === 1`)
- [ ] Panel three-state visual verified (Playwright screenshots × 5 cities)
- [ ] Drill-into-current: `data-here` attribute change verifies before/after
- [ ] ↑ flicker fix: 3 rapid regionId changes, no full white flash (Playwright anim capture)
- [ ] Legend copy renders "Marked / Walked / Never"
- [ ] Long-name test: "Bosnia and Herzegovina" + "Democratic Republic of the Congo" no truncation
- [ ] Empty state banner appears for a fresh test user (`hierarchy:panel:v2` cache purged, 0 memory points)
- [ ] Sim-walker gate 3 combos:
  - debugMode=false → overlay invisible
  - debugMode=true, simWalkerActive=false → overlay invisible
  - both=true → overlay visible + joystick functional
- [ ] Sim-walker cold-restart resets `simWalkerActive=false` (test hook: reload web page)
- [ ] Legacy compat: check v427 client TypeScript types compile against v428 response
- [ ] AsyncStorage cache: v427 cached data purged on first v428 read (no crash)
- [ ] Backend gzip: `Content-Encoding: gzip` header present on polygon endpoint
- [ ] Backend p95: /polygon/:id < 500ms measured over 20 samples
- [ ] Antimeridian: Russia deepest lookup at both (60,179) and (60,-179) returns "Russia"
- [ ] Rollback runbook committed
- [ ] **3-subagent independent OTA gate**: all 3 verdicts = PASS

---

## 16. 3-Subagent OTA Gate — division of labor `[B recommendation]`

### Subagent 1 — Backend / Data correctness
Reviews:
- backend/src/routes/hierarchy.js (all changes)
- backend/scripts/seed-geoboundaries/ (all)
- 5-city polygon endpoint HTTP responses (captured by main agent)
- point-in-polygon correctness for 5 test GPS + 3 enclave GPS
- v427 client shape backward compat
- gzip verification

### Subagent 2 — Client UX / Rendering
Reviews:
- app/src/features/memory/components/HierarchyPanel.tsx
- app/src/features/memory/screens/MemoryScreen.tsx
- app/src/features/memory/components/MemoryMap.tsx (highlight layer)
- app/src/features/memory/services/hierarchyService.ts (normalize + cache v2)
- app/src/screens/SettingsScreen.tsx (sim-walker toggle)
- 5-city Playwright screenshots
- Long-name test screenshots
- Sim-walker 3-gate combo screenshots

### Subagent 3 — Integration / Regression / Rollback
Reviews:
- Full Playwright QA run (Mem tab drill 3 levels + all tab navigation with 0 console errors)
- Sim-walker cold-restart behavior
- AsyncStorage cache purge behavior
- Rollback runbook dry-run
- Bundle size delta (v427 → v428)
- Boot performance (cold app open time, must not regress > 500ms)

**Escalation**: any subagent verdict = FAIL → main agent identifies root cause + fixes + all 3 subagents re-run from scratch. No partial approval.

---

## Open questions for reviewers (v2)

1. `ST_Union` continent aggregation — should this happen at seed time (one-off cost) or on-demand during `/deepest` (per-request cost)?
   - Main agent recommends: seed time. Continent polygon rarely changes. Store in `regions` table like any other polygon.

2. Legend copy "Marked / Walked / Never" — acceptable? Alternative: `Pinned / Walked / Locked`?
   - Main agent recommends: "Marked / Walked / Never" — matches feature semantics without game-y "locked" and without ambiguous "pinned" (RN Pins terminology overlap).

3. Sim-walker overlay draggable — save position to `useSimWalkerStore` (in-memory only) or AsyncStorage (persist)?
   - Main agent recommends: in-memory. Consistent with `simWalkerActive` semantics; user re-drags after cold restart is 1 tap cost.

---

## Ready for Implementation?

**Only if second-round review of this v2 by A + B both = PASS (no conditional).**

If any critical remains, iterate to v3.
