import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const phase = process.env.CAIRN_QA_PHASE || 'after';
if (!['before', 'after'].includes(phase)) throw new Error(`Unsupported phase: ${phase}`);

const gateDir = path.resolve('..', 'docs', 'review', 'batch3-ota-correction-gate');
const outputDir = path.join(gateDir, phase);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
});
const page = await context.newPage();
const runtimeErrors = [];
const assertions = {};

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
  if (pathname === '/api/friends/requests') return json([]);
  if (pathname === '/api/friends/requests/outbound') return json([]);
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
  if (pathname === '/api/friends/request' && request.method() === 'POST') return json({ success: true });
  if (/^\/api\/friends\/\d+$/.test(pathname) && request.method() === 'DELETE') return json({ success: true });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 500) => page.waitForTimeout(ms);
const shot = async name => {
  await settle(200);
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`), fullPage: false });
};
const setTime = async time => {
  await page.evaluate(nextTime => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTime, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTime);
  }, time);
  await settle();
};
const mountFriends = async () => {
  await page.evaluate(() => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Friends' }],
    });
  });
  await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 15000 });
  await settle(700);
};
const openProfile = async () => {
  await page.getByTestId('friend-card-11').click();
  await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible' });
  await settle(300);
};
const openAddFriend = async () => {
  await page.getByLabel('Add friend', { exact: true }).click();
  await page.getByTestId('add-friend-sheet').waitFor({ state: 'visible' });
  await settle(600);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_batch3-ota-correction', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: {
      id: 'batch3-ota-correction', name: 'Aroha', email: 'visual.qa@example.com',
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
  await mountFriends();
  await openProfile();
  await shot(`profile-${time}`);

  await mountFriends();
  await openAddFriend();
  await shot(`add-friend-${time}`);
}

await setTime('day');
await mountFriends();
await openAddFriend();
const field = page.getByPlaceholder('name@email.com');
await field.focus();
await field.fill('not-an-email');
await shot('add-friend-focused');
await page.getByRole('button', { name: 'Send Request', exact: true }).click();
await shot('add-friend-validation');

if (phase === 'after') {
  await mountFriends();
  await openProfile();
  await shot('remove-friend-normal');
  await page.getByTestId('friend-profile-remove-trigger').click();
  await shot('remove-friend-confirmation');

  await mountFriends();
  await openAddFriend();
  const interactionField = page.getByPlaceholder('name@email.com');
  await interactionField.focus();
  await interactionField.fill('mia@example.com');
  await page.mouse.click(195, 120);
  await settle(250);
  assertions.firstBackdropTapKeptSheet = await page.getByTestId('add-friend-sheet').isVisible();
  assertions.firstBackdropTapBlurredField = await page.evaluate(() => document.activeElement?.getAttribute?.('placeholder') !== 'name@email.com');
  assertions.firstBackdropTapRetainedValue = await interactionField.inputValue() === 'mia@example.com';
  await page.mouse.click(195, 120);
  await settle(500);
  assertions.secondBackdropTapClosedSheet = await page.getByTestId('add-friend-sheet').count() === 0;

  await mountFriends();
  await openAddFriend();
  assertions.parentRowsSuppressed = await page.getByTestId('friends-content').evaluate(element => getComputedStyle(element).opacity === '0');
  assertions.underlyingPrimaryActionHidden = await page.getByRole('button', { name: 'Add a Friend', exact: true }).count() === 0;
  await shot('overlay-parent-suppressed');

  const insideField = page.getByPlaceholder('name@email.com');
  await insideField.focus();
  await insideField.fill('inside@example.com');
  await page.mouse.click(195, 470);
  await settle(250);
  assertions.insideTapKeptSheet = await page.getByTestId('add-friend-sheet').isVisible();
  assertions.insideTapBlurredField = await page.evaluate(() => document.activeElement?.getAttribute?.('placeholder') !== 'name@email.com');
  assertions.insideTapRetainedValue = await insideField.inputValue() === 'inside@example.com';

  await insideField.focus();
  await page.getByLabel('Close', { exact: true }).click();
  await settle(500);
  assertions.explicitCloseDismissedSheetWithFocus = await page.getByTestId('add-friend-sheet').count() === 0;
}

const uniqueErrors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'assertions.json'), `${JSON.stringify(assertions, null, 2)}\n`);

await browser.close();

if (phase === 'after') {
  const pairs = [
    ['profile-day', 'Profile · Day'],
    ['profile-sunset', 'Profile · Sunset'],
    ['profile-night', 'Profile · Night'],
    ['add-friend-day', 'Add Friend · Day'],
    ['add-friend-sunset', 'Add Friend · Sunset'],
    ['add-friend-night', 'Add Friend · Night'],
  ];
  const width = 390 * 2 + 32 * 3;
  const rowHeight = 844 + 58;
  const canvas = sharp({ create: { width, height: rowHeight * pairs.length + 52, channels: 3, background: '#E8E4D9' } });
  const composites = [];
  const labelSvg = (label, x, y) => ({
    input: Buffer.from(`<svg width="390" height="44"><text x="195" y="28" text-anchor="middle" font-family="Arial" font-size="18" font-weight="600" fill="#24352F">${label}</text></svg>`),
    left: x,
    top: y,
  });
  for (let index = 0; index < pairs.length; index += 1) {
    const [name, label] = pairs[index];
    const top = 52 + index * rowHeight;
    composites.push(labelSvg(`Before · ${label}`, 32, top));
    composites.push(labelSvg(`After · ${label}`, 422, top));
    composites.push({ input: path.join(gateDir, 'before', `${name}-390x844.png`), left: 32, top: top + 44 });
    composites.push({ input: path.join(gateDir, 'after', `${name}-390x844.png`), left: 422, top: top + 44 });
  }
  await canvas.composite(composites).jpeg({ quality: 92 }).toFile(path.join(gateDir, 'before-after-board.jpg'));
}
