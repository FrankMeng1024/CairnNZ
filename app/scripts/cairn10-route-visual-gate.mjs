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
const usesLocalStyle = process.env.CAIRN_QA_LOCAL_STYLE === '1';
const chromePath = process.env.CAIRN_QA_CHROME_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
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

const analyseTurnPixels = async (screenshotPath, projected, approachProjected, target = [0x2f, 0x68, 0x4f]) => {
  const radius = 22;
  const metadata = await sharp(screenshotPath).metadata();
  const left = Math.max(0, Math.round(projected.x) - radius);
  const top = Math.max(0, Math.round(projected.y) - radius);
  const width = Math.min(radius * 2 + 1, metadata.width - left);
  const height = Math.min(radius * 2 + 1, metadata.height - top);
  const { data, info } = await sharp(screenshotPath).extract({ left, top, width, height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const colorTolerance = target[0] === 0xff && target[1] === 0 ? 110 : 34;
  const mask = new Uint8Array(info.width * info.height);
  for (let index = 0; index < mask.length; index += 1) {
    const offset = index * 4;
    const delta = Math.hypot(data[offset] - target[0], data[offset + 1] - target[1], data[offset + 2] - target[2]);
    if (delta <= colorTolerance && data[offset + 3] >= 220) mask[index] = 1;
  }
  const seen = new Uint8Array(mask.length);
  const componentIds = new Int32Array(mask.length).fill(-1);
  const components = [];
  for (let seed = 0; seed < mask.length; seed += 1) {
    if (!mask[seed] || seen[seed]) continue;
    const queue = [seed];
    seen[seed] = 1;
    const componentId = components.length;
    let count = 0; let minX = info.width; let maxX = 0; let minY = info.height; let maxY = 0;
    while (queue.length) {
      const current = queue.pop();
      const x = current % info.width; const y = Math.floor(current / info.width);
      componentIds[current] = componentId;
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
  const dx = projected.x - approachProjected.x;
  const dy = projected.y - approachProjected.y;
  const directionLength = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / directionLength; const uy = dy / directionLength;
  const px = -uy; const py = ux;
  const componentNear = (x, y, searchRadius = 5) => {
    let nearest = null;
    for (let sy = Math.max(0, Math.round(y) - searchRadius); sy <= Math.min(info.height - 1, Math.round(y) + searchRadius); sy += 1) {
      for (let sx = Math.max(0, Math.round(x) - searchRadius); sx <= Math.min(info.width - 1, Math.round(x) + searchRadius); sx += 1) {
        const index = sy * info.width + sx;
        if (!mask[index] || componentIds[index] < 0) continue;
        const distance = Math.hypot(sx - x, sy - y);
        if (!nearest || distance < nearest.distance) nearest = { componentId: componentIds[index], distance };
      }
    }
    return nearest;
  };
  const localTurn = { x: projected.x - left, y: projected.y - top };
  const armDistance = Math.min(14, Math.max(8, directionLength * 0.22));
  const armOffset = 3.5;
  const armBase = { x: localTurn.x - ux * armDistance, y: localTurn.y - uy * armDistance };
  const leftArm = componentNear(armBase.x + px * armOffset, armBase.y + py * armOffset);
  const rightArm = componentNear(armBase.x - px * armOffset, armBase.y - py * armOffset);
  const outerTurn = componentNear(localTurn.x + ux * 1.5, localTurn.y + uy * 1.5, 4);
  const armsShareComponent = Boolean(leftArm && rightArm && leftArm.componentId === rightArm.componentId);
  const connectorSharesComponent = Boolean(armsShareComponent && outerTurn && outerTurn.componentId === leftArm.componentId);
  let forwardExtentPx = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      if (!mask[y * info.width + x]) continue;
      const relativeX = x - localTurn.x;
      const relativeY = y - localTurn.y;
      const forward = relativeX * ux + relativeY * uy;
      const perpendicular = Math.abs(relativeX * px + relativeY * py);
      if (perpendicular <= 12) forwardExtentPx = Math.max(forwardExtentPx, forward);
    }
  }
  const stableScreenCap = forwardExtentPx <= 8;
  const legacyConnected = centreRoutePixels >= 12 && largest.count >= 75 && Math.max(largest.width, largest.height) >= 24;
  return {
    crop: { width: info.width, height: info.height },
    routePixelCount: mask.reduce((sum, value) => sum + value, 0),
    componentCount: components.length,
    largest,
    centreRoutePixels,
    armSeeds: { left: leftArm, right: rightArm, outerTurn },
    legacyConnected,
    armsShareComponent,
    connectorSharesComponent,
    forwardExtentPx,
    stableScreenCap,
    connected: connectorSharesComponent && stableScreenCap,
  };
};

fs.mkdirSync(outputDir, { recursive: true });
const negativeScreenshot = path.join(outputDir, 'negative-disconnected-parallel-lines.png');
await sharp({ create: { width: 45, height: 45, channels: 4, background: '#101010' } })
  .composite([{ input: Buffer.from(`<svg width="45" height="45"><path d="M2 19 H42" stroke="#ff00ff" stroke-width="4"/><path d="M2 25 H42" stroke="#ff00ff" stroke-width="4"/></svg>`) }])
  .png().toFile(negativeScreenshot);
const negativeControl = await analyseTurnPixels(
  negativeScreenshot,
  { x: 37, y: 22 },
  { x: 2, y: 22 },
  [0xff, 0x00, 0xff],
);
const omegaScreenshot = path.join(outputDir, 'negative-connected-omega.png');
await sharp({ create: { width: 55, height: 45, channels: 4, background: '#101010' } })
  .composite([{ input: Buffer.from('<svg width="55" height="45"><path d="M2 19 H37 M2 25 H37" stroke="#ff00ff" stroke-width="4"/><circle cx="40" cy="22" r="9" fill="none" stroke="#ff00ff" stroke-width="4"/></svg>') }])
  .png().toFile(omegaScreenshot);
const omegaNegativeControl = await analyseTurnPixels(
  omegaScreenshot,
  { x: 37, y: 22 },
  { x: 2, y: 22 },
  [0xff, 0x00, 0xff],
);
const browser = await chromium.launch({
  headless: process.env.CAIRN_VISUAL_HEADED !== '1',
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
await page.addInitScript(({ localStyle }) => {
  globalThis.__cairnMapQaLocalStyle = localStyle;
  // Keep the local style source-free, but retain actual WebGL pixels. The
  // adapter's structural test mode intentionally suppresses the renderer and
  // therefore cannot serve as visual evidence.
  globalThis.__cairnMapQaTestMode = false;
  localStorage.setItem('cairn_jwt', 'cairn10-route-visual-isolated');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_cairn10-isolated-qa', 'true');
}, { localStyle: usesLocalStyle });
await page.route('https://events.mapbox.com/**', intercepted => intercepted.fulfill({ status: 204, body: '' }));
await page.route('**/api/**', async intercepted => {
  const url = new URL(intercepted.request().url());
  const json = body => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (url.pathname === '/api/auth/me') return json({ user: { id: 'cairn10-isolated-qa', name: 'Route QA', email: 'route-qa@example.invalid' } });
  if (url.pathname === '/api/memory/coverage-snapshot') return json({
    manifest: {
      snapshot_id: 'cairn10-empty-complete-v1',
      as_of: '2026-10-24T00:00:00.000Z',
      coverage_rule_version: 4,
      dataset_revision: 'empty-v1',
      expected_pages: 0,
      expected_tiles: 0,
      expected_evidence_count: 0,
      regions: [],
      complete: true,
    },
    page: {
      snapshot_id: 'cairn10-empty-complete-v1',
      page_index: 0,
      tiles: [],
      next_cursor: null,
      complete: true,
      terminal_status: 'complete',
    },
  });
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
  await page.getByText('Updating exploration…', { exact: true }).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  const turn = fixture.turns[0] ?? fixture.points.at(-1);
  const views = fixture.id === 'two-pass'
    ? [
      { id: 'overview-z15_5', zoom: 15.5, bearing: 0 },
      { id: 'z17', zoom: 17, bearing: 18 },
      { id: 'z18', zoom: 18, bearing: 28 },
      { id: 'z19_5', zoom: 19.5, bearing: 42 },
      { id: 'z21', zoom: 21, bearing: 67 },
    ]
    : [{ id: 'check', zoom: 17, bearing: fixture.id === 'curved-return' ? 41 : 0 }];
  const captures = [];
  for (const view of views) {
    await page.evaluate(({ turnPoint, zoom, bearing }) => {
      globalThis.__cairnMap.repaint = true;
      globalThis.__cairnMap.jumpTo({ center: [turnPoint.lng, turnPoint.lat], zoom, bearing });
      globalThis.__cairnMap.triggerRepaint?.();
    }, { turnPoint: turn, ...view });
    await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForTimeout(350);
    const turnIndex = fixture.points.findIndex(point => point.lat === turn.lat && point.lng === turn.lng);
    const approach = fixture.points[Math.max(0, turnIndex - 1)];
    const projected = await page.evaluate(({ turnPoint, approachPoint }) => {
      const projectedPoint = globalThis.__cairnMap.project([turnPoint.lng, turnPoint.lat]);
      const projectedApproach = globalThis.__cairnMap.project([approachPoint.lng, approachPoint.lat]);
      const rect = globalThis.__cairnMap.getCanvas().getBoundingClientRect();
      return {
        turn: { x: rect.left + projectedPoint.x, y: rect.top + projectedPoint.y },
        approach: { x: rect.left + projectedApproach.x, y: rect.top + projectedApproach.y },
      };
    }, { turnPoint: turn, approachPoint: approach });
    const screenshot = `${fixture.id}-${view.id}-390x844.png`;
    const screenshotPath = path.join(outputDir, screenshot);
    await page.screenshot({ path: screenshotPath });
    if (fixture.id === 'two-pass' && view.id === 'z18') {
      await page.locator('.mapboxgl-canvas').first().screenshot({ path: path.join(outputDir, 'two-pass-z18-canvas-only.png') });
    }
    let pixels = null;
    let connectivityScreenshot = null;
    if (fixture.passes > 1) {
      connectivityScreenshot = `${fixture.id}-${view.id}-connectivity-mask.png`;
      await page.evaluate(() => {
        const map = globalThis.__cairnMap;
        for (const id of ['ordered-route-repeat-label-text', 'ordered-route-endpoint-circles', 'ordered-route-endpoint-labels']) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
        }
      });
      await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 15_000 });
      await page.waitForTimeout(250);
      const settledProjected = await page.evaluate(({ turnPoint, approachPoint }) => {
        const projectedPoint = globalThis.__cairnMap.project([turnPoint.lng, turnPoint.lat]);
        const projectedApproach = globalThis.__cairnMap.project([approachPoint.lng, approachPoint.lat]);
        const rect = globalThis.__cairnMap.getCanvas().getBoundingClientRect();
        return {
          turn: { x: rect.left + projectedPoint.x, y: rect.top + projectedPoint.y },
          approach: { x: rect.left + projectedApproach.x, y: rect.top + projectedApproach.y },
        };
      }, { turnPoint: turn, approachPoint: approach });
      const connectivityPath = path.join(outputDir, connectivityScreenshot);
      await page.screenshot({ path: connectivityPath });
      pixels = await analyseTurnPixels(connectivityPath, settledProjected.turn, settledProjected.approach);
      await page.evaluate(() => {
        const map = globalThis.__cairnMap;
        for (const id of ['ordered-route-repeat-label-text', 'ordered-route-endpoint-circles', 'ordered-route-endpoint-labels']) {
          if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
        }
      });
      await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 15_000 });
    }
    captures.push({ ...view, screenshot, connectivityScreenshot, pixels });
    await page.evaluate(() => { globalThis.__cairnMap.repaint = false; });
  }
  const runtime = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const layers = (map.getStyle()?.layers ?? []).filter(layer => layer.id.startsWith('ordered-route-'));
    const repeats = layers.filter(layer => layer.id.includes('repeat-lane'));
    let repeatFeatures = 0;
    try { repeatFeatures = repeats.length ? map.queryRenderedFeatures(undefined, { layers: repeats.map(layer => layer.id) }).length : 0; } catch {}
    let endpointProperties = [];
    try {
      endpointProperties = map.queryRenderedFeatures(undefined, { layers: ['ordered-route-endpoint-circles'] })
        .map(feature => feature.properties);
    } catch {}
    return {
      styleLoaded: Boolean(map.isStyleLoaded()),
      canvas: (() => {
        const canvas = map.getCanvas?.();
        const rect = canvas?.getBoundingClientRect?.();
        return canvas && rect ? {
          width: canvas.width,
          height: canvas.height,
          rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
          opacity: getComputedStyle(canvas).opacity,
          visibility: getComputedStyle(canvas).visibility,
        } : null;
      })(),
      centreElementStack: document.elementsFromPoint(195, 422).map(element => ({
        tag: element.tagName,
        className: typeof element.className === 'string' ? element.className : '',
        testId: element.getAttribute?.('data-testid'),
        background: getComputedStyle(element).backgroundColor,
        position: getComputedStyle(element).position,
        zIndex: getComputedStyle(element).zIndex,
      })),
      orderedLayerStack: layers.map(layer => ({
        id: layer.id,
        type: layer.type,
        color: layer.type === 'line' ? map.getPaintProperty?.(layer.id, 'line-color') : null,
        width: layer.type === 'line' ? map.getPaintProperty?.(layer.id, 'line-width') : null,
        visibility: map.getLayoutProperty?.(layer.id, 'visibility') ?? 'visible',
      })),
      nearbyStyleLayerIds: (map.getStyle()?.layers ?? []).map(layer => layer.id),
      connectorLayerIds: layers.filter(layer => layer.id.includes('turn-connector')).map(layer => layer.id),
      repeatLayerIds: repeats.map(layer => layer.id),
      repeatFeatures,
      endpointProperties,
      endpointSourceProperties: map.getSource?.('ordered-route-endpoints')?._data?.features?.map(feature => feature.properties) ?? [],
      endpointRadius: map.getPaintProperty?.('ordered-route-endpoint-circles', 'circle-radius') ?? null,
      labelFeatures: layers.filter(layer => layer.id.includes('repeat-label')).length,
    };
  });
  const visualExpected = fixture.passes > 1;
  const pass = runtime.styleLoaded
    && (visualExpected
      ? runtime.connectorLayerIds.length === 0 && runtime.repeatFeatures > 0 && captures.every(capture => capture.pixels?.connected)
      : runtime.connectorLayerIds.length === 0 && runtime.repeatLayerIds.length === 0);
  results.push({ id: fixture.id, pointCount: fixture.points.length, geometryHash: hash(fixture.points), passes: fixture.passes, turnCount: fixture.turns.length, captures, runtime, pass });
}

