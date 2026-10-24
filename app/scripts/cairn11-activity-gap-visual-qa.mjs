#!/usr/bin/env node

/**
 * Read-only production identity + local production-screen visual proof for
 * retained QA Activity 2142. The Activity geometry comes from the exact live
 * row, while all editing stays in a disposable browser-local copy.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import sharp from 'sharp';

const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_TOKEN is required');
const baseUrl = process.env.CAIRN_QA_URL ?? 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN11_ACTIVITY_OUTPUT ?? '/tmp/cairn11-activity-2142-visual');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const hashPoints = points => sha(points.map(value => [Number(value.lat).toFixed(7), Number(value.lng).toFixed(7), String(value.segmentId ?? '')]));
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const distanceM = (a, b) => {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
};
const lineDistanceM = points => points.slice(1).reduce((sum, value, index) => sum + distanceM(points[index], value), 0);

const productionSource = `
const pool=require('./src/config/db');
(async()=>{const [rows]=await pool.execute(
  \`SELECT s.id,s.user_id,s.client_activity_id,s.name,s.source_provenance,s.type,
          s.start_time,s.end_time,s.duration_s,s.distance_m,s.route_points_canonical,u.email
     FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=2142\`);
  process.stdout.write(JSON.stringify(rows));await pool.end();
})().catch(error=>{console.error(error.message);process.exit(1)});
`.trim();
const remote = `docker exec cairn-backend sh -lc ${quote(`cd /app && node -e ${quote(productionSource)}`)}`;
const rows = JSON.parse(execFileSync('ssh', [
  '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@122.51.174.118', remote,
], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
if (rows.length !== 1) throw new Error('Activity 2142 is not uniquely present');
const row = rows[0];
const rawPoints = typeof row.route_points_canonical === 'string'
  ? JSON.parse(row.route_points_canonical) : row.route_points_canonical;
const activityPoints = rawPoints.map(value => ({
  ...value,
  lat: Number(value.lat),
  lng: Number(value.lng),
  segmentId: String(value.segment_id ?? value.segmentId ?? 'legacy'),
  segmentStartReason: value.segment_start_reason ?? value.segmentStartReason,
}));
const segments = [];
for (const value of activityPoints) {
  if (segments.at(-1)?.id !== value.segmentId) segments.push({ id: value.segmentId, points: [] });
  segments.at(-1).points.push(value);
}
if (Number(row.id) !== 2142 || row.name !== 'QA — Activity Gap Bridge Test'
  || row.source_provenance !== 'isolated_qa' || String(row.email).toLowerCase() !== 'frankmengwork2@gmail.com'
  || activityPoints.length !== 79 || segments.length !== 2) {
  throw new Error('Activity 2142 provenance/topology gate failed');
}

const p = segments[0].points[Math.max(1, Math.floor(segments[0].points.length * 0.68))];
const q = segments[1].points[Math.min(segments[1].points.length - 2, Math.floor(segments[1].points.length * 0.32))];
const bridgeUrl = `https://api.mapbox.com/directions/v5/mapbox/walking/${p.lng},${p.lat};${q.lng},${q.lat}?alternatives=false&geometries=geojson&overview=full&steps=false&radiuses=25%3B25&access_token=${encodeURIComponent(token)}`;
const bridgeResponse = await fetch(bridgeUrl);
const bridgeBody = await bridgeResponse.json();
const bridgeCoordinates = bridgeBody?.routes?.[0]?.geometry?.coordinates;
if (!bridgeResponse.ok || bridgeBody?.code !== 'Ok' || !Array.isArray(bridgeCoordinates) || bridgeCoordinates.length < 2) {
  throw new Error(`Activity 2142 bridge provider unavailable:${bridgeResponse.status}:${bridgeBody?.code ?? 'unknown'}`);
}
const bridgeStroke = bridgeCoordinates.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));

const user = {
  id: String(row.user_id), name: 'Verified QA Activity owner', email: 'qa-owner-redacted@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
};
const session = {
  id: row.client_activity_id,
  clientActivityId: row.client_activity_id,
  remoteId: 2142,
  serverActivityId: 2142,
  activityMode: row.type === 'running' ? 'running' : 'hiking',
  regionCode: 'NZ-AUK',
  startedAt: Date.parse(row.start_time),
  endedAt: Date.parse(row.end_time),
  durationS: Number(row.duration_s),
  distanceM: Number(row.distance_m),
  elevationGainM: 0,
  trackPoints: activityPoints,
  markerIds: [],
  name: row.name,
  memoryNewCells: 0,
  syncState: 'synced',
  qaProvenance: 'isolated_qa',
};

fs.mkdirSync(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'en-NZ' });
const page = await context.newPage();
const runtimeErrors = [];
const providerCalls = [];
page.on('pageerror', error => runtimeErrors.push(`pageerror:${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(`console:${message.text()}`);
});
page.on('response', async response => {
  const url = response.url();
  if (!/api\.mapbox\.com\/(matching|directions)\/v5\/mapbox\/walking/.test(url)) return;
  let body = null;
  try { body = await response.json(); } catch {}
  const parsed = new URL(url);
  providerCalls.push({
    endpoint: parsed.pathname.includes('/matching/') ? 'matching' : 'directions',
    requestIdentitySha256: sha({
      endpoint: parsed.pathname.includes('/matching/') ? 'matching' : 'directions',
      coordinateCount: decodeURIComponent(parsed.pathname.split('/').at(-1) ?? '').split(';').length,
      parameters: [...parsed.searchParams.keys()].filter(value => value !== 'access_token').sort(),
    }),
    httpStatus: response.status(), code: body?.code ?? null,
    routeCount: Array.isArray(body?.routes) ? body.routes.length : null,
    matchingCount: Array.isArray(body?.matchings) ? body.matchings.length : null,
  });
});

await page.addInitScript(userId => {
  localStorage.setItem('cairn_jwt', 'cairn11-activity-2142-local');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
}, user.id);
await page.route('**/api/**', async intercepted => {
  const pathname = new URL(intercepted.request().url()).pathname;
  const json = body => intercepted.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  if (pathname.endsWith('/api/auth/me')) return json({ user });
  if (pathname.endsWith('/api/memory/coverage')) return json({
    coverage_rule_version: 4, coverage_version: 'cairn11-empty', evidence_count: 0,
    geometry: { type: 'MultiPolygon', coordinates: [] },
  });
  return json({ data: [], routes: [], sessions: [], markers: [], notifications: [], subscriptions: [] });
});

const waitRoute = name => page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, name, { timeout: 60_000 });
const waitMap = async overlay => {
  await page.getByTestId(overlay).waitFor({ state: 'hidden', timeout: 45_000 }).catch(() => {});
  await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.() && globalThis.__cairnMap?.isStyleLoaded?.()), null, { timeout: 45_000 });
  await page.waitForFunction(() => globalThis.__cairnMap?.areTilesLoaded?.() === true, null, { timeout: 45_000 });
  await page.waitForTimeout(350);
};
const sourceState = () => page.evaluate(() => {
  const map = globalThis.__cairnMap;
  const style = map.getStyle();
  const layers = (style.layers ?? []).map(value => value.id).filter(value => /track|gap|ordered-route/i.test(value));
  const sources = Object.keys(style.sources ?? {}).filter(value => /track|gap|ordered-route/i.test(value));
  const rendered = {};
  for (const layer of layers) {
    try { rendered[layer] = map.queryRenderedFeatures(undefined, { layers: [layer] }).length; } catch { rendered[layer] = -1; }
  }
  return { layers, sources, rendered };
});

async function pixelEvidence(screenshotPath) {
  const panel = await page.getByTestId('activity-detail-panel').boundingBox();
  const projected = await page.evaluate(values => {
    const map = globalThis.__cairnMap;
    const canvas = map.getCanvas().getBoundingClientRect();
    const project = point => {
      const value = map.project([point.lng, point.lat]);
      return { x: canvas.left + value.x, y: canvas.top + value.y };
    };
    return {
      canvas: { left: canvas.left, top: canvas.top, right: canvas.right, bottom: canvas.bottom },
      first: values.first.map(project), second: values.second.map(project), gap: values.gap.map(project),
    };
  }, {
    first: segments[0].points,
    second: segments[1].points,
    gap: Array.from({ length: 11 }, (_, index) => ({
      lat: segments[0].points.at(-1).lat + (segments[1].points[0].lat - segments[0].points.at(-1).lat) * index / 10,
      lng: segments[0].points.at(-1).lng + (segments[1].points[0].lng - segments[0].points.at(-1).lng) * index / 10,
    })),
  });
  const { data, info } = await sharp(screenshotPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const countNear = (position, target, tolerance = 62, radius = 5) => {
    let count = 0;
    for (let y = Math.max(0, Math.round(position.y) - radius); y <= Math.min(info.height - 1, Math.round(position.y) + radius); y += 1) {
      for (let x = Math.max(0, Math.round(position.x) - radius); x <= Math.min(info.width - 1, Math.round(position.x) + radius); x += 1) {
        const offset = (y * info.width + x) * 4;
        if (Math.hypot(data[offset] - target[0], data[offset + 1] - target[1], data[offset + 2] - target[2]) <= tolerance) count += 1;
      }
    }
    return count;
  };
  const green = [0x5d, 0x7c, 0x46];
  const red = [0xae, 0x39, 0x2f];
  const visibleTop = projected.canvas.top + 96;
  const visibleBottom = Math.min(projected.canvas.bottom, panel?.y ?? projected.canvas.bottom) - 8;
  const inside = position => position.x >= projected.canvas.left + 8 && position.x <= projected.canvas.right - 8
    && position.y >= visibleTop && position.y <= visibleBottom;
  const firstHits = projected.first.map(value => countNear(value, green)).filter(value => value >= 3).length;
  const secondHits = projected.second.map(value => countNear(value, green)).filter(value => value >= 3).length;
  const gapHits = projected.gap.slice(1, -1).map(value => countNear(value, red)).filter(value => value >= 2).length;
  const allCanonicalVisible = [...projected.first, ...projected.second].every(inside);
  return {
    panelTop: panel?.y ?? null,
    visibleMapBand: { top: visibleTop, bottom: visibleBottom },
    projectedCanonicalBounds: {
      minX: Math.min(...projected.first.concat(projected.second).map(value => value.x)),
      maxX: Math.max(...projected.first.concat(projected.second).map(value => value.x)),
      minY: Math.min(...projected.first.concat(projected.second).map(value => value.y)),
      maxY: Math.max(...projected.first.concat(projected.second).map(value => value.y)),
    },
    firstSolidPixelSamples: firstHits,
    secondSolidPixelSamples: secondHits,
    dashedGapPixelSamples: gapHits,
    allCanonicalVisible,
    pass: allCanonicalVisible && firstHits >= 2 && secondHits >= 2 && gapHits >= 2,
  };
}

let receipt;
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
  await page.evaluate(({ userValue, sessionValue, points }) => {
    const stores = globalThis.__cairnStores;
    localStorage.setItem(`cairn_sessions_${userValue.id}`, JSON.stringify([{ ...sessionValue, trackPoints: undefined }]));
    localStorage.setItem(`cairn_trackpoints_${userValue.id}_${sessionValue.id}`, JSON.stringify(points));
    stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
    // Debug mode exposes the development-only deterministic gesture bridge;
    // it does not alter production editor transaction or rendering code.
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
    stores.useSessionStore.setState({ currentUserId: userValue.id, sessions: [sessionValue] });
    stores.useRouteStore.setState({ routes: [], sharedRoutes: [], routeOwnerId: userValue.id, routesLoading: false, routesLoadError: false });
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'MapHistory', params: { sessionId: sessionValue.id, activityBackContext: 'activities' } }] });
  }, { userValue: user, sessionValue: session, points: activityPoints });

  await waitRoute('MapHistory');
  await page.getByTestId('activity-create-route').waitFor({ state: 'visible', timeout: 30_000 });
  await waitMap('history-map-load-overlay');
  const activity390 = path.join(outputDir, '01-activity-2142-solid-dashed-solid-390x844.png');
  await page.screenshot({ path: activity390 });
  const activity390State = await sourceState();
  const activity390Pixels = await pixelEvidence(activity390);

  await page.getByTestId('activity-create-route').click();
  await waitRoute('RouteEditor');
  await page.getByTestId('route-editor-title').waitFor({ state: 'visible', timeout: 30_000 });
  await waitMap('ordered-route-map-load-overlay');
  await page.waitForFunction(() => Boolean(globalThis.__cairnRouteEditorQa?.submitStroke), null, { timeout: 30_000 });
  const imported = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  const editorState = await sourceState();
  await page.screenshot({ path: path.join(outputDir, '02-activity-2142-imported-editor-390x844.png') });

  const classification = await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.classifyStroke(stroke), bridgeStroke);
  const providerStart = providerCalls.length;
  await page.getByTestId('route-tool-draw').click();
  await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), bridgeStroke);
  await page.waitForFunction(revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    imported.revision, { timeout: 45_000 });
  const bridged = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(outputDir, '03-activity-2142-interior-bridge-390x844.png') });

  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByTestId('route-editor-confirm-leave').waitFor({ state: 'visible', timeout: 10_000 });
  await page.getByTestId('route-editor-confirm-leave').click();
  await waitRoute('MapHistory');
  await page.setViewportSize({ width: 430, height: 932 });
  await waitMap('history-map-load-overlay');
  const activity430 = path.join(outputDir, '04-activity-2142-reopened-430x932.png');
  await page.screenshot({ path: activity430 });
  const activity430State = await sourceState();
  const activity430Pixels = await pixelEvidence(activity430);
  const localAfter = await page.evaluate(({ userId, sessionId }) => JSON.parse(localStorage.getItem(`cairn_trackpoints_${userId}_${sessionId}`) ?? '[]'), { userId: user.id, sessionId: session.id });

  const providerAttempts = providerCalls.slice(providerStart);
  receipt = {
    source: {
      activityId: 2142,
      ownerIdentitySha256: sha(`${row.user_id}:${String(row.email).toLowerCase()}`),
      accountVerified: true,
      clientActivityIdSha256: sha(row.client_activity_id),
      name: row.name,
      provenance: row.source_provenance,
      pointCount: activityPoints.length,
      segmentPointCounts: segments.map(value => value.points.length),
      geometrySha256: hashPoints(activityPoints),
      solidDistanceM: Number(segments.reduce((sum, value) => sum + lineDistanceM(value.points), 0).toFixed(2)),
      gapChordM: Number(distanceM(segments[0].points.at(-1), segments[1].points[0]).toFixed(2)),
      productionWrites: 0,
    },
    rendering: { renderer: 'Expo Web + actual hosted Mapbox', iphoneNative: false },
    activity390: { sourceState: activity390State, pixels: activity390Pixels },
    imported: {
      partCount: imported.parts.length, gapCount: imported.gaps.length,
      partPointCounts: imported.parts.map(value => value.points.length),
      topologySha256: sha(imported.parts.map(value => ({ resolution: value.resolution, points: hashPoints(value.points) }))),
      sourceState: editorState,
    },
    bridge: {
      classification: classification.intent?.kind ?? null,
      crossedGapCount: classification.intent?.options?.[0]?.crossedGapIds?.length ?? null,
      committedPartResolutions: bridged.parts.map(value => value.resolution),
      remainingGapCount: bridged.gaps.length,
      providerAttempts,
    },
    reopened430: { sourceState: activity430State, pixels: activity430Pixels },
    assertions: {
      exactProductionActivityReadOnly: true,
      activity390BothSolidsAndGapPixelsVisible: activity390Pixels.pass,
      activity430ReentryBothSolidsAndGapPixelsVisible: activity430Pixels.pass,
      layerExistenceNotSoleOracle: true,
      importedGapTopologyPreserved: imported.parts.length === 2 && imported.gaps.length === 1,
      editorGapLayerVisible: editorState.layers.some(value => value.includes('ordered-route-gap')),
      interiorBridgeClassifiedAcrossGap: classification.intent?.kind === 'replace-across-gap'
        && classification.intent?.options?.[0]?.crossedGapIds?.length === 1,
      acceptedBridgeRemovedOnlyGap: bridged.gaps.length === 0,
      bridgeUsedRealProvider: providerAttempts.some(value => value.httpStatus === 200 && value.code === 'Ok'),
      originalActivityUnchanged: hashPoints(localAfter) === hashPoints(activityPoints),
      noRuntimeErrors: runtimeErrors.length === 0,
    },
    screenshots: [
      '01-activity-2142-solid-dashed-solid-390x844.png',
      '02-activity-2142-imported-editor-390x844.png',
      '03-activity-2142-interior-bridge-390x844.png',
      '04-activity-2142-reopened-430x932.png',
    ],
    runtimeErrors,
  };
  receipt.pass = Object.values(receipt.assertions).every(Boolean);
  fs.writeFileSync(path.join(outputDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, pass: receipt.pass, assertions: receipt.assertions }, null, 2));
  if (!receipt.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
