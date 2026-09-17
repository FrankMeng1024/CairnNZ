#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8095';
const output = path.resolve('_review/trails-personal-library');
const beforeOutput = path.resolve('_review/overnight-trails-product-audit');
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
  localStorage.setItem('cairn_onboarding_v1_done_trails-library-qa', 'true');
  globalThis.__cairnStores.useAppStore.setState({
    user: { id: 'trails-library-qa', name: 'Aroha', email: 'trails.qa@example.invalid' },
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
  });
});

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
  name: index === 0 ? 'Morning above the sound' : index === 1 ? 'Ridge after rain' : index === 2 ? 'Harbour evening run' : `Journey ${index + 1}`,
  syncState,
  finalGeometryState: index === 1 ? 'limited_evidence' : 'base_ready',
});
const routeFixture = (id, index = 0, syncState = 'synced') => ({
  id,
  name: index === 0 ? 'Milford Foreshore Track' : index === 1 ? 'Kepler ridge return' : index === 2 ? 'Harbour run loop' : `Saved route ${index + 1}`,
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

async function setTheme(theme) {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme);
  }, theme);
  await page.waitForTimeout(350);
}

async function resetTo(name, params) {
  await page.evaluate(({ routeName, routeParams }) => {
    globalThis.__cairnStores.navigationRef.reset({
      index: routeName === 'Home' ? 0 : 1,
      routes: routeName === 'Home'
        ? [{ name: 'Home' }]
        : [{ name: 'Home' }, { name: routeName, params: routeParams }],
    });
  }, { routeName: name, routeParams: params });
  await page.waitForFunction(routeName => globalThis.__cairnStores.getCurrentRoute() === routeName, name, { timeout: 15_000 });
  await page.waitForTimeout(500);
}

async function mountTrails(tab = 'activities') {
  await resetTo('Routes', { initialTab: tab });
}

async function seed({ sessions = [], routes = [], routeError = null }) {
  await page.evaluate(data => {
    const stores = globalThis.__cairnStores;
    stores.useSessionStore.setState({ currentUserId: 'trails-library-qa', sessions: data.sessions });
    stores.useRouteStore.setState({
      routes: data.routes,
      routesLoading: false,
      routesLoadError: data.routeError,
      circleRoutes: [],
      loadingCircleRoutes: false,
    });
    stores.useMarkerStore.setState({ userId: 'trails-library-qa', markers: [], circleMarkers: [], loadingCircle: false });
    stores.useTrackingStore.setState({ lastCoordinate: null });
  }, { sessions, routes, routeError });
  await page.waitForTimeout(300);
}

const captures = [];
async function shot(name, viewport = null) {
  if (viewport) await page.setViewportSize(viewport);
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file });
  captures.push({ name, file, width: viewport?.width ?? 390, height: viewport?.height ?? 844 });
  return file;
}

const fewSessions = [
  session('local-activity', 0, 'pending'),
  session('sync-error-activity', 1, 'sync_error'),
  session('synced-activity', 2, 'synced'),
];
const fewRoutes = [
  routeFixture('local-route', 0, 'pending'),
  routeFixture('failed-route', 1, 'failed'),
  routeFixture('synced-route', 2, 'synced'),
];

await setTheme('day');
await mountTrails('activities');
await seed({});
await shot('01-activities-empty-day-390x844');

for (const theme of ['day', 'sunset', 'night']) {
  await setTheme(theme);
  await mountTrails('activities');
  await seed({ sessions: fewSessions, routes: fewRoutes });
  await shot(`02-activities-few-${theme}-390x844`);

  await mountTrails('routes');
  await seed({ sessions: fewSessions, routes: fewRoutes });
  await shot(`03-routes-few-${theme}-390x844`);
}

await setTheme('day');
await mountTrails('routes');
await seed({ sessions: fewSessions });
await shot('04-routes-empty-day-390x844');

await mountTrails('routes');
await seed({ routes: fewRoutes, routeError: 'Network request failed' });
await shot('05-routes-local-with-server-error-day-390x844');

await mountTrails('activities');
await seed({ sessions: Array.from({ length: 300 }, (_, index) => session(`activity-${index}`, index)) });
await shot('06-activities-300-day-390x844');
const renderedForThreeHundred = await page.locator('[data-testid^="activity-record-"]').count();
await shot('07-activities-300-day-360x640', { width: 360, height: 640 });
await shot('08-activities-300-day-430x932', { width: 430, height: 932 });
await page.setViewportSize({ width: 390, height: 844 });

await mountTrails('routes');
await seed({ routes: Array.from({ length: 50 }, (_, index) => routeFixture(`route-${index}`, index)) });
await shot('09-routes-50-day-390x844');
await page.getByTestId('route-search').fill('Harbour');
await page.waitForTimeout(200);
await shot('10-route-search-day-390x844');
await page.getByTestId('route-search').fill('No such ridge');
await page.waitForTimeout(200);
await shot('11-route-search-empty-day-390x844');

await mountTrails('activities');
await seed({ sessions: Array.from({ length: 12 }, (_, index) => session(`filter-${index}`, index)) });
await page.getByTestId('activity-search').fill('Harbour');
await page.waitForTimeout(200);
await shot('12-activity-search-day-390x844');

