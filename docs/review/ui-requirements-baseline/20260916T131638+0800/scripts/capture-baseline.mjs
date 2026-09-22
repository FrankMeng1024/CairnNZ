#!/usr/bin/env node

/**
 * CairnNZ requirements/UI baseline capture.
 *
 * Safety contract:
 * - fresh browser context and synthetic identity/coordinates only
 * - every Cairn API request is intercepted
 * - all non-GET/HEAD Cairn API traffic is denied and makes the run fail
 * - no destructive, purchase, feedback, export, Activity lifecycle, or Plant
 *   confirmation action is invoked
 * - direct navigation and store fixtures are TEST_ONLY evidence, never proof
 *   of normal user reachability or deployed/native behaviour
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(scriptDir, '../../../../..');
const requireFromApp = createRequire(path.join(repoRoot, 'app', 'package.json'));
const { chromium } = requireFromApp('playwright');
const sharp = requireFromApp('sharp');

const baseUrl = process.env.CAIRN_AUDIT_URL || 'http://127.0.0.1:8099';
const runDir = path.resolve(scriptDir, '..');
const imageDir = path.join(runDir, 'visual', 'images');
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(imageDir, { recursive: true });

const syntheticUser = {
  id: 'requirements-audit-fixture',
  name: 'Aroha (Fixture)',
  email: 'requirements.audit@example.invalid',
  createdAt: '2026-01-01T00:00:00.000Z',
  dateOfBirth: '1990-01-01',
  hasPassword: true,
  providers: ['email'],
};

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
  geolocation: { latitude: -44.6705, longitude: 167.9240 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
const requestLedger = [];
const blockedWrites = [];
const captures = [];

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (
    message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes('Mapbox')
    && !value.includes('favicon')
  ) runtimeErrors.push(`console: ${value}`);
});
page.on('dialog', dialog => dialog.dismiss());

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

await page.route('**/*', async route => {
  const request = route.request();
  const parsed = new URL(request.url());
  const method = request.method();
  const local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const cairnApi = parsed.pathname.startsWith('/api/');
  const entry = { method, host: parsed.host, path: parsed.pathname };

  if (local && !cairnApi) {
    requestLedger.push({ ...entry, action: 'allowed-local-runtime' });
    return route.continue();
  }

  if (cairnApi) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      blockedWrites.push(entry);
      requestLedger.push({ ...entry, action: 'blocked-write' });
      return json(route, { error: 'AUDIT_WRITE_BLOCKED' }, 409);
    }
    requestLedger.push({ ...entry, action: 'fixture-read' });
    if (parsed.pathname === '/api/auth/me') return json(route, { user: syntheticUser });
    if (parsed.pathname === '/api/sessions/unfinished') return json(route, { session: null });
    if (parsed.pathname === '/api/account/exports') return json(route, []);
    if (parsed.pathname === '/api/friends') return json(route, []);
    if (parsed.pathname === '/api/routes') return json(route, { routes: [] });
    if (parsed.pathname.includes('/circle/fog')) return json(route, { cells: [], geometry: null });
    if (parsed.pathname.includes('/circle/markers')) return json(route, { markers: [] });
    return json(route, { data: [], routes: [], markers: [], notifications: [], count: 0 });
  }

  if (parsed.hostname === 'api.open-meteo.com') {
    requestLedger.push({ ...entry, action: 'fixture-weather' });
    return json(route, {
      current: { temperature_2m: 14, weathercode: 0 },
      daily: { sunrise: [1789480800], sunset: [1789524000] },
      timezone: 'Pacific/Auckland',
    });
  }

  const mapboxRead = method === 'GET' && (
    parsed.hostname === 'api.mapbox.com'
    || parsed.hostname.endsWith('.tiles.mapbox.com')
    || parsed.hostname.endsWith('.mapbox.com')
  );
  if (mapboxRead) {
    requestLedger.push({ ...entry, action: 'allowed-mapbox-read' });
    return route.continue();
  }

  requestLedger.push({ ...entry, action: 'blocked-external' });
  return route.abort('blockedbyclient');
});

const settle = (ms = 700) => page.waitForTimeout(ms);

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
    stores.useWeatherStore.getState().setDayNightOverride(nextTheme === 'night' ? 'night' : nextTheme === 'day' ? 'day' : null);
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
  await settle(850);
}

