# v428 Plan v3 — Post-second-review Revision

**Date**: 2026-07-22
**Author**: main agent
**Status**: Draft v3 — pending city-override subagent output + third-round review

## Changes from v2

Round 2 reviewer A verdict: PASS_WITH_CHANGES (5 minor deltas, 30-min edit).
Round 2 reviewer B verdict: PASS_WITH_CHANGES (4 minor deltas, inline during coding).
**Both agreed**: no architectural blocker remains; v3 folds small deltas + separately-raised city-naming edge cases.

Additional issues surfaced by supplementary review (round 1 continuation) after spike but not yet in v2:
- London / NYC / Wellington City ADM1 semantic mismatch
- Suffix strip false positives (Northern Territory, Free State)
- Override table underestimated at 30 entries — realistic 100+
- Continent highlight strategy

These are **new** and require v3, not just inline coding.

---

## 1. Scope — unchanged (3 changes: A/B/C)

---

## 2. Data model — no changes from v2

Single `geom GEOMETRY NOT NULL SRID 4326` column with SPATIAL INDEX. See v2 §2.

## 2.2 Antimeridian — no changes from v2

---

## 3. Attribution algorithm — refined

### 3.1 & 3.2 — no changes from v2

### 3.3 Continent handling (revised per user + reviewer A) `[user decision + A#1]`

**User decision**: "Continent 不高亮".

- Continent (Asia/Europe/...) rows in `regions` table: level=1, `geom = ST_GeomFromText('POLYGON EMPTY', 4326)` (empty geometry) — this signals "no highlight".
- Client `MemoryMap.tsx` highlight layer: on region selected, if returned polygon is empty/null, **skip fill/line source update** (leave previous data or clear source). No visual noise.
- Panel behavior unchanged: continent still selectable, still drills into member countries.
- **No ST_Union / turf union at all** — sidesteps Russia/Turkey Europe-vs-Asia dispute + zero data cost.

### 3.4 `/panel` performance target `[A new]`

Add to DoD: `/api/hierarchy/panel?region_id=CN` p95 < 800ms measured over 20 samples (higher than /polygon /polygon-500ms because /panel does per-sibling `ST_Contains` scan).

---

## 4. Levels & data source — no changes from v2

---

## 5. Naming convention — significantly revised `[both round-1 supplementary]`

### 5.1 Priority order (top wins)

For each ADM1 row, name resolution follows this precedence:

1. **City-override table** (`city-overrides-draft.json`, being drafted by subagent) — hardcoded lookup by geoBoundaries `shapeName` + optional GPS bbox trigger for cities embedded in larger admin units (e.g., "England" → for GPS in Greater London bbox → "London")
2. **Country-specific short-name table** (Appendix B: US/UK/Russia/Korea long-form → short-form)
3. **CN ADM1 pinyin → English** (Appendix A: full 34 entries drafted at seed time)
4. **Global suffix-strip regex** (limited whitelist, see 5.2)
5. **Fallback**: raw `shapeName`

### 5.2 Suffix-strip whitelist (revised)

**Old plan**: strip ` Region`, ` State`, ` Province`, ` Territory`, ` Prefecture`, ` District` (case-sensitive, at end).

**Problem** (reviewer B supplementary): "Northern Territory" → "Northern" wrong. "Australian Capital Territory" → "Australian Capital" wrong. "Free State" (South Africa) → "Free" wrong. "Rakhine State" (Myanmar) → "Rakhine" OK-ish.

**New rule**: suffix strip only fires if the resulting name is **≥ 3 characters AND contains no country-word ambiguity**. Guard rules:
- Skip strip if remaining name is in a blocklist: `Northern`, `Free`, `Southern`, `Western`, `Eastern`, `Central`, `Australian Capital` (compound-word cases)
- Skip strip if the ORIGINAL name is in an exception list (`Northern Territory`, `Australian Capital Territory`, `Free State`, `Prince Edward Island`, ...)
- Otherwise strip

**Deliverable**: dry-run seed script that outputs every ADM1 name AS PROPOSED after all rules. Main agent + user review the diff before committing to production data.

### 5.3 Full pipeline diagram

```
geoBoundaries shapeName
  → city override matches? (uses shapeName + optional bbox) → use override
  → country short-form table matches? → use short-form
  → CN ADM1 (parent country = CHN)? → use pinyin table
  → strip suffix (with guard rules)? → use stripped
  → keep raw shapeName
```

