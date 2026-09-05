import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const phase = process.env.CAIRN_QA_PHASE || 'after';
if (!['before', 'after'].includes(phase)) throw new Error(`Unsupported phase: ${phase}`);

const gateDir = path.resolve('..', 'docs', 'review', 'batch3-friends-refinement-gate');
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
  geolocation: { latitude: -44.6717, longitude: 167.9256 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
const layoutMetrics = { viewport: { width: 390, height: 844 } };
let scenario = 'populated';
let addRequestDelayMs = 0;
let loadDelayMs = 0;

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.com', added_at: '2026-08-20T08:00:00.000Z' },
  { id: 12, name: 'Theo Walker', email: 'theo@example.com', added_at: '2026-08-19T08:00:00.000Z' },
  { id: 13, name: 'Anika Bell', email: 'anika@example.com', added_at: '2026-08-18T08:00:00.000Z' },
];
const incoming = [
  { id: 31, from_user_id: 31, from_name: 'Kiri Morgan', from_email: 'kiri@example.com', sent_at: '2026-09-03T08:00:00.000Z', status: 'pending' },
  { id: 32, from_user_id: 32, from_name: 'Sam Chen', from_email: 'sam@example.com', sent_at: '2026-09-02T08:00:00.000Z', status: 'pending' },
];
const outbound = [
  { id: 41, to_user_id: 41, to_name: 'Jamie Reed', to_email: 'jamie@example.com', sent_at: '2026-09-01T08:00:00.000Z' },
];

await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const json = body => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

  if (pathname === '/api/friends/request' && request.method() === 'POST') {
    if (addRequestDelayMs) await new Promise(resolve => setTimeout(resolve, addRequestDelayMs));
    await json({ success: true });
    return;
  }
  if (pathname === '/api/friends') {
    if (loadDelayMs) await new Promise(resolve => setTimeout(resolve, loadDelayMs));
    await json(scenario === 'empty' ? [] : friends);
    return;
  }
  if (pathname === '/api/friends/requests') {
    if (loadDelayMs) await new Promise(resolve => setTimeout(resolve, loadDelayMs));
    await json(scenario === 'pending-both' || scenario === 'incoming-only' ? incoming : []);
    return;
  }
  if (pathname === '/api/friends/requests/outbound') {
    if (loadDelayMs) await new Promise(resolve => setTimeout(resolve, loadDelayMs));
    await json(scenario === 'pending-both' || scenario === 'sent-only' ? outbound : []);
    return;
  }
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) {
    if (scenario === 'profile-unavailable') {
      // A malformed successful payload exercises the production parser's
      // existing null/unavailable recovery without creating a deliberate
      // browser network error in the regression log.
      await route.fulfill({ status: 200, contentType: 'application/json', body: '' });
      return;
    }
    await json({
      id: 11,
      name: 'Mia Rangi',
      email: 'mia@example.com',
      memberSince: '2025-11-10T08:00:00.000Z',
      friendCount: 8,
      hikeCount: 24,
      placesExplored: 17,
      cairnsPlanted: 6,
    });
    return;
  }
  await json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 900) => page.waitForTimeout(ms);
