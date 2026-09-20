#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';
import { calculateV1SourceFingerprint } from '../../backend/scripts/v1-source-fingerprint.mjs';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_PF_QA_DIR || '_review/personal-friends-overnight');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const themes = ['day', 'sunset', 'night'];
const viewport = { width: 390, height: 844 };
fs.mkdirSync(outputDir, { recursive: true });

let unavailableMode = false;
let revokedMode = false;
let offlineMode = false;
const borrowedRouteJourney = {
  traceId: 'pf-web-borrowed-route-qa-lease-701',
  stages: [],
  requestStartIndex: 0,
};
const now = Date.parse('2026-09-18T08:30:00+12:00');
const authorizationIssuedAt = new Date(Date.now() - 60_000).toISOString();
const authorizationExpiresAt = new Date(Date.now() + 86_400_000).toISOString();
const memoryWirePoints = Array.from({ length: 36 }, (_, index) => {
  const progress = index / 35;
  return {
    lat: -41.2892 + progress * 0.0027 + Math.sin(progress * Math.PI) * 0.00008,
    lng: 174.7738 + progress * 0.0024,
    ts: now - 7_200_000 + index * 100_000,
    cid: `pf-evidence-${index + 1}`,
    evidence_source: 'activity_real',
    source_activity_client_id: 'pf-activity-1',
    horizontal_accuracy_m: 12 + (index % 4),
    continuity_state: 'accepted',
  };
});
const friends = [
  { id: 11, name: 'Mia Rangi', email: 'mia@example.org', added_at: '2026-09-01T08:00:00.000Z' },
  { id: 12, name: 'Theo Walker', email: 'theo@example.org', added_at: '2026-09-02T08:00:00.000Z' },
];
const cairn = {
  id: 'friend-cairn-901', author: { id: 11, name: 'Mia Rangi' }, type: 'viewpoint',
  text: 'Harbour light\u001EA quiet place above the track.', lat: -41.2872, lng: 174.7762,
  created_at: '2026-09-15T03:20:00.000Z', encountered_at: '2026-09-17T04:05:00.000Z', read_only: true,
  resource_revision: 'qa-cairn-r1', authorization_revision: 'friendship-qa-4:friends',
  authorization_issued_at: authorizationIssuedAt, authorization_expires_at: authorizationExpiresAt,
};
const routeSummary = {
  id: 'friend-route-701', author: { id: 11, name: 'Mia Rangi' }, name: 'Harbour ridge',
  description: 'A steady climb with a sheltered return. This longer synthetic note checks that a borrowed Route remains readable without exposing owner controls or retaining unrelated journal content in active recovery.', distance_m: 6400, elevation_gain_m: 310, read_only: true,
  resource_revision: 'qa-route-r1', authorization_revision: 'friendship-qa-4:friends',
  authorization_issued_at: authorizationIssuedAt, authorization_expires_at: authorizationExpiresAt,
};
const routeDetail = {
  ...routeSummary,
  points: [
    { lat: -41.2911, lng: 174.7731, alt: 22 },
    { lat: -41.2889, lng: 174.7750, alt: 98 },
    { lat: -41.2865, lng: 174.7778, alt: 146 },
    { lat: -41.2848, lng: 174.7801, alt: 111 },
  ],
};
const ownRouteWire = {
  id: 601, user_id: 100, client_route_id: 'own-route-601', name: 'Town belt loop',
  description: 'A sheltered loop through the green belt.', distance_m: 5800, elevation_gain_m: 245,
  run_count: 2, last_run_at: '2026-09-17T00:00:00.000Z', created_at: '2026-09-16T00:00:00.000Z',
  updated_at: '2026-09-17T00:00:00.000Z', permission: 'friend', creation_origin: 'manual',
  points: routeDetail.points, waypoints: [],
};

