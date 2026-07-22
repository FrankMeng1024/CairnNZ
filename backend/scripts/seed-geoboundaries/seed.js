#!/usr/bin/env node
/**
 * seed.js — v428 世界地区数据入库脚本 (骨架)
 *
 * 输入: 4 个数据源的 GeoJSON 文件 (下载脚本产出)
 *   - geoBoundaries: tmp/adm0-world.geojson (含 220+ 国家 polygon), tmp/adm1/{ISO}.geojson
 *   - DataV: tmp/datav/province/{adcode}-boundary.geojson (中国省)
 *   - OSM: tmp/osm/*.geojson (大都会抽样, 用于对齐验证)
 *   - Natural Earth: backend/scripts/seed-hierarchy/provinces.geojson (v427 已有)
 *
 * 输出:
 *   - MySQL regions 表升级 (加 geom GEOMETRY SRID 4326 列 + SPATIAL INDEX)
 *   - 每行: {id, parent_id, name_en, level, bbox_min_lng, ...bbox..., geom, source}
 *
 * 命名规则输入: _review/v428-plan/name-rules.json (subagent 起草)
 *
 * 数据源优先级 (per row):
 *   1. DataV (中国, ISO=CHN)
 *   2. geoBoundaries (其他所有国家)
 *   3. Natural Earth 备份 (only if others missing)
 *   4. OSM (仅覆盖大都会 override, 通过 name → bbox trigger)
 *
 * Usage:
 *   node seed.js --dry-run  # 只输出 SQL, 不入库
 *   node seed.js --apply    # 执行入库
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const TMP = path.join(__dirname, 'tmp');
const NE_PROVINCES = path.join(ROOT, 'backend', 'scripts', 'seed-hierarchy', 'provinces.geojson');
const NAME_RULES_PATH = path.join(ROOT, '_review', 'v428-plan', 'name-rules.json');

// -- Continent mapping (硬编码, 独立于 geoBoundaries 分类) ------------------
const CONTINENTS = [
  { id: 'AS', name: 'Asia',           bbox: [26, -10, 180, 82] },
  { id: 'EU', name: 'Europe',         bbox: [-25, 34, 60, 72] },
  { id: 'AF', name: 'Africa',         bbox: [-20, -35, 55, 38] },
  { id: 'NA', name: 'North America',  bbox: [-170, 15, -50, 84] },
  { id: 'SA', name: 'South America',  bbox: [-82, -56, -34, 13] },
  { id: 'OC', name: 'Oceania',        bbox: [110, -50, 180, 0] },
  { id: 'AN', name: 'Antarctica',     bbox: [-180, -90, 180, -60] },
];

// -- Name normalization ---------------------------------------------------

// v428 subagent audit fix: strip IAST macrons for Indian state names.
// name-rules.json §Diacritic split policy: India uses plain-ASCII English
// (Maharashtra not Mahārāshtra) — matches Indian government English
// publications. Applied to iso === 'IND' only. Portuguese/Spanish/French
// diacritics (São Paulo, Genève) are preserved for other countries.
function stripMacrons(s) {
  return s.normalize('NFD').replace(/[\u0304\u0300-\u036f]/g, '');
}

// Explicit country-name spelling overrides that name-rules.json anticipated
// but decisions.json missed. Applied after cleanName().
const POST_CLEAN_OVERRIDES = {
  // gb "Saint Petersburg" -> "St. Petersburg" (matches Anglo cartographic convention)
  'Saint Petersburg': 'St. Petersburg',
  // Indonesian official English drops hyphen
  'Bangka-Belitung': 'Bangka Belitung',
  // Excessively long Indian territory
  'Dadra and Nagar Haveli and Daman and Diu': 'Dadra & Nagar Haveli',
  'Dādra and Nagar Haveli and Damān and Diu': 'Dadra & Nagar Haveli',
};

function loadNameRules() {
  if (!fs.existsSync(NAME_RULES_PATH)) {
    console.warn(`[seed] name-rules.json missing at ${NAME_RULES_PATH}, using defaults`);
    return { adm0_country_override: {}, adm0_country_suffix_strip: [], adm1_suffix_strip: [], adm1_suffix_strip_exceptions: [], adm1_name_diff_resolutions: [] };
  }
  return JSON.parse(fs.readFileSync(NAME_RULES_PATH, 'utf8'));
}

function cleanName(raw, rules, level, iso) {
  if (!raw) return raw;

  // v428 subagent audit fix: apply IND macron strip FIRST so downstream
  // matching in name_diff_resolutions etc works on ASCII form.
  let cur = raw;
  if (level === 3 && iso === 'IND') {
    cur = stripMacrons(cur);
  }

  // Chile mojibake fix (encoding-damaged GeoJSON)
  if (rules.adm1_encoding_fix_override && rules.adm1_encoding_fix_override[cur]) {
    return rules.adm1_encoding_fix_override[cur];
  }
  // ADM0 override table wins first
  if (level === 2 && rules.adm0_country_override && rules.adm0_country_override[cur]) {
    return rules.adm0_country_override[cur];
  }
  // Country-specific ADM1 overrides (e.g. CHN autonomous regions)
  if (level === 3 && rules.adm1_country_specific_overrides) {
    const list = rules.adm1_country_specific_overrides[iso];
    if (list) {
      // country override structure may be object {raw: chosen} or list of {gb, chosen}
      if (Array.isArray(list)) {
        const hit = list.find((r) => r.gb_name === cur || r.raw === cur);
        if (hit) return hit.chosen;
      } else if (list[cur]) {
        return list[cur];
      }
    }
  }
  // ADM1 name_diff resolutions (matches by gb_name only, since country field
  // is not populated by the subagent — gb_name is already unique across the
  // 56 rows in compare-report). Also try the pre-macron-strip original for
  // IND where the compare-report may have kept the macron form.
  if (level === 3 && rules.adm1_name_diff_resolutions) {
    const hit = rules.adm1_name_diff_resolutions.find(
      (r) => r.gb_name === cur || r.gb_name === raw
    );
    if (hit) cur = hit.chosen;
  }
  // Suffix strip with exception list
  const exceptions = new Set(rules.adm1_suffix_strip_exceptions || []);
  if (!exceptions.has(cur)) {
    const suffixes = level === 2 ? (rules.adm0_country_suffix_strip || []) : (rules.adm1_suffix_strip || []);
    const ordered = [...suffixes].sort((a, b) => b.length - a.length);
    for (const suf of ordered) {
      if (cur.startsWith(suf)) { cur = cur.slice(suf.length).trim(); break; }
      if (cur.endsWith(suf)) { cur = cur.slice(0, -suf.length).trim(); break; }
    }
  }

  // v428 subagent audit fix: final post-clean explicit overrides
  if (POST_CLEAN_OVERRIDES[cur]) return POST_CLEAN_OVERRIDES[cur];
  return cur;
}

// -- Geometry helpers -----------------------------------------------------

function bboxFromGeom(geom) {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  const eat = (c) => {
    if (typeof c[0] === 'number') {
      const [lng, lat] = c;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else for (const cc of c) eat(cc);
  };
  if (geom && geom.coordinates) eat(geom.coordinates);
  return [
    Math.round(minLng * 100) / 100,
    Math.round(minLat * 100) / 100,
    Math.round(maxLng * 100) / 100,
    Math.round(maxLat * 100) / 100,
  ];
}

function escSql(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return v.toString();
  return `'${String(v).replace(/'/g, "''")}'`;
}

// -- Build rows -----------------------------------------------------------

async function build() {
  const rules = loadNameRules();
  const rows = [];

  // Level 0: World — bbox rectangle placeholder (never rendered; level=0 check)
  rows.push({
    id: 'world', parent_id: null, name_en: 'World', level: 0,
    bbox: [-180, -90, 180, 90],
    // no geom_wkt/geojson → seed writes bbox rectangle to satisfy NOT NULL
    source: 'hardcoded',
  });

  // Level 1: Continents (bbox placeholders too; polygon endpoint returns empty for level=1)
  for (const c of CONTINENTS) {
    rows.push({
      id: c.id, parent_id: 'world', name_en: c.name, level: 1,
      bbox: c.bbox,
      // no polygon: bbox rectangle placeholder written by seed
      source: 'hardcoded',
    });
  }

  // Level 2: Countries from geoBoundaries ADM0
  const adm0 = JSON.parse(fs.readFileSync(path.join(TMP, 'adm0-world.geojson'), 'utf8'));
  const adm0Meta = JSON.parse(fs.readFileSync(path.join(TMP, 'adm0-metadata.json'), 'utf8'));
  const isoToContinent = {};
  for (const m of adm0Meta) {
    isoToContinent[m.boundaryISO] = m.Continent;
  }

  // v428 audit fix: gb ADM0 dataset excludes India (Kashmir dispute).
  // Manually add IND as a country row using Natural Earth polygon
  // (v427's countries.geojson has NAME_EN=India / ADM0_A3=IND).
  // NE draws Kashmir per US State Dept view; acceptable for NZ App Store.
  const MANUAL_COUNTRIES = [
    {
      iso: 'IND',
      name: 'India',
      continent: 'Southern Asia',
      // bbox filled at seed time from NE geometry
      ne_source: {
        file: path.join(ROOT, 'backend', 'scripts', 'seed-hierarchy', 'countries.geojson'),
        match: (p) => p.ADM0_A3 === 'IND' || p.NAME_EN === 'India',
      },
    },
  ];
  const manualIsos = new Set(MANUAL_COUNTRIES.map((c) => c.iso));
  const continentNameToId = {
    'Asia': 'AS', 'Europe': 'EU', 'Africa': 'AF',
    'North America': 'NA', 'South America': 'SA',
    'Oceania': 'OC', 'Antarctica': 'AN',
    // geoBoundaries uses UN M49 groupings, map to our simpler 7-continent model
    'Northern America': 'NA',
    'Latin America and the Caribbean': 'NA',  // Caribbean is geographically NA; Central America handled here too
    'Australia and New Zealand': 'OC',
    'Melanesia': 'OC',
    'Micronesia': 'OC',
    'Polynesia': 'OC',
    'Sub-Saharan Africa': 'AF',
    'Northern Africa': 'AF',
    'Central Asia': 'AS',
    'Eastern Asia': 'AS',
    'Southern Asia': 'AS',
    'South-eastern Asia': 'AS',
    'Western Asia': 'AS',
    'Eastern Europe': 'EU',
    'Western Europe': 'EU',
    'Northern Europe': 'EU',
    'Southern Europe': 'EU',
  };
  // Split "Latin America and the Caribbean" further: countries below Panama into SA
  const SOUTH_AMERICA_ISOS = new Set([
    'ARG', 'BOL', 'BRA', 'CHL', 'COL', 'ECU', 'GUF', 'GUY', 'PRY', 'PER', 'SUR', 'URY', 'VEN',
    // Falkland Islands, French Guiana etc
    'FLK', 'BVT',
  ]);
  const validIsos = new Set();
  for (const feat of adm0.features) {
    const p = feat.properties;
    const iso = p.shapeISO;
    if (!iso) continue;
    const contName = p.continent || isoToContinent[iso];
    let contId = continentNameToId[contName];
    // Override SA for South American countries the M49 code lumps into "Latin America"
    if (contId === 'NA' && SOUTH_AMERICA_ISOS.has(iso)) contId = 'SA';
    if (!contId) { console.warn(`[seed] skip ${iso}: continent=${contName}`); continue; }
    const cleaned = cleanName(p.shapeName, rules, 2, iso);
    rows.push({
      id: iso,
      parent_id: contId,
      name_en: cleaned,
      level: 2,
      bbox: bboxFromGeom(feat.geometry),
      geom_geojson: JSON.stringify(feat.geometry),
      source: 'geoBoundaries',
    });
    validIsos.add(iso);
  }

  // Append manual country rows (gb-omitted ISOs like India)
  for (const mc of MANUAL_COUNTRIES) {
    if (validIsos.has(mc.iso)) continue;
    const contId = continentNameToId[mc.continent];
    if (!contId) {
      console.warn(`[seed] manual country ${mc.iso}: unknown continent ${mc.continent}`);
      continue;
    }
    // Load polygon from Natural Earth countries file
    let bbox = null;
    let geom_geojson = null;
    let geom_wkt = 'POLYGON EMPTY';
    if (mc.ne_source && fs.existsSync(mc.ne_source.file)) {
      const ne = JSON.parse(fs.readFileSync(mc.ne_source.file, 'utf8'));
      const found = ne.features.find((f) => mc.ne_source.match(f.properties));
      if (found) {
        bbox = bboxFromGeom(found.geometry);
        geom_geojson = JSON.stringify(found.geometry);
        geom_wkt = null;
        console.log(`[seed] manual country ${mc.iso}: loaded polygon from NE (${bbox.join(',')})`);
      }
    }
    if (!bbox) bbox = mc.bbox || [-180, -90, 180, 90];

    const cleaned = cleanName(mc.name, rules, 2, mc.iso);
    rows.push({
      id: mc.iso,
      parent_id: contId,
      name_en: cleaned,
      level: 2,
      bbox,
      geom_geojson,
      geom_wkt: geom_geojson ? null : geom_wkt,
      source: 'NaturalEarth-manual',
    });
    validIsos.add(mc.iso);
    console.log(`[seed] manually added country ${mc.iso} (${cleaned}, continent=${contId})`);
  }

  // Level 3: ADM1 (states/regions/provinces)
  // Source priority: DataV for CHN, geoBoundaries for others
  const adm1Dir = path.join(TMP, 'adm1');
  // Dedup: some source ADM1 files have duplicate shapeNames (e.g. IRN
  // has 'Mazandaran' twice due to source data quirks). Append -N suffix.
  const seenIds = new Set();
  const dedupeId = (base) => {
    let id = base;
    let n = 1;
    while (seenIds.has(id)) { id = `${base}-${++n}`; }
    seenIds.add(id);
    return id;
  };
  if (fs.existsSync(adm1Dir)) {
    for (const f of fs.readdirSync(adm1Dir)) {
      if (!f.endsWith('.geojson')) continue;
      const iso = f.replace('.geojson', '');
      if (!validIsos.has(iso)) continue;
      // For CHN, prefer DataV — skip geoBoundaries
      if (iso === 'CHN') continue;
      const d = JSON.parse(fs.readFileSync(path.join(adm1Dir, f), 'utf8'));
      for (const feat of d.features || []) {
        const rawName = feat.properties.shapeName;
        if (!rawName) continue;
        const cleaned = cleanName(rawName, rules, 3, iso);
        const baseId = `${iso}-${slugify(cleaned)}`;
        const id = dedupeId(baseId);
        rows.push({
          id,
          parent_id: iso,
          name_en: cleaned,
          level: 3,
          bbox: bboxFromGeom(feat.geometry),
          geom_geojson: JSON.stringify(feat.geometry),
          source: 'geoBoundaries',
          source_raw_name: rawName,
        });
      }
    }
  }

  // CN ADM1 from DataV
  const dvDir = path.join(TMP, 'datav', 'province');
  const DATAV_ADCODE_TO_NAME = {
    '110000': 'Beijing', '120000': 'Tianjin', '130000': 'Hebei', '140000': 'Shanxi',
    '150000': 'Inner Mongolia', '210000': 'Liaoning', '220000': 'Jilin', '230000': 'Heilongjiang',
    '310000': 'Shanghai', '320000': 'Jiangsu', '330000': 'Zhejiang', '340000': 'Anhui',
    '350000': 'Fujian', '360000': 'Jiangxi', '370000': 'Shandong', '410000': 'Henan',
    '420000': 'Hubei', '430000': 'Hunan', '440000': 'Guangdong', '450000': 'Guangxi',
    '460000': 'Hainan', '500000': 'Chongqing', '510000': 'Sichuan', '520000': 'Guizhou',
    '530000': 'Yunnan', '540000': 'Tibet', '610000': 'Shaanxi', '620000': 'Gansu',
    '630000': 'Qinghai', '640000': 'Ningxia', '650000': 'Xinjiang',
    '810000': 'Hong Kong', '820000': 'Macao',
  };
  if (fs.existsSync(dvDir)) {
    for (const f of fs.readdirSync(dvDir)) {
      if (!f.endsWith('-boundary.geojson')) continue;
      const adcode = f.replace('-boundary.geojson', '');
      const name = DATAV_ADCODE_TO_NAME[adcode];
      if (!name) continue;
      const d = JSON.parse(fs.readFileSync(path.join(dvDir, f), 'utf8'));
      if (!d.features || d.features.length === 0) continue;
      const feat = d.features[0];
      const id = `CN-${slugify(name)}`;
      rows.push({
        id,
        parent_id: 'CHN',
        name_en: name,
        level: 3,
        bbox: bboxFromGeom(feat.geometry),
        geom_geojson: JSON.stringify(feat.geometry),
        source: 'DataV',
        source_raw_name: feat.properties.name,
        adcode,
      });
    }
  }

  // v428 subagent audit fix: add 3 missing ADM1 records that geoBoundaries
  // collapsed or omitted. Source: Natural Earth (v427 has it, unambiguous).
  await addMissingFromNaturalEarth(rows, validIsos, rules);

  return rows;
}

/**
 * Adds Moscow Oblast, Altai Krai, Washington DC — three federal-subject /
 * state records that geoBoundaries either collapsed with same-name entities
 * or omitted entirely. Source: Natural Earth admin_1 (v427 seed-hierarchy).
 * Skips silently if the entry is already present.
 */
