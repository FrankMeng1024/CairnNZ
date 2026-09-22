#!/usr/bin/env node

/**
 * CARD-ROUTE-01 revision-02 affected-surface evidence.
 *
 * Isolation: synthetic user/coordinates; all /api traffic intercepted inside
 * Playwright; all external requests blocked; telemetry disabled. This is Expo
 * Web with native map services unavailable, never native/device evidence.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const runDir = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(runDir, '../../../..');
const imageDir = path.join(runDir, 'visual', 'images');
const requireFromApp = createRequire(path.join(repoRoot, 'app', 'package.json'));
const { chromium } = requireFromApp('playwright');
const sharp = requireFromApp('sharp');
const baseUrl = process.env.CAIRN_ROUTE_URL || 'http://127.0.0.1:8102';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const runId = '20260917T203209+0800';
fs.mkdirSync(imageDir, { recursive: true });

const user = {
  id: '7202',
  name: 'Aroha (Route Revision 02 Fixture)',
  email: 'route-revision-02@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};
const clientRouteId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const remoteRouteId = '601';
const now = Date.now();
const points = Array.from({ length: 12 }, (_, index) => ({
  lat: -44.6717 + index * 0.00016,
  lng: 167.9245 + index * 0.00019,
  alt: 34 + index * 4,
}));
let remotePresent = true;
let remoteRow = {
  id: Number(remoteRouteId),
  user_id: Number(user.id),
  client_route_id: clientRouteId,
  creation_origin: 'activity',
  source_activity_client_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  source_session_id: 72,
  origin_geometry_hash: 'fixture-origin-hash',
  created_geometry_hash: 'fixture-created-hash',
  geometry_edited_since_creation: 1,
  origin_gap_reconnected: 0,
  name: 'Milford ridge return — a deliberately long Route name',
  description: null,
  points,
  waypoints: [],
  distance_m: 2840,
  elevation_gain_m: 52,
  run_count: 0,
  last_run_at: null,
  permission: 'personal',
  created_at: new Date(now - 86_400_000).toISOString(),
  updated_at: new Date(now).toISOString(),
};

const captures = [];
const requests = [];
const assertions = [];
const runtimeErrors = [];
const browser = await chromium.launch({
  headless: true,
  executablePath: chromePath,
  args: ['--disable-web-security'],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  locale: 'en-NZ',
  timezoneId: 'Pacific/Auckland',
  geolocation: { latitude: -44.6712, longitude: 167.9251 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes('Mapbox')
    && !value.includes('favicon')) {
    runtimeErrors.push(`console: ${value}`);
  }
});
page.on('dialog', async dialog => {
  runtimeErrors.push(`unexpected browser dialog: ${dialog.message()}`);
  await dialog.dismiss();
});

await page.route('**/*', async route => {
  const request = route.request();
  const parsed = new URL(request.url());
  const method = request.method();
  const api = parsed.pathname.startsWith('/api/');
  const localRuntime = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  if (localRuntime && !api) return route.continue();
  if (api) {
    requests.push({ method, path: parsed.pathname });
    if (parsed.pathname === '/api/auth/me') return json(route, { user });
    if (parsed.pathname === '/api/sessions/unfinished') return json(route, { session: null });
    if (parsed.pathname === '/api/routes' && method === 'GET') {
      const { points: _points, waypoints: _waypoints, ...listRow } = remoteRow;
      return json(route, { routes: remotePresent ? [listRow] : [] });
    }
    if (parsed.pathname === `/api/routes/${remoteRouteId}` && method === 'GET') {
      return remotePresent
        ? json(route, { route: remoteRow })
        : json(route, { error: 'Route not found.', code: 'ROUTE_NOT_FOUND', route_id: Number(remoteRouteId) }, 404);
    }
    if (parsed.pathname === `/api/routes/client/${clientRouteId}` && method === 'DELETE') {
      // Deliberately emulate an older backend whose router does not implement
      // the client-identity endpoint. The corrected store must use numeric ID.
      return json(route, { error: `Cannot DELETE ${parsed.pathname}` }, 404);
    }
    if (parsed.pathname === `/api/routes/${remoteRouteId}` && method === 'DELETE') {
      remotePresent = false;
      return json(route, {
        message: 'Route deleted.', code: 'ROUTE_DELETED', route_id: Number(remoteRouteId),
      });
    }
    if (parsed.pathname === `/api/routes/${remoteRouteId}` && method === 'PUT') {
      const body = request.postDataJSON();
      remoteRow = {
        ...remoteRow,
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.points !== undefined ? { points: body.points, geometry_edited_since_creation: 1 } : {}),
        ...(body.distance_m !== undefined ? { distance_m: body.distance_m } : {}),
        ...(body.elevation_gain_m !== undefined ? { elevation_gain_m: body.elevation_gain_m } : {}),
        updated_at: new Date().toISOString(),
      };
      return json(route, { route: remoteRow });
    }
    if (parsed.pathname === '/api/markers') return json(route, []);
    if (parsed.pathname === '/api/friends') return json(route, []);
    if (parsed.pathname.includes('/circle/')) return json(route, { cells: [], markers: [], routes: [], geometry: null });
    return json(route, { data: [], routes: [], markers: [], notifications: [], count: 0 });
  }
  if (parsed.hostname === 'api.open-meteo.com') {
    return json(route, {
      current: { temperature_2m: 14, weathercode: 0 },
      daily: { sunrise: [1789480800], sunset: [1789524000] },
      timezone: 'Pacific/Auckland',
    });
  }
  requests.push({ method, path: parsed.pathname, blocked_external: true });
  return route.abort('blockedbyclient');
});