### Appendix A — CN ADM1 pinyin lookup (FULL 34 entries)

To be drafted by main agent at seed script authoring time. Committed to `backend/scripts/seed-geoboundaries/cn-adm1-names.json`. Full list:

```
Beijingshi → Beijing
Tianjinshi → Tianjin
Hebeisheng → Hebei
Shanxisheng → Shanxi
Neimenggu Zizhiqu → Inner Mongolia
Liaoningsheng → Liaoning
Jilinsheng → Jilin
Heilongjiangsheng → Heilongjiang
Shanghaishi → Shanghai
Jiangsusheng → Jiangsu
Zhejiangsheng → Zhejiang
Anhuisheng → Anhui
Fujiansheng → Fujian
Jiangxisheng → Jiangxi
Shandongsheng → Shandong
Henansheng → Henan
Hubeisheng → Hubei
Hunansheng → Hunan
Guangdongsheng → Guangdong
Guangxi Zhuangzu Zizhiqu → Guangxi
Hainansheng → Hainan
Chongqingshi → Chongqing
Sichuansheng → Sichuan
Guizhousheng → Guizhou
Yunnansheng → Yunnan
Xizang Zizhiqu → Tibet (also acceptable: Xizang)
Shaanxisheng → Shaanxi
Gansusheng → Gansu
Qinghaisheng → Qinghai
Ningxia Huizu Zizhiqu → Ningxia
Xinjiang Uygur Zizhiqu → Xinjiang
Xianggang → Hong Kong
Aomen → Macao
Taiwan → Taiwan
```

Seed script asserts count = 34, else fails.

### Appendix B — Country short-name override (partial, extend as needed)

```json
{
  "United States of America": "United States",
  "Russian Federation": "Russia",
  "Republic of Korea": "South Korea",
  "Democratic People's Republic of Korea": "North Korea",
  "United Kingdom of Great Britain and Northern Ireland": "United Kingdom",
  "Iran (Islamic Republic of)": "Iran",
  "Bolivia (Plurinational State of)": "Bolivia",
  "Venezuela (Bolivarian Republic of)": "Venezuela",
  "Micronesia (Federated States of)": "Micronesia",
  "Lao People's Democratic Republic": "Laos",
  "Syrian Arab Republic": "Syria",
  "Republic of Moldova": "Moldova",
  "Republic of North Macedonia": "North Macedonia",
  "United Republic of Tanzania": "Tanzania"
}
```

### Appendix C — City override (drafted by subagent, pending)

City-override JSON will address:
- London / England mismatch
- NYC / New York State mismatch
- Wellington City / Wellington Region mismatch
- Paris / Île-de-France mismatch
- Others (see subagent output at `_review/v428-plan/city-overrides-draft.json`)

Implementation model:
- `regions` table adds column `city_override_bbox JSON NULL` (nullable, only ADM1 rows with overrides get it)
- `/deepest` after finding ADM1 hit: check if GPS falls in any override bbox; if yes, return the override name instead of ADM1 name
- Panel display uses the override name

Subagent output will populate Appendix C at v3 finalization.

### 5.4 UI accommodation for long names — no changes from v2 (§5.2 preserved)

---

## 6. Backward compatibility — no changes from v2

### 6.1 addendum: normalize comment `[B round 2]`

`hierarchyService.ts` normalize function must include:
```typescript
// v427 backend has no marker distinction; v428-client-on-v427-backend
// degrades all explored regions to 'walked' state (no way to know marker count)
```

---

## 7. Highlight rendering — refined `[both round 2]`

### 7.1 Layer stack — no changes from v2

### 7.2 Zoom-based opacity — refined `[A#2 round 2]`

Use Mapbox `interpolate` expression on `fill-opacity` (native, no JS listener):

```javascript
'fill-opacity': [
  'interpolate', ['linear'], ['zoom'],
  2, 0.10,     // world view — subtle
  4, 0.25,     // continent view — visible
  8, 0.25,     // country view — visible
  14, 0.25,    // street view — background context
]
```

Line width matching:
```javascript
'line-width': [
  'interpolate', ['linear'], ['zoom'],
  2, 3,        // world view — visible even when polygon tiny
  6, 2,
  14, 2,
]
```

Zero JS runtime cost. Zero FPS impact.

### 7.3 Region-switch atomic swap — no changes from v2 (§7.3 preserved)