const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport,
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -41.2865, longitude: 174.7762, accuracy: 18 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
const rendererWarnings = [];
const requests = [];
const failedRequests = [];
let qaStep = 'boot';
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('requestfailed', request => failedRequests.push({
  step: qaStep,
  url: request.url().replace(/access_token=[^&]+/i, 'access_token=[redacted]'),
  method: request.method(),
  error: request.failure()?.errorText ?? 'unknown',
}));
page.on('console', message => {
  const text = message.text();
  if (message.type() === 'error' && !text.includes('Failed to load resource') && !text.includes('Mapbox')) {
    const labelled = `console [${qaStep}]: ${text}`;
    if (text.includes("Cannot read properties of undefined (reading 'send')")
      && text.includes('index.ts.bundle')) rendererWarnings.push(`${labelled}\nKnown mapbox-gl v2 request callback during direct QA route teardown; the next mounted map was independently required to report loaded().`);
    else runtimeErrors.push(labelled);
  }
});
page.on('dialog', dialog => dialog.dismiss());

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  requests.push({ method: request.method(), pathname, unavailableMode, offlineMode });
  const json = (body, status = 200) => route.fulfill({
    status, contentType: 'application/json', body: JSON.stringify(body),
  });

  if (offlineMode && pathname.startsWith('/api/friend-content/')) {
    return route.abort('internetdisconnected');
  }
  if (unavailableMode && pathname.startsWith('/api/friend-content/')) {
    return json({ error: 'synthetic_weak_network_fixture' }, 503);
  }
  if (pathname === '/api/auth/me') return json({ user: { id: 100, name: 'Aroha', email: 'aroha@example.org' } });
  if (pathname === '/api/friends') return json(friends);
  if (pathname === '/api/friends/requests' || pathname === '/api/friends/requests/outbound') return json([]);
  if (/^\/api\/friends\/\d+\/profile$/.test(pathname)) return json({
    id: 11, name: 'Mia Rangi', email: 'mia@example.org', memberSince: '2025-11-10T08:00:00.000Z',
    permittedContent: { encounteredCairns: 1, sharedRoutes: 1, memoryAvailable: true },
  });
  if (pathname === '/api/memory-subscriptions') return json({
    limit: 5, count: 1,
    subscriptions: [{ friend_id: 11, friend_name: 'Mia Rangi', subscribed_at: '2026-09-17T03:00:00.000Z' }],
  });
  if (pathname === '/api/friend-sharing/sources') return json({ sources: [
    { friend_id: 11, friend_name: 'Mia Rangi', selected: true, authorization_version: 4, effective_at: '2026-09-17T03:00:00.000Z' },
    { friend_id: 12, friend_name: 'Theo Walker', selected: false, authorization_version: 2, effective_at: '2026-09-17T03:00:00.000Z' },
  ] });
  if (pathname === '/api/friend-sharing/projections') return json({
    revoked_friend_ids: [],
    projections: [{
      source_friend_id: 11, authorization_version: 4, projection_version: 'qa-projection-1', cell_size_m: 200,
      server_authorized_at: authorizationIssuedAt, authorization_expires_at: authorizationExpiresAt,
      cells: [{ id: 'qa-cell-1', polygon: [[174.774, -41.288], [174.778, -41.288], [174.778, -41.285], [174.774, -41.285], [174.774, -41.288]] }],
    }],
  });
  if (pathname === '/api/friend-sharing/policy' && request.method() === 'GET') return json({
    enabled: true, policy_epoch: 3, enabled_at: '2026-09-17T03:00:00.000Z',
  });
  if (pathname === '/api/friend-sharing/private-places' && request.method() === 'GET') return json({
    private_places: [{ id: 1, label: 'Home area', lat: -41.2865, lng: 174.7762, radius_m: 250, created_at: '2026-09-17T03:10:00.000Z' }],
  });
  if (pathname === '/api/friend-content/cairns') return json({ cairns: [cairn] });
  if (pathname === '/api/friend-content/routes') return json({ routes: [routeSummary] });
  if (pathname === '/api/friend-content/cairns/friend-cairn-901') {
    return revokedMode ? json({ error: 'not_found' }, 404) : json({ cairn });
  }
  if (pathname === '/api/friend-content/routes/friend-route-701') return json({ route: routeDetail });
  if (pathname === '/api/friend-content/routes/friend-route-701/lease') return json({
    lease_id: 'qa-lease-701', content_version: 'qa-route-r1', authorization_revision: 'friendship-qa-4:friends',
    resource_revision: 'qa-route-r1',
    issued_at: authorizationIssuedAt, expires_at: authorizationExpiresAt, route: routeDetail,
  });
  if (pathname.startsWith('/api/friend-content/route-leases/')) return json({ ok: true });
  if (pathname === '/api/routes' && request.method() === 'GET') return json({ routes: [{ ...ownRouteWire, points: undefined, waypoints: undefined }] });
  if (pathname === '/api/routes/601') return json({ route: ownRouteWire });
  if (pathname === '/api/circle/markers') return json({ markers: [] });
  if (pathname === '/api/memory/sync') return json({ points: [], presence_witnesses: [] });
  if (pathname === '/api/memory/points') return json({ points: memoryWirePoints });
  if (pathname.startsWith('/api/hierarchy')) return json({ data: [], children: [] });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

