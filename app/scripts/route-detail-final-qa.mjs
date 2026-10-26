#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8098';
const output = path.resolve(process.env.CAIRN_QA_ARTIFACT_DIR || '/tmp/cairn24-route-detail');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(output, { recursive: true });

const user = {
  id: 'route-detail-final-qa',
  name: 'Aroha',
  email: 'route.detail.qa@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};
const points = [
  { lng: 174.7638, lat: -36.8482, alt: 22 },
  { lng: 174.7650, lat: -36.8480, alt: 38 },
  { lng: 174.7661, lat: -36.8475, alt: 67 },
  { lng: 174.7670, lat: -36.8469, alt: 82 },
];
const ownRoute = {
  id: 'route-detail-own',
  clientRouteId: 'route-detail-own',
  name: 'Milford Foreshore Track',
  createdAt: 1_760_000_000_000,
  updatedAt: 1_760_000_000_000,
  points,
  originalPoints: points,
  waypoints: [],
  distanceM: 6400,
  elevationGainM: 214,
  runCount: 3,
  isActive: false,
  activityMode: 'hiking',
  permission: 'personal',
  resolutionState: 'continuous',
  creationOrigin: 'planned',
  originPersistence: 'pending',
  syncState: 'synced',
};
const longOwnRoute = {
  ...ownRoute,
  id: 'route-detail-long',
  clientRouteId: 'route-detail-long',
  name: 'Milford Foreshore Track through the quiet beech forest and harbour edge',
  distanceM: 42860,
  elevationGainM: 3840,
};
const receivedRoute = {
  ...ownRoute,
  id: 'route-detail-received',
  clientRouteId: undefined,
  name: 'Te Ara shared harbour loop',
  permission: 'friends',
  sharedBy: 'Mia Rangi',
  sharedDeliveryId: 'delivery-route-detail-received',
  sharedContentHash: 'qa-hash',
  originPersistence: 'durable',
};

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  geolocation: { latitude: -36.8480, longitude: 174.7650, accuracy: 8 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
await context.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'route-detail-final-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_route-detail-final-qa', 'true');
});
const page = await context.newPage();
const runtimeErrors = [];
const captures = [];
const assertions = {};
const mapNetwork = [];
const routeMutationNetwork = [];
let activeMapEvidence = null;

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${message.text()}`);
  }
});
page.on('response', response => {
  const url = new URL(response.url());
  if (url.pathname.includes('/api/routes/shared/')) {
    routeMutationNetwork.push({ method: response.request().method(), path: url.pathname, status: response.status() });
  }
  if (!url.hostname.includes('mapbox.com')) return;
  mapNetwork.push({ host: url.hostname, path: url.pathname, status: response.status() });
});
page.on('requestfailed', request => {
  const url = new URL(request.url());
  if (url.pathname.includes('/api/routes/shared/')) {
    routeMutationNetwork.push({ method: request.method(), path: url.pathname, failed: request.failure()?.errorText ?? 'unknown' });
  }
  if (!url.hostname.includes('mapbox.com')) return;
  mapNetwork.push({ host: url.hostname, path: url.pathname, failed: request.failure()?.errorText ?? 'unknown' });
});
page.on('dialog', dialog => dialog.dismiss());
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/auth/me') return json({ user });
  if (url.pathname === '/api/friends') return json([{ id: 41, name: 'Mia Rangi', email: 'mia@example.invalid', added_at: new Date().toISOString() }]);
  if (request.method() === 'DELETE') return json({ deleted: true, state: 'deleted' });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 500) => page.waitForTimeout(ms);
const currentRoute = name => page.waitForFunction(
  expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected,
  name,
  { timeout: 20_000 },
);
async function setTheme(theme) {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: nextTheme, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme);
  }, theme);
  await settle(300);
}
async function seedRoutes() {
  await page.evaluate(({ own, longOwn, received, ownerId }) => {
    const stores = globalThis.__cairnStores;
    stores.useRouteStore.setState({
      routes: [own, longOwn],
      sharedRoutes: [received],
      routeOwnerId: ownerId,
      routesLoading: false,
      routesLoadError: false,
      routeDetailState: { [own.id]: 'ready', [longOwn.id]: 'ready' },
    });
    stores.useTrackingStore.setState({ status: 'idle', activityMode: null, sessionId: null });
    stores.useFriendStore.setState({
      friends: [{ id: '41', userId: '41', name: 'Mia Rangi', email: 'mia@example.invalid', addedAt: Date.now(), shareMarkers: true }],
    });
  }, { own: ownRoute, longOwn: longOwnRoute, received: receivedRoute, ownerId: user.id });
}
async function openDetail({ routeId, sharedDeliveryId, theme, viewport }) {
  await page.setViewportSize(viewport);
  await setTheme(theme);
  await seedRoutes();
  await page.evaluate(params => {
    globalThis.__cairnStores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'MapHistory', params }],
    });
  }, routeId ? { routeId } : { sharedDeliveryId });
  await currentRoute('MapHistory');
  await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.locator('.mapboxgl-map:visible canvas').last().waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.isStyleLoaded?.()), null, { timeout: 30_000 });
  await page.waitForFunction(() => {
    try {
      const map = globalThis.__cairnMap;
      return (map?.queryRenderedFeatures?.() ?? []).some(feature => !String(feature.source ?? '').startsWith('route-detail-'));
    } catch { return false; }
  }, null, { timeout: 30_000 });
  await settle(350);
  activeMapEvidence = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    let renderedBasemapFeatureCount = 0;
    try {
      renderedBasemapFeatureCount = (map?.queryRenderedFeatures?.() ?? [])
        .filter(feature => !String(feature.source ?? '').startsWith('route-detail-')).length;
    } catch { /* diagnostic only */ }
    const canvas = document.querySelector('.mapboxgl-map canvas');
    const rect = canvas?.getBoundingClientRect();
    const style = canvas ? getComputedStyle(canvas) : null;
    return {
      loaded: Boolean(map?.loaded?.()),
      styleLoaded: Boolean(map?.isStyleLoaded?.()),
      tilesLoaded: Boolean(map?.areTilesLoaded?.()),
      renderedBasemapFeatureCount,
      canvas: rect ? { width: rect.width, height: rect.height, opacity: style?.opacity, display: style?.display, visibility: style?.visibility } : null,
    };
  });
}
async function shot(name) {
  const file = path.join(output, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const viewport = page.viewportSize();
  captures.push({ name, file, viewport });
  return file;
}
async function box(testId) {
  return page.getByTestId(testId).boundingBox();
}
async function assertOwnLayout(label) {
  const panel = await box('route-detail-panel');
  const share = await box('route-share-action');
  const hike = await box('route-use-action');
  const run = await box('route-use-run-action');
  const edit = await page.getByLabel('Edit route').boundingBox();
  const destructive = await box('route-delete-action');
  const canvas = await page.locator('.mapboxgl-map:visible canvas').last().boundingBox();
  const logo = await page.locator('.mapboxgl-ctrl-logo:visible').last().boundingBox();
  const attribution = await page.locator('.mapboxgl-ctrl-attrib:visible').last().boundingBox();
  const ellipsisCount = await page.getByTestId('route-detail-header-more').count();
  const title = await page.getByLabel('Rename route').boundingBox();
  const width = page.viewportSize()?.width ?? 0;
  assertions[label] = {
    realMapboxCanvas: Boolean(canvas && canvas.width > 0 && canvas.height > 0),
    styleLoaded: activeMapEvidence?.styleLoaded === true,
    realBasemapFeaturesRendered: (activeMapEvidence?.renderedBasemapFeatureCount ?? 0) > 0,
    noHeaderEllipsis: ellipsisCount === 0,
    shareTransparentHitArea: Boolean(share && share.width >= 44 && share.height >= 44),
    shareBesideTitle: Boolean(share && title && share.x >= title.x + title.width && share.y < title.y + title.height + 4),
    threeActionsVisible: Boolean(hike && run && edit),
    threeActionsAligned: Boolean(hike && run && edit && Math.abs(hike.y - run.y) < 1 && Math.abs(run.y - edit.y) < 1 && Math.abs(hike.height - run.height) < 1 && Math.abs(run.height - edit.height) < 1),
    actionsMin44: Boolean(hike && run && edit && hike.height >= 44 && run.height >= 44 && edit.height >= 44),
    destructiveBelowActions: Boolean(destructive && hike && destructive.y >= hike.y + hike.height),
    noHorizontalClipping: Boolean(panel && panel.x >= 0 && panel.x + panel.width <= width + 0.5 && share && share.x + share.width <= width),
    legalControlsAbovePanel: Boolean(panel && logo && attribution && logo.y + logo.height <= panel.y && attribution.y + attribution.height <= panel.y),
    logoAtLeft: Boolean(logo && logo.x + logo.width <= width / 2),
    attributionAtRight: Boolean(attribution && attribution.x >= width / 2),
  };
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(nextUser => {
  localStorage.setItem('cairn_jwt', 'route-detail-final-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${nextUser.id}`, 'true');
  globalThis.__cairnStores.useAppStore.setState({ user: nextUser, isLoggedIn: true, hydrated: true, sessionExpired: false });
}, user);
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef?.reset), null, { timeout: 30_000 });

