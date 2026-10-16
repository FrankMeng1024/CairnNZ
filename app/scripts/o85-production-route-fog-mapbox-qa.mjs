#!/usr/bin/env node

/** Focused Route Editor proof using the exact production HTTPS Friend Fog. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const hash = value => crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 12);

const evidencePath = process.env.O85_PRODUCTION_FOG_FIXTURE;
const outputDir = path.resolve(process.env.O85_ROUTE_FOG_OUTPUT || '/tmp/cairn-o85-route-fog');
const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
if (!evidencePath) throw new Error('O85_PRODUCTION_FOG_FIXTURE is required');
const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
if (evidence.result !== 'PASS'
  || evidence.evidence_class !== 'PRODUCTION_HTTPS_API_TO_MAPBOX_FIXTURE'
  || evidence.render_fixture?.owners?.length !== 2) {
  throw new Error('expected exact two-source production API fixture');
}
fs.mkdirSync(outputDir, { recursive: true });

const fixture = evidence.render_fixture;
const viewerId = String(fixture.viewer_id);
const owners = fixture.owners;
const ownerIds = owners.map(owner => String(owner.projection.source_friend_id));
const expectedCells = owners.reduce((total, owner) => total + owner.projection.cells.length, 0);
const centerOf = owner => {
  const ring = owner.projection.cells[0].polygon.slice(0, -1);
  return [
    ring.reduce((sum, point) => sum + point[0], 0) / ring.length,
    ring.reduce((sum, point) => sum + point[1], 0) / ring.length,
  ];
};
const centers = owners.map(centerOf);
const firstCellRing = owners[0].projection.cells[0].polygon.slice(0, -1);
const routePoints = firstCellRing.slice(0, 3)
  .map(([lng, lat], index) => ({ lng, lat, t: Date.now() + index * 1000 }));
const route = {
  id: 'o85-production-fog-route-qa',
  clientRouteId: 'o85-production-fog-route-qa',
  name: 'Friend Fog rendering proof',
  createdAt: Date.now(), updatedAt: Date.now(), points: routePoints,
  orderedDraft: {
    schemaVersion: 1, draftId: 'route:o85-production-fog-route-qa', ownerId: viewerId,
    origin: 'plan', revision: 1,
    parts: [{ id: 'local-render-only', resolution: 'point', points: routePoints }], gaps: [],
  },
  waypoints: [], distanceM: 1, elevationGainM: 0, runCount: 0, isActive: false,
  permission: 'personal', resolutionState: 'continuous', creationOrigin: 'planned', syncState: 'synced',
};
const nowIso = new Date().toISOString();
const expiresIso = new Date(Date.now() + 3_600_000).toISOString();
const errors = [];

const browser = await chromium.launch({
  headless: true,
  executablePath: fs.existsSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    : undefined,
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  locale: 'en-NZ', timezoneId: 'Pacific/Auckland',
  geolocation: { longitude: centers[0][0], latitude: centers[0][1], accuracy: 10 },
  permissions: ['geolocation'], reducedMotion: 'reduce',
});
const page = await context.newPage();
await page.addInitScript(viewer => {
  globalThis.__cairnMapQaTestMode = false;
  localStorage.setItem('cairn_jwt', 'o85-production-route-fog-local-authority');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${viewer}`, 'true');
}, viewerId);
page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes("Cannot read properties of undefined (reading 'send')")) {
    errors.push(`console: ${value}`);
  }
});
await page.route('**/api/**', async intercepted => {
  const request = intercepted.request();
  const url = new URL(request.url());
  let body = {};
  try { body = request.postDataJSON() ?? {}; } catch { /* no body */ }
  const json = value => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  if (url.pathname === '/api/auth/me') return json({ user: { id: viewerId, name: 'Aroha', email: 'internal@example.invalid' } });
  if (url.pathname === '/api/memory-subscriptions') return json({
    limit: null, count: ownerIds.length,
    subscriptions: ownerIds.map((id, index) => ({ friend_id: Number(id), friend_name: `Authorized friend ${index + 1}`, subscribed_at: nowIso })),
  });
  if (url.pathname === '/api/friend-sharing/sources') return json({
    sources: ownerIds.map((id, index) => ({
      friend_id: id, friend_name: `Authorized friend ${index + 1}`, selected: true,
      authorization_version: owners[index].projection.authorization_version,
      effective_at: nowIso, sharing_status: 'shared', coverage_scope: 'full_history_delayed_v1',
    })),
  });
  if (url.pathname === '/api/friend-sharing/projections') {
    const requested = new Set((body.friend_ids ?? []).map(String));
    return json({
      revoked_friend_ids: [],
      projections: owners
        .map(owner => owner.projection)
        .filter(projection => requested.has(String(projection.source_friend_id)))
        .map(projection => ({ ...projection, server_authorized_at: nowIso, authorization_expires_at: expiresIso })),
    });
  }
  if (url.pathname === '/api/memory/points') return json({ points: fixture.viewer_points });
  return json({ data: [], routes: [], markers: [], notifications: [], count: 0 });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(({ viewer, routeValue, points }) => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: viewer, name: 'Aroha', email: 'internal@example.invalid' },
    isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
  });
  stores.useRouteStore.setState({ routes: [routeValue], routeOwnerId: viewer, routesLoading: false, routesLoadError: false });
  stores.useMemoryStore.setState(state => ({
    points: points.map(point => ({
      lat: point.lat, lng: point.lng, ts: point.ts, cid: point.cid, synced: true,
      evidenceSource: point.evidence_source, sourceSegmentId: point.source_segment_id,
      horizontalAccuracyM: point.horizontal_accuracy_m, continuityState: point.continuity_state,
    })),
    geometryVersion: state.geometryVersion + 1,
    localHydration: {
      ownerUserId: viewer, status: 'ready', requiresInitialReconcile: false,
      initialReconcile: 'not_required', revision: state.localHydration.revision + 1,
    },
  }));
  stores.useMemorySubscriptionsStore.getState().reset();
  stores.useFriendMemoryStore.getState().reset();
  stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId: routeValue.id } }] });
}, { viewer: viewerId, routeValue: route, points: fixture.viewer_points });