const settle = (ms = 700) => page.waitForTimeout(ms);
const capture = async name => {
  qaStep = `capture:${name}`;
  const hasMountedMap = await page.evaluate(() => Boolean(globalThis.__cairnMap?.getContainer?.()?.isConnected));
  if (hasMountedMap) {
    await page.waitForFunction(() => !globalThis.__cairnMap?.getContainer?.()?.isConnected
      || Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 20_000 });
  }
  const currentViewport = page.viewportSize() ?? viewport;
  const target = path.join(outputDir, `${name}-${currentViewport.width}x${currentViewport.height}.png`);
  await page.screenshot({ path: target, fullPage: false });
  return target;
};
const waitForMemoryPresentation = async () => {
  try {
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 20_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      route: globalThis.__cairnStores?.getCurrentRoute?.() ?? null,
      mapPresent: Boolean(globalThis.__cairnMap),
      mapConnected: Boolean(globalThis.__cairnMap?.getContainer?.()?.isConnected),
      mapLoaded: Boolean(globalThis.__cairnMap?.loaded?.()),
      styleLoaded: Boolean(globalThis.__cairnMap?.isStyleLoaded?.()),
      bodyText: document.body.innerText.slice(0, 4000),
    }));
    fs.writeFileSync(path.join(outputDir, 'memory-map-timeout.json'), JSON.stringify({
      qaStep,
      diagnostic,
      runtimeErrors,
      rendererWarnings,
      failedRequests,
    }, null, 2));
    await page.screenshot({ path: path.join(outputDir, 'memory-map-timeout.png'), fullPage: false });
    throw error;
  }
  await page.waitForFunction(() => {
    const text = [...document.querySelectorAll('*')].find(node => node.textContent === 'Opening your map');
    if (!text) return true;
    let current = text;
    while (current) {
      if (Number.parseFloat(getComputedStyle(current).opacity) < 0.05) return true;
      current = current.parentElement;
    }
    return false;
  }, null, { timeout: 20_000 });
  await page.getByText('Weak signal — still loading map…', { exact: true }).waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});
};
const resetRoute = async (name, params) => {
  qaStep = `route:${name}`;
  await page.evaluate(({ routeName, routeParams }) => {
    globalThis.__cairnStores.navigationRef.reset({ index: 0, routes: [{ name: routeName, params: routeParams }] });
  }, { routeName: name, routeParams: params });
  await page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, name, { timeout: 20_000 });
  await settle(1000);
};
const setTheme = async theme => {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setDayNightOverride(next);
  }, theme);
  await settle(500);
};

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(({ fixtureNow, points }) => {
  localStorage.setItem('cairn_jwt', 'personal-friends-visual-fixture');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_pf-qa', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: '100', name: 'Aroha', email: 'aroha@example.org', createdAt: '2026-01-01T00:00:00.000Z', hasPassword: true, providers: ['email'] },
    isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
  });
  const routePoints = [
    { lat: -41.2911, lng: 174.7731, alt: 22 },
    { lat: -41.2889, lng: 174.7750, alt: 98 },
    { lat: -41.2865, lng: 174.7778, alt: 146 },
    { lat: -41.2848, lng: 174.7801, alt: 111 },
  ];
  stores.useMarkerStore.setState({ userId: '100', markers: [{
    id: 'own-cairn-501', clientCairnId: 'own-cairn-501', type: 'viewpoint', regionCode: 'nz',
    lat: -41.2865, lng: 174.7762, note: 'Harbour pause\u001EA moment between the wind and the water.',
    authorId: '100', createdAt: fixtureNow - 86_400_000, permission: 'friend', synced: true, alt: 46,
  }, {
    id: 'own-cairn-empty-502', clientCairnId: 'own-cairn-empty-502', type: 'cairn', regionCode: 'nz',
    lat: -41.2870, lng: 174.7757, note: '',
    authorId: '100', createdAt: fixtureNow - 43_200_000, permission: 'personal', synced: true, alt: 40,
  }], circleMarkers: [], publicMarkers: [], loadingCircle: false });
  stores.useRouteStore.setState({ routes: [{
    id: 'own-route-601', remoteId: '601', clientRouteId: 'own-route-601', name: 'Town belt loop',
    description: 'A sheltered loop through the green belt.', createdAt: fixtureNow - 172_800_000,
    updatedAt: fixtureNow - 86_400_000, points: routePoints, originalPoints: routePoints,
    waypoints: [], distanceM: 5800, elevationGainM: 245, runCount: 2,
    lastRunAt: fixtureNow - 86_400_000, isActive: false, activityMode: 'hiking', permission: 'friend',
  }] });
  stores.useSessionStore.setState({ currentUserId: '100', sessions: [{
    id: 'own-activity-401', clientActivityId: 'own-activity-401', activityMode: 'hiking', regionCode: 'nz',
    startedAt: fixtureNow - 10_800_000, endedAt: fixtureNow - 7_200_000, durationS: 3600,
    distanceM: 6100, elevationGainM: 268,
    trackPoints: routePoints.map((point, index) => ({ ...point, t: fixtureNow - (4 - index) * 900_000, segmentId: 'segment-1', segmentStartReason: index === 0 ? 'start' : undefined })),
    markerIds: ['own-cairn-501'], name: 'Morning over the harbour', memoryNewCells: 12, syncState: 'synced',
  }] });
  stores.useTrackingStore.setState({ status: 'idle', sessionId: null, locationAvailable: false, lastCoordinate: null, lastCoordinateTime: null });
  stores.useMemoryStore.setState({
    points: points.map(point => ({
      lat: point.lat, lng: point.lng, ts: point.ts, cid: point.cid, synced: true,
      evidenceSource: 'activity_real', sourceActivityClientId: 'pf-activity-1',
      horizontalAccuracyM: point.horizontal_accuracy_m, continuityState: 'accepted',
    })),
    testPoints: [{ lat: -41.28, lng: 174.77, ts: fixtureNow, cid: 'simulator-isolated', synced: false, evidenceSource: 'simulator_test' }],
    lastWatcherFix: { lat: -41.2865, lng: 174.7762, ts: fixtureNow }, geometryVersion: 1, initialRevealDone: true,
  });
}, { fixtureNow: now, points: memoryWirePoints });
await resetRoute('Home');

