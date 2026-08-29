import { chromium } from 'playwright';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'action-icon-exploration-gate');
fs.mkdirSync(outputDir, { recursive: true });

const families = [
  {
    id: 'family-a',
    label: 'FAMILY A · OPERATIONAL PICTOGRAMS',
    strokeWidth: 1.8,
    icons: {
      hiking: '<circle cx="9" cy="4.6" r="1.35"/><path d="M8.2 7.2 12 10l2.1 4.2M8.4 7.6 6.1 11l-2.5 1.5M11.8 10.1 9.7 15l-3.6 5M9.7 15l4.7 4.5M14.2 8.7 18 20M3 21l18-5.2"/><path d="M7.6 7.8c-1.4-.2-2.3.6-2.5 2.1"/>',
      running: '<circle cx="15.2" cy="4.5" r="1.35"/><path d="m13.9 7.3-3.6 4.2 4.1 2.4 4.2 5.2M13.1 8.2l3.2 2.5 3.2-1.4M14.4 13.9l-4.2 1.4-3.7 4.5M3 9h4M2.5 13h3.3"/>',
      leaveCairn: '<path d="M12 3.2v5.1m-2.1-2.1L12 8.3l2.1-2.1M6 19.5c.4-2 1.6-3 3.3-3h5.4c1.7 0 2.9 1 3.3 3ZM8 15.1c.3-1.7 1.3-2.6 2.7-2.6h2.6c1.4 0 2.4.9 2.7 2.6ZM10.1 11.2c.2-1.4.9-2.1 1.9-2.1s1.7.7 1.9 2.1Z"/><path d="M4 21h16"/>',
    },
  },
  {
    id: 'family-b',
    label: 'FAMILY B · PREMIUM CONTOUR ROUTES',
    strokeWidth: 1.65,
    icons: {
      hiking: '<path d="M3.5 18.8 8.8 8.2l3.2 4.1 2.4-3.1 6.1 9.6M4.2 20.5h15.6"/><path d="M6.3 18.7c1.2-3.2 5.5-2.5 5.6-5.6.1-1.6-1.8-2-1.6-3.4"/><circle cx="10.3" cy="9.7" r=".85" fill="currentColor" stroke="none"/><path d="M15.2 12.2c1.3.3 2.4 1.1 3.3 2.4" opacity=".55"/>',
      running: '<path d="M3.2 17.8c3.4 0 4.4-9.5 9.4-9.5 3.2 0 5.4 1.7 8.1 4.5M4.4 20.6c3.3-1.2 4.7-7.8 8.8-7.8 2.4 0 4 1 5.8 2.7"/><path d="m17.8 9.8 2.9 3-4.1.6"/><circle cx="3.2" cy="17.8" r=".9" fill="currentColor" stroke="none"/>',
      leaveCairn: '<path d="M4.2 17.8c2.9-2.6 5.5-3.1 7.8-1.4 2.3 1.7 4.9 1.2 7.8-1.4" opacity=".55"/><path d="M6.2 20c.3-1.7 1.4-2.6 3-2.6h5.6c1.6 0 2.7.9 3 2.6ZM8.2 16c.3-1.5 1.2-2.3 2.5-2.3h2.6c1.3 0 2.2.8 2.5 2.3ZM10.3 12.3c.2-1.3.8-2 1.7-2s1.5.7 1.7 2Z"/><path d="M12 3.4v4.2m-1.8-1.7L12 7.7l1.8-1.8"/>',
    },
  },
  {
    id: 'family-c',
    label: 'FAMILY C · CAIRNNZ FIELD MARKS',
    strokeWidth: 1.75,
    icons: {
      hiking: '<path d="M5.1 6.2A8.7 8.7 0 0 1 19.5 8M19 17.1A8.7 8.7 0 0 1 5 17.6" opacity=".55"/><path d="m5.2 17.6 4.4-8.5 2.7 3.4 2.1-2.6 4.5 7.7M8 17.6c.7-2.3 3.8-2.1 3.9-4.3"/><circle cx="11.9" cy="13.3" r=".75" fill="currentColor" stroke="none"/>',
      running: '<path d="M5.1 6.2A8.7 8.7 0 0 1 19.5 8M19 17.1A8.7 8.7 0 0 1 5 17.6" opacity=".55"/><path d="M4.4 15.9c2.8 0 3.9-7 7.9-7 2.9 0 4.6 1.4 7.2 3.8M5.8 19.2c2.8-1 4-6.1 7.3-6.1 2 0 3.5.8 5 2.2"/><path d="m17 9.8 2.5 2.9-3.8.3"/>',
      leaveCairn: '<path d="M5.1 6.2A8.7 8.7 0 0 1 19.5 8M19 17.1A8.7 8.7 0 0 1 5 17.6" opacity=".55"/><path d="M5.8 19.2c.3-1.6 1.4-2.5 2.9-2.5h6.6c1.5 0 2.6.9 2.9 2.5ZM8 15.4c.2-1.5 1.2-2.3 2.5-2.3h3c1.3 0 2.3.8 2.5 2.3ZM10.2 11.8c.2-1.3.9-2 1.8-2s1.6.7 1.8 2Z"/><path d="M12 4v3.2"/>',
    },
  },
];