// Editor and saved Detail must share the same cap contract.
const twoPass = fixtures.find(fixture => fixture.id === 'two-pass');
await page.evaluate(routeId => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'MapHistory', params: { routeId } }] }), twoPass.clientRouteId);
await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
await page.evaluate(turnPoint => {
  globalThis.__cairnMap.repaint = true;
  globalThis.__cairnMap.jumpTo({ center: [turnPoint.lng, turnPoint.lat], zoom: 18, bearing: 28 });
  globalThis.__cairnMap.triggerRepaint?.();
}, twoPass.turns[0]);
await page.waitForTimeout(300);
const detailApproach = twoPass.points[twoPass.points.findIndex(point => point.lat === twoPass.turns[0].lat && point.lng === twoPass.turns[0].lng) - 1];
const detailProjected = await page.evaluate(({ turnPoint, approachPoint }) => {
  const p = globalThis.__cairnMap.project([turnPoint.lng, turnPoint.lat]);
  const a = globalThis.__cairnMap.project([approachPoint.lng, approachPoint.lat]);
  const rect = globalThis.__cairnMap.getCanvas().getBoundingClientRect();
  return { turn: { x: rect.left + p.x, y: rect.top + p.y }, approach: { x: rect.left + a.x, y: rect.top + a.y } };
}, { turnPoint: twoPass.turns[0], approachPoint: detailApproach });
const detailScreenshot = 'two-pass-detail-z18-390x844.png';
await page.screenshot({ path: path.join(outputDir, detailScreenshot) });
await page.evaluate(() => {
  const map = globalThis.__cairnMap;
  for (const layer of map.getStyle().layers ?? []) {
    if ((layer.id.includes('repeat-label') || layer.id.includes('endpoint')) && map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'none');
  }
});
await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 15_000 });
// Route Detail performs one final panel-aware camera fit after the shell is
// mounted. Measure against the settled camera, not its earlier projection.
await page.waitForTimeout(350);
const settledDetailProjected = await page.evaluate(({ turnPoint, approachPoint }) => {
  const p = globalThis.__cairnMap.project([turnPoint.lng, turnPoint.lat]);
  const a = globalThis.__cairnMap.project([approachPoint.lng, approachPoint.lat]);
  const rect = globalThis.__cairnMap.getCanvas().getBoundingClientRect();
  return { turn: { x: rect.left + p.x, y: rect.top + p.y }, approach: { x: rect.left + a.x, y: rect.top + a.y } };
}, { turnPoint: twoPass.turns[0], approachPoint: detailApproach });
const detailConnectivityScreenshot = 'two-pass-detail-z18-connectivity-mask.png';
await page.screenshot({ path: path.join(outputDir, detailConnectivityScreenshot) });
const detailPixels = await analyseTurnPixels(path.join(outputDir, detailConnectivityScreenshot), settledDetailProjected.turn, settledDetailProjected.approach);
await page.evaluate(() => {
  const map = globalThis.__cairnMap;
  for (const layer of map.getStyle().layers ?? []) {
    if ((layer.id.includes('repeat-label') || layer.id.includes('endpoint')) && map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'visible');
  }
});
await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 15_000 });
const detailRuntime = await page.evaluate(() => {
  const layers = (globalThis.__cairnMap.getStyle()?.layers ?? []).filter(layer => layer.id.startsWith('route-detail-'));
  return {
    connectorLayerIds: layers.filter(layer => layer.id.includes('turn-connector')).map(layer => layer.id),
    repeatLayerIds: layers.filter(layer => layer.id.includes('repeat-lane')).map(layer => layer.id),
  };
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
  evidenceClass: usesLocalStyle
    ? 'CURRENT_PRODUCTION_EDITOR_AND_DETAIL_INSTALLED_MAPBOX_GL_SCREENSHOT_PIXELS_WITH_LOCAL_QA_STYLE_AT_390x844'
    : 'CURRENT_PRODUCTION_EDITOR_AND_DETAIL_REAL_HOSTED_MAPBOX_SCREENSHOT_PIXELS_AT_390x844',
  boundary: usesLocalStyle
    ? 'No hosted Mapbox credential was available. This exercises the installed Mapbox GL renderer and production layers with a source-free local QA style; hosted-provider and RNMapbox iPhone pixels remain pending. Synthetic public-place geometry tests display projection only; canonical/persisted route coordinates remain unchanged.'
    : 'Synthetic public-place geometry tests display projection only; canonical/persisted route coordinates remain unchanged. RNMapbox iPhone pixels remain native pending.',
  rawCoordinateArraysPersisted: false,
  results,
  detail: { screenshot: detailScreenshot, pixels: detailPixels, runtime: detailRuntime, pass: detailPixels.connected && detailRuntime.connectorLayerIds.length === 0 && detailRuntime.repeatLayerIds.length === 2 },
  negativeControl: {
    screenshot: path.basename(negativeScreenshot),
    measurements: negativeControl,
    legacyConnected: negativeControl.legacyConnected,
    correctedConnected: negativeControl.connected,
    pass: negativeControl.legacyConnected === true && negativeControl.connected === false,
  },
  omegaNegativeControl: {
    screenshot: path.basename(omegaScreenshot),
    measurements: omegaNegativeControl,
    connectedBeforeShapeGate: omegaNegativeControl.connectorSharesComponent,
    rejectedAsOmega: omegaNegativeControl.connected === false && omegaNegativeControl.stableScreenCap === false,
    pass: omegaNegativeControl.connectorSharesComponent === true
      && omegaNegativeControl.stableScreenCap === false
      && omegaNegativeControl.connected === false,
  },
  interactionClip: clip,
  interactionFrames: frames,
  runtimeErrors,
  verdict: results.every(result => result.pass) && detailPixels.connected
    && detailRuntime.connectorLayerIds.length === 0 && detailRuntime.repeatLayerIds.length === 2
    && negativeControl.legacyConnected === true && negativeControl.connected === false
    && omegaNegativeControl.connectorSharesComponent === true
    && omegaNegativeControl.stableScreenCap === false
    && omegaNegativeControl.connected === false
    && runtimeErrors.length === 0 ? 'PASS' : 'FAIL',
};
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, verdict: report.verdict, fixtures: results.map(result => ({ id: result.id, pass: result.pass })) }));
if (report.verdict !== 'PASS') process.exitCode = 1;