const captures = [];
for (const theme of themes) {
  await setTheme(theme);
  const supportingScreens = [
    { surface: 'home', route: 'Home' },
    { surface: 'hike-ready', route: 'Hiking' },
    { surface: 'run-ready', route: 'Running' },
    { surface: 'trails-routes', route: 'Routes', params: { initialTab: 'routes' } },
    { surface: 'activity-detail-own', route: 'MapHistory', params: { sessionId: 'own-activity-401' } },
    { surface: 'route-detail-own', route: 'MapHistory', params: { routeId: 'own-route-601' } },
    { surface: 'cairn-detail-own', route: 'MarkerDetail', params: { markerId: 'own-cairn-501' } },
    { surface: 'cairn-detail-empty', route: 'MarkerDetail', params: { markerId: 'own-cairn-empty-502' } },
    { surface: 'all-cairns-own-only', route: 'AllCairns' },
    { surface: 'settings', route: 'Settings' },
  ];
  for (const screen of supportingScreens) {
    await resetRoute(screen.route, screen.params);
    captures.push({ theme, surface: screen.surface, path: await capture(`${theme}-${screen.surface}`) });
  }
  await resetRoute('Plant');
  const confirmSpot = page.getByText(/^Confirm(?: this spot)?$/, { exact: false }).last();
  if (await confirmSpot.isVisible().catch(() => false)) {
    await confirmSpot.click();
    await settle(800);
  }
  captures.push({ theme, surface: 'plant-text-only', path: await capture(`${theme}-plant-text-only`) });

  await resetRoute('Memory');
  const gotIt = page.getByText('Got it', { exact: true }).last();
  if (await gotIt.isVisible().catch(() => false)) {
    await gotIt.click();
    await settle();
  }
  await waitForMemoryPresentation();
  captures.push({ theme, surface: 'memory-personal', path: await capture(`${theme}-memory-personal`) });
  await page.getByTestId('memory-scope-combined').click();
  await settle();
  captures.push({ theme, surface: 'memory-combined', path: await capture(`${theme}-memory-combined`) });
  await page.getByTestId('memory-scope-friend').click();
  await settle();
  captures.push({ theme, surface: 'memory-single-friend', path: await capture(`${theme}-memory-single-friend`) });
  await page.getByTestId('memory-sharing-entry').click();
  await page.getByTestId('memory-sharing-sheet').waitFor({ state: 'visible', timeout: 10_000 });
  await settle();
  captures.push({ theme, surface: 'memory-sharing', path: await capture(`${theme}-memory-sharing`) });
  await page.getByLabel('Close Memory sharing').click();
  await settle();

  await resetRoute('Friends');
  await page.getByTestId('friend-card-11').waitFor({ state: 'visible', timeout: 10_000 });
  captures.push({ theme, surface: 'friends-list', path: await capture(`${theme}-friends-list`) });
  await page.getByTestId('friend-card-11').click();
  await page.getByTestId('friend-profile-modal').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByText('Open shared content', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  captures.push({ theme, surface: 'friend-profile', path: await capture(`${theme}-friend-profile`) });
  await page.getByText('Open shared content', { exact: true }).click();
  await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'FriendContent', null, { timeout: 20_000 });
  await page.getByText('Harbour light', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
  captures.push({ theme, surface: 'friend-content', path: await capture(`${theme}-friend-content`) });
  await page.getByText('Harbour light', { exact: true }).click();
  await page.getByTestId('friend-cairn-detail').waitFor({ state: 'visible', timeout: 10_000 });
  await settle(900);
  captures.push({ theme, surface: 'nonowner-cairn-readonly', path: await capture(`${theme}-nonowner-cairn-readonly`) });
  await page.getByLabel('Close').last().click().catch(() => page.keyboard.press('Escape'));
  await settle();
  await page.getByText('Harbour ridge', { exact: true }).click();
  await page.getByTestId('friend-route-detail').waitFor({ state: 'visible', timeout: 10_000 });
  await settle();
  captures.push({ theme, surface: 'nonowner-route-readonly', path: await capture(`${theme}-nonowner-route-readonly`) });
}

// Exercise source removal through the real picker/store path after the
// three-theme set so later theme rows cannot accidentally reuse its cache.
await setTheme('day');
await resetRoute('Memory');
await waitForMemoryPresentation();
await page.getByTestId('memory-scope-combined').click();
await settle(350);
await page.getByTestId('memory-scope-pick').click();
await page.getByTestId('memory-friend-pick-modal').waitFor({ state: 'visible', timeout: 10_000 });
await page.getByTestId('memory-friend-row-11').click();
await settle(500);
await page.getByTestId('memory-friend-pick-close').click();
await settle(1200);
captures.push({ theme: 'day', surface: 'memory-after-source-removal', path: await capture('day-memory-after-source-removal') });

// Inject malformed synthetic display input to prove the stable prior shape
// remains visible while the retry affordance is presented. This is renderer
// failure evidence only; it is never written as Memory truth.
await page.evaluate(fixtureNow => {
  const store = globalThis.__cairnStores.useMemoryStore;
  store.setState({
    points: [...store.getState().points, {
      lat: Number.NaN, lng: Number.NaN, ts: fixtureNow + 1, cid: 'qa-invalid-display-only',
      synced: false, evidenceSource: 'historical_unknown', continuityState: 'unknown',
    }],
    geometryVersion: store.getState().geometryVersion + 1,
  });
}, now);
await settle(1_500);
const geometryRetry = page.getByLabel('Retry Memory map details');
const geometryRetryVisible = await geometryRetry.isVisible().catch(() => false);
if (geometryRetryVisible) {
  captures.push({ theme: 'day', surface: 'memory-geometry-unavailable', path: await capture('day-memory-geometry-unavailable') });
} else {
  // Current geometry preparation rejects non-finite display-only input before
  // it reaches Turf. That is the preferred outcome: retain the independently
  // loaded prior shape without manufacturing an error state.
  await waitForMemoryPresentation();
  captures.push({ theme: 'day', surface: 'memory-malformed-point-ignored', path: await capture('day-memory-malformed-point-ignored') });
}
await page.evaluate(() => {
  const store = globalThis.__cairnStores.useMemoryStore;
  store.setState({
    points: store.getState().points.filter(point => Number.isFinite(point.lat) && Number.isFinite(point.lng)),
    geometryVersion: store.getState().geometryVersion + 1,
  });
});
if (geometryRetryVisible) await geometryRetry.click();
await waitForMemoryPresentation();
captures.push({ theme: 'day', surface: 'memory-geometry-recovered', path: await capture('day-memory-geometry-recovered') });

// C3 connected normal-action proof. The first ordinary Friend Detail use
// obtains a real cached lease online but does not start recording. The user
// leaves through Back, reopens through Home -> Friends while transport is
// genuinely aborted, uses the ordinary button again, explicitly starts, then
// reloads into the unfinished-Activity recovery surface. A normal discard
// leaves a durable terminal outbox which drains only after reconnection.
await setTheme('day');
await resetRoute('Home');
borrowedRouteJourney.requestStartIndex = requests.length;
await page.getByText('Friends', { exact: true }).last().click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 20_000 });
await page.getByTestId('friend-card-11').waitFor({ state: 'visible', timeout: 10_000 });
await page.getByTestId('friend-card-11').click();
await page.getByText('Open shared content', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'FriendContent', null, { timeout: 20_000 });
await page.getByText('Harbour ridge', { exact: true }).click();
await page.getByTestId('friend-route-detail').waitFor({ state: 'visible', timeout: 10_000 });
await page.getByText('Use for Hike', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Hiking', null, { timeout: 20_000 });
borrowedRouteJourney.stages.push(await page.evaluate(() => ({
  stage: 'online-authorization-prestart',
  route: globalThis.__cairnStores.getCurrentRoute(),
  trackingStatus: globalThis.__cairnStores.useTrackingStore.getState().status,
})));
if (borrowedRouteJourney.stages.at(-1).trackingStatus !== 'idle') {
  throw new Error('Opening borrowed Route pre-start started recording unexpectedly.');
}
captures.push({ theme: 'day', surface: 'borrowed-route-online-prestart', path: await capture('day-borrowed-route-online-prestart') });

await page.getByRole('button', { name: 'Back from Hike' }).click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'FriendContent', null, { timeout: 20_000 });
const reopenedRouteClose = page.getByLabel('Close').last();
if (await reopenedRouteClose.isVisible().catch(() => false)) await reopenedRouteClose.click();
await page.getByRole('button', { name: 'Back' }).click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Friends', null, { timeout: 20_000 });

