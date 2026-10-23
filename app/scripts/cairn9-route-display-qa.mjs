#!/usr/bin/env node

/**
 * Cairn #9 Route display QA: current Expo Web surfaces over real Mapbox.
 * Uses isolated synthetic geometry around a public test location; it never
 * reads or writes production data. The fixtures exercise an intentional
 * out-and-back and a dense one-way wobble through production render paths.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN9_ROUTE_QA_OUTPUT || '/tmp/cairn9-route-display-qa');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const origin = { lat: -41.2865, lng: 174.7762 };
const point = (eastM, northM = 0) => ({
  lat: origin.lat + northM / 111_000,
  lng: origin.lng + eastM / (111_000 * Math.cos(origin.lat * Math.PI / 180)),
});
const fixtures = [
  {
    id: 'qa-intentional-u', name: 'QA intentional out and back',
    points: [point(0), point(45), point(90), point(45), point(0)],
    expectedRepeat: true,
  },
  {
    id: 'qa-one-way-wobble', name: 'QA one way wobble',
    points: [
      point(0, 0), point(20, 1.2), point(8, -0.8), point(28, 1), point(16, -1.1),
      point(36, 0.7), point(24, -0.9), point(44, 0.8), point(32, -0.6), point(52, 0),
    ],
    expectedRepeat: false,
  },
].map(fixture => ({
  ...fixture,
  ownerId: 'cairn9-isolated-qa', clientRouteId: fixture.id,
  permission: 'personal', creationOrigin: 'plan', resolutionState: 'continuous',
  distanceM: 0, elevationGainM: 0, createdAt: Date.now(), updatedAt: Date.now(),
  orderedDraft: {
    schemaVersion: 1, draftId: fixture.id, ownerId: 'cairn9-isolated-qa', origin: 'plan', revision: 1,
    parts: [{ id: `${fixture.id}:part`, resolution: 'draw-manual', points: fixture.points }], gaps: [],
  },
}));

fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
  locale: 'en-NZ', timezoneId: 'Pacific/Auckland', reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error' && !value.includes('Failed to load resource')
    && !value.includes("Cannot read properties of undefined (reading 'send')")) runtimeErrors.push(`console: ${value}`);
});
await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'cairn9-route-display-isolated');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_cairn9-isolated-qa', 'true');
});
await page.route('**/api/**', async intercepted => {
  const url = new URL(intercepted.request().url());
  const json = body => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/auth/me') return json({ user: {
    id: 'cairn9-isolated-qa', name: 'Route QA', email: 'route-qa@example.invalid',
  } });
  if (url.pathname === '/api/memory/coverage') return json({
    coverage_rule_version: 4, coverage_version: 'cairn9-empty', evidence_count: 0,
    tile_count: 0, rebuilt_tile_count: 0, total_ms: 1, stage_ms: {},
    geometry: { type: 'MultiPolygon', coordinates: [] },
  });
  if (url.pathname === '/api/friend-sharing/sources') return json({ sources: [] });
  if (url.pathname === '/api/memory-subscriptions') return json({ subscriptions: [], count: 0, limit: null });
  return json({ data: [], routes: [], sessions: [], markers: [], notifications: [], count: 0 });
});

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(routes => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: { id: 'cairn9-isolated-qa', name: 'Route QA', email: 'route-qa@example.invalid' },
    isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
  });
  stores.useSettingsStore.getState().saveAll({ debugMode: false, appearance: 'day', mapLayer: 'outdoors' });
  stores.useRouteStore.setState({ routes, routeOwnerId: 'cairn9-isolated-qa', routesLoading: false, routesLoadError: false });
}, fixtures);

const results = [];
for (const fixture of fixtures) {
  await page.evaluate(routeId => globalThis.__cairnStores.navigationRef.reset({
    index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId } }],
  }), fixture.id);
  await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
  await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
  await page.evaluate(() => globalThis.__cairnMap?.resize?.());
  await page.waitForTimeout(350);
  const screenshot = `${fixture.id}-editor-390x844.png`;
  await page.screenshot({ path: path.join(outputDir, screenshot) });
  if (fixture.expectedRepeat) {
    await page.evaluate(target => globalThis.__cairnMap?.easeTo?.({
      center: target, zoom: 18, bearing: 28, duration: 900, essential: true,
    }), [fixture.points[2].lng, fixture.points[2].lat]);
    for (let frame = 0; frame < 8; frame += 1) {
      await page.waitForTimeout(110);
      await page.screenshot({ path: path.join(outputDir, `route-turn-frame-${String(frame).padStart(2, '0')}.png`) });
    }
    await page.waitForTimeout(120);
    await page.screenshot({ path: path.join(outputDir, `${fixture.id}-turn-z18-390x844.png`) });
  }
  const runtime = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const layers = (map?.getStyle?.()?.layers ?? []).filter(layer => layer.id.startsWith('ordered-route-'));
    const repeats = layers.filter(layer => layer.id.includes('repeat-lane'));
    let renderedRepeatFeatures = 0;
    try {
      renderedRepeatFeatures = repeats.length
        ? map.queryRenderedFeatures(undefined, { layers: repeats.map(layer => layer.id) }).length
        : 0;
    } catch {}
    return {
      styleLoaded: Boolean(map?.isStyleLoaded?.()),
      repeatLayerIds: repeats.map(layer => layer.id),
      repeatOffsets: repeats.map(layer => map.getPaintProperty(layer.id, 'line-offset')),
      roundRepeatLayers: repeats.every(layer => map.getLayoutProperty(layer.id, 'line-cap') === 'round'
        && map.getLayoutProperty(layer.id, 'line-join') === 'round'),
      repeatLabelLayerCount: layers.filter(layer => layer.id.includes('repeat-label')).length,
      renderedRepeatFeatures,
      headerVisible: Boolean(document.querySelector('[data-testid="route-editor-header"]')),
    };
  });
  const pass = runtime.styleLoaded && runtime.headerVisible
    && (fixture.expectedRepeat
      ? runtime.repeatLayerIds.length === 2
        && runtime.roundRepeatLayers
        && runtime.repeatOffsets.every(value => Array.isArray(value) && value[0] === 'get' && value[1] === 'offsetPx')
        && runtime.renderedRepeatFeatures > 0
      : runtime.repeatLayerIds.length === 0 && runtime.repeatLabelLayerCount === 0);
  results.push({
    id: fixture.id, geometryHash: hash(fixture.points), pointCount: fixture.points.length,
    expectedRepeat: fixture.expectedRepeat, screenshot, runtime, pass,
  });
}

await page.waitForTimeout(250);
await page.close();
await context.close();
await browser.close();
const clipPath = path.join(outputDir, 'route-display-interaction.webm');
execFileSync('/usr/local/bin/ffmpeg', [
  '-hide_banner', '-loglevel', 'error', '-y', '-framerate', '8',
  '-i', path.join(outputDir, 'route-turn-frame-%02d.png'),
  '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-an', clipPath,
]);
const report = {
  generatedAt: new Date().toISOString(),
  evidenceClass: 'CURRENT_EXPO_WEB_PRODUCTION_ROUTE_SURFACES_OVER_REAL_MAPBOX_WITH_ISOLATED_GEOMETRY',
  boundary: 'Real Mapbox rendering and production screen/layer code; synthetic geometry is a visual negative/control fixture, not walking evidence.',
  rawCoordinateArraysPersisted: false,
  interactionClip: path.basename(clipPath),
  results,
  runtimeErrors,
  verdict: results.every(result => result.pass) && runtimeErrors.length === 0 ? 'PASS' : 'FAIL',
};
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ verdict: report.verdict, outputDir, results: results.map(result => ({ id: result.id, pass: result.pass })) }));
if (report.verdict !== 'PASS') process.exitCode = 1;
