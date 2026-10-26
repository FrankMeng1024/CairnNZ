#!/usr/bin/env node

/**
 * O94 isolated visual/interaction evidence for the production Memory and
 * Route Editor screens. Synthetic coverage is privacy-safe. The local,
 * source-free Mapbox GL style exercises the real Web adapter and application
 * layers; it is not Hosted Standard or physical-iPhone evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8094';
const outputDir = path.resolve(process.env.CAIRN_O94_QA_OUTPUT || '/tmp/cairn-o94-memory-ux');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const user = {
  id: 'o94-memory-owner', name: 'O94 Owner', email: 'o94-owner@example.invalid',
  createdAt: '2026-10-26T00:00:00.000Z', dateOfBirth: '1990-01-01',
  hasPassword: true, providers: ['email'],
};
const friendId = 94;
const fixtureNow = Date.now();
const nowIso = new Date(fixtureNow - 60_000).toISOString();
const expiresIso = new Date(fixtureNow + 60 * 60_000).toISOString();
const aucklandMine = [[[[174.750, -36.862], [174.772, -36.862], [174.772, -36.840], [174.750, -36.840], [174.750, -36.862]]]];
const aucklandFriend = [[[[174.764, -36.862], [174.787, -36.862], [174.787, -36.840], [174.764, -36.840], [174.764, -36.862]]]];
const beijingFriend = [[[[116.455, 39.925], [116.469, 39.925], [116.469, 39.939], [116.455, 39.939], [116.455, 39.925]]]];
const mineGeometry = { type: 'MultiPolygon', coordinates: aucklandMine };
const friendGeometry = { type: 'MultiPolygon', coordinates: [...aucklandFriend, ...beijingFriend] };
const regions = {
  mine: [
    { id: 'nz', parent_id: null, level: 2, name_en: 'New Zealand', bbox: [166, -48, 179, -34], anchor: [174.761, -36.851] },
    { id: 'auckland', parent_id: 'nz', level: 3, name_en: 'Auckland', bbox: [174.4, -37.2, 175.3, -36.5], anchor: [174.761, -36.851] },
  ],
  friend: [
    { id: 'nz', parent_id: null, level: 2, name_en: 'New Zealand', bbox: [166, -48, 179, -34], anchor: [174.775, -36.851] },
    { id: 'auckland', parent_id: 'nz', level: 3, name_en: 'Auckland', bbox: [174.4, -37.2, 175.3, -36.5], anchor: [174.775, -36.851] },
    { id: 'cn', parent_id: null, level: 2, name_en: 'China', bbox: [73, 18, 135, 54], anchor: [116.405, 39.904] },
    // Deliberately coarse and outside the small authorized Fog polygon.
    { id: 'beijing', parent_id: 'cn', level: 3, name_en: 'Beijing', bbox: [115.4, 39.4, 117.5, 41.1], anchor: [116.405, 39.904] },
  ],
};

const routeFixture = {
  id: 'o94-location-marker-route', clientRouteId: 'o94-location-marker-route', ownerId: user.id,
  name: 'O94 location marker', description: '', createdAt: Date.now(), updatedAt: Date.now(),
  points: [
    { lat: -36.852, lng: 174.755 }, { lat: -36.848, lng: 174.763 }, { lat: -36.844, lng: 174.771 },
  ],
  orderedDraft: {
    schemaVersion: 1, draftId: 'o94-location-marker-route', ownerId: user.id, origin: 'plan', revision: 1,
    parts: [{ id: 'part-a', resolution: 'draw-manual', points: [
      { lat: -36.852, lng: 174.755 }, { lat: -36.848, lng: 174.763 }, { lat: -36.844, lng: 174.771 },
    ] }], gaps: [],
  },
  waypoints: [], distanceM: 1100, elevationGainM: 18, runCount: 0, isActive: false,
  permission: 'personal', resolutionState: 'continuous', creationOrigin: 'plan', syncState: 'synced',
};

const requestLog = [];
const runtimeErrors = [];
const consoleMessages = [];
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: [
    '--disable-web-security',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  locale: 'en-NZ', timezoneId: 'Pacific/Auckland', colorScheme: 'light',
  geolocation: { latitude: -36.848, longitude: 174.763, accuracy: 9 },
  permissions: ['geolocation'], reducedMotion: 'reduce',
});
const page = await context.newPage();
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (consoleMessages.length < 500) consoleMessages.push(`${message.type()}: ${value}`);
  if (message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes("Cannot read properties of undefined (reading 'send')")) {
    runtimeErrors.push(`console: ${value}`);
  }
});
page.on('requestfailed', request => {
  if (request.url().includes('mapbox')) {
    runtimeErrors.push(`requestfailed: ${request.url()} ${request.failure()?.errorText ?? ''}`);
  }
});
await page.addInitScript(userId => {
  globalThis.__cairnMapQaLocalStyle = true;
  globalThis.__cairnMapQaTestMode = false;
  globalThis.__cairnMapQaPreserveDrawingBuffer = true;
  localStorage.clear();
  localStorage.setItem('cairn_jwt', 'o94-isolated-local-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
}, user.id);
await page.route('https://events.mapbox.com/**', route => route.fulfill({
  status: 200, contentType: 'application/json', body: '{}',
}));
// GL JS authenticates a renderer session even for a source-free local style.
// Keep the sentinel credential fully isolated: no hosted tiles or real token
// are involved in this local visual control.
await page.route('https://api.mapbox.com/map-sessions/v1**', route => route.fulfill({
  status: 200, contentType: 'application/json', body: '{}',
}));
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  requestLog.push({ method: request.method(), path: url.pathname, search: url.search });
  const json = (body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/auth/me') return json({ user });
  if (url.pathname === '/api/memory/coverage-snapshot') return json({
    manifest: {
      snapshot_id: 'o94-mine-v1', dataset_revision: 'mine-rev-1', as_of: nowIso,
      coverage_rule_version: 4, expected_pages: 1, expected_tiles: 1,
      expected_evidence_count: 8, regions: regions.mine, complete: false,
    },
    page: {
      snapshot_id: 'o94-mine-v1', page_index: 0, next_cursor: null, complete: true,
      terminal_status: 'complete', tiles: [{
        id: 'mine-auckland', bbox: [174.74, -36.87, 174.78, -36.83], evidence_count: 8,
        geometry_sha256: 'o94-mine-geometry', geometry: mineGeometry,
      }],
    },
  });
  if (url.pathname === '/api/friend-sharing/coverage-snapshot') return json({
    projections: [{
      source_friend_id: String(friendId), authorization_version: 7,
      server_authorized_at: nowIso, authorization_expires_at: expiresIso,
      manifest: {
        snapshot_id: 'o94-friend-v1', dataset_revision: 'friend-rev-1', as_of: nowIso,
        coverage_rule_version: 4, expected_pages: 1, expected_tiles: 1,
        expected_evidence_count: 12, regions: regions.friend, complete: false,
      },
      page: {
        snapshot_id: 'o94-friend-v1', page_index: 0, next_cursor: null, complete: true,
        terminal_status: 'complete', tiles: [{
          id: 'friend-auckland-beijing', bbox: [116.45, -36.87, 174.80, 39.95], evidence_count: 12,
          geometry_sha256: 'o94-friend-geometry', geometry: friendGeometry,
        }],
      },
    }], revoked_friend_ids: [],
  });
  if (url.pathname === '/api/memory-subscriptions') return json({
    subscriptions: [{ friend_id: friendId, friend_name: 'Friend Beijing', subscribed_at: nowIso }],
    count: 1, limit: null,
  });
  if (url.pathname === '/api/friend-sharing/sources') return json({ sources: [{
    friend_id: String(friendId), friend_name: 'Friend Beijing', selected: true,
    authorization_version: 7, effective_at: nowIso, sharing_status: 'shared',
    coverage_scope: 'full_history_delayed_v1',
  }] });
  if (url.pathname === '/api/hierarchy/deepest') {
    const lat = Number(url.searchParams.get('lat'));
    return lat > 0
      ? json({ city: { id: 'beijing', name_en: 'Beijing', country_id: 'cn', bbox: [115.4, 39.4, 117.5, 41.1] }, country: { id: 'cn', name_en: 'China', bbox: [73, 18, 135, 54] } })
      : json({ city: { id: 'auckland', name_en: 'Auckland', country_id: 'nz', bbox: [174.4, -37.2, 175.3, -36.5] }, country: { id: 'nz', name_en: 'New Zealand', bbox: [166, -48, 179, -34] } });
  }
  if (url.pathname === '/api/hierarchy/panel') {
    const title = url.searchParams.get('title_id') ?? 'world';
    if (title === 'world') return json({
      title: { id: 'world', name_en: 'World', level: 0 }, parent: null,
      items: [{ id: 'nz', name_en: 'New Zealand', state: 'walked', bbox: [166, -48, 179, -34], is_here: true }],
      locked_count: 190,
    });
    if (title === 'nz') return json({
      title: { id: 'nz', name_en: 'New Zealand', level: 2 }, parent: { id: 'world', name_en: 'World', level: 0 },
      items: [{ id: 'auckland', name_en: 'Auckland', state: 'walked', bbox: [174.4, -37.2, 175.3, -36.5], is_here: true }],
      locked_count: 25,
    });
    return json({
      title: { id: 'cn', name_en: 'China', level: 2 }, parent: { id: 'world', name_en: 'World', level: 0 },
      items: [], locked_count: 340,
    });
  }
  if (url.pathname === '/api/memory/coverage') return json({
    coverage_rule_version: 4, coverage_version: 'legacy-unused', evidence_count: 0,
    geometry: { type: 'MultiPolygon', coordinates: [] },
  });
  return json({ data: [], routes: [], sessions: [], markers: [], notifications: [], count: 0 });
});

const waitForMapIdle = async () => {
  await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.isStyleLoaded?.()), null, { timeout: 45_000 });
  await page.evaluate(() => new Promise(resolve => {
    const map = globalThis.__cairnMap;
    if (!map) return resolve();
    if (map.loaded?.()) return requestAnimationFrame(() => requestAnimationFrame(resolve));
    map.once?.('idle', () => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    setTimeout(resolve, 8_000);
  }));
};
const snapshotRequestCount = () => requestLog.filter(entry => (
  entry.path === '/api/memory/coverage-snapshot'
  || entry.path === '/api/friend-sharing/coverage-snapshot'
)).length;
const mapDiagnostics = () => page.evaluate(() => {
  const map = globalThis.__cairnMap;
  const canvas = map?.getCanvas?.();
  const bounds = map?.getBounds?.();
  const featureCounts = {};
  for (const layer of ['memory-mine', 'memory-friend-union', 'memory-overlap']) {
    try { featureCounts[layer] = map?.queryRenderedFeatures?.({ layers: [layer] })?.length ?? 0; }
    catch { featureCounts[layer] = 0; }
  }
  return {
    center: map?.getCenter?.()?.toArray?.() ?? null,
    zoom: map?.getZoom?.() ?? null,
    bounds: bounds ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] : null,
    canvasCss: canvas ? { width: canvas.getBoundingClientRect().width, height: canvas.getBoundingClientRect().height } : null,
    canvasBacking: canvas ? { width: canvas.width, height: canvas.height } : null,
    styleLoaded: map?.isStyleLoaded?.() ?? false,
    featureCounts,
    fogLayers: (map?.getStyle?.()?.layers ?? []).filter(layer => layer.id.startsWith('memory-')).map(layer => ({ id: layer.id, type: layer.type, paint: layer.paint })),
  };
});
const captureMap = async filename => {
  const map = page.locator('.mapboxgl-map').first();
  await map.waitFor({ state: 'visible', timeout: 30_000 });
  await map.screenshot({ path: path.join(outputDir, filename) });
};

const report = {
  generatedAt: new Date().toISOString(), baseUrl,
  evidenceBoundary: 'Expo Web production screens + real Mapbox GL renderer + local source-free style; not Hosted Standard or native iPhone',
  requestCounts: {}, gestureSamples: [], themes: [], city: {}, controls: {}, locationMarkers: {},
  runtimeErrors,
};

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(({ userValue, routeValue }) => {
    const stores = globalThis.__cairnStores;
    stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
    stores.useSettingsStore.getState().saveAll({ debugMode: false, appearance: 'day', mapLayer: 'outdoors' });
    stores.useMemorySettingsStore.setState({ hydrated: true, firstVisitDone: true });
    stores.useMemoryScopeStore.setState({ scope: 'combined' });
    stores.useMemorySubscriptionsStore.getState().reset();
    stores.usePreparedMemoryCoverageStore.getState().reset();
    stores.useFriendMemoryStore.getState().reset();
    stores.useRouteStore.setState({ routes: [routeValue], routeOwnerId: userValue.id, routesLoading: false, routesLoadError: false });
    stores.navigationRef.reset({ index: 0, routes: [{ name: 'Home' }] });
  }, { userValue: user, routeValue: routeFixture });

  // The app-level account effect owns Memory hydration. Let it settle before
  // installing this run's isolated current-location authority; otherwise its
  // legitimate account reset can race and erase a freshly seeded test fix.
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.evaluate(userValue => {
    const stores = globalThis.__cairnStores;
    const now = Date.now();
    stores.useMemoryStore.setState(state => ({
      points: [], testPoints: [], geometryVersion: state.geometryVersion + 1,
      lastWatcherFix: { lat: -36.848, lng: 174.763, ts: now }, initialRevealDone: true,
      localHydration: { ownerUserId: userValue.id, status: 'ready', requiresInitialReconcile: false, initialReconcile: 'not_required', revision: state.localHydration.revision + 1 },
    }));
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Memory' }] });
  }, user);

  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 30_000 });
  try {
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.getLayer?.('memory-overlap')), null, { timeout: 15_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      body: document.body?.innerText?.slice(0, 2_000) ?? '',
      map: Boolean(globalThis.__cairnMap),
      layers: globalThis.__cairnMap?.getStyle?.()?.layers?.map(layer => layer.id) ?? [],
      prepared: globalThis.__cairnStores.usePreparedMemoryCoverageStore.getState(),
      friend: globalThis.__cairnStores.useFriendMemoryStore.getState(),
      subscriptions: globalThis.__cairnStores.useMemorySubscriptionsStore.getState(),
      memory: globalThis.__cairnStores.useMemoryStore.getState(),
      qaFlag: globalThis.__cairnMapQaLocalStyle,
      mapDomCount: document.querySelectorAll('.mapboxgl-map').length,
      canvasCount: document.querySelectorAll('canvas').length,
    }));
    fs.writeFileSync(path.join(outputDir, 'initial-load-failure.json'), `${JSON.stringify({ diagnostic, requestLog, runtimeErrors, consoleMessages }, null, 2)}\n`);
    await page.screenshot({ path: path.join(outputDir, 'initial-load-failure.png') });
    throw error;
  }
  await page.waitForFunction(() => !document.querySelector('[data-testid="memory-entry-veil"]'), null, { timeout: 60_000 });
  await waitForMapIdle();
  await page.waitForTimeout(300);

  const cairns = page.getByTestId('memory-all-cairns-entry');
  const scope = page.getByTestId('memory-scope-toggle');
  const [cairnsBox, scopeBox, cairnsText] = await Promise.all([
    cairns.boundingBox(), scope.boundingBox(), cairns.textContent(),
  ]);
  report.controls = {
    cairnsText, cairnsHeight: cairnsBox?.height ?? null, scopeHeight: scopeBox?.height ?? null,
    aligned: Boolean(cairnsBox && scopeBox && Math.abs(cairnsBox.height - scopeBox.height) < 0.5
      && Math.abs(cairnsBox.y - scopeBox.y) < 0.5),
  };
  await page.screenshot({ path: path.join(outputDir, 'memory-controls-day-390x844.png') });

  report.requestCounts.afterInitialPreparation = snapshotRequestCount();
  for (let index = 0; index < 15; index += 1) {
    await page.evaluate(({ index: step }) => new Promise(resolve => {
      const map = globalThis.__cairnMap;
      const center = [174.763 + ((step % 3) - 1) * 0.0007, -36.850 + ((step % 2) ? 0.0005 : -0.0005)];
      map.once?.('idle', resolve);
      map.easeTo({ center, zoom: 13.6 + (step % 4) * 0.35, duration: 90, essential: true });
      setTimeout(resolve, 1_500);
    }), { index });
    report.gestureSamples.push(await page.evaluate(step => ({
      step,
      statusText: document.querySelector('[data-testid="memory-map-status"]')?.textContent ?? null,
      coverageStatus: globalThis.__cairnStores.usePreparedMemoryCoverageStore.getState().status,
      friendStatus: globalThis.__cairnStores.useFriendMemoryStore.getState().loading ? 'loading' : 'settled',
    }), index));
  }
  report.requestCounts.after15Gestures = snapshotRequestCount();
  report.requestCounts.gestureDelta = report.requestCounts.after15Gestures - report.requestCounts.afterInitialPreparation;

  for (const theme of ['day', 'sunset', 'night']) {
    await page.evaluate(nextTheme => {
      globalThis.__cairnStores.useSettingsStore.getState().saveAll({ appearance: nextTheme });
      globalThis.__cairnMap?.jumpTo?.({ center: [174.769, -36.851], zoom: 13.7 });
    }, theme);
    await page.waitForTimeout(300);
    await waitForMapIdle();
    const screenshot = `memory-overlap-${theme}-390x844.png`;
    await captureMap(screenshot);
    report.themes.push({ theme, screenshot, diagnostics: await mapDiagnostics() });
  }

  // Return to day and navigate through World → China → Beijing. China and
  // Beijing are friend-only rows synthesized from the authorized snapshot.
  await page.evaluate(() => globalThis.__cairnStores.useSettingsStore.getState().saveAll({ appearance: 'day' }));
  await page.getByTestId('memory-city-switcher').click();
  await page.getByTestId('hierarchy-up-btn').click();
  await page.getByTestId('hierarchy-row-cn').click();
  await page.getByTestId('hierarchy-row-beijing').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('hierarchy-row-beijing').click();
  await page.getByTestId('hierarchy-backdrop').click();
  await waitForMapIdle();
  await page.waitForTimeout(400);
  const beijing = await mapDiagnostics();
  const center = beijing.center;
  const targetInsideAuthorizedPolygon = Boolean(center
    && center[0] >= 116.455 && center[0] <= 116.469
    && center[1] >= 39.925 && center[1] <= 39.939);
  const coarseAnchorWasIgnored = Boolean(center
    && (Math.abs(center[0] - 116.405) > 0.01 || Math.abs(center[1] - 39.904) > 0.01));
  report.city = {
    fixture: 'Beijing Friends-only, coarse region anchor outside coverage',
    targetInsideAuthorizedPolygon, coarseAnchorWasIgnored,
    memoryScope: await page.evaluate(() => globalThis.__cairnStores.useMemoryScopeStore.getState().scope),
    diagnostics: beijing, screenshot: 'beijing-friends-only-390x844.png',
  };
  await page.screenshot({ path: path.join(outputDir, report.city.screenshot) });

  // Capture the shared Web puck implementation in Memory and Route. Native
  // identity is separately proven by both screens importing the same styles.
  await page.getByTestId('memory-recenter').click();
  await waitForMapIdle();
  await page.getByTestId('web-user-location-puck').waitFor({ state: 'visible', timeout: 15_000 });
  const memoryMarkerStyle = await page.getByTestId('web-user-location-puck').evaluate(node => ({
    backgroundColor: getComputedStyle(node).backgroundColor,
    border: getComputedStyle(node).border,
    width: getComputedStyle(node).width,
    height: getComputedStyle(node).height,
    boxShadow: getComputedStyle(node).boxShadow,
  }));
  await page.screenshot({ path: path.join(outputDir, 'memory-current-location-390x844.png') });

  await page.evaluate(routeId => globalThis.__cairnStores.navigationRef.reset({
    index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId } }],
  }), routeFixture.id);
  await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'RouteEditor', null, { timeout: 30_000 });
  await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 45_000 });
  await page.getByTestId('web-user-location-puck').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForMapIdle();
  const routeMarkerStyle = await page.getByTestId('web-user-location-puck').evaluate(node => ({
    backgroundColor: getComputedStyle(node).backgroundColor,
    border: getComputedStyle(node).border,
    width: getComputedStyle(node).width,
    height: getComputedStyle(node).height,
    boxShadow: getComputedStyle(node).boxShadow,
  }));
  await page.screenshot({ path: path.join(outputDir, 'route-current-location-390x844.png') });
  report.locationMarkers = {
    memory: memoryMarkerStyle, route: routeMarkerStyle,
    equal: JSON.stringify(memoryMarkerStyle) === JSON.stringify(routeMarkerStyle),
  };
} finally {
  report.requestLog = requestLog;
  await page.close().catch(() => {});
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
}

const failures = [];
if (report.requestCounts.gestureDelta !== 0) failures.push(`gesture-snapshot-request-delta:${report.requestCounts.gestureDelta}`);
if (report.gestureSamples.some(sample => sample.statusText?.includes('Loading shared map'))) failures.push('loading-shared-map-visible-during-gesture');
if (!report.controls.aligned || report.controls.cairnsText?.trim() !== 'Cairns') failures.push('cairns-control-mismatch');
if (!report.city.targetInsideAuthorizedPolygon || !report.city.coarseAnchorWasIgnored) failures.push('beijing-camera-missed-authorized-fog');
if (report.city.memoryScope !== 'combined') failures.push('beijing-friend-coverage-hidden');
if ((report.city.diagnostics?.featureCounts?.['memory-friend-union'] ?? 0) < 1) failures.push('beijing-friend-fog-not-rendered');
if (!report.locationMarkers.equal) failures.push('location-marker-mismatch');
if (runtimeErrors.length) failures.push(`runtime-errors:${runtimeErrors.length}`);
report.failures = failures;
report.status = failures.length ? 'FAIL' : 'PASS';
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, status: report.status, failures, requestCounts: report.requestCounts, city: report.city, controls: report.controls, locationMarkers: report.locationMarkers }, null, 2));
if (failures.length) process.exitCode = 1;