async function shot({ pageKey, state, theme, renderer, fixtureBoundary, notes = [] }) {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const viewportLabel = `${viewport.width}x${viewport.height}`;
  const file = `${pageKey}--${state}--${theme}--${viewportLabel}.png`;
  await page.screenshot({ path: path.join(imageDir, file), fullPage: false });
  captures.push({
    evidence_id: `VIS-${String(captures.length + 1).padStart(3, '0')}`,
    page: pageKey,
    state,
    theme,
    viewport: viewportLabel,
    file: `images/${file}`,
    entry_mode: 'FORCED_TEST_ROUTE',
    data: 'SYNTHETIC_FIXTURE',
    renderer,
    fixture_boundary: fixtureBoundary,
    notes,
  });
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(user => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem('cairn_onboarding_v1_done_requirements-audit-fixture', 'true');
  const stores = globalThis.__cairnStores;
  stores.useAppStore.setState({
    user,
    isLoggedIn: true,
    hydrated: true,
    sessionExpired: false,
    logout: () => {},
  });
  stores.useSettingsStore.getState().saveAll({
    debugMode: false,
    telemetryUploadEnabled: false,
    telemetryWifiOnly: true,
  });
}, syntheticUser);
await resetTo('Home');

const now = Date.now();
const base = { lat: -44.6705, lng: 167.9240 };
const points = Array.from({ length: 8 }, (_, index) => ({
  lat: base.lat + index * 0.00018,
  lng: base.lng + index * 0.00014,
  alt: 42 + index * 8,
  t: now - (8 - index) * 75_000,
  accuracy: 6,
  speed: 1.4,
  segmentId: 'fixture-segment',
  ...(index === 0 ? { segmentStartReason: 'activity-start' } : {}),
}));
const routeFixture = {
  id: 'fixture-route',
  name: 'Milford Foreshore Fixture',
  description: 'Synthetic audit route — not a field record.',
  createdAt: now - 7 * 86_400_000,
  updatedAt: now - 86_400_000,
  points: points.map(({ lat, lng, alt }) => ({ lat, lng, alt })),
  originalPoints: points.map(({ lat, lng, alt }) => ({ lat, lng, alt })),
  waypoints: [],
  distanceM: 6400,
  elevationGainM: 214,
  runCount: 2,
  lastRunAt: now - 86_400_000,
  isActive: false,
  activityMode: 'hiking',
  permission: 'personal',
  syncState: 'synced',
};
const sessionFixture = {
  id: 'fixture-activity',
  clientActivityId: 'fixture-activity',
  activityMode: 'hiking',
  regionCode: 'nz',
  startedAt: now - 3_600_000,
  endedAt: now,
  durationS: 3600,
  distanceM: 7200,
  elevationGainM: 286,
  trackPoints: points,
  markerIds: ['fixture-cairn'],
  name: 'Morning above the sound (Fixture)',
  memoryNewCells: 14,
  syncState: 'synced',
  finalGeometryState: 'base_ready',
};
const markerFixture = {
  id: 'fixture-cairn',
  clientCairnId: 'fixture-cairn',
  type: 'cairn',
  regionCode: 'nz',
  lat: base.lat + 0.00072,
  lng: base.lng + 0.00056,
  alt: 74,
  note: `Quiet turn\u001EA synthetic audit note, not a real person's Cairn.`,
  authorId: syntheticUser.id,
  createdAt: now - 86_400_000,
  permission: 'personal',
  synced: true,
  syncState: 'synced',
  approximate: false,
  originActivityClientId: sessionFixture.clientActivityId,
};

async function seedObjects() {
  await page.evaluate(({ route, session, marker, memoryPoints, userId }) => {
    const stores = globalThis.__cairnStores;
    stores.useRouteStore.setState({
      routes: [route], routesLoading: false, routesLoadError: null,
      circleRoutes: [], loadingCircleRoutes: false, followingRouteId: null,
    });
    stores.useSessionStore.setState({ currentUserId: userId, sessions: [session] });
    stores.useMarkerStore.setState({
      userId, markers: [marker], circleMarkers: [], publicMarkers: [],
      loadingCircle: false, loadingPublic: false,
    });
    stores.useMemoryStore.setState({
      points: memoryPoints,
      lastWatcherFix: { lat: memoryPoints[0].lat, lng: memoryPoints[0].lng, ts: Date.now() },
      geometryVersion: 1,
      initialRevealDone: true,
    });
  }, {
    route: routeFixture,
    session: sessionFixture,
    marker: markerFixture,
    memoryPoints: points.map((p, index) => ({ lat: p.lat, lng: p.lng, ts: now - index * 60_000, cid: `fixture-memory-${index}`, synced: true })),
    userId: syntheticUser.id,
  });
  await settle(250);
}