const iconLabels = { hiking: 'HIKING', running: 'RUNNING', leaveCairn: 'LEAVE A CAIRN' };

function iconSvg(family, icon, color, width, height, padding = 0) {
  const innerWidth = Math.max(1, width - padding * 2);
  const innerHeight = Math.max(1, height - padding * 2);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><g transform="translate(${padding} ${padding}) scale(${innerWidth / 24} ${innerHeight / 24})" fill="none" stroke="${color}" color="${color}" stroke-width="${family.strokeWidth}" stroke-linecap="round" stroke-linejoin="round">${family.icons[icon]}</g></svg>`);
}

for (const family of families) {
  const familyDir = path.join(outputDir, family.id);
  fs.mkdirSync(familyDir, { recursive: true });
  for (const icon of Object.keys(iconLabels)) {
    fs.writeFileSync(path.join(familyDir, `${icon === 'leaveCairn' ? 'leave-a-cairn' : icon}.svg`), iconSvg(family, icon, '#29483E', 240, 240, 18));
  }
}

async function enlargedSheet() {
  const cellWidth = 360;
  const cellHeight = 300;
  const composites = [];
  for (let row = 0; row < families.length; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const icon = Object.keys(iconLabels)[column];
      const left = column * cellWidth;
      const top = row * cellHeight;
      composites.push({ input: iconSvg(families[row], icon, '#29483E', 132, 132, 8), left: left + 114, top: top + 74 });
      composites.push({ input: Buffer.from(`<svg width="${cellWidth}" height="${cellHeight}"><rect width="${cellWidth}" height="${cellHeight}" fill="#F4F2EC"/><rect x="24" y="44" width="312" height="188" rx="28" fill="#E2E8E0" stroke="#C9D3CB"/><text x="180" y="27" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">${families[row].label}</text><text x="180" y="268" text-anchor="middle" font-family="Arial" font-size="15" font-weight="700" fill="#40534C">${iconLabels[icon]}</text></svg>`), left, top });
      // Re-add the icon above the cell artwork.
      composites.push({ input: iconSvg(families[row], icon, '#29483E', 132, 132, 8), left: left + 114, top: top + 74 });
    }
  }
  await sharp({ create: { width: cellWidth * 3, height: cellHeight * 3, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'action-icon-families-enlarged.jpg'));
}

async function homeSizeSheet() {
  const width = 390;
  const rowHeight = 132;
  const composites = [];
  for (let row = 0; row < families.length; row += 1) {
    const top = row * rowHeight;
    composites.push({ input: Buffer.from(`<svg width="390" height="132"><rect width="390" height="132" fill="#F4F2EC"/><text x="195" y="23" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#243B34">${families[row].label}</text></svg>`), left: 0, top });
    for (let column = 0; column < 3; column += 1) {
      const icon = Object.keys(iconLabels)[column];
      const left = 24 + column * 113;
      composites.push({ input: Buffer.from('<svg width="101" height="90"><rect x=".5" y=".5" width="100" height="89" rx="18" fill="#E4E8E1" stroke="#C8D2CA"/></svg>'), left, top: top + 32 });
      composites.push({ input: iconSvg(families[row], icon, '#29483E', 29, 29, 1), left: left + 36, top: top + 43 });
      composites.push({ input: Buffer.from(`<svg width="101" height="26"><text x="50.5" y="17" text-anchor="middle" font-family="Arial" font-size="${icon === 'leaveCairn' ? 10 : 11}" font-weight="600" fill="#243B34">${icon === 'leaveCairn' ? 'Leave a Cairn' : iconLabels[icon][0] + iconLabels[icon].slice(1).toLowerCase()}</text></svg>`), left, top: top + 88 });
    }
  }
  await sharp({ create: { width, height: rowHeight * 3, channels: 3, background: '#F4F2EC' } })
    .composite(composites)
    .jpeg({ quality: 95, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, 'action-icon-families-home-size.jpg'));
}

