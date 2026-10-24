#!/usr/bin/env node

/** Public/synthetic, real-Mapbox visual journey for Cairn #10. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL ?? 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN10_PUBLIC_GAP_OUTPUT ?? '/tmp/cairn10-public-gap-journey');
const token = process.env.EXPO_PUBLIC_MAPBOX_TOKEN;
if (!token) throw new Error('EXPO_PUBLIC_MAPBOX_TOKEN is required');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const distanceM = (a, b) => {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
};
const lineDistanceM = points => points.slice(1).reduce((sum, point, index) => sum + distanceM(points[index], point), 0);
const hashPoints = points => sha(points.map(point => [point.lat.toFixed(7), point.lng.toFixed(7)]));
const resample = (points, max = 80) => points.length <= max
  ? points.map(point => ({ ...point }))
  : Array.from({ length: max }, (_, index) => ({ ...points[Math.round(index * (points.length - 1) / (max - 1))] }));
const receiptDraft = draft => ({
  revision: draft.revision,
  origin: draft.origin,
  partCount: draft.parts.length,
  gapCount: draft.gaps.length,
  pointCounts: draft.parts.map(part => part.points.length),
  resolutions: draft.parts.map(part => part.resolution),
  canonicalSha256: hashPoints(draft.parts.flatMap(part => part.points)),
  partSha256: sha(draft.parts.map(part => ({ resolution: part.resolution, points: hashPoints(part.points) }))),
});

fs.mkdirSync(outputDir, { recursive: true });
const publicStart = { lng: 174.7638, lat: -36.8482 };
const publicEnd = { lng: 174.7732, lat: -36.8448 };
const directionsUrl = `https://api.mapbox.com/directions/v5/mapbox/walking/${publicStart.lng},${publicStart.lat};${publicEnd.lng},${publicEnd.lat}?alternatives=false&geometries=geojson&overview=full&steps=false&radiuses=25%3B25&access_token=${encodeURIComponent(token)}`;
const seedResponse = await fetch(directionsUrl);
const seedBody = await seedResponse.json();
const seedCoordinates = seedBody?.routes?.[0]?.geometry?.coordinates;
if (!seedResponse.ok || seedBody?.code !== 'Ok' || !Array.isArray(seedCoordinates) || seedCoordinates.length < 16) {
  throw new Error(`Public Mapbox seed route unavailable:${seedResponse.status}:${seedBody?.code ?? 'unknown'}`);
}
const road = seedCoordinates.map(([lng, lat]) => ({ lat: Number(lat), lng: Number(lng) }));
const cumulative = [0];
road.slice(1).forEach((point, index) => cumulative.push(cumulative[index] + distanceM(road[index], point)));
const totalM = cumulative.at(-1);
const indexAtFraction = fraction => cumulative.findIndex(value => value >= totalM * fraction);
const segmentOneEnd = indexAtFraction(0.38);
const segmentTwoStart = indexAtFraction(0.62);
const anchorPIndex = indexAtFraction(0.26);
const anchorQIndex = indexAtFraction(0.74);
if (!(anchorPIndex > 0 && anchorPIndex < segmentOneEnd
  && segmentOneEnd + 1 < segmentTwoStart && segmentTwoStart < anchorQIndex && anchorQIndex < road.length - 1)) {
  throw new Error('Public route did not yield useful interior gap anchors');
}
const segmentOne = road.slice(0, segmentOneEnd + 1).map((point, index) => ({
  ...point, t: 1_800_000_000_000 + index * 4_000, segmentId: 'qa-gap-west',
  ...(index === 0 ? { segmentStartReason: 'start' } : {}),
}));
const segmentTwo = road.slice(segmentTwoStart).map((point, index) => ({
  ...point, t: 1_800_000_500_000 + index * 4_000, segmentId: 'qa-gap-east',
  ...(index === 0 ? { segmentStartReason: 'gps-reacquired' } : {}),
}));
const activityPoints = [...segmentOne, ...segmentTwo];
const bridgeStroke = resample(road.slice(anchorPIndex, anchorQIndex + 1), 80);
const user = {
  id: 'cairn10-public-gap-qa', name: 'Cairn QA', email: 'cairn10-public-gap@example.invalid',
  createdAt: '2026-10-24T00:00:00.000Z', dateOfBirth: '1990-01-01', hasPassword: true, providers: ['email'],
};
const session = {
  id: 'cairn10-public-gap-activity', clientActivityId: 'cairn10-public-gap-activity',
  activityMode: 'hiking', regionCode: 'NZ-AUK', startedAt: 1_800_000_000_000,
  endedAt: 1_800_001_000_000, durationS: 1_000,
  distanceM: lineDistanceM(segmentOne) + lineDistanceM(segmentTwo), elevationGainM: 0,
  trackPoints: activityPoints, markerIds: [], name: 'QA — Activity Gap Bridge Test',
  memoryNewCells: 0, syncState: 'synced', qaProvenance: 'isolated_qa',
};

const browser = await chromium.launch({
  headless: true,
  ...(fs.existsSync(chromePath) ? { executablePath: chromePath } : {}),
  args: ['--enable-webgl', '--ignore-gpu-blocklist', '--disable-background-timer-throttling'],
});
const rawVideoDir = path.join(outputDir, '.raw-video');
fs.mkdirSync(rawVideoDir, { recursive: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, locale: 'en-NZ',
  recordVideo: { dir: rawVideoDir, size: { width: 390, height: 844 } },
});
const page = await context.newPage();
const video = page.video();
const runtimeErrors = [];
const providerCalls = [];
const providerTasks = [];
let routeRecord = null;
page.on('pageerror', error => runtimeErrors.push(`pageerror:${error.message}`));
page.on('console', message => {
  if (message.type() === 'error' && !message.text().includes('Failed to load resource')) runtimeErrors.push(`console:${message.text()}`);
});
page.on('response', response => {
  const url = response.url();
  if (!/api\.mapbox\.com\/(matching|directions)\/v5\/mapbox\/walking/.test(url)) return;
  const task = (async () => {
    const parsed = new URL(url);
    const endpoint = parsed.pathname.includes('/matching/') ? 'matching' : 'directions';
    let body = null;
    try { body = await response.json(); } catch { /* retain HTTP class */ }
    providerCalls.push({
      endpoint,
      httpStatus: response.status(),
      code: body?.code ?? null,
      matchingCount: Array.isArray(body?.matchings) ? body.matchings.length : null,
      routeCount: Array.isArray(body?.routes) ? body.routes.length : null,
      coordinateCount: decodeURIComponent(parsed.pathname.split('/').at(-1) ?? '').split(';').length,
      responseSha256: body == null ? null : sha(body),
    });
  })();
  providerTasks.push(task);
});