offlineMode = true;
const openShared = page.getByText('Open shared content', { exact: true });
if (!await openShared.isVisible().catch(() => false)) {
  await page.getByTestId('friend-card-11').click();
  await openShared.waitFor({ state: 'visible', timeout: 10_000 });
}
await openShared.click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'FriendContent', null, { timeout: 20_000 });
await page.getByText('Harbour ridge', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await page.getByText('Harbour ridge', { exact: true }).click();
await page.getByTestId('friend-route-detail').waitFor({ state: 'visible', timeout: 10_000 });
await page.getByText('Use for Hike', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Hiking', null, { timeout: 20_000 });

await page.evaluate(() => {
  const stores = globalThis.__cairnStores;
  stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
  const simulatorStore = stores.useActivitySimulatorStore;
  simulatorStore.setState({ hydratedUserId: '100' });
  simulatorStore.getState().setEnabled(true);
});
await settle(1_500);
await page.evaluate(start => {
  const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  simulator.setObservationMode('clean-path');
  simulator.setDeterministicSeed(550103);
  simulator.setTimeScale(10);
  simulator.setCustomSpeed(5.2);
  simulator.setAccuracyPreset('normal');
  simulator.setSignal('normal');
  simulator.setOrigin(start);
  simulator.replaceWaypoints([{ id: 'borrowed-route-target', lat: -41.2889, lng: 174.7750 }]);
}, routeDetail.points[0]);
// The Simulator's account-scoped setup uses a one-second bounded persistence
// debounce. Cross that real durability boundary before the Activity starts so
// a subsequent process reconstruction tests recovery, not an uncommitted QA
// setup mutation.
await settle(1_500);
await page.getByRole('button', { name: 'Start hike' }).click();
await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking', null, { timeout: 20_000 });
await settle(400);
borrowedRouteJourney.stages.push(await page.evaluate(() => ({
  stage: 'offline-explicit-start',
  route: globalThis.__cairnStores.getCurrentRoute(),
  trackingStatus: globalThis.__cairnStores.useTrackingStore.getState().status,
  provider: globalThis.__cairnStores.useTrackingStore.getState().locationProviderSource,
})));
captures.push({ theme: 'day', surface: 'borrowed-route-offline-active', path: await capture('day-borrowed-route-offline-active') });

// A page reload is the Web harness's supported process reconstruction. The
// Activity registry, rather than an in-memory Route object, must recreate the
// unfinished prompt and borrowed safety reference.
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.getByText('Hiking', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Hiking', null, { timeout: 20_000 });
// Recovery is deliberately non-modal until the next normal Start action so
// simply opening Hiking does not steal focus. The Start handler then resolves
// the one durable unfinished Activity instead of creating a second owner.
await page.getByRole('button', { name: 'Start hike' }).click();
await page.getByTestId('unfinished-continue').waitFor({ state: 'visible', timeout: 20_000 });
borrowedRouteJourney.stages.push(await page.evaluate(() => ({
  stage: 'durable-recovery-prompt',
  route: globalThis.__cairnStores.getCurrentRoute(),
  bodyContainsBorrowedRoute: document.body.innerText.includes('Harbour ridge'),
})));
captures.push({ theme: 'day', surface: 'borrowed-route-recovery', path: await capture('day-borrowed-route-recovery') });
await page.getByTestId('unfinished-continue').click();
await settle(1_500);
const recoveredState = await page.evaluate(() => {
  const tracking = globalThis.__cairnStores.useTrackingStore.getState();
  const simulator = globalThis.__cairnStores.useActivitySimulatorStore.getState();
  const reference = globalThis.__cairnStores.useRouteStore.getState().activityRouteReference;
  return {
    tracking: {
      status: tracking.status,
      transitionState: tracking.transitionState,
      startError: tracking.startError,
      sessionId: tracking.sessionId,
      ownerUserId: tracking.ownerUserId,
      provider: tracking.locationProviderSource,
    },
    simulator: {
      enabled: simulator.enabled,
      startConfigured: simulator.startConfigured,
      hydratedUserId: simulator.hydratedUserId,
      boundActivityClientId: simulator.boundActivityClientId,
      lastFailure: simulator.lastFailure,
    },
    reference: reference ? {
      name: reference.name,
      pointCount: reference.points?.length ?? 0,
      borrowedUse: reference.borrowedUse ?? null,
    } : null,
    durableKeys: Object.keys(localStorage)
      .filter(key => key.includes('activity_registry') || key.includes('activity_simulator'))
      .sort(),
  };
});
fs.writeFileSync(path.join(outputDir, 'borrowed-recovery-diagnostic.json'), `${JSON.stringify(recoveredState, null, 2)}\n`);
await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'tracking', null, { timeout: 20_000 });
borrowedRouteJourney.stages.push(await page.evaluate(() => {
  const reference = globalThis.__cairnStores.useRouteStore.getState().activityRouteReference;
  return {
    stage: 'durable-recovery-continued',
    trackingStatus: globalThis.__cairnStores.useTrackingStore.getState().status,
    routeName: reference?.name ?? null,
    pointCount: reference?.points?.length ?? 0,
    borrowedRouteId: reference?.borrowedUse?.routeId ?? null,
    borrowedContentVersion: reference?.borrowedUse?.contentVersion ?? null,
    borrowedAuthorizationRevision: reference?.borrowedUse?.authorizationRevision ?? null,
  };
}));
await page.getByRole('button', { name: 'Finish hike' }).click();
await page.getByText('End hike anyway', { exact: true }).waitFor({ state: 'visible', timeout: 20_000 });
await page.getByText('End hike anyway', { exact: true }).click();
await page.waitForFunction(() => globalThis.__cairnStores.useTrackingStore.getState().status === 'idle', null, { timeout: 20_000 });
borrowedRouteJourney.stages.push(await page.evaluate(() => ({
  stage: 'offline-terminal-discard',
  trackingStatus: globalThis.__cairnStores.useTrackingStore.getState().status,
  friendCacheValues: Object.entries(localStorage)
    .filter(([key]) => key.includes('friend-content'))
    .map(([key, value]) => ({ key, hasTerminalOutbox: value.includes('terminalOutbox'), hasLease: value.includes('qa-lease-701') })),
})));

offlineMode = false;
await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await settle(1_500);
borrowedRouteJourney.stages.push(await page.evaluate(() => ({
  stage: 'reconnected-terminal-drained',
  friendCacheValues: Object.entries(localStorage)
    .filter(([key]) => key.includes('friend-content'))
    .map(([key, value]) => ({ key, hasLease: value.includes('qa-lease-701') })),
})));
borrowedRouteJourney.requests = requests.slice(borrowedRouteJourney.requestStartIndex)
  .filter(item => item.pathname.includes('qa-lease-701') || item.pathname.endsWith('/friend-route-701/lease'));

revokedMode = true;
await resetRoute('FriendContent', { friendId: '11', friendName: 'Mia Rangi' });
await page.getByText('Harbour light', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
await page.getByText('Harbour light', { exact: true }).click();
await page.getByText('This Cairn is no longer shared with you.', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
captures.push({ theme: 'day', surface: 'friend-content-revoked', path: await capture('day-friend-content-revoked') });
revokedMode = false;

unavailableMode = true;
await setTheme('day');
await resetRoute('FriendContent', { friendId: '12', friendName: 'Theo Walker' });
await page.getByText('Shared content unavailable', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 });
captures.push({ theme: 'day', surface: 'friend-content-unavailable', path: await capture('day-friend-content-unavailable') });
unavailableMode = false;

await page.setViewportSize({ width: 320, height: 568 });
await resetRoute('MarkerDetail', { markerId: 'own-cairn-501' });
await page.getByTestId('cairn-edit-open').click();
await page.getByLabel('Title').fill('Wind, water, and a deliberately long remembered place name');
await page.getByLabel('Note').fill('A longer browser-only layout fixture checks wrapping and focused editing without claiming the native iOS keyboard, safe area, or haptics were exercised.');
await page.getByLabel('Note').focus();
await settle(400);
captures.push({ theme: 'day', surface: 'cairn-edit-long-text-browser-focus', path: await capture('day-cairn-edit-long-text-browser-focus') });

await page.setViewportSize({ width: 430, height: 932 });
await setTheme('night');
await resetRoute('Memory');
await waitForMemoryPresentation();
await page.getByTestId('memory-scope-combined').click();
await settle(700);
captures.push({ theme: 'night', surface: 'memory-combined-large', path: await capture('night-memory-combined-large') });
await page.setViewportSize(viewport);

// Auth is conditionally mounted by the production navigator. Capture it last,
// after all authenticated surfaces, so no visual fixture bypass is required.
await page.evaluate(() => globalThis.__cairnStores.useAppStore.setState({ user: null, isLoggedIn: false, hydrated: true }));
await page.waitForFunction(() => globalThis.__cairnStores?.getCurrentRoute?.() === 'Auth', null, { timeout: 20_000 });
for (const theme of themes) {
  await setTheme(theme);
  captures.push({ theme, surface: 'auth', path: await capture(`${theme}-auth`) });
}

const uniqueErrors = [...new Set(runtimeErrors)];
const manifest = {
  generatedAt: new Date().toISOString(),
  candidateFingerprint: calculateV1SourceFingerprint(),
  evidenceKind: 'Expo Web mobile-size visual and deterministic edge-state fixture; not device or NZ field validation',
  baseUrl,
  viewport,
  locale: 'en-NZ',
  timezone: 'Pacific/Auckland',
  themes,
  renderer: 'Expo Web production screens with react-map-gl/mapbox-gl v2 adapter and synthetic NZ geometry',
  authorizationWindow: { issuedAt: authorizationIssuedAt, expiresAt: authorizationExpiresAt },
  mapLoadedAssertion: 'window.__cairnMap.loaded() returned true and the Opening your map veil was hidden before every Memory capture',
  accessibilityContext: 'prefers-reduced-motion enabled; long-text case is browser focus/layout evidence, not an iOS keyboard claim',
  captures: captures.map(item => ({ ...item, path: path.basename(item.path) })),
  requestCount: requests.length,
  runtimeErrors: uniqueErrors,
  rendererWarnings: [...new Set(rendererWarnings)],
  borrowedRouteJourney,
};
fs.writeFileSync(path.join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'requests.json'), `${JSON.stringify(requests, null, 2)}\n`);
fs.writeFileSync(path.join(outputDir, 'runtime-errors.txt'), uniqueErrors.length ? `${uniqueErrors.join('\n')}\n` : 'none\n');
fs.writeFileSync(path.join(outputDir, 'renderer-warnings.txt'), rendererWarnings.length ? `${[...new Set(rendererWarnings)].join('\n')}\n` : 'none\n');

const boardSurfaces = ['memory-personal', 'memory-sharing', 'friends-list', 'friend-profile', 'friend-content', 'nonowner-cairn-readonly', 'nonowner-route-readonly'];
const tileW = viewport.width;
const tileH = viewport.height;
const labelH = 38;
const gap = 16;
const margin = 32;
const boardW = margin * 2 + boardSurfaces.length * tileW + (boardSurfaces.length - 1) * gap;
const boardH = margin * 2 + themes.length * (tileH + labelH) + (themes.length - 1) * gap;
const composites = [];
for (let row = 0; row < themes.length; row += 1) {
  for (let col = 0; col < boardSurfaces.length; col += 1) {
    const theme = themes[row];
    const surface = boardSurfaces[col];
    const left = margin + col * (tileW + gap);
    const top = margin + row * (tileH + labelH + gap);
    const label = `${surface.replaceAll('-', ' ')} · ${theme}`;
    composites.push({ input: Buffer.from(`<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="25" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${label}</text></svg>`), left, top });
    composites.push({ input: path.join(outputDir, `${theme}-${surface}-390x844.png`), left, top: top + labelH });
  }
}
await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#151A19' } })
  .composite(composites).jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'personal-friends-three-theme-board.jpg'));