### 7.4 Fetch caching — no changes from v2

### 7.5 Empty geometry handling (from continent decision) `[new]`

```typescript
const polygon = await fetchPolygon(regionId);
if (!polygon || polygon.features[0]?.geometry?.type === 'Point' || isEmptyPolygon(polygon)) {
  // Continent or missing data — clear source, skip fill/line
  source.setData({ type: 'FeatureCollection', features: [] });
  return;
}
source.setData(polygon);
```

Client-side isEmptyPolygon helper checks for `POLYGON EMPTY` or missing coordinates.

---

## 8. Polygon size discipline — refined `[B#4 round 2]`

### 8.1 Seed-time simplification — refined

Two-pass simplify, with error handling:
```javascript
let simplified = turf.simplify(feature, { tolerance: 0.001, highQuality: true });
if (JSON.stringify(simplified.geometry).length > 200_000) {
  simplified = turf.simplify(feature, { tolerance: 0.005, highQuality: true });
  if (JSON.stringify(simplified.geometry).length > 200_000) {
    console.error(`ADM1 ${feature.properties.shapeName} exceeds 200KB after 2 passes`);
    seedErrors.push({ region: feature.properties.shapeName, size: ... });
  }
}
```

Seed script exits non-zero if `seedErrors.length > 0`. Main agent reviews list.

### 8.2 & 8.3 — no changes from v2

---

## 9. Empty state — no changes from v2

---

## 10. Sim-walker gate — refined `[A#3 round 2]`

### 10.2 Store type extended

```typescript
type SimWalkerState = {
  active: boolean;
  position: { x: number; y: number }; // draggable overlay position, in-memory
  toggle: () => void;
  setPosition: (p: { x: number; y: number }) => void;
};

export const useSimWalkerStore = create<SimWalkerState>()((set) => ({
  active: false,
  position: { x: -20, y: -20 },  // default: bottom-right of viewport
  toggle: () => set((s) => ({ active: !s.active })),
  setPosition: (position) => set({ position }),
}));
```

### 10.4 — no changes from v2 (draggable overlay)

### 10.1, 10.3, 10.5 — no changes from v2

---

## 11. Stale-content clarity — no changes from v2

---

## 12. Testability — refined `[A#4 round 2]`

### 12.1 addendum: layer/source ID constants

```typescript
// app/src/features/memory/config/highlightLayerIds.ts
export const HL_SOURCE_ID = 'hl-region';
export const HL_FILL_LAYER_ID = 'hl-region-fill';
export const HL_LINE_LAYER_ID = 'hl-region-line';
```

Both Playwright tests and MemoryMap.tsx reference these constants. Prevents ID drift.

### 12.2, 12.3, 12.4 — no changes from v2

---

## 13. Legend copy — no changes from v2 ("Marked / Walked / Never")

Add code comment as B recommended: `// Backend state 'locked' maps to legend "Never" — do not rename backend state to 'never' to avoid churn`.

---

## 14. Rollback plan — no changes from v2

---

## 15. Definition of Done — updated

Additions from round 2:
- [ ] `/api/hierarchy/panel` p95 < 800ms measured over 20 samples `[A new]`
- [ ] Zoom transition test: zoom from 3 → 14 → 3 with highlight on, no dropped frames (Playwright perf trace) `[A#2 round 2]`
- [ ] Zoom 14 with highlight off-screen → no console errors, source still present `[B#3 round 2]`
- [ ] Seed dry-run: dump every ADM1 name AS-PROPOSED to `_review/v428-plan/name-dryrun.txt` — main agent + user review before real seed `[both]`
- [ ] Sim-walker: drag joystick to new position, kill app, cold-restart → position resets to default (in-memory verified)
- [ ] City override GPS test: 5 cities from override table (London, NYC, Wellington City, Paris, ...) → deepest returns override name

All v2 DoD items preserved.

---

## 16. 3-Subagent OTA Gate — no changes from v2

---

## Open questions v3

None new. All prior open questions resolved by reviewer answers in round 2.

---

## Ready for Implementation?

**Requires**:
1. City-override subagent completes and produces `city-overrides-draft.json` (running in background)
2. Main agent finalizes Appendix C in this v3 doc
3. Round 3 review by A + B on v3 (should be quick — most deltas are minor per their own round 2 assessment)

If round 3 = PASS from both → Implementation begins.

If any FAIL → v4.
