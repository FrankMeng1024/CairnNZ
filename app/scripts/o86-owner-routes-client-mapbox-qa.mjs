#!/usr/bin/env node

/**
 * Read-only O87 proof of the Owner's saved Routes through the current
 * Expo Web Editor and Detail Mapbox surfaces. Production coordinates remain
 * in memory/screenshots; the JSON receipt contains only hashes and counts.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL || 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN_O86_OWNER_ROUTE_OUTPUT || '/tmp/cairn-o86-owner-routes-client');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const expected = new Map([
  [92, 'Test1'], [93, 'Test2'], [94, 'Test3'], [95, 'Test a1'], [96, 'Test a2'], [97, 'Test4'],
  [98, 'wrong1'], [99, 'bad Route'],
]);
const requestedRouteIds = new Set(String(process.env.CAIRN_OWNER_ROUTE_IDS || '')
  .split(',').map(value => value.trim()).filter(Boolean).map(Number).filter(Number.isFinite));
const selectedExpected = new Map([...expected]
  .filter(([routeId]) => requestedRouteIds.size === 0 || requestedRouteIds.has(routeId)));
const geometryVerdicts = new Map([
  [92, 'HISTORICAL_DEFECT_PRESENT: saved Test1 geometry retains the reported first-Draw terminal distortion; render proof is not geometry approval.'],
  [93, 'HISTORICAL_SAVED_ROUTE_CONTEXT: current canonical Test2 is rendered unchanged; realistic disposable multi-Draw validation is reported separately.'],
  [94, 'LEGITIMATE_RETRACE: canonical return is genuine; this proof checks the shared repeated-traversal presentation, not a new routing operation.'],
  [95, 'HISTORICAL_DEFECT_PRESENT: saved Test a1 retains excessive Point detours; the current live Route 95 detour-rejection proof is separate and does not rewrite this Route.'],
  [96, 'HISTORICAL_DEFECT_PRESENT: saved Test a2 remains the destructive short chord; source Activity 2134 is separately proven immutable.'],
  [97, 'HISTORICAL_MANUAL_GEOMETRY: saved Test4 raw terminal remains water-adjacent; manual provenance is not walking-network approval.'],
  [98, 'OWNER_O87_REGRESSION: exact saved wrong1 canonical geometry; visual continuity must be assessed without changing traversal order.'],
  [99, 'OWNER_O91_REGRESSION: exact saved bad Route canonical geometry; read-only render proof does not modify or approve the original.'],
]);
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const query = `
const pool=require('./src/config/db');
(async()=>{
  const [routes]=await pool.execute(
    'SELECT id,user_id,name,description,points,waypoints,distance_m,elevation_gain_m,permission,created_at,updated_at,ordered_draft,resolution_state,creation_origin,source_activity_client_id,source_session_id,origin_geometry_hash,created_geometry_hash,geometry_edited_since_creation FROM routes WHERE id IN (92,93,94,95,96,97,98,99) ORDER BY id'
  );
  process.stdout.write(JSON.stringify(routes));
  await pool.end();
})().catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(1)});
`.trim();
const command = `docker exec cairn-backend sh -lc ${quote(`cd /app && node -e ${quote(query)}`)}`;
const rows = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@122.51.174.118', command,
], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
const selectedRows = rows.filter(row => selectedExpected.has(Number(row.id)));
if (selectedRows.length !== selectedExpected.size) {
  throw new Error(`Expected ${selectedExpected.size} selected routes, received ${selectedRows.length}`);
}

const parse = value => typeof value === 'string' ? JSON.parse(value) : value;
const normalizeName = value => String(value).toLowerCase().replaceAll(/[^a-z0-9]/g, '');
const distanceM = (a, b) => {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
};
const expectedCanonicalLines = route => {
  const orderedParts = (route.orderedDraft?.parts ?? [])
    .map(part => ({ id: part.id, points: (part.points ?? []).filter(point => (
      Number.isFinite(point?.lat) && Number.isFinite(point?.lng)
    )) }))
    .filter(part => part.points.length >= 2);
  const parts = orderedParts.length > 0
    ? orderedParts
    : [{ id: 'legacy-route', points: route.points }];
  const gapAfter = new Set((route.orderedDraft?.gaps ?? []).map(gap => gap.afterPartId));
  const lines = [];
  parts.forEach((part, partIndex) => {
    const coordinates = part.points.map(point => [point.lng, point.lat]);
    const previous = lines.at(-1);
    const hasGap = partIndex > 0 && gapAfter.has(parts[partIndex - 1].id);
    if (previous && !hasGap && distanceM(parts[partIndex - 1].points.at(-1), part.points[0]) <= 0.5) {
      previous.push(...coordinates.slice(1));
    } else {
      lines.push(coordinates);
    }
  });
  return lines;
};
const routes = selectedRows.map(row => {
  if (normalizeName(row.name) !== normalizeName(expected.get(Number(row.id)))) {
    throw new Error(`Route ${row.id} identity mismatch`);
  }
  const points = parse(row.points) ?? [];
  return {
    id: String(row.id), clientRouteId: `server-${row.id}`, name: row.name,
    description: row.description ?? '', points, waypoints: parse(row.waypoints) ?? [],
    distanceM: Number(row.distance_m) || 0, elevationGainM: Number(row.elevation_gain_m) || 0,
    permission: row.permission ?? 'personal', createdAt: Date.parse(row.created_at), updatedAt: Date.parse(row.updated_at),
    orderedDraft: parse(row.ordered_draft), resolutionState: row.resolution_state ?? 'continuous',
    creationOrigin: row.creation_origin ?? 'planned', sourceActivityClientId: row.source_activity_client_id ?? null,
    sourceSessionId: row.source_session_id == null ? null : Number(row.source_session_id),
    originGeometryHash: row.origin_geometry_hash ?? null, createdGeometryHash: row.created_geometry_hash ?? null,
    geometryEditedSinceCreation: Boolean(row.geometry_edited_since_creation),
    runCount: 0, isActive: false, syncState: 'synced', ownerId: String(row.user_id),
  };
});
fs.mkdirSync(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist'],
});
const results = [];
for (const savedRoute of routes) {
  const canonicalLines = expectedCanonicalLines(savedRoute);
  const expectedCanonicalSourceHash = hash(canonicalLines);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 1,
    locale: 'en-NZ', timezoneId: 'Pacific/Auckland', reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', message => {
    const value = message.text();
    if (message.type() === 'error' && !value.includes('Failed to load resource')
      && !value.includes("Cannot read properties of undefined (reading 'send')")) errors.push(`console: ${value}`);
  });
  await page.addInitScript(ownerId => {
    globalThis.__cairnMapQaTestMode = false;
    globalThis.__cairnMapQaLocalStyle = false;
    localStorage.setItem('cairn_jwt', 'o86-owner-route-read-only');
    localStorage.setItem('cairn_onboarding_v1_done', 'true');
    localStorage.setItem(`cairn_onboarding_v1_done_${ownerId}`, 'true');
  }, savedRoute.ownerId);
  await page.route('**/api/**', async intercepted => {
    const url = new URL(intercepted.request().url());
    const json = body => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return json({ user: {
      id: savedRoute.ownerId, name: 'Owner', email: 'owner-route-read-only@example.invalid',
    } });
    if (url.pathname === '/api/memory/coverage') return json({
      coverage_rule_version: 4, coverage_version: 'o86-empty', evidence_count: 0,
      tile_count: 0, rebuilt_tile_count: 0, total_ms: 1, stage_ms: {},
      geometry: { type: 'MultiPolygon', coordinates: [] },
    });
    if (url.pathname === '/api/friend-sharing/sources') return json({ sources: [] });
    if (url.pathname === '/api/memory-subscriptions') return json({ subscriptions: [], count: 0, limit: null });
    return json({ data: [], routes: [], sessions: [], markers: [], notifications: [], count: 0 });
  });
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
    await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
    await page.evaluate(route => {
      const stores = globalThis.__cairnStores;
      stores.useAppStore.setState({
        user: { id: route.ownerId, name: 'Owner', email: 'owner-route-read-only@example.invalid' },
        isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {},
      });
      stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
      stores.useRouteStore.setState({ routes: [route], routeOwnerId: route.ownerId, routesLoading: false, routesLoadError: false });
      stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId: route.id } }] });
    }, savedRoute);
    await page.getByText('Edit Route', { exact: true }).waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 30_000 });
    await page.evaluate(() => globalThis.__cairnMap?.resize?.());
    await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForTimeout(250);
    const editorPath = path.join(outputDir, `route-${savedRoute.id}-${savedRoute.name.replaceAll(' ', '-').toLowerCase()}-editor-390x844.png`);
    await page.screenshot({ path: editorPath });
    const editor = await page.evaluate(expectedLines => {
      const map = globalThis.__cairnMap;
      const layers = (map?.getStyle?.()?.layers ?? []).filter(layer => layer.id.includes('ordered-route'));
      const lines = layers.filter(layer => layer.type === 'line');
      const sourceIds = [...new Set(lines.map(layer => layer.source).filter(Boolean))];
      const displayLines = sourceIds.flatMap(sourceId => {
        const data = map?.getSource?.(sourceId)?._data;
        const shape = typeof data === 'string' ? JSON.parse(data) : data;
        return (shape?.features ?? []).filter(feature => feature?.geometry?.type === 'LineString')
          .map(feature => feature.geometry.coordinates);
      });
      const metres = (a, b) => {
        const latitude = (a[1] + b[1]) * Math.PI / 360;
        return Math.hypot((a[0] - b[0]) * 111_320 * Math.cos(latitude), (a[1] - b[1]) * 110_574);
      };
      const pointSegment = (point, a, b) => {
        const latitude = point[1] * Math.PI / 180;
        const px = (point[0] - a[0]) * 111_320 * Math.cos(latitude);
        const py = (point[1] - a[1]) * 110_574;
        const bx = (b[0] - a[0]) * 111_320 * Math.cos(latitude);
        const by = (b[1] - a[1]) * 110_574;
        const denominator = bx * bx + by * by;
        const fraction = denominator ? Math.max(0, Math.min(1, (px * bx + py * by) / denominator)) : 0;
        return Math.hypot(px - bx * fraction, py - by * fraction);
      };
      const expectedSegments = expectedLines.flatMap(line => line.slice(1).map((point, index) => [line[index], point]));
      const displayLengthM = displayLines.reduce((sum, line) => sum + line.slice(1)
        .reduce((lineSum, point, index) => lineSum + metres(line[index], point), 0), 0);
      const expectedLengthM = expectedLines.reduce((sum, line) => sum + line.slice(1)
        .reduce((lineSum, point, index) => lineSum + metres(line[index], point), 0), 0);
      const maxCanonicalDeviationM = displayLines.flat().reduce((maximum, point) => Math.max(maximum,
        Math.min(...expectedSegments.map(([a, b]) => pointSegment(point, a, b)))), 0);
      const displayLengthRatio = expectedLengthM > 0 ? displayLengthM / expectedLengthM : 1;
      let renderedRouteFeatures = -1;
      try {
        renderedRouteFeatures = lines.length
          ? map.queryRenderedFeatures(undefined, { layers: lines.map(layer => layer.id) }).length
          : 0;
      } catch {}
      return {
        styleLoaded: Boolean(map?.isStyleLoaded?.()),
        routeLayers: layers.map(layer => layer.id),
        routeLineLayerIds: lines.map(layer => layer.id),
        repeatLineLayerIds: lines.filter(layer => layer.id.includes('repeat-')).map(layer => layer.id),
        lineOffsets: lines.map(layer => map.getPaintProperty(layer.id, 'line-offset')).filter(value => value != null),
        roundRepeatLayers: lines.filter(layer => layer.id.includes('repeat-')).every(layer => (
          map.getLayoutProperty(layer.id, 'line-cap') === 'round'
          && map.getLayoutProperty(layer.id, 'line-join') === 'round'
        )),
        displaySourceLineCount: displayLines.length,
        displaySourceCoordinateCount: displayLines.reduce((sum, line) => sum + line.length, 0),
        maxCanonicalDeviationM,
        displayLengthRatio,
        displayCoverageMatchesExpected: maxCanonicalDeviationM <= 0.25
          && displayLengthRatio >= 0.99 && displayLengthRatio <= 1.01,
        renderedRouteFeatures,
      };
    }, canonicalLines);

    await page.evaluate(routeId => globalThis.__cairnStores.navigationRef.reset({
      index: 1, routes: [{ name: 'Home' }, { name: 'MapHistory', params: { routeId } }],
    }), savedRoute.id);
    await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
    await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 30_000 });
    await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.()), null, { timeout: 30_000 });
    await page.evaluate(() => globalThis.__cairnMap?.resize?.());
    await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 30_000 });
    await page.waitForTimeout(250);
    const detailPath = path.join(outputDir, `route-${savedRoute.id}-${savedRoute.name.replaceAll(' ', '-').toLowerCase()}-detail-390x844.png`);
    await page.screenshot({ path: detailPath });
    const detail = await page.evaluate(expectedLines => {
      const map = globalThis.__cairnMap;
      const layers = map?.getStyle?.()?.layers ?? [];
      const routeLines = layers.filter(layer => layer.type === 'line' && layer.id.startsWith('route-detail-'));
      const sourceIds = [...new Set(routeLines.map(layer => layer.source).filter(Boolean))];
      const displayLines = sourceIds.flatMap(sourceId => {
        const data = map?.getSource?.(sourceId)?._data;
        const shape = typeof data === 'string' ? JSON.parse(data) : data;
        return (shape?.features ?? []).filter(feature => feature?.geometry?.type === 'LineString')
          .map(feature => feature.geometry.coordinates);
      });
      const metres = (a, b) => {
        const latitude = (a[1] + b[1]) * Math.PI / 360;
        return Math.hypot((a[0] - b[0]) * 111_320 * Math.cos(latitude), (a[1] - b[1]) * 110_574);
      };
      const pointSegment = (point, a, b) => {
        const latitude = point[1] * Math.PI / 180;
        const px = (point[0] - a[0]) * 111_320 * Math.cos(latitude);
        const py = (point[1] - a[1]) * 110_574;
        const bx = (b[0] - a[0]) * 111_320 * Math.cos(latitude);
        const by = (b[1] - a[1]) * 110_574;
        const denominator = bx * bx + by * by;
        const fraction = denominator ? Math.max(0, Math.min(1, (px * bx + py * by) / denominator)) : 0;
        return Math.hypot(px - bx * fraction, py - by * fraction);
      };
      const expectedSegments = expectedLines.flatMap(line => line.slice(1).map((point, index) => [line[index], point]));
      const displayLengthM = displayLines.reduce((sum, line) => sum + line.slice(1)
        .reduce((lineSum, point, index) => lineSum + metres(line[index], point), 0), 0);
      const expectedLengthM = expectedLines.reduce((sum, line) => sum + line.slice(1)
        .reduce((lineSum, point, index) => lineSum + metres(line[index], point), 0), 0);
      const maxCanonicalDeviationM = displayLines.flat().reduce((maximum, point) => Math.max(maximum,
        Math.min(...expectedSegments.map(([a, b]) => pointSegment(point, a, b)))), 0);
      const displayLengthRatio = expectedLengthM > 0 ? displayLengthM / expectedLengthM : 1;
      return {
        styleLoaded: Boolean(map?.isStyleLoaded?.()),
        repeatLayers: layers.filter(layer => layer.id.includes('repeat-')).map(layer => layer.id),
        roundRepeatLayers: routeLines.filter(layer => layer.id.includes('repeat-')).every(layer => (
          map.getLayoutProperty(layer.id, 'line-cap') === 'round'
          && map.getLayoutProperty(layer.id, 'line-join') === 'round'
        )),
        displaySourceLineCount: displayLines.length,
        displaySourceCoordinateCount: displayLines.reduce((sum, line) => sum + line.length, 0),
        maxCanonicalDeviationM,
        displayLengthRatio,
        displayCoverageMatchesExpected: maxCanonicalDeviationM <= 0.25
          && displayLengthRatio >= 0.99 && displayLengthRatio <= 1.01,
        attributionVisible: [...document.querySelectorAll('.mapboxgl-ctrl-logo,.mapboxgl-ctrl-attrib')]
          .some(node => { const box = node.getBoundingClientRect(); return box.width > 0 && box.height > 0; }),
      };
    }, canonicalLines);
    const zoomMatrix = [];
    const zoomAnimationFrames = [];
    // The Owner's topology contract is multi-zoom and includes transition
    // frames. Keep it mandatory by default; an explicit diagnostic opt-out
    // may shorten a local run, but can never produce a release PASS below.
    if (process.env.CAIRN_OWNER_ROUTE_ZOOM_MATRIX !== '0') {
      const eastTurn = savedRoute.points.reduce((best, point) => point.lng > best.lng ? point : best, savedRoute.points[0]);
      const westTurn = savedRoute.points.reduce((best, point) => point.lng < best.lng ? point : best, savedRoute.points[0]);
      for (const view of [
        { zoom: 10, bearing: 0 }, { zoom: 12, bearing: 0 }, { zoom: 14, bearing: 0 },
        { zoom: 14.5, bearing: 37 },
        { zoom: 16, bearing: 0, focus: 'east', center: [eastTurn.lng, eastTurn.lat] },
        { zoom: 18, bearing: 41, focus: 'east', center: [eastTurn.lng, eastTurn.lat] },
        { zoom: 20, bearing: 0, focus: 'east', center: [eastTurn.lng, eastTurn.lat] },
        { zoom: 18, bearing: -33, focus: 'west', center: [westTurn.lng, westTurn.lat] },
      ]) {
        await page.evaluate(({ zoom, bearing, center }) => {
          const map = globalThis.__cairnMap;
          map?.jumpTo?.({ center: center ?? map.getCenter(), zoom, bearing });
        }, view);
        await page.waitForTimeout(180);
        const suffix = `z${String(view.zoom).replace('.', '-')}-b${view.bearing}${view.focus ? `-${view.focus}` : ''}`;
        const capture = `route-${savedRoute.id}-${savedRoute.name.replaceAll(' ', '-').toLowerCase()}-detail-${suffix}-390x844.png`;
        await page.screenshot({ path: path.join(outputDir, capture) });
        const frame = await page.evaluate(() => {
          const map = globalThis.__cairnMap;
          const routeLayers = (map?.getStyle?.()?.layers ?? []).filter(layer => layer.id.startsWith('route-detail-'));
          const routeSources = [...new Set(routeLayers.map(layer => layer.source).filter(Boolean))];
          const routeLineLayers = routeLayers.filter(layer => layer.type === 'line');
          let renderedFeatures = -1;
          try {
            const lineLayers = routeLineLayers.map(layer => layer.id);
            renderedFeatures = lineLayers.length
              ? map.queryRenderedFeatures(undefined, { layers: lineLayers }).length
              : 0;
          } catch {}
          return {
            zoom: map?.getZoom?.() ?? null,
            bearing: map?.getBearing?.() ?? null,
            routeSourceCount: routeSources.length,
            routeLayerCount: routeLayers.length,
            routeLineLayerIds: routeLineLayers.map(layer => layer.id),
            repeatLineLayerIds: routeLineLayers.filter(layer => layer.id.includes('repeat-')).map(layer => layer.id),
            lineOffsets: routeLineLayers.map(layer => map.getPaintProperty(layer.id, 'line-offset')).filter(value => value != null),
            roundRepeatLayers: routeLineLayers.filter(layer => layer.id.includes('repeat-')).every(layer => (
              map.getLayoutProperty(layer.id, 'line-cap') === 'round'
              && map.getLayoutProperty(layer.id, 'line-join') === 'round'
            )),
            renderedFeatures,
          };
        });
        const { center: _privateCenter, ...safeView } = view;
        zoomMatrix.push({ ...safeView, ...frame, screenshot: capture });
      }

      // Inspect intermediate Mapbox zoom/bearing frames in both directions.
      // This is the closest deterministic Web equivalent of a continuous
      // pinch; native finger ownership remains an Owner iPhone gate.
      for (const direction of ['in', 'out']) {
        await page.evaluate(({ center, direction }) => {
          const map = globalThis.__cairnMap;
          const zoom = direction === 'in' ? 12 : 18;
          const bearing = direction === 'in' ? 0 : 47;
          map.jumpTo({ center, zoom, bearing });
          map.easeTo({
            center,
            zoom: direction === 'in' ? 18 : 12,
            bearing: direction === 'in' ? 47 : 0,
            duration: 1_260,
            easing: value => value,
            essential: true,
          });
        }, { center: [eastTurn.lng, eastTurn.lat], direction });
        for (let index = 0; index < 7; index += 1) {
          await page.waitForTimeout(index === 0 ? 40 : 190);
          const capture = `route-${savedRoute.id}-zoom-${direction}-frame-${index}.png`;
          await page.screenshot({ path: path.join(outputDir, capture) });
          const frame = await page.evaluate(() => {
            const map = globalThis.__cairnMap;
            const layers = (map?.getStyle?.()?.layers ?? [])
              .filter(layer => layer.id.startsWith('route-detail-') && layer.type === 'line');
            let renderedFeatures = -1;
            try {
              renderedFeatures = map.queryRenderedFeatures(undefined, { layers: layers.map(layer => layer.id) }).length;
            } catch {}
            return {
              zoom: map?.getZoom?.() ?? null,
              bearing: map?.getBearing?.() ?? null,
              routeLineLayerIds: layers.map(layer => layer.id),
              repeatLineLayerIds: layers.filter(layer => layer.id.includes('repeat-')).map(layer => layer.id),
              lineOffsets: layers.map(layer => map.getPaintProperty(layer.id, 'line-offset')).filter(value => value != null),
              roundRepeatLayers: layers.filter(layer => layer.id.includes('repeat-')).every(layer => (
                map.getLayoutProperty(layer.id, 'line-cap') === 'round'
                && map.getLayoutProperty(layer.id, 'line-join') === 'round'
              )),
              renderedFeatures,
            };
          });
          zoomAnimationFrames.push({ direction, index, ...frame, screenshot: capture });
        }
      }
    }
    const topologyFrames = [...zoomMatrix, ...zoomAnimationFrames];
    const topologyPass = zoomMatrix.length === 8
      && zoomAnimationFrames.length === 14
      && topologyFrames.every(frame => (
        frame.renderedFeatures > 0
        && frame.repeatLineLayerIds.length % 2 === 0
        && frame.roundRepeatLayers
        && frame.lineOffsets.every(value => (
          Number(value) === 0
          || (Array.isArray(value) && value[0] === 'get' && value[1] === 'offsetPx')
        ))
      ));
    const editorTopologyPass = editor.repeatLineLayerIds.length % 2 === 0
      && editor.roundRepeatLayers
      && editor.lineOffsets.every(value => (
        Number(value) === 0
        || (Array.isArray(value) && value[0] === 'get' && value[1] === 'offsetPx')
      ))
      && editor.displayCoverageMatchesExpected;
    const detailTopologyPass = detail.roundRepeatLayers && detail.displayCoverageMatchesExpected;
    const renderPass = editor.styleLoaded && editor.routeLayers.length >= 2 && editor.renderedRouteFeatures > 0
      && editorTopologyPass
      && detail.styleLoaded && detail.attributionVisible && detailTopologyPass && topologyPass && errors.length === 0;
    results.push({
      routeId: Number(savedRoute.id), name: savedRoute.name,
      sourceActivityPresent: Boolean(savedRoute.sourceActivityClientId), sourceSessionId: savedRoute.sourceSessionId,
      pointCount: savedRoute.points.length, geometryHash: hash(savedRoute.points.map(point => [point.lng, point.lat])),
      orderedPartCount: savedRoute.orderedDraft?.parts?.length ?? 0,
      orderedResolutions: savedRoute.orderedDraft?.parts?.map(part => part.resolution) ?? [],
      expectedCanonicalSourceHash, expectedCanonicalLineCount: canonicalLines.length,
      editor, detail, zoomMatrix, zoomAnimationFrames, editorTopologyPass, detailTopologyPass, topologyPass,
      screenshots: [path.basename(editorPath), path.basename(detailPath), ...zoomMatrix.map(frame => frame.screenshot), ...zoomAnimationFrames.map(frame => frame.screenshot)], errors,
      geometryVerdict: geometryVerdicts.get(Number(savedRoute.id)),
      renderPass,
      pass: renderPass,
    });
  } catch (error) {
    errors.push(error?.stack || String(error));
    results.push({ routeId: Number(savedRoute.id), name: savedRoute.name, errors, pass: false });
  } finally {
    await context.close();
  }
}
await browser.close();
const report = {
  generatedAt: new Date().toISOString(), baseline: 'current worktree',
  evidenceClass: 'READ_ONLY_PRODUCTION_SAVED_ROUTE_THROUGH_CURRENT_EXPO_WEB_EDITOR_AND_DETAIL_REAL_MAPBOX',
  privacy: 'JSON contains counts/hashes only; no token, owner identity, or coordinates.',
  resultBoundary: 'PASS means the exact saved canonical geometry is visible in Editor and Detail over a real Mapbox basemap. It does not mean every historical geometry is physically or algorithmically correct.',
  results, verdict: results.every(result => result.renderPass) ? 'RENDER_PASS' : 'FAIL',
};
fs.writeFileSync(path.join(outputDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ outputDir, verdict: report.verdict, routes: results.map(result => ({ id: result.routeId, pass: result.pass })) }));
if (report.verdict !== 'RENDER_PASS') process.exitCode = 1;
