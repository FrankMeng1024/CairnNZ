import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8083';
const root = path.resolve('..');
const reviewDir = path.join(root, 'docs', 'review', 'friends-final-closeout');
const captureDir = path.join(reviewDir, 'captures');
const boardPath = path.join(reviewDir, 'friends-final-closeout-board.jpg');
fs.mkdirSync(captureDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.com', added_at: '2026-08-20T08:00:00.000Z' },
  { id: 12, name: 'Theo Walker', email: 'theo@example.com', added_at: '2026-08-19T08:00:00.000Z' },
];
const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
await page.route('**/api/**', route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname === '/api/friends' && request.method() === 'GET') return json(route, friends);
  if (pathname === '/api/friends/requests' && request.method() === 'GET') return json(route, []);
  if (pathname === '/api/friends/requests/outbound' && request.method() === 'GET') return json(route, []);
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) {
    return json(route, { id: 11, name: 'Mia Rangi', email: 'mia@example.com', placesExplored: 17, cairnsPlanted: 6 });
  }
  return json(route, { message: 'ok' });
});

const shot = async name => {
  await page.waitForTimeout(250);
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
  stores.useAppStore.getState().setUser({ id: 'friends-final-qa', name: 'Aroha', email: 'qa@example.invalid' });
  stores.useAppStore.getState().setLoggedIn(true);
  stores.useSettingsStore.getState().saveAll({ appearance: 'day', debugMode: false });
  stores.useWeatherStore.getState().setTimeOfDayOverride('day');
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });
await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Friends' }] }));
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 30000 });
await page.getByRole('tab', { name: 'Friends', exact: true }).waitFor({ state: 'visible' });
await page.waitForTimeout(500);

await page.getByTestId('friend-card-11').click();
await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible' });
const normal = await shot('profile-normal-day');
await page.getByTestId('friend-profile-remove-trigger').click();
const warning = "You’ll lose access to routes, cairns, and explored areas available through this friendship. Your own exploration will stay unlocked.";
await page.getByText(warning, { exact: true }).waitFor({ state: 'visible' });
const confirmation = await shot('profile-remove-confirmation-day');
const removeRegionBorderTop = await page.getByTestId('friend-profile-remove-region').evaluate(el => getComputedStyle(el).borderTopWidth);
const finalActionCount = await page.getByRole('button', { name: 'Remove Mia', exact: true }).count();
const warningVisible = await page.getByText(warning, { exact: true }).isVisible();
await page.getByTestId('friend-profile-close').click();

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ appearance: 'night', debugMode: false });
  stores.useWeatherStore.getState().setTimeOfDayOverride('night');
});
await page.waitForTimeout(300);
await page.getByRole('button', { name: 'Add friend', exact: true }).click();
await page.getByTestId('add-friend-email').fill('mia@example.com');
await page.getByRole('button', { name: 'Send request', exact: true }).waitFor({ state: 'visible' });
const sendButton = page.getByRole('button', { name: 'Send request', exact: true });
const sendMaterial = await sendButton.evaluate(el => {
  const label = [...el.querySelectorAll('*')].find(node => node.children.length === 0 && node.textContent === 'Send request');
  return {
    backgroundColor: getComputedStyle(el).backgroundColor,
    borderColor: getComputedStyle(el).borderColor,
    foregroundColor: label ? getComputedStyle(label).color : null,
  };
});
const addFriend = await shot('add-friend-night');

const evidence = {
  viewport: '390x844',
  assertions: {
    warningVisible,
    removeRegionBorderTop,
    finalActionCount,
    sendMaterial,
    runtimeErrors,
  },
};
fs.writeFileSync(path.join(reviewDir, 'runtime-evidence.json'), `${JSON.stringify(evidence, null, 2)}\n`);

const beforeNormal = path.join(root, 'docs', 'review', 'friends-confirmation-requests-ux', 'after', 'remove-friend-normal-390x844.png');
const beforeConfirmation = path.join(root, 'docs', 'review', 'friends-confirmation-requests-ux', 'after', 'remove-friend-confirmation-390x844.png');
const beforeAdd = path.join(root, 'docs', 'review', 'friends-post-ota-correction', 'after', 'add-friend-focused-night-390x844.png');
const tiles = [
  ['BEFORE · PROFILE', beforeNormal], ['AFTER · PROFILE', normal],
  ['BEFORE · CONFIRM', beforeConfirmation], ['AFTER · CONFIRM', confirmation],
  ['BEFORE · ADD FRIEND', beforeAdd], ['AFTER · ADD FRIEND', addFriend],
];
const cellW = 430;
const cellH = 914;
const board = sharp({ create: { width: cellW * 2, height: 82 + cellH * 3, channels: 3, background: '#17201d' } });
const composites = [];
for (let i = 0; i < tiles.length; i += 1) {
  const [label, file] = tiles[i];
  const col = i % 2;
  const row = Math.floor(i / 2);
  composites.push({ input: file, left: col * cellW + 20, top: 82 + row * cellH + 50 });
  composites.push({
    input: Buffer.from(`<svg width="390" height="44"><text x="0" y="28" fill="#eef2ee" font-family="Arial" font-size="18" font-weight="700">${label}</text></svg>`),
    left: col * cellW + 20,
    top: 82 + row * cellH + 4,
  });
}
composites.push({
  input: Buffer.from('<svg width="820" height="70"><text x="0" y="34" fill="#f5f7f2" font-family="Arial" font-size="26" font-weight="700">Friends final closeout · 390×844 runtime</text><text x="0" y="60" fill="#aebbb5" font-family="Arial" font-size="14">Profile separators + copy · Night Add Friend action intensity</text></svg>'),
  left: 20,
  top: 8,
});
await board.composite(composites).jpeg({ quality: 90 }).toFile(boardPath);

await browser.close();
if (runtimeErrors.length) throw new Error(`Runtime errors: ${runtimeErrors.join(' | ')}`);
if (removeRegionBorderTop !== '0px') throw new Error(`Remove region still has border-top: ${removeRegionBorderTop}`);
process.stdout.write(`${JSON.stringify({ boardPath, captureDir, sendMaterial }, null, 2)}\n`);