async function seedActivity(mode, scenario) {
  await page.evaluate(({ nextMode, nextScenario, fixturePoints, userId }) => {
    const stores = globalThis.__cairnStores;
    const ready = nextScenario === 'ready';
    const last = fixturePoints.at(-1);
    stores.useTrackingStore.setState({
      status: ready ? 'idle' : 'tracking',
      transitionState: 'idle',
      isFinishing: false,
      startError: null,
      sessionId: ready ? null : `fixture-${nextMode}-activity`,
      ownerUserId: userId,
      liveOwnerGeneration: ready ? null : `fixture-${nextMode}-owner`,
      activityMode: nextMode === 'hike' ? 'hiking' : 'running',
      locationProviderSource: 'real',
      startedAt: ready ? null : Date.now() - 2_715_000,
      durationS: ready ? 0 : 2715,
      distanceM: ready ? 0 : nextMode === 'hike' ? 5240 : 8120,
      elevationGainM: ready ? 0 : nextMode === 'hike' ? 286 : 74,
      trackPoints: ready ? [] : fixturePoints,
      trackPointsSmoothed: ready ? [] : fixturePoints,
      trackPointsRaw: ready ? [] : fixturePoints,
      locationAvailable: true,
      backgroundLocationPermission: ready ? 'foreground-only' : 'granted',
      lastCoordinate: ready ? { ...last, accuracy: 6 } : { ...last, accuracy: 6 },
      lastCoordinateTime: Date.now(),
      lastFixTimestamp: Date.now(),
      latestSourceCoordinate: { ...last, accuracy: 6 },
      latestSourceLocationTime: Date.now(),
      realMotionState: ready ? 'probably-stationary' : 'moving',
      realCandidatePending: false,
      realCanonicalDecisionReason: ready ? 'stationary-cluster' : 'moving-evidence',
      pendingSegmentStartReason: null,
      overSpeedActive: false,
      markerIds: [],
      pausePins: [],
      lastStopReason: null,
    });
  }, { nextMode: mode, nextScenario: scenario, fixturePoints: points, userId: syntheticUser.id });
  await settle(400);
}

const themes = ['day', 'sunset', 'night'];

for (const theme of themes) {
  await setTheme(theme);
  for (const scenario of ['ready', 'tracking']) {
    await seedActivity('hike', scenario);
    await resetTo('Hiking');
    await shot({
      pageKey: 'hike', state: scenario, theme,
      renderer: 'EXPO_WEB_NATIVE_MAP_SUBSTITUTE_OR_BLANK',
      fixtureBoundary: 'Tracking store state injected; no Activity start/finish performed.',
      notes: ['Not native Mapbox evidence.', 'Not normal-navigation evidence.'],
    });
  }
  for (const scenario of ['ready', 'tracking']) {
    await seedActivity('run', scenario);
    await resetTo('Running');
    await shot({
      pageKey: 'run', state: scenario, theme,
      renderer: 'EXPO_WEB_NATIVE_MAP_SUBSTITUTE_OR_BLANK',
      fixtureBoundary: 'Tracking store state injected; no Activity start/finish performed.',
      notes: ['Not native Mapbox evidence.', 'Not normal-navigation evidence.'],
    });
  }
}

for (const theme of themes) {
  await setTheme(theme);
  await seedObjects();
  await resetTo('Routes', { initialTab: 'activities' });
  await seedObjects();
  await shot({
    pageKey: 'trails', state: 'activities', theme,
    renderer: 'EXPO_WEB_REACT_NATIVE_LIST',
    fixtureBoundary: 'Synthetic Activity and Route rows injected after mount.',
    notes: ['Normal Home entry exists; this capture uses forced navigation.', 'No All Cairns tab is present.'],
  });
  await resetTo('Routes', { initialTab: 'routes' });
  await seedObjects();
  await shot({
    pageKey: 'trails', state: 'routes', theme,
    renderer: 'EXPO_WEB_REACT_NATIVE_LIST',
    fixtureBoundary: 'Synthetic Activity and Route rows injected after mount.',
    notes: ['No All Cairns tab is present.'],
  });
}

