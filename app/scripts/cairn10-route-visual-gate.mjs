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
  { id: 'long-distance-repeat', points: [point(0), point(1_250), point(2_500), point(1_250), point(0)], passes: 2, turns: [point(2_500)] },
  { id: 'different-density', points: [point(0), point(100), point(75), point(50), point(25), point(0)], passes: 2, turns: [point(100)] },
  { id: 'parallel-streets', points: [point(0), point(100), point(100, 8), point(0, 8)], passes: 1, turns: [] },
  { id: 'closed-o', points: [point(0), point(60), point(60, 45), point(0, 45), point(0)], passes: 1, turns: [] },
  { id: 'figure-eight-crossing', points: [point(0), point(45, 45), point(90), point(0, 45), point(45), point(90, 45)], passes: 1, turns: [] },
  { id: 'mixed-repeat-ordinary', points: [point(0), point(45), point(90), point(45), point(0), point(0, 55), point(45, 80)], passes: 2, turns: [point(90)] },
  {
    id: 'true-gap',
    points: [point(0), point(55), point(85), point(145)],
    parts: [
      { id: 'true-gap:before', resolution: 'draw-manual', points: [point(0), point(55)] },
      { id: 'true-gap:after', resolution: 'draw-manual', points: [point(85), point(145)] },
    ],
    gaps: [{ id: 'true-gap:missing-evidence', afterPartId: 'true-gap:before', reason: 'activity-gap' }],
    passes: 1,
    turns: [],
  },
].map(fixture => ({
  ...fixture,
  ownerId: 'cairn10-isolated-qa', clientRouteId: `cairn10-${fixture.id}`,
  name: `QA ${fixture.id}`, permission: 'personal', creationOrigin: 'plan', resolutionState: 'continuous',
  distanceM: 0, elevationGainM: 0, createdAt: Date.now(), updatedAt: Date.now(),
  orderedDraft: {
    schemaVersion: 1, draftId: `cairn10-${fixture.id}`, ownerId: 'cairn10-isolated-qa', origin: 'plan', revision: 1,
    parts: fixture.parts ?? [{ id: `${fixture.id}:part`, resolution: 'draw-manual', points: fixture.points }],
    gaps: fixture.gaps ?? [],
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

const captureUntilRoutePixels = async (page, screenshotPath, projected, approachProjected) => {
  let pixels = null;
  let attempts = 0;
  const maxAttempts = Number(process.env.CAIRN_ROUTE_PIXEL_ATTEMPTS ?? 8);
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    await page.screenshot({ path: screenshotPath });
    pixels = await analyseTurnPixels(screenshotPath, projected, approachProjected);
    if (pixels.routePixelCount >= 20) break;
    await page.evaluate(() => new Promise(resolve => {
      const map = globalThis.__cairnMap;
      if (!map) { resolve(); return; }
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        map.off?.('render', finish);
        resolve();
      };
      map.once?.('render', finish);
      map.resize?.();
      map.repaint = true;
      map.triggerRepaint?.();
      setTimeout(finish, 250);
    }));
  }
  await page.evaluate(() => {
    if (globalThis.__cairnMap) globalThis.__cairnMap.repaint = false;
  });
  return { pixels, attempts };
};

const readWebGlFramebufferHealth = async page => page.evaluate(() => {
  const canvas = globalThis.__cairnMap?.getCanvas?.();
  const gl = canvas?.getContext?.('webgl2') ?? canvas?.getContext?.('webgl');
  if (!canvas || !gl) return { contextCreated: false };
  const width = gl.drawingBufferWidth;
  const height = gl.drawingBufferHeight;
  const pixels = new Uint8Array(Math.max(0, width * height * 4));
  gl.finish?.();
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  let alphaPixels = 0;
  let nonZeroRgbPixels = 0;
  let routeLikePixels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const red = pixels[offset];
    const green = pixels[offset + 1];
    const blue = pixels[offset + 2];
    if (pixels[offset + 3] > 0) alphaPixels += 1;
    if (red > 0 || green > 0 || blue > 0) nonZeroRgbPixels += 1;
    if (Math.hypot(red - 0x2f, green - 0x68, blue - 0x4f) <= 34 && pixels[offset + 3] >= 220) routeLikePixels += 1;
  }
  return {
    contextCreated: true,
    contextLost: Boolean(gl.isContextLost?.()),
    width,
    height,
    alphaPixels,
    nonZeroRgbPixels,
    routeLikePixels,
    preserveDrawingBuffer: gl.getContextAttributes?.()?.preserveDrawingBuffer ?? null,
    error: gl.getError?.() ?? null,
    dataUrlLength: canvas.toDataURL?.('image/png')?.length ?? 0,
  };
});

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
  args: process.env.CAIRN_QA_CHROME_ARGS
    ? process.env.CAIRN_QA_CHROME_ARGS.split(' ').filter(Boolean)
    : ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
  ...(process.env.CAIRN18_VIDEO_CAPTURE === '1'
    ? { recordVideo: { dir: path.join(outputDir, 'compositor-video'), size: { width: 390, height: 844 } } }
    : {}),
});
const page = await context.newPage();
const compositorVideo = page.video();
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
  globalThis.__cairnMapQaPreserveDrawingBuffer = true;
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
  await page.waitForFunction(() => {
    const map = globalThis.__cairnMap;
    const source = map?.getSource?.('ordered-route-parts');
    return Boolean(source?._data?.features?.length)
      && (typeof map.isSourceLoaded !== 'function' || map.isSourceLoaded('ordered-route-parts'));
  }, null, { timeout: 30_000 });
  await page.getByText('Updating exploration…', { exact: true }).waitFor({ state: 'hidden', timeout: 15_000 }).catch(() => {});
  const turn = fixture.turns[0] ?? fixture.points.at(-1);
  const views = [
    { id: 'overview-z15_5', zoom: 15.5, bearing: 0 },
    { id: 'z17', zoom: 17, bearing: fixture.id === 'curved-return' ? 41 : 18 },
    { id: 'z18', zoom: 18, bearing: 28 },
    { id: 'z19_5', zoom: 19.5, bearing: 42 },
    { id: 'z21', zoom: 21, bearing: 67 },
  ];
  const captures = [];
  for (const view of views) {
    await page.evaluate(async ({ turnPoint, zoom, bearing }) => {
      const map = globalThis.__cairnMap;
      map.repaint = true;
      await new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          map.off?.('idle', finish);
          resolve();
        };
        map.once?.('idle', finish);
        map.jumpTo({ center: [turnPoint.lng, turnPoint.lat], zoom, bearing });
        map.triggerRepaint?.();
        setTimeout(finish, 1_000);
      });
    }, { turnPoint: turn, ...view });
    await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForTimeout(350);
    const turnIndex = fixture.points.findIndex(point => point.lat === turn.lat && point.lng === turn.lng);
    const approach = fixture.points[Math.max(0, turnIndex - 1)];
    const screenshot = `${fixture.id}-${view.id}-390x844.png`;
    const screenshotPath = path.join(outputDir, screenshot);
    const connectivityScreenshot = `${fixture.id}-${view.id}-connectivity-mask.png`;
    await page.evaluate(() => {
      const map = globalThis.__cairnMap;
      for (const id of ['ordered-route-repeat-label-text', 'ordered-route-endpoint-circles', 'ordered-route-endpoint-labels']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
      }
      map.triggerRepaint?.();
    });
    await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 15_000 });
    const settledProjected = await page.evaluate(({ turnPoint, approachPoint }) => {
        const projectedPoint = globalThis.__cairnMap.project([turnPoint.lng, turnPoint.lat]);
        const projectedApproach = globalThis.__cairnMap.project([approachPoint.lng, approachPoint.lat]);
        const rect = globalThis.__cairnMap.getCanvas().getBoundingClientRect();
        return {
          turn: { x: rect.left + projectedPoint.x, y: rect.top + projectedPoint.y },
          approach: { x: rect.left + projectedApproach.x, y: rect.top + projectedApproach.y },
          canvasTurn: { x: projectedPoint.x, y: projectedPoint.y },
          canvasApproach: { x: projectedApproach.x, y: projectedApproach.y },
        };
    }, { turnPoint: turn, approachPoint: approach });
    const connectivityPath = path.join(outputDir, connectivityScreenshot);
    const pixelCapture = await captureUntilRoutePixels(
      page,
      connectivityPath,
      settledProjected.turn,
      settledProjected.approach,
    );
    await page.evaluate(() => {
      const map = globalThis.__cairnMap;
      for (const id of ['ordered-route-repeat-label-text', 'ordered-route-endpoint-circles', 'ordered-route-endpoint-labels']) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'visible');
      }
      map.triggerRepaint?.();
    });
    await page.screenshot({ path: screenshotPath });
    let captureSurfaces = null;
    if (fixture.id === 'two-pass' && view.id === 'z18') {
      const canvasOnlyPath = path.join(outputDir, 'two-pass-z18-canvas-only.png');
      const framebufferPath = path.join(outputDir, 'two-pass-z18-framebuffer.png');
      await page.locator('.mapboxgl-canvas').first().screenshot({ path: canvasOnlyPath });
      const canvasDataUrl = await page.evaluate(() => globalThis.__cairnMap?.getCanvas?.()?.toDataURL?.('image/png') ?? '');
      if (canvasDataUrl.startsWith('data:image/png;base64,')) {
        fs.writeFileSync(
          framebufferPath,
          Buffer.from(canvasDataUrl.slice('data:image/png;base64,'.length), 'base64'),
        );
      }
      captureSurfaces = {
        page: pixelCapture.pixels,
        canvas: await analyseTurnPixels(canvasOnlyPath, settledProjected.canvasTurn, settledProjected.canvasApproach),
        framebuffer: fs.existsSync(framebufferPath)
          ? await analyseTurnPixels(framebufferPath, settledProjected.canvasTurn, settledProjected.canvasApproach)
          : null,
        webgl: await readWebGlFramebufferHealth(page),
      };
    }
    captures.push({
      ...view,
      screenshot,
      connectivityScreenshot,
      pixels: pixelCapture.pixels,
      pixelCaptureAttempts: pixelCapture.attempts,
      captureSurfaces,
    });
  }
  const runtime = await page.evaluate(() => {
    const map = globalThis.__cairnMap;
    const layers = (map.getStyle()?.layers ?? []).filter(layer => layer.id.startsWith('ordered-route-'));
    const repeats = layers.filter(layer => layer.id.includes('repeat-lane'));
    const routeLayerIds = layers.filter(layer => layer.type === 'line' || layer.type === 'circle').map(layer => layer.id);
    const routeSource = map.getSource?.('ordered-route-parts');
    const bounds = map.getBounds?.();
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
          contextAttributes: canvas.getContext?.('webgl')?.getContextAttributes?.() ?? null,
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
      routeFogOrder: (() => {
        const ids = (map.getStyle()?.layers ?? []).map(layer => layer.id);
        const boundaryIndex = ids.indexOf('ordered-route-fog-boundary');
        const fogIndices = ids.map((id, index) => id.startsWith('memory-') ? index : -1).filter(index => index >= 0);
        const routeIndices = ids.map((id, index) => id.startsWith('ordered-route-') && id !== 'ordered-route-fog-boundary' ? index : -1).filter(index => index >= 0);
        return {
          boundaryIndex,
          maxFogIndex: fogIndices.length ? Math.max(...fogIndices) : null,
          minRouteIndex: routeIndices.length ? Math.min(...routeIndices) : null,
          safe: boundaryIndex >= 0
            && (fogIndices.length === 0 || Math.max(...fogIndices) < boundaryIndex)
            && routeIndices.length > 0 && Math.min(...routeIndices) > boundaryIndex,
        };
      })(),
      connectorLayerIds: layers.filter(layer => layer.id.includes('turn-connector')).map(layer => layer.id),
      turnCapLayerIds: layers.filter(layer => layer.id.includes('repeat-turn-cap')).map(layer => layer.id),
      repeatLayerIds: repeats.map(layer => layer.id),
      repeatFeatures,
      routeSourcePresent: Boolean(routeSource),
      routeSourceFeatureCount: routeSource?._data?.features?.length ?? null,
      routeSourceCoordinateCounts: routeSource?._data?.features?.map(feature => feature.geometry?.coordinates?.length ?? null) ?? [],
      routeSourceFeaturesInTile: map.querySourceFeatures?.('ordered-route-parts')?.length ?? null,
      routeRenderedFeatureCount: map.queryRenderedFeatures?.(undefined, { layers: routeLayerIds })?.length ?? null,
      mapCamera: {
        center: map.getCenter?.()?.toArray?.() ?? null,
        zoom: map.getZoom?.() ?? null,
        bearing: map.getBearing?.() ?? null,
        bounds: bounds ? [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()] : null,
      },
      endpointProperties,
      endpointSourceProperties: map.getSource?.('ordered-route-endpoints')?._data?.features?.map(feature => feature.properties) ?? [],
      endpointRadius: map.getPaintProperty?.('ordered-route-endpoint-circles', 'circle-radius') ?? null,
      labelFeatures: layers.filter(layer => layer.id.includes('repeat-label')).length,
    };
  });
  const visualExpected = fixture.passes > 1;
  const pass = runtime.styleLoaded
    && runtime.routeFogOrder.safe
    && (visualExpected
      ? runtime.connectorLayerIds.length === 0
        && runtime.turnCapLayerIds.length === 1
        && runtime.repeatFeatures > 0
        && runtime.routeSourceFeatureCount > 0
        && runtime.routeRenderedFeatureCount > 0
        && captures.every(capture => capture.pixels?.connected)
      : runtime.connectorLayerIds.length === 0
        && runtime.turnCapLayerIds.length === 0
        && runtime.repeatLayerIds.length === 0
        && runtime.routeSourceFeatureCount > 0
        && runtime.routeRenderedFeatureCount > 0
        && captures.every(capture => (capture.pixels?.routePixelCount ?? 0) >= 20));
  results.push({ id: fixture.id, pointCount: fixture.points.length, geometryHash: hash(fixture.points), passes: fixture.passes, turnCount: fixture.turns.length, captures, runtime, pass });
}