await mountTrails('routes');
await seed({ routes: fewRoutes });
await page.getByText('Milford Foreshore Track', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MapHistory', null, { timeout: 15_000 });
await page.getByText('Use for a Hike', { exact: true }).waitFor({ timeout: 15_000 });
await shot('13-route-detail-use-first-day-390x844');
await page.getByText('Use for a Hike', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Hiking', null, { timeout: 15_000 });
await page.getByText('Route selected · shown on the map for guidance', { exact: true }).waitFor({ timeout: 15_000 });
await shot('14-route-guidance-hike-day-390x844');

await setTheme('night');
await mountTrails('routes');
await seed({ routes: fewRoutes });
await page.getByText('Milford Foreshore Track', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'MapHistory', null, { timeout: 15_000 });
await page.waitForTimeout(400);
await shot('15-route-detail-use-first-night-390x844');

await setTheme('day');
await seed({ sessions: fewSessions, routes: fewRoutes });
await resetTo('Home');
await shot('16-family-home-day-390x844');
await resetTo('Friends');
await shot('17-family-friends-day-390x844');
await resetTo('Hiking');
await shot('18-family-hike-day-390x844');

async function makeBoard(fileName, names, columns = 3) {
  const items = names.map(name => captures.find(item => item.name === name)).filter(Boolean);
  const tileW = 390;
  const tileH = 844;
  const labelH = 46;
  const gap = 18;
  const rows = Math.ceil(items.length / columns);
  const composites = [];
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const left = gap + col * (tileW + gap);
    const top = gap + row * (labelH + tileH + gap);
    const label = item.name.replace(/^\d+-/, '').replace(/-390x844$/, '').replaceAll('-', ' ');
    const svg = `<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="29" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${label}</text></svg>`;
    composites.push({ input: Buffer.from(svg), left, top });
    composites.push({ input: item.file, left, top: top + labelH });
  }
  await sharp({ create: { width: gap + columns * (tileW + gap), height: gap + rows * (labelH + tileH + gap), channels: 3, background: '#151A19' } })
    .composite(composites)
    .jpeg({ quality: 90 })
    .toFile(path.join(output, fileName));
}

await makeBoard('trails-after-themes-and-states.jpg', [
  '01-activities-empty-day-390x844',
  '02-activities-few-day-390x844',
  '03-routes-few-day-390x844',
  '02-activities-few-sunset-390x844',
  '03-routes-few-sunset-390x844',
  '05-routes-local-with-server-error-day-390x844',
  '02-activities-few-night-390x844',
  '03-routes-few-night-390x844',
  '15-route-detail-use-first-night-390x844',
]);
await makeBoard('trails-after-scale-search-and-use.jpg', [
  '06-activities-300-day-390x844',
  '09-routes-50-day-390x844',
  '10-route-search-day-390x844',
  '12-activity-search-day-390x844',
  '13-route-detail-use-first-day-390x844',
  '14-route-guidance-hike-day-390x844',
]);
await makeBoard('trails-product-family.jpg', [
  '16-family-home-day-390x844',
  '17-family-friends-day-390x844',
  '18-family-hike-day-390x844',
  '02-activities-few-day-390x844',
  '03-routes-few-day-390x844',
  '14-route-guidance-hike-day-390x844',
]);

const beforeBoard = path.join(beforeOutput, 'trails-current-state-board.jpg');
if (fs.existsSync(beforeBoard)) {
  const afterBoard = path.join(output, 'trails-after-themes-and-states.jpg');
  const [beforeMeta, afterMeta] = await Promise.all([sharp(beforeBoard).metadata(), sharp(afterBoard).metadata()]);
  const targetW = 1224;
  const before = await sharp(beforeBoard).resize({ width: targetW }).toBuffer();
  const after = await sharp(afterBoard).resize({ width: targetW }).toBuffer();
  const beforeH = Math.round((beforeMeta.height ?? 1) * targetW / (beforeMeta.width ?? targetW));
  const afterH = Math.round((afterMeta.height ?? 1) * targetW / (afterMeta.width ?? targetW));
  const headingH = 58;
  const svgBefore = `<svg width="${targetW}" height="${headingH}"><rect width="100%" height="100%" fill="#151A19"/><text x="24" y="38" font-family="Arial" font-size="24" font-weight="700" fill="#F5F3EC">BEFORE · audited mixed browser</text></svg>`;
  const svgAfter = `<svg width="${targetW}" height="${headingH}"><rect width="100%" height="100%" fill="#151A19"/><text x="24" y="38" font-family="Arial" font-size="24" font-weight="700" fill="#F5F3EC">AFTER · personal journey library</text></svg>`;
  await sharp({ create: { width: targetW, height: headingH + beforeH + headingH + afterH, channels: 3, background: '#151A19' } })
    .composite([
      { input: Buffer.from(svgBefore), left: 0, top: 0 },
      { input: before, left: 0, top: headingH },
      { input: Buffer.from(svgAfter), left: 0, top: headingH + beforeH },
      { input: after, left: 0, top: headingH + beforeH + headingH },
    ])
    .jpeg({ quality: 89 })
    .toFile(path.join(output, 'trails-before-after-board.jpg'));
}

const bodyText = await page.locator('body').innerText();
const observations = {
  renderedRowsForThreeHundred: renderedForThreeHundred,
  virtualizationBounded: renderedForThreeHundred < 100,
  finalRoute: await page.evaluate(() => globalThis.__cairnStores.getCurrentRoute()),
  legacyLanguageVisibleAtEnd: /\b(Mark|Marker|Flag)\b/.test(bodyText),
};

await browser.close();
const uniqueErrors = [...new Set(runtimeErrors)];
fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify({
  captures: captures.map(({ name, file, width, height }) => ({ name, file, width, height })),
  observations,
  runtimeErrors: uniqueErrors,
}, null, 2)}\n`);
console.log(JSON.stringify({ output, captureCount: captures.length, observations, runtimeErrors: uniqueErrors }, null, 2));
if (uniqueErrors.length > 0 || !observations.virtualizationBounded) process.exitCode = 1;
