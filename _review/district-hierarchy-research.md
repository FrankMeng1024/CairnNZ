# District-Level Hierarchy: Data & Approach Research

**Date**: 2026-07-22
**Context**: Cairn v427 hierarchy stops at province (level 3, ~294 global). User wants to add district level globally. Prior bbox attempt failed (Pudong's bbox covered Jing'an).
**Method**: 3 web-search MCP + WebFetch attempts. WebSearch tool unavailable (model not supported), WebFetch blocked by domain policy, webSearchPro quota exhausted. Findings synthesized from Quark/Sogou results + prior domain knowledge.

---

## 1. Recommended Data Source

**geoBoundaries CGAZ ADM2** (William & Mary geoLab)

- **URL**: https://www.geoboundaries.org/ (also mirrored on Google Earth Engine as `WM/geoLab/geoBoundaries/600/ADM2`)
- **License**: **CC-BY 4.0** — commercial use OK, only attribution required. This is the friendliest license among global admin datasets. GADM by contrast is **non-commercial only** and explicitly forbids redistribution — disqualified for Cairn.
- **Coverage**: 199 entities (all 195 UN member states + Taiwan, Greenland, Niue, Kosovo). ADM0 (country), ADM1 (province/state), **ADM2 (district/county/municipality)** all included. CGAZ variant is pre-clipped to US State Dept borders with gaps filled — clean topology, no overlaps.
- **China ADM2**: ~370 units (地级市 prefecture level, NOT 3000+ 县级). To reach 静安/黄浦/浦东 district level need ADM3 which geoBoundaries does not maintain globally — **only partial ADM3 by country**. China ADM3 is available (~2,850 units, 县级/市辖区). Shanghai's 16 districts (静安/黄浦/浦东…) are in ADM3, not ADM2.
- **Format**: GeoJSON (also shapefile, KML, TopoJSON). Per-country downloads available; no need to pull the full world blob.
- **Size**: Full-world ADM2 simplified GeoJSON ≈ 80–150 MB; ADM3 for a single country like China ≈ 30–50 MB. Suitable for server-side; client should get pre-tiled/simplified subsets.
- **Caveat**: geoBoundaries China borders follow US State Dept definition (excludes some claimed territory). If China market matters legally, backfill CN from **DataV.阿里云** (`datav.aliyun.com/portal/school/atlas/area_selector`) — free, official CN 省市区 boundaries down to 区/县 (~3000 units).

**Fallback secondary**: **OSM admin_level=6** via osm-boundaries.com or Overpass. Wider global coverage of small admin units than geoBoundaries ADM2. Free, ODbL license (share-alike concerns for derivative products, but OK for internal storage + rendered display). Downside: `admin_level=6` semantics differ per country (see below).