const inventorySurfaces = ['home', 'auth', 'hike-ready', 'run-ready', 'plant-text-only', 'activity-detail-own', 'cairn-detail-own', 'cairn-detail-empty', 'all-cairns-own-only', 'trails-routes', 'route-detail-own', 'settings'];
const inventoryW = margin * 2 + inventorySurfaces.length * tileW + (inventorySurfaces.length - 1) * gap;
const inventoryComposites = [];
for (let row = 0; row < themes.length; row += 1) {
  for (let col = 0; col < inventorySurfaces.length; col += 1) {
    const theme = themes[row];
    const surface = inventorySurfaces[col];
    const left = margin + col * (tileW + gap);
    const top = margin + row * (tileH + labelH + gap);
    const label = `${surface.replaceAll('-', ' ')} · ${theme}`;
    inventoryComposites.push({ input: Buffer.from(`<svg width="${tileW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${tileW / 2}" y="25" text-anchor="middle" font-family="Arial" font-size="14" font-weight="600" fill="#F5F3EC">${label}</text></svg>`), left, top });
    inventoryComposites.push({ input: path.join(outputDir, `${theme}-${surface}-390x844.png`), left, top: top + labelH });
  }
}
await sharp({ create: { width: inventoryW, height: boardH, channels: 3, background: '#151A19' } })
  .composite(inventoryComposites).jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'full-surface-three-theme-board.jpg'));