for (const theme of ['day', 'sunset', 'night']) {
  await openDetail({ routeId: ownRoute.id, theme, viewport: { width: 390, height: 844 } });
  await assertOwnLayout(`own-${theme}-390`);
  await shot(`own-${theme}-390x844`);
}

await openDetail({ routeId: longOwnRoute.id, theme: 'day', viewport: { width: 320, height: 568 } });
await assertOwnLayout('long-day-320');
await shot('long-name-day-320x568');

await openDetail({ routeId: longOwnRoute.id, theme: 'night', viewport: { width: 430, height: 932 } });
await assertOwnLayout('long-night-430');
await shot('long-name-night-430x932');

await openDetail({ sharedDeliveryId: receivedRoute.sharedDeliveryId, theme: 'sunset', viewport: { width: 390, height: 844 } });
assertions.receivedPermissions = {
  shareAbsent: await page.getByTestId('route-share-action').count() === 0,
  removeVisible: await page.getByText('Remove', { exact: true }).isVisible(),
  editVisible: await page.getByLabel('Edit route').isVisible(),
  hikeVisible: await page.getByTestId('route-use-action').isVisible(),
  runVisible: await page.getByTestId('route-use-run-action').isVisible(),
};
await shot('received-sunset-390x844');
await page.getByTestId('route-delete-action').click();
await page.getByTestId('route-delete-confirmation').waitFor({ state: 'visible' });
await settle(400);
await shot('received-remove-confirmation-sunset-390x844');
await page.getByText('Keep Route', { exact: true }).click();

