import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8083';
const root = path.resolve('..');
const reviewDir = path.join(root, 'docs', 'review', 'friends-final-final-closeout');
const captureDir = path.join(reviewDir, 'captures');
fs.mkdirSync(captureDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(`console: ${message.text()}`);
});

const longName = 'Charlotte Ngata-Smith-Williams';
const friends = [{ id: 41, name: longName, email: 'charlotte.ngata-smith-williams@example.com', added_at: '2026-09-01T08:00:00.000Z' }];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === '/api/friends' && request.method() === 'GET') return json(route, friends);
  if (pathname === '/api/friends/requests' && request.method() === 'GET') return json(route, []);
  if (pathname === '/api/friends/requests/outbound' && request.method() === 'GET') return json(route, []);
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) {
    return json(route, { id: 41, name: longName, email: friends[0].email, placesExplored: 27, cairnsPlanted: 8 });
  }
  return json(route, { message: 'ok' });
});

const shot = async name => {
  await page.waitForTimeout(300);
  const target = path.join(captureDir, `${name}-390x844.png`);
  await page.screenshot({ path: target });
  return target;
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.getState().setUser({ id: 'friends-final-final-qa', name: 'Aroha', email: 'qa@example.invalid' });
  stores.useAppStore.getState().setLoggedIn(true);
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false });
  stores.useWeatherStore.getState().setTimeOfDayOverride('day');
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });
await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Friends' }] }));
await page.getByRole('tab', { name: 'Friends', exact: true }).waitFor({ state: 'visible' });
await page.getByTestId('friend-card-41').click();
await page.getByTestId('friend-profile-remove-trigger').click();

const warning = 'You’ll lose access to routes, cairns, and explored areas shared by this friend. Your own exploration won’t be affected.';
await page.getByText(warning, { exact: true }).waitFor({ state: 'visible' });
const confirmation = await shot('remove-friend-confirmation');
const longNameProfile = await shot('very-long-name-profile');
const finalButton = page.getByTestId('friend-profile-remove-final');
const finalButtonBox = await finalButton.boundingBox();
const finalButtonText = await finalButton.innerText();
await page.getByTestId('friend-profile-close').click();

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'night', debugMode: false });
  stores.useWeatherStore.getState().setTimeOfDayOverride('night');
});
await page.getByRole('button', { name: 'Add friend', exact: true }).click();
await page.getByTestId('add-friend-email').fill('friend@example.com');
const send = page.getByRole('button', { name: 'Send request', exact: true });
const afterNight = await shot('add-friend-night-after');
const afterMaterial = await send.evaluate(el => {
  const leaf = [...el.querySelectorAll('*')].find(node => node.children.length === 0 && node.textContent === 'Send request');
  return {
    background: getComputedStyle(el).backgroundColor,
    border: getComputedStyle(el).borderColor,
    foreground: leaf ? getComputedStyle(leaf).color : null,
  };
});

const beforeNight = path.join(root, 'docs', 'review', 'friends-final-closeout', 'captures', 'add-friend-night-390x844.png');
const tiles = [
  ['REMOVE FRIEND · FINAL COPY', confirmation],
  ['LONG NAME · FIXED ACTION', longNameProfile],
  ['NIGHT · BEFORE', beforeNight],
  ['NIGHT · AFTER', afterNight],
];
const cellW = 410;
const cellH = 906;
const composites = [{
  input: Buffer.from('<svg width="780" height="72"><text x="0" y="31" fill="#f5f7f2" font-family="Arial" font-size="25" font-weight="700">Friends final-final closeout · 390×844</text><text x="0" y="57" fill="#aebbb5" font-family="Arial" font-size="14">Production components · QA-only long-name data</text></svg>'),
  left: 20, top: 8,
}];
tiles.forEach(([label, file], index) => {
  const col = index % 2;
  const row = Math.floor(index / 2);
  composites.push({ input: file, left: col * cellW + 10, top: 124 + row * cellH });
  composites.push({
    input: Buffer.from(`<svg width="390" height="42"><text x="4" y="28" fill="#eef2ee" font-family="Arial" font-size="16" font-weight="700">${label}</text></svg>`),
    left: col * cellW + 10, top: 82 + row * cellH,
  });
});
const boardPath = path.join(reviewDir, 'friends-final-final-closeout-board.jpg');
await sharp({ create: { width: cellW * 2, height: 82 + cellH * 2, channels: 3, background: '#17201d' } })
  .composite(composites).jpeg({ quality: 90 }).toFile(boardPath);

const evidence = {
  viewport: '390x844',
  qaOnlyFixture: longName,
  warning,
  finalButtonText,
  finalButtonBox,
  afterMaterial,
  runtimeErrors,
};
fs.writeFileSync(path.join(reviewDir, 'runtime-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);
await browser.close();

if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
if (finalButtonText.trim() !== 'Remove friend') throw new Error(`Unexpected final action: ${finalButtonText}`);
if (!finalButtonBox || finalButtonBox.x < 0 || finalButtonBox.x + finalButtonBox.width > 390) throw new Error('Final action clipped');
process.stdout.write(`${JSON.stringify({ boardPath, captureDir, afterMaterial }, null, 2)}\n`);
