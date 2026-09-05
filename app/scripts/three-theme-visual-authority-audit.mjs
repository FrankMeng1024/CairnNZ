import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const auditDir = path.resolve('..', 'docs', 'review', 'three-theme-visual-authority-audit');
const captureDir = path.join(auditDir, 'captures');
const componentDir = path.join(auditDir, 'components');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(captureDir, { recursive: true });
fs.mkdirSync(componentDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  geolocation: { latitude: -44.6717, longitude: 167.9256 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
const metrics = { viewport: { width: 390, height: 844 }, captures: {} };

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.com', added_at: '2026-08-20T08:00:00.000Z' },
  { id: 12, name: 'Theo Walker', email: 'theo@example.com', added_at: '2026-08-19T08:00:00.000Z' },
  { id: 13, name: 'Anika Bell', email: 'anika@example.com', added_at: '2026-08-18T08:00:00.000Z' },
];

await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  if (pathname === '/api/friends') return json(friends);
  if (pathname === '/api/friends/requests') return json([
    { id: 31, from_user_id: 31, from_name: 'Kiri Morgan', from_email: 'kiri@example.com', sent_at: '2026-09-03T08:00:00.000Z', status: 'pending' },
  ]);
  if (pathname === '/api/friends/requests/outbound') return json([
    { id: 41, to_user_id: 41, to_name: 'Jamie Reed', to_email: 'jamie@example.com', sent_at: '2026-09-01T08:00:00.000Z' },
  ]);
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) {
    return json({
      id: 11,
      name: 'Mia Rangi',
      email: 'mia@example.com',
      memberSince: '2025-11-10T08:00:00.000Z',
      friendCount: 8,
      hikeCount: 24,
      placesExplored: 17,
      cairnsPlanted: 6,
    });
  }
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 500) => page.waitForTimeout(ms);
const fullShot = async name => {
  await settle(250);
  const target = path.join(captureDir, `${name}-390x844.png`);
  await page.screenshot({ path: target, fullPage: false });
  metrics.captures[name] = { path: target };
};
const elementShot = async (locator, name) => {
  await locator.waitFor({ state: 'visible', timeout: 10000 });
  const target = path.join(componentDir, `${name}.png`);
  await locator.screenshot({ path: target });
  const box = await locator.boundingBox();
  metrics.captures[name] = { path: target, box };
};
const setTime = async time => {
  await page.evaluate(nextTime => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTime, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTime);
  }, time);
  await settle(550);
};
const mount = async routeName => {
  await page.evaluate(nextRoute => {
    globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: nextRoute }] });
  }, routeName);
  await page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, routeName, { timeout: 15000 });
  await settle(800);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_three-theme-audit', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: {
      id: 'three-theme-audit', name: 'Aroha', email: 'visual.qa@example.com',
      createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
      hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

for (const time of ['day', 'sunset', 'night']) {
  await setTime(time);
  await mount('Home');
  await fullShot(`home-${time}`);

  await mount('Friends');
  await fullShot(`friends-${time}`);
  await elementShot(page.getByTestId('friends-tabs'), `tabs-${time}`);
  await elementShot(page.getByTestId('friend-card-11'), `record-${time}`);
  await elementShot(page.getByRole('button', { name: 'Add a Friend', exact: true }), `primary-action-${time}`);

  await page.getByLabel('Add friend', { exact: true }).click();
  await page.getByTestId('add-friend-sheet').waitFor({ state: 'visible' });
  await settle(650);
  await fullShot(`add-friend-${time}`);
  await elementShot(page.getByTestId('add-friend-sheet'), `sheet-${time}`);
  await elementShot(page.getByTestId('add-friend-email'), `field-${time}`);
  await page.getByPlaceholder('name@email.com').fill('mia@example.com');
  await elementShot(page.getByRole('button', { name: 'Send Request', exact: true }), `send-action-${time}`);
  await elementShot(page.getByText('Cancel', { exact: true }), `secondary-action-${time}`);
  await elementShot(page.getByLabel('Close', { exact: true }), `close-icon-${time}`);

  await mount('Friends');
  await page.getByTestId('friend-card-11').click();
  await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible' });
  await settle(350);
  await fullShot(`profile-${time}`);
  await elementShot(page.getByTestId('friend-profile-modal'), `modal-${time}`);
  await elementShot(page.getByTestId('friend-profile-remove-trigger'), `destructive-utility-${time}`);
  await page.getByTestId('friend-profile-remove-trigger').click();
  await elementShot(page.getByTestId('friend-profile-remove-confirmation'), `destructive-confirmation-${time}`);
}

