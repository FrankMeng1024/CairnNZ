#!/usr/bin/env node
/**
 * download-datav.js — v428
 *
 * DataV.阿里云 是官方中国行政区划边界数据,精准 + 免费 + 合规。
 * URL 规律: https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json
 *
 * Levels:
 *   100000_full.json          = 全国 (含省级边界)
 *   {province adcode}_full.json  = 省 (含市级边界)  e.g. 310000 = 上海市
 *   {city adcode}_full.json      = 市 (含区县级边界)  e.g. 310100 = 上海市市辖区
 *
 * v428 只需要省级 (ADM1) 的边界数据,单独存每个省一个文件。
 *
 * Output:
 *   tmp/datav/china-all.geojson    全国 (含 34 省市直辖市 polygons)
 *   tmp/datav/province/{adcode}.geojson  每个省单独文件 (含下辖市)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const OUT_DIR = path.join(__dirname, 'tmp', 'datav');
const PROVINCE_DIR = path.join(OUT_DIR, 'province');

// 34 省市自治区 adcode (来源: DataV 文档 https://datav.aliyun.com/portal/school/atlas/area_selector)
const PROVINCES = [
  ['110000', 'Beijing'],       ['120000', 'Tianjin'],
  ['130000', 'Hebei'],         ['140000', 'Shanxi'],
  ['150000', 'Inner Mongolia'],
  ['210000', 'Liaoning'],      ['220000', 'Jilin'],
  ['230000', 'Heilongjiang'],
  ['310000', 'Shanghai'],      ['320000', 'Jiangsu'],
  ['330000', 'Zhejiang'],      ['340000', 'Anhui'],
  ['350000', 'Fujian'],        ['360000', 'Jiangxi'],
  ['370000', 'Shandong'],
  ['410000', 'Henan'],         ['420000', 'Hubei'],
  ['430000', 'Hunan'],         ['440000', 'Guangdong'],
  ['450000', 'Guangxi'],       ['460000', 'Hainan'],
  ['500000', 'Chongqing'],
  ['510000', 'Sichuan'],       ['520000', 'Guizhou'],
  ['530000', 'Yunnan'],        ['540000', 'Tibet'],
  ['610000', 'Shaanxi'],       ['620000', 'Gansu'],
  ['630000', 'Qinghai'],       ['640000', 'Ningxia'],
  ['650000', 'Xinjiang'],
  ['710000', 'Taiwan'],
  ['810000', 'Hong Kong'],     ['820000', 'Macao'],
];

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function fetchToFile(url, outPath) {
  return new Promise((resolve, reject) => {
    const doGet = (u) => {
      https.get(u, { headers: { 'User-Agent': 'cairn-v428-seed/1.0' } }, (res) => {
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

async function downloadNational() {
  const outFile = path.join(OUT_DIR, 'china-all.geojson');
  if (fs.existsSync(outFile)) {
    console.log(`[national] cached: ${(fs.statSync(outFile).size / 1024).toFixed(0)} KB`);
    return;
  }
  const url = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';
  const size = await fetchToFile(url, outFile);
  console.log(`[national] downloaded: ${(size / 1024).toFixed(0)} KB`);
}

async function downloadProvince(adcode, en_name) {
  const outFile = path.join(PROVINCE_DIR, `${adcode}.geojson`);
  const boundaryFile = path.join(PROVINCE_DIR, `${adcode}-boundary.geojson`);
  const needFull = !fs.existsSync(outFile);
  const needBoundary = !fs.existsSync(boundaryFile);
  if (!needFull && !needBoundary) {
    const size = fs.statSync(outFile).size + fs.statSync(boundaryFile).size;
    console.log(`[${adcode} ${en_name}] cached both (${(size / 1024).toFixed(0)} KB)`);
    return { adcode, cached: true, size };
  }
  const results = [];
  try {
    if (needFull) {
      const url = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}_full.json`;
      const size = await fetchToFile(url, outFile);
      results.push(`full=${(size / 1024).toFixed(0)}KB`);
      await new Promise((r) => setTimeout(r, 100));
    }
    if (needBoundary) {
      // v428 use: this file has ONLY the province's own polygon (not children)
      const url = `https://geo.datav.aliyun.com/areas_v3/bound/${adcode}.json`;
      const size = await fetchToFile(url, boundaryFile);
      results.push(`boundary=${(size / 1024).toFixed(0)}KB`);
    }
    console.log(`[${adcode} ${en_name}] ${results.join(', ')}`);
    return { adcode, size: fs.statSync(outFile).size + fs.statSync(boundaryFile).size };
  } catch (e) {
    console.error(`[${adcode} ${en_name}] failed: ${e.message}`);
    return { adcode, error: e.message };
  }
}

async function main() {
  ensureDir(OUT_DIR);
  ensureDir(PROVINCE_DIR);

  console.log('=== DataV download (v428) ===\n');
  await downloadNational();

  console.log('\n[provinces]');
  const results = [];
  for (const [adcode, en_name] of PROVINCES) {
    results.push(await downloadProvince(adcode, en_name));
    await new Promise((r) => setTimeout(r, 150));
  }

  const ok = results.filter((r) => !r.error);
  const fail = results.filter((r) => r.error);
  const totalMB = ok.reduce((s, r) => s + (r.size || 0), 0) / 1024 / 1024;
  console.log(`\n=== summary ===`);
  console.log(`OK: ${ok.length}, FAIL: ${fail.length}`);
  console.log(`Total: ${totalMB.toFixed(1)} MB`);
  if (fail.length) {
    console.log('Failed:');
    fail.forEach((f) => console.log(`  ${f.adcode}: ${f.error}`));
  }
}

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
