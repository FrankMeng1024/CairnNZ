// 验证 map.yiiling.cn/flows 链路：
// 1. 打开页面
// 2. 检查 data.json 是否加载
// 3. 检查顶部计数条
// 4. 点一个 AI pill 看能否显示 tooltip + 截图
// 5. 截图页面证明

const { chromium, devices } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();

  const errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));

  console.log('[1] navigating to map.yiiling.cn/flows...');
  await page.goto('https://map.yiiling.cn/flows/index.html', { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(3000);

  console.log('[2] page loaded, console errors:', errors.length);
  if (errors.length) console.log(' ', errors.slice(0, 3));

  console.log('[3] checking data.json fetched...');
  const dataState = await page.evaluate(() => {
    return {
      hasData: typeof window.DATA !== 'undefined',
      screens: window.DATA?.screens?.length || 0,
      firstScreenRows: window.DATA?.screens?.[0]?.rows?.length || 0,
      firstAiStatus: window.DATA?.screens?.[0]?.rows?.[0]?.ai_status || null,
    };
  });
  console.log(' ', JSON.stringify(dataState));

  console.log('[4] checking top stat bar renders...');
  const statBar = await page.evaluate(() => {
    const el = document.querySelector('.page-progress');
    return el ? el.innerText.slice(0, 200) : null;
  });
  console.log(' stat bar:', statBar);

  console.log('[5] find first AI pill + click it...');
  await page.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1/_map-before-click.png', fullPage: false });
  const aiPills = await page.locator('.status-pill.readonly').count();
  console.log(' AI pill count:', aiPills);

  if (aiPills > 0) {
    // Click the first AI pill that has evidence (has-evidence class)
    const withEvidence = page.locator('.status-pill.readonly.has-evidence').first();
    const hasEvidenceCount = await page.locator('.status-pill.readonly.has-evidence').count();
    console.log(' AI pills with evidence:', hasEvidenceCount);

    if (hasEvidenceCount > 0) {
      await withEvidence.click({ timeout: 5000 });
      await page.waitForTimeout(1500);

      console.log('[6] tooltip visible after click?');
      const tooltipVisible = await page.evaluate(() => {
        const t = document.querySelector('.status-pill.pinned .evidence-tooltip');
        return t ? {
          display: getComputedStyle(t).display,
          content: t.innerText.slice(0, 200),
          shotCount: t.querySelectorAll('.shot').length,
          imgSrc: t.querySelector('.shot img')?.getAttribute('src'),
        } : null;
      });
      console.log(' ', JSON.stringify(tooltipVisible, null, 2));

      await page.screenshot({ path: 'C:/ClaudeCodeProjects/Cairn/docs/qa/user-flows-round-1/_map-after-click.png', fullPage: false });
      console.log('[7] screenshot saved: _map-after-click.png');
    } else {
      console.log('!!! No AI pill has-evidence class → tooltip data missing');
    }
  }

  await browser.close();
  console.log('\nDONE. Check _map-before-click.png and _map-after-click.png for visual proof.');
})();
