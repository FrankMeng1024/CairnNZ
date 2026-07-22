#!/usr/bin/env node
/**
 * download-geoboundaries.js — v428
 *
 * Downloads geoBoundaries CGAZ simplified GeoJSON for ADM0 (countries) and
 * ADM1 (states/regions/provinces) into ./tmp/ for the seed script.
 *
 * geoBoundaries API returns metadata JSON per (ISO, ADM_LEVEL); we read
 * the `simplifiedGeometryGeoJSON` URL from each and download.
 *
 * Data source: https://www.geoboundaries.org/
 * License: CC-BY 4.0 (commercial-friendly)
 *
 * Storage after download:
 *   tmp/adm0-world.geojson          (all countries, ~5 MB)
 *   tmp/adm1/{ISO}.geojson          (one file per country, most ~50-500 KB)
 *
 * Total downloaded: ~50-100 MB.
 *
 * Usage:
 *   node backend/scripts/seed-geoboundaries/download.js
 *   node backend/scripts/seed-geoboundaries/download.js --only NZL,CHN,USA
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, 'tmp');
const ADM1_DIR = path.join(OUT_DIR, 'adm1');

// Common ISO 3166-1 alpha-3 country codes (subset for MVP; --all runs full 250)
const DEFAULT_ISOS = [
  // Cairn primary markets
  'NZL', 'CHN', 'AUS', 'JPN', 'USA', 'GBR', 'CAN', 'DEU', 'FRA', 'KOR',
  // Southeast Asia
  'MYS', 'SGP', 'THA', 'VNM', 'IDN', 'PHL',
  // Additional common travel destinations
  'ITA', 'ESP', 'NLD', 'CHE', 'SWE', 'NOR', 'FIN', 'BEL', 'AUT', 'IRL',
  'BRA', 'ARG', 'CHL', 'MEX', 'IND', 'ZAF', 'EGY', 'TUR', 'RUS', 'HKG',
];

// -- helpers --------------------------------------------------------------

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse ${url}: ${e.message}`)); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function fetchToFile(url, outPath) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      https.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          doGet(res.headers.location);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} for ${u}`));
          return;
        }
        const file = fs.createWriteStream(outPath);
        res.pipe(file);
        file.on('finish', () => file.close(() => resolve(fs.statSync(outPath).size)));
        file.on('error', reject);
      }).on('error', reject);
    };
    doGet(url);
  });
}

// -- main -----------------------------------------------------------------

async function downloadAdm0() {
  const outFile = path.join(OUT_DIR, 'adm0-world.geojson');
  const metaFile = path.join(OUT_DIR, 'adm0-metadata.json');
  if (fs.existsSync(outFile) && fs.existsSync(metaFile)) {
    const size = fs.statSync(outFile).size;
    console.log(`[ADM0] cached: ${outFile} (${(size / 1024).toFixed(0)} KB)`);
    return;
  }
  console.log('[ADM0] fetching metadata list (all countries)...');
  const list = await fetchJson('https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM0/');
  if (!Array.isArray(list)) throw new Error('ADM0 ALL did not return array');
  console.log(`[ADM0] ${list.length} country entries`);

  // Save metadata (has Continent, name, ISO) for seed script
  fs.writeFileSync(metaFile, JSON.stringify(list, null, 2));
  console.log(`[ADM0] metadata saved: ${metaFile}`);

  // Download each ADM0 country GeoJSON, merge into one FeatureCollection
  const merged = { type: 'FeatureCollection', features: [] };
  let done = 0;
  for (const entry of list) {
    const url = entry.simplifiedGeometryGeoJSON;
    if (!url) continue;
    try {
      const gj = await fetchJson(url);
      const feats = gj.features || (gj.type === 'Feature' ? [gj] : []);
      for (const f of feats) {
        // Enrich properties with metadata we need at seed time
        f.properties = {
          ...(f.properties || {}),
          shapeISO: entry.boundaryISO,
          continent: entry.Continent,
        };
        merged.features.push(f);
      }
      done++;
      if (done % 20 === 0) console.log(`[ADM0] ${done}/${list.length} downloaded`);
    } catch (e) {
      console.warn(`[ADM0] ${entry.boundaryISO} failed: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  fs.writeFileSync(outFile, JSON.stringify(merged));
  const size = fs.statSync(outFile).size;
  console.log(`[ADM0] merged file saved: ${outFile} (${(size / 1024 / 1024).toFixed(1)} MB, ${merged.features.length} features)`);
}

async function downloadAdm1(iso) {
  const outFile = path.join(ADM1_DIR, `${iso}.geojson`);
  if (fs.existsSync(outFile)) {
    const size = fs.statSync(outFile).size;
    console.log(`[ADM1 ${iso}] cached (${(size / 1024).toFixed(0)} KB)`);
    return { iso, cached: true, size };
  }
  try {
    const meta = await fetchJson(`https://www.geoboundaries.org/api/current/gbOpen/${iso}/ADM1/`);
    const url = meta.simplifiedGeometryGeoJSON;
    if (!url) {
      console.warn(`[ADM1 ${iso}] no simplifiedGeometryGeoJSON URL`);
      return { iso, error: 'no-url' };
    }
    const size = await fetchToFile(url, outFile);
    console.log(`[ADM1 ${iso}] downloaded (${(size / 1024).toFixed(0)} KB)`);
    return { iso, size };
  } catch (e) {
    console.error(`[ADM1 ${iso}] failed: ${e.message}`);
    return { iso, error: e.message };
  }
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(ADM1_DIR);

  const args = process.argv.slice(2);
  const onlyIdx = args.indexOf('--only');
  const allFlag = args.includes('--all');
  let isos = DEFAULT_ISOS;
  if (onlyIdx >= 0 && args[onlyIdx + 1]) {
    isos = args[onlyIdx + 1].split(',').map((s) => s.trim().toUpperCase());
    console.log(`[main] --only override: ${isos.join(', ')}`);
  }
  if (allFlag) {
    // Load metadata to get every ISO from ADM0 list
    const metaPath = path.join(OUT_DIR, 'adm0-metadata.json');
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      isos = meta.map((m) => m.boundaryISO).filter(Boolean);
      console.log(`[main] --all: ${isos.length} countries from ADM0 metadata`);
    } else {
      console.error('[main] --all requires adm0-metadata.json; run without --all first to populate.');
    }
  }

  console.log(`\n=== geoBoundaries download (v428) ===`);
  console.log(`ISOs: ${isos.length} countries`);
  console.log(`Output: ${OUT_DIR}\n`);

  // ADM0 all countries in one file
  await downloadAdm0();

  // ADM1 per country (sequential to be nice to geoBoundaries API)
  const results = [];
  for (const iso of isos) {
    results.push(await downloadAdm1(iso));
    await new Promise((r) => setTimeout(r, 200)); // 200ms pause
  }

  console.log('\n=== summary ===');
  const ok = results.filter((r) => !r.error);
  const fail = results.filter((r) => r.error);
  console.log(`OK: ${ok.length}, FAIL: ${fail.length}`);
  if (fail.length) {
    console.log('Failed ISOs:');
    fail.forEach((f) => console.log(`  ${f.iso}: ${f.error}`));
  }
  const totalMB = ok.reduce((s, r) => s + (r.size || 0), 0) / 1024 / 1024;
  console.log(`Total ADM1: ${totalMB.toFixed(1)} MB`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
