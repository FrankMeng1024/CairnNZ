#!/usr/bin/env node
/**
 * download-osm.js — v428
 *
 * OSM Overpass API 拉全球主要城市的 polygon 边界。
 * OSM 是社区维护的地图,和 geoBoundaries / DataV 是独立数据源,用作对比。
 *
 * 注意: Overpass API 限速 (每 IP 每分钟 ~1 GB, 每查询 30 秒)。
 * 每查询之间加 pause。
 *
 * Strategy:
 *   - 用 admin_level 查询: 4=国家二级 (省/州), 6=市级, 8=区级
 *   - 具体每个国家 admin_level 语义不同,但 boundary=administrative 都是行政区
 *   - 我们查每个"想要的城市"的名字 + 位置 (Overpass around)
 *
 * v428 用途: 拿"简单查询"验证的城市,主要是难对齐的大都会
 *   London, New York City, Sydney, Melbourne, Paris, Tokyo, Beijing, Shanghai, ...
 *
 * Output:
 *   tmp/osm/{name-slug}.geojson
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, 'tmp', 'osm');

// 关键要对比的城市清单
// 每条: { slug, name, admin_level, iso, lat, lng }
// - admin_level 用 OSM 的规则,英美 4=州, 中日 4=省, 5-6=市, 8=区
// - lat/lng 用于 around: 5000 米搜索
const CITIES = [
  // NZ - 目标市场
  { slug: 'nz-auckland',    name: 'Auckland',            admin_level: 4, iso: 'NZ', lat: -36.85, lng: 174.76 },
  { slug: 'nz-wellington-region', name: 'Wellington',    admin_level: 4, iso: 'NZ', lat: -41.29, lng: 174.78 },
  { slug: 'nz-wellington-city', name: 'Wellington City', admin_level: 6, iso: 'NZ', lat: -41.29, lng: 174.78 },
  { slug: 'nz-canterbury',  name: 'Canterbury',          admin_level: 4, iso: 'NZ', lat: -43.5,  lng: 172.6 },
  { slug: 'nz-christchurch',name: 'Christchurch City',   admin_level: 6, iso: 'NZ', lat: -43.53, lng: 172.63 },

  // UK - 大都会 vs 州
  { slug: 'uk-england',     name: 'England',             admin_level: 4, iso: 'GB', lat: 51.5,   lng: -1.0 },
  { slug: 'uk-greater-london', name: 'Greater London',   admin_level: 5, iso: 'GB', lat: 51.5,   lng: -0.13 },
  { slug: 'uk-scotland',    name: 'Scotland',            admin_level: 4, iso: 'GB', lat: 56.5,   lng: -4.0 },

  // US - 州 vs 市 (NYC 特例)
  { slug: 'us-ny-state',    name: 'New York',            admin_level: 4, iso: 'US', lat: 42.9,   lng: -75.5 },
  { slug: 'us-nyc',         name: 'New York City',       admin_level: 5, iso: 'US', lat: 40.71,  lng: -74.00 },
  { slug: 'us-california',  name: 'California',          admin_level: 4, iso: 'US', lat: 36.7,   lng: -119.4 },
  { slug: 'us-los-angeles', name: 'Los Angeles',         admin_level: 8, iso: 'US', lat: 34.05,  lng: -118.25 },
  { slug: 'us-san-francisco', name: 'San Francisco',    admin_level: 6, iso: 'US', lat: 37.77,  lng: -122.42 },

  // AU - 州 vs 大都会
  { slug: 'au-nsw',         name: 'New South Wales',     admin_level: 4, iso: 'AU', lat: -33.0,  lng: 148.0 },
  { slug: 'au-sydney',      name: 'Sydney',              admin_level: 5, iso: 'AU', lat: -33.87, lng: 151.21 },
  { slug: 'au-victoria',    name: 'Victoria',            admin_level: 4, iso: 'AU', lat: -37.0,  lng: 145.0 },
  { slug: 'au-melbourne',   name: 'Melbourne',           admin_level: 7, iso: 'AU', lat: -37.81, lng: 144.96 },

  // CN - 上海 vs 上海市
  { slug: 'cn-shanghai',    name: 'Shanghai',            admin_level: 4, iso: 'CN', lat: 31.23,  lng: 121.47 },
  { slug: 'cn-beijing',     name: 'Beijing',             admin_level: 4, iso: 'CN', lat: 39.90,  lng: 116.40 },
  { slug: 'cn-guangdong',   name: 'Guangdong',           admin_level: 4, iso: 'CN', lat: 23.0,   lng: 113.0 },

  // JP - 都道府県 vs 市
  { slug: 'jp-tokyo',       name: 'Tokyo',               admin_level: 4, iso: 'JP', lat: 35.68,  lng: 139.69 },
  { slug: 'jp-osaka-fu',    name: 'Osaka',               admin_level: 4, iso: 'JP', lat: 34.68,  lng: 135.52 },
  { slug: 'jp-osaka-shi',   name: 'Osaka City',          admin_level: 7, iso: 'JP', lat: 34.68,  lng: 135.52 },
  { slug: 'jp-kyoto-fu',    name: 'Kyoto',               admin_level: 4, iso: 'JP', lat: 35.01,  lng: 135.77 },

  // FR
  { slug: 'fr-idf',         name: 'Île-de-France',       admin_level: 4, iso: 'FR', lat: 48.7,   lng: 2.5 },
  { slug: 'fr-paris',       name: 'Paris',               admin_level: 8, iso: 'FR', lat: 48.86,  lng: 2.35 },
];

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function postOverpass(query) {
  return new Promise((resolve, reject) => {
    const body = `data=${encodeURIComponent(query)}`;
    const req = https.request(OVERPASS_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'cairn-v428-multisource/1.0',
      },
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`JSON parse: ${e.message}`)); }
      });
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function downloadCity(city) {
  const outFile = path.join(OUT_DIR, `${city.slug}.geojson`);
  if (fs.existsSync(outFile)) {
    console.log(`[${city.slug}] cached`);
    return { slug: city.slug, cached: true };
  }
  // Overpass query: relation with boundary=administrative, admin_level, name-like, near coord
  // Use `is_in` at the coord to find containing admin relations, then filter by name.
  // This is more robust than name-search.
  const q = `
[out:json][timeout:60];
(
  relation["boundary"="administrative"]["admin_level"="${city.admin_level}"]["name:en"~"${escapeName(city.name)}", i](around:1000,${city.lat},${city.lng});
  relation["boundary"="administrative"]["admin_level"="${city.admin_level}"]["name"~"${escapeName(city.name)}", i](around:1000,${city.lat},${city.lng});
);
out geom;
  `.trim();
  try {
    const data = await postOverpass(q);
    if (!data.elements || data.elements.length === 0) {
      console.log(`[${city.slug}] no relation found`);
      fs.writeFileSync(outFile.replace('.geojson', '.empty.txt'), 'no results\n' + q);
      return { slug: city.slug, error: 'no-results' };
    }
    fs.writeFileSync(outFile, JSON.stringify(data));
    const size = fs.statSync(outFile).size;
    console.log(`[${city.slug}] ${data.elements.length} relations, ${(size / 1024).toFixed(0)} KB`);
    return { slug: city.slug, size, count: data.elements.length };
  } catch (e) {
    console.error(`[${city.slug}] failed: ${e.message}`);
    return { slug: city.slug, error: e.message };
  }
}

function escapeName(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function main() {
  ensureDir(OUT_DIR);
  console.log(`=== OSM Overpass download (v428) — ${CITIES.length} cities ===\n`);
  const results = [];
  for (const c of CITIES) {
    results.push(await downloadCity(c));
    await new Promise((r) => setTimeout(r, 3000)); // 3s pause - Overpass polite
  }
  const ok = results.filter((r) => !r.error);
  console.log(`\n=== summary: ${ok.length}/${results.length} ok ===`);
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
