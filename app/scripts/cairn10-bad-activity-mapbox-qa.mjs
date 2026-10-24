#!/usr/bin/env node

/**
 * Cairn #10 private-source Route transaction proof.
 *
 * Activity 2139 and Route 99 are read-only inputs. Every edit is performed in
 * a fresh browser-local copy through the production Activity Detail -> Create
 * Route screen, editor handlers, provider adapter, store, save, and reopen
 * paths. The persisted receipt contains identities, counts, classifications,
 * geometry fingerprints, and provider result classes only: never coordinates.
 */
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = process.env.CAIRN_QA_URL ?? 'http://127.0.0.1:8081';
const outputDir = path.resolve(process.env.CAIRN10_BAD_ACTIVITY_OUTPUT ?? '/tmp/cairn10-bad-activity-mapbox');
const privateFixture = path.resolve(process.env.CAIRN10_BAD_ACTIVITY_PRIVATE_HEX ?? '/tmp/cairn9_private_bad_route_hex.tsv');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sha = value => crypto.createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;
const point = value => ({ lat: Number(value.lat), lng: Number(value.lng) });
const hashPoints = points => sha(points.map(value => [Number(value.lat).toFixed(7), Number(value.lng).toFixed(7)]));
const distanceM = (a, b) => {
  const latitude = (a.lat + b.lat) * Math.PI / 360;
  return Math.hypot((a.lng - b.lng) * 111_320 * Math.cos(latitude), (a.lat - b.lat) * 110_574);
};
const offsetPoint = (value, eastM, northM) => ({
  ...value,
  lat: value.lat + northM / 110_574,
  lng: value.lng + eastM / (111_320 * Math.cos(value.lat * Math.PI / 180)),
});
const draftReceipt = draft => ({
  draftIdHash: sha(draft.draftId),
  origin: draft.origin,
  revision: draft.revision,
  partCount: draft.parts.length,
  gapCount: draft.gaps.length,
  partPointCounts: draft.parts.map(part => part.points.length),
  resolutions: draft.parts.map(part => part.resolution),
  canonicalPointCount: draft.parts.reduce((sum, part) => sum + part.points.length, 0),
  canonicalSha256: hashPoints(draft.parts.flatMap(part => part.points)),
  orderedPartSha256: sha(draft.parts.map(part => ({ resolution: part.resolution, points: hashPoints(part.points) }))),
  gapSha256: sha(draft.gaps.map(gap => ({ reason: gap.reason, afterPartOrdinal: draft.parts.findIndex(part => part.id === gap.afterPartId) }))),
});

if (!fs.existsSync(privateFixture)) throw new Error('Private Activity 2139 fixture is unavailable');
const encoded = fs.readFileSync(privateFixture, 'utf8').trim().split(/\r?\n/);
if (encoded.length !== 2) throw new Error('Private Activity/Route fixture must have exactly two hex records');
const canonical = JSON.parse(Buffer.from(encoded[0].trim(), 'hex').toString('utf8'));
const savedRoutePoints = JSON.parse(Buffer.from(encoded[1].trim(), 'hex').toString('utf8'));
if (!Array.isArray(canonical) || canonical.length !== 728 || !Array.isArray(savedRoutePoints) || savedRoutePoints.length !== 62) {
  throw new Error('Protected Activity 2139 / Route 99 geometry identity mismatch');
}

const productionQuery = `
const pool=require('./src/config/db');
(async()=>{
  const [activities]=await pool.execute(
    \`SELECT s.id,s.user_id,s.client_activity_id,s.name,s.source_provenance,
            JSON_LENGTH(s.route_points_canonical) canonical_n,
            SHA2(CAST(s.route_points_canonical AS CHAR),256) canonical_db_sha,u.email
       FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.id=2139\`
  );
  const [routes]=await pool.execute(
    \`SELECT r.id,r.user_id,r.client_route_id,r.name,JSON_LENGTH(r.points) points_n,
            JSON_LENGTH(r.ordered_draft,'$.parts') parts_n,
            SHA2(CAST(r.points AS CHAR),256) points_db_sha,u.email
       FROM routes r JOIN users u ON u.id=r.user_id WHERE r.id=99\`
  );
  process.stdout.write(JSON.stringify({activities,routes}));await pool.end();
})().catch(error=>{process.stderr.write(String(error&&error.stack||error));process.exit(1)});
`.trim();