for (const theme of themes) {
  await setTheme(theme);
  await seedObjects();
  await resetTo('MapHistory', { sessionId: sessionFixture.clientActivityId });
  await seedObjects();
  await shot({
    pageKey: 'activity-detail', state: 'synced', theme,
    renderer: 'EXPO_WEB_TRACK_POLYLINE_FALLBACK',
    fixtureBoundary: 'Synthetic completed Activity injected; direct detail route.',
    notes: ['SVG/fallback path is not native Mapbox proof.'],
  });

  await seedObjects();
  await resetTo('MapHistory', { routeId: routeFixture.id });
  await seedObjects();
  await shot({
    pageKey: 'route-detail', state: 'saved', theme,
    renderer: 'EXPO_WEB_TRACK_POLYLINE_FALLBACK',
    fixtureBoundary: 'Synthetic saved Route injected; direct detail route.',
    notes: ['The visible Layers control has no implemented handler in source.'],
  });

  await seedObjects();
  await resetTo('RouteEditor', { routeId: routeFixture.id });
  await seedObjects();
  await shot({
    pageKey: 'route-editor', state: 'view', theme,
    renderer: 'EXPO_WEB_MAP_UNAVAILABLE_FALLBACK',
    fixtureBoundary: 'Synthetic saved Route injected; direct editor route.',
    notes: ['Web fallback is not native Mapbox proof.', 'Gear action is a source TODO.'],
  });

  await seedActivity('hike', 'tracking');
  await resetTo('Plant');
  await page.getByText('Using your Activity location', { exact: true }).waitFor({ timeout: 20_000 });
  await shot({
    pageKey: 'plant', state: 'activity-compose', theme,
    renderer: 'EXPO_WEB_REACT_NATIVE_FORM',
    fixtureBoundary: 'Synthetic active Hike state opens compose directly; Plant Cairn is not pressed.',
    notes: ['No Cairn creation or backend write occurred.'],
  });

  await seedObjects();
  await resetTo('MarkerDetail', { markerId: markerFixture.id });
  await seedObjects();
  const markerHasCanvas = await page.locator('.mapboxgl-canvas').count() > 0;
  await shot({
    pageKey: 'own-cairn-detail', state: 'synced-own', theme,
    renderer: markerHasCanvas ? 'REAL_WEB_MAPBOX_ADAPTER' : 'EXPO_WEB_MAP_FALLBACK',
    fixtureBoundary: 'Synthetic own Cairn injected; direct detail route.',
    notes: ['Not a native renderer capture.', 'Normal reachability exists after successful full Plant.'],
  });

  await seedObjects();
  await resetTo('Memory');
  await seedObjects();
  const gotIt = page.getByText('Got it', { exact: true }).last();
  if (await gotIt.isVisible().catch(() => false)) await gotIt.click();
  await settle(650);
  const memoryHasCanvas = await page.locator('.mapboxgl-canvas').count() > 0;
  await shot({
    pageKey: 'memory', state: 'personal', theme,
    renderer: memoryHasCanvas ? 'REAL_WEB_MAPBOX_ADAPTER' : 'EXPO_WEB_MAP_FALLBACK',
    fixtureBoundary: 'Synthetic personal trace and own Cairn; all friend/public API reads fixture-empty.',
    notes: ['Web adapter substitutes outdoors-v12 for native Standard v3.', 'No real friend-location access.'],
  });

  await resetTo('Settings');
  await page.getByTestId('settings-root').waitFor({ state: 'visible', timeout: 20_000 });
  await shot({
    pageKey: 'settings', state: 'root', theme,
    renderer: 'EXPO_WEB_REACT_NATIVE_FORM',
    fixtureBoundary: 'Synthetic user; auth/profile read intercepted.',
    notes: ['No feedback, export, reset, deletion, sign-out, or external link action invoked.'],
  });
}

// Representative supported-size risks without multiplying every page/state.
await page.setViewportSize({ width: 320, height: 568 });
await setTheme('sunset');
await seedActivity('hike', 'ready');
await resetTo('Hiking');
await shot({
  pageKey: 'hike', state: 'ready-small-screen', theme: 'sunset',
  renderer: 'EXPO_WEB_NATIVE_MAP_SUBSTITUTE_OR_BLANK',
  fixtureBoundary: 'Tracking store ready state injected at representative small viewport.',
  notes: ['Small-screen surrounding-chrome evidence only.', 'Not native Mapbox evidence.'],
});

