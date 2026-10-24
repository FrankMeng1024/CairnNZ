#!/usr/bin/env node

/**
 * Cairn #10 display-only retrace gate. Isolated public-place geometry runs
 * through the production Editor and Detail Mapbox layers at 390x844. The
 * pixel oracle samples the actual screenshot around the known turnback; it
 * does not certify continuity from style properties alone.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN10_ROUTE_VISUAL_OUTPUT || '/tmp/cairn10-route-visual-gate');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const origin = { lat: -41.2865, lng: 174.7762 };
const point = (eastM, northM = 0) => ({
  lat: origin.lat + northM / 111_132,
  lng: origin.lng + eastM / (111_320 * Math.cos(origin.lat * Math.PI / 180)),
});
const fixtures = [
  { id: 'one-way', points: [point(0), point(45), point(90)], passes: 1, turns: [] },
  { id: 'two-pass', points: [point(0), point(45), point(90), point(45), point(0)], passes: 2, turns: [point(90)] },
  { id: 'three-pass', points: [point(0), point(45), point(90), point(45), point(0), point(45), point(90)], passes: 3, turns: [point(90), point(0)] },
  { id: 'five-pass', points: [point(0), point(90), point(0), point(90), point(0), point(90)], passes: 5, turns: [point(90), point(0)] },
  { id: 'curved-return', points: [point(0), point(28, 12), point(62, 20), point(95), point(62, 20), point(28, 12), point(0)], passes: 2, turns: [point(95)] },
  { id: 'short-tight-u', points: [point(0), point(16), point(32), point(16), point(0)], passes: 2, turns: [point(32)] },
  { id: 'long-u', points: [point(0), point(80), point(160), point(80), point(0)], passes: 2, turns: [point(160)] },
  { id: 'different-density', points: [point(0), point(100), point(75), point(50), point(25), point(0)], passes: 2, turns: [point(100)] },
  { id: 'parallel-streets', points: [point(0), point(100), point(100, 8), point(0, 8)], passes: 1, turns: [] },
].map(fixture => ({
  ...fixture,
  ownerId: 'cairn10-isolated-qa', clientRouteId: `cairn10-${fixture.id}`,
  name: `QA ${fixture.id}`, permission: 'personal', creationOrigin: 'plan', resolutionState: 'continuous',
  distanceM: 0, elevationGainM: 0, createdAt: Date.now(), updatedAt: Date.now(),
  orderedDraft: {
    schemaVersion: 1, draftId: `cairn10-${fixture.id}`, ownerId: 'cairn10-isolated-qa', origin: 'plan', revision: 1,
    parts: [{ id: `${fixture.id}:part`, resolution: 'draw-manual', points: fixture.points }], gaps: [],
  },
}));
const selectedFixtureId = process.env.CAIRN10_VISUAL_FIXTURE?.trim();
const selectedFixtures = selectedFixtureId
  ? fixtures.filter(fixture => fixture.id === selectedFixtureId)
  : fixtures;
if (selectedFixtureId && selectedFixtures.length !== 1) {
  throw new Error(`Unknown CAIRN10_VISUAL_FIXTURE: ${selectedFixtureId}`);
}

const analyseTurnPixels = async (screenshotPath, projected) => {
  const radius = 22;
  const metadata = await sharp(screenshotPath).metadata();
  const left = Math.max(0, Math.round(projected.x) - radius);
  const top = Math.max(0, Math.round(projected.y) - radius);
  const width = Math.min(radius * 2 + 1, metadata.width - left);
  const height = Math.min(radius * 2 + 1, metadata.height - top);
  const { data, info } = await sharp(screenshotPath).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const target = [0x2f, 0x68, 0x4f];
  const mask = new Uint8Array(info.width * info.height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const delta = Math.hypot(data[offset] - target[0], data[offset + 1] - target[1], data[offset + 2] - target[2]);
    if (delta <= 34 && data[offset + 3] >= 220) mask[index] = 1;
  }
  const seen = new Uint8Array(mask.length);
  const components = [];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || seen[seed]) continue;
    const queue = [seed];
    seen[seed] = 1;
    let count = 0; let minX = info.width; let maxX = 0; let minY = info.height; let maxY = 0;
    while (queue.length) {
      const current = queue.pop();
      const x = current % info.width; const y = Math.floor(current / info.width);
      count += 1; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx; const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= info.width || ny >= info.height) continue;
        const next = ny * info.width + nx;
        if (mask[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (count >= 4) components.push({ count, width: maxX - minX + 1, height: maxY - minY + 1 });
  }
  components.sort((a, b) => b.count - a.count);
  const centreX = Math.round(projected.x) - left;
  const centreY = Math.round(projected.y) - top;
  let centreRoutePixels = 0;
  for (let y = Math.max(0, centreY - 3); y <= Math.min(info.height - 1, centreY + 3); y += 1) {
    for (let x = Math.max(0, centreX - 3); x <= Math.min(info.width - 1, centreX + 3); x += 1) {
      centreRoutePixels += mask[y * info.width + x];
    }
  }
  const largest = components[0] ?? { count: 0, width: 0, height: 0 };
  return {
    crop: { width: info.width, height: info.height },
    routePixelCount: mask.reduce((sum, value) => sum + value, 0),
    componentCount: components.length,
    largest,
    centreRoutePixels,
    connected: centreRoutePixels >= 12 && largest.count >= 75 && Math.max(largest.width, largest.height) >= 24,
  };
};

fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
const page = await context.newPage();
const runtimeErrors = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error' && !value.includes('Failed to load resource')
    && !value.includes("Cannot read properties of undefined (reading 'send')")) runtimeErrors.push(`console: ${value}`);
});
await page.addInitScript(() => {
  localStorage.setItem('cairn_jwt', 'cairn10-route-visual-isolated');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_cairn10-isolated-qa', 'true');
});
await page.route('**/api/**', async intercepted => {
  const url = new URL(intercepted.request().url());
  const json = body => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/auth/me') return json({ user: { id: 'cairn10-isolated-qa', name: 'Route QA', email: 'route-qa@example.invalid' } });
  if (url.pathname === '/api/memory/coverage') return json({ coverage_rule_version: 4, coverage_version: 'empty', evidence_count: 0, geometry: { type: 'MultiPolygon', coordinates: [] } });
  if (url.pathname === '/api/friend-sharing/sources') return json({ sources: [] });
  if (url.pathname === '/api/memory-subscriptions') return json({ subscriptions: [], count: 0, limit: null });
  return json({ data: [], routes: [], sessions: [], markers: [], notifications: [], count: 0 });
});
await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
await page.evaluate(routes => {
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({ user: { id: 'cairn10-isolated-qa', name: 'Route QA', email: 'route-qa@example.invalid' }, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
  stores.useSettingsStore.getState().saveAll({ debugMode: false, appearance: 'day', mapLayer: 'outdoors' });
  stores.useRouteStore.setState({ routes, routeOwnerId: 'cairn10-isolated-qa', routesLoading: false, routesLoadError: false });
}, fixtures);

const frames = [];
const results = [];
for (const fixture of selectedFixtures) {
  await page.evaluate(routeId => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId } }] }), fixture.clientRouteId);
  await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
  try {
    await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({
      overlay: document.querySelector('[data-testid="ordered-route-map-load-overlay"]')?.textContent ?? null,
      mapPresent: Boolean(globalThis.__cairnMap),
      loaded: globalThis.__cairnMap?.loaded?.() ?? null,
      styleLoaded: globalThis.__cairnMap?.isStyleLoaded?.() ?? null,
      layers: globalThis.__cairnMap?.getStyle?.()?.layers?.filter(layer => layer.id.startsWith('ordered-route-')).map(layer => layer.id) ?? [],
    }));
    console.error(JSON.stringify({ fixture: fixture.id, diagnostic, runtimeErrors }));
    throw error;
  }
  await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
  const turn = fixture.turns[0] ?? fixture.points.at(-1);
  const views = fixture.id === 'two-pass'
    ? [{ id: 'overview', zoom: 15.5, bearing: 0 }, { id: 'z18', zoom: 18, bearing: 28 }]
    : [{ id: 'check', zoom: 17, bearing: fixture.id === 'curved-return' ? 41 : 0 }];
  const captures = [];
  for (const view of views) {
    await page.evaluate(({ turnPoint, zoom, bearing }) => globalThis.__cairnMap.jumpTo({ center: [turnPoint.lng, turnPoint.lat], zoom, bearing }), { turnPoint: turn, ...view });
    await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForTimeout(180);
    const projected = await page.evaluate(turnPoint => {
      const projectedPoint = globalThis.__cairnMap.project([turnPoint.lng, turnPoint.lat]);
      const rect = globalThis.__cairnMap.getCanvas().getBoundingClientRect();
      return { x: rect.left + projectedPoint.x, y: rect.top + projectedPoint.y };
    }, turn);
    const screenshot = `${fixture.id}-${view.id}-390x844.png`;
    const screenshotPath = path.join(outputDir, screenshot);
    await page.screenshot({ path: screenshotPath });
    const pixels = fixture.passes > 1 ? await analyseTurnPixels(screenshotPath, projected) : null;
    captures.push({ ...view, screenshot, pixels });
  }
  const runtime = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const layers = (map.getStyle()?.layers ?? []).filter(layer => layer.id.startsWith('ordered-route-'));
    const connectors = layers.filter(layer => layer.id.includes('turn-connector'));
    const repeats = layers.filter(layer => layer.id.includes('repeat-lane'));
    let connectorFeatures = 0;
    try { connectorFeatures = connectors.length ? map.queryRenderedFeatures(undefined, { layers: connectors.map(layer => layer.id) }).length : 0; } catch {}
    let endpointProperties = [];
    try {
      endpointProperties = map.queryRenderedFeatures(undefined, { layers: ['ordered-route-endpoint-circles'] })
        .map(feature => feature.properties);
    } catch {}
    return {
      styleLoaded: Boolean(map.isStyleLoaded()),
      connectorLayerIds: connectors.map(layer => layer.id),
      repeatLayerIds: repeats.map(layer => layer.id),
      connectorFeatures,
      endpointProperties,
      endpointSourceProperties: map.getSource?.('ordered-route-endpoints')?._data?.features?.map(feature => feature.properties) ?? [],
      endpointRadius: map.getPaintProperty?.('ordered-route-endpoint-circles', 'circle-radius') ?? null,
      labelFeatures: layers.filter(layer => layer.id.includes('repeat-label')).length,
    };
  });
  const visualExpected = fixture.passes > 1;
  const pass = runtime.styleLoaded
    && (visualExpected
      ? runtime.connectorLayerIds.length === 2 && runtime.connectorFeatures > 0 && captures.every(capture => capture.pixels?.connected)
      : runtime.connectorLayerIds.length === 0 && runtime.repeatLayerIds.length === 0);
  results.push({ id: fixture.id, pointCount: fixture.points.length, geometryHash: hash(fixture.points), passes: fixture.passes, turnCount: fixture.turns.length, captures, runtime, pass });
}

// Editor and saved Detail must share the same cap contract.
const twoPass = fixtures.find(fixture => fixture.id === 'two-pass');
await page.evaluate(routeId => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'MapHistory', params: { routeId } }] }), twoPass.clientRouteId);
await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
await page.evaluate(turnPoint => globalThis.__cairnMap.jumpTo({ center: [turnPoint.lng, turnPoint.lat], zoom: 18, bearing: 28 }), twoPass.turns[0]);
await page.waitForTimeout(300);
const detailProjected = await page.evaluate(turnPoint => {
  const p = globalThis.__cairnMap.project([turnPoint.lng, turnPoint.lat]);
  const rect = globalThis.__cairnMap.getCanvas().getBoundingClientRect();
  return { x: rect.left + p.x, y: rect.top + p.y };
}, twoPass.turns[0]);
const detailScreenshot = 'two-pass-detail-z18-390x844.png';
await page.screenshot({ path: path.join(outputDir, detailScreenshot) });
const detailPixels = await analyseTurnPixels(path.join(outputDir, detailScreenshot), detailProjected);
const detailRuntime = await page.evaluate(() => {
  const layers = (globalThis.__cairnMap.getStyle()?.layers ?? []).filter(layer => layer.id.startsWith('route-detail-'));
  return { connectorLayerIds: layers.filter(layer => layer.id.includes('turn-connector')).map(layer => layer.id) };
});

// Real ease frames supply the short interaction clip; the final pixel result
// is separately measured from the settled screenshots above.
await page.evaluate(turnPoint => {
  globalThis.__cairnMap.jumpTo({ center: [turnPoint.lng, turnPoint.lat], zoom: 15.5, bearing: 0 });
  globalThis.__cairnMap.easeTo({ center: [turnPoint.lng, turnPoint.lat], zoom: 18, bearing: 42, duration: 1_000, essential: true });
}, twoPass.turns[0]);
for (let index = 0; index < 8; index += 1) {
  await page.waitForTimeout(125);
  const name = `route-turn-frame-${String(index).padStart(2, '0')}.png`;
  await page.screenshot({ path: path.join(outputDir, name) });
  frames.push(name);
}
await browser.close();
const clip = 'route-u-turn-zoom-bearing.webm';
execFileSync('/usr/local/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', '8', '-i', path.join(outputDir, 'route-turn-frame-%02d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuv420p', '-an', path.join(outputDir, clip)]);
const report = {
  generatedAt: new Date().toISOString(),
  evidenceClass: 'CURRENT_PRODUCTION_EDITOR_AND_DETAIL_REAL_MAPBOX_SCREENSHOT_PIXELS_AT_390x844',
  boundary: 'Synthetic public-place geometry tests display projection only; canonical/persisted route coordinates remain unchanged. RNMapbox iPhone pixels remain native pending.',
  rawCoordinateArraysPersisted: false,
  results,
  detail: { screenshot: detailScreenshot, pixels: detailPixels, runtime: detailRuntime, pass: detailPixels.connected && detailRuntime.connectorLayerIds.length === 2 },
  interactionClip: clip,
  interactionFrames: frames,
  runtimeErrors,
  verdict: results.every(result => result.pass) && detailPixels.connected && detailRuntime.connectorLayerIds.length === 2 && runtimeErrors.length === 0 ? 'PASS' : 'FAIL',
};
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, verdict: report.verdict, fixtures: results.map(result => ({ id: result.id, pass: result.pass })) }));
if (report.verdict !== 'PASS') process.exitCode = 1;
