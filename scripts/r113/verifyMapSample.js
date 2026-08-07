// 采样 20 个 case 的 pill，验证：
// 1. 每 case ai_reason 中英文比例
// 2. 每 case 截图 URL 是否指向不同文件（不是同一张）
// 3. 缩略图能否加载
const { chromium, devices } = require('playwright');
const crypto = require('crypto');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  await page.goto('https://map.yiiling.cn/flows/index.html', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  // Get the raw data.json served from aliyun
  const dataStats = await page.evaluate(async () => {
    // The page fetches data.json into a module-level var; grab it via API call
    const resp = await fetch('/flows/data.json');
    const data = await resp.json();
    const all = data.screens.flatMap(s => s.rows);
    const zh = all.filter(r => /[\u4e00-\u9fa5]/.test(r.ai_reason || ''));
    const en = all.filter(r => (r.ai_reason || '').startsWith('R5 '));
    const shots = all.map(r => (r.ai_screenshots || [])[0]).filter(Boolean);
    const uniqueShotUrls = new Set(shots);
    return {
      total: all.length,
      chinese_reasons: zh.length,
      english_R5_reasons: en.length,
      total_shot_refs: shots.length,
      unique_shot_urls: uniqueShotUrls.size,
      first_5_shots: shots.slice(0, 5),
      first_5_reasons: all.slice(0, 5).map(r => ({ id: r.id, reason: (r.ai_reason || '').slice(0, 80) })),
    };
  });
  console.log('data.json served from aliyun:');
  console.log(JSON.stringify(dataStats, null, 2));

  // Now download ~20 case screenshots and MD5-hash them to prove they're different
  console.log('\nDownloading + hashing 20 sample screenshots...');
  const sample_ids = ['N01', 'N02', 'N03', 'L01', 'L03', 'L07', 'H01', 'H15', 'H21', 'K01', 'R02', 'M01', 'E01', 'C09', 'F01', 'S08', 'S12', 'V29', 'A01', 'G01'];
  const hashes = {};
  for (const id of sample_ids) {
    const url = `https://map.yiiling.cn/flows/screenshots/round-1/${id}-1.png`;
    const buf = await page.evaluate(async (u) => {
      const r = await fetch(u);
      if (!r.ok) return null;
      const ab = await r.arrayBuffer();
      return Array.from(new Uint8Array(ab));
    }, url);
    if (buf) {
      const hash = crypto.createHash('md5').update(Buffer.from(buf)).digest('hex').slice(0, 12);
      const size = buf.length;
      hashes[id] = { hash, size };
    } else {
      hashes[id] = { hash: 'FETCH_FAILED', size: 0 };
    }
  }
  const uniqueHashes = new Set(Object.values(hashes).map(h => h.hash));
  console.log('20 sample cases: unique hashes =', uniqueHashes.size, '/ 20');
  console.log('per-case hash:', JSON.stringify(hashes, null, 2));

  await browser.close();
})();