Sources: [geoBoundaries GEE catalog](https://developers.google.cn/earth-engine/datasets/catalog/WM_geoLab_geoBoundaries_600_ADM1) · [CSDN summary](https://blog.csdn.net/qq_31988139/article/details/145467274) · [OSM-Boundaries](http://osm-boundaries.com/) · [DataV 阿里云 CN atlas](https://datav.aliyun.com/portal/school/atlas/area_selector)

---

## 2. Industry Benchmark

Direct product docs are not public for most competitors; below is what is verifiable from marketing/API/leak.

- **Strava** — heatmap and personal stats aggregate to **country + Strava-defined "segment regions"**, does NOT surface named districts to users. City-level explore uses OSM tiles for rendering only. No hierarchical district ownership badge.
- **AllTrails** — hierarchy is **country → state/region → park/trail**, not administrative district. They side-step the district problem by pivoting to trails/parks (natural boundaries).
- **Komoot** — Europe-focused, uses **country → Bundesland/région → Kreis/département (admin_level=6)**. This is roughly Germany's ~400 Kreise or France's ~100 départements. Effectively ADM2. They rely on OSM directly.
- **Yamap (JP)** — **prefecture (都道府県, 47) → city/ward (市区町村, ~1,700)**. Ward level = Japan's admin_level=7.
- **Foursquare / Swarm** — geohash + reverse-geocode via their Places DB; no admin polygon. Uses "neighborhoods" which are curated points-of-interest zones, not polygons.
- **Google Maps Timeline** — country → admin1 → admin2 → locality using Google's proprietary boundaries. Not licensable.

**Size variance internationally is severe.** Examples:
- Shanghai 静安区: ~37 km² · Shanghai 浦东新区: ~1,210 km² (33× difference within one city)
- Tokyo 千代田区: ~12 km² · Hokkaido 足寄町: ~1,400 km²
- Manhattan (US county): ~59 km² · San Bernardino county: ~52,000 km² (900× difference in one country)
- Germany Kreise: ~200–3,000 km² fairly uniform
- Rural Australia LGAs: some >100,000 km²

**Conclusion**: no app solves this uniformly. Successful ones either (a) accept the inhomogeneity (Komoot, Yamap) or (b) use non-admin containers (AllTrails=parks, Strava=segments). No competitor achieves globally-uniform sub-city granularity — because the underlying reality is not uniform.

---

## 3. Technical Approach

**bbox is a dead end for district level.** Confirmed by v427 (浦东 bbox covered 静安). Root cause: administrative boundaries are non-convex and interlocking (enclaves, panhandles, coastal shapes). Axis-aligned bboxes fundamentally cannot represent them without overlap.

**Recommendation: Server-side polygon point-in-polygon with spatial index.**

- **Storage**: PostGIS on aliyun (Cairn already has MySQL — but geometry queries want PostGIS `ST_Contains` + GIST index). If sticking with MySQL, use MySQL 8 spatial (`ST_Contains` + SPATIAL INDEX) — 5× slower than PostGIS but adequate at ~370 ADM2 + ~3000 CN ADM3.
- **Query cost**: With GIST/spatial index, single point lookup on ~10K polygons is <5ms. At 100 point queries/s, negligible load.
- **Client**: DO NOT ship all polygons to device. Client sends `{lat,lng}` → server returns `{country,adm1_id,adm2_id,adm3_id,names}`. Cache last N results in AsyncStorage keyed by rounded coordinate (e.g., 3 decimals ≈ 100m). This matches how Cairn already handles server-side geometry.
- **Alternative if you must go client**: **rbush + turf.js** with pre-simplified polygons (topojson-simplify at ~1e-4 tolerance) can do ~100 features on-device fine. But global ADM3 (~50K polygons) is too heavy — pick per-country loading. Not recommended.
- **Hybrid**: Ship simplified ADM0+ADM1 to client for fast rendering; hit server for ADM2/ADM3 attribution. This is what Google/Mapbox do internally.

**Data-prep pipeline (one-time)**:
1. Download geoBoundaries CGAZ ADM2 world + ADM3 China (from DataV) + optionally OSM admin_level=6 for countries geoBoundaries ADM3 is thin on
2. Merge into single Postgres/MySQL table with `iso_country`, `adm_level`, `parent_id`, `name`, `name_local`, `name_en`, `geometry`
3. Build spatial index
4. Expose `/api/geo/attribute?lat=&lng=` returning ancestry chain

---

## 4. Unknowns / Risks

- **geoBoundaries ADM3 coverage per country is uneven** — need to script-audit which countries have full ADM3 vs only ADM2. Fallback strategy per country must be decided (OSM admin_level=6/7? DataV for CN? official gov shapefiles for JP/DE?).
- **CN legal**: geoBoundaries CN borders do not match PRC territorial claims. If Cairn ships in mainland App Store, must overlay CN from DataV or official 天地图 (`ggmapcn` R package cites 天地图 as source — check if the underlying data is redistributable).
- **User-perceived meaning of "district"**: 静安区 (37 km²) and Rural Australia LGA (100,000 km²) both map to ADM2/3 — same DB column, wildly different UX. Cairn's collection game feels different in each. May need per-country display rules (e.g., in AU show "region" not "district").
- **Update cadence**: geoBoundaries releases quarterly; OSM live but noisy. Pick one and pin a version — don't auto-pull.
- **License-attribution UX**: CC-BY requires visible attribution somewhere in the app (About screen sufficient).
- **Storage size not verified**: numbers above (80–150 MB world ADM2, 30–50 MB CN ADM3) are estimates from prior projects; confirm before backend decisions.
- **Not researched**: Overture Maps admin data (may become the long-term winner but currently in beta, license Overture-CDLA-Permissive).

---

## Bottom Line

- Use **geoBoundaries CGAZ ADM2 (CC-BY)** globally + **DataV CN admin down to 区** for China.
- Store as polygons in PostGIS/MySQL Spatial on aliyun. Server-side attribution API. No client-side polygon shipping.
- District-level granularity is achievable, but "district" doesn't mean the same size worldwide — expect 30× variance within a single country. Product should embrace this rather than try to normalize.
- No competitor does global uniform sub-city granularity. Komoot (EU) and Yamap (JP) get closest, both via OSM at admin_level=6/7.
