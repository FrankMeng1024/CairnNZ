import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve('..', 'docs', 'review', 'system-ui-detail-convergence-gate');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const times = ['day', 'sunset', 'night'];
const screens = [
  { key: 'friends', label: 'Friends', route: 'Friends' },
  { key: 'memory', label: 'Memory', route: 'Memory' },
  { key: 'trails', label: 'Trails', route: 'Routes', params: { initialTab: 'routes' } },
  { key: 'activity-detail', label: 'Activity detail', route: 'MapHistory', params: { sessionId: 'qa-session' } },
  { key: 'route-detail', label: 'Route detail', route: 'MapHistory', params: { routeId: 'qa-route' } },
  { key: 'cairn-list', label: 'Cairn list', route: 'Routes', params: { initialTab: 'flags' } },
  { key: 'cairn-detail', label: 'Cairn detail', route: 'MarkerDetail', params: { markerId: 'qa-cairn' } },
];

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
page.on('pageerror', (error) => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', (message) => {
  if (message.type() === 'error') runtimeErrors.push(`console: ${message.text()}`);
});
await page.route('**/api/**', async (route) => {
  const url = route.request().url();
  if (url.endsWith('/api/friends')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
      { id: 1, name: 'Mia Rangi', email: 'mia@example.com', added_at: new Date(Date.now() - 86400000).toISOString() },
      { id: 2, name: 'Theo Walker', email: 'theo@example.com', added_at: new Date(Date.now() - 172800000).toISOString() },
    ]) });
    return;
  }
  if (url.endsWith('/api/routes')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routes: [{
      id: 'qa-route', user_id: 1, name: 'Milford Foreshore Track', description: 'A quiet route between beech forest and the sound.',
      distance_m: 6400, elevation_gain_m: 214, run_count: 3, last_run_at: new Date(Date.now() - 86400000).toISOString(),
      created_at: new Date(Date.now() - 604800000).toISOString(), updated_at: new Date(Date.now() - 86400000).toISOString(), permission: 'personal',
    }] }) });
    return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], routes: [], markers: [], notifications: [], count: 0 }) });
});

const settle = (ms = 1100) => page.waitForTimeout(ms);
async function navigate(route, params) {
  await page.evaluate(({ name, routeParams }) => {
    globalThis.__cairnStores?.navigationRef?.navigate(name, routeParams);
  }, { name: route, routeParams: params });
  await settle(1400);
}
async function setTime(time) {
  await page.evaluate((nextTime) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTime });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTime);
  }, time);
  await settle(700);
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120000 });

await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_visual-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: {
      id: 'system-ui-qa', name: 'Aroha', email: 'visual.qa@example.com',
      createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
      hasPassword: true, providers: ['email'],
    },
    isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
  });
  stores.useFriendStore.setState({
    friends: [
      { id: 'f1', userId: 'f1', name: 'Mia Rangi', email: 'mia@example.com', addedAt: Date.now() - 86400000, shareMarkers: true },
      { id: 'f2', userId: 'f2', name: 'Theo Walker', email: 'theo@example.com', addedAt: Date.now() - 172800000, shareMarkers: true },
    ],
  });
  const points = [
    { lat: -44.6722, lng: 167.9190, alt: 20 },
    { lat: -44.6708, lng: 167.9225, alt: 42 },
    { lat: -44.6692, lng: 167.9260, alt: 68 },
    { lat: -44.6677, lng: 167.9300, alt: 91 },
  ];
  stores.useRouteStore.setState({ routes: [{
    id: 'qa-route', name: 'Milford Foreshore Track', description: 'A quiet route between beech forest and the sound.',
    createdAt: Date.now() - 604800000, updatedAt: Date.now() - 86400000,
    points, originalPoints: points, waypoints: [], distanceM: 6400, elevationGainM: 214,
    runCount: 3, lastRunAt: Date.now() - 86400000, isActive: false, activityMode: 'hiking', permission: 'personal',
  }] });
  stores.useSessionStore.setState({ currentUserId: 'system-ui-qa', sessions: [{
    id: 'qa-session', activityMode: 'hiking', regionCode: 'nz',
    startedAt: Date.now() - 10800000, endedAt: Date.now() - 7200000,
    durationS: 3600, distanceM: 7200, elevationGainM: 286, trackPoints: points.map((p, index) => ({ ...p, t: Date.now() - (4 - index) * 900000 })),
    markerIds: ['qa-cairn'], name: 'Morning above the sound', memoryNewCells: 14,
  }] });
  stores.useMarkerStore.setState({ userId: 'system-ui-qa', markers: [{
    id: 'qa-cairn', type: 'viewpoint', regionCode: 'nz', lat: -44.6692, lng: 167.9260,
    note: `Lake edge\u001EA calm place to return to after rain.`, authorId: 'system-ui-qa',
    createdAt: Date.now() - 86400000, permission: 'personal', synced: true, alt: 68,
  }], circleMarkers: [], publicMarkers: [] });
  stores.useMemoryStore.setState({
    points: points.map((p, index) => ({ lat: p.lat, lng: p.lng, ts: Date.now() - index * 600000, cid: `qa-memory-${index}`, synced: true })),
    lastWatcherFix: { lat: -44.6717, lng: 167.9256, ts: Date.now() }, geometryVersion: 1, initialRevealDone: true,
  });
});
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Home', null, { timeout: 30000 });

