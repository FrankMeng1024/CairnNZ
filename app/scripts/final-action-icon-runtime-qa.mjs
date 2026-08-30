import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'qa', 'visual-north-star', 'final-static-visual-correction-gate', 'icons');
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--disable-web-security'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'en-NZ' });
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`); });

const qaUser = { id: 'final-action-icon-qa', name: 'Aroha', email: 'icon.qa@example.com', createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'] };
await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'final-action-icon-qa-token');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_final-action-icon-qa', 'true');
});
await page.route('**/api/**', async route => {
  if (route.request().url().includes('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: qaUser }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], count: 0 }) });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useSettingsStore?.getState().hydrated), null, { timeout: 120000 });
await page.evaluate(user => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({ user, isLoggedIn: true, hydrated: true });
  stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day' });
  stores.useWeatherStore.getState().setConditionOverride('sunny');
  stores.navigationRef.navigate('Home');
}, qaUser);
await page.waitForTimeout(1800);

async function setCandidate(index, time) {
  await page.evaluate(({ index, time }) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: time });
    stores.useWeatherStore.getState().setHikingIconCandidate(`H${index}`);
    stores.useWeatherStore.getState().setRunningIconCandidate(`R${index}`);
    stores.navigationRef.navigate('Home');
  }, { index, time });
  await page.waitForTimeout(850);
}

const captures = {};
for (const time of ['day', 'sunset', 'night']) {
  captures[time] = [];
  for (let index = 1; index <= 5; index += 1) {
    await setCandidate(index, time);
    const file = `${time}-h${index}-r${index}-home-390x844.png`;
    await page.screenshot({ path: path.join(outputDir, file) });
    captures[time].push(file);
  }
}

async function board(name, time) {
  const labelHeight = 40;
  const composites = [];
  for (let index = 0; index < 5; index += 1) {
    const left = index * 390;
    composites.push({ input: path.join(outputDir, captures[time][index]), left, top: labelHeight });
    composites.push({ input: Buffer.from(`<svg width="390" height="40"><rect width="390" height="40" fill="#F4F2EC"/><text x="195" y="26" text-anchor="middle" font-family="Arial" font-size="14" font-weight="700" fill="#243B34">H${index + 1} · R${index + 1} · ACCEPTED CAIRN</text></svg>`), left, top: 0 });
  }
  await sharp({ create: { width: 1950, height: 884, channels: 3, background: '#F4F2EC' } })
    .composite(composites).jpeg({ quality: 93, chromaSubsampling: '4:4:4' }).toFile(path.join(outputDir, name));
}
await board('day-home-candidate-preview.jpg', 'day');
await board('sunset-home-candidate-preview.jpg', 'sunset');
await board('night-home-candidate-preview.jpg', 'night');
await board('real-home-candidate-board.jpg', 'day');

// Build the 29px sheet from the actual SVG nodes rendered by React Native Web.
const tiles = [];
for (let index = 1; index <= 5; index += 1) {
  await setCandidate(index, 'day');
  const boxes = await page.evaluate(() => ['Hiking', 'Running', 'Leave a Cairn'].map(label => {
    const labelNode = Array.from(document.querySelectorAll('*')).find(element => element.children.length === 0 && element.textContent?.trim() === label);
    let container = labelNode?.parentElement;
    while (container && !container.querySelector('svg')) container = container.parentElement;
    const rect = container?.querySelector('svg')?.getBoundingClientRect();
    if (!rect) throw new Error(`Missing rendered action SVG: ${label}`);
    return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  }));
  const shot = await page.screenshot();
  tiles.push(await Promise.all(boxes.map(box => sharp(shot).extract({ left: box.x, top: box.y, width: box.width, height: box.height }).png().toBuffer())));
}

const cellW = 118;
const cellH = 90;
const sheetComposites = [];
for (let row = 0; row < 5; row += 1) {
  for (let col = 0; col < 3; col += 1) {
    const left = col * cellW;
    const top = row * cellH;
    const label = col === 0 ? `H${row + 1}` : col === 1 ? `R${row + 1}` : 'CAIRN';
    sheetComposites.push({ input: Buffer.from(`<svg width="${cellW}" height="${cellH}"><rect x="1" y="1" width="${cellW - 2}" height="${cellH - 2}" rx="18" fill="#EEF0E8" stroke="#CBD4CC"/><text x="${cellW / 2}" y="74" text-anchor="middle" font-family="Arial" font-size="11" font-weight="700" fill="#40534C">${label}</text></svg>`), left, top });
    sheetComposites.push({ input: tiles[row][col], left: left + Math.round((cellW - 29) / 2), top: top + 18 });
  }
}
await sharp({ create: { width: cellW * 3, height: cellH * 5, channels: 3, background: '#F4F2EC' } })
  .composite(sheetComposites).png().toFile(path.join(outputDir, '29px-action-icon-candidate-sheet.png'));

// Prove the in-app selector changes review state and remains dev-gated.
await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useWeatherStore.getState().setHikingIconCandidate(null);
  stores.useWeatherStore.getState().setRunningIconCandidate(null);
});
await page.getByLabel('DEV weather cycler').click();
await page.waitForTimeout(250);
await page.getByText('H3', { exact: true }).click();
await page.getByText('R4', { exact: true }).click();
const selectorState = await page.evaluate(() => {
  const state = globalThis.__cairnStores.useWeatherStore.getState();
  return { hiking: state.hikingIconCandidate, running: state.runningIconCandidate };
});
await page.screenshot({ path: path.join(outputDir, 'dev-action-icon-selector-390x844.png') });

fs.writeFileSync(path.join(outputDir, 'runtime-verification.json'), `${JSON.stringify({ selectorState, captures, runtimeErrors: [...new Set(runtimeErrors)] }, null, 2)}\n`);
await browser.close();
console.log(`Wrote real-app icon QA to ${outputDir}`);
