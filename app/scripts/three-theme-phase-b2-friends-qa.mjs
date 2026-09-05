import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const stage = process.argv[2];
if (!['before', 'after'].includes(stage)) throw new Error('Usage: node scripts/three-theme-phase-b2-friends-qa.mjs <before|after>');

const baseUrl = process.env.CAIRN_QA_URL || 'http://localhost:8081';
const gateName = process.env.CAIRN_QA_GATE || 'three-theme-authority-phase-b2';
const gateDir = path.resolve('..', 'docs', 'review', gateName);
const outputDir = path.join(gateDir, stage);
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const themes = ['day', 'sunset', 'night'];
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath, args: ['--disable-web-security'] });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
const assertions = {};
let scenario = 'populated';
let requestDelay = 0;

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});

const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.com', added_at: '2026-08-20T08:00:00.000Z', sharedFlags: 3 },
  { id: 12, name: 'Theo Walker', email: 'theo@example.com', added_at: '2026-08-19T08:00:00.000Z' },
  { id: 13, name: 'Anika Bell', email: 'anika@example.com', added_at: '2026-08-18T08:00:00.000Z' },
  { id: 14, name: 'Moana Te Rito', email: 'moana.terito@example.com', added_at: '2026-08-17T08:00:00.000Z' },
  { id: 15, name: 'Jack Li', email: 'jack.li@example.com', added_at: '2026-08-16T08:00:00.000Z' },
  { id: 16, name: 'Charlotte Ngata-Smith', email: 'charlotte.ngata.smith@example.com', added_at: '2026-08-15T08:00:00.000Z' },
  { id: 17, name: 'Ben O’Connor', email: 'ben.oconnor@example.com', added_at: '2026-08-14T08:00:00.000Z' },
  { id: 18, name: 'Sofia Patel', email: 'sofia.patel@example.com', added_at: '2026-08-13T08:00:00.000Z' },
];
const incoming = [
  { id: 31, from_user_id: 31, from_name: 'Kiri Morgan', from_email: 'kiri@example.com', sent_at: '2026-09-03T08:00:00.000Z', status: 'pending' },
  { id: 32, from_user_id: 32, from_name: 'Alexander Thompson', from_email: 'alexander.thompson@example.com', sent_at: '2026-09-02T08:00:00.000Z', status: 'pending' },
  { id: 33, from_user_id: 33, from_name: 'Ava Chen', from_email: 'ava.chen@example.com', sent_at: '2026-09-01T08:00:00.000Z', status: 'pending' },
];
const outbound = [
  { id: 41, to_user_id: 41, to_name: 'Jamie Reed', to_email: 'jamie@example.com', sent_at: '2026-09-01T08:00:00.000Z' },
  { id: 42, to_user_id: 42, to_name: 'Wiremu King', to_email: 'wiremu.king@example.com', sent_at: '2026-08-31T08:00:00.000Z' },
  { id: 43, to_user_id: 43, to_name: 'Isabella Martínez', to_email: 'isabella.martinez@example.com', sent_at: '2026-08-30T08:00:00.000Z' },
];

await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (pathname === '/api/friends') return json(scenario === 'empty' ? [] : friends);
  if (pathname === '/api/friends/requests') return json(['requests', 'received'].includes(scenario) ? incoming : []);
  if (pathname === '/api/friends/requests/outbound') return json(['requests', 'sent'].includes(scenario) ? outbound : []);
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
  if (pathname === '/api/friends/request' && request.method() === 'POST') {
    if (requestDelay) await new Promise(resolve => setTimeout(resolve, requestDelay));
    return json({ success: true });
  }
  if (/^\/api\/friends\/\d+$/.test(pathname) && request.method() === 'DELETE') return json({ success: true });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 500) => page.waitForTimeout(ms);
