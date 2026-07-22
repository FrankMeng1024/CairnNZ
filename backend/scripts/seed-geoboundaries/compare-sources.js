#!/usr/bin/env node
/**
 * compare-sources.js — v428
 *
 * 逐条对比 4 个数据源里的 ADM1 (省/州/大区) 数据:
 *   1. geoBoundaries CGAZ (backend/scripts/seed-geoboundaries/tmp/adm1/*.geojson)
 *   2. DataV.阿里云 CN (backend/scripts/seed-geoboundaries/tmp/datav/province/*.geojson)
 *   3. OSM Overpass (backend/scripts/seed-geoboundaries/tmp/osm/*.geojson) 关键城市
 *   4. Natural Earth (backend/scripts/seed-hierarchy/provinces.geojson) v427 已有
 *
 * 对每个"实体" (国家 + ADM1 名字) 输出:
 *   - 来源: [geoBoundaries, DataV, OSM, NaturalEarth] 中哪几个有
 *   - 名字对比: 4 源的名字字符串
 *   - 形状对比: 面积 (km²) + 顶点数 + 中心点 lat/lng
 *   - 判定: [4_source_consistent | name_diff | shape_diff | single_source_only | missing]
 *
 * Output:
 *   _review/v428-plan/compare-report.json — 完整机器可读
 *   _review/v428-plan/compare-report.md   — 人类可读汇总,列出待人工判断的清单
 */

const fs = require('fs');
const path = require('path');
const turf = require('@turf/turf');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const GB_DIR = path.join(__dirname, 'tmp', 'adm1');
const GB_ADM0_FILE = path.join(__dirname, 'tmp', 'adm0-world.geojson');
const DATAV_DIR = path.join(__dirname, 'tmp', 'datav', 'province');
const OSM_DIR = path.join(__dirname, 'tmp', 'osm');
const NE_PROVINCES_FILE = path.join(ROOT, 'backend', 'scripts', 'seed-hierarchy', 'provinces.geojson');
const NE_COUNTRIES_FILE = path.join(ROOT, 'backend', 'scripts', 'seed-hierarchy', 'countries.geojson');
const OUT_DIR = path.join(ROOT, '_review', 'v428-plan');

// -- helpers --------------------------------------------------------------

function readGeoJson(fp) {
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch (e) {
    return null;
  }
}

function areaKm2(feature) {
  try { return Math.round(turf.area(feature) / 1000000); }
  catch { return null; }
}

function vertexCount(geom) {
  if (!geom || !geom.coordinates) return 0;
  const walk = (c) => {
    if (typeof c[0] === 'number') return 1;
    return c.reduce((s, x) => s + walk(x), 0);
  };
  return walk(geom.coordinates);
}

function centroidLL(feature) {
  try {
    const c = turf.centroid(feature);
    return [
      Math.round(c.geometry.coordinates[0] * 100) / 100,
      Math.round(c.geometry.coordinates[1] * 100) / 100,
    ];
  } catch { return null; }
}