const correctionSurfaces = [
  'day-memory-after-source-removal-390x844.png',
  fs.existsSync(path.join(outputDir, 'day-memory-geometry-unavailable-390x844.png'))
    ? 'day-memory-geometry-unavailable-390x844.png'
    : 'day-memory-malformed-point-ignored-390x844.png',
  'day-memory-geometry-recovered-390x844.png',
  'day-friend-content-revoked-390x844.png',
  'day-friend-content-unavailable-390x844.png',
  'day-cairn-edit-long-text-browser-focus-320x568.png',
  'night-memory-combined-large-430x932.png',
];
const correctionThumbW = 320;
const correctionThumbH = 694;
const correctionW = margin * 2 + correctionSurfaces.length * correctionThumbW + (correctionSurfaces.length - 1) * gap;
const correctionComposites = [];
for (let index = 0; index < correctionSurfaces.length; index += 1) {
  const filename = correctionSurfaces[index];
  const left = margin + index * (correctionThumbW + gap);
  correctionComposites.push({
    input: Buffer.from(`<svg width="${correctionThumbW}" height="${labelH}"><rect width="100%" height="100%" fill="#202927"/><text x="${correctionThumbW / 2}" y="25" text-anchor="middle" font-family="Arial" font-size="12" font-weight="600" fill="#F5F3EC">${filename.replace(/-(320x568|390x844|430x932)\.png$/, '').replaceAll('-', ' ')}</text></svg>`),
    left,
    top: margin,
  });
  correctionComposites.push({
    input: await sharp(path.join(outputDir, filename)).resize({ width: correctionThumbW, height: correctionThumbH, fit: 'contain', background: '#151A19' }).png().toBuffer(),
    left,
    top: margin + labelH,
  });
}
await sharp({ create: { width: correctionW, height: margin * 2 + labelH + correctionThumbH, channels: 3, background: '#151A19' } })
  .composite(correctionComposites).jpeg({ quality: 91, chromaSubsampling: '4:4:4' })
  .toFile(path.join(outputDir, 'revision-02-edge-state-board.jpg'));

await browser.close();
console.log(JSON.stringify({ outputDir, captures: captures.length, runtimeErrors: uniqueErrors }, null, 2));
if (uniqueErrors.length) process.exitCode = 1;