await page.addInitScript(userId => {
  localStorage.setItem('cairn_jwt', 'cairn10-public-gap-local');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
}, user.id);
await page.route('**/api/**', async route => {
  const request = route.request();
  const pathname = new URL(request.url()).pathname;
  if (pathname.endsWith('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) }); return;
  }
  if (pathname.endsWith('/api/memory/coverage')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      coverage_rule_version: 4, coverage_version: 'cairn10-gap-empty', evidence_count: 0,
      tile_count: 0, rebuilt_tile_count: 0, total_ms: 1, stage_ms: {},
      geometry: { type: 'MultiPolygon', coordinates: [] },
    }) }); return;
  }
  if (pathname.endsWith('/api/routes') && request.method() === 'POST') {
    const body = JSON.parse(request.postData() ?? '{}');
    const now = new Date().toISOString();
    routeRecord = {
      id: 9100, user_id: user.id, client_route_id: body.client_route_id,
      name: body.name, description: null, points: body.points, ordered_draft: body.ordered_draft,
      resolution_state: body.resolution_state, waypoints: [], distance_m: body.distance_m,
      elevation_gain_m: 0, run_count: 0, last_run_at: null, created_at: now, updated_at: now,
      permission: 'personal', creation_origin: 'activity', source_activity_client_id: session.clientActivityId,
      origin_gap_reconnected: body.origin_gap_reconnected === true,
    };
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ route: routeRecord }) }); return;
  }
  if (pathname.endsWith('/api/routes') && request.method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routes: routeRecord ? [routeRecord] : [] }) }); return;
  }
  if (/\/api\/routes\/[^/]+$/.test(pathname) && request.method() === 'GET') {
    await route.fulfill({ status: routeRecord ? 200 : 404, contentType: 'application/json', body: JSON.stringify({ route: routeRecord }) }); return;
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [], sessions: [], markers: [], routes: [], notifications: [] }) });
});