await page.setViewportSize({ width: 430, height: 932 });
await setTheme('night');
await resetTo('Settings');
await page.getByTestId('settings-root').waitFor({ state: 'visible', timeout: 20_000 });
await shot({
  pageKey: 'settings', state: 'root-large-screen', theme: 'night',
  renderer: 'EXPO_WEB_REACT_NATIVE_FORM',
  fixtureBoundary: 'Synthetic user; auth/profile read intercepted at representative large viewport.',
  notes: ['No destructive, feedback, export, purchase, or external-link action invoked.'],
});
await page.setViewportSize({ width: 390, height: 844 });

const tileW = 234;
const tileH = 506;
const labelH = 38;
const gap = 14;
const columns = 3;

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function makeBoard(file, title, selected) {
  const rows = Math.ceil(selected.length / columns);
  const headerH = 68;
  const width = gap + columns * (tileW + gap);
  const height = headerH + rows * (labelH + tileH + gap);
  const composites = [{
    input: Buffer.from(`<svg width="${width}" height="${headerH}" xmlns="http://www.w3.org/2000/svg"><text x="${gap}" y="38" font-family="Arial" font-size="24" font-weight="700" fill="#F2EFE7">${escapeXml(title)}</text><text x="${gap}" y="58" font-family="Arial" font-size="12" fill="#ABB9B2">EXPO WEB · SYNTHETIC FIXTURES · FORCED TEST ROUTES</text></svg>`),
    left: 0,
    top: 0,
  }];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const left = gap + col * (tileW + gap);
    const top = headerH + row * (labelH + tileH + gap);
    const input = await sharp(path.join(runDir, 'visual', item.file)).resize(tileW, tileH, { fit: 'fill' }).png().toBuffer();
    const label = `${item.page} · ${item.state} · ${item.theme}`;
    composites.push({
      input: Buffer.from(`<svg width="${tileW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="${tileW / 2}" y="25" text-anchor="middle" font-family="Arial" font-size="12" font-weight="600" fill="#E8ECE8">${escapeXml(label)}</text></svg>`),
      left,
      top,
    });
    composites.push({ input, left, top: top + labelH });
  }
  await sharp({ create: { width, height, channels: 3, background: '#1D2522' } })
    .composite(composites)
    .jpeg({ quality: 90, chromaSubsampling: '4:4:4' })
    .toFile(path.join(imageDir, file));
}

await makeBoard(
  'board-activity-day-sunset-night.jpg',
  'Hike and Run recording baseline',
  captures.filter(item => ['hike', 'run'].includes(item.page) && item.viewport === '390x844'),
);
await makeBoard(
  'board-library-detail-editor.jpg',
  'Trails, details, and Route Editor baseline',
  captures.filter(item => ['trails', 'activity-detail', 'route-detail', 'route-editor'].includes(item.page)),
);
await makeBoard(
  'board-cairn-memory-settings.jpg',
  'Plant, own Cairn, Memory, and Settings baseline',
  captures.filter(item => ['plant', 'own-cairn-detail', 'memory', 'settings'].includes(item.page)),
);

await browser.close();

const normalizedLedger = [...new Map(requestLedger.map(item => [JSON.stringify(item), item])).values()];
const result = {
  schema_version: 1,
  captured_at: new Date().toISOString(),
  base_url: baseUrl,
  isolation: {
    fresh_browser_context: true,
    synthetic_identity: true,
    synthetic_coordinates: true,
    cairn_api_reads_fixture_intercepted: true,
    cairn_api_writes_denied: true,
    blocked_write_count: blockedWrites.length,
    preview_or_runtime_production_api_used: false,
  },
  captures,
  boards: [
    'images/board-activity-day-sunset-night.jpg',
    'images/board-library-detail-editor.jpg',
    'images/board-cairn-memory-settings.jpg',
  ],
  request_ledger: normalizedLedger,
  blocked_writes: blockedWrites,
  runtime_errors: [...new Set(runtimeErrors)],
};
fs.writeFileSync(path.join(runDir, 'visual', 'capture-results.json'), `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  output: path.relative(repoRoot, runDir),
  captures: captures.length,
  boards: result.boards.length,
  blockedWrites: blockedWrites.length,
  runtimeErrors: result.runtime_errors,
}, null, 2)}\n`);

if (blockedWrites.length > 0 || result.runtime_errors.length > 0) process.exitCode = 1;
