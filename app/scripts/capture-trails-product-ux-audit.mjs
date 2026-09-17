#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8095';
const output = path.resolve('_review/overnight-trails-product-audit');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(output, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: chromePath });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  geolocation: { latitude: -44.6717, longitude: 167.9256 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
await page.route('**/api/**', route => route.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify({ data: [], routes: [], markers: [], notifications: [], count: 0 }),
}));

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(() => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_trails-product-audit', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'trails-product-audit', name: 'Aroha', email: 'trails.audit@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
  });
});
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });

const now = Date.now();
const points = [
  { lat: -44.6722, lng: 167.9190, alt: 20, t: now - 3_600_000, segmentId: 'segment-a', segmentStartReason: 'start' },
  { lat: -44.6708, lng: 167.9225, alt: 42, t: now - 2_400_000, segmentId: 'segment-a' },
  { lat: -44.6692, lng: 167.9260, alt: 68, t: now - 1_200_000, segmentId: 'segment-a' },
];
const session = (id, index = 0, syncState = 'synced') => ({
  id,
  clientActivityId: id,
  activityMode: index % 3 === 2 ? 'running' : 'hiking',
  regionCode: 'nz',
  startedAt: now - index * 86_400_000 - 3_600_000,
  endedAt: now - index * 86_400_000,
  durationS: 3_600 + index * 73,
  distanceM: 5_100 + index * 217,
  elevationGainM: 210 + index * 11,
  trackPoints: points.map(point => ({ ...point, t: point.t - index * 86_400_000 })),
  markerIds: [],
  name: index === 0 ? 'Morning above the sound' : index === 1 ? 'Ridge after rain' : `Journey ${index + 1}`,
  syncState,
  finalGeometryState: index === 1 ? 'limited_evidence' : 'base_ready',
});
const routeFixture = (id, index = 0, syncState = 'synced') => ({
  id,
  name: index === 0 ? 'Milford Foreshore Track' : index === 1 ? 'Kepler ridge return' : `Saved route ${index + 1}`,
  createdAt: now - index * 86_400_000,
  updatedAt: now - index * 43_200_000,
  points: points.map(({ lat, lng, alt }) => ({ lat, lng, alt })),
  originalPoints: points.map(({ lat, lng, alt }) => ({ lat, lng, alt })),
  waypoints: [],
  distanceM: 6_400 + index * 340,
  elevationGainM: 214 + index * 20,
  runCount: index,
  isActive: false,
  activityMode: index % 3 === 2 ? 'running' : 'hiking',
  permission: 'personal',
  syncState,
});
const cairn = (id, index = 0, syncState = 'synced') => ({
  id,
  clientCairnId: id,
  localId: syncState === 'synced' ? undefined : id,
  type: ['viewpoint', 'cairn', 'water', 'junction'][index % 4],
  regionCode: 'nz',
  lat: -44.6692 + index * 0.001,
  lng: 167.9260 + index * 0.001,
  note: `${index === 0 ? 'Lake edge' : `Cairn ${index + 1}`}\u001EA calm place to return to after rain.`,
  authorId: 'trails-product-audit',
  createdAt: now - index * 86_400_000,
  permission: index % 3 === 1 ? 'group' : 'personal',
  synced: syncState === 'synced',
  syncState,
  approximate: index === 2,
});

async function setTheme(theme) {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme);
  }, theme);
  await page.waitForTimeout(350);
}

async function mountTrails(tab = 'activities') {
  await page.evaluate(initialTab => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'Routes', params: { initialTab } }],
    });
  }, tab);
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Routes', null, { timeout: 15_000 });
  await page.waitForTimeout(650);
}

async function seed({ sessions = [], routes = [], markers = [], circleRoutes = [], circleMarkers = [] }) {
  await page.evaluate(data => {
    const stores = globalThis.__cairnStores;
    stores.useSessionStore.setState({ currentUserId: 'trails-product-audit', sessions: data.sessions });
    stores.useRouteStore.setState({ routes: data.routes, circleRoutes: data.circleRoutes, loadingCircleRoutes: false });
    stores.useMarkerStore.setState({ userId: 'trails-product-audit', markers: data.markers, circleMarkers: data.circleMarkers, loadingCircle: false });
    stores.useTrackingStore.setState({ lastCoordinate: null });
  }, { sessions, routes, markers, circleRoutes, circleMarkers });
  await page.waitForTimeout(250);
}

const captures = [];
async function shot(name, viewport = null) {
  if (viewport) await page.setViewportSize(viewport);
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file });
  captures.push({ name, file, width: viewport?.width ?? 390, height: viewport?.height ?? 844 });
  return file;
}

await setTheme('day');
await mountTrails('activities');
await seed({});
await shot('01-empty-activities-day-390x844');

await mountTrails('routes');
await seed({});
await shot('02-empty-routes-day-390x844');

await mountTrails('flags');
await seed({});
await shot('03-empty-cairns-day-390x844');

const fewSessions = [session('local-activity', 0, 'pending'), session('sync-error-activity', 1, 'sync_error'), session('synced-activity', 2, 'synced')];
const fewRoutes = [routeFixture('local-route', 0, 'pending'), routeFixture('failed-route', 1, 'failed'), routeFixture('synced-route', 2, 'synced')];
const fewCairns = [cairn('local-cairn', 0, 'pending'), cairn('failed-cairn', 1, 'failed'), cairn('synced-cairn', 2, 'synced')];