function normalizeName(s) {
  if (!s) return '';
  return String(s)
    // Unicode NFD + strip combining marks handles ALL diacritics (á/ñ/ü/ø/ř/...)
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[' -]/g, '')
    .replace(/\s*(municipality|province|prefecture|region|state|territory|special\s+administrative\s+region|autonomous\s+region)$/i, '')
    .trim();
}

// -- load geoBoundaries ADM1 (per-country GeoJSON) -------------------------

function loadGeoBoundariesAdm1() {
  const files = fs.readdirSync(GB_DIR).filter((f) => f.endsWith('.geojson'));
  const byCountry = {};
  for (const f of files) {
    const iso = f.replace('.geojson', '');
    const d = readGeoJson(path.join(GB_DIR, f));
    if (!d || !d.features) continue;
    byCountry[iso] = d.features.map((feat) => ({
      raw_name: feat.properties.shapeName,
      area_km2: areaKm2(feat),
      vertex_count: vertexCount(feat.geometry),
      centroid: centroidLL(feat),
    }));
  }
  return byCountry;
}

// -- load DataV CN --------------------------------------------------------

const DATAV_ADCODE_TO_PROVINCE = {
  '110000': 'Beijing', '120000': 'Tianjin', '130000': 'Hebei', '140000': 'Shanxi',
  '150000': 'Inner Mongolia', '210000': 'Liaoning', '220000': 'Jilin', '230000': 'Heilongjiang',
  '310000': 'Shanghai', '320000': 'Jiangsu', '330000': 'Zhejiang', '340000': 'Anhui',
  '350000': 'Fujian', '360000': 'Jiangxi', '370000': 'Shandong', '410000': 'Henan',
  '420000': 'Hubei', '430000': 'Hunan', '440000': 'Guangdong', '450000': 'Guangxi',
  '460000': 'Hainan', '500000': 'Chongqing', '510000': 'Sichuan', '520000': 'Guizhou',
  '530000': 'Yunnan', '540000': 'Tibet', '610000': 'Shaanxi', '620000': 'Gansu',
  '630000': 'Qinghai', '640000': 'Ningxia', '650000': 'Xinjiang', '710000': 'Taiwan',
  '810000': 'Hong Kong', '820000': 'Macao',
};

function loadDataV() {
  const result = [];
  if (!fs.existsSync(DATAV_DIR)) return result;
  const files = fs.readdirSync(DATAV_DIR).filter((f) => f.endsWith('-boundary.geojson'));
  for (const f of files) {
    const adcode = f.replace('-boundary.geojson', '');
    const en = DATAV_ADCODE_TO_PROVINCE[adcode];
    if (!en) continue;
    const d = readGeoJson(path.join(DATAV_DIR, f));
    if (!d || !d.features || d.features.length === 0) continue;
    // Boundary file has exactly 1 feature = the province itself
    const provinceFeat = d.features[0];
    result.push({
      iso: 'CHN',
      adcode,
      raw_name_zh: provinceFeat.properties.name,
      en_name: en,
      area_km2: areaKm2(provinceFeat),
      vertex_count: vertexCount(provinceFeat.geometry),
      centroid: centroidLL(provinceFeat),
    });
  }
  return result;
}

// -- load OSM cities -----------------------------------------------------

function loadOsm() {
  const result = {};
  if (!fs.existsSync(OSM_DIR)) return result;
  const files = fs.readdirSync(OSM_DIR).filter((f) => f.endsWith('.geojson'));
  for (const f of files) {
    const slug = f.replace('.geojson', '');
    const raw = readGeoJson(path.join(OSM_DIR, f));
    if (!raw || !raw.elements || raw.elements.length === 0) {
      result[slug] = { error: 'empty' };
      continue;
    }
    // Overpass returns raw elements; we look at first relation
    const rel = raw.elements.find((e) => e.type === 'relation');
    if (!rel) { result[slug] = { error: 'no-relation' }; continue; }
    result[slug] = {
      osm_id: rel.id,
      tags: rel.tags,
      name: rel.tags.name || rel.tags['name:en'],
      admin_level: rel.tags.admin_level,
      // Overpass "out geom" gives coord arrays per member way; approximate area via bbox
      member_count: (rel.members || []).length,
    };
  }
  return result;
}

// -- load Natural Earth (v427 existing) ----------------------------------

function loadNaturalEarth() {
  const d = readGeoJson(NE_PROVINCES_FILE);
  const result = {};
  if (!d || !d.features) return result;
  // Natural Earth stores admin_0 code in various places; try multiple keys.
  // Convert 2-letter (iso_a2) to 3-letter via mapping? Simpler: pull adm0_sr
  // or use 'admin' field which is the country full name — then map.
  const A2_TO_A3 = {
    // Populated on demand
  };
  for (const f of d.features) {
    const p = f.properties;
    // Try to derive ISO-3 from various fields
    let iso3 = null;
    if (p.adm0_a3) iso3 = p.adm0_a3.toUpperCase();
    else if (p.iso_3166_2) {
      const two = p.iso_3166_2.slice(0, 2);
      // Common ISO2 → ISO3 mapping for the countries we care about
      const A2A3 = {
        'AU': 'AUS', 'CN': 'CHN', 'NZ': 'NZL', 'US': 'USA', 'GB': 'GBR',
        'JP': 'JPN', 'CA': 'CAN', 'DE': 'DEU', 'FR': 'FRA', 'KR': 'KOR',
        'IT': 'ITA', 'ES': 'ESP', 'RU': 'RUS', 'BR': 'BRA', 'IN': 'IND',
        'MX': 'MEX', 'ID': 'IDN', 'TR': 'TUR', 'ZA': 'ZAF', 'AR': 'ARG',
        'CL': 'CHL', 'CH': 'CHE', 'NL': 'NLD', 'SE': 'SWE', 'NO': 'NOR',
        'FI': 'FIN', 'BE': 'BEL', 'AT': 'AUT', 'IE': 'IRL', 'EG': 'EGY',
        'MY': 'MYS', 'SG': 'SGP', 'TH': 'THA', 'VN': 'VNM', 'PH': 'PHL',
        'HK': 'HKG',
      };
      iso3 = A2A3[two] || null;
    }
    const name = p.name_en || p.name;
    if (!iso3 || !name) continue;
    if (!result[iso3]) result[iso3] = [];
    result[iso3].push({
      raw_name: name,
      area_km2: areaKm2(f),
      vertex_count: vertexCount(f.geometry),
      centroid: centroidLL(f),
      iso_3166_2: p.iso_3166_2 || null,
    });
  }
  return result;
}

// -- main comparison ------------------------------------------------------

function main() {
  console.log('Loading geoBoundaries ADM1...');
  const gb = loadGeoBoundariesAdm1();
  console.log(`  ${Object.keys(gb).length} countries`);

  console.log('Loading DataV CN...');
  const datav = loadDataV();
  console.log(`  ${datav.length} provinces`);

  console.log('Loading OSM cities...');
  const osm = loadOsm();
  console.log(`  ${Object.keys(osm).length} cities`);

  console.log('Loading Natural Earth...');
  const ne = loadNaturalEarth();
  console.log(`  ${Object.keys(ne).length} countries`);

  // Merge into a comparison per-(country, adm1) record
  const report = {
    generated_at: new Date().toISOString(),
    source_counts: {
      geoBoundaries_countries: Object.keys(gb).length,
      geoBoundaries_features: Object.values(gb).reduce((s, arr) => s + arr.length, 0),
      DataV_provinces: datav.length,
      OSM_cities: Object.keys(osm).length,
      NaturalEarth_countries: Object.keys(ne).length,
      NaturalEarth_features: Object.values(ne).reduce((s, arr) => s + arr.length, 0),
    },
    comparisons: [],
  };

  // Pass 1: iterate geoBoundaries (largest coverage) and match against NE + DataV
  for (const iso of Object.keys(gb).sort()) {
    for (const gbFeat of gb[iso]) {
      const nGb = normalizeName(gbFeat.raw_name);
      // Find matching NE
      const neFeats = (ne[iso] || []).filter((n) => normalizeName(n.raw_name) === nGb);
      // Find matching DataV (only CN)
      const datavFeats = iso === 'CHN'
        ? datav.filter((d) => normalizeName(d.en_name) === nGb)
        : [];

      const nameCandidates = [gbFeat.raw_name, ...neFeats.map((x) => x.raw_name), ...datavFeats.map((x) => x.en_name)];
      const uniqueNames = [...new Set(nameCandidates)];

      const areaCandidates = [gbFeat.area_km2, ...neFeats.map((x) => x.area_km2), ...datavFeats.map((x) => x.area_km2)]
        .filter((x) => x !== null);
      const minArea = Math.min(...areaCandidates);
      const maxArea = Math.max(...areaCandidates);
      const areaSpreadPct = areaCandidates.length > 1
        ? Math.round(((maxArea - minArea) / minArea) * 100)
        : 0;

      const sourcesPresent = [
        gbFeat ? 'geoBoundaries' : null,
        neFeats.length > 0 ? 'NaturalEarth' : null,
        datavFeats.length > 0 ? 'DataV' : null,
      ].filter(Boolean);

      let verdict;
      if (sourcesPresent.length === 1) verdict = 'single_source_only';
      else if (uniqueNames.length > 1) verdict = 'name_diff';
      else if (areaSpreadPct > 10) verdict = 'shape_diff';
      else verdict = 'consistent';

      report.comparisons.push({
        iso,
        key_name: gbFeat.raw_name,
        sources: sourcesPresent,
        verdict,
        area_spread_pct: areaSpreadPct,
        geoBoundaries: gbFeat,
        NaturalEarth: neFeats.length > 0 ? neFeats : null,
        DataV: datavFeats.length > 0 ? datavFeats : null,
      });
    }
  }

  // Summary counts
  const bucket = {};
  for (const c of report.comparisons) bucket[c.verdict] = (bucket[c.verdict] || 0) + 1;
  report.summary = bucket;

  // Write JSON
  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = path.join(OUT_DIR, 'compare-report.json');
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));

  // Write human-readable markdown
  const mdPath = path.join(OUT_DIR, 'compare-report.md');
  const mdLines = [
    '# 多源对比报告 v428',
    '',
    `Generated: ${report.generated_at}`,
    '',
    '## 数据源统计',
    '',
    `- geoBoundaries: ${report.source_counts.geoBoundaries_countries} 国, ${report.source_counts.geoBoundaries_features} 个 ADM1`,
    `- DataV (中国专用): ${report.source_counts.DataV_provinces} 省市`,
    `- OSM Overpass: ${report.source_counts.OSM_cities} 城市 (对比抽样)`,
    `- Natural Earth: ${report.source_counts.NaturalEarth_countries} 国, ${report.source_counts.NaturalEarth_features} 个 ADM1`,
    '',
    '## 判定汇总',
    '',
  ];
  for (const [k, v] of Object.entries(bucket)) mdLines.push(`- ${k}: ${v}`);
  mdLines.push('', '## 待人工判断 (name_diff + shape_diff + single_source)', '');
  mdLines.push('| ISO | Name | Verdict | Sources | Area spread% |');
  mdLines.push('|-----|------|---------|---------|--------------|');
  for (const c of report.comparisons) {
    if (c.verdict === 'consistent') continue;
    mdLines.push(`| ${c.iso} | ${c.key_name} | ${c.verdict} | ${c.sources.join(',')} | ${c.area_spread_pct}% |`);
  }
  fs.writeFileSync(mdPath, mdLines.join('\n'));

  console.log(`\nReport written:`);
  console.log(`  ${jsonPath}`);
  console.log(`  ${mdPath}`);
  console.log(`\nSummary:`);
  for (const [k, v] of Object.entries(bucket)) console.log(`  ${k}: ${v}`);
}

if (require.main === module) {
  try { require.resolve('@turf/turf'); }
  catch (e) {
    console.error('Missing @turf/turf. Run: npm install --no-save @turf/turf');
    process.exit(1);
  }
  main();
}