await openDetail({ routeId: ownRoute.id, theme: 'day', viewport: { width: 390, height: 844 } });
await page.getByTestId('route-share-action').click();
await page.getByTestId('route-share-friend-picker').waitFor({ state: 'visible' });
await settle(400);
assertions.shareFlow = { pickerVisible: true, originalFriendVisible: await page.getByText('Mia Rangi', { exact: true }).isVisible() };
await shot('share-picker-day-390x844');
await page.getByText('Done', { exact: true }).click();
await page.getByTestId('route-delete-action').click();
await page.getByTestId('route-delete-confirmation').waitFor({ state: 'visible' });
await settle(400);
await shot('delete-confirmation-day-390x844');
await page.getByText('Keep Route', { exact: true }).click();

async function assertNavigation(testId, expectedRoute, expectedParam) {
  await openDetail({ routeId: ownRoute.id, theme: 'day', viewport: { width: 390, height: 844 } });
  await page.getByTestId(testId).click();
  await currentRoute(expectedRoute);
  return page.evaluate(({ routeName, param }) => {
    const current = globalThis.__cairnStores.navigationRef.getCurrentRoute?.();
    return {
      route: current?.name,
      routeId: current?.params?.routeId,
      paramPreserved: current?.params?.routeId === param,
      routeReferenceId: globalThis.__cairnStores.useRouteStore.getState().activityRouteReference?.routeId ?? null,
      expectedRoute: routeName,
    };
  }, { routeName: expectedRoute, param: expectedParam });
}
assertions.hikeNavigation = await assertNavigation('route-use-action', 'Hiking', ownRoute.id);
assertions.runNavigation = await assertNavigation('route-use-run-action', 'Running', ownRoute.id);
assertions.editNavigation = await assertNavigation('route-edit-action', 'RouteEditor', ownRoute.id);

await openDetail({ routeId: ownRoute.id, theme: 'day', viewport: { width: 390, height: 844 } });
await page.getByRole('button', { name: 'Back', exact: true }).click();
await currentRoute('Home');
assertions.backNavigation = { returnedHome: true };