const shot = async name => {
  await settle(250);
  await page.screenshot({ path: path.join(outputDir, `${name}-390x844.png`), fullPage: false });
};
const setTheme = async theme => {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme);
  }, theme);
  await settle();
};
const mountFriends = async nextScenario => {
  scenario = nextScenario;
  await page.evaluate(() => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Friends' }] }));
  await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 20000 });
  await settle(800);
};
const mountRoute = async routeName => {
  await page.evaluate(name => globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name }] }), routeName);
  await page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, routeName, { timeout: 20000 });
  await settle(800);
};
const acceptedCopy = stage === 'after' || process.env.CAIRN_QA_CURRENT_COPY === '1';
const primaryTabLabel = acceptedCopy ? 'Requests' : 'Pending';
const openRequests = async () => {
  await page.getByRole('tab', { name: primaryTabLabel, exact: true }).click();
  await settle(300);
};
const openAddFriend = async () => {
  await page.getByRole('button', { name: /Add friend/i }).last().click();
  await page.getByTestId('add-friend-sheet').waitFor({ state: 'visible' });
  await settle(500);
};
const openProfile = async () => {
  await page.getByTestId('friend-card-11').click();
  await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible' });
  await settle(400);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: {
      id: 'phase-b2', name: 'Aroha', email: 'visual.qa@example.com', createdAt: '2026-01-01T00:00:00.000Z',
      dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
  });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

for (const theme of themes) {
  await setTheme(theme);
  await mountFriends('populated');
  await shot(`friends-populated-${theme}`);
  await mountFriends('empty');
  await shot(`friends-empty-${theme}`);

  await mountFriends('populated');
  await openAddFriend();
  await shot(`add-friend-default-${theme}`);
  const field = page.getByPlaceholder('name@email.com');
  await field.focus();
  await field.fill('mia@example.com');
  await shot(`add-friend-focused-${theme}`);

  await mountFriends('populated');
  await openProfile();
  await shot(`profile-${theme}`);
}

if (stage === 'after') {
  for (const theme of themes) {
    await setTheme(theme);
    await mountRoute('Home');
    await shot(`home-${theme}`);
    await mountRoute('Routes');
    await shot(`routes-${theme}`);
  }
}

await setTheme('day');
await mountFriends('requests');
await openRequests();
await shot('requests-received-sent-day');
await mountFriends('received');
await openRequests();
await shot('requests-received-day');
await mountFriends('sent');
await openRequests();
await shot('requests-sent-day');
await mountFriends('empty');
await openRequests();
await shot('requests-empty-day');

await mountFriends('populated');
await openAddFriend();
await page.getByPlaceholder('name@email.com').fill('not-an-email');
await page.getByRole('button', { name: acceptedCopy ? 'Send request' : 'Send Request', exact: true }).click();
await shot('add-friend-invalid-day');

await mountFriends('populated');
await openAddFriend();
requestDelay = 3500;
await page.getByPlaceholder('name@email.com').fill('new.friend@example.com');
await page.getByRole('button', { name: acceptedCopy ? 'Send request' : 'Send Request', exact: true }).click();
await settle(150);
await shot('add-friend-submitting-day');
requestDelay = 0;

await mountFriends('populated');
await openProfile();
await shot('remove-friend-neutral-day');
await page.getByTestId('friend-profile-remove-trigger').click();
await shot('remove-friend-armed-day');