const settle = (ms = 500) => page.waitForTimeout(ms);

async function setTheme(theme) {
  await page.evaluate(nextTheme => {
    const stores = globalThis.__cairnStores;
    stores.useSettingsStore.getState().saveAll({
      appearance: nextTheme,
      debugMode: false,
      telemetryUploadEnabled: false,
      mapLayer: 'outdoors',
    });
    stores.useWeatherStore.getState().setConditionOverride('sunny');
    stores.useWeatherStore.getState().setTimeOfDayOverride(nextTheme);
    stores.useWeatherStore.getState().setDayNightOverride(
      nextTheme === 'night' ? 'night' : nextTheme === 'day' ? 'day' : null,
    );
  }, theme);
  await settle(350);
}

async function resetTo(name, params) {
  await page.evaluate(({ routeName, routeParams }) => {
    globalThis.__cairnStores.navigationRef.reset({
      index: routeName === 'Home' ? 0 : 1,
      routes: routeName === 'Home'
        ? [{ name: 'Home' }]
        : [{ name: 'Home' }, { name: routeName, params: routeParams }],
    });
  }, { routeName: name, routeParams: params });
  await page.waitForFunction(
    routeName => globalThis.__cairnStores.getCurrentRoute() === routeName,
    name,
    { timeout: 30_000 },
  );
  await settle(550);
}