// Editor and saved Detail must share the same cap contract.
const twoPass = fixtures.find(fixture => fixture.id === 'two-pass');
await page.evaluate(routeId => globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'MapHistory', params: { routeId } }] }), twoPass.clientRouteId);
await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
await page.waitForFunction(() => {
  const map = globalThis.__cairnMap;
  const sourceId = (map?.getStyle?.()?.layers ?? [])
    .find(layer => layer.id.startsWith('route-detail-') && layer.id.endsWith('-casing'))?.source;
  const source = sourceId ? map.getSource?.(sourceId) : null;
  return Boolean(sourceId && source?._data?.features?.length)
    && (typeof map.isSourceLoaded !== 'function' || map.isSourceLoaded(sourceId));
}, null, { timeout: 30_000 });
// Let Detail's one panel-aware initial fit finish before the explicit matched
// camera. The old runner raced that effect and captured the route at an edge.
await page.waitForTimeout(500);
await page.evaluate(async turnPoint => {
  const map = globalThis.__cairnMap;
  map.repaint = true;
  await new Promise(resolve => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      map.off?.('idle', finish);
      resolve();
    };
    map.once?.('idle', finish);
    map.jumpTo({ center: [turnPoint.lng, turnPoint.lat], zoom: 18, bearing: 28 });
    map.triggerRepaint?.();
    setTimeout(finish, 1_000);
  });
}, twoPass.turns[0]);
const detailApproach = twoPass.points[twoPass.points.findIndex(point => point.lat === twoPass.turns[0].lat && point.lng === twoPass.turns[0].lng) - 1];
const detailScreenshot = 'two-pass-detail-z18-390x844.png';
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
const detailPixelCapture = await captureUntilRoutePixels(
  page,
  path.join(outputDir, detailConnectivityScreenshot),
  settledDetailProjected.turn,
  settledDetailProjected.approach,
);
const detailPixels = detailPixelCapture.pixels;
await page.evaluate(() => {
  const map = globalThis.__cairnMap;
  for (const layer of map.getStyle().layers ?? []) {
    if ((layer.id.includes('repeat-label') || layer.id.includes('endpoint')) && map.getLayer(layer.id)) map.setLayoutProperty(layer.id, 'visibility', 'visible');
  }
});
await page.waitForFunction(() => globalThis.__cairnMap?.isStyleLoaded?.() === true, null, { timeout: 15_000 });
await page.waitForTimeout(100);
await page.screenshot({ path: path.join(outputDir, detailScreenshot) });
const detailRuntime = await page.evaluate(() => {
  const map = globalThis.__cairnMap;
  const layers = (map.getStyle()?.layers ?? []).filter(layer => layer.id.startsWith('route-detail-'));
  const routeLayerIds = layers.filter(layer => layer.type === 'line' || layer.type === 'circle').map(layer => layer.id);
  const sourceId = layers.find(layer => layer.id.endsWith('-casing'))?.source;
  const source = sourceId ? map.getSource?.(sourceId) : null;
  return {
    connectorLayerIds: layers.filter(layer => layer.id.includes('turn-connector')).map(layer => layer.id),
    repeatLayerIds: layers.filter(layer => layer.id.includes('repeat-lane')).map(layer => layer.id),
    turnCapLayerIds: layers.filter(layer => layer.id.includes('repeat-turn-cap')).map(layer => layer.id),
    routeSourcePresent: Boolean(source),
    routeSourceFeatureCount: source?._data?.features?.length ?? null,
    routeSourceCoordinateCounts: source?._data?.features?.map(feature => feature.geometry?.coordinates?.length ?? null) ?? [],
    routeRenderedFeatureCount: map.queryRenderedFeatures?.(undefined, { layers: routeLayerIds })?.length ?? null,
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
await context.close();
let compositorVideoFile = null;
if (compositorVideo) {
  const recorded = await compositorVideo.path();
  compositorVideoFile = 'mapbox-compositor-capture.webm';
  fs.copyFileSync(recorded, path.join(outputDir, compositorVideoFile));
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
  screenshotCaptureMethod: 'PLAYWRIGHT_PAGE_SCREENSHOT',
  framebufferCaptureMethod: 'WEBGL_READPIXELS_AND_PRESERVED_CANVAS_TODATAURL',
  results,
  detail: {
    screenshot: detailScreenshot,
    pixels: detailPixels,
    pixelCaptureAttempts: detailPixelCapture.attempts,
    runtime: detailRuntime,
    pass: detailPixels.connected
      && detailRuntime.connectorLayerIds.length === 0
      && detailRuntime.repeatLayerIds.length === 2
      && detailRuntime.turnCapLayerIds.length === 1
      && detailRuntime.routeSourceFeatureCount > 0
      && detailRuntime.routeRenderedFeatureCount > 0,
  },
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
  compositorVideo: compositorVideoFile,
  interactionFrames: frames,
  runtimeErrors,
  verdict: results.every(result => result.pass) && detailPixels.connected
    && detailRuntime.connectorLayerIds.length === 0
    && detailRuntime.repeatLayerIds.length === 2
    && detailRuntime.turnCapLayerIds.length === 1
    && detailRuntime.routeSourceFeatureCount > 0
    && detailRuntime.routeRenderedFeatureCount > 0
    && negativeControl.legacyConnected === true && negativeControl.connected === false
    && omegaNegativeControl.connectorSharesComponent === true
    && omegaNegativeControl.stableScreenCap === false
    && omegaNegativeControl.connected === false
    && runtimeErrors.length === 0 ? 'PASS' : 'FAIL',
};
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, verdict: report.verdict, fixtures: results.map(result => ({ id: result.id, pass: result.pass })) }));
if (report.verdict !== 'PASS') process.exitCode = 1;