for (const theme of ['day', 'sunset', 'night']) {
  await setTheme(theme);
  await mountTrails('activities');
  await seed({ sessions: fewSessions, routes: fewRoutes, markers: fewCairns });
  await shot(`04-activities-few-${theme}-390x844`);

  await mountTrails('routes');
  await seed({ sessions: fewSessions, routes: fewRoutes, markers: fewCairns });
  await shot(`05-routes-few-${theme}-390x844`);

  await mountTrails('flags');
  await seed({ sessions: fewSessions, routes: fewRoutes, markers: fewCairns });
  await shot(`06-cairns-few-${theme}-390x844`);
}

await setTheme('day');
await mountTrails('activities');
await seed({ sessions: Array.from({ length: 30 }, (_, index) => session(`activity-${index}`, index, 'synced')) });
await shot('07-activities-many-day-390x844');
await shot('08-activities-many-day-360x640', { width: 360, height: 640 });
await shot('09-activities-many-day-430x932', { width: 430, height: 932 });
await page.setViewportSize({ width: 390, height: 844 });

await mountTrails('routes');
await seed({ routes: fewRoutes });
await page.getByLabel('Search routes').fill('does not exist');
await page.waitForTimeout(200);
await shot('10-route-search-no-results-day-390x844');

await mountTrails('activities');
await seed({ sessions: fewSessions, routes: fewRoutes, markers: fewCairns });
await page.getByText('Morning above the sound', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MapHistory', null, { timeout: 15_000 });
await page.getByText('Waiting to sync', { exact: true }).waitFor({ timeout: 15_000 });
await shot('11-local-activity-detail-day-390x844');

await mountTrails('routes');
await seed({ routes: fewRoutes });
await page.getByText('Milford Foreshore Track', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MapHistory', null, { timeout: 15_000 });
await page.waitForTimeout(500);
await shot('12-local-route-detail-day-390x844');

await mountTrails('flags');
await seed({ markers: fewCairns });
await page.getByText('Lake edge', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MarkerDetail', null, { timeout: 15_000 });
await page.waitForTimeout(500);
await shot('13-local-cairn-detail-day-390x844');

const friendRoute = { ...routeFixture('friend-route', 0, 'synced'), name: 'A friend shared route', sharedBy: 'Mia Rangi', permission: 'friend' };
await mountTrails('routes');
await seed({ circleRoutes: [friendRoute] });
await page.getByText('Friends', { exact: true }).last().click();
await page.waitForTimeout(250);
await page.getByText('A friend shared route', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MapHistory', null, { timeout: 15_000 });
await shot('14-friend-route-detail-broken-day-390x844');

const friendCairn = { ...cairn('friend-cairn', 0, 'synced'), note: 'Friend ridge note\u001EFresh water below.', authorId: 'friend-1', authorName: 'Mia Rangi', permission: 'group' };
await mountTrails('flags');
await seed({ circleMarkers: [friendCairn] });
await page.getByText('Friends', { exact: true }).last().click();
await page.waitForTimeout(250);
await page.getByText('Friend ridge note', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MarkerDetail', null, { timeout: 15_000 });
await shot('15-friend-cairn-detail-broken-day-390x844');

const observations = await page.evaluate(() => {
  const body = document.body.innerText;
  return {
    currentRoute: globalThis.__cairnStores.getCurrentRoute(),
    friendCairnNotFound: body.includes('Cairn not found'),
  };
});

const boardItems = captures.filter(({ name }) => /empty-|activities-few-|routes-few-|cairns-few-|many-day-390|local-activity-detail|local-route-detail|local-cairn-detail|friend-route|friend-cairn/.test(name));
const tileW = 390;
const tileH = 844;
const labelH = 44;
const gap = 18;
const columns = 3;
const rows = Math.ceil(boardItems.length / columns);
const boardW = gap + columns * (tileW + gap);
const boardH = gap + rows * (labelH + tileH + gap);
const composites = [];
for (let index = 0; index < boardItems.length; index += 1) {
  const item = boardItems[index];
  const col = index % columns;
  const row = Math.floor(index / columns);
  const left = gap + col * (tileW + gap);
  const top = gap + row * (labelH + tileH + gap);
  const label = item.name.replace(/^\d+-/, '').replace(/-390x844$/, '').replaceAll('-', ' ');
  const svg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="28" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${label}</text></svg>`;
  composites.push({ input: Buffer.from(svg), left, top });
  composites.push({ input: item.file, left, top: top + labelH });
}
await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
  .composite(composites)
  .jpeg({ quality: 90 })
  .toFile(path.join(output, 'trails-current-state-board.jpg'));

await browser.close();
fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify({ captures: captures.map(({ name, file }) => ({ name, file })), observations, runtimeErrors: [...new Set(runtimeErrors)] }, null, 2)}\n`);
console.log(JSON.stringify({ output, captureCount: captures.length, observations, runtimeErrors: [...new Set(runtimeErrors)] }, null, 2));
if (runtimeErrors.length > 0) process.exitCode = 1;