const uniqueErrors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(auditDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(auditDir, 'runtime-metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
await browser.close();

const labelSvg = (width, label, size = 18) => Buffer.from(
  `<svg width="${width}" height="42"><text x="${width / 2}" y="27" text-anchor="middle" font-family="Arial" font-size="${size}" font-weight="600" fill="#E9EEE9">${label}</text></svg>`,
);

const themes = ['day', 'sunset', 'night'];
const screens = [
  ['home', 'Home'],
  ['friends', 'Friends main'],
  ['add-friend', 'Add Friend'],
  ['profile', 'Profile'],
];
const overviewGap = 24;
const overviewLabelH = 42;
const overviewWidth = overviewGap + themes.length * (390 + overviewGap);
const overviewHeight = 64 + screens.length * (overviewLabelH + 844 + overviewGap);
const overview = sharp({ create: { width: overviewWidth, height: overviewHeight, channels: 3, background: '#202824' } });
const overviewComposites = [];
for (let row = 0; row < screens.length; row += 1) {
  const [screen, screenLabel] = screens[row];
  const top = 64 + row * (overviewLabelH + 844 + overviewGap);
  for (let col = 0; col < themes.length; col += 1) {
    const theme = themes[col];
    const left = overviewGap + col * (390 + overviewGap);
    overviewComposites.push({ input: labelSvg(390, `${screenLabel} · ${theme[0].toUpperCase()}${theme.slice(1)}`), left, top });
    overviewComposites.push({ input: path.join(captureDir, `${screen}-${theme}-390x844.png`), left, top: top + overviewLabelH });
  }
}
await overview.composite(overviewComposites).jpeg({ quality: 92 }).toFile(path.join(auditDir, 'three-theme-runtime-board.jpg'));

const componentRows = [
  ['tabs', 'Active + inactive tabs'],
  ['record', 'List record + icon'],
  ['primary-action', 'Primary button'],
  ['send-action', 'Primary button + icon'],
  ['secondary-action', 'Secondary action'],
  ['field', 'Text field'],
  ['sheet', 'Sheet material'],
  ['modal', 'Modal material'],
  ['destructive-utility', 'Destructive utility'],
  ['destructive-confirmation', 'Destructive confirmation'],
  ['close-icon', 'Close icon'],
];
const cellW = 390;
const cellH = 250;
const componentWidth = overviewGap + themes.length * (cellW + overviewGap);
const componentHeight = 64 + componentRows.length * (overviewLabelH + cellH + overviewGap);
const componentBoard = sharp({ create: { width: componentWidth, height: componentHeight, channels: 3, background: '#202824' } });
const componentComposites = [];
for (let row = 0; row < componentRows.length; row += 1) {
  const [component, componentLabel] = componentRows[row];
  const top = 64 + row * (overviewLabelH + cellH + overviewGap);
  for (let col = 0; col < themes.length; col += 1) {
    const theme = themes[col];
    const left = overviewGap + col * (cellW + overviewGap);
    const source = path.join(componentDir, `${component}-${theme}.png`);
    const prepared = await sharp(source)
      .resize({ width: cellW - 24, height: cellH - 16, fit: 'inside', withoutEnlargement: true })
      .png()
      .toBuffer({ resolveWithObject: true });
    const itemLeft = left + Math.round((cellW - prepared.info.width) / 2);
    const itemTop = top + overviewLabelH + Math.round((cellH - prepared.info.height) / 2);
    componentComposites.push({ input: labelSvg(cellW, `${componentLabel} · ${theme[0].toUpperCase()}${theme.slice(1)}`, 16), left, top });
    componentComposites.push({ input: prepared.data, left: itemLeft, top: itemTop });
  }
}
await componentBoard.composite(componentComposites).jpeg({ quality: 92 }).toFile(path.join(auditDir, 'three-theme-component-board.jpg'));