async function shot(state, theme, notes) {
  const viewport = page.viewportSize();
  const viewportLabel = `${viewport.width}x${viewport.height}`;
  const file = `route-revision-02--${state}--${theme}--${viewportLabel}.png`;
  await page.screenshot({ path: path.join(imageDir, file), fullPage: false });
  captures.push({
    evidence_id: `ROUTE-R02-VIS-${String(captures.length + 1).padStart(3, '0')}`,
    state,
    theme,
    viewport: viewportLabel,
    file: `images/${file}`,
    renderer: 'EXPO_WEB_REACT_NATIVE_DOM_WITH_NATIVE_MAP_UNAVAILABLE',
    data: 'SYNTHETIC_DISPOSABLE_FIXTURE',
    actual_web_mapbox: false,
    native_screenshot: false,
    physical_device: false,
    notes,
  });
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(({ fixtureUser, routeId, serverId, fixturePoints, fixtureNow, row }) => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${fixtureUser.id}`, 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user: fixtureUser,
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  stores.useSettingsStore.getState().saveAll({ debugMode: false, telemetryUploadEnabled: false });
  stores.useRouteStore.setState({
    routeOwnerId: fixtureUser.id,
    routes: [{
      id: routeId,
      clientRouteId: routeId,
      remoteId: serverId,
      name: row.name,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
      points: fixturePoints,
      originalPoints: fixturePoints.map(point => ({ ...point })),
      waypoints: [],
      distanceM: row.distance_m,
      elevationGainM: row.elevation_gain_m,
      runCount: 0,
      isActive: false,
      syncState: 'synced',
      creationOrigin: 'activity',
      originActivityClientId: row.source_activity_client_id,
      originActivityServerId: row.source_session_id,
      originGeometryHash: row.origin_geometry_hash,
      createdGeometryHash: row.created_geometry_hash,
      geometryEditedSinceCreation: true,
      originPersistence: 'durable',
    }],
    routesLoading: false,
    routesLoadError: false,
    routeDetailState: { [routeId]: 'ready' },
    activityRouteReference: null,
    followingRouteId: null,
  });
  stores.useSessionStore.setState({
    currentUserId: fixtureUser.id,
    sessions: [{
      id: 'activity-sentinel',
      activityMode: 'hiking',
      regionCode: 'nz',
      startedAt: fixtureNow - 4200000,
      endedAt: fixtureNow,
      durationS: 4200,
      distanceM: 2840,
      elevationGainM: 52,
      trackPoints: fixturePoints,
      markerIds: [],
      name: 'Source Activity sentinel',
      memoryNewCells: 14,
      syncState: 'synced',
    }],
  });
  stores.useMarkerStore.setState({ markers: [{
    id: 'cairn-sentinel', lat: -44.67, lng: 167.92, note: 'Independent Cairn sentinel',
  }] });
  stores.useMemoryStore.setState({ points: [{
    lat: -44.67, lng: 167.92, ts: fixtureNow, cid: 'memory-sentinel',
  }] });
}, {
  fixtureUser: user,
  routeId: clientRouteId,
  serverId: remoteRouteId,
  fixturePoints: points,
  fixtureNow: now,
  row: remoteRow,
});

for (const theme of ['day', 'sunset', 'night']) {
  await setTheme(theme);
  await resetTo('MapHistory', { routeId: clientRouteId });
  await page.getByTestId('route-use-action').waitFor({ state: 'visible', timeout: 30_000 });
  assertions.push({
    check: `${theme} Use Route label`,
    pass: (await page.getByTestId('route-use-action').innerText()).includes('Use Route'),
  });
  assertions.push({
    check: `${theme} raw point metric absent`,
    pass: await page.getByText('points', { exact: true }).count() === 0,
  });
  await shot(`detail-two-metrics-long-name`, theme, [
    'Current source after raw vertex metric removal and shared Use Route label correction.',
    'Map appearance is a Web/native-map fallback, not Mapbox proof.',
  ]);
}

await setTheme('day');
await page.getByTestId('route-use-action').click();
await page.getByTestId('route-use-mode-picker').waitFor({ state: 'visible', timeout: 20_000 });
await settle(900);
await shot('use-route-hike-run-chooser', 'day', [
  'Actual Route Detail handler opened explicit Hike/Run choices; recording was not started.',
]);
await page.getByText('Cancel', { exact: true }).click();
await page.getByTestId('route-use-mode-picker').waitFor({ state: 'hidden', timeout: 20_000 });
await settle(500);

await page.getByLabel('Delete route').click();
await page.getByTestId('route-delete-confirmation').waitFor({ state: 'visible', timeout: 20_000 });
await settle(900);
await shot('delete-confirmation-cancel-path', 'day', [
  'Actual confirmation opened; Keep Route is non-destructive.',
]);
await page.getByText('Keep Route', { exact: true }).click();
await page.getByTestId('route-delete-confirmation').waitFor({ state: 'hidden', timeout: 20_000 });
await settle(500);
assertions.push({
  check: 'Delete cancel retains Route',
  pass: await page.evaluate(routeId => globalThis.__cairnStores.useRouteStore.getState().routes.some(route => route.id === routeId), clientRouteId),
});

// Seed peer-object sentinels immediately before destructive execution so any
// completed boot hydration cannot turn an empty baseline into a false pass.
await page.evaluate(fixtureNow => {
  const stores = globalThis.__cairnStores;
  stores.useSessionStore.setState({ sessions: [{
    id: 'activity-sentinel', activityMode: 'hiking', regionCode: 'nz',
    startedAt: fixtureNow - 4200000, endedAt: fixtureNow, durationS: 4200,
    distanceM: 2840, elevationGainM: 52, trackPoints: [], markerIds: [],
    name: 'Source Activity sentinel', memoryNewCells: 14, syncState: 'synced',
  }] });
  stores.useMarkerStore.setState({ markers: [{
    id: 'cairn-sentinel', lat: -44.67, lng: 167.92, note: 'Independent Cairn sentinel',
  }] });
  stores.useMemoryStore.setState({ points: [{
    lat: -44.67, lng: 167.92, ts: fixtureNow, cid: 'memory-sentinel',
  }] });
}, now);
const peerBefore = await page.evaluate(() => ({
  sessions: JSON.stringify(globalThis.__cairnStores.useSessionStore.getState().sessions),
  markers: JSON.stringify(globalThis.__cairnStores.useMarkerStore.getState().markers),
  memory: JSON.stringify(globalThis.__cairnStores.useMemoryStore.getState().points),
}));
await page.getByLabel('Delete route').click();
await page.getByTestId('route-delete-confirm').click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'Home', null, { timeout: 30_000 });
await settle(600);
const deleteOutcome = await page.evaluate(async ({ ownerId, routeId }) => {
  const stores = globalThis.__cairnStores;
  const afterHandler = {
    routePresent: stores.useRouteStore.getState().routes.some(route => route.id === routeId),
    sessions: JSON.stringify(stores.useSessionStore.getState().sessions),
    markers: JSON.stringify(stores.useMarkerStore.getState().markers),
    memory: JSON.stringify(stores.useMemoryStore.getState().points),
  };
  await stores.useRouteStore.getState().loadRoutes();
  return {
    ...afterHandler,
    routePresentAfterReload: stores.useRouteStore.getState().routes.some(route => route.id === routeId),
    tombstoneStorage: Object.keys(localStorage)
      .filter(key => key.includes('route_tombstones') && key.includes(ownerId))
      .map(key => ({ key, value: localStorage.getItem(key) })),
  };
}, { ownerId: user.id, routeId: clientRouteId });

assertions.push(
  { check: 'Actual delete removes Route locally', pass: deleteOutcome.routePresent === false },
  { check: 'Reload does not resurrect deleted Route', pass: deleteOutcome.routePresentAfterReload === false },
  { check: 'Delete preserves source Activity', pass: deleteOutcome.sessions === peerBefore.sessions },
  { check: 'Delete preserves independent Cairn', pass: deleteOutcome.markers === peerBefore.markers },
  { check: 'Delete preserves personal Memory', pass: deleteOutcome.memory === peerBefore.memory },
  {
    check: 'Old-backend 404 used numeric fallback',
    pass: requests.some(item => item.method === 'DELETE' && item.path === `/api/routes/client/${clientRouteId}`)
      && requests.some(item => item.method === 'DELETE' && item.path === `/api/routes/${remoteRouteId}`),
  },
);

await page.setViewportSize({ width: 375, height: 667 });
remotePresent = true;
await page.evaluate(({ routeId, serverId, fixturePoints, fixtureNow, row }) => {
  globalThis.__cairnStores.useRouteStore.setState({ routes: [{
    id: routeId,
    clientRouteId: routeId,
    remoteId: serverId,
    name: row.name,
    createdAt: fixtureNow - 86400000,
    updatedAt: fixtureNow,
    points: fixturePoints,
    waypoints: [],
    distanceM: row.distance_m,
    elevationGainM: row.elevation_gain_m,
    runCount: 0,
    isActive: false,
    syncState: 'synced',
    creationOrigin: 'activity',
    geometryEditedSinceCreation: true,
    originPersistence: 'durable',
  }] });
}, { routeId: clientRouteId, serverId: remoteRouteId, fixturePoints: points, fixtureNow: now, row: remoteRow });
await setTheme('night');
await resetTo('MapHistory', { routeId: clientRouteId });
await shot('small-web-constraint-long-name', 'night', [
  '375x667 Web constraint only; not a native small-iPhone or safe-area claim.',
]);

await browser.close();

const boardItems = captures;
const tileW = 234;
const tileH = 506;
const labelH = 48;
const gap = 14;
const columns = 3;
const rows = Math.ceil(boardItems.length / columns);
const headerH = 86;
const boardW = gap + columns * (tileW + gap);
const boardH = headerH + rows * (labelH + tileH + gap);
const escapeXml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const composites = [{
  input: Buffer.from(`<svg width="${boardW}" height="${headerH}" xmlns="http://www.w3.org/2000/svg"><text x="${gap}" y="34" font-family="Arial" font-size="22" font-weight="700" fill="#F2EFE7">Route Detail · revision 02 corrections</text><text x="${gap}" y="58" font-family="Arial" font-size="10" fill="#D9BD82">CURRENT SOURCE · EXPO WEB · SYNTHETIC FIXTURE · MAPBOX UNAVAILABLE · NOT DEVICE PROOF</text></svg>`),
  left: 0,
  top: 0,
}];
for (let index = 0; index < boardItems.length; index += 1) {
  const item = boardItems[index];
  const col = index % columns;
  const row = Math.floor(index / columns);
  const left = gap + col * (tileW + gap);
  const top = headerH + row * (labelH + tileH + gap);
  const input = await sharp(path.join(runDir, 'visual', item.file)).resize(tileW, tileH, { fit: 'fill' }).png().toBuffer();
  composites.push({
    input: Buffer.from(`<svg width="${tileW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="${tileW / 2}" y="19" text-anchor="middle" font-family="Arial" font-size="10" font-weight="600" fill="#E8ECE8">${escapeXml(item.state.slice(0, 40))}</text><text x="${tileW / 2}" y="36" text-anchor="middle" font-family="Arial" font-size="9" fill="#ABB9B2">${escapeXml(item.theme)} · ${escapeXml(item.viewport)}</text></svg>`),
    left,
    top,
  });
  composites.push({ input, left, top: top + labelH });
}
const boardFile = 'board-route-revision-02.jpg';
await sharp({ create: { width: boardW, height: boardH, channels: 3, background: '#1D2522' } })
  .composite(composites)
  .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
  .toFile(path.join(imageDir, boardFile));