const waitRoute = name => page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, name, { timeout: 60_000 });
const waitMap = async overlay => {
  await page.getByTestId(overlay).waitFor({ state: 'hidden', timeout: 45_000 }).catch(() => {});
  await page.waitForFunction(() => Boolean(globalThis.__cairnMap?.loaded?.() && globalThis.__cairnMap?.isStyleLoaded?.()), null, { timeout: 45_000 });
};
const fit = points => page.evaluate(values => {
  const lngs = values.map(value => value.lng); const lats = values.map(value => value.lat);
  globalThis.__cairnMap.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: { top: 125, right: 45, bottom: 255, left: 45 }, duration: 0 },
  );
}, points);
const sourceState = async () => page.evaluate(() => {
  const map = globalThis.__cairnMap;
  const style = map.getStyle();
  const sources = Object.keys(style.sources ?? {}).filter(id => /track|gap|route/i.test(id));
  const layers = (style.layers ?? []).map(layer => layer.id).filter(id => /track|gap|route/i.test(id));
  return { sources, layers };
});

let receipt;
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
  await page.evaluate(({ userValue, sessionValue, points }) => {
    const stores = globalThis.__cairnStores;
    localStorage.setItem(`cairn_sessions_${userValue.id}`, JSON.stringify([{ ...sessionValue, trackPoints: undefined }]));
    localStorage.setItem(`cairn_trackpoints_${userValue.id}_${sessionValue.id}`, JSON.stringify(points));
    stores.useAppStore.setState({ user: userValue, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
    stores.useSessionStore.setState({ currentUserId: userValue.id, sessions: [sessionValue] });
    stores.useRouteStore.setState({ routes: [], sharedRoutes: [], routeOwnerId: userValue.id, routesLoading: false, routesLoadError: false });
    stores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'MapHistory', params: { sessionId: sessionValue.id, activityBackContext: 'activities' } }] });
  }, { userValue: user, sessionValue: session, points: activityPoints });
  await waitRoute('MapHistory');
  await page.getByTestId('activity-create-route').waitFor({ state: 'visible', timeout: 30_000 });
  await waitMap('history-map-load-overlay');
  await fit(activityPoints);
  await page.waitForTimeout(400);
  const activityMapState = await sourceState();
  await page.screenshot({ path: path.join(outputDir, '01-activity-solid-dashed-solid-390x844.png') });

  await page.getByTestId('activity-create-route').click();
  await waitRoute('RouteEditor');
  await page.getByTestId('route-editor-title').waitFor({ state: 'visible', timeout: 30_000 });
  await waitMap('ordered-route-map-load-overlay');
  await page.waitForFunction(() => Boolean(globalThis.__cairnRouteEditorQa?.submitStroke), null, { timeout: 30_000 });
  await fit(activityPoints);
  await page.waitForTimeout(400);
  const imported = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  const editorGapState = await sourceState();
  await page.screenshot({ path: path.join(outputDir, '02-editor-solid-dashed-solid-390x844.png') });

  const classification = await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.classifyStroke(stroke), bridgeStroke);
  const providerStart = providerCalls.length;
  await page.getByTestId('route-tool-draw').click();
  await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), bridgeStroke);
  await page.waitForFunction(revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    imported.revision, { timeout: 45_000 });
  const bridged = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  await Promise.all(providerTasks);
  await fit(bridged.parts.flatMap(part => part.points));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '03-interior-bridge-connected-390x844.png') });

  await page.getByTestId('route-undo').click();
  await page.waitForTimeout(200);
  const undone = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  await page.getByTestId('route-tool-draw').click();
  await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), bridgeStroke);
  await page.waitForFunction(revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    imported.revision, { timeout: 45_000 });
  const acceptedAgain = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  await page.getByLabel('Route name').fill('QA — Public Gap Bridge Route');
  await page.getByTestId('ordered-route-save').click();
  await waitRoute('MapHistory');
  await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
  await waitMap('history-map-load-overlay');
  const saved = await page.evaluate(() => globalThis.__cairnStores.useRouteStore.getState().routes[0]);
  await page.getByLabel('Edit route').click();
  await waitRoute('RouteEditor');
  await waitMap('ordered-route-map-load-overlay');
  await page.waitForFunction(() => Boolean(globalThis.__cairnRouteEditorQa?.getCurrentDraft), null, { timeout: 30_000 });
  const reopened = await page.evaluate(() => globalThis.__cairnRouteEditorQa.getCurrentDraft());
  await fit(reopened.parts.flatMap(part => part.points));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '04-saved-reopened-connected-390x844.png') });

  const providerAttempts = providerCalls.slice(providerStart);
  receipt = {
    generatedAt: new Date().toISOString(),
    source: {
      provenance: 'SYNTHETIC_QA_COORDINATES_DERIVED_FROM_ACTUAL_MAPBOX_WALKING_ROUTE',
      sourceSha256: hashPoints(activityPoints), segmentPointCounts: [segmentOne.length, segmentTwo.length],
      solidDistanceM: Number((lineDistanceM(segmentOne) + lineDistanceM(segmentTwo)).toFixed(2)),
      hiddenEvidenceGapChordM: Number(distanceM(segmentOne.at(-1), segmentTwo[0]).toFixed(2)),
      mapboxSeed: { httpStatus: seedResponse.status, code: seedBody.code, routePointCount: road.length, routeDistanceM: Number(totalM.toFixed(2)) },
    },
    screen: { viewport: '390x844', renderer: 'Expo Web + actual hosted Mapbox basemap', nativeIphoneEvidence: false },
    activityMapState,
    editorGapState,
    imported: receiptDraft(imported),
    classification: {
      kind: classification.intent?.kind ?? null,
      crossedGapCount: classification.intent?.options?.[0]?.crossedGapIds?.length ?? null,
      ambiguityReason: classification.diagnostics?.ambiguityReason ?? null,
    },
    providerAttempts,
    bridged: receiptDraft(bridged),
    undone: receiptDraft(undone),
    acceptedAgain: receiptDraft(acceptedAgain),
    saved: receiptDraft(saved.orderedDraft),
    reopened: receiptDraft(reopened),
    sourceActivityAfterSha256: hashPoints(JSON.parse(await page.evaluate(({ userId, id }) => localStorage.getItem(`cairn_trackpoints_${userId}_${id}`), { userId: user.id, id: session.id }))),
    assertions: {
      activityShowsExplicitGapLayer: activityMapState.sources.some(id => id.includes('track-gaps'))
        && activityMapState.layers.some(id => id.includes('track-gaps-layer')),
      importedEditorPreservesGap: imported.parts.length === 2 && imported.gaps.length === 1,
      editorShowsExplicitGapLayer: editorGapState.sources.some(id => id.includes('ordered-route-gap'))
        && editorGapState.layers.some(id => id.includes('ordered-route-gap')),
      interiorToInteriorIntent: classification.intent?.kind === 'replace-across-gap'
        && classification.intent?.options?.[0]?.crossedGapIds?.length === 1,
      actualMapboxMatchedBridgeCommitted: bridged.gaps.length === 0
        && bridged.parts.some(part => part.resolution === 'draw-matched')
        && providerAttempts.some(call => call.endpoint === 'matching' && call.httpStatus === 200 && call.code === 'Ok' && call.matchingCount > 0),
      undoRestoresGapExactly: receiptDraft(undone).partSha256 === receiptDraft(imported).partSha256 && undone.gaps.length === 1,
      saveReopenOrderedParity: receiptDraft(saved.orderedDraft).partSha256 === receiptDraft(reopened).partSha256
        && saved.orderedDraft.gaps.length === reopened.gaps.length,
      sourceActivityUnchanged: hashPoints(activityPoints) === hashPoints(JSON.parse(await page.evaluate(({ userId, id }) => localStorage.getItem(`cairn_trackpoints_${userId}_${id}`), { userId: user.id, id: session.id }))),
      explicitGapReconnectionPersisted: routeRecord?.origin_gap_reconnected === true,
      noRuntimeErrors: runtimeErrors.length === 0,
    },
    runtimeErrors,
    screenshots: [
      '01-activity-solid-dashed-solid-390x844.png', '02-editor-solid-dashed-solid-390x844.png',
      '03-interior-bridge-connected-390x844.png', '04-saved-reopened-connected-390x844.png',
    ],
  };
  receipt.pass = Object.values(receipt.assertions).every(Boolean);
  fs.writeFileSync(path.join(outputDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, pass: receipt.pass, assertions: receipt.assertions }, null, 2));
  if (!receipt.pass) process.exitCode = 1;
} finally {
  await page.close();
  await context.close();
  if (video) {
    const videoPath = await video.path();
    fs.copyFileSync(videoPath, path.join(outputDir, 'gap-bridge-journey-390x844.webm'));
  }
  await browser.close();
}
