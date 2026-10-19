#!/usr/bin/env node

/**
 * O87 city ownership visual/authorization QA.
 *
 * Uses the real Memory screen, hierarchy panel, Mapbox GL renderer and city
 * selection handler. API payloads are explicitly QA-labelled accepted
 * coverage/region summaries; they are not evidence of real travel.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_O87_CITY_QA_DIR || '/tmp/cairn-o87-memory-city-ownership');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(outputDir, { recursive: true });

const viewer = {
  id: 'o87-city-owner', name: 'O87 City QA', email: 'o87-city@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01',
  hasPassword: true, providers: ['email'],
};
const friendId = 87042;
const auckland = { id: 'nz-auckland', parent_id: 'nz', level: 3, name_en: 'Auckland', bbox: [174.70, -36.92, 174.90, -36.78], anchor: [174.7633, -36.8485] };
const wellington = { id: 'nz-wellington', parent_id: 'nz', level: 3, name_en: 'Wellington', bbox: [174.70, -41.36, 174.86, -41.22], anchor: [174.7762, -41.2865] };
const now = new Date();
const expiry = new Date(now.getTime() + 60 * 60 * 1000);
const mineGeometry = {
  type: 'MultiPolygon',
  coordinates: [[[[174.7628, -36.8490], [174.7640, -36.8490], [174.7640, -36.8480], [174.7628, -36.8480], [174.7628, -36.8490]]]],
};
const friendGeometry = {
  type: 'MultiPolygon',
  coordinates: [[[[174.7632, -36.8489], [174.7644, -36.8489], [174.7644, -36.8479], [174.7632, -36.8479], [174.7632, -36.8489]]]],
};
const wellingtonFriendGeometry = {
  type: 'MultiPolygon',
  coordinates: [[[[174.7756, -41.2871], [174.7768, -41.2871], [174.7768, -41.2859], [174.7756, -41.2859], [174.7756, -41.2871]]]],
};

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  locale: 'en-NZ', colorScheme: 'light',
  geolocation: { latitude: -36.8485, longitude: 174.7633, accuracy: 8 },
  permissions: ['geolocation'],
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror:${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error' && !value.includes('Failed to load resource')) runtimeErrors.push(`console:${value}`);
});
await page.addInitScript(({ userId }) => {
  localStorage.clear();
  localStorage.setItem('cairn_jwt', 'o87-memory-city-qa');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
}, { userId: viewer.id });

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const endpoint = url.pathname;
  const body = (() => { try { return JSON.parse(request.postData() || '{}'); } catch { return {}; } })();
  const reply = (value, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(value) });
  if (endpoint === '/api/auth/me') return reply({ user: viewer });
  if (endpoint === '/api/edit-diag') return reply({ ok: true });
  if (endpoint === '/api/memory-subscriptions') return reply({
    limit: null, count: 1,
    subscriptions: [{ friend_id: friendId, friend_name: 'frank test', subscribed_at: now.toISOString() }],
  });
  if (endpoint === '/api/friend-sharing/sources') return reply({ sources: [{
    friend_id: friendId, friend_name: 'frank test', selected: true,
    authorization_version: 7, effective_at: now.toISOString(),
    sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
  }] });
  if (endpoint === '/api/friend-sharing/coverage') {
    const requestedBbox = body.viewport_bbox ?? [];
    const isWellingtonViewport = Number(requestedBbox[1]) < -40;
    return reply({
    coverage_rule_version: 4, total_ms: 12,
    projections: (body.friend_ids ?? []).map(() => ({
      source_friend_id: friendId, authorization_version: 7,
      projection_version: 'o87-city-regions-v1', coverage_rule_version: 4,
      evidence_count: 8, cell_size_m: 30, cells: [],
      geometry: isWellingtonViewport ? wellingtonFriendGeometry : friendGeometry,
      regions: [auckland, wellington],
      server_authorized_at: now.toISOString(), authorization_expires_at: expiry.toISOString(),
    })),
    revoked_friend_ids: [],
  });
  }
  if (endpoint === '/api/memory/coverage') {
    const bbox = String(url.searchParams.get('bbox') ?? '').split(',').map(Number);
    const isWellingtonViewport = Number(bbox[1]) < -40;
    return reply({
    coverage_rule_version: 4, coverage_version: 'o87-city-mine-v1', evidence_count: 4,
    tile_count: isWellingtonViewport ? 0 : 1, rebuilt_tile_count: 0,
    geometry: isWellingtonViewport ? { type: 'MultiPolygon', coordinates: [] } : mineGeometry,
    stage_ms: {}, total_ms: 1,
  });
  }
  if (endpoint === '/api/hierarchy/deepest') return reply({
    city: { id: auckland.id, name_en: auckland.name_en, country_id: 'nz', bbox: auckland.bbox },
    country: { id: 'nz', name_en: 'New Zealand', bbox: [166, -48, 179, -34] },
  });
  if (endpoint === '/api/hierarchy/panel') {
    const hereCity = url.searchParams.get('here_city_id');
    return reply({
      title: { id: 'nz', name_en: 'New Zealand', level: 2 },
      parent: { id: 'world', name_en: 'World', level: 0 },
      items: [
        { id: auckland.id, name_en: auckland.name_en, state: 'marked', bbox: auckland.bbox, is_here: hereCity === auckland.id },
        { id: 'nz-dunedin', name_en: 'Dunedin', state: 'walked', bbox: [170.40, -45.95, 170.60, -45.80], is_here: hereCity === 'nz-dunedin' },
      ],
      locked_count: 4,
    });
  }
  if (endpoint === '/api/memory/points') return reply({ points: [] });
  if (endpoint === '/api/friends') return reply([]);
  if (endpoint === '/api/circle/markers' || endpoint === '/api/markers') return reply({ markers: [] });
  if (endpoint === '/api/sessions') return reply({ sessions: [] });
  if (endpoint === '/api/routes') return reply({ routes: [] });
  if (endpoint.startsWith('/api/cairn-memory/')) return reply({ cairns: [], items: [], count: 0 });
  return reply({ data: [], items: [], notifications: [], markers: [], sessions: [], routes: [], count: 0 });
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
  await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
  await page.evaluate(({ userValue }) => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({ debugMode: false, appearance: 'day', mapLayer: 'outdoors' });
    stores.useMemorySettingsStore.setState({ hydrated: true, firstVisitDone: true });
    stores.useMemoryScopeStore.setState({ ownerUserId: userValue.id, scope: 'combined' });
    stores.useMemoryStore.setState(state => ({
      points: [], testPoints: [], pendingPreparedCoverageCids: [], initialRevealDone: true,
      geometryVersion: state.geometryVersion + 1,
      lastWatcherFix: { lat: -36.8485, lng: 174.7633, ts: Date.now(), accuracyM: 8, provenance: 'real' },
      localHydration: {
        ownerUserId: userValue.id, status: 'ready', requiresInitialReconcile: false,
        initialReconcile: 'not_required', revision: state.localHydration.revision + 1,
      },
    }));
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'Memory' }] });
  }, { userValue: viewer });
  await page.getByTestId('memory-city-switcher').waitFor({ state: 'visible', timeout: 30_000 });
  await page.waitForFunction(id => globalThis.__cairnStores.useFriendMemoryStore.getState().sourceStates[String(id)]?.status === 'loaded', friendId, { timeout: 30_000 });
  await page.getByTestId('memory-city-switcher').click();
  await page.getByTestId('hierarchy-panel').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId(`hierarchy-row-${wellington.id}`).waitFor({ state: 'visible', timeout: 15_000 });
  await page.screenshot({ path: path.join(outputDir, 'city-ownership-day-390x844.png') });

  const ownership = await page.evaluate(({ ids }) => Object.fromEntries(ids.map(id => {
    const row = document.querySelector(`[data-testid="hierarchy-row-${id}"]`);
    const badges = document.querySelector(`[data-testid="hierarchy-ownership-${id}"]`);
    return [id, { label: row?.getAttribute('aria-label') ?? '', badges: badges?.textContent ?? '' }];
  })), { ids: [auckland.id, 'nz-dunedin', wellington.id] });

  const citySwitchStartedAt = Date.now();
  await page.getByTestId(`hierarchy-row-${wellington.id}`).click();
  await page.waitForFunction(() => {
    const store = globalThis.__cairnStores.useFriendMemoryStore.getState();
    if (Number(store.activeViewport?.bbox?.[1]) >= -40) return false;
    try {
      return globalThis.__cairnMap
        ?.queryRenderedFeatures(undefined, { layers: ['memory-friend-union'] })
        ?.length > 0;
    } catch { return false; }
  }, null, { timeout: 15_000 });
  const citySelection = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const center = map?.getCenter?.();
    return {
      center: center ? [center.lng, center.lat] : null,
      manualCity: globalThis.__cairnStores.useMemoryCameraStore.getState().manualCity,
    };
  });
  const citySwitchVisibleMs = Date.now() - citySwitchStartedAt;
  await page.screenshot({ path: path.join(outputDir, 'friend-only-city-selected-day-390x844.png') });

  await page.evaluate(async id => {
    await globalThis.__cairnStores.useFriendMemoryStore.getState().purgeFriend(String(id), 'o87-city-owner');
  }, friendId);
  await page.getByTestId(`hierarchy-row-${wellington.id}`).waitFor({ state: 'hidden', timeout: 10_000 });
  const revokedOwnership = await page.getByTestId(`hierarchy-ownership-${auckland.id}`).innerText();
  await page.screenshot({ path: path.join(outputDir, 'friend-city-revoked-day-390x844.png') });

  const distanceFromAnchor = citySelection.center
    ? Math.hypot(citySelection.center[0] - wellington.anchor[0], citySelection.center[1] - wellington.anchor[1])
    : Infinity;
  const assertions = {
    mineCityMarkedMine: ownership['nz-dunedin']?.badges === 'M' && ownership['nz-dunedin']?.label.includes('Mine'),
    sharedCityMarkedBoth: ownership[auckland.id]?.badges === 'MF' && ownership[auckland.id]?.label.includes('Mine and Friends'),
    friendOnlyCityDiscoverable: ownership[wellington.id]?.badges === 'F' && ownership[wellington.id]?.label.includes('Friends'),
    friendOnlyCityUsesAuthorizedAnchor: distanceFromAnchor < 0.01,
    friendOnlyAnchorRemainsSessionOnly: citySelection.manualCity === null,
    friendOnlyCityVisibleUnder10Seconds: citySwitchVisibleMs < 10_000,
    revokedFriendCityRemovedImmediately: revokedOwnership === 'M',
    runtimeClean: runtimeErrors.length === 0,
  };
  const report = {
    generatedAt: new Date().toISOString(),
    sourceBoundary: 'QA-labelled region summaries through real Memory screen, hierarchy panel, city handler, and hosted Mapbox renderer; not real travel evidence',
    ownership, citySelection, citySwitchVisibleMs, distanceFromAnchor, revokedOwnership, assertions, runtimeErrors,
    verdict: Object.values(assertions).every(Boolean) ? 'PASS' : 'FAIL',
  };
  fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, verdict: report.verdict, assertions }, null, 2));
  if (report.verdict !== 'PASS') process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
}