if (stage === 'after') {
  await mountFriends('populated');
  const firstRow = page.getByTestId('friend-card-11');
  const tabs = page.getByTestId('friends-tabs');
  const activeTab = page.getByRole('tab', { name: 'Friends', exact: true });
  const inactiveTab = page.getByRole('tab', { name: 'Requests', exact: true });
  assertions.tabBounds = {
    track: await tabs.boundingBox(),
    active: await activeTab.boundingBox(),
    inactive: await inactiveTab.boundingBox(),
  };
  assertions.tabIntegration = {
    activeInsideTrack:
      assertions.tabBounds.active.x >= assertions.tabBounds.track.x
      && assertions.tabBounds.active.y >= assertions.tabBounds.track.y
      && assertions.tabBounds.active.x + assertions.tabBounds.active.width <= assertions.tabBounds.track.x + assertions.tabBounds.track.width
      && assertions.tabBounds.active.y + assertions.tabBounds.active.height <= assertions.tabBounds.track.y + assertions.tabBounds.track.height,
    adjoiningGap: Number((assertions.tabBounds.inactive.x - (assertions.tabBounds.active.x + assertions.tabBounds.active.width)).toFixed(2)),
  };
  await openAddFriend();
  const sheet = page.getByTestId('add-friend-sheet');
  const parentContent = page.getByTestId('friends-content');
  const close = page.getByTestId('add-friend-close');
  assertions.addFriendBounds = {
    sheet: await sheet.boundingBox(),
    firstUnderlyingRow: await firstRow.boundingBox(),
    field: await page.getByTestId('add-friend-email').boundingBox(),
    action: await page.getByRole('button', { name: 'Send request', exact: true }).boundingBox(),
    close: await close.boundingBox(),
    artwork: await page.getByTestId('add-friend-artwork').boundingBox(),
    arch: await page.getByTestId('add-friend-arch-shape').boundingBox(),
  };
  assertions.sheetStartsAboveFirstRow = assertions.addFriendBounds.sheet.y < assertions.addFriendBounds.firstUnderlyingRow.y;
  assertions.sheetTabBreathingRoom = Number((assertions.addFriendBounds.sheet.y - (assertions.tabBounds.track.y + assertions.tabBounds.track.height)).toFixed(2));
  assertions.parentListRemainsVisible = await parentContent.evaluate(element => getComputedStyle(element).opacity !== '0');
  assertions.closeIsTopRight = assertions.addFriendBounds.close.x > 300;
  await shot('add-friend-overlay-boundary-day');

  const keyboardField = page.getByPlaceholder('name@email.com');
  await keyboardField.focus();
  await keyboardField.fill('kept@example.com');
  await page.mouse.click(195, 120);
  await settle(250);
  assertions.firstBackdropTapKeptSheet = await sheet.isVisible();
  assertions.firstBackdropTapBlurredField = await page.evaluate(() => document.activeElement?.getAttribute?.('placeholder') !== 'name@email.com');
  assertions.firstBackdropTapRetainedValue = await keyboardField.inputValue() === 'kept@example.com';
  await page.mouse.click(195, 120);
  await settle(450);
  assertions.secondBackdropTapClosedSheet = await page.getByTestId('add-friend-sheet').count() === 0;

  await mountFriends('populated');
  await openAddFriend();
  const insideField = page.getByPlaceholder('name@email.com');
  await insideField.focus();
  await insideField.fill('inside@example.com');
  await page.mouse.click(195, 650);
  await settle(250);
  assertions.insideTapKeptSheet = await page.getByTestId('add-friend-sheet').isVisible();
  assertions.insideTapBlurredField = await page.evaluate(() => document.activeElement?.getAttribute?.('placeholder') !== 'name@email.com');
  assertions.insideTapRetainedValue = await insideField.inputValue() === 'inside@example.com';
  await insideField.focus();
  await page.getByTestId('add-friend-close').click();
  await settle(450);
  assertions.explicitCloseDismissedFocusedSheet = await page.getByTestId('add-friend-sheet').count() === 0;

  await mountFriends('populated');
  assertions.addFriendEntryPointCount = await page.getByRole('button', { name: 'Add friend', exact: true }).count();
  const bodyText = await page.locator('body').innerText();
  assertions.multiFriendCountPresent = bodyText.includes('8 friends');
  assertions.copyRemoved = ['Paths that cross yours', 'YOUR CIRCLE', 'QUIETLY CONNECTED', 'shared flags', 'No shared flags yet']
    .every(copy => !bodyText.includes(copy));
  assertions.requestsLabelPresent = await page.getByRole('tab', { name: 'Requests', exact: true }).count() === 1;

  await openProfile();
  const profile = page.getByTestId('friend-profile-modal');
  const removeRegion = page.getByTestId('friend-profile-remove-region');
  assertions.profileBounds = { normal: await profile.boundingBox() };
  assertions.removeRegionBounds = { normal: await removeRegion.boundingBox() };
  await page.getByTestId('friend-profile-remove-trigger').click();
  assertions.profileBounds.armed = await profile.boundingBox();
  assertions.removeRegionBounds.armed = await removeRegion.boundingBox();
  assertions.inlineRemove = {
    confirmationVisible: await page.getByTestId('friend-profile-remove-confirmation').isVisible(),
    nestedDialogCount: await page.getByRole('dialog').count(),
    cancelButtonCount: await page.getByRole('button', { name: 'Cancel', exact: true }).count(),
    finalActionCount: await page.getByRole('button', { name: 'Remove Mia', exact: true }).count(),
    normalChevronCount: await page.getByTestId('friend-profile-remove-region').locator('svg').count(),
  };

  await mountFriends('requests');
  await openRequests();
  assertions.requestRowBounds = {
    received: await page.getByTestId('incoming-card-31').boundingBox(),
    sent: await page.getByTestId('sent-card-41').boundingBox(),
  };
}

