#!/usr/bin/env node

/**
 * Real Expo Web + hosted Mapbox/Fog review for the O88 retained-Cairn map.
 * HTTP data is deterministic and privacy-safe; rendering, clustering, camera
 * behavior, theme configuration and app interaction are production code.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8118';
const outputDir = path.resolve(process.env.CAIRN_O88_MAPBOX_DIR || '/tmp/cairn-o88-mapbox-density');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const center = { lat: 31.2341, lng: 121.4312 };
const user = { id: '100', name: 'O88 Map Walker', email: 'o88-map@example.invalid' };
const runtimeErrors = [];
const mapbox = { requested: [], finished: [], failed: [] };
const captures = [];
let activeFoundRows = [];

fs.mkdirSync(outputDir, { recursive: true });

const resourceName = raw => {
  try { const value = new URL(raw); return `${value.origin}${value.pathname}`; }
  catch { return 'invalid-mapbox-url'; }
};
const foundRow = (id, lat, lng, audience, index) => ({
  marker_id: String(id),
  source_audience: audience,
  author_name: audience === 'friends' ? `Friend ${index % 4 + 1}` : null,
  is_current_friend: audience === 'friends',
  type: 'cairn',
  text: `Cairn ${id}\u001eA retained walking memory at this place.`,
  acquired_at: new Date(Date.now() - index * 60_000).toISOString(),
  opened_at: index % 3 ? null : new Date().toISOString(),
  availability: 'available',
  revision_count: index % 5 === 0 ? 2 : 1,
  has_unread: index % 3 !== 0,
  lat,
  lng,
});

const scenarios = {
  mixed3: [
    foundRow('friend-1', center.lat + 0.00028, center.lng - 0.00025, 'friends', 1),
    foundRow('public-1', center.lat - 0.00022, center.lng + 0.00032, 'public', 2),
  ],
  overlap8: Array.from({ length: 8 }, (_, index) => (
    // Keep the same-coordinate stack away from the Web geolocation puck so
    // the deliberate tap reaches Mapbox rather than the puck's DOM marker.
    foundRow(`overlap-${index + 1}`, center.lat + 0.0006, center.lng + 0.0006,
      index % 2 ? 'public' : 'friends', index)
  )),
  distributed60: Array.from({ length: 60 }, (_, index) => {
    const row = Math.floor(index / 10);
    const column = index % 10;
    return foundRow(`distributed-${index + 1}`,
      center.lat + (row - 2.5) * 0.0013,
      center.lng + (column - 4.5) * 0.00125,
      index % 3 ? 'friends' : 'public', index);
  }),
  dense100: Array.from({ length: 100 }, (_, index) => {
    const row = Math.floor(index / 10);
    const column = index % 10;
    return foundRow(`dense-${index + 1}`,
      center.lat + (row - 4.5) * 0.000075,
      center.lng + (column - 4.5) * 0.000075,
      index % 2 ? 'friends' : 'public', index);
  }),
};

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--disable-web-security', '--enable-webgl', '--ignore-gpu-blocklist',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Asia/Shanghai',
  geolocation: { latitude: center.lat, longitude: center.lng, accuracy: 8 },
  permissions: ['geolocation'],
  reducedMotion: 'no-preference',
});
await context.addInitScript(() => {
  globalThis.__cairnMapQaLocalStyle = false;
  globalThis.__cairnMapQaTestMode = false;
  localStorage.setItem('cairn_jwt', 'o88-live-mapbox-review');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_100', 'true');
});
const page = await context.newPage();
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.stack || error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error' && !value.includes('Failed to load resource')) {
    runtimeErrors.push(`console: ${value}`);
  }
});
page.on('request', request => {
  if (request.url().includes('mapbox.com')) mapbox.requested.push(resourceName(request.url()));
});
page.on('response', response => {
  if (response.url().includes('mapbox.com') && response.ok()) mapbox.finished.push(resourceName(response.url()));
});
page.on('requestfailed', request => {
  if (request.url().includes('mapbox.com')) {
    mapbox.failed.push({ resource: resourceName(request.url()), error: request.failure()?.errorText ?? 'unknown' });
  }
});
page.on('dialog', dialog => dialog.dismiss());

const json = (route, body, status = 200) => route.fulfill({
  status, contentType: 'application/json', body: JSON.stringify(body),
});
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const pathname = url.pathname;
  if (pathname === '/api/auth/me') return json(route, { user });
  if (pathname === '/api/cairn-memory/library') return json(route, {
    section: 'found', cairns: activeFoundRows,
    unread_count: activeFoundRows.filter(row => row.has_unread).length,
    has_more: false, next_cursor: null,
  });
  if (pathname === '/api/cairn-memory/presentation/pending') return json(route, {
    groups: [], unread_count: activeFoundRows.filter(row => row.has_unread).length,
    acquired_cairn_count: activeFoundRows.length, withdrawn_group_ids: [],
  });
  if (pathname === '/api/markers' || pathname === '/api/markers/library') return json(route, { markers: [] });
  if (pathname === '/api/circle/markers') return json(route, { markers: [] });
  if (pathname === '/api/push/preferences') return json(route, { memory_hits: false });
  if (pathname === '/api/memory/coverage') {
    const west = center.lng - 0.00055;
    const east = center.lng + 0.00055;
    const south = center.lat - 0.00055;
    const north = center.lat + 0.00085;
    return json(route, {
      coverage_version: 'o88-map-walk-v1',
      coverage_rule_version: 4,
      evidence_count: 12,
      tile_count: 1,
      rebuilt_tile_count: 0,
      total_ms: 1,
      stage_ms: {},
      geometry: {
        type: 'MultiPolygon',
        coordinates: [[[[west, south], [east, south], [east, north], [west, north], [west, south]]]],
      },
    });
  }
  if (pathname === '/api/memory/points' || pathname === '/api/memory/sync') {
    return json(route, { points: [], presence_witnesses: [] });
  }
  if (pathname === '/api/friends' || pathname.includes('/friends/requests')) return json(route, []);
  if (pathname === '/api/memory-subscriptions') return json(route, { limit: null, count: 0, subscriptions: [] });
  if (pathname.startsWith('/api/friend-sharing')) return json(route, { revoked_friend_ids: [], projections: [], sources: [] });
  if (pathname.startsWith('/api/hierarchy')) return json(route, { data: [], children: [] });
  return json(route, { data: [], routes: [], markers: [], notifications: [], count: 0 });
});

activeFoundRows = scenarios.mixed3;
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 180_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 180_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 180_000 });
await page.evaluate(({ fixtureUser, fixtureCenter }) => {
  const stores = globalThis.__cairnStores;
  const now = Date.now();
  stores.useAppStore.setState({ user: fixtureUser, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
  stores.useSettingsStore.getState().saveAll({ debugMode: false, appearance: 'day', mapLayer: 'outdoors' });
  stores.useWeatherStore.getState().setConditionOverride('sunny');
  stores.useWeatherStore.getState().setDayNightOverride('day');
  stores.useMemorySettingsStore.setState({ hydrated: true, firstVisitDone: true });
  stores.useMemoryScopeStore.setState({ scope: 'self' });
  const corridor = Array.from({ length: 12 }, (_, index) => ({
    lat: fixtureCenter.lat + index * 0.000055,
    lng: fixtureCenter.lng + Math.sin(index / 2) * 0.00009,
    ts: now - (12 - index) * 10_000,
    cid: `o88-map-walk-${index}`, synced: true,
    evidenceSource: 'activity_real', sourceActivityClientId: 'o88-map-walk',
    sourceSegmentId: 'segment-1', horizontalAccuracyM: 8, continuityState: 'accepted',
  }));
  stores.useMemoryStore.setState({
    points: corridor, geometryVersion: 12, initialRevealDone: true,
    lastWatcherFix: { lat: fixtureCenter.lat, lng: fixtureCenter.lng, ts: now },
    localHydration: { ownerUserId: fixtureUser.id, status: 'ready', requiresInitialReconcile: false, initialReconcile: 'not_required', revision: 12 },
  });
  stores.useMarkerStore.setState({
    userId: fixtureUser.id,
    markers: [{
      id: 'own-1', type: 'cairn', regionCode: 'cn-shanghai',
      lat: fixtureCenter.lat - 0.00028, lng: fixtureCenter.lng - 0.00028,
      note: 'My own Cairn', authorId: fixtureUser.id, createdAt: now - 86_400_000,
      permission: 'personal', synced: true,
    }],
    circleMarkers: [], publicMarkers: [],
  });
}, { fixtureUser: user, fixtureCenter: center });
// Complete the real account-owned hydration paths before installing the
// deterministic walk. The asynchronous auth observer is allowed to clear a
// cache that predates its owner binding; writing the fixture only afterward
// prevents that correct fence from racing this isolated review setup.
await page.evaluate(async fixtureUserId => {
  const stores = globalThis.__cairnStores;
  await stores.useMarkerStore.getState().hydrate(fixtureUserId);
  await stores.useCairnPresentationStore.getState().initialize(fixtureUserId);
}, user.id);
await page.evaluate(({ fixtureUser, fixtureCenter }) => {
  const stores = globalThis.__cairnStores;
  const now = Date.now();
  const corridor = Array.from({ length: 12 }, (_, index) => ({
    lat: fixtureCenter.lat + index * 0.000055,
    lng: fixtureCenter.lng + Math.sin(index / 2) * 0.00009,
    ts: now - (12 - index) * 10_000,
    cid: `o88-map-walk-${index}`, synced: true,
    evidenceSource: 'activity_real', sourceActivityClientId: 'o88-map-walk',
    sourceSegmentId: 'segment-1', horizontalAccuracyM: 8, continuityState: 'accepted',
  }));
  stores.useMemoryStore.setState({
    points: corridor, geometryVersion: 12, initialRevealDone: true,
    lastWatcherFix: { lat: fixtureCenter.lat, lng: fixtureCenter.lng, ts: now },
    localHydration: { ownerUserId: fixtureUser.id, status: 'ready', requiresInitialReconcile: false, initialReconcile: 'not_required', revision: 12 },
  });
  stores.useMarkerStore.setState({
    userId: fixtureUser.id,
    markers: [{
      id: 'own-1', type: 'cairn', regionCode: 'cn-shanghai',
      lat: fixtureCenter.lat - 0.00028, lng: fixtureCenter.lng - 0.00028,
      note: 'My own Cairn', authorId: fixtureUser.id, createdAt: now - 86_400_000,
      permission: 'personal', synced: true,
    }],
    circleMarkers: [], publicMarkers: [],
  });
  stores.navigationRef.reset({ index: 0, routes: [{ name: 'Memory' }] });
}, { fixtureUser: user, fixtureCenter: center });
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Memory', null, { timeout: 30_000 });
const gotIt = page.getByText('Got it', { exact: true }).last();
if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
await page.waitForTimeout(1_000);
await page.evaluate(({ fixtureCenter, fixtureUserId }) => {
  const stores = globalThis.__cairnStores;
  const memory = stores.useMemoryStore.getState();
  stores.useMemoryStore.setState({
    lastWatcherFix: {
      lat: fixtureCenter.lat,
      lng: fixtureCenter.lng,
      ts: Date.now(),
      accuracyM: 8,
      provenance: 'real',
    },
    localHydration: {
      ...memory.localHydration,
      ownerUserId: fixtureUserId,
      status: 'ready',
      requiresInitialReconcile: false,
      initialReconcile: 'not_required',
    },
  });
}, { fixtureCenter: center, fixtureUserId: user.id });
try {
  await page.waitForFunction(() => {
    const map = globalThis.__cairnMap;
    return Boolean(map?.loaded?.() && map.getSource?.('memory-fog-src'));
  }, null, { timeout: 90_000 });
} catch (error) {
  const diagnostic = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const style = map?.getStyle?.();
    const stores = globalThis.__cairnStores;
    return {
      route: stores?.getCurrentRoute?.() ?? null,
      body: document.body.innerText,
      hasMap: Boolean(map),
      loaded: Boolean(map?.loaded?.()),
      styleName: style?.name ?? null,
      sourceIds: Object.keys(style?.sources ?? {}),
      layerIds: (style?.layers ?? []).map(layer => layer.id),
      acquiredMarkerCount: stores?.useCairnPresentationStore?.getState?.().acquiredMarkers?.length ?? null,
      runtimeErrors: [...(globalThis.__cairnMapRuntimeErrors ?? [])],
    };
  });
  fs.writeFileSync(path.join(outputDir, 'INITIAL_MAP_DIAGNOSTIC.json'), `${JSON.stringify({ diagnostic, runtimeErrors, mapbox }, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, 'INITIAL_MAP_DIAGNOSTIC.png') });
  throw error;
}

const setScenario = async (name) => {
  activeFoundRows = scenarios[name];
  await page.evaluate(async expected => {
    await globalThis.__cairnStores.useCairnPresentationStore.getState().refreshAcquiredMap();
    if (globalThis.__cairnStores.useCairnPresentationStore.getState().acquiredMarkers.length !== expected) {
      throw new Error('acquired marker count did not refresh');
    }
  }, activeFoundRows.length);
  await page.waitForFunction(expected => (
    globalThis.__cairnStores.useCairnPresentationStore.getState().acquiredMarkers.length === expected
    && globalThis.__cairnMap?.getSource?.('acquired-cairn-clusters')?._data?.features?.length === expected
    && Boolean(globalThis.__cairnMap?.isSourceLoaded?.('acquired-cairn-clusters'))
  ), activeFoundRows.length, { timeout: 30_000 });
};
const setTheme = async theme => {
  await page.evaluate(next => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ appearance: next, debugMode: false, mapLayer: 'outdoors' });
    stores.useWeatherStore.getState().setDayNightOverride(next);
  }, theme);
  const expectedStyleName = theme === 'night'
    ? 'Mapbox Navigation Night'
    : theme === 'sunset'
      ? 'Cairn Sunset 2D'
      : 'Mapbox Outdoors';
  await page.waitForFunction(expected => {
    const map = globalThis.__cairnMap;
    try {
      return map?.getStyle?.()?.name === expected && Boolean(map?.isStyleLoaded?.());
    } catch {
      return false;
    }
  }, expectedStyleName, { timeout: 30_000 });
};
const settleCamera = async ({ zoom, bearing }) => {
  await page.evaluate(({ mapCenter, zoomValue, bearingValue }) => {
    const map = globalThis.__cairnMap;
    map.jumpTo({ center: [mapCenter.lng, mapCenter.lat], zoom: zoomValue, bearing: bearingValue });
  }, { mapCenter: center, zoomValue: zoom, bearingValue: bearing });
  // A live Mapbox map can keep streaming/offscreen tiles and never emit a
  // global `idle` event, even though the exact sources being reviewed are
  // fully parsed and painted. Bound the settle gate to those production
  // sources and the requested camera instead of waiting forever on unrelated
  // basemap work.
  await page.waitForFunction(({ zoomValue, bearingValue }) => {
    const map = globalThis.__cairnMap;
    return Boolean(map?.isStyleLoaded?.()
      && map.getSource?.('memory-fog-src')
      && map.getSource?.('acquired-cairn-clusters')
      && Math.abs(map.getZoom() - zoomValue) < 0.05
      && Math.abs(map.getBearing() - bearingValue) < 0.1);
  }, { zoomValue: zoom, bearingValue: bearing }, { timeout: 20_000 });
  await page.waitForTimeout(750);
};
const mapState = () => page.evaluate(() => {
  const map = globalThis.__cairnMap;
  const sourceFeatures = map.querySourceFeatures?.('acquired-cairn-clusters') ?? [];
  const layers = ['acquired-cairn-cluster-circles', 'acquired-cairn-cluster-count',
    'acquired-cairn-single-audience', 'acquired-cairn-single'];
  const rendered = layers.flatMap(layer => {
    try { return map.getLayer(layer) ? map.queryRenderedFeatures(undefined, { layers: [layer] }) : []; }
    catch { return []; }
  });
  return {
    loaded: map.loaded(), styleLoaded: map.isStyleLoaded?.() ?? false,
    acquiredSourceLoaded: map.isSourceLoaded?.('acquired-cairn-clusters') ?? false,
    zoom: map.getZoom(), bearing: map.getBearing(),
    sourceFeatures: sourceFeatures.length, renderedFeatures: rendered.length,
    fogSource: Boolean(map.getSource?.('memory-fog-src')),
    styleName: map.getStyle?.()?.name ?? null,
  };
});

for (const [scenario, rows] of Object.entries(scenarios)) {
  for (const theme of ['day', 'sunset', 'night']) {
    await setTheme(theme);
    // Web v2 changes between three complete supported styles. Reconcile the
    // retained source after each style boundary so the evidence proves the
    // current theme's custom layers, not a source left over from the prior
    // style instance.
    await setScenario(scenario);
    for (const view of [
      { name: 'near', zoom: 16.4, bearing: 0 },
      { name: 'context-bearing', zoom: 13.7, bearing: 35 },
    ]) {
      await settleCamera(view);
      const state = await mapState();
      // `loaded()`/`isStyleLoaded()` can both return false while a source or
      // unrelated basemap tile is refreshing. A named hosted style plus the
      // real fog source and queryable, painted retained-Cairn features is the
      // stronger state-specific proof of what the human actually sees.
      if (!state.styleName || !state.fogSource || state.renderedFeatures < 1) {
        throw new Error(`${scenario}/${theme}/${view.name} did not paint retained Cairns: ${JSON.stringify(state)}`);
      }
      const file = `${scenario}-${theme}-${view.name}-390x844.png`;
      await page.screenshot({ path: path.join(outputDir, file) });
      captures.push({ scenario, expectedRetained: rows.length, theme, view, state, file });
    }
  }
}

// Same-location stack: deliberate cluster tap must open the exact group sheet.
await setScenario('overlap8');
await setTheme('day');
await settleCamera({ zoom: 15, bearing: 0 });
const overlapHit = await page.evaluate(() => {
  const map = globalThis.__cairnMap;
  const feature = map.queryRenderedFeatures(undefined, { layers: ['acquired-cairn-cluster-circles'] })[0];
  if (!feature) return null;
  const screen = map.project(feature.geometry.coordinates);
  return { x: screen.x, y: screen.y };
});
if (!overlapHit) throw new Error('overlap stack did not produce a tappable real Mapbox cluster');
await page.mouse.click(overlapHit.x, overlapHit.y);
await page.waitForTimeout(1_500);
if (!await page.getByTestId('memory-acquired-cairn-group').isVisible().catch(() => false)) {
  const diagnostic = await page.evaluate(hit => {
    const map = globalThis.__cairnMap;
    const element = document.elementFromPoint(hit.x, hit.y);
    const features = map.queryRenderedFeatures([hit.x, hit.y], { layers: ['acquired-cairn-cluster-circles'] });
    return {
      body: document.body.innerText,
      hit,
      element: element ? { tag: element.tagName, className: element.className, testId: element.getAttribute?.('data-testid') } : null,
      features: features.map(feature => ({ source: feature.source, properties: feature.properties, geometry: feature.geometry })),
    };
  }, overlapHit);
  fs.writeFileSync(path.join(outputDir, 'INTERACTION_OVERLAP_DIAGNOSTIC.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, 'INTERACTION_OVERLAP_DIAGNOSTIC.png') });
}
await page.getByTestId('memory-acquired-cairn-group').waitFor({ state: 'visible', timeout: 8_500 });
await page.screenshot({ path: path.join(outputDir, 'interaction-overlap8-exact-group-390x844.png') });
const overlapSheetText = await page.getByTestId('memory-acquired-cairn-group').innerText();
if (!overlapSheetText.includes('8 Cairns here')) throw new Error(`wrong overlap group: ${overlapSheetText}`);
await page.getByLabel('Close').last().click();
await page.getByTestId('memory-acquired-cairn-group').waitFor({ state: 'hidden', timeout: 5_000 });

// Distributed cluster: deliberate tap must expand camera instead of opening a
// content sheet. Choose the first actual rendered cluster, not a synthetic hit.
await setScenario('distributed60');
await settleCamera({ zoom: 11.8, bearing: 22 });
// This interaction proves acquired-cluster behavior, not DOM view-annotation
// stacking. Remove the separate owned-Cairn fixture so the real Mapbox canvas
// receives the deliberate tap at the retained cluster's projected point.
await page.evaluate(() => {
  globalThis.__cairnStores.useMarkerStore.setState({ markers: [] });
});
await page.waitForTimeout(250);
// Reproduce a normal review gesture: pan the map far enough that the retained
// cluster is visibly clear of the location controls while keeping it in the
// viewport, then click the real rendered cluster.
await page.evaluate(({ lng, lat }) => {
  globalThis.__cairnMap.jumpTo({ center: [lng - 0.02, lat], zoom: 11.8, bearing: 22 });
}, center);
await page.waitForTimeout(750);
const distributedHit = await page.evaluate(() => {
  const map = globalThis.__cairnMap;
  const feature = map.queryRenderedFeatures(undefined, { layers: ['acquired-cairn-cluster-circles'] })[0];
  if (!feature) return null;
  const screen = map.project(feature.geometry.coordinates);
  const element = document.elementFromPoint(screen.x, screen.y);
  return {
    x: screen.x,
    y: screen.y,
    zoom: map.getZoom(),
    elementTag: element?.tagName ?? null,
    elementClass: element?.className ?? null,
    elementRole: element?.getAttribute?.('role') ?? null,
  };
});
if (!distributedHit) throw new Error('distributed set did not produce a tappable real Mapbox cluster');
if (['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(distributedHit.elementTag)
  || distributedHit.elementRole === 'button') {
  throw new Error(`distributed cluster remained obstructed: ${JSON.stringify(distributedHit)}`);
}
await page.mouse.click(distributedHit.x, distributedHit.y);
// Supercluster can legitimately choose the next integer boundary (12) from
// an 11.8 camera, a 0.2 increase. Require material forward movement without
// assuming a larger implementation-specific jump.
try {
  await page.waitForFunction(previousZoom => globalThis.__cairnMap.getZoom() > previousZoom + 0.05,
    distributedHit.zoom, { timeout: 10_000 });
} catch (error) {
  const diagnostic = await page.evaluate(hit => {
    const map = globalThis.__cairnMap;
    const source = map.getSource?.('acquired-cairn-clusters');
    const features = map.queryRenderedFeatures([hit.x, hit.y], { layers: ['acquired-cairn-cluster-circles'] });
    const element = document.elementFromPoint(hit.x, hit.y);
    return {
      hit,
      zoom: map.getZoom(),
      sourceDataFeatures: source?._data?.features?.length ?? null,
      sourceLoaded: map.isSourceLoaded?.('acquired-cairn-clusters') ?? null,
      element: element ? { tag: element.tagName, className: element.className } : null,
      features: features.map(feature => ({ properties: feature.properties, geometry: feature.geometry })),
      groupVisible: Boolean(document.querySelector('[data-testid="memory-acquired-cairn-group"]')),
    };
  }, distributedHit);
  fs.writeFileSync(path.join(outputDir, 'INTERACTION_DISTRIBUTED_DIAGNOSTIC.json'), `${JSON.stringify(diagnostic, null, 2)}\n`);
  await page.screenshot({ path: path.join(outputDir, 'INTERACTION_DISTRIBUTED_DIAGNOSTIC.png') });
  throw error;
}
const distributedAfterZoom = await page.evaluate(() => globalThis.__cairnMap.getZoom());
if (await page.getByTestId('memory-acquired-cairn-group').isVisible().catch(() => false)) {
  throw new Error('distributed cluster incorrectly opened a same-place group');
}
await page.screenshot({ path: path.join(outputDir, 'interaction-distributed60-expanded-390x844.png') });

const result = {
  schema: 'cairnnz.o88.real-mapbox-density.v1',
  generated_at: new Date().toISOString(),
  boundary: 'Actual Expo Web MemoryScreen, FogLayer, Cairn pins, acquired clustering, themes and click handling over hosted Mapbox. Deterministic isolated HTTP rows; not a native iPhone or field GPS claim.',
  viewport: '390x844',
  scenarios: Object.fromEntries(Object.entries(scenarios).map(([name, rows]) => [name, rows.length])),
  captures,
  interactions: {
    overlap8: { result: 'PASS', action: 'real rendered cluster click', outcome: '8-item exact group sheet' },
    distributed60: { result: 'PASS', action: 'real rendered cluster click', fromZoom: distributedHit.zoom, toZoom: distributedAfterZoom, outcome: 'camera expanded; no content sheet' },
  },
  mapbox: {
    authority: 'EAS production environment public token; credential value excluded and not persisted',
    requested: mapbox.requested.length,
    finished: mapbox.finished.length,
    failed: mapbox.failed,
    distinct_resources: [...new Set(mapbox.finished)],
  },
  runtimeErrors,
};
fs.writeFileSync(path.join(outputDir, 'RESULTS.json'), `${JSON.stringify(result, null, 2)}\n`);
await context.close();
await browser.close();
if (runtimeErrors.length || mapbox.failed.length || mapbox.finished.length === 0) {
  throw new Error([...runtimeErrors, ...mapbox.failed.map(item => item.error),
    ...(mapbox.finished.length ? [] : ['no successful Mapbox resource'])].join(' | '));
}
console.log(JSON.stringify({ outputDir, captures: captures.length, interactions: result.interactions,
  mapboxFinished: mapbox.finished.length, runtimeErrors }, null, 2));
