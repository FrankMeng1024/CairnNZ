#!/usr/bin/env node
/**
 * seed-hierarchy-regions.js — v427 world hierarchy seed
 *
 * Reads:
 *   - countries.geojson (Natural Earth 50m admin_0, 242 countries)
 *   - provinces.geojson (Natural Earth 50m admin_1, 294 provinces globally)
 *
 * Writes: MySQL regions table on aliyun.
 *
 * Region hierarchy:
 *   L0 world (1 row)
 *   L1 continent (7 rows) — hardcoded
 *   L2 country (242 rows) — from countries.geojson, parent=continent
 *   L3 province (294 rows) — from provinces.geojson, parent=country (via adm0_a3)
 *   L4 district (16 rows) — Shanghai only for now, hardcoded (from legacy STATIC_REGIONS)
 *
 * Schema:
 *   CREATE TABLE regions (
 *     id VARCHAR(32) PRIMARY KEY,       -- e.g. 'world', 'AS', 'CN', 'CN-31', 'CN-31-101'
 *     parent_id VARCHAR(32) NULL,       -- FK to regions.id
 *     name_en VARCHAR(120) NOT NULL,    -- "Shanghai"
 *     name_zh VARCHAR(120) NULL,        -- "上海" (nullable, may fill later)
 *     level TINYINT NOT NULL,           -- 0=world, 1=continent, 2=country, 3=province, 4=district
 *     bbox_min_lng DOUBLE NOT NULL,
 *     bbox_min_lat DOUBLE NOT NULL,
 *     bbox_max_lng DOUBLE NOT NULL,
 *     bbox_max_lat DOUBLE NOT NULL,
 *     INDEX idx_parent (parent_id),
 *     INDEX idx_level (level)
 *   );
 *
 * Usage:
 *   node backend/scripts/seed-hierarchy/seed.js  # dry-run + prints SQL
 *   node backend/scripts/seed-hierarchy/seed.js --apply  # apply to DB via mysql cli
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = __dirname;

// ─────────────────────────────────────────────────────────────────────────
// Continent hardcoded (Natural Earth uses these strings verbatim)
// ─────────────────────────────────────────────────────────────────────────
const CONTINENTS = [
  { id: 'AS', name: 'Asia',           bbox: [26, -10, 180, 82] },
  { id: 'EU', name: 'Europe',         bbox: [-25, 34, 60, 72] },
  { id: 'AF', name: 'Africa',         bbox: [-20, -35, 55, 38] },
  { id: 'NA', name: 'North America',  bbox: [-170, 15, -50, 84] },
  { id: 'SA', name: 'South America',  bbox: [-82, -56, -34, 13] },
  { id: 'OC', name: 'Oceania',        bbox: [110, -50, 180, 0] },
  { id: 'AN', name: 'Antarctica',     bbox: [-180, -90, 180, -60] },
];
// Natural Earth CONTINENT string → id
const CONTINENT_MAP = {
  'Asia': 'AS',
  'Europe': 'EU',
  'Africa': 'AF',
  'North America': 'NA',
  'South America': 'SA',
  'Oceania': 'OC',
  'Antarctica': 'AN',
  'Seven seas (open ocean)': null, // skip
};

// ─────────────────────────────────────────────────────────────────────────
// bbox extraction from GeoJSON geometry
// ─────────────────────────────────────────────────────────────────────────
function extractBbox(geom) {
  let minLng = 180, minLat = 90, maxLng = -180, maxLat = -90;
  const eatCoord = (c) => {
    if (typeof c[0] === 'number') {
      const [lng, lat] = c;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    } else {
      for (const cc of c) eatCoord(cc);
    }
  };
  if (geom && geom.coordinates) eatCoord(geom.coordinates);
  // Antimeridian workaround: e.g. Russia/US crossing 180 have bbox spanning -180..180
  // Natural Earth already handles this, we keep raw.
  return [
    Math.round(minLng * 100) / 100,
    Math.round(minLat * 100) / 100,
    Math.round(maxLng * 100) / 100,
    Math.round(maxLat * 100) / 100,
  ];
}

// ─────────────────────────────────────────────────────────────────────────
// Load geojson & build rows
// ─────────────────────────────────────────────────────────────────────────
const countries = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'countries.geojson'), 'utf8'));
const provinces = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'provinces.geojson'), 'utf8'));

const rows = [];

// L0: world
rows.push({
  id: 'world', parent_id: null, name_en: 'World', name_zh: '世界',
  level: 0, bbox: [-180, -90, 180, 90],
});

// L1: continents
for (const c of CONTINENTS) {
  rows.push({
    id: c.id, parent_id: 'world', name_en: c.name, name_zh: null,
    level: 1, bbox: c.bbox,
  });
}

// L2: countries. Use ADM0_A3 as id (e.g. 'CHN', 'NZL', 'USA').
const countryById = new Map();
for (const f of countries.features) {
  const p = f.properties;
  const contId = CONTINENT_MAP[p.CONTINENT];
  if (!contId) continue; // skip open-ocean features
  const id = p.ADM0_A3; // 3-letter ISO code
  if (!id || id === '-99') continue;
  const name = p.NAME_EN || p.NAME || p.ADMIN;
  const bbox = extractBbox(f.geometry);
  const row = {
    id, parent_id: contId, name_en: name, name_zh: null,
    level: 2, bbox,
  };
  countryById.set(id, row);
  rows.push(row);
}

// L3: provinces. Parent = countries via adm0_a3 (3-letter).
// Province id: use iso_3166_2 if valid (e.g. 'CN-31'), else adm1_code (e.g. 'CHN-2649').
let skippedProvinces = 0;
for (const f of provinces.features) {
  const p = f.properties;
  const parentA3 = p.adm0_a3;
  const parent = countryById.get(parentA3);
  if (!parent) { skippedProvinces++; continue; }
  const iso = p.iso_3166_2;
  const id = iso && iso.includes('-') && iso !== '-99'
    ? iso
    : `${parentA3}_${p.adm1_code}`;
  const name = p.name_en || p.name;
  if (!name) { skippedProvinces++; continue; }
  const bbox = extractBbox(f.geometry);
  rows.push({
    id, parent_id: parentA3, name_en: name, name_zh: null,
    level: 3, bbox,
  });
}

// L4: districts SKIPPED in v427 — real district-level bboxes need a proper
// source (geoBoundaries ADM2 or similar). Manual bboxes are too coarse and
// overlap, causing "you are in Pudong" when user is actually in Jing'an.
// R2 will re-add district level with real data.
const shanghaiDistricts = [];
for (const [id, name, bbox] of shanghaiDistricts) {
  rows.push({ id, parent_id: 'CN-SH', name_en: name, name_zh: null, level: 4, bbox });
}

// ─────────────────────────────────────────────────────────────────────────
// SQL generation
// ─────────────────────────────────────────────────────────────────────────
function escapeSql(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return v.toString();
  return `'${String(v).replace(/'/g, "''")}'`;
}

const sqlLines = [];
sqlLines.push('-- v427 seed: regions table');
sqlLines.push('USE cairn;');
sqlLines.push('');
sqlLines.push('DROP TABLE IF EXISTS regions;');
sqlLines.push(`CREATE TABLE regions (
  id VARCHAR(32) NOT NULL PRIMARY KEY,
  parent_id VARCHAR(32) NULL,
  name_en VARCHAR(120) NOT NULL,
  name_zh VARCHAR(120) NULL,
  level TINYINT NOT NULL,
  bbox_min_lng DOUBLE NOT NULL,
  bbox_min_lat DOUBLE NOT NULL,
  bbox_max_lng DOUBLE NOT NULL,
  bbox_max_lat DOUBLE NOT NULL,
  INDEX idx_parent (parent_id),
  INDEX idx_level (level)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`);
sqlLines.push('');

// Batch INSERT
const BATCH = 200;
for (let i = 0; i < rows.length; i += BATCH) {
  const chunk = rows.slice(i, i + BATCH);
  const values = chunk.map((r) => {
    return `(${escapeSql(r.id)}, ${escapeSql(r.parent_id)}, ${escapeSql(r.name_en)}, ${escapeSql(r.name_zh)}, ${r.level}, ${r.bbox[0]}, ${r.bbox[1]}, ${r.bbox[2]}, ${r.bbox[3]})`;
  }).join(',\n  ');
  sqlLines.push(`INSERT INTO regions (id, parent_id, name_en, name_zh, level, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat) VALUES\n  ${values};`);
  sqlLines.push('');
}

const sqlPath = path.join(DATA_DIR, 'regions.sql');
fs.writeFileSync(sqlPath, sqlLines.join('\n'));

console.log(`Wrote ${sqlPath}`);
console.log(`Total rows: ${rows.length}`);
console.log(`  world:      ${rows.filter(r => r.level === 0).length}`);
console.log(`  continent:  ${rows.filter(r => r.level === 1).length}`);
console.log(`  country:    ${rows.filter(r => r.level === 2).length}`);
console.log(`  province:   ${rows.filter(r => r.level === 3).length}`);
console.log(`  district:   ${rows.filter(r => r.level === 4).length}`);
console.log(`Skipped provinces (no country parent): ${skippedProvinces}`);

// Sanity: check China has provinces
const cnProvinces = rows.filter(r => r.parent_id === 'CHN' && r.level === 3);
console.log(`China provinces: ${cnProvinces.length}`);
cnProvinces.slice(0, 5).forEach(r => console.log(`  - ${r.id} ${r.name_en} bbox=${r.bbox.join(',')}`));
