const { chromium, devices } = require('playwright');
const fs = require('fs');
const testUser = JSON.parse(fs.readFileSync('C:/ClaudeCodeProjects/Cairn/scripts/r113/.testuser.json','utf8'));

(async () => {
  const b = await chromium.launch({
    headless: true,
    args: ['--disable-cache', '--disk-cache-size=0', '--media-cache-size=0'],
  });
  const ctx = await b.newContext({
    ...devices['iPhone 13'], viewport: { width: 390, height: 844 },
    bypassCSP: true,
    extraHTTPHeaders: { 'Cache-Control': 'no-cache, no-store, must-revalidate', 'Pragma': 'no-cache' },
  });
  await ctx.route('**/*', (route) => {
    const url = route.request().url();
    if (url.includes('.bundle') || url.includes('index.js')) {
      route.continue({ headers: { ...route.request().headers(), 'Cache-Control': 'no-cache' } });
    } else route.continue();
  });
  await ctx.addInitScript(() => { try { localStorage.clear(); sessionStorage.clear(); localStorage.setItem('cairn_onboarding_v1_done', 'true'); } catch {} });
  const page = await ctx.newPage();
  await page.goto('http://localhost:8082/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(5000);
  await page.getByText(/^Sign In$/i).first().tap();
  await page.waitForTimeout(3000);
  await page.locator('input').nth(0).fill(testUser.email);
  await page.locator('input').nth(1).fill(testUser.password);
  await page.getByText(/^Sign In$/i).last().tap();
  await page.waitForTimeout(6000);

  // Navigate to Routes → Cairns
  await page.evaluate(() => { try { window.__cairnStores?.navigationRef?.current?.navigate?.('Routes'); } catch {} });
  await page.waitForTimeout(2500);
  await page.getByText(/^Cairns$/i).first().tap({ timeout: 5000 }).catch(()=>{});
  await page.waitForTimeout(3000);

  await page.waitForTimeout(4000);
  const dump = await page.evaluate(() => {
    window.scrollBy(0, 500);
    // React fiber probe: find MarkCard node, extract its props
    const findMarkCardProps = () => {
      const results = [];
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
      let el;
      while ((el = walker.nextNode()) !== null) {
        const fiberKey = Object.keys(el).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactProps'));
        if (!fiberKey) continue;
        const fiber = el[fiberKey];
        if (!fiber) continue;
        // walk up fiber to find MarkCard component
        let f = fiber;
        for (let i = 0; i < 20 && f; i++) {
          const name = f.type?.displayName || f.type?.name;
          if (name === 'MarkCard') {
            const p = f.memoizedProps || {};
            const marker = p.marker || {};
            results.push({
              id: marker.id,
              type: marker.type,
              perm: marker.permission,
              noteRaw: JSON.stringify(marker.note),
              noteLen: (marker.note || '').length,
              noteFirstCharCode: (marker.note || '').charCodeAt(0),
            });
            break;
          }
          f = f.return;
        }
      }
      // Dedup by id
      const seen = new Set();
      return results.filter(r => !seen.has(r.id) && seen.add(r.id));
    };
    // Also find fiber for the DOM text "No note yet"
    const findNoteFiber = () => {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode()) !== null) {
        const t = node.nodeValue?.trim() || '';
        if (t === 'No note yet') {
          let el = node.parentElement;
          const fiberKey = el && Object.keys(el).find(k => k.startsWith('__reactFiber'));
          if (!fiberKey) continue;
          let f = el[fiberKey];
          const chain = [];
          for (let i = 0; i < 25 && f; i++) {
            const name = f.type?.displayName || f.type?.name || (typeof f.type === 'string' ? f.type : '');
            if (name) chain.push(name);
            f = f.return;
          }
          return chain;
        }
      }
      return null;
    };
    return {
      route: window.__cairnStores?.getCurrentRoute?.(),
      markCardProps: findMarkCardProps(),
      noteYetFiberChain: findNoteFiber(),
      // Manual splitTitleBody replay
      splitTest: (() => {
        const note = "\u001eA note-only cairn with no title.";
        const sepIdx = note.indexOf('\u001e');
        const title = sepIdx !== -1 ? note.slice(0, sepIdx) : note;
        const body = sepIdx !== -1 ? note.slice(sepIdx+1) : '';
        const displayTitle = title ? title : (body ? body.slice(0, 30) : 'Untitled cairn');
        return { sepIdx, title, body, displayTitle };
      })(),
    };
  });
  console.log(JSON.stringify(dump, null, 2));
  await b.close();
})();