const errors = [...new Set(runtimeErrors)].filter(line => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), errors.length ? `${errors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'assertions.json'), `${JSON.stringify(assertions, null, 2)}\n`);

if (stage === 'after') {
  const pairs = [
    ['friends-populated-day', 'Friends · Day'],
    ['friends-populated-sunset', 'Friends · Sunset'],
    ['friends-populated-night', 'Friends · Night'],
    ['add-friend-default-day', 'Add friend · Day'],
    ['add-friend-default-sunset', 'Add friend · Sunset'],
    ['add-friend-default-night', 'Add friend · Night'],
    ['profile-sunset', 'Profile · Sunset'],
    ['remove-friend-neutral-day', 'Remove friend · normal'],
    ['remove-friend-armed-day', 'Remove friend · armed'],
    ['requests-received-sent-day', 'Requests · Received / Sent'],
  ];
  const tileW = 390;
  const tileH = 844;
  const labelH = 42;
  const gap = 18;
  const margin = 28;
  const boardW = margin * 2 + tileW * 2 + gap;
  const boardH = margin * 2 + pairs.length * (tileH + labelH) + (pairs.length - 1) * gap;
  const composites = [];
  for (let row = 0; row < pairs.length; row += 1) {
    const [file, label] = pairs[row];
    const top = margin + row * (tileH + labelH + gap);
    for (let col = 0; col < 2; col += 1) {
      const left = margin + col * (tileW + gap);
      const stageLabel = col === 0 ? 'BEFORE' : 'AFTER';
      const labelSvg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="27" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${stageLabel} · ${label}</text></svg>`;
      composites.push({ input: Buffer.from(labelSvg), left, top });
      composites.push({ input: path.join(gateDir, col === 0 ? 'before' : 'after', `${file}-390x844.png`), left, top: top + labelH });
    }
  }
  await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
    .composite(composites)
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toFile(path.join(gateDir, gateName === 'friends-post-ota-correction'
      ? 'friends-correction-before-after-board.jpg'
      : 'friends-before-after-board.jpg'));

  if (gateName === 'friends-post-ota-correction') {
    const makeAfterGrid = async (name, items, columns) => {
      const rows = Math.ceil(items.length / columns);
      const width = margin * 2 + columns * tileW + (columns - 1) * gap;
      const height = margin * 2 + rows * (tileH + labelH) + (rows - 1) * gap;
      const grid = [];
      for (let index = 0; index < items.length; index += 1) {
        const item = items[index];
        const row = Math.floor(index / columns);
        const col = index % columns;
        const left = margin + col * (tileW + gap);
        const top = margin + row * (tileH + labelH + gap);
        const labelSvg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="27" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${item.label}</text></svg>`;
        grid.push({ input: Buffer.from(labelSvg), left, top });
        grid.push({ input: path.join(outputDir, `${item.file}-390x844.png`), left, top: top + labelH });
      }
      await sharp({ create: { width, height, channels: 3, background: '#151A19' } })
        .composite(grid)
        .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
        .toFile(path.join(gateDir, name));
    };

    await makeAfterGrid('multi-friend-review-board.jpg', [
      { file: 'friends-populated-day', label: '8 friends · Day' },
      { file: 'friends-populated-sunset', label: '8 friends · Sunset' },
      { file: 'friends-populated-night', label: '8 friends · Night' },
      { file: 'requests-received-sent-day', label: '3 Received + 3 Sent' },
    ], 2);

    await makeAfterGrid('home-friends-background-comparison.jpg', themes.flatMap(theme => [
      { file: `home-${theme}`, label: `Home · ${theme}` },
      { file: `friends-populated-${theme}`, label: `Friends · ${theme}` },
    ]), 2);

    const tabCropW = 270;
    const tabCropH = 125;
    const tabScale = 2;
    const tabTileW = tabCropW * tabScale;
    const tabTileH = tabCropH * tabScale;
    const tabBoardW = margin * 2 + tabTileW * 2 + gap;
    const tabBoardH = margin * 2 + themes.length * (tabTileH + labelH) + (themes.length - 1) * gap;
    const tabComposites = [];
    for (let row = 0; row < themes.length; row += 1) {
      const theme = themes[row];
      const top = margin + row * (tabTileH + labelH + gap);
      for (let col = 0; col < 2; col += 1) {
        const left = margin + col * (tabTileW + gap);
        const sourceStage = col === 0 ? 'before' : 'after';
        const crop = await sharp(path.join(gateDir, sourceStage, `friends-populated-${theme}-390x844.png`))
          .extract({ left: 60, top: 115, width: tabCropW, height: tabCropH })
          .resize(tabTileW, tabTileH)
          .png()
          .toBuffer();
        const label = `${col === 0 ? 'BEFORE' : 'AFTER'} · tabs · ${theme}`;
        const labelSvg = `<svg width="${tabTileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tabTileW / 2}" y="27" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${label}</text></svg>`;
        tabComposites.push({ input: Buffer.from(labelSvg), left, top });
        tabComposites.push({ input: crop, left, top: top + labelH });
      }
    }
    await sharp({ create: { width: tabBoardW, height: tabBoardH, channels: 3, background: '#151A19' } })
      .composite(tabComposites)
      .jpeg({ quality: 94, chromaSubsampling: '4:4:4' })
      .toFile(path.join(gateDir, 'tabs-before-after-closeup-board.jpg'));
  }
}

await browser.close();

if (stage === 'after') {
  const required = {
    noRuntimeErrors: errors.length === 0,
    activeTabInsideTrack: assertions.tabIntegration.activeInsideTrack,
    tabsAdjoinInsideTrack: Math.abs(assertions.tabIntegration.adjoiningGap) <= 1,
    sheetStartsAboveFirstRow: assertions.sheetStartsAboveFirstRow,
    sheetLeavesTabBreathingRoom: assertions.sheetTabBreathingRoom >= 24,
    artworkHasVisualPresence: assertions.addFriendBounds.artwork?.height >= 120,
    archRemainsLow: assertions.addFriendBounds.arch?.height <= 50,
    parentListRemainsVisible: assertions.parentListRemainsVisible,
    closeIsTopRight: assertions.closeIsTopRight,
    firstBackdropTapKeptSheet: assertions.firstBackdropTapKeptSheet,
    firstBackdropTapBlurredField: assertions.firstBackdropTapBlurredField,
    firstBackdropTapRetainedValue: assertions.firstBackdropTapRetainedValue,
    secondBackdropTapClosedSheet: assertions.secondBackdropTapClosedSheet,
    insideTapKeptSheet: assertions.insideTapKeptSheet,
    insideTapBlurredField: assertions.insideTapBlurredField,
    insideTapRetainedValue: assertions.insideTapRetainedValue,
    explicitCloseDismissedFocusedSheet: assertions.explicitCloseDismissedFocusedSheet,
    oneAddFriendEntryPoint: assertions.addFriendEntryPointCount === 1,
    multiFriendCountPresent: assertions.multiFriendCountPresent,
    copyRemoved: assertions.copyRemoved,
    requestsLabelPresent: assertions.requestsLabelPresent,
    inlineConfirmationVisible: assertions.inlineRemove.confirmationVisible,
    oneProfileDialogOnly: assertions.inlineRemove.nestedDialogCount === 1,
    noRedundantCancel: assertions.inlineRemove.cancelButtonCount === 0,
    oneDynamicFinalAction: assertions.inlineRemove.finalActionCount === 1,
    noDropdownChevronInRemoveRegion: assertions.inlineRemove.normalChevronCount === 0,
    removeRegionKeepsWidth: Math.abs(assertions.removeRegionBounds.armed.width - assertions.removeRegionBounds.normal.width) <= 1,
    removeRegionGrowthIsCompact: assertions.removeRegionBounds.armed.height - assertions.removeRegionBounds.normal.height <= 50,
    profileGrowthIsCompact: assertions.profileBounds.armed.height - assertions.profileBounds.normal.height <= 80,
    receivedRowFitsViewport: assertions.requestRowBounds.received?.x >= 0 && assertions.requestRowBounds.received?.width <= 390,
    sentRowFitsViewport: assertions.requestRowBounds.sent?.x >= 0 && assertions.requestRowBounds.sent?.width <= 390,
  };
  const failures = Object.entries(required).filter(([, passed]) => !passed).map(([name]) => name);
  if (failures.length) throw new Error(`Friends QA failed: ${failures.join(', ')}`);
}