const shot = async name => {
  await settle(250);
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`), fullPage: false });
};
const setTime = async time => {
  await page.evaluate(nextTime => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTime, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTime);
  }, time);
  await settle(500);
};
const mountFriends = async (nextScenario, waitMs = 900) => {
  scenario = nextScenario;
  await page.evaluate(() => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Friends' }],
    });
  });
  await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 15000 });
  await settle(waitMs);
};
const clickTab = async label => {
  await page.getByRole('tab', { name: label, exact: true }).click();
  await settle(300);
};
const openAddFriend = async () => {
  await page.getByLabel('Add friend', { exact: true }).click();
  await settle(700);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_batch3-qa', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: {
      id: 'batch3-qa', name: 'Aroha', email: 'visual.qa@example.com',
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
  await mountFriends('populated');
  await shot(`friends-populated-${time}`);
}

await setTime('day');
await page.evaluate(() => globalThis.__cairnStores.useFriendStore.setState({ friends: [] }));
loadDelayMs = 1500;
await mountFriends('empty', 100);
await shot('friends-loading-day');
await settle(1600);
loadDelayMs = 0;

for (const time of ['day', 'sunset', 'night']) {
  await setTime(time);
  await mountFriends('empty');
  await shot(`friends-empty-${time}`);
}

await setTime('day');
await mountFriends('pending-both');
await clickTab('Pending');
await shot('pending-incoming-and-sent-day');

await mountFriends('incoming-only');
await clickTab('Pending');
await shot('pending-incoming-only-day');

await mountFriends('sent-only');
await clickTab('Pending');
await shot('pending-sent-only-day');

await mountFriends('empty');
await clickTab('Pending');
await shot('pending-empty-day');

for (const time of ['day', 'sunset', 'night']) {
  await setTime(time);
  await mountFriends('populated');
  await openAddFriend();
  await shot(`add-friend-default-${time}`);
  if (time === 'day') {
    layoutMetrics.addFriendDefault = {
      sheet: await page.getByTestId('add-friend-sheet').boundingBox(),
      field: await page.getByTestId('add-friend-email').boundingBox(),
      action: await page.getByRole('button', { name: 'Send Request', exact: true }).boundingBox(),
      actionDisabled: await page.getByRole('button', { name: 'Send Request', exact: true }).isDisabled(),
      cancel: await page.getByText('Cancel', { exact: true }).boundingBox(),
    };
  }
}

await setTime('day');
await mountFriends('populated');
await openAddFriend();
const emailField = page.getByPlaceholder('name@email.com');
await emailField.focus();
await emailField.fill('not-an-email');
await shot('add-friend-focused-day');
layoutMetrics.addFriendFocused = {
  activeElementPlaceholder: await page.evaluate(() => document.activeElement?.getAttribute?.('placeholder') ?? null),
  computedInputStyle: await emailField.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      borderColor: style.borderColor,
      outlineColor: style.outlineColor,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  }),
  sheet: await page.getByTestId('add-friend-sheet').boundingBox(),
  field: await page.getByTestId('add-friend-email').boundingBox(),
  action: await page.getByRole('button', { name: 'Send Request', exact: true }).boundingBox(),
  actionDisabled: await page.getByRole('button', { name: 'Send Request', exact: true }).isDisabled(),
  cancel: await page.getByText('Cancel', { exact: true }).boundingBox(),
};
await page.getByText('Send Request', { exact: true }).click();
await settle(250);
await shot('add-friend-invalid-day');

await mountFriends('populated');
await openAddFriend();
addRequestDelayMs = 4000;
await page.getByPlaceholder('name@email.com').fill('new.friend@example.com');
await page.getByText('Send Request', { exact: true }).click();
await settle(250);
await shot('add-friend-submitting-day');
addRequestDelayMs = 0;

await mountFriends('populated');
await page.getByTestId('friend-card-11').click();
await settle(650);
await shot('friend-profile-day');
layoutMetrics.friendProfile = {
  card: await page.getByTestId('friend-profile-modal').boundingBox(),
  removeAction: await page.getByRole('button', { name: 'Remove friend', exact: true }).boundingBox(),
};

await mountFriends('profile-unavailable');
await page.getByTestId('friend-card-11').click();
await settle(650);
await shot('friend-profile-unavailable-day');

const uniqueErrors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'layout-metrics.json'), `${JSON.stringify(layoutMetrics, null, 2)}\n`);

const comparisons = [
  ['friends-populated-day', 'Friends populated · Day'],
  ['friends-populated-sunset', 'Friends populated · Sunset'],
  ['friends-populated-night', 'Friends populated · Night'],
  ['friends-empty-day', 'Friends empty · Day'],
  ['pending-incoming-and-sent-day', 'Pending · Incoming + Sent'],
  ['pending-empty-day', 'Pending empty'],
  ['add-friend-default-day', 'Add Friend · Default'],
  ['add-friend-invalid-day', 'Add Friend · Invalid'],
  ['friend-profile-day', 'Friend profile'],
];
const beforeDir = path.join(gateDir, 'before');
const afterDir = path.join(gateDir, 'after');
if (phase === 'after' && fs.existsSync(beforeDir)) {
  const tileW = 390;
  const tileH = 844;
  const labelH = 46;
  const gap = 18;
  const margin = 36;
  const pairsPerRow = 3;
  const columnCount = pairsPerRow * 2;
  const rowCount = Math.ceil(comparisons.length / pairsPerRow);
  const boardW = margin * 2 + tileW * columnCount + gap * (columnCount - 1);
  const boardH = margin * 2 + rowCount * (tileH + labelH) + gap * (rowCount - 1);
  const composites = [];
  for (let index = 0; index < comparisons.length; index += 1) {
    const [name, label] = comparisons[index];
    const row = Math.floor(index / pairsPerRow);
    const pairColumn = index % pairsPerRow;
    const top = margin + row * (tileH + labelH + gap);
    for (let col = 0; col < 2; col += 1) {
      const boardColumn = pairColumn * 2 + col;
      const left = margin + boardColumn * (tileW + gap);
      const phaseLabel = col === 0 ? 'BEFORE' : 'AFTER';
      const svg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="14" y="29" font-family="Arial" font-size="14" font-weight="700" fill="#F5F3EC">${phaseLabel} · ${label}</text></svg>`;
      composites.push({ input: Buffer.from(svg), left, top });
      composites.push({ input: path.join(col === 0 ? beforeDir : afterDir, `${name}-390x844.png`), left, top: top + labelH });
    }
  }
  await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(gateDir, 'friends-before-after-board.jpg'));
}

fs.writeFileSync(path.join(gateDir, 'README.md'), '# Batch 3 Friends family refinement gate\n\nReal Expo Web captures at 390×844. The before/after board covers the active production Friends screen, primary navigation hierarchy, representative populated and empty states, Pending request states, Add Friend, and the reachable friend-profile modal. API fixtures are intercepted locally; no backend writes occur.\n');
await browser.close();
console.log(`Created Batch 3 ${phase} captures in ${outputDir}`);