async function addMissingFromNaturalEarth(rows, validIsos, rules) {
  const NE_PATH = path.join(ROOT, 'backend', 'scripts', 'seed-hierarchy', 'provinces.geojson');
  if (!fs.existsSync(NE_PATH)) return;
  const ne = JSON.parse(fs.readFileSync(NE_PATH, 'utf8'));
  if (!ne.features) return;

  // Which entries to import. Match by iso_3166_2 (not name — NE has multiple
  // features with same name_en, disambiguated only by iso_3166_2).
  //
  // v428 audit fix (round 2): confirmed via bbox area computation:
  //   RU-MOW  span 5.03°x2.70° ≈95000km² type='Region'      = Moscow Oblast
  //   RU-MOS  span 0.94°x0.91° ≈6000km²  type='Federal City' = Moscow city
  //   RU-ALT  type='Territory' = Altai Krai (large)
  //   RU-AL   type='Republic'  = Altai Republic (smaller, already in gb)
  const WANTED = [
    { iso: 'RUS', iso_3166_2: 'RU-MOW', label: 'Moscow Oblast' },   // was MOS - wrong
    { iso: 'RUS', iso_3166_2: 'RU-ALT', label: 'Altai Krai' },
    { iso: 'USA', iso_3166_2: 'US-DC',  label: 'Washington DC' },
  ];

  const A2A3 = {
    'CN': 'CHN', 'RU': 'RUS', 'US': 'USA', 'IN': 'IND', 'ID': 'IDN',
    'AU': 'AUS', 'NZ': 'NZL', 'BR': 'BRA', 'CA': 'CAN', 'ZA': 'ZAF',
  };

  for (const want of WANTED) {
    // Find NE feature by iso_3166_2 code (exact match)
    const picked = ne.features.find(
      (f) => f.properties.iso_3166_2 === want.iso_3166_2
    );
    if (!picked) {
      console.warn(`[audit-fix] NE feature not found: ${want.iso_3166_2}`);
      continue;
    }

    // Deduplicate: skip if we already have a row with this exact label under iso
    const id = `${want.iso}-${want.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    if (rows.some((r) => r.id === id)) {
      console.log(`[audit-fix] skip ${id} — already present`);
      continue;
    }

    if (!validIsos.has(want.iso)) {
      console.warn(`[audit-fix] skip ${id} — parent ${want.iso} not in validIsos`);
      continue;
    }

    rows.push({
      id,
      parent_id: want.iso,
      name_en: want.label,
      level: 3,
      bbox: bboxFromGeom(picked.geometry),
      geom_geojson: JSON.stringify(picked.geometry),
      source: 'NaturalEarth',
      source_raw_name: picked.properties.name_en || picked.properties.name,
    });
    console.log(`[audit-fix] added ${id} (${want.label}) from Natural Earth`);
  }
}

// tiny turf area shim (avoid require if not available)
function turfArea(feature) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const turf = require('@turf/turf');
    return Math.round(turf.area(feature) / 1000000);
  } catch { return 0; }
}

function slugify(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '-').replace(/^-+|-+$/g, '')
    .toLowerCase().slice(0, 40);
}

// -- SQL generation -------------------------------------------------------

function genSql(rows) {
  const lines = [];
  lines.push('-- v428 seed: regions table with polygon');
  lines.push('USE cairn;');
  lines.push('');
  lines.push('DROP TABLE IF EXISTS regions;');
  // v428 constraints:
  //   - MySQL 8 rejects POLYGON EMPTY / MULTIPOLYGON EMPTY as invalid GIS.
  //   - SPATIAL INDEX requires geom NOT NULL.
  //   => continent + world get a bbox-rectangle polygon as placeholder so
  //      NOT NULL is satisfied. Level column is used to gate highlight:
  //      /api/hierarchy/polygon/:id returns empty FeatureCollection for
  //      level < 2 (world / continent), regardless of stored geom.
  lines.push(`CREATE TABLE regions (
  id VARCHAR(64) NOT NULL PRIMARY KEY,
  parent_id VARCHAR(64) NULL,
  name_en VARCHAR(160) NOT NULL,
  level TINYINT NOT NULL,
  bbox_min_lng DOUBLE NOT NULL,
  bbox_min_lat DOUBLE NOT NULL,
  bbox_max_lng DOUBLE NOT NULL,
  bbox_max_lat DOUBLE NOT NULL,
  geom GEOMETRY NOT NULL SRID 4326,
  source VARCHAR(40) NULL,
  INDEX idx_parent (parent_id),
  INDEX idx_level (level),
  SPATIAL INDEX idx_geom (geom)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
  lines.push('');

  for (const r of rows) {
    let geomSql;
    // v428 MySQL 8 axis order: SRID 4326 default is (lat, lng); our data is
    // GeoJSON standard (lng, lat). Pass 'axis-order=long-lat' to make MySQL
    // parse in GeoJSON convention. ST_GeomFromGeoJSON is (lng, lat) natively.
    if (r.geom_wkt) {
      geomSql = `ST_GeomFromText(${escSql(r.geom_wkt)}, 4326, 'axis-order=long-lat')`;
    } else if (r.geom_geojson) {
      // ST_GeomFromGeoJSON is natively (lng, lat) — no options needed.
      // MySQL 8 rejects lng === -180 or lng === 180 (must be > -180 AND < 180).
      // Some GeoJSON has floating-point precision issues (180.0000000000001).
      // Parse and walk coordinates to clamp precisely.
      const clampedGeom = JSON.parse(r.geom_geojson);
      const walkClamp = (c) => {
        if (typeof c[0] === 'number') {
          if (c[0] <= -180) c[0] = -179.9999;
          if (c[0] >= 180) c[0] = 179.9999;
          if (c[1] < -90) c[1] = -90;
          if (c[1] > 90) c[1] = 90;
          return c;
        }
        return c.map(walkClamp);
      };
      if (clampedGeom.coordinates) walkClamp(clampedGeom.coordinates);
      geomSql = `ST_SRID(ST_GeomFromGeoJSON(${escSql(JSON.stringify(clampedGeom))}), 4326)`;
    } else {
      const [minLng, minLat, maxLng, maxLat] = r.bbox;
      // Clamp bbox rectangle corners too
      const mnLng = Math.max(minLng, -179.9999);
      const mxLng = Math.min(maxLng, 180);
      const rect = `POLYGON((${mnLng} ${minLat},${mxLng} ${minLat},${mxLng} ${maxLat},${mnLng} ${maxLat},${mnLng} ${minLat}))`;
      geomSql = `ST_GeomFromText(${escSql(rect)}, 4326, 'axis-order=long-lat')`;
    }
    lines.push(`INSERT INTO regions (id, parent_id, name_en, level, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, geom, source) VALUES (${escSql(r.id)}, ${escSql(r.parent_id)}, ${escSql(r.name_en)}, ${r.level}, ${r.bbox[0]}, ${r.bbox[1]}, ${r.bbox[2]}, ${r.bbox[3]}, ${geomSql}, ${escSql(r.source)});`);
  }
  return lines.join('\n');
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const apply = process.argv.includes('--apply');
  if (!dryRun && !apply) {
    console.error('Usage: node seed.js --dry-run  OR  --apply');
    process.exit(1);
  }

  console.log('Building rows...');
  const rows = await build();
  console.log(`Total rows: ${rows.length}`);
  console.log(`  world:     ${rows.filter((r) => r.level === 0).length}`);
  console.log(`  continent: ${rows.filter((r) => r.level === 1).length}`);
  console.log(`  country:   ${rows.filter((r) => r.level === 2).length}`);
  console.log(`  adm1:      ${rows.filter((r) => r.level === 3).length}`);

  const sql = genSql(rows);
  const outPath = path.join(__dirname, 'regions-v428.sql');
  fs.writeFileSync(outPath, sql);
  console.log(`Wrote ${outPath} (${(fs.statSync(outPath).size / 1024 / 1024).toFixed(1)} MB)`);

  if (apply) {
    console.log('--apply not yet implemented in seed.js. Run via ssh + mysql instead.');
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