const result = {
  schema_version: 1,
  run_id: runId,
  captured_at: new Date().toISOString(),
  isolation: {
    synthetic_identity_and_coordinates: true,
    all_api_reads_and_writes_intercepted: true,
    external_network_blocked: true,
    telemetry_disabled: true,
    production_data_read_or_mutated: false,
  },
  evidence_boundary: {
    renderer: 'EXPO_WEB_WITH_NATIVE_MAP_UNAVAILABLE',
    native_mapbox: false,
    physical_device: false,
    owner_acceptance: 'PENDING',
  },
  assertions,
  delete_outcome: deleteOutcome,
  requests: [...new Map(requests.map(item => [JSON.stringify(item), item])).values()],
  captures,
  boards: [`images/${boardFile}`],
  runtime_errors: [...new Set(runtimeErrors)],
};
fs.writeFileSync(path.join(runDir, 'visual', 'capture-results.json'), `${JSON.stringify(result, null, 2)}\n`);

const cards = captures.map(item => `<figure><img src="${item.file}" alt="${item.state} ${item.theme}"><figcaption><strong>${item.evidence_id}</strong><br>${item.state} · ${item.theme} · ${item.viewport}<br>${item.notes.join(' ')}</figcaption></figure>`).join('\n');
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Route revision 02 visual evidence</title><style>body{margin:0;background:#1d2522;color:#f2efe7;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1100px;margin:auto;padding:28px}.notice{color:#ead39f;background:#2b332f;border:1px solid #58665e;border-radius:12px;padding:14px}.board{width:100%;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px}figure{margin:0;background:#27302c;padding:12px;border-radius:14px}figure img{display:block;width:100%;border-radius:10px}figcaption{padding-top:10px;color:#c7d0cb;font-size:13px}</style></head><body><main><h1>Route Detail · revision 02 affected surfaces</h1><p class="notice"><strong>Evidence boundary:</strong> current source rendered in Expo Web with a synthetic disposable fixture. Every API operation was intercepted locally and external requests were blocked. The delete flow exercised the actual confirmation, store tombstone, ambiguous client-endpoint 404, numeric fallback, navigation, and reload handlers. Native Mapbox, physical-device layout/touch/accessibility, deployment, device loading, and owner acceptance remain unverified.</p><img class="board" src="images/${boardFile}" alt="Revision 02 board"><h2>Referenced captures</h2><div class="grid">${cards}</div></main></body></html>`;
fs.writeFileSync(path.join(runDir, 'visual', 'index.html'), html);

const failed = assertions.filter(item => !item.pass);
process.stdout.write(`${JSON.stringify({ captures: captures.length, assertions, runtimeErrors: result.runtime_errors }, null, 2)}\n`);
if (failed.length || result.runtime_errors.length) process.exitCode = 1;