function readProductionMetadata() {
  const remote = `docker exec cairn-backend sh -lc ${quote(`cd /app && node -e ${quote(productionQuery)}`)}`;
  const raw = execFileSync('ssh', [
    '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', 'ubuntu@122.51.174.118', remote,
  ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
  const value = JSON.parse(raw);
  if (value.activities?.length !== 1 || value.routes?.length !== 1) throw new Error('Protected production records not uniquely resolved');
  const activity = value.activities[0];
  const route = value.routes[0];
  if (Number(activity.id) !== 2139 || Number(route.id) !== 99
    || Number(activity.user_id) !== Number(route.user_id)
    || activity.name !== 'bad' || route.name !== 'bad Route'
    || Number(activity.canonical_n) !== 728 || Number(route.points_n) !== 62
    || activity.email !== route.email) {
    throw new Error('Protected production provenance gate failed');
  }
  return {
    activity: {
      id: Number(activity.id),
      ownerIdentitySha256: sha(`${activity.user_id}:${String(activity.email).toLowerCase()}`),
      clientActivityId: activity.client_activity_id,
      sourceProvenance: activity.source_provenance,
      canonicalPointCount: Number(activity.canonical_n),
      databaseGeometrySha256: activity.canonical_db_sha,
    },
    route: {
      id: Number(route.id),
      ownerIdentitySha256: sha(`${route.user_id}:${String(route.email).toLowerCase()}`),
      clientRouteId: route.client_route_id,
      pointCount: Number(route.points_n),
      orderedPartCount: Number(route.parts_n),
      databaseGeometrySha256: route.points_db_sha,
    },
    privateOwnerId: String(activity.user_id),
  };
}

const productionBefore = readProductionMetadata();
const ownerId = productionBefore.privateOwnerId;
const sourcePoints = canonical.map(raw => ({
  ...raw,
  segmentId: raw.segmentId ?? raw.segment_id,
  segmentStartReason: raw.segmentStartReason ?? raw.segment_start_reason,
}));
const segments = [];
for (const raw of sourcePoints) {
  const segmentId = String(raw.segment_id ?? raw.segmentId ?? 'legacy');
  if (segments.at(-1)?.segmentId !== segmentId) segments.push({ segmentId, points: [] });
  segments.at(-1).points.push(point(raw));
}
if (segments.length !== 2 || segments[0].points.length !== 718 || segments[1].points.length !== 10) {
  throw new Error('Activity 2139 segment structure mismatch');
}

const sourceId = String(productionBefore.activity.clientActivityId ?? 'cairn10-activity-2139');
const sourceSession = {
  id: sourceId,
  clientActivityId: sourceId,
  remoteId: 2139,
  serverActivityId: 2139,
  activityMode: 'hiking',
  regionCode: 'CN-31',
  startedAt: Date.now() - 4_000_000,
  endedAt: Date.now() - 3_000_000,
  durationS: 1_000,
  distanceM: 2_590,
  elevationGainM: 0,
  trackPoints: sourcePoints,
  markerIds: [],
  name: 'bad',
  memoryNewCells: 0,
  syncState: 'synced',
};
const qaUser = {
  id: ownerId,
  name: 'Owner read-only Route QA',
  email: 'protected-owner-not-exported@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};

const resample = (values, max = 24) => values.length <= max
  ? values.map(point)
  : Array.from({ length: max }, (_, index) => point(values[Math.round(index * (values.length - 1) / (max - 1))]));
const ordinaryStrokes = [
  { id: 'straight-road-edit', points: resample(segments[0].points.slice(80, 141)) },
  { id: 'local-ordered-replacement', points: resample(segments[0].points.slice(300, 361)) },
  { id: 'unique-nearby-occurrence', points: resample(segments[0].points.slice(500, 561)) },
  { id: 'append-from-end-return', points: [...segments[1].points].reverse().map(point) },
];
const gapStartIndex = segments[0].points.length - 12;
const gapEndIndex = 7;
const gapStart = point(segments[0].points[gapStartIndex]);
const gapEnd = point(segments[1].points[gapEndIndex]);
const latitude = (gapStart.lat + gapEnd.lat) * Math.PI / 360;
const eastM = (gapEnd.lng - gapStart.lng) * 111_320 * Math.cos(latitude);
const northM = (gapEnd.lat - gapStart.lat) * 110_574;
const spanM = Math.max(0.1, Math.hypot(eastM, northM));
const lateralEastM = -northM / spanM * 9;
const lateralNorthM = eastM / spanM * 9;
const gapBridgeStroke = [
  gapStart,
  {
    lat: (gapStart.lat * 2 + gapEnd.lat) / 3 + lateralNorthM / 110_574,
    lng: (gapStart.lng * 2 + gapEnd.lng) / 3 + lateralEastM / (111_320 * Math.cos(latitude)),
  },
  {
    lat: (gapStart.lat + gapEnd.lat * 2) / 3 + lateralNorthM / 110_574,
    lng: (gapStart.lng + gapEnd.lng * 2) / 3 + lateralEastM / (111_320 * Math.cos(latitude)),
  },
  gapEnd,
];

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
const providerTasks = [];
let routeServerRecord = null;
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
    const coordinateCount = decodeURIComponent(parsed.pathname.split('/').at(-1) ?? '').split(';').length;
    let body = null;
    try { body = await response.json(); } catch { /* classification stays transport-only */ }
    providerCalls.push({
      ordinal: providerCalls.length + 1,
      endpoint,
      coordinateCount,
      requestIdentitySha256: sha(`${endpoint}:${coordinateCount}:${[...parsed.searchParams.keys()].filter(key => key !== 'access_token').sort().join(',')}`),
      httpStatus: response.status(),
      resultCode: body?.code ?? null,
      matchingCount: Array.isArray(body?.matchings) ? body.matchings.length : null,
      routeCount: Array.isArray(body?.routes) ? body.routes.length : null,
      responseSha256: body == null ? null : sha(body),
    });
  })();
  providerTasks.push(task);
});