await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 30_000 });
await page.getByTestId('route-more').click();
const combined = page.getByText('Mine & Friends', { exact: true });
await combined.waitFor({ state: 'visible', timeout: 15_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useMemorySubscriptionsStore.getState().subscriptions.length === 2, null, { timeout: 15_000 });
await combined.click();
await page.waitForFunction(expected => (
  globalThis.__cairnStores.useFriendMemoryStore.getState().getVisibleCells().length === expected
  && Boolean(globalThis.__cairnMap?.getLayer?.('memory-friend-union'))
), expectedCells, { timeout: 30_000 });
await page.getByTestId('route-more').click();

const measurements = [];
for (let index = 0; index < centers.length; index += 1) {
  await page.evaluate(center => globalThis.__cairnMap.jumpTo({ center, zoom: 16 }), centers[index]);
  // Camera ownership updates can briefly remount the Fog source after the
  // immediate jump. Assert the settled rendered layer, not that transient
  // pre-region-change instance.
  await page.waitForTimeout(900);
  await page.waitForFunction(() => (
    Boolean(globalThis.__cairnMap?.getSource?.('memory-friend-union-src'))
    && Boolean(globalThis.__cairnMap?.getLayer?.('memory-friend-union'))
    && globalThis.__cairnMap.queryRenderedFeatures(
      undefined, { layers: ['memory-friend-union'] },
    ).length > 0
  ), null, { timeout: 30_000 });
  const measured = await page.evaluate(() => ({
    renderedFeatures: globalThis.__cairnMap.getLayer('memory-friend-union')
      ? globalThis.__cairnMap.queryRenderedFeatures(undefined, { layers: ['memory-friend-union'] }).length
      : 0,
    sourceFeatures: globalThis.__cairnMap.getSource('memory-friend-union-src')
      ? globalThis.__cairnMap.querySourceFeatures('memory-friend-union-src').length
      : 0,
    layerPresent: Boolean(globalThis.__cairnMap.getLayer('memory-friend-union')),
  }));
  measurements.push(measured);
  await page.screenshot({ path: path.join(outputDir, `route-friend-fog-source-${index + 1}-390x844.png`) });
}

await page.evaluate(() => globalThis.__cairnMap.setStyle('mapbox://styles/mapbox/outdoors-v12'));
const styleReloadRestored = await page.waitForFunction(expected => (
  globalThis.__cairnMap?.isStyleLoaded?.()
  && Boolean(globalThis.__cairnMap?.getSource?.('memory-friend-union-src'))
  && Boolean(globalThis.__cairnMap?.getLayer?.('memory-friend-union'))
  && globalThis.__cairnStores.useFriendMemoryStore.getState().getVisibleCells().length === expected
), expectedCells, { timeout: 45_000 }).then(() => true).catch(() => false);
await page.waitForTimeout(700);
const afterStyleReload = await page.evaluate(() => ({
  renderedFeatures: globalThis.__cairnMap.queryRenderedFeatures(undefined, { layers: ['memory-friend-union'] }).length,
  sourceFeatures: globalThis.__cairnMap.querySourceFeatures('memory-friend-union-src').length,
  layerPresent: Boolean(globalThis.__cairnMap.getLayer('memory-friend-union')),
}));
await page.screenshot({ path: path.join(outputDir, 'route-friend-fog-after-style-reload-390x844.png') });

const report = {
  generated_at: new Date().toISOString(),
  evidence_class: 'PRODUCTION_HTTPS_API_PAYLOAD_THROUGH_ROUTE_EDITOR_LIVE_MAPBOX',
  source_hashes: ownerIds.map(hash),
  authorized_cells: expectedCells,
  scope: 'Mine & Friends',
  route_fixture: 'local planned rendering fixture only; never persisted and never treated as travel evidence',
  viewport_measurements: measurements,
  style_reload_restored: styleReloadRestored,
  after_style_reload: afterStyleReload,
  runtime_errors: [...new Set(errors)],
  verdict: measurements.every(value => value.layerPresent && value.renderedFeatures > 0)
    && styleReloadRestored && afterStyleReload.layerPresent && afterStyleReload.renderedFeatures > 0
    && errors.length === 0 ? 'PASS' : 'FAIL',
};
fs.writeFileSync(path.join(outputDir, 'route-fog-report.json'), `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
if (report.verdict !== 'PASS') throw new Error(`Route Friend Fog QA failed: ${JSON.stringify(report)}`);
console.log(JSON.stringify({
  outputDir, verdict: report.verdict, authorizedCells: report.authorized_cells,
  renderedFeatures: measurements.map(value => value.renderedFeatures),
  styleReloadRenderedFeatures: afterStyleReload.renderedFeatures,
}));