await openDetail({ routeId: ownRoute.id, theme: 'day', viewport: { width: 390, height: 844 } });
await page.getByTestId('route-delete-action').click();
await page.getByTestId('route-delete-confirm').click();
await currentRoute('Home');
assertions.deleteBehavior = await page.evaluate(id => ({ removed: !globalThis.__cairnStores.useRouteStore.getState().routes.some(route => route.id === id) }), ownRoute.id);

await openDetail({ sharedDeliveryId: receivedRoute.sharedDeliveryId, theme: 'day', viewport: { width: 390, height: 844 } });
await page.getByTestId('route-delete-action').click();
await page.getByTestId('route-delete-confirm').click();
await page.getByTestId('route-delete-confirmation').waitFor({ state: 'hidden', timeout: 20_000 });
await settle(500);
assertions.removeBehavior = await page.evaluate(deliveryId => {
  const current = globalThis.__cairnStores.navigationRef.getCurrentRoute?.();
  return {
    removed: !globalThis.__cairnStores.useRouteStore.getState().sharedRoutes.some(route => route.sharedDeliveryId === deliveryId),
    returnedHome: current?.name === 'Home',
    currentRoute: current?.name ?? null,
    currentUserId: globalThis.__cairnStores.useAppStore.getState().user?.id ?? null,
    routeActionError: document.querySelector('[data-testid="route-action-error"]')?.textContent ?? null,
  };
}, receivedRoute.sharedDeliveryId);

const boardNames = [
  'own-day-390x844', 'own-sunset-390x844', 'own-night-390x844',
  'long-name-day-320x568', 'long-name-night-430x932', 'received-sunset-390x844',
  'share-picker-day-390x844', 'delete-confirmation-day-390x844', 'received-remove-confirmation-sunset-390x844',
];
const thumbWidth = 320;
const labelHeight = 38;
const gap = 18;
const columns = 3;
const rows = Math.ceil(boardNames.length / columns);
const maxThumbHeight = 694;
const composites = [];
for (let index = 0; index < boardNames.length; index += 1) {
  const name = boardNames[index];
  const item = captures.find(capture => capture.name === name);
  if (!item) continue;
  const col = index % columns;
  const row = Math.floor(index / columns);
  const left = gap + col * (thumbWidth + gap);
  const top = gap + row * (labelHeight + maxThumbHeight + gap);
  const image = await sharp(item.file).resize({ width: thumbWidth, height: maxThumbHeight, fit: 'contain', background: '#101715' }).toBuffer();
  const label = `<svg width="${thumbWidth}" height="${labelHeight}"><rect width="100%" height="100%" fill="#22312C"/><text x="${thumbWidth / 2}" y="25" text-anchor="middle" font-family="Arial" font-size="13" font-weight="700" fill="#F5F3EC">${name}</text></svg>`;
  composites.push({ input: Buffer.from(label), left, top });
  composites.push({ input: image, left, top: top + labelHeight });
}
await sharp({ create: { width: gap + columns * (thumbWidth + gap), height: gap + rows * (labelHeight + maxThumbHeight + gap), channels: 3, background: '#101715' } })
  .composite(composites)
  .jpeg({ quality: 91 })
  .toFile(path.join(output, 'route-detail-final-board.jpg'));

await browser.close();
const allChecks = Object.values(assertions).flatMap(group => Object.values(group));
const booleanChecksPass = allChecks.filter(value => typeof value === 'boolean').every(Boolean);
const navigationChecksPass = [
  ['hikeNavigation', 'Hiking'],
  ['runNavigation', 'Running'],
  ['editNavigation', 'RouteEditor'],
].every(([key, expectedRoute]) => assertions[key]?.route === expectedRoute && assertions[key]?.paramPreserved === true);
const result = {
  generatedAt: new Date().toISOString(),
  sourceBoundary: 'Actual Expo Web components with real Mapbox GL style/tile rendering and synthetic local QA Route data; not native iOS evidence',
  captures,
  assertions,
  mapNetwork: [...new Map(mapNetwork.map(item => [JSON.stringify(item), item])).values()],
  routeMutationNetwork,
  runtimeErrors: [...new Set(runtimeErrors)],
  pass: booleanChecksPass && navigationChecksPass && runtimeErrors.length === 0,
};
fs.writeFileSync(path.join(output, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ output, captureCount: captures.length, pass: result.pass, runtimeErrors: result.runtimeErrors }, null, 2));
if (!result.pass) process.exitCode = 1;