await page.addInitScript(({ userId }) => {
  localStorage.setItem('cairn_jwt', 'cairn10-read-only-local-browser');
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${userId}`, 'true');
}, { userId: ownerId });

await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  if (url.pathname.endsWith('/api/auth/me')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: qaUser }) });
    return;
  }
  if (url.pathname.endsWith('/api/memory/coverage')) {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      coverage_rule_version: 4, coverage_version: 'cairn10-private-empty', evidence_count: 0,
      tile_count: 0, rebuilt_tile_count: 0, total_ms: 1, stage_ms: {},
      geometry: { type: 'MultiPolygon', coordinates: [] },
    }) });
    return;
  }
  if (url.pathname.endsWith('/api/routes') && request.method() === 'POST') {
    const body = JSON.parse(request.postData() ?? '{}');
    const now = new Date().toISOString();
    routeServerRecord = {
      id: 9010, user_id: Number(ownerId), name: body.name, description: body.description ?? null,
      points: body.points ?? [], ordered_draft: body.ordered_draft ?? null,
      resolution_state: body.resolution_state ?? 'continuous', waypoints: body.waypoints ?? [],
      distance_m: body.distance_m ?? 0, elevation_gain_m: body.elevation_gain_m ?? 0,
      run_count: 0, last_run_at: null, created_at: now, updated_at: now,
      permission: body.permission ?? 'personal', client_route_id: body.client_route_id,
      creation_origin: body.source_activity_client_id ? 'activity' : 'manual',
      source_activity_client_id: body.source_activity_client_id ?? null,
      source_session_id: body.source_session_id ?? null,
      origin_geometry_hash: hashPoints(canonical), created_geometry_hash: hashPoints(body.points ?? []),
      geometry_edited_since_creation: true, origin_gap_reconnected: body.origin_gap_reconnected === true,
    };
    await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ route: routeServerRecord }) });
    return;
  }
  if (url.pathname.endsWith('/api/routes') && request.method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ routes: routeServerRecord ? [routeServerRecord] : [] }) });
    return;
  }
  if (/\/api\/routes\/[^/]+$/.test(url.pathname) && request.method() === 'GET') {
    await route.fulfill({ status: routeServerRecord ? 200 : 404, contentType: 'application/json', body: JSON.stringify({ route: routeServerRecord }) });
    return;
  }
  await route.fulfill({
    status: 200, contentType: 'application/json',
    body: JSON.stringify({ data: [], sessions: [], markers: [], notifications: [], routes: [], count: 0 }),
  });
});

const currentRoute = () => page.evaluate(() => globalThis.__cairnStores?.getCurrentRoute?.() ?? null);
const waitRoute = name => page.waitForFunction(expected => globalThis.__cairnStores?.getCurrentRoute?.() === expected, name, { timeout: 60_000 });
const currentDraft = () => page.evaluate(() => globalThis.__cairnRouteEditorQa?.getCurrentDraft?.() ?? null);
const waitEditor = async () => {
  await waitRoute('RouteEditor');
  await page.getByTestId('route-editor-title').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('ordered-route-map-load-overlay').waitFor({ state: 'hidden', timeout: 40_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnRouteEditorQa?.submitStroke
    && globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()
    && globalThis.__cairnMap?.loaded?.()), null, { timeout: 40_000 });
};
const fitPoints = values => page.evaluate(points => {
  const lngs = points.map(value => value.lng); const lats = points.map(value => value.lat);
  globalThis.__cairnMap.fitBounds(
    [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
    { padding: { top: 125, right: 45, bottom: 255, left: 45 }, duration: 0 },
  );
}, values);
const hashLocalActivity = () => page.evaluate(({ userId, id }) => {
  const points = JSON.parse(localStorage.getItem(`cairn_trackpoints_${userId}_${id}`) ?? '[]');
  return points.map(value => [Number(value.lat).toFixed(7), Number(value.lng).toFixed(7)]);
}, { userId: ownerId, id: sourceId }).then(hashPoints);
const discardPendingLocalEditor = async () => {
  const discard = page.getByText('Discard changes', { exact: true });
  await discard.waitFor({ state: 'visible', timeout: 1_500 }).catch(() => {});
  if (await discard.isVisible().catch(() => false)) await discard.click();
};

async function openActivityImport() {
  await page.evaluate(({ user, session, points }) => {
    const stores = globalThis.__cairnStores;
    localStorage.setItem(`cairn_sessions_${user.id}`, JSON.stringify([{ ...session, trackPoints: undefined }]));
    localStorage.setItem(`cairn_trackpoints_${user.id}_${session.id}`, JSON.stringify(points));
    stores.useAppStore.setState({ user, isLoggedIn: true, hydrated: true, sessionExpired: false, logout: () => {} });
    stores.useSettingsStore.getState().saveAll({ debugMode: true, appearance: 'day', mapLayer: 'outdoors' });
    stores.useSessionStore.setState({ currentUserId: user.id, sessions: [session] });
    stores.useRouteStore.setState({
      routes: [], sharedRoutes: [], routeOwnerId: user.id,
      routesLoading: false, routesLoadError: false, routeDetailState: {},
    });
    stores.navigationRef.reset({
      index: 1,
      routes: [{ name: 'Home' }, { name: 'MapHistory', params: { sessionId: session.id, activityBackContext: 'activities' } }],
    });
  }, { user: qaUser, session: sourceSession, points: sourcePoints });
  await discardPendingLocalEditor();
  await waitRoute('MapHistory');
  await page.getByTestId('activity-create-route').waitFor({ state: 'visible', timeout: 30_000 });
  await page.getByTestId('history-map-load-overlay').waitFor({ state: 'hidden', timeout: 40_000 }).catch(() => {});
  await page.getByTestId('activity-create-route').click();
  await waitEditor();
  await fitPoints(sourcePoints.map(point));
  await page.waitForTimeout(250);
}

const results = { ordinaryDraws: [], point: null, trim: null, gapJourney: null };
try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore
    && globalThis.__cairnStores?.useSessionStore
    && globalThis.__cairnStores?.useRouteStore
    && globalThis.__cairnStores?.navigationRef), null, { timeout: 120_000 });
  await openActivityImport();
  const initialDraft = await currentDraft();
  if (initialDraft.parts.length !== 2 || initialDraft.gaps.length !== 1 || initialDraft.origin !== 'activity') {
    throw new Error(`Activity import did not preserve two solid parts and one gap:${JSON.stringify(draftReceipt(initialDraft))}`);
  }
  const initialReceipt = draftReceipt(initialDraft);
  const originalLocalActivitySha256 = await hashLocalActivity();

  for (const scenario of ordinaryStrokes) {
    const before = await currentDraft();
    const providerStart = providerCalls.length;
    const classification = await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.classifyStroke(stroke), scenario.points);
    await page.getByTestId('route-tool-draw').click();
    await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), scenario.points);
    await page.waitForFunction(revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
      before.revision, { timeout: 45_000 });
    const after = await currentDraft();
    await Promise.all(providerTasks);
    const visibleMessage = await page.getByTestId('route-context-message').textContent().catch(() => null);
    results.ordinaryDraws.push({
      id: scenario.id,
      inputPointCount: scenario.points.length,
      inputSha256: hashPoints(scenario.points),
      classifiedIntent: classification.intent?.kind ?? null,
      ambiguityReason: classification.diagnostics?.ambiguityReason ?? null,
      before: draftReceipt(before),
      after: draftReceipt(after),
      committedResolutions: after.parts.filter(part => !before.parts.some(old => old.id === part.id)).map(part => part.resolution),
      providerCalls: providerCalls.slice(providerStart),
      visibleMessage,
      committed: after.revision === before.revision + 1,
    });
    await page.getByTestId('route-undo').click();
    await page.waitForFunction(expected => {
      const draft = globalThis.__cairnRouteEditorQa?.getCurrentDraft?.();
      return draft?.revision === expected.revision && draft?.gaps?.length === expected.gapCount;
    }, { revision: initialDraft.revision, gapCount: initialDraft.gaps.length }, { timeout: 10_000 });
    const restored = await currentDraft();
    if (draftReceipt(restored).orderedPartSha256 !== initialReceipt.orderedPartSha256) throw new Error(`${scenario.id}: Undo did not restore Activity import`);
  }

  // Real failure -> immediate next live Point on the same Activity-derived
  // draft. Only the first directions request is injected as 503.
  const pointTarget = point(segments[0].points[690]);
  const beforePoint = await currentDraft();
  let injectedFailure = false;
  const outageHandler = async route => {
    if (injectedFailure) return route.continue();
    injectedFailure = true;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'cairn10 deterministic one-shot outage' }) });
  };
  await page.route('**/directions/v5/mapbox/walking/**', outageHandler);
  await page.getByTestId('route-tool-point').click();
  await page.evaluate(target => globalThis.__cairnMap.jumpTo({ center: [target.lng, target.lat], zoom: 18, bearing: 0, pitch: 0 }), pointTarget);
  await page.waitForTimeout(300);
  await page.getByTestId('route-point-confirm').click();
  await page.getByText('Routing is unavailable. Your Route and selection are unchanged.', { exact: true })
    .waitFor({ state: 'visible', timeout: 20_000 });
  const failureMessage = await page.getByTestId('route-point-context').textContent();
  const afterFailure = await currentDraft();
  const buttonEnabledAfterFailure = await page.getByTestId('route-point-confirm').isEnabled();
  await page.unroute('**/directions/v5/mapbox/walking/**', outageHandler);
  const liveProviderStart = providerCalls.length;
  await page.evaluate(target => globalThis.__cairnMap.jumpTo({ center: [target.lng, target.lat], zoom: 18, bearing: 0, pitch: 0 }), pointTarget);
  await page.waitForTimeout(300);
  await page.getByTestId('route-point-confirm').click();
  await page.waitForTimeout(250);
  await page.waitForFunction(() => document.querySelector('[data-testid="route-point-confirm"]')?.getAttribute('aria-disabled') !== 'true',
    null, { timeout: 25_000 });
  const afterPoint = await currentDraft();
  if (afterPoint.revision > beforePoint.revision) {
    await page.waitForFunction(() => !globalThis.__cairnRouteEditorQa?.getPointAnimationSnapshot?.(), null, { timeout: 25_000 });
  }
  await Promise.all(providerTasks);
  const liveOutcomeMessage = await page.getByTestId('route-point-context').textContent().catch(() => null);
  results.point = {
    targetSha256: hashPoints([pointTarget]),
    targetDistanceFromPriorEndM: Number(distanceM(beforePoint.parts.at(-1).points.at(-1), pointTarget).toFixed(2)),
    injectedFailureObserved: injectedFailure,
    failureMessage,
    failurePreservedCanonical: draftReceipt(afterFailure).orderedPartSha256 === draftReceipt(beforePoint).orderedPartSha256,
    failurePreservedRevision: afterFailure.revision === beforePoint.revision,
    addAvailableAfterFailure: buttonEnabledAfterFailure,
    liveProviderCalls: providerCalls.slice(liveProviderStart),
    liveOutcomeMessage,
    committed: afterPoint.revision === beforePoint.revision + 1,
    before: draftReceipt(beforePoint),
    after: draftReceipt(afterPoint),
  };
  if (results.point.committed) await page.getByTestId('route-undo').click();
  else await page.getByTestId('route-tool-point').click();
  await page.waitForTimeout(150);

  // Comparable Owner-area positive control through the same production
  // screen handler. The exact Activity End above is outside Mapbox's
  // walking graph; a disposable browser-local draft moves only that End
  // 30 m east, where the bounded coverage probe returned a supported,
  // endpoint-faithful candidate inside the editor's 12 m safety fence.
  // candidate. It is never persisted and never substituted into Activity
  // evidence.
  const supportedDraft = JSON.parse(JSON.stringify(beforePoint));
  supportedDraft.draftId = `${supportedDraft.draftId}:cairn11-supported-point`;
  supportedDraft.revision = 0;
  const supportedEndPart = supportedDraft.parts.at(-1);
  supportedEndPart.points[supportedEndPart.points.length - 1] = offsetPoint(supportedEndPart.points.at(-1), 30, 0);
  supportedDraft.endPoint = supportedEndPart.points.at(-1);
  const supportedRouteId = 'cairn11-owner-area-supported-point';
  await page.evaluate(({ routeId, userId, orderedDraft }) => {
    const points = orderedDraft.parts.flatMap(part => part.points);
    const route = {
      ownerId: userId, clientRouteId: routeId, name: 'Owner-area Point positive control',
      permission: 'personal', creationOrigin: 'activity', resolutionState: 'gapped',
      distanceM: 0, elevationGainM: 0, createdAt: Date.now(), updatedAt: Date.now(),
      points, orderedDraft,
    };
    globalThis.__cairnStores.useRouteStore.setState({ routes: [route], routeOwnerId: userId });
    globalThis.__cairnStores.navigationRef.reset({ index: 1, routes: [{ name: 'Home' }, { name: 'RouteEditor', params: { routeId } }] });
  }, { routeId: supportedRouteId, userId: ownerId, orderedDraft: supportedDraft });
  await discardPendingLocalEditor();
  await page.waitForFunction(routeId => globalThis.__cairnStores?.navigationRef?.getCurrentRoute?.()?.params?.routeId === routeId,
    supportedRouteId, { timeout: 15_000 });
  await waitEditor();
  const supportedBefore = await currentDraft();
  const supportedProviderStart = providerCalls.length;
  await page.getByTestId('route-tool-point').click();
  await page.evaluate(target => globalThis.__cairnMap.jumpTo({ center: [target.lng, target.lat], zoom: 18, bearing: 0, pitch: 0 }), pointTarget);
  await page.waitForTimeout(300);
  const supportedResponse = page.waitForResponse(response => response.url().includes('/directions/v5/mapbox/walking/'), { timeout: 25_000 });
  await page.getByTestId('route-point-confirm').click();
  await supportedResponse;
  await page.waitForFunction(revision => globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision > revision,
    supportedBefore.revision, { timeout: 25_000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelector('[data-testid="route-point-confirm"]')?.getAttribute('aria-disabled') !== 'true',
    null, { timeout: 25_000 });
  await Promise.all(providerTasks);
  const supportedAfter = await currentDraft();
  const supportedCommitted = supportedAfter.revision === supportedBefore.revision + 1;
  const supportedCommittedReceipt = draftReceipt(supportedAfter);
  let supportedUndoRestored = false;
  if (supportedCommitted) {
    await page.getByTestId('route-undo').click();
    await page.waitForFunction(revision => globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision === revision,
      supportedBefore.revision, { timeout: 10_000 });
    supportedUndoRestored = draftReceipt(await currentDraft()).orderedPartSha256 === draftReceipt(supportedBefore).orderedPartSha256;
  }
  results.point.supportedOwnerAreaControl = {
    startOffsetFromOriginalEndM: [30, 0],
    targetSha256: hashPoints([pointTarget]),
    providerCalls: providerCalls.slice(supportedProviderStart),
    committed: supportedCommitted,
    committedResolution: supportedCommitted
      ? supportedAfter.parts.find(part => !supportedBefore.parts.some(old => old.id === part.id))?.resolution ?? null
      : null,
    committedGeometrySha256: supportedCommitted ? supportedCommittedReceipt.orderedPartSha256 : null,
    undoRestored: supportedUndoRestored,
    productionWrites: 0,
  };
  await openActivityImport();

  // Real Trim UI gesture followed by atomic Undo on the unmodified import.
  const beforeTrim = await currentDraft();
  await page.getByTestId('route-tool-trim').click();
  const trimTrack = page.getByTestId('route-trim-track');
  const trimBox = await trimTrack.boundingBox();
  if (!trimBox) throw new Error('Trim track not measurable');
  await page.mouse.move(trimBox.x + 14, trimBox.y + trimBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(trimBox.x + trimBox.width * 0.16, trimBox.y + trimBox.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.getByTestId('route-trim-apply').click();
  await page.waitForFunction(revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    beforeTrim.revision, { timeout: 10_000 });
  const afterTrim = await currentDraft();
  await page.getByTestId('route-undo').click();
  await page.waitForTimeout(150);
  const afterTrimUndo = await currentDraft();
  results.trim = {
    before: draftReceipt(beforeTrim),
    after: draftReceipt(afterTrim),
    afterUndo: draftReceipt(afterTrimUndo),
    committed: afterTrim.revision === beforeTrim.revision + 1,
    undoRestored: draftReceipt(afterTrimUndo).orderedPartSha256 === draftReceipt(beforeTrim).orderedPartSha256
      && afterTrimUndo.gaps.length === beforeTrim.gaps.length,
  };

  // Direct interior-to-interior gap replacement, without Trim.
  const beforeGap = await currentDraft();
  const gapClassification = await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.classifyStroke(stroke), gapBridgeStroke);
  const gapProviderStart = providerCalls.length;
  await page.getByTestId('route-tool-draw').click();
  await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), gapBridgeStroke);
  await page.waitForFunction(revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    beforeGap.revision, { timeout: 45_000 });
  const afterGap = await currentDraft();
  await Promise.all(providerTasks);
  const selectedGapOption = gapClassification.intent?.options?.[0];
  const selectedStartPart = beforeGap.parts.find(part => part.id === selectedGapOption?.start?.partId);
  const selectedEndPart = beforeGap.parts.find(part => part.id === selectedGapOption?.end?.partId);
  const positionPoint = (part, position) => {
    const start = part.points[position.pointIndex];
    const fraction = Number(position.fraction ?? 0);
    if (!fraction) return point(start);
    const end = part.points[position.pointIndex + 1];
    return {
      lat: start.lat + (end.lat - start.lat) * fraction,
      lng: start.lng + (end.lng - start.lng) * fraction,
    };
  };
  if (!selectedStartPart || !selectedEndPart) throw new Error('Gap replacement did not expose solid canonical anchors');
  const expectedStartAnchor = positionPoint(selectedStartPart, selectedGapOption.start);
  const expectedEndAnchor = positionPoint(selectedEndPart, selectedGapOption.end);
  const prefixBefore = [
    ...selectedStartPart.points.slice(0, selectedGapOption.start.pointIndex + 1).map(point),
    ...((selectedGapOption.start.fraction ?? 0) > 0 ? [expectedStartAnchor] : []),
  ];
  const suffixBefore = (selectedGapOption.end.fraction ?? 0) > 0
    ? [expectedEndAnchor, ...selectedEndPart.points.slice(selectedGapOption.end.pointIndex + 1).map(point)]
    : selectedEndPart.points.slice(selectedGapOption.end.pointIndex).map(point);
  const prefixAfter = afterGap.parts[0].points;
  const suffixAfter = afterGap.parts.at(-1).points;
  await page.getByTestId('route-undo').click();
  await page.waitForTimeout(150);
  const afterGapUndo = await currentDraft();

  // Repeat the exact accepted operation, Save through the normal store/API,
  // then reopen through Route Detail's real Edit action.
  await page.getByTestId('route-tool-draw').click();
  await page.evaluate(stroke => globalThis.__cairnRouteEditorQa.submitStroke(stroke), gapBridgeStroke);
  await page.waitForFunction(revision => (globalThis.__cairnRouteEditorQa?.getCurrentDraft?.()?.revision ?? revision) > revision,
    beforeGap.revision, { timeout: 45_000 });
  const beforeSave = await currentDraft();
  await page.getByLabel('Route name').fill('Cairn 10 isolated gap bridge');
  await page.getByTestId('ordered-route-save').click();
  await waitRoute('MapHistory');
  await page.getByTestId('route-detail-panel').waitFor({ state: 'visible', timeout: 30_000 });
  const savedLocal = await page.evaluate(() => globalThis.__cairnStores.useRouteStore.getState().routes[0] ?? null);
  await page.getByLabel('Edit route').click();
  await waitEditor();
  const reopened = await currentDraft();
  const localActivityAfter = await hashLocalActivity();
  results.gapJourney = {
    inputPointCount: gapBridgeStroke.length,
    inputSha256: hashPoints(gapBridgeStroke),
    classifiedIntent: gapClassification.intent?.kind ?? null,
    crossedGapCount: gapClassification.intent?.options?.[0]?.crossedGapIds?.length ?? null,
    before: draftReceipt(beforeGap),
    after: draftReceipt(afterGap),
    providerCalls: providerCalls.slice(gapProviderStart),
    interiorStart: selectedGapOption.start.pointIndex > 0
      && selectedGapOption.start.pointIndex < selectedStartPart.points.length - 1,
    interiorEnd: selectedGapOption.end.pointIndex > 0
      && selectedGapOption.end.pointIndex < selectedEndPart.points.length - 1,
    gapRemoved: afterGap.gaps.length === 0,
    prefixPreserved: hashPoints(prefixAfter) === hashPoints(prefixBefore),
    suffixPreserved: hashPoints(suffixAfter) === hashPoints(suffixBefore),
    undoRestoredGap: afterGapUndo.gaps.length === 1,
    undoRestoredOrderedParts: draftReceipt(afterGapUndo).orderedPartSha256 === draftReceipt(beforeGap).orderedPartSha256,
    saved: savedLocal ? draftReceipt(savedLocal.orderedDraft) : null,
    reopened: draftReceipt(reopened),
    saveReopenParity: savedLocal?.orderedDraft
      ? draftReceipt(savedLocal.orderedDraft).orderedPartSha256 === draftReceipt(reopened).orderedPartSha256
        && draftReceipt(savedLocal.orderedDraft).gapSha256 === draftReceipt(reopened).gapSha256
      : false,
    sourceActivityUnchanged: originalLocalActivitySha256 === localActivityAfter,
    savedOriginGapReconnected: routeServerRecord?.origin_gap_reconnected === true,
  };

  const productionAfter = readProductionMetadata();
  const productionUnchanged = JSON.stringify({ ...productionBefore, privateOwnerId: undefined })
    === JSON.stringify({ ...productionAfter, privateOwnerId: undefined });
  const receipt = {
    source: {
      activity: productionBefore.activity,
      route: productionBefore.route,
      inputActivityCanonicalSha256: hashPoints(sourcePoints),
      inputSavedRouteSha256: hashPoints(savedRoutePoints),
      segmentPointCounts: segments.map(segment => segment.points.length),
      gapDistanceM: Number(distanceM(segments[0].points.at(-1), segments[1].points[0]).toFixed(2)),
    },
    environment: {
      sourceHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      sourceTree: execFileSync('git', ['write-tree'], { cwd: repoRoot, encoding: 'utf8' }).trim(),
      viewport: '390x844',
      renderer: 'Expo Web + real Mapbox GL',
      nativeIphoneEvidence: false,
      productionWrites: 0,
    },
    initialImport: initialReceipt,
    results,
    productionAfter: { activity: productionAfter.activity, route: productionAfter.route },
    assertions: {
      protectedProductionRecordsUnchanged: productionUnchanged,
      sourceActivityStillUnchangedInBrowser: results.gapJourney.sourceActivityUnchanged,
      ordinaryDrawsCommittedWithoutTrim: results.ordinaryDraws.every(value => value.committed),
      ordinaryDrawNeverFalseAmbiguous: results.ordinaryDraws.every(value => value.classifiedIntent !== 'pending-replace'
        && value.classifiedIntent !== 'reject'),
      realProviderAttemptRecordedForEveryDraw: results.ordinaryDraws.every(value => value.providerCalls.length >= 1),
      pointFailureDidNotPoisonEditor: results.point.failurePreservedCanonical
        && results.point.failurePreservedRevision && results.point.addAvailableAfterFailure,
      actualPointOutcomeReturnedWithoutPoisoningEditor: results.point.addAvailableAfterFailure
        && results.point.liveProviderCalls.some(value => value.endpoint === 'directions'),
      supportedOwnerAreaPointCommittedAndUndoRestored: results.point.supportedOwnerAreaControl.committed
        && results.point.supportedOwnerAreaControl.undoRestored
        && results.point.supportedOwnerAreaControl.providerCalls.some(value => value.endpoint === 'directions'
          && value.httpStatus === 200 && value.resultCode === 'Ok' && value.routeCount > 0),
      trimCommittedAndUndoRestored: results.trim.committed && results.trim.undoRestored,
      directGapBridgeWithoutTrim: results.gapJourney.classifiedIntent === 'replace-across-gap'
        && results.gapJourney.gapRemoved,
      interiorSolidAnchors: results.gapJourney.interiorStart && results.gapJourney.interiorEnd,
      prefixSuffixPreserved: results.gapJourney.prefixPreserved && results.gapJourney.suffixPreserved,
      gapUndoRestored: results.gapJourney.undoRestoredGap && results.gapJourney.undoRestoredOrderedParts,
      saveReopenParity: results.gapJourney.saveReopenParity,
      saveRecordsExplicitGapReconnection: results.gapJourney.savedOriginGapReconnected,
      noRuntimeErrors: runtimeErrors.length === 0,
    },
    runtimeErrors,
  };
  receipt.pass = Object.values(receipt.assertions).every(Boolean);
  fs.writeFileSync(path.join(outputDir, 'receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ outputDir, pass: receipt.pass, assertions: receipt.assertions }, null, 2));
  if (!receipt.pass) process.exitCode = 1;
} finally {
  await browser.close();
}