for (const time of times) {
  await setTime(time);
  for (const screen of screens) {
    await navigate(screen.route, screen.params);
    if (screen.key === 'memory') {
      const gotIt = page.getByText('Got it', { exact: true }).last();
      if (await gotIt.isVisible().catch(() => false)) {
        await gotIt.click();
        await settle(600);
      }
    }
    await page.screenshot({ path: path.join(outputDir, `${screen.key}-${time}-390x844.png`) });
  }
  await navigate('Friends');
  const addFriend = page.getByLabel('Add friend').last();
  if (await addFriend.isVisible().catch(() => false)) {
    await addFriend.click();
    await settle(700);
    await page.screenshot({ path: path.join(outputDir, `friends-add-sheet-${time}-390x844.png`) });
    const cancel = page.getByText('Cancel', { exact: true }).last();
    if (await cancel.isVisible().catch(() => false)) {
      await cancel.click();
      await settle(500);
    }
  }
}

const tileW = 390;
const tileH = 844;
const labelH = 42;
const gap = 20;
const margin = 42;
const boardW = margin * 2 + screens.length * tileW + (screens.length - 1) * gap;
const boardH = margin * 2 + times.length * (tileH + labelH) + (times.length - 1) * gap;
const composites = [];
for (let row = 0; row < times.length; row += 1) {
  for (let col = 0; col < screens.length; col += 1) {
    const screen = screens[col];
    const time = times[row];
    const left = margin + col * (tileW + gap);
    const top = margin + row * (tileH + labelH + gap);
    const label = `${screen.label} · ${time[0].toUpperCase()}${time.slice(1)}`;
    const svg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="28" text-anchor="middle" font-family="Arial" font-size="15" font-weight="600" fill="#F5F3EC">${label}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left, top });
    composites.push({ input: path.join(outputDir, `${screen.key}-${time}-390x844.png`), left, top: top + labelH });
  }
}
await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
  .composite(composites).jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'centralized-detail-convergence-board.jpg'));

const modalComposites = [];
for (let i = 0; i < times.length; i += 1) {
  const time = times[i];
  const left = margin + i * (tileW + gap);
  modalComposites.push({ input: path.join(outputDir, `friends-add-sheet-${time}-390x844.png`), left, top: margin });
}
await sharp({ create: { width: margin * 2 + times.length * tileW + 2 * gap, height: margin * 2 + tileH, channels: 3, background: '#151A19' } })
  .composite(modalComposites).jpeg({ quality: 92 }).toFile(path.join(outputDir, 'modal-material-review-board.jpg'));

const uniqueErrors = [...new Set(runtimeErrors)].filter((line) => !line.includes('favicon'));
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'README.md'), `# System UI detail convergence gate\n\nReal Expo Web captures at 390×844 covering Friends, Memory, Trails, Activity detail, Route detail, Cairn list, Cairn detail, and the Add Friend sheet across Day, Sunset, and Night. Fixtures are local-only and no backend writes are performed.\n`);
await browser.close();
console.log(`Created ${screens.length * times.length + times.length} captures and 2 boards in ${outputDir}`);
