#!/usr/bin/env node

/**
 * Activity Detail convergence visual evidence.
 *
 * Safety and evidence boundary:
 * - fresh browser context, synthetic identity, and synthetic coordinates only
 * - all Cairn API reads are fixture responses
 * - every Cairn API write is denied before it can leave the browser
 * - no Finish, delete confirmation, rename submission, Route save, Plant,
 *   friend-location, purchase, export, feedback, or account action is invoked
 * - direct navigation and in-memory store injection are fixture evidence only
 * - Activity Detail uses its Expo Web SVG fallback; this is not native Mapbox
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const scriptDir = path.dirname(new URL(import.meta.url).pathname);
const repoRoot = path.resolve(scriptDir, '../../../../..');
const runDir = path.resolve(scriptDir, '..');
const imageDir = path.join(runDir, 'visual', 'images');
const requireFromApp = createRequire(path.join(repoRoot, 'app', 'package.json'));
const { chromium } = requireFromApp('playwright');
const sharp = requireFromApp('sharp');

const baseUrl = process.env.CAIRN_AD01_URL || 'http://127.0.0.1:8099';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
fs.mkdirSync(imageDir, { recursive: true });

const syntheticUser = {
  id: 'activity-detail-ad01-fixture',
  name: 'Aroha (AD-01 Fixture)',
  email: 'activity.detail.ad01@example.invalid',
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
  geolocation: { latitude: -44.6712, longitude: 167.9251 },
  permissions: ['geolocation'],
  reducedMotion: 'reduce',
});
const page = await context.newPage();
const runtimeErrors = [];
const requestLedger = [];
const preventedWrites = [];
const captures = [];

page.on('pageerror', error => runtimeErrors.push(`pageerror: ${error.message}`));
page.on('console', message => {
  const value = message.text();
  if (
    message.type() === 'error'
    && !value.includes('Failed to load resource')
    && !value.includes('Mapbox')
    && !value.includes('favicon')
    && !value.includes('AUDIT_WRITE_BLOCKED')
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
  const localRuntime = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost';
  const cairnApi = parsed.pathname.startsWith('/api/');
  const entry = { method, host: parsed.host, path: parsed.pathname };

  if (localRuntime && !cairnApi) {
    requestLedger.push({ ...entry, action: 'allowed-local-runtime' });
    return route.continue();
  }

  if (cairnApi) {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      preventedWrites.push(entry);
      requestLedger.push({ ...entry, action: 'prevented-api-write' });
      return json(route, { error: 'AD01_FIXTURE_WRITE_BLOCKED' }, 409);
    }
    requestLedger.push({ ...entry, action: 'fixture-api-read' });
    if (parsed.pathname === '/api/auth/me') return json(route, { user: syntheticUser });
    if (parsed.pathname === '/api/sessions/unfinished') return json(route, { session: null });
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

const settle = (ms = 650) => page.waitForTimeout(ms);

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
  await settle(800);
}

async function shot({ pageKey, state, theme, fixtureBoundary, notes = [] }) {
  const viewport = page.viewportSize() ?? { width: 390, height: 844 };
  const viewportLabel = `${viewport.width}x${viewport.height}`;
  const file = `${pageKey}--${state}--${theme}--${viewportLabel}.png`;
  await page.screenshot({ path: path.join(imageDir, file), fullPage: false });
  captures.push({
    evidence_id: `AD-VIS-${String(captures.length + 1).padStart(3, '0')}`,
    page: pageKey,
    state,
    theme,
    viewport: viewportLabel,
    file: `images/${file}`,
    entry_mode: 'FORCED_TEST_ROUTE',
    data: 'SYNTHETIC_FIXTURE',
    renderer: pageKey === 'route-editor'
      ? 'EXPO_WEB_MAP_UNAVAILABLE_FALLBACK'
      : 'EXPO_WEB_TRACK_POLYLINE_FALLBACK',
    actual_mapbox: false,
    native_screenshot: false,
    fixture_boundary: fixtureBoundary,
    notes: ['Not native Mapbox evidence.', 'Not normal-navigation evidence.', ...notes],
  });
}

await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(globalThis.__cairnStores?.useAppStore), null, { timeout: 120_000 });
await page.waitForFunction(() => globalThis.__cairnStores.useAppStore.getState().hydrated === true, null, { timeout: 120_000 });
await page.evaluate(user => {
  localStorage.setItem('cairn_onboarding_v1_done', 'true');
  localStorage.setItem(`cairn_onboarding_v1_done_${user.id}`, 'true');
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
const base = { lat: -44.6712, lng: 167.9251 };
const continuousPoints = Array.from({ length: 12 }, (_, index) => ({
  lat: base.lat + index * 0.00016,
  lng: base.lng + index * 0.00012,
  alt: 38 + index * 7,
  t: now - (12 - index) * 75_000,
  accuracy: 6,
  speed: 1.45,
  segmentId: 'fixture-segment-a',
  ...(index === 0 ? { segmentStartReason: 'start' } : {}),
}));
const gapPoints = [
  ...continuousPoints.slice(0, 6),
  ...continuousPoints.slice(6).map((point, index) => ({
    ...point,
    lat: point.lat + 0.00075,
    lng: point.lng + 0.00042,
    segmentId: 'fixture-segment-b',
    ...(index === 0 ? { segmentStartReason: 'gps-reacquired' } : {}),
  })),
];

function makeSession({ id, mode, syncState = 'synced', gap = false, linked = false }) {
  const isRun = mode === 'running';
  return {
    id,
    clientActivityId: id,
    activityMode: mode,
    regionCode: 'nz',
    startedAt: now - (isRun ? 2_742_000 : 4_188_000),
    endedAt: now,
    durationS: isRun ? 2742 : 4188,
    distanceM: isRun ? 8120 : 7240,
    elevationGainM: isRun ? 96 : 312,
    trackPoints: gap ? gapPoints : continuousPoints,
    markerIds: linked ? [`${id}-cairn`] : [],
    name: isRun ? 'Harbour tempo (Fixture)' : 'Morning above the sound (Fixture)',
    memoryNewCells: 14,
    syncState,
    finalGeometryState: gap ? 'limited_evidence' : 'enhanced',
  };
}

function makeMarker(session) {
  return {
    id: `${session.id}-cairn`,
    clientCairnId: `${session.id}-cairn`,
    type: 'cairn',
    regionCode: 'nz',
    lat: base.lat + 0.00064,
    lng: base.lng + 0.00048,
    alt: 68,
    note: `Ridgeline pause\u001EA synthetic AD-01 fixture; no real person's Cairn.`,
    authorId: syntheticUser.id,
    createdAt: now - 86_400_000,
    permission: 'personal',
    synced: true,
    syncState: 'synced',
    approximate: false,
    originActivityClientId: session.clientActivityId,
  };
}

async function seedActivity(options) {
  const session = makeSession(options);
  const markers = options.linked ? [makeMarker(session)] : [];
  await page.evaluate(({ fixtureSession, fixtureMarkers, userId }) => {
    const stores = globalThis.__cairnStores;
    stores.useSessionStore.setState({ currentUserId: userId, sessions: [fixtureSession] });
    stores.useMarkerStore.setState({
      userId,
      markers: fixtureMarkers,
      circleMarkers: [],
      publicMarkers: [],
      loadingCircle: false,
      loadingPublic: false,
    });
    stores.useRouteStore.setState({
      routes: [], routesLoading: false, routesLoadError: null,
      circleRoutes: [], loadingCircleRoutes: false, followingRouteId: null,
    });
  }, { fixtureSession: session, fixtureMarkers: markers, userId: syntheticUser.id });
  await settle(200);
  return session;
}

async function openDetail(options) {
  const session = await seedActivity(options);
  await resetTo('MapHistory', { sessionId: session.clientActivityId });
  await page.getByTestId('activity-save-as-route').waitFor({ state: 'visible', timeout: 20_000 });
  await settle(350);
  return session;
}

// Core Hike and Run summaries across the three Cairn scenic modes.
await setTheme('day');
await openDetail({ id: 'fixture-hike-day-linked', mode: 'hiking', linked: true });
await shot({
  pageKey: 'hike-detail', state: 'summary-linked', theme: 'day',
  fixtureBoundary: 'Synthetic synced Hike with one explicitly associated own Cairn.',
});

await setTheme('sunset');
await openDetail({ id: 'fixture-hike-sunset-empty', mode: 'hiking', linked: false });
await shot({
  pageKey: 'hike-detail', state: 'summary-no-cairns', theme: 'sunset',
  fixtureBoundary: 'Synthetic synced Hike with no associated Cairns; section is intentionally omitted.',
});

await setTheme('night');
await openDetail({ id: 'fixture-hike-night-pending', mode: 'hiking', syncState: 'pending', linked: true });
await shot({
  pageKey: 'hike-detail', state: 'local-pending', theme: 'night',
  fixtureBoundary: 'Synthetic locally usable Hike with pending server sync and explicit own Cairn.',
});

await setTheme('day');
await openDetail({ id: 'fixture-run-day-gap', mode: 'running', gap: true, linked: false });
await shot({
  pageKey: 'run-detail', state: 'gap-no-cairns', theme: 'day',
  fixtureBoundary: 'Synthetic Run with two real segments and an explicit GPS gap.',
  notes: ['The disconnected SVG segments prove only the web fallback presentation.'],
});

await setTheme('night');
await openDetail({ id: 'fixture-run-night-error', mode: 'running', syncState: 'sync_error', linked: true });
await shot({
  pageKey: 'run-detail', state: 'sync-failure-linked', theme: 'night',
  fixtureBoundary: 'Synthetic locally usable Run with sync failure and explicit own Cairn.',
  notes: ['Retry was not pressed; no sync job was invoked.'],
});

// Explicit linked-Cairn evidence after scrolling the Detail surface.
await setTheme('sunset');
await openDetail({ id: 'fixture-hike-linked-section', mode: 'hiking', linked: true });
await page.getByTestId('activity-linked-cairns').scrollIntoViewIfNeeded();
await settle(250);
await shot({
  pageKey: 'hike-detail', state: 'linked-cairns-section', theme: 'sunset',
  fixtureBoundary: 'Synthetic explicitly associated own Cairn; tap navigation is not invoked in this capture.',
});

// Save-as-Route draft/confirmation surface only. The Route is not saved.
await setTheme('day');
await openDetail({ id: 'fixture-hike-save-route', mode: 'hiking', linked: false });
await page.getByTestId('activity-save-as-route').click();
await page.waitForFunction(() => globalThis.__cairnStores.getCurrentRoute() === 'RouteEditor', null, { timeout: 20_000 });
await settle(750);
await shot({
  pageKey: 'route-editor', state: 'save-as-route-draft', theme: 'day',
  fixtureBoundary: 'Synthetic copied Activity points opened in the existing Route Editor; Save was not pressed.',
  notes: ['This proves deterministic draft entry only, not native map rendering or a persisted Route.'],
});

// Destructive confirmation only. The confirmation button is never pressed.
await setTheme('night');
await openDetail({ id: 'fixture-hike-delete-sheet', mode: 'hiking', linked: false });
await page.getByTestId('activity-delete-action').click();
await page.getByTestId('activity-delete-confirmation').waitFor({ state: 'visible', timeout: 20_000 });
await settle(250);
await shot({
  pageKey: 'hike-detail', state: 'delete-confirmation', theme: 'night',
  fixtureBoundary: 'Synthetic Activity; destructive confirmation is visible but deletion is not invoked.',
});

// Representative small and large iPhone viewport checks.
await page.setViewportSize({ width: 320, height: 568 });
await setTheme('sunset');
await openDetail({ id: 'fixture-hike-small', mode: 'hiking', linked: false });
await shot({
  pageKey: 'hike-detail', state: 'small-iphone-summary', theme: 'sunset',
  fixtureBoundary: 'Synthetic synced Hike at the smallest supported review viewport.',
  notes: ['320×568 is a web viewport constraint check, not a physical-device screenshot.'],
});

await page.setViewportSize({ width: 430, height: 932 });
await setTheme('day');
await openDetail({ id: 'fixture-run-large', mode: 'running', linked: true });
await shot({
  pageKey: 'run-detail', state: 'large-iphone-linked', theme: 'day',
  fixtureBoundary: 'Synthetic synced Run at a representative larger iPhone viewport.',
  notes: ['430×932 is a web viewport constraint check, not a physical-device screenshot.'],
});

await page.setViewportSize({ width: 390, height: 844 });

const tileW = 234;
const tileH = 506;
const labelH = 42;
const gap = 14;
const columns = 3;

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function makeBoard(file, title, selected) {
  const rows = Math.ceil(selected.length / columns);
  const headerH = 78;
  const width = gap + columns * (tileW + gap);
  const height = headerH + rows * (labelH + tileH + gap);
  const composites = [{
    input: Buffer.from(`<svg width="${width}" height="${headerH}" xmlns="http://www.w3.org/2000/svg"><text x="${gap}" y="34" font-family="Arial" font-size="23" font-weight="700" fill="#F2EFE7">${escapeXml(title)}</text><text x="${gap}" y="56" font-family="Arial" font-size="11" fill="#ABB9B2">EXPO WEB FALLBACK · SYNTHETIC FIXTURES · FORCED TEST ROUTES · NOT NATIVE MAPBOX</text></svg>`),
    left: 0,
    top: 0,
  }];
  for (let index = 0; index < selected.length; index += 1) {
    const item = selected[index];
    const col = index % columns;
    const row = Math.floor(index / columns);
    const left = gap + col * (tileW + gap);
    const top = headerH + row * (labelH + tileH + gap);
    const input = await sharp(path.join(runDir, 'visual', item.file))
      .resize(tileW, tileH, { fit: 'fill' })
      .png()
      .toBuffer();
    const label = `${item.page} · ${item.state} · ${item.theme}`;
    composites.push({
      input: Buffer.from(`<svg width="${tileW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg"><text x="${tileW / 2}" y="26" text-anchor="middle" font-family="Arial" font-size="11" font-weight="600" fill="#E8ECE8">${escapeXml(label)}</text></svg>`),
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
  'board-core-themes.jpg',
  'Activity Detail · core Hike and Run states',
  captures.filter(item => ['summary-linked', 'summary-no-cairns', 'local-pending', 'gap-no-cairns', 'sync-failure-linked'].includes(item.state)),
);
await makeBoard(
  'board-actions-and-layout.jpg',
  'Activity Detail · linked Cairns, actions, and viewport checks',
  captures.filter(item => ['linked-cairns-section', 'save-as-route-draft', 'delete-confirmation', 'small-iphone-summary', 'large-iphone-linked'].includes(item.state)),
);

await browser.close();

const normalizedLedger = [...new Map(requestLedger.map(item => [JSON.stringify(item), item])).values()];
const preventedWriteSummary = [...preventedWrites.reduce((summary, item) => {
  const key = JSON.stringify(item);
  const current = summary.get(key);
  summary.set(key, current ? { ...current, count: current.count + 1 } : { ...item, count: 1 });
  return summary;
}, new Map()).values()];
const result = {
  schema_version: 1,
  run_id: '20260916T164608+0800',
  captured_at: new Date().toISOString(),
  base_url: baseUrl,
  isolation: {
    fresh_browser_context: true,
    synthetic_identity: true,
    synthetic_coordinates: true,
    cairn_api_reads_fixture_intercepted: true,
    cairn_api_writes_denied: true,
    prevented_write_attempt_count: preventedWrites.length,
    allowed_product_write_count: 0,
    production_data_read: false,
    production_data_mutated: false,
  },
  evidence_boundary: {
    entry_mode: 'FORCED_TEST_ROUTE',
    renderer: 'EXPO_WEB_FALLBACK',
    native_mapbox_proven: false,
    normal_navigation_proven_by_capture: false,
    device_loading_proven: false,
    explicit_user_acceptance: 'PENDING',
  },
  captures,
  boards: [
    'images/board-core-themes.jpg',
    'images/board-actions-and-layout.jpg',
  ],
  request_ledger: normalizedLedger,
  prevented_write_attempts: preventedWriteSummary,
  runtime_errors: [...new Set(runtimeErrors)],
};
fs.writeFileSync(path.join(runDir, 'visual', 'capture-results.json'), `${JSON.stringify(result, null, 2)}\n`);

const cards = captures.map(item => `
  <figure>
    <img src="${item.file}" alt="${item.page} ${item.state} ${item.theme}">
    <figcaption><strong>${item.evidence_id} · ${item.page} · ${item.state}</strong><br>${item.theme} · ${item.viewport}<br>Expo Web fallback · synthetic fixture · forced test route</figcaption>
  </figure>`).join('\n');
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Cairn Activity Detail AD-01 visual evidence</title>
<style>body{margin:0;background:#1d2522;color:#f2efe7;font:15px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1120px;margin:auto;padding:28px}h1{font-size:28px}p.notice{color:#d9bd82;background:#2b332f;border:1px solid #58665e;border-radius:12px;padding:14px}.boards img{width:100%;margin:10px 0 22px;border-radius:12px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}figure{margin:0;background:#27302c;padding:12px;border-radius:14px}figure img{display:block;width:100%;border-radius:10px}figcaption{padding-top:10px;color:#c7d0cb;font-size:13px}</style>
</head><body><main><h1>Activity Detail convergence · AD-01</h1>
<p class="notice"><strong>Evidence boundary:</strong> Expo Web fallback, synthetic fixtures, forced test routes. These images do not prove native Mapbox rendering, normal user navigation, deployment, device loading, field behaviour, or owner acceptance. No destructive confirmation or Route save was invoked.</p>
<section class="boards"><h2>Boards</h2><img src="images/board-core-themes.jpg" alt="Core themes board"><img src="images/board-actions-and-layout.jpg" alt="Actions and layout board"></section>
<section><h2>Referenced captures</h2><div class="grid">${cards}</div></section>
</main></body></html>`;
fs.writeFileSync(path.join(runDir, 'visual', 'index.html'), html);

process.stdout.write(`${JSON.stringify({
  output: path.relative(repoRoot, runDir),
  captures: captures.length,
  boards: result.boards.length,
  preventedWrites: preventedWrites.length,
  runtimeErrors: result.runtime_errors,
}, null, 2)}\n`);

if (result.runtime_errors.length > 0) process.exitCode = 1;