await enlargedSheet();
await homeSizeSheet();

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--disable-web-security'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'en-NZ' });
const page = await context.newPage();
await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'action-icon-family-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_action-icon-family-qa', 'true');
});
const qaUser = { id: 'action-icon-family-qa', name: 'Aroha', email: 'icon.qa@example.com', createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'] };
await page.route('**/api/**', async route => {
  if (route.request().url().includes('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: qaUser }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], count: 0 }) });
});
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore?.getState().hydrated && globalThis.__cairnStores?.useSettingsStore?.getState().hydrated), null, { timeout: 120_000 });
await page.evaluate(user => globalThis.__cairnStores.useAppStore.setState({ user, isLoggedIn: true }), qaUser);

const timeColors = { day: '#29483E', sunset: '#EFE5D9', night: '#DCE7E7' };
for (const time of ['day', 'sunset', 'night']) {
  await page.evaluate(selectedTime => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: selectedTime, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.navigationRef.navigate('Home');
  }, time);
  await page.waitForTimeout(1100);
  const boxes = await page.evaluate(() => {
    const labels = ['Hiking', 'Running', 'Leave a Cairn'];
    return labels.map(label => {
      const textNode = Array.from(document.querySelectorAll('*')).find(element => element.children.length === 0 && element.textContent?.trim() === label);
      let container = textNode?.parentElement;
      while (container && !container.querySelector('svg')) container = container.parentElement;
      const svg = container?.querySelector('svg');
      if (!svg) throw new Error(`Missing Home action SVG: ${label}`);
      const rect = svg.getBoundingClientRect();
      svg.style.opacity = '0';
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
  });
  const cleanHome = await page.screenshot({ fullPage: false });
  const previews = [];
  for (const family of families) {
    const composites = boxes.map((box, index) => ({
      input: iconSvg(family, Object.keys(iconLabels)[index], timeColors[time], Math.round(box.width), Math.round(box.height), 1),
      left: Math.round(box.x),
      top: Math.round(box.y),
    }));
    previews.push(await sharp(cleanHome).composite(composites).png().toBuffer());
  }
  const sheetComposites = [];
  for (let index = 0; index < previews.length; index += 1) {
    const left = index * 390;
    sheetComposites.push({ input: previews[index], left, top: 40 });
    sheetComposites.push({ input: Buffer.from(`<svg width="390" height="40"><rect width="390" height="40" fill="#F4F2EC"/><text x="195" y="26" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">${families[index].label}</text></svg>`), left, top: 0 });
  }
  await sharp({ create: { width: 1170, height: 884, channels: 3, background: '#F4F2EC' } })
    .composite(sheetComposites)
    .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
    .toFile(path.join(outputDir, `action-icon-${time}-home-preview.jpg`));
}
await browser.close();

fs.writeFileSync(path.join(outputDir, 'README.md'), `# Home action-icon exploration\n\nThese are review-only vectors and previews. No family is wired into Home.\n\n- Family A: operational human-action pictograms. Highest immediate Hiking/Running distinction; the placement arrow keeps Leave a Cairn task-oriented.\n- Family B: premium contour-route language. Quietest and most refined; slightly more interpretive at the smallest size.\n- Family C: CairnNZ field marks. A shared broken compass ring creates proprietary cohesion; the branded frame adds a little more visual density.\n\nRecommendation for human review: Family A is strongest overall and clearest at Home size. Family B has the most premium restraint. Family C has the strongest proprietary family identity.\n`);

console.log(`Wrote icon exploration to ${outputDir}`);
